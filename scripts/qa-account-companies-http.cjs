// HTTP acceptance against the explicitly seeded local QA database/server only.
// Uses fresh authentication, never browser cookies or a production session.
const { PrismaClient } = require('@prisma/client');
const { randomUUID, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:3105';
const name = 'QA HTTP - NOVO CADASTRO - SEM VALOR FISCAL';

async function main() {
  const database = process.argv[2];
  const url = new URL(process.env.DATABASE_URL || '');
  assert.match(database || '', /^nfsegoo_qa_[0-9]{8}_[a-f0-9]{12}$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.notEqual(decodeURIComponent(url.pathname.slice(1)), database);
  assert.ok(process.env.NFSE_QA_PASSWORD && process.env.NFSE_QA_MFA_CODE, 'Informe as credenciais sintéticas em NFSE_QA_PASSWORD e NFSE_QA_MFA_CODE.');
  url.pathname = '/' + database;
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  let admin, owner, originalPrimary, createdId, originalRole;
  let cookie = ''; const results = [];
  const call = async (path, method = 'GET', body, expected = 200, extra = {}) => {
    const response = await fetch(base + path, { method, signal: AbortSignal.timeout(30000), headers: {
      Origin: base, Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const header of response.headers.getSetCookie()) if (header.startsWith('auth_token=')) cookie = header.split(';')[0];
    const json = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${json.error || response.status}`);
    assert.ok(response.headers.get('cache-control')?.includes('no-store'));
    results.push({ method, path, status: response.status }); return json;
  };
  try {
    admin = await prisma.user.findUniqueOrThrow({ where: { email: 'qa-admin-ui@example.invalid' } });
    owner = await prisma.user.findUniqueOrThrow({ where: { email: 'qa-report-ui@example.invalid' } });
    assert.equal(admin.nome, 'QA Administrador'); assert.equal(admin.role, 'ADMIN'); assert.equal(owner.role, 'COMUM');
    originalRole = admin.role; originalPrimary = owner.empresaId;
    const primary = await prisma.empresa.findUniqueOrThrow({ where: { id: originalPrimary } });
    assert.equal(primary.documento, '77666555000100'); assert.equal(primary.proprietarioUserId, owner.id);
    const second = await prisma.empresa.findUniqueOrThrow({ where: { documento: '88777666000100' } });
    assert.equal(second.proprietarioUserId, owner.id); assert.equal(second.razaoSocial, 'QA ADMIN - EMPRESA VAZIA - SEM VALOR FISCAL');
    const notesBefore = await prisma.notaFiscal.count({ where: { empresaId: primary.id } });
    const path = `/api/admin/users/${owner.id}/empresas`;
    // Inspect the server's own login challenge before transmitting the recovery code.
    await call(path, 'GET', undefined, 401);
    await call('/api/auth/login', 'POST', { login: admin.email, senha: process.env.NFSE_QA_PASSWORD }, 428);
    await call('/api/auth/login', 'POST', { login: admin.email, senha: process.env.NFSE_QA_PASSWORD, otpCode: process.env.NFSE_QA_MFA_CODE });
    let listing = await call(path); assert.equal(listing.account.id, owner.id);
    await call(path + '?limit=26', 'GET', undefined, 400);
    const auth = { adminPassword: process.env.NFSE_QA_PASSWORD, justification: 'Verificação HTTP local com dados sintéticos' };
    for (const [method, endpoint, body] of [
      ['PUT', '/api/admin/users', { id: owner.id, newCnpj: primary.documento, empresaId: second.id }],
      ['PUT', '/api/admin/users', { id: owner.id, unlinkCompany: true }],
      ['PATCH', `/api/admin/users/${owner.id}`, { addEmpresaProprietaria: { documento: second.documento } }],
      ['PATCH', `/api/admin/users/${owner.id}`, { removeEmpresaProprietariaId: second.id }],
      ['PUT', `/api/admin/users/${owner.id}`, { newCnpj: primary.documento, role: 'CONTADOR' }],
    ]) await call(endpoint, method, { ...body, ...auth }, 409);
    for (const role of ['COMUM', 'CONTADOR', 'SUPORTE', 'SUPORTE_TI', 'COMERCIAL']) {
      await prisma.user.update({ where: { id: admin.id }, data: { role } });
      try { await call(path, 'GET', undefined, 403); await call(path, 'POST', { action: 'SET_PRIMARY', empresaId: second.id, expectedUserUpdatedAt: listing.account.updatedAt, ...auth }, 403); }
      finally { await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } }); }
    }
    const selection = { action: 'SET_PRIMARY', empresaId: second.id, expectedUserUpdatedAt: listing.account.updatedAt, ...auth };
    await call(path, 'POST', selection, 403, { Origin: 'https://untrusted.example.invalid' });
    await call(path, 'POST', selection, 403, { Cookie: cookie + '; impersonation_token=synthetic-read-only-context' });
    await call(path, 'POST', { ...selection, adminPassword: '' }, 400);
    await call(path, 'POST', { ...selection, adminPassword: 'incorrect' }, 403);
    await call(path, 'POST', selection);
    await call(path, 'POST', selection, 409);
    listing = await call(path); assert.equal(listing.primary.id, second.id);
    await call(path, 'POST', { ...selection, empresaId: originalPrimary, expectedUserUpdatedAt: listing.account.updatedAt });
    let documento = 'QA' + randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
    for (let pass = 0; pass < 2; pass++) {
      let sum = 0, weight = 2;
      for (let index = documento.length - 1; index >= 0; index--) { sum += (documento.charCodeAt(index) - 48) * weight; weight = weight === 9 ? 2 : weight + 1; }
      const remainder = sum % 11; documento += String(remainder < 2 ? 0 : 11 - remainder);
    }
    const registration = { action: 'REGISTER_NEW', documento, razaoSocial: name, ...auth };
    const created = await call(path, 'POST', registration, 201); createdId = created.empresa.id;
    assert.equal(created.empresa.ambiente, 'HOMOLOGACAO'); assert.equal((await call(path, 'POST', registration)).created, false);
    await call(path, 'POST', { ...registration, proprietarioUserId: admin.id }, 400);
    const row = await prisma.empresa.findUniqueOrThrow({ where: { id: createdId } });
    assert.equal(row.certificadoA1, null); assert.equal(row.proprietarioUserId, owner.id); assert.equal(row.contadorCustodianteId, null);
    assert.equal(await prisma.notaFiscal.count({ where: { empresaId: primary.id } }), notesBefore);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).empresaId, originalPrimary);
    assert.equal((await prisma.empresa.findUniqueOrThrow({ where: { id: primary.id } })).documento, primary.documento);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role, 'COMUM');
    await call(`/api/admin/users/${owner.id}`, 'PUT', { nome: owner.nome, email: owner.email.toUpperCase(), ...auth }, 409);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).email, owner.email);
    console.log(JSON.stringify({ checks: results.length, results, historicalNotesPreserved: notesBefore, externalFiscalCalls: 0 }));
  } finally {
    if (admin && originalRole) await prisma.user.update({ where: { id: admin.id }, data: { role: originalRole } });
    if (owner && originalPrimary) {
      const original = await prisma.empresa.findUniqueOrThrow({ where: { id: originalPrimary } });
      assert.equal(original.proprietarioUserId, owner.id); assert.equal(original.documento, '77666555000100');
      await prisma.user.update({ where: { id: owner.id }, data: { empresaId: originalPrimary } });
    }
    if (createdId) {
      const row = await prisma.empresa.findUniqueOrThrow({ where: { id: createdId } });
      assert.equal(row.razaoSocial, name); assert.equal(row.proprietarioUserId, owner.id);
      assert.equal(await prisma.notaFiscal.count({ where: { empresaId: row.id } }), 0);
      assert.equal(await prisma.emissaoJob.count({ where: { empresaId: row.id } }), 0);
      assert.equal(await prisma.venda.count({ where: { empresaId: row.id } }), 0);
      await prisma.$transaction(async tx => { await tx.systemLog.deleteMany({ where: { empresaId: row.id } }); await tx.empresa.delete({ where: { id: row.id } }); });
    }
    if (admin) await prisma.rateLimitBucket.deleteMany({ where: { keyHash: createHash('sha256').update(`admin_reauth_${admin.id}`).digest('hex') } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error('QA HTTP falhou:', error.message); process.exitCode = 1; });
