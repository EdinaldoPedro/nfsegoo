// Read-only launch gate. It never prints credentials, tokens, personal data or fiscal documents.
const { PrismaClient } = require('@prisma/client');
const { Prisma } = require('@prisma/client');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ensureFiscalSchemas } = require('../app/services/emissor/validation/FiscalSchema.ts');
const { validarCNPJ } = require('../app/utils/cnpj.ts');
const { fiscalHomologationDetail, inspectFiscalHomologationEvidence } = require('../app/utils/fiscal-homologation-evidence.ts');
const { inspectReleaseManifest, releaseReadinessDetail } = require('./release-artifact.cjs');
const { inspectInfrastructureEvidence, infrastructureReadinessDetail } = require('./infrastructure-readiness.cjs');
const { inspectLegalGovernanceEvidence, legalGovernanceDetail } = require('./legal-governance-readiness.cjs');
const { inspectCapacityEvidence, capacityReadinessDetail } = require('./capacity-readiness.cjs');
const { inspectManualAcceptanceEvidence, manualAcceptanceDetail } = require('./manual-acceptance-readiness.cjs');
const { inspectPublicLaunchEvidence, publicLaunchDetail } = require('./public-launch-readiness.cjs');
const {
  compareDatabaseStructure, compareMigrationInventory, databaseStructureDetail,
  migrationReadinessDetail, readExpectedPrismaStructure, readLocalMigrationInventory,
} = require('./migration-readiness.cjs');

const checks = [];
const check = (id, ok, detail, blocking = true) => checks.push({ id, status: ok ? 'OK' : blocking ? 'BLOCK' : 'WARN', detail });
const enabled = (name) => process.env[name] === 'true';
const present = (name, minimum = 1) => typeof process.env[name] === 'string' && process.env[name].trim().length >= minimum;
const validEmail = (name) => present(name, 5) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env[name].trim());

function safeUrl(name) {
  try { const value = new URL(process.env[name] || ''); return value; } catch { return null; }
}

function recentPastDate(name, maxAgeDays) {
  const parsed = new Date(process.env[name] || '');
  const age = Date.now() - parsed.getTime();
  return Number.isFinite(parsed.getTime()) && age >= 0 && age <= maxAgeDays * 24 * 60 * 60 * 1000;
}

async function main() {
  const pinnedNode = require('node:fs').readFileSync(path.join(__dirname, '..', '.node-version'), 'utf8').trim().replace(/^v/, '');
  check('node', process.versions.node === pinnedNode, `Node ${process.versions.node}; esperado exatamente ${pinnedNode}`);
  check('node_env', process.env.NODE_ENV === 'production', 'NODE_ENV deve ser production');
  check('jwt', present('JWT_SECRET', 32) && !/GERAR_|CHANGE|EXEMPLO|SEGREDO/i.test(process.env.JWT_SECRET || ''), 'JWT_SECRET aleatório com pelo menos 32 caracteres');
  check('encryption', Buffer.byteLength(process.env.ENCRYPTION_KEY || '', 'utf8') === 32
    && !/GERAR_|CHANGE|EXEMPLO|ALEATORIO/i.test(process.env.ENCRYPTION_KEY || ''), 'ENCRYPTION_KEY deve ter exatamente 32 bytes aleatórios');
  check('legacy_secrets', !enabled('ALLOW_STATIC_LEGACY_KEY') && !enabled('ALLOW_PLAINTEXT_LEGACY_SECRETS'), 'atalhos legados precisam estar desativados');

  const publicUrl = safeUrl('NEXT_PUBLIC_APP_URL');
  const publicHost = publicUrl?.hostname.toLowerCase() || '';
  check('public_url', Boolean(publicUrl && publicUrl.protocol === 'https:' && !publicUrl.username && !publicUrl.password
    && !['localhost', '127.0.0.1', '::1'].includes(publicHost) && !publicHost.endsWith('.invalid') && !publicHost.includes('exemplo')),
  'URL pública HTTPS real, sem credenciais ou host de exemplo');
  const csrfOrigins = (process.env.CSRF_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  check('csrf_origins', Boolean(publicUrl && csrfOrigins.includes(publicUrl.origin)), 'origem pública incluída explicitamente em CSRF_ALLOWED_ORIGINS');
  check('hsts', enabled('SECURITY_HSTS_ENABLED'), 'HSTS habilitado somente após confirmar HTTPS em domínio e subdomínios');
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS);
  check('proxy_ip', enabled('TRUST_PROXY_HEADERS') && ['x-real-ip', 'cf-connecting-ip', 'x-forwarded-for'].includes(process.env.TRUSTED_CLIENT_IP_HEADER || '')
    && Number.isSafeInteger(proxyHops) && proxyHops >= 1 && proxyHops <= 10, 'proxy deve sobrescrever cabeçalho permitido e declarar de 1 a 10 saltos');
  check('maintenance_routes', !enabled('ENABLE_MAINTENANCE_ROUTES') && !enabled('ENABLE_CERT_DEBUG'), 'rotas destrutivas e depuração de certificado desativadas');
  const monitorUrl = safeUrl('MONITOR_TARGET_BASE_URL');
  check('external_monitor', Boolean(publicUrl && monitorUrl && monitorUrl.protocol === 'https:'
    && monitorUrl.origin === publicUrl.origin && !monitorUrl.username && !monitorUrl.password && !monitorUrl.search && !monitorUrl.hash
    && present('MONITORING_PROVIDER_REF', 3) && present('MONITORING_ALERT_OWNER', 3)
    && present('MONITORING_ALERT_CHANNEL_REF', 3) && present('MONITORING_RUNBOOK_REF', 3)
    && !/exemplo|definir|nome-ou/i.test(`${process.env.MONITORING_PROVIDER_REF} ${process.env.MONITORING_ALERT_OWNER} ${process.env.MONITORING_ALERT_CHANNEL_REF} ${process.env.MONITORING_RUNBOOK_REF}`)),
  'monitor externo no domínio público, responsável, canal de alerta e runbook reais');

  check('legal_identity', present('NEXT_PUBLIC_LEGAL_COMPANY_NAME', 3) && validarCNPJ(process.env.NEXT_PUBLIC_LEGAL_COMPANY_CNPJ)
    && present('NEXT_PUBLIC_LEGAL_COMPANY_ADDRESS', 10) && present('NEXT_PUBLIC_PRIVACY_OFFICER_NAME', 3), 'controlador, CNPJ válido e encarregado identificados');
  check('legal_versions', enabled('NEXT_PUBLIC_LEGAL_DOCUMENTS_APPROVED') && present('NEXT_PUBLIC_TERMS_VERSION', 8)
    && present('NEXT_PUBLIC_PRIVACY_VERSION', 8) && present('NEXT_PUBLIC_LEGAL_UPDATED_AT', 8)
    && !/draft|exemplo|aaaa|dd de/i.test(`${process.env.NEXT_PUBLIC_TERMS_VERSION} ${process.env.NEXT_PUBLIC_PRIVACY_VERSION} ${process.env.NEXT_PUBLIC_LEGAL_UPDATED_AT}`), 'documentos aprovados, datados e com versões finais');
  check('legal_channels', validEmail('NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL') && validEmail('NEXT_PUBLIC_SUPPORT_CONTACT_EMAIL'), 'canais oficiais com e-mails válidos');
  const legalGovernance = inspectLegalGovernanceEvidence({
    rootDir: path.join(__dirname, '..'),
    evidenceFile: process.env.LEGAL_GOVERNANCE_EVIDENCE_FILE,
    termsVersion: process.env.NEXT_PUBLIC_TERMS_VERSION,
    privacyVersion: process.env.NEXT_PUBLIC_PRIVACY_VERSION,
  });
  check('legal_governance', legalGovernance.ok, legalGovernanceDetail(legalGovernance));

  check('billing_mode', process.env.BILLING_MODE === 'MANUAL', 'cobrança manual explicitamente habilitada; integração automática ainda não implementada');
  const launchStage = process.env.LAUNCH_STAGE;
  check('launch_stage', ['CONTROLLED_PILOT', 'PUBLIC'].includes(launchStage), 'estágio precisa ser CONTROLLED_PILOT ou PUBLIC');
  check('registration_mode', launchStage === 'CONTROLLED_PILOT' ? process.env.PUBLIC_REGISTRATION_MODE === 'CLOSED'
    : launchStage === 'PUBLIC' && process.env.PUBLIC_REGISTRATION_MODE === 'OPEN',
  'piloto exige cadastro fechado; abertura pública exige modo OPEN e evidência própria');
  if (process.env.BILLING_MODE === 'MANUAL') check('manual_billing_owner', validEmail('MANUAL_BILLING_OWNER_EMAIL'), 'responsável pela conciliação manual com e-mail válido');
  check('incident_owner', present('INCIDENT_RESPONSE_OWNER', 3) && !/nome-ou|exemplo|definir/i.test(process.env.INCIDENT_RESPONSE_OWNER || ''), 'responsável real por incidentes definido');
  check('backups', enabled('BACKUP_POLICY_CONFIRMED') && recentPastDate('BACKUP_RESTORE_TESTED_AT', 120), 'restauração comprovada nos últimos 120 dias');
  check('bootstrap', !present('BOOTSTRAP_ADMIN_EMAIL'), 'remova BOOTSTRAP_ADMIN_EMAIL depois de criar a primeira conta');
  let fiscalTrustConfigured = false;
  try { fiscalTrustConfigured = require('../app/utils/pkcs12.ts').loadIcpTrustBundle().length > 0; }
  catch { /* Ausência, arquivo ilegível ou raiz inválida bloqueiam produção. */ }
  check('fiscal_trust', fiscalTrustConfigured, 'raízes ICP-Brasil oficiais configuradas e legíveis');
  check('production_worker_flag', enabled('FISCAL_WORKER_ALLOW_PRODUCTION') && enabled('READINESS_REQUIRE_PRODUCTION_WORKER'), 'worker de produção habilitado e obrigatório no readiness');
  check('fiscal_homologation_enforcement', enabled('FISCAL_HOMOLOGATION_ENFORCEMENT'), 'worker final deve exigir evidência fiscal válida antes de habilitar produção');
  const fiscalHomologation = inspectFiscalHomologationEvidence({
    rootDir: path.join(__dirname, '..'),
    evidenceFile: process.env.FISCAL_HOMOLOGATION_EVIDENCE_FILE,
  });
  check('fiscal_homologation', fiscalHomologation.ok, fiscalHomologationDetail(fiscalHomologation));
  const release = inspectReleaseManifest({
    rootDir: path.join(__dirname, '..'),
    manifestFile: process.env.RELEASE_MANIFEST_FILE,
  });
  check('release_integrity', release.ok, releaseReadinessDetail(release));
  const capacity = inspectCapacityEvidence({
    evidenceFile: process.env.CAPACITY_EVIDENCE_FILE,
    expectedReleaseId: release.releaseId,
  });
  check('capacity', capacity.ok, capacityReadinessDetail(capacity));
  const manualAcceptance = inspectManualAcceptanceEvidence({
    evidenceFile: process.env.MANUAL_ACCEPTANCE_EVIDENCE_FILE,
    planFile: path.join(__dirname, '..', 'docs', 'TESTES-MANUAIS.md'),
    expectedReleaseId: release.releaseId,
  });
  check('manual_acceptance', manualAcceptance.ok, manualAcceptanceDetail(manualAcceptance));
  if (launchStage === 'PUBLIC') {
    const publicLaunch = inspectPublicLaunchEvidence({
      evidenceFile: process.env.PUBLIC_LAUNCH_EVIDENCE_FILE,
      expectedReleaseId: release.releaseId,
    });
    check('public_launch', publicLaunch.ok, publicLaunchDetail(publicLaunch));
  } else {
    check('public_launch', launchStage === 'CONTROLLED_PILOT', 'evidência de abertura pública não é exigida enquanto o cadastro permanece fechado');
  }
  const infrastructure = inspectInfrastructureEvidence({
    evidenceFile: process.env.INFRASTRUCTURE_EVIDENCE_FILE,
  });
  check('infrastructure', infrastructure.ok, infrastructureReadinessDetail(infrastructure));
  check('email_outbox', enabled('EMAIL_OUTBOX_ENABLED'), 'retentativa durável de e-mails habilitada');

  try { await ensureFiscalSchemas(); check('fiscal_schemas', true, 'XSDs oficiais e manifesto íntegros'); }
  catch { check('fiscal_schemas', false, 'XSDs oficiais ausentes, alterados ou incompatíveis'); }

  const databaseUrl = safeUrl('DATABASE_URL');
  const localDatabase = databaseUrl && ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname);
  const tls = databaseUrl?.searchParams.get('sslmode') === 'verify-full';
  check('database_url', Boolean(databaseUrl), 'DATABASE_URL válida');
  check('database_tls', Boolean(databaseUrl && !localDatabase && tls), localDatabase ? 'PostgreSQL local não é aceito para comercialização' : 'PostgreSQL remoto exige sslmode=verify-full');

  const prisma = new PrismaClient({ log: [] });
  try {
    const db = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [migrations, databaseColumns, access, trial, smtp, worker, auxiliaryWorkers, fiscalQueue, emailQueue] = await Promise.all([
        tx.$queryRaw`SELECT migration_name AS name, checksum, started_at AS "startedAt",
          finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack"
          FROM "_prisma_migrations" ORDER BY started_at`,
        tx.$queryRaw`SELECT table_name AS "tableName", column_name AS "columnName"
          FROM information_schema.columns WHERE table_schema = current_schema()`,
        tx.$queryRaw`SELECT COUNT(*) FILTER (WHERE role = 'MASTER')::int AS masters,
          COUNT(*) FILTER (WHERE role IN ('MASTER','ADMIN','SUPORTE','SUPORTE_TI','COMERCIAL') AND "mfaEnabledAt" IS NULL)::int AS staff_without_mfa FROM "User" WHERE "privacyErasedAt" IS NULL`,
        tx.$queryRaw`SELECT COUNT(*)::int AS count FROM "Plan" WHERE slug = 'TRIAL' AND active = true AND tipo = 'PLANO' AND "diasTeste" BETWEEN 1 AND 90`,
        tx.$queryRaw`SELECT COUNT(*)::int AS count FROM "ConfiguracaoSistema" WHERE id = 'config' AND "smtpHost" IS NOT NULL AND "smtpUser" IS NOT NULL AND "smtpPass" IS NOT NULL AND "emailRemetente" IS NOT NULL`,
        tx.$queryRaw`SELECT COUNT(*) FILTER (WHERE "id" LIKE 'emission-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds')::int AS alive,
          COUNT(*) FILTER (WHERE "id" LIKE 'emission-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds' AND "productionEnabled" = true)::int AS production FROM "WorkerHeartbeat"`,
        tx.$queryRaw`SELECT COUNT(*) FILTER (WHERE "id" LIKE 'consultation-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds')::int AS consultation,
          COUNT(*) FILTER (WHERE "id" LIKE 'document-%' AND "updatedAt" > clock_timestamp() - interval '45 seconds')::int AS document FROM "WorkerHeartbeat"`,
        tx.$queryRaw`SELECT COUNT(*) FILTER (WHERE status = 'RECONCILIACAO_MANUAL')::int AS manual FROM "EmissaoJob"`,
        tx.$queryRaw`SELECT COUNT(*) FILTER (WHERE status = 'ERRO_FINAL')::int AS failed,
          COUNT(*) FILTER (WHERE status IN ('PENDENTE','ERRO_TEMPORARIO') AND "expiresAt" <= clock_timestamp())::int AS expired_pending FROM "EmailOutbox"`,
      ]);
      return { migrations, databaseColumns, access: access[0], trial: trial[0], smtp: smtp[0], worker: worker[0], auxiliaryWorkers: auxiliaryWorkers[0], fiscalQueue: fiscalQueue[0], emailQueue: emailQueue[0] };
    });
    const localMigrations = readLocalMigrationInventory(path.join(__dirname, '..', 'prisma', 'migrations'));
    const migrationState = compareMigrationInventory(localMigrations, db.migrations);
    check('migrations', migrationState.ok, migrationReadinessDetail(migrationState));
    const structureState = compareDatabaseStructure(readExpectedPrismaStructure(Prisma.dmmf), db.databaseColumns);
    check('database_structure', structureState.ok, databaseStructureDetail(structureState));
    check('master_account', db.access.masters >= 1, 'ao menos uma conta MASTER ativa');
    check('staff_mfa', db.access.staff_without_mfa === 0, `${db.access.staff_without_mfa} conta(s) interna(s) sem MFA`);
    check('trial_plan', db.trial.count === 1, 'plano TRIAL único, ativo e válido');
    check('smtp', db.smtp.count === 1 || (present('SMTP_HOST') && present('SMTP_USER') && present('SMTP_PASS')), 'SMTP completo no banco ou ambiente');
    check('worker_heartbeat', db.worker.alive >= 1 && db.worker.production >= 1, 'worker recente e habilitado para produção');
    check('consultation_worker_heartbeat', db.auxiliaryWorkers.consultation >= 1, 'worker dedicado de consultas com heartbeat recente');
    check('document_worker_heartbeat', db.auxiliaryWorkers.document >= 1, 'worker dedicado de documentos com heartbeat recente');
    check('manual_reconciliation', db.fiscalQueue.manual === 0, `${db.fiscalQueue.manual} emissão(ões) em conciliação manual`, false);
    check('email_queue', db.emailQueue.failed === 0 && db.emailQueue.expired_pending === 0,
      `${db.emailQueue.failed} falha(s) final(is) e ${db.emailQueue.expired_pending} mensagem(ns) expirada(s) ainda pendente(s)`, false);
  } catch {
    check('database_checks', false, 'não foi possível concluir verificações somente leitura no banco');
  } finally { await prisma.$disconnect(); }

  const prismaCli = path.join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');
  const migrateStatus = spawnSync(process.execPath, [prismaCli, 'migrate', 'status', '--schema', path.join(__dirname, '..', 'prisma', 'schema.prisma')], {
    cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 60_000,
  });
  check('prisma_migrate_status', migrateStatus.status === 0, migrateStatus.status === 0
    ? 'Prisma confirmou que o banco está sincronizado com o histórico local'
    : 'Prisma migrate status recusou a sincronização do banco; consulte o comando no deploy');

  const blockers = checks.filter(item => item.status === 'BLOCK');
  console.table(checks);
  console.log(blockers.length ? `PRONTIDAO BLOQUEADA: ${blockers.length} requisito(s).` : 'PRONTIDAO TECNICA E OPERACIONAL APROVADA.');
  process.exitCode = blockers.length ? 1 : 0;
}

main().catch(() => { console.error('Falha segura na avaliação de prontidão.'); process.exitCode = 1; });
