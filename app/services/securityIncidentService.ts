import { randomBytes } from 'node:crypto';
import { prisma } from '@/app/utils/prisma';

export const INCIDENT_CATEGORIES = ['ACESSO_INDEVIDO', 'EXPOSICAO', 'PERDA', 'ALTERACAO', 'INDISPONIBILIDADE', 'FRAUDE', 'TERCEIRO', 'OUTRO'] as const;
export const INCIDENT_SEVERITIES = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'] as const;
export const INCIDENT_STATUSES = ['DETECTADO', 'EM_AVALIACAO', 'CONTIDO', 'COMUNICACAO_DECIDIDA', 'COMUNICADO', 'ENCERRADO'] as const;
export const SUBJECT_RISKS = ['DESCONHECIDO', 'IMPROVAVEL', 'RELEVANTE'] as const;

export class SecurityIncidentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function record(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SecurityIncidentError('Dados do incidente inválidos.');
  return value as Record<string, unknown>;
}

function strict(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new SecurityIncidentError('Há campos não permitidos no incidente.');
}

function text(value: unknown, label: string, max: number, min: number, optional = false) {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string') throw new SecurityIncidentError(`${label} inválido.`);
  const clean = value.trim();
  // eslint-disable-next-line no-control-regex -- permite tab/quebra de linha, mas rejeita os demais controles.
  if (clean.length < min || clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean)) throw new SecurityIncidentError(`${label} inválido.`);
  return clean;
}

function choice<T extends readonly string[]>(value: unknown, values: T, label: string): T[number] {
  const clean = String(value || '').toUpperCase();
  if (!values.includes(clean)) throw new SecurityIncidentError(`${label} inválido.`);
  return clean as T[number];
}

function date(value: unknown, label: string): Date;
function date(value: unknown, label: string, optional: true): Date | null;
function date(value: unknown, label: string, optional = false): Date | null {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' && !(value instanceof Date)) throw new SecurityIncidentError(`${label} inválida.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new SecurityIncidentError(`${label} inválida.`);
  return parsed;
}

export function addBusinessDays(source: Date, amount: number) {
  const result = new Date(source);
  let remaining = amount;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (![0, 6].includes(result.getUTCDay())) remaining -= 1;
  }
  return result;
}

function retentionLimit(source: Date) {
  const result = new Date(source);
  result.setUTCFullYear(result.getUTCFullYear() + 5);
  return result;
}

export function parseSecurityIncidentCreate(input: unknown) {
  const body = record(input);
  strict(body, ['title', 'category', 'severity', 'summary', 'affectedData', 'affectedSystems', 'affectedSubjectsEstimate', 'detectedAt', 'password', 'justification']);
  const detectedAt = date(body.detectedAt, 'Data de detecção');
  if (detectedAt.getTime() > Date.now() + 5 * 60 * 1000) throw new SecurityIncidentError('A detecção não pode estar no futuro.');
  const estimate = body.affectedSubjectsEstimate === null || body.affectedSubjectsEstimate === undefined || body.affectedSubjectsEstimate === ''
    ? null : Number(body.affectedSubjectsEstimate);
  if (estimate !== null && (!Number.isSafeInteger(estimate) || estimate < 0 || estimate > 1_000_000_000)) throw new SecurityIncidentError('Estimativa de titulares inválida.');
  return {
    title: text(body.title, 'Título', 160, 5)!, category: choice(body.category, INCIDENT_CATEGORIES, 'Categoria'),
    severity: choice(body.severity, INCIDENT_SEVERITIES, 'Severidade'), summary: text(body.summary, 'Resumo', 8000, 20)!,
    affectedData: text(body.affectedData, 'Dados afetados', 6000, 5, true), affectedSystems: text(body.affectedSystems, 'Sistemas afetados', 4000, 3, true),
    affectedSubjectsEstimate: estimate, detectedAt,
  };
}

export function parseSecurityIncidentUpdate(input: unknown) {
  const body = record(input);
  strict(body, ['id', 'version', 'status', 'severity', 'affectedData', 'affectedSystems', 'affectedSubjectsEstimate', 'riskToSubjects',
    'riskAssessment', 'containmentActions', 'decisionRationale', 'containedAt', 'notifiedAnpdAt', 'notifiedSubjectsAt', 'password', 'justification']);
  const id = text(body.id, 'Incidente', 100, 1)!;
  if (!/^[a-z0-9-]+$/i.test(id) || !Number.isSafeInteger(body.version) || Number(body.version) < 1) throw new SecurityIncidentError('Versão ou incidente inválido. Atualize a tela.');
  const estimate = body.affectedSubjectsEstimate === null || body.affectedSubjectsEstimate === undefined || body.affectedSubjectsEstimate === ''
    ? null : Number(body.affectedSubjectsEstimate);
  if (estimate !== null && (!Number.isSafeInteger(estimate) || estimate < 0 || estimate > 1_000_000_000)) throw new SecurityIncidentError('Estimativa de titulares inválida.');
  return {
    id, version: Number(body.version), status: choice(body.status, INCIDENT_STATUSES, 'Estado'), severity: choice(body.severity, INCIDENT_SEVERITIES, 'Severidade'),
    affectedData: text(body.affectedData, 'Dados afetados', 6000, 5, true), affectedSystems: text(body.affectedSystems, 'Sistemas afetados', 4000, 3, true),
    affectedSubjectsEstimate: estimate, riskToSubjects: choice(body.riskToSubjects, SUBJECT_RISKS, 'Risco aos titulares'),
    riskAssessment: text(body.riskAssessment, 'Avaliação de risco', 8000, 20, true), containmentActions: text(body.containmentActions, 'Contenção', 8000, 15, true),
    decisionRationale: text(body.decisionRationale, 'Fundamentação da decisão', 8000, 20, true), containedAt: date(body.containedAt, 'Data de contenção', true),
    notifiedAnpdAt: date(body.notifiedAnpdAt, 'Comunicação à ANPD', true), notifiedSubjectsAt: date(body.notifiedSubjectsAt, 'Comunicação aos titulares', true),
  };
}

function assertTimeline(input: ReturnType<typeof parseSecurityIncidentUpdate>, detectedAt: Date) {
  const nowLimit = Date.now() + 5 * 60 * 1000;
  for (const [label, value] of [['contenção', input.containedAt], ['comunicação à ANPD', input.notifiedAnpdAt], ['comunicação aos titulares', input.notifiedSubjectsAt]] as const) {
    if (value && (value < detectedAt || value.getTime() > nowLimit)) throw new SecurityIncidentError(`Data de ${label} fora da linha do tempo do incidente.`);
  }
  if (input.status === 'ENCERRADO') {
    if (input.riskToSubjects === 'DESCONHECIDO' || !input.riskAssessment || !input.containmentActions || !input.decisionRationale) {
      throw new SecurityIncidentError('Para encerrar, documente risco, contenção e fundamento da decisão.');
    }
    if (input.riskToSubjects === 'RELEVANTE' && (!input.notifiedAnpdAt || !input.notifiedSubjectsAt)) {
      throw new SecurityIncidentError('Risco relevante exige registrar as comunicações à ANPD e aos titulares antes do encerramento.');
    }
  }
  if (input.status === 'COMUNICADO' && (!input.notifiedAnpdAt || !input.notifiedSubjectsAt)) throw new SecurityIncidentError('Informe quando ANPD e titulares foram comunicados.');
}

function assertStatusProgression(current: string, next: string) {
  const order = new Map<string, number>(INCIDENT_STATUSES.map((status, index) => [status, index]));
  if ((order.get(next) ?? -1) < (order.get(current) ?? -1)) {
    throw new SecurityIncidentError('O estado do incidente não pode retroceder; registre a correção no histórico e prossiga com a apuração.', 409);
  }
}

export async function createSecurityIncident(actorId: string, input: unknown) {
  const parsed = parseSecurityIncidentCreate(input);
  const protocol = `INC-${parsed.detectedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(5).toString('hex').toUpperCase()}`;
  const incident = await prisma.$transaction(async tx => {
    const created = await tx.securityIncident.create({ data: { ...parsed, protocol, regulatoryDeadlineAt: addBusinessDays(parsed.detectedAt, 3),
      retainUntil: retentionLimit(parsed.detectedAt), createdById: actorId, updatedById: actorId } });
    await tx.systemLog.create({ data: { level: 'ALERTA', action: 'SECURITY_INCIDENT_CREATED', module: 'SEGURANCA', userId: actorId,
      message: 'Incidente de segurança formalmente registrado.', details: JSON.stringify({ incidentId: created.id, protocol, category: created.category, severity: created.severity }) } });
    return created;
  });
  return incident;
}

export async function updateSecurityIncident(actorId: string, input: unknown) {
  const parsed = parseSecurityIncidentUpdate(input);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "SecurityIncident" WHERE "id" = ${parsed.id} FOR UPDATE`;
    const current = await tx.securityIncident.findUnique({ where: { id: parsed.id } });
    if (!current) throw new SecurityIncidentError('Incidente não encontrado.', 404);
    if (current.version !== parsed.version) throw new SecurityIncidentError('Incidente alterado por outra pessoa. Atualize a tela.', 409);
    if (current.status === 'ENCERRADO') throw new SecurityIncidentError('Incidente encerrado é imutável; registre complemento no log ou abra novo incidente.', 409);
    assertStatusProgression(current.status, parsed.status);
    assertTimeline(parsed, current.detectedAt);
    const containedAt = parsed.containedAt || (['CONTIDO', 'COMUNICACAO_DECIDIDA', 'COMUNICADO', 'ENCERRADO'].includes(parsed.status) ? current.containedAt || new Date() : null);
    const updated = await tx.securityIncident.update({ where: { id: current.id }, data: {
      status: parsed.status, severity: parsed.severity, affectedData: parsed.affectedData, affectedSystems: parsed.affectedSystems,
      affectedSubjectsEstimate: parsed.affectedSubjectsEstimate, riskToSubjects: parsed.riskToSubjects, riskAssessment: parsed.riskAssessment,
      containmentActions: parsed.containmentActions, decisionRationale: parsed.decisionRationale, containedAt,
      notifiedAnpdAt: parsed.notifiedAnpdAt, notifiedSubjectsAt: parsed.notifiedSubjectsAt,
      resolvedAt: parsed.status === 'ENCERRADO' ? new Date() : null, updatedById: actorId, version: { increment: 1 },
    } });
    await tx.systemLog.create({ data: { level: parsed.status === 'ENCERRADO' ? 'INFO' : 'ALERTA', action: `SECURITY_INCIDENT_${parsed.status}`,
      module: 'SEGURANCA', userId: actorId, message: 'Registro regulatório de incidente atualizado.',
      details: JSON.stringify({ incidentId: current.id, protocol: current.protocol, fromStatus: current.status, toStatus: parsed.status,
        riskToSubjects: parsed.riskToSubjects, anpdNotified: !!parsed.notifiedAnpdAt, subjectsNotified: !!parsed.notifiedSubjectsAt }) } });
    return updated;
  });
}
