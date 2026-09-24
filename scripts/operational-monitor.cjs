// One-shot, read-only operational probe. Output contains aggregate counts only.
const { PrismaClient } = require('@prisma/client');

const LEVEL = { OK: 0, WARN: 1, CRITICAL: 2 };
const numeric = value => Number(value || 0);

function check(id, status, value, runbook) { return { id, status, value, runbook }; }

function evaluateOperationalSnapshot(snapshot) {
  const checks = [
    check('http_live', snapshot.http.live ? 'OK' : 'CRITICAL', snapshot.http.live ? 1 : 0, 'availability/web'),
    check('http_ready', snapshot.http.ready ? 'OK' : 'CRITICAL', snapshot.http.ready ? 1 : 0, 'availability/readiness'),
    check('database', snapshot.databaseOk ? 'OK' : 'CRITICAL', snapshot.databaseOk ? 1 : 0, 'database/connectivity'),
  ];
  if (!snapshot.databaseOk) return summarize(checks);

  const worker = snapshot.worker;
  checks.push(
    check('worker_emission', worker.emission && worker.production ? 'OK' : 'CRITICAL', worker.emission && worker.production ? 1 : 0, 'workers/emission'),
    check('worker_document', worker.document ? 'OK' : 'CRITICAL', worker.document ? 1 : 0, 'workers/documents'),
    check('worker_consultation', worker.consultation ? 'OK' : 'CRITICAL', worker.consultation ? 1 : 0, 'workers/consultations'),
  );

  for (const [id, queue, runbook] of [
    ['emission_queue', snapshot.emission, 'queues/emission'],
    ['document_queue', snapshot.document, 'queues/documents'],
    ['consultation_queue', snapshot.consultation, 'queues/consultations'],
  ]) {
    const stalled = numeric(queue.waitingTooLong) + numeric(queue.retryOverdue) + numeric(queue.processingExpired);
    checks.push(check(id, stalled ? 'CRITICAL' : numeric(queue.manual) ? 'WARN' : 'OK', stalled + numeric(queue.manual), runbook));
  }

  checks.push(
    check('email_terminal', snapshot.emailTerminal ? 'WARN' : 'OK', numeric(snapshot.emailTerminal), 'communications/email'),
    check('certificate_expired', snapshot.certificates.expired ? 'CRITICAL' : 'OK', numeric(snapshot.certificates.expired), 'certificates/expired'),
    check('certificate_7_days', snapshot.certificates.within7Days ? 'CRITICAL' : 'OK', numeric(snapshot.certificates.within7Days), 'certificates/renewal'),
    check('certificate_30_days', !snapshot.certificates.within7Days && snapshot.certificates.within30Days ? 'WARN' : 'OK', numeric(snapshot.certificates.within30Days), 'certificates/renewal'),
    check('privacy_overdue', snapshot.privacyOverdue ? 'CRITICAL' : 'OK', numeric(snapshot.privacyOverdue), 'privacy/deadlines'),
    check('incident_overdue', snapshot.incidentOverdue ? 'CRITICAL' : 'OK', numeric(snapshot.incidentOverdue), 'incidents/regulatory-deadline'),
  );
  return summarize(checks);
}

function summarize(checks) {
  const severity = checks.reduce((highest, item) => Math.max(highest, LEVEL[item.status]), 0);
  return { ok: severity === 0, severity, status: severity === 2 ? 'CRITICAL' : severity === 1 ? 'WARN' : 'OK', checks };
}

function monitorBaseUrl() {
  const raw = process.env.MONITOR_TARGET_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  const url = new URL(raw);
  const production = process.env.NODE_ENV === 'production';
  if ((production && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw new Error('MONITOR_TARGET_BASE_URL inválida.');
  }
  return url;
}

async function probe(url, pathname) {
  try {
    const target = new URL(pathname, url);
    const response = await fetch(target, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json', 'User-Agent': 'NFSeGoo-Operational-Monitor/1' },
    });
    const ok = response.status === 200;
    await response.body?.cancel();
    return ok;
  } catch { return false; }
}

async function collectDatabaseSnapshot(prisma) {
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [worker, emission, document, consultation, operational] = await Promise.all([
      tx.$queryRaw`SELECT
        EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'emission-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds') AS emission,
        EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'emission-%' AND "productionEnabled" = true AND "updatedAt" > clock_timestamp() - interval '45 seconds') AS production,
        EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'document-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds') AS document,
        EXISTS (SELECT 1 FROM "WorkerHeartbeat" WHERE "id" LIKE 'consultation-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds') AS consultation`,
      tx.$queryRaw`SELECT
        COUNT(*) FILTER (WHERE status = 'PENDENTE' AND "createdAt" < clock_timestamp() - interval '5 minutes' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= clock_timestamp()))::int AS "waitingTooLong",
        COUNT(*) FILTER (WHERE status = 'ERRO_TEMPORARIO' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" < clock_timestamp() - interval '5 minutes'))::int AS "retryOverdue",
        COUNT(*) FILTER (WHERE status = 'PROCESSANDO' AND ("leaseUntil" IS NULL OR "leaseUntil" < clock_timestamp() - interval '5 minutes'))::int AS "processingExpired",
        COUNT(*) FILTER (WHERE status = 'RECONCILIACAO_MANUAL')::int AS manual FROM "EmissaoJob"`,
      tx.$queryRaw`SELECT
        COUNT(*) FILTER (WHERE status = 'PENDENTE' AND "createdAt" < clock_timestamp() - interval '5 minutes' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= clock_timestamp()))::int AS "waitingTooLong",
        COUNT(*) FILTER (WHERE status = 'PENDENTE' AND "nextAttemptAt" < clock_timestamp() - interval '5 minutes')::int AS "retryOverdue",
        COUNT(*) FILTER (WHERE status = 'PROCESSANDO' AND ("leaseUntil" IS NULL OR "leaseUntil" < clock_timestamp() - interval '5 minutes'))::int AS "processingExpired",
        COUNT(*) FILTER (WHERE status = 'REVISAO_MANUAL')::int AS manual FROM "EmissionDocumentTask"`,
      tx.$queryRaw`SELECT
        COUNT(*) FILTER (WHERE tipo = 'CONSULTAR' AND status = 'PENDENTE' AND "createdAt" < clock_timestamp() - interval '5 minutes')::int AS "waitingTooLong",
        COUNT(*) FILTER (WHERE tipo = 'CONSULTAR' AND status = 'ERRO_TEMPORARIO' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" < clock_timestamp() - interval '5 minutes'))::int AS "retryOverdue",
        COUNT(*) FILTER (WHERE tipo = 'CONSULTAR' AND status = 'PROCESSANDO' AND ("leaseUntil" IS NULL OR "leaseUntil" < clock_timestamp() - interval '5 minutes'))::int AS "processingExpired",
        COUNT(*) FILTER (WHERE tipo = 'CONSULTAR' AND status = 'RECONCILIACAO_MANUAL')::int AS manual FROM "FiscalNoteOperation"`,
      tx.$queryRaw`SELECT
        (SELECT COUNT(*)::int FROM "EmailOutbox" WHERE status IN ('ERRO_FINAL','EXPIRADO')) AS "emailTerminal",
        (SELECT COUNT(*)::int FROM "Empresa" WHERE "arquivadoEm" IS NULL AND "certificadoA1" IS NOT NULL AND "certificadoVencimento" <= clock_timestamp()) AS "certificateExpired",
        (SELECT COUNT(*)::int FROM "Empresa" WHERE "arquivadoEm" IS NULL AND "certificadoA1" IS NOT NULL AND "certificadoVencimento" > clock_timestamp() AND "certificadoVencimento" <= clock_timestamp() + interval '7 days') AS "certificate7",
        (SELECT COUNT(*)::int FROM "Empresa" WHERE "arquivadoEm" IS NULL AND "certificadoA1" IS NOT NULL AND "certificadoVencimento" > clock_timestamp() AND "certificadoVencimento" <= clock_timestamp() + interval '30 days') AS "certificate30",
        (SELECT COUNT(*)::int FROM "PrivacyRequest" WHERE status IN ('PENDENTE','EM_ANALISE','AGUARDANDO_TITULAR') AND "dueAt" < clock_timestamp()) AS "privacyOverdue",
        (SELECT COUNT(*)::int FROM "SecurityIncident" WHERE status NOT IN ('COMUNICADO','ENCERRADO') AND "riskToSubjects" = 'RELEVANTE' AND "regulatoryDeadlineAt" < clock_timestamp()) AS "incidentOverdue"`,
    ]);
    return { worker: worker[0], emission: emission[0], document: document[0], consultation: consultation[0], operational: operational[0] };
  });
  return {
    databaseOk: true,
    worker: result.worker,
    emission: result.emission,
    document: result.document,
    consultation: result.consultation,
    emailTerminal: result.operational.emailTerminal,
    certificates: { expired: result.operational.certificateExpired, within7Days: result.operational.certificate7, within30Days: result.operational.certificate30 },
    privacyOverdue: result.operational.privacyOverdue,
    incidentOverdue: result.operational.incidentOverdue,
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  let baseUrl;
  try { baseUrl = monitorBaseUrl(); }
  catch { console.error('OPERATIONAL_MONITOR_BLOCKED: URL pública inválida.'); process.exitCode = 2; return; }
  const [live, ready] = await Promise.all([probe(baseUrl, '/api/health/live'), probe(baseUrl, '/api/health/ready')]);
  const prisma = new PrismaClient({ log: [] });
  let database;
  try { database = await collectDatabaseSnapshot(prisma); }
  catch { database = { databaseOk: false }; }
  finally { await prisma.$disconnect(); }
  const result = evaluateOperationalSnapshot({ http: { live, ready }, ...database });
  const output = { generatedAt, status: result.status, checks: result.checks };
  if (process.env.MONITOR_OUTPUT === 'json') console.log(JSON.stringify(output));
  else { console.log(`OPERATIONAL_MONITOR_${result.status}`); console.table(result.checks); }
  process.exitCode = result.severity;
}

if (require.main === module) main().catch(() => { console.error('OPERATIONAL_MONITOR_CRITICAL'); process.exitCode = 2; });

module.exports = { evaluateOperationalSnapshot, collectDatabaseSnapshot, monitorBaseUrl };
