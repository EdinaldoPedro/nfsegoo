const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');

test('identidade fiscal PostgreSQL: CNPJ global, relações privadas e histórico imutável', { skip: process.env.ALLOW_TEST_DATABASE_WRITES !== 'true' }, async () => {
  require('./require-test-database.cjs')();
  const { prisma } = require('../../app/utils/prisma.ts');
  const { ensureCanonicalFiscalEntity } = require('../../app/services/fiscalEntityService.ts');
  const { findTenantCustomer } = require('../../app/services/tenantCustomerService.ts');
  const { mutateAdminFiscalEntity, listAdminFiscalEntities } = require('../../app/services/adminFiscalEntityService.ts');
  const { criarEmissaoJob } = require('../../app/services/emissaoJobService.ts');
  const prefix = 'qa-fiscal-entity-' + randomUUID(); const password = 'synthetic-' + randomUUID();
  let admin; const companies = []; const customers = []; let entity; let note; let job; let sale;
  const cnpj = '11222333000181';
  try {
    admin = await prisma.user.create({ data: { email: `${prefix}@example.invalid`, nome: 'Admin QA', senha: await bcrypt.hash(password, 4), role: 'ADMIN' } });
    for (let index = 0; index < 2; index++) companies.push(await prisma.empresa.create({ data: { documento: `${prefix}-${index}`, razaoSocial: `Prestador ${index}`,
      ambiente: 'HOMOLOGACAO', proprietarioUserId: admin.id, donoFaturamentoId: admin.id, regimeTributario: 'MEI',
      certificadoA1: 'QA-CERTIFICATE-NOT-REAL', senhaCertificado: 'QA-ENCRYPTED-PASSWORD' } }));
    const fallback = { nome: 'Tomador Canônico QA', nomeFantasia: 'Canônico', cep: '01001000', logradouro: 'Praça da Sé', numero: '1',
      bairro: 'Sé', cidade: 'São Paulo', uf: 'SP', codigoIbge: '3550308' };
    const results = await Promise.all(Array.from({ length: 5 }, () => prisma.$transaction(tx => ensureCanonicalFiscalEntity(tx, cnpj, fallback, null, admin.id))));
    assert.equal(new Set(results.map(row => row.id)).size, 1); entity = results[0];
    for (let index = 0; index < 2; index++) customers.push(await prisma.cliente.create({ data: { empresaId: companies[index].id,
      entidadeFiscalId: entity.id, tipo: 'PJ', documento: cnpj, nome: `Nome legado ${index}`, email: `privado-${index}@example.invalid`,
      telefone: `1199999999${index}`, inscricaoMunicipal: `IM-${index}`, cep: '99999999', logradouro: 'Legado', numero: '9', bairro: 'Legado',
      cidade: 'Legado', uf: 'RJ', codigoIbge: '3304557', vinculos: { create: {} } } }));

    const first = await findTenantCustomer(customers[0].id, companies[0].id); const second = await findTenantCustomer(customers[1].id, companies[1].id);
    assert.equal(first.nome, 'Tomador Canônico QA'); assert.equal(second.nome, first.nome);
    assert.notEqual(first.email, second.email); assert.notEqual(first.inscricaoMunicipal, second.inscricaoMunicipal);
    assert.equal(await findTenantCustomer(customers[0].id, companies[1].id), null);

    const correction = { id: entity.id, expectedVersion: entity.version, action: 'CORRECT', data: { codigoIbge: '3550309', cidade: 'São Paulo corrigida' },
      adminPassword: password, justification: 'Correção sintética global autorizada em QA' };
    const saved = await mutateAdminFiscalEntity(admin.id, correction);
    const correctedFirst = await findTenantCustomer(customers[0].id, companies[0].id); const correctedSecond = await findTenantCustomer(customers[1].id, companies[1].id);
    assert.equal(correctedFirst.codigoIbge, '3550309'); assert.equal(correctedSecond.codigoIbge, '3550309');
    assert.equal(correctedFirst.email, 'privado-0@example.invalid'); assert.equal(correctedSecond.inscricaoMunicipal, 'IM-1');

    const refreshed = await prisma.$transaction(tx => ensureCanonicalFiscalEntity(tx, cnpj, fallback, {
      data: { documento: cnpj, razaoSocial: 'Tomador atualizado pela fonte', nomeFantasia: 'Fonte nova',
        situacaoCadastral: 'ATIVA', emailPublico: null, telefonePublico: null, cep: '01001000',
        logradouro: 'Praça da Sé', numero: '2', complemento: null, bairro: 'Sé', cidade: 'São Paulo',
        uf: 'SP', pais: 'Brasil', codigoIbge: '3550308' },
      atividades: [], fonte: 'BRASILAPI', payloadHash: 'b'.repeat(64), consultedAt: new Date(),
    }, admin.id));
    assert.equal(refreshed.correcoes.length, 0);
    const latestWins = await findTenantCustomer(customers[0].id, companies[0].id);
    assert.equal(latestWins.nome, 'Tomador atualizado pela fonte');
    assert.equal(latestWins.numero, '2'); assert.equal(latestWins.codigoIbge, '3550308');

    const queued = await criarEmissaoJob({ userId: admin.id, contextId: companies[0].id, idempotencyKey: randomUUID(), body: {
      empresaConfirmadaId: companies[0].id, ambienteConfirmado: 'HOMOLOGACAO', clienteId: customers[0].id,
      valor: '10.00', descricao: 'Snapshot de tomador QA', codigoCnae: '6201501',
    } });
    job = queued.job; sale = queued.venda;
    const queuedPayload = JSON.parse(job.payloadJson);
    assert.equal(queuedPayload._tomadorSnapshot.nome, 'Tomador Canônico QA');
    assert.equal(queuedPayload._tomadorSnapshot.email, 'privado-0@example.invalid');

    note = await prisma.notaFiscal.create({ data: { empresaId: companies[0].id, clienteId: customers[0].id, valor: 10, descricao: 'Snapshot QA',
      status: 'AUTORIZADA', ambiente: 'HOMOLOGACAO', prestadorCnpj: companies[0].documento, tomadorCnpj: cnpj,
      tomadorNome: latestWins.nome, xmlAutorizadoBase64: Buffer.from('<xml>snapshot</xml>').toString('base64') } });
    await mutateAdminFiscalEntity(admin.id, { ...correction, expectedVersion: refreshed.version, data: { razaoSocial: 'Novo nome global QA' } });
    const frozen = await prisma.notaFiscal.findUniqueOrThrow({ where: { id: note.id } });
    assert.equal(frozen.tomadorNome, 'Tomador atualizado pela fonte'); assert.equal(frozen.xmlAutorizadoBase64, note.xmlAutorizadoBase64);
    assert.equal(JSON.parse((await prisma.emissaoJob.findUniqueOrThrow({ where: { id: job.id } })).payloadJson)._tomadorSnapshot.nome, 'Tomador Canônico QA');

    const list = await listAdminFiscalEntities(new URLSearchParams({ search: cnpj })); const serialized = JSON.stringify(list);
    assert.equal(list.meta.total, 1); assert.equal(list.data[0].relacionamentos, 2);
    for (const secret of ['privado-0@example.invalid', 'privado-1@example.invalid', 'IM-0', 'IM-1']) assert.equal(serialized.includes(secret), false);
  } finally {
    if (note) await prisma.notaFiscal.deleteMany({ where: { id: note.id } });
    if (job) await prisma.emissaoJob.deleteMany({ where: { id: job.id } });
    if (sale) await prisma.venda.deleteMany({ where: { id: sale.id } });
    if (customers.length) await prisma.cliente.deleteMany({ where: { id: { in: customers.map(row => row.id) } } });
    if (companies.length) await prisma.empresa.deleteMany({ where: { id: { in: companies.map(row => row.id) } } });
    if (entity) await prisma.entidadeFiscal.deleteMany({ where: { id: entity.id } });
    if (admin) { await prisma.systemLog.deleteMany({ where: { userId: admin.id } }); await prisma.user.deleteMany({ where: { id: admin.id } }); }
  }
});
