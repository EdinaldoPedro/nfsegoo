const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

function updatePayload(incident, overrides = {}) {
  return {
    id: incident.id, version: incident.version, status: 'EM_AVALIACAO', severity: incident.severity,
    affectedData: 'Dados cadastrais em avaliação controlada.', affectedSystems: 'Ambiente sintético de QA.', affectedSubjectsEstimate: 1,
    riskToSubjects: 'DESCONHECIDO', riskAssessment: null, containmentActions: null, decisionRationale: null,
    containedAt: null, notifiedAnpdAt: null, notifiedSubjectsAt: null, ...overrides,
  };
}

test('PostgreSQL: incidente de segurança preserva prazo, CAS, progressão e encerramento', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async () => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { createSecurityIncident, updateSecurityIncident } = require('../../app/services/securityIncidentService.ts');
  let actor, incident;
  try {
    actor = await prisma.user.create({ data: {
      email: `qa-incident-${randomUUID()}@example.invalid`, nome: 'Responsável incidente QA', role: 'ADMIN', senha: await bcrypt.hash('Incidente@123', 4),
    } });
    const detectedAt = new Date('2026-09-04T15:00:00.000Z');
    incident = await createSecurityIncident(actor.id, {
      title: 'Exposição sintética sob investigação', category: 'EXPOSICAO', severity: 'ALTA',
      summary: 'Ocorrência exclusivamente sintética criada para validar o registro e a trilha de auditoria.',
      affectedData: 'Dados cadastrais sintéticos.', affectedSystems: 'Banco isolado de QA.', affectedSubjectsEstimate: 1, detectedAt: detectedAt.toISOString(),
    });
    assert.match(incident.protocol, /^INC-20260904-[A-F0-9]{10}$/);
    assert.equal(incident.regulatoryDeadlineAt.toISOString(), '2026-09-09T15:00:00.000Z');
    assert.equal(incident.retainUntil.toISOString(), '2031-09-04T15:00:00.000Z');

    const attempts = await Promise.allSettled([
      updateSecurityIncident(actor.id, updatePayload(incident, { severity: 'MEDIA' })),
      updateSecurityIncident(actor.id, updatePayload(incident, { severity: 'CRITICA' })),
    ]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = attempts.find(result => result.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    incident = await prisma.securityIncident.findUniqueOrThrow({ where: { id: incident.id } });
    assert.equal(incident.version, 2);

    await assert.rejects(updateSecurityIncident(actor.id, updatePayload(incident, { status: 'DETECTADO' })), { status: 409 });
    await assert.rejects(updateSecurityIncident(actor.id, updatePayload(incident, {
      status: 'ENCERRADO', riskToSubjects: 'RELEVANTE', riskAssessment: 'A avaliação confirmou risco relevante aos titulares afetados.',
      containmentActions: 'Acesso revogado e credenciais sintéticas rotacionadas imediatamente.',
      decisionRationale: 'Comunicação necessária devido ao risco relevante confirmado pela apuração.',
    })), { status: 400 });

    incident = await updateSecurityIncident(actor.id, updatePayload(incident, {
      status: 'ENCERRADO', riskToSubjects: 'IMPROVAVEL', riskAssessment: 'A investigação técnica descartou acesso aos dados em produção.',
      containmentActions: 'Credenciais sintéticas revogadas e origem isolada durante a análise.',
      decisionRationale: 'Sem acesso a dados reais e sem risco relevante após validação dos registros.',
    }));
    assert.equal(incident.status, 'ENCERRADO'); assert.equal(incident.version, 3); assert.ok(incident.resolvedAt);
    await assert.rejects(updateSecurityIncident(actor.id, updatePayload(incident, { status: 'ENCERRADO' })), { status: 409 });
    assert.equal(await prisma.systemLog.count({ where: { userId: actor.id, action: { startsWith: 'SECURITY_INCIDENT_' } } }), 3);
  } finally {
    if (actor) {
      await prisma.systemLog.deleteMany({ where: { userId: actor.id } });
      await prisma.securityIncident.deleteMany({ where: { OR: [{ createdById: actor.id }, { updatedById: actor.id }] } });
      await prisma.user.deleteMany({ where: { id: actor.id } });
    }
  }
});
