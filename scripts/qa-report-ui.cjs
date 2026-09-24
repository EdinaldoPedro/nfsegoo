// Reproducible local UI fixture. Never uses/migrates the original database.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');
const email = 'qa-report-ui@example.invalid';
const document = '77666555000100';
const companyName = 'QA UI - EMPRESA SINTETICA - SEM VALOR FISCAL';
async function main() {
  const [mode, database] = process.argv.slice(2);
  const source = new URL(process.env.DATABASE_URL || '');
  if (!['seed', 'serve', 'clean'].includes(mode) || !/^nfsegoo_qa_[0-9]{8}_[a-f0-9]{12}$/.test(database || '') ||
    !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname) || decodeURIComponent(source.pathname.slice(1)) === database) throw new Error('Alvo de QA inválido.');
  source.pathname = '/' + database;
  const prisma = new PrismaClient({ datasources: { db: { url: source.toString() } }, log: [] });
  try {
    if (mode === 'serve') {
      await prisma.$queryRaw`SELECT 1`;
      const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3105'], {
        cwd: path.resolve(__dirname, '..'), windowsHide: true, stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: source.toString(), NEXT_PUBLIC_APP_URL: 'http://localhost:3105', FISCAL_WORKER_ALLOW_PRODUCTION: 'false', NEXT_TELEMETRY_DISABLED: '1' },
      });
      process.on('SIGINT', () => child.kill('SIGINT')); process.on('SIGTERM', () => child.kill('SIGTERM'));
      await new Promise(resolve => child.on('exit', code => { process.exitCode = code || 0; resolve(); }));
      return;
    }
    if (mode === 'clean') {
      const user = await prisma.user.findUnique({ where: { email } });
      const company = await prisma.empresa.findUnique({ where: { documento: document } });
      if (!user && !company) { console.log('Fixture já ausente.'); return; }
      if (!user || !company || company.proprietarioUserId !== user.id || company.razaoSocial !== companyName) throw new Error('Fixture não confere; limpeza recusada.');
      await prisma.$transaction(async tx => {
        await tx.emissionDocumentTask.deleteMany({ where: { nota: { empresaId: company.id } } });
        await tx.emissaoJob.deleteMany({ where: { empresaId: company.id } });
        await tx.appNotification.deleteMany({ where: { empresaId: company.id } });
        await tx.systemLog.deleteMany({ where: { OR: [{ empresaId: company.id }, { userId: user.id }] } });
        await tx.notaFiscal.deleteMany({ where: { empresaId: company.id } });
        await tx.venda.deleteMany({ where: { empresaId: company.id } });
        await tx.vinculoCarteira.deleteMany({ where: { empresaId: company.id } });
        await tx.cliente.deleteMany({ where: { empresaId: company.id } });
        await tx.dpsSequencia.deleteMany({ where: { empresaId: company.id } });
        await tx.user.update({ where: { id: user.id }, data: { empresaId: null } });
        await tx.empresa.delete({ where: { id: company.id } });
        await tx.user.delete({ where: { id: user.id } });
      });
      console.log('Conta e documentos sintéticos de UI removidos somente do QA.'); return;
    }
    if (await prisma.user.count()) throw new Error('O banco precisa estar sem contas antes desta fixture. Não sobrescreva dados.');
    const password = randomBytes(18).toString('base64url');
    const user = await prisma.user.create({ data: { email, senha: await bcrypt.hash(password, 12), nome: 'QA UI', role: 'COMUM' } });
    const company = await prisma.empresa.create({ data: { documento: document, razaoSocial: companyName, proprietarioUserId: user.id, donoFaturamentoId: user.id,
      ambiente: 'HOMOLOGACAO', regimeTributario: 'MEI', codigoIbge: '3550308', cidade: 'São Paulo', uf: 'SP', cadastroCompleto: true,
      cep: '01001000', logradouro: 'Rua de QA', numero: '10', bairro: 'Centro', email: 'empresa-qa@example.invalid',
      atividades: { create: { codigo: '6201501', descricao: 'Desenvolvimento de software - QA', principal: true } } } });
    await prisma.user.update({ where: { id: user.id }, data: { empresaId: company.id } });
    const customer = await prisma.cliente.create({ data: { empresaId: company.id, nome: 'Tomador sintético de teste', documento: '12345678909', tipo: 'PF',
      cep: '01001000', logradouro: 'Rua de teste', numero: '10', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', codigoIbge: '3550308', vinculos: { create: {} } } });
    for (let i = 0; i < 27; i++) {
      const ambiente = i < 23 ? 'PRODUCAO' : i < 25 ? 'HOMOLOGACAO' : null;
      const status = i === 22 ? 'CANCELADA' : 'AUTORIZADA';
      const sale = await prisma.venda.create({ data: { empresaId: company.id, clienteId: customer.id, descricao: 'Servico sintético de QA', valor: '123.45', status: status === 'CANCELADA' ? 'CANCELADA' : ambiente === 'HOMOLOGACAO' ? 'HOMOLOGACAO_VALIDADA' : 'CONCLUIDA' } });
      const note = await prisma.notaFiscal.create({ data: { empresaId: company.id, clienteId: customer.id, vendaId: sale.id, numeroOficial: String(1234567890000 + i), ambiente, status,
        valor: '123.45', descricao: sale.descricao, prestadorCnpj: document, tomadorCnpj: customer.documento, tomadorNome: i % 3 ? customer.nome : null,
        metadadosVerificadosEm: i % 3 ? new Date() : null, codigoServico: '010101', dataEmissao: new Date(),
        xmlBase64: Buffer.from('<NFSe>QA UI SYNTHETIC - NOT AN OFFICIAL DOCUMENT</NFSe>').toString('base64') } });
      if (ambiente === 'HOMOLOGACAO') await prisma.emissaoJob.create({ data: { empresaId: company.id, clienteId: customer.id, vendaId: sale.id, actorUserId: user.id, billingUserId: user.id,
        ambiente, status: 'AUTORIZADA', acknowledgedAt: new Date(), resultNotaId: note.id, serieDPS: '900', idempotencyKey: 'qa-ui-' + i,
        payloadJson: JSON.stringify({ clienteId: customer.id, codigoCnae: '6201501', descricao: sale.descricao, valor: '123.45' }) } });
    }
    console.log(JSON.stringify({ database, login: email, password, url: 'http://localhost:3105/login', fixture: 'synthetic-only' }));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
