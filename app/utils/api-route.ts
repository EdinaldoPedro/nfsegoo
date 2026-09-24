import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { validateJsonContentLength, validateSameOrigin } from './request-guards';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UPLOAD_ROUTES = new Set([
  '/api/checkout', '/api/checkout/comprovante', '/api/suporte/tickets',
  '/api/suporte/tickets/mensagem', '/api/perfil', '/api/perfil/validar-certificado',
]);

export class RequestBodyError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function defaultBodyLimit(pathname: string) {
  if (pathname.startsWith('/api/auth/')) return 16 * 1024;
  if (UPLOAD_ROUTES.has(pathname)) return 7 * 1024 * 1024;
  if (pathname === '/api/admin/avisos' || pathname === '/api/admin/config') return 4 * 1024 * 1024;
  return 1_000_000;
}

function validateJsonStructure(value: unknown) {
  if (!value || typeof value !== 'object') throw new RequestBodyError(400, 'O corpo deve ser um objeto ou uma lista JSON.');
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > 50_000 || current.depth > 32) throw new RequestBodyError(413, 'Estrutura JSON excede o limite permitido.');
    if (!current.value || typeof current.value !== 'object') continue;
    for (const [key, child] of Object.entries(current.value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new RequestBodyError(400, 'Campo JSON nao permitido.');
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
}

/** Reads a bounded clone; the handler still receives its original, unread Request. */
export async function assertBoundedJsonBody(request: Request, maxBytes: number, timeoutMs = 10_000) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid body limit configuration');
  const encoding = request.headers.get('content-encoding');
  if (encoding && encoding !== 'identity') throw new RequestBodyError(415, 'Corpo compactado nao aceito nesta API.');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new RequestBodyError(400, 'Tamanho da requisicao invalido.');
  }
  if (declared !== null && Number(declared) > maxBytes) throw new RequestBodyError(413, 'Payload muito grande.');
  if (!request.body) return;
  const reader = request.clone().body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new RequestBodyError(408, 'Tempo de envio esgotado.')), timeoutMs);
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new RequestBodyError(413, 'Payload muito grande.');
      chunks.push(chunk.value);
    }
    if (size === 0) return;
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      validateJsonStructure(JSON.parse(text));
    } catch (error) {
      if (error instanceof RequestBodyError) throw error;
      throw new RequestBodyError(400, 'JSON invalido.');
    }
  } catch (error) {
    // Cancel both tee branches without waiting for one branch to consume the other.
    void reader.cancel().catch(() => {});
    void request.body.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

type RouteOptions = { maxBodyBytes?: number };

export function withApiGuard<TRequest extends Request, TArgs extends unknown[]>(
  handler: (request: TRequest, ...args: TArgs) => Promise<Response | undefined>,
  options: RouteOptions = {},
) {
  return async (request: TRequest, ...args: TArgs): Promise<Response> => {
    const traceId = randomUUID();
    const finish = (response: Response) => {
      // Includes legacy handlers that catch errors and return raw database messages.
      if (response.status >= 500) {
        response = NextResponse.json({ error: 'Servico temporariamente indisponivel. Tente novamente ou informe o protocolo ao suporte.', traceId }, {
          status: response.status, headers: response.headers,
        });
        response.headers.delete('content-length');
        response.headers.delete('content-encoding');
        response.headers.set('content-type', 'application/json; charset=utf-8');
      }
      response.headers.set('X-Request-Id', traceId);
      response.headers.set('Cache-Control', 'no-store, private');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      return response;
    };
    try {
      const originError = validateSameOrigin(request);
      if (originError) return finish(originError);
      if (MUTATIONS.has(request.method.toUpperCase())) {
        const maxBytes = options.maxBodyBytes ?? defaultBodyLimit(new URL(request.url).pathname);
        const lengthError = validateJsonContentLength(request, maxBytes);
        if (lengthError) return finish(lengthError);
        await assertBoundedJsonBody(request, maxBytes);
      }
      const response = await handler(request, ...args);
      if (!(response instanceof Response)) throw new Error('Route did not return a response');
      return finish(response);
    } catch (error) {
      if (error instanceof RequestBodyError) return finish(NextResponse.json({ error: error.message }, { status: error.status }));
      console.error('[API_FAILURE]', { traceId, path: new URL(request.url).pathname, method: request.method, errorName: error instanceof Error ? error.name : 'UnknownError' });
      return finish(NextResponse.json({}, { status: 500 }));
    }
  };
}
