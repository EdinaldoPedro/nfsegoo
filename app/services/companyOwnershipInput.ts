import { CommercialError } from '@/app/utils/commercial-pricing';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';

export function ownershipId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(value)) throw new CommercialError('Identificador inválido.');
  return value;
}
function record(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Envie uma operação JSON válida.');
  return input as Record<string, unknown>;
}
function strict(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new CommercialError('Campos não permitidos nesta operação.');
}
function password(value: unknown) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 72) throw new CommercialError('Informe sua senha atual (até 72 bytes).');
  return value;
}
function justification(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 10 || value.length > 2000 || Array.from(value).some(c =>
    (c.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(c)) || c.charCodeAt(0) === 127)) throw new CommercialError('Justificativa obrigatória entre 10 e 2.000 caracteres.');
  return value.trim();
}
function document(value: unknown) {
  const result = normalizeCnpj(value);
  if (!validarCNPJ(result)) throw new CommercialError('Confirme o CNPJ completo e válido.');
  return result;
}
export function parseOwnershipCreation(input: unknown) {
  const body = record(input);
  strict(body, ['requestId', 'empresaId', 'proposedOwnerId', 'caseTicketId', 'evidenceMessageId', 'password', 'justification', 'confirmedCnpj', 'evidenceVerified']);
  if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) throw new CommercialError('Identificador da operação inválido. Atualize a tela.');
  if (body.evidenceVerified !== true) throw new CommercialError('Confirme a análise humana da representação e da autorização para transferir os dados.');
  return { requestId: body.requestId, empresaId: ownershipId(body.empresaId), proposedOwnerId: ownershipId(body.proposedOwnerId),
    caseTicketId: ownershipId(body.caseTicketId), evidenceMessageId: ownershipId(body.evidenceMessageId),
    password: password(body.password), justification: justification(body.justification), confirmedCnpj: document(body.confirmedCnpj) };
}
export function parseOwnershipDecision(input: unknown) {
  const body = record(input);
  if (!['ACCEPT', 'REJECT', 'CANCEL', 'FINALIZE'].includes(String(body.action))) throw new CommercialError('Decisão inválida.');
  strict(body, ['action', 'requestId', 'termsHash', 'confirmedCnpj', 'password', 'acknowledged',
    ...(body.action === 'ACCEPT' ? [] : ['justification']),
    ...(body.action === 'FINALIZE' ? ['reviewEvidenceMessageId', 'evidenceVerified'] : [])]);
  if (typeof body.termsHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.termsHash)) throw new CommercialError('Termos ausentes ou inválidos. Recarregue a solicitação.');
  if ((body.action === 'ACCEPT' || body.action === 'FINALIZE') && body.acknowledged !== true) throw new CommercialError('Leia e confirme todas as consequências da transferência.');
  if (body.action === 'FINALIZE' && body.evidenceVerified !== true) throw new CommercialError('Confirme a revisão humana das evidências.');
  return { action: body.action as 'ACCEPT' | 'REJECT' | 'CANCEL' | 'FINALIZE', requestId: ownershipId(body.requestId),
    termsHash: body.termsHash, confirmedCnpj: document(body.confirmedCnpj), password: password(body.password),
    justification: body.action === 'ACCEPT' ? null : justification(body.justification),
    reviewEvidenceMessageId: body.reviewEvidenceMessageId === undefined ? null : ownershipId(body.reviewEvidenceMessageId) };
}
export function parseOwnershipQuery(query: URLSearchParams) {
  if (Array.from(query.keys()).some(key => !['page', 'status', 'empresaId'].includes(key))) throw new CommercialError('Filtro inválido.');
  const page = query.get('page') ?? '1', status = query.get('status') ?? 'PENDING';
  if (!/^[1-9]\d{0,4}$/.test(page) || !['PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'ALL'].includes(status)) throw new CommercialError('Página ou situação inválida.');
  return { page: Number(page), status, empresaId: query.has('empresaId') ? ownershipId(query.get('empresaId')) : undefined };
}
