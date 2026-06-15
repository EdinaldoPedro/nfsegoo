import { NextResponse } from 'next/server';

export const MANUAL_CONTRACTING_PAYMENT = 'ATIVACAO_MANUAL';

export const MANUAL_CONTRACTING_PENDING_STATUSES = [
  'AGUARDANDO_COMPROVANTE',
  'COMPROVANTE_ENVIADO',
  'EM_ANALISE',
] as const;

export const MANUAL_CONTRACTING_FINAL_STATUSES = [
  'ATIVADO_MANUALMENTE',
  'RECUSADO',
] as const;

export const MANUAL_CONTRACTING_STATUSES = [
  ...MANUAL_CONTRACTING_PENDING_STATUSES,
  ...MANUAL_CONTRACTING_FINAL_STATUSES,
] as const;

export const MANUAL_CONTRACTING_STATUS_LABELS: Record<string, string> = {
  AGUARDANDO_COMPROVANTE: 'Aguardando comprovante',
  COMPROVANTE_ENVIADO: 'Comprovante enviado',
  EM_ANALISE: 'Em analise',
  ATIVADO_MANUALMENTE: 'Ativado manualmente',
  RECUSADO: 'Recusado',
  AGUARDANDO_ATIVACAO_MANUAL: 'Aguardando ativacao manual',
};

export const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024;

const ALLOWED_PROOF_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const ALLOWED_PROOF_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);

export function parsePedidoMetadata(gatewayId: string | null) {
  if (!gatewayId) return {};

  try {
    return JSON.parse(gatewayId);
  } catch {
    return {};
  }
}

export function sanitizeProofFileName(fileName: unknown) {
  const rawName = typeof fileName === 'string' && fileName.trim() ? fileName.trim() : 'comprovante';
  return rawName.replace(/[^\w.\- ]+/g, '_').slice(0, 140);
}

function fileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

export function validatePaymentProof(input: {
  nomeArquivo?: unknown;
  mimeType?: unknown;
  tamanho?: unknown;
  conteudoBase64?: unknown;
}) {
  const nomeArquivo = sanitizeProofFileName(input.nomeArquivo);
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.toLowerCase().trim() : '';
  const declaredSize = Number(input.tamanho || 0);

  if (typeof input.conteudoBase64 !== 'string' || !input.conteudoBase64.trim()) {
    return { errorResponse: NextResponse.json({ error: 'Comprovante nao informado.' }, { status: 400 }) };
  }

  const extensionAllowed = ALLOWED_PROOF_EXTENSIONS.has(fileExtension(nomeArquivo));
  const mimeAllowed = ALLOWED_PROOF_MIME_TYPES.has(mimeType);

  if (!extensionAllowed || !mimeAllowed) {
    return { errorResponse: NextResponse.json({ error: 'Comprovante deve ser PDF, PNG, JPG ou WEBP.' }, { status: 400 }) };
  }

  let base64 = input.conteudoBase64.trim();
  const dataUrlMatch = base64.match(/^data:([^;,]+);base64,/i);
  if (dataUrlMatch) {
    base64 = base64.slice(dataUrlMatch[0].length);
  }

  const compactBase64 = base64.replace(/\s/g, '');
  if (!compactBase64 || compactBase64.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64)) {
    return { errorResponse: NextResponse.json({ error: 'Comprovante em formato invalido.' }, { status: 400 }) };
  }

  const buffer = Buffer.from(compactBase64, 'base64');
  if (buffer.length > MAX_PAYMENT_PROOF_BYTES || declaredSize > MAX_PAYMENT_PROOF_BYTES) {
    return { errorResponse: NextResponse.json({ error: 'Comprovante excede o limite de 5 MB.' }, { status: 413 }) };
  }

  return {
    value: {
      nomeArquivo,
      mimeType,
      tamanho: buffer.length,
      conteudoBase64: buffer.toString('base64'),
    },
    errorResponse: null,
  };
}

export function serializePedidoContratacao(pedido: any) {
  const detalhes = parsePedidoMetadata(pedido.gatewayId);
  const anexos = Array.isArray(pedido.anexos) ? pedido.anexos : [];

  return {
    id: pedido.id,
    planoSlug: pedido.planoSlug,
    ciclo: pedido.ciclo,
    notasAdicionais: pedido.notasAdicionais,
    valorPlano: Number(pedido.valorPlano || 0),
    valorAdicionais: Number(pedido.valorAdicionais || 0),
    valorTotal: Number(pedido.valorTotal || 0),
    status: pedido.status,
    statusLabel: MANUAL_CONTRACTING_STATUS_LABELS[pedido.status] || pedido.status,
    formaPagamento: pedido.formaPagamento,
    createdAt: pedido.createdAt,
    updatedAt: pedido.updatedAt,
    detalhes,
    anexos: anexos.map((anexo: any) => ({
      id: anexo.id,
      nomeArquivo: anexo.nomeArquivo,
      mimeType: anexo.mimeType,
      tamanho: anexo.tamanho,
      createdAt: anexo.createdAt,
      downloadUrl: `/api/checkout/comprovante?id=${anexo.id}`,
    })),
  };
}
