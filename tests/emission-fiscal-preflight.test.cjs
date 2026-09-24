const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function fiscalDb(municipalRule) {
  return {
    cnae: { findFirst: async () => null },
    globalCnae: { findFirst: async () => null },
    tributacaoMunicipal: {
      findFirst: async () => municipalRule,
      findMany: async () => municipalRule ? [municipalRule] : [],
    },
    configuracaoSistema: { findUnique: async () => null },
  };
}

function context(codigoTributacaoMunicipal) {
  const rule = {
    id: 'regra-municipal-fixture',
    cnae: '6201501',
    codigoIbge: '3550308',
    ativo: true,
    inicioVigencia: null,
    fimVigencia: null,
    exigeCodigoTributacaoMunicipal: true,
    codigoTributacaoMunicipal,
    exigeNbs: false,
    prioridade: 1,
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };
  return {
    rule,
    params: {
      payload: {
        codigoCnae: '6201501',
        dataCompetencia: '2025-01-15',
      },
      prestador: {
        id: 'empresa-fixture',
        codigoIbge: '3550308',
        regimeTributario: 'SIMPLES',
        ambiente: 'HOMOLOGACAO',
        aliquotaPadrao: 2,
      },
      tomador: { tipo: 'PJ', pais: 'Brasil' },
      valorFloat: 100,
    },
    db: fiscalDb(rule),
  };
}

test('preflight fiscal recusa CTM obrigatorio ausente usando a mesma decisao do worker', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context(null);

  await assert.rejects(
    resolveEmissionFiscalContext(fixture.params, fixture.db),
    error => error.status === 400
      && error.code === 'CODIGO_MUNICIPAL_OBRIGATORIO'
      && Array.isArray(error.fiscalIssues),
  );
});

test('payload nao preenche CTM ausente de uma regra municipal obrigatoria', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context(null);
  fixture.params.payload.codigoTributacaoMunicipal = '9999';

  await assert.rejects(
    resolveEmissionFiscalContext(fixture.params, fixture.db),
    error => error.status === 400 && error.code === 'CODIGO_MUNICIPAL_OBRIGATORIO',
  );
});

test('payload divergente nao substitui o CTM da regra municipal vigente', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context('1234');
  fixture.params.payload.codigoTributacaoMunicipal = '9999';

  await assert.rejects(
    resolveEmissionFiscalContext(fixture.params, fixture.db),
    error => error.status === 400
      && error.code === 'CODIGO_MUNICIPAL_DIVERGENTE'
      && /regra municipal/i.test(error.userAction),
  );
});

test('payload igual ao CTM oficial confirma a regra sem criar divergencia', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context('1234');
  fixture.params.payload.codigoTributacaoMunicipal = '12.34';

  const result = await resolveEmissionFiscalContext(fixture.params, fixture.db);
  assert.equal(result.codigoTributacaoMunicipal, '1234');
  assert.ok(!result.fiscalDecision.issues.some(issue => issue.code === 'CODIGO_MUNICIPAL_DIVERGENTE'));
});

test('preflight fiscal aceita a regra quando o CTM obrigatorio esta resolvido', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context('1234');
  const result = await resolveEmissionFiscalContext(fixture.params, fixture.db);

  assert.equal(result.codigoTributacaoMunicipal, '1234');
  assert.equal(result.fiscalDecision.ruleIds.municipal, 'regra-municipal-fixture');
});

test('payload legado de CTM permanece compativel somente quando nao existe regra municipal', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context(null);
  fixture.params.payload.codigoTributacaoMunicipal = '7777';
  fixture.db = fiscalDb(null);

  const result = await resolveEmissionFiscalContext(fixture.params, fixture.db);
  assert.equal(result.codigoTributacaoMunicipal, '7777');
  assert.ok(result.fiscalDecision.source.includes('CTM:PAYLOAD_SEM_REGRA_MUNICIPAL'));
  assert.ok(result.fiscalDecision.issues.some(issue => issue.code === 'REGRA_MUNICIPAL_AUSENTE' && issue.severity === 'WARN'));
});

test('homologacao permite pilotar combinacao ainda sem regra municipal', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context(null);
  fixture.db = fiscalDb(null);

  const result = await resolveEmissionFiscalContext(fixture.params, fixture.db);
  assert.ok(result.fiscalDecision.issues.some(issue => issue.code === 'REGRA_MUNICIPAL_AUSENTE' && issue.severity === 'WARN'));
});

test('homologacao tambem permite pilotar Lucro Presumido sem regra municipal', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context(null);
  fixture.params.prestador.regimeTributario = 'LUCRO_PRESUMIDO';
  fixture.db = fiscalDb(null);

  const result = await resolveEmissionFiscalContext(fixture.params, fixture.db);
  assert.ok(result.fiscalDecision.issues.some(issue => issue.code === 'REGRA_MUNICIPAL_AUSENTE' && issue.severity === 'WARN'));
  assert.ok(!result.fiscalDecision.issues.some(issue => issue.code === 'REGRA_MUNICIPAL_NAO_HOMOLOGADA'));
});

test('producao bloqueia Simples sem regra municipal vigente antes de persistir a emissao', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context(null);
  fixture.params.prestador.ambiente = 'PRODUCAO';
  fixture.db = fiscalDb(null);

  await assert.rejects(
    resolveEmissionFiscalContext(fixture.params, fixture.db),
    error => error.status === 400
      && error.code === 'REGRA_MUNICIPAL_NAO_HOMOLOGADA'
      && /homologacao/i.test(error.userAction),
  );
});

test('producao bloqueia Lucro Presumido sem regra municipal vigente', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context(null);
  fixture.params.prestador.ambiente = 'PRODUCAO';
  fixture.params.prestador.regimeTributario = 'LUCRO_PRESUMIDO';
  fixture.db = fiscalDb(null);

  await assert.rejects(
    resolveEmissionFiscalContext(fixture.params, fixture.db),
    error => Array.isArray(error.fiscalIssues)
      && error.fiscalIssues.some(issue => issue.code === 'REGRA_MUNICIPAL_NAO_HOMOLOGADA'),
  );
});

for (const [scenario, change] of [
  ['inativa', rule => { rule.ativo = false; }],
  ['ainda nao vigente', rule => { rule.inicioVigencia = new Date('2025-01-16T00:00:00.000Z'); }],
  ['com vigencia encerrada', rule => { rule.fimVigencia = new Date('2025-01-14T23:59:59.000Z'); }],
]) {
  test(`producao trata regra municipal ${scenario} como indisponivel`, async () => {
    const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
    const fixture = context('1234');
    fixture.params.prestador.ambiente = 'PRODUCAO';
    change(fixture.rule);

    await assert.rejects(
      resolveEmissionFiscalContext(fixture.params, fixture.db),
      error => error.code === 'REGRA_MUNICIPAL_NAO_HOMOLOGADA',
    );
  });
}

test('producao permite dispensa explicita de CTM em regra municipal vigente', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context(null);
  fixture.params.prestador.ambiente = 'PRODUCAO';
  fixture.rule.exigeCodigoTributacaoMunicipal = false;

  const result = await resolveEmissionFiscalContext(fixture.params, fixture.db);
  assert.equal(result.codigoTributacaoMunicipal, undefined);
  assert.equal(result.fiscalDecision.ruleIds.municipal, 'regra-municipal-fixture');
  assert.ok(!result.fiscalDecision.issues.some(issue => issue.severity === 'ERROR'));
});

test('regra municipal com NBS obrigatorio bloqueia quando o codigo nao foi resolvido', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context('1234');
  fixture.rule.exigeNbs = true;

  await assert.rejects(
    resolveEmissionFiscalContext(fixture.params, fixture.db),
    error => error.code === 'NBS_OBRIGATORIO',
  );
});

test('regra municipal com NBS obrigatorio aceita codigo valido do cadastro', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context('1234');
  fixture.rule.exigeNbs = true;
  fixture.rule.nbsPadrao = '123456789';

  const result = await resolveEmissionFiscalContext(fixture.params, fixture.db);
  assert.equal(result.codigoNbs, '123456789');
  assert.ok(!result.fiscalDecision.issues.some(issue => issue.code === 'NBS_OBRIGATORIO'));
});

test('MEI em producao permanece dispensado do gate de pilotagem municipal', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context(null);
  fixture.params.prestador.ambiente = 'PRODUCAO';
  fixture.params.prestador.regimeTributario = 'MEI';
  fixture.db = fiscalDb(null);

  const result = await resolveEmissionFiscalContext(fixture.params, fixture.db);
  assert.ok(result.fiscalDecision.issues.some(issue => issue.code === 'REGRA_MUNICIPAL_AUSENTE' && issue.severity === 'WARN'));
  assert.ok(!result.fiscalDecision.issues.some(issue => issue.severity === 'ERROR'));
});

test('MEI ignora CTM recebido no payload e o CTM da regra', async () => {
  const { resolveEmissionFiscalContext } = require('../app/services/emissaoJobService.ts');
  const fixture = context('1234');
  fixture.params.prestador.ambiente = 'PRODUCAO';
  fixture.params.prestador.regimeTributario = 'MEI';
  fixture.params.payload.codigoTributacaoMunicipal = '9999';

  const result = await resolveEmissionFiscalContext(fixture.params, fixture.db);
  assert.equal(result.codigoTributacaoMunicipal, undefined);
  assert.ok(result.fiscalDecision.source.includes('CTM:DISPENSADO_MEI'));
  assert.ok(!result.fiscalDecision.issues.some(issue => issue.code === 'CODIGO_MUNICIPAL_DIVERGENTE'));
});

test('nova emissao executa o preflight antes de credito, venda e job', () => {
  const source = fs.readFileSync(path.join(root, 'app/services/emissaoJobService.ts'), 'utf8');
  const transactionStart = source.indexOf('return commercialTransaction');
  const workerStart = source.indexOf('export async function prepararEmissaoJob');
  const transaction = source.slice(transactionStart, workerStart);
  const preflight = transaction.lastIndexOf('await resolveEmissionFiscalContext');

  assert.ok(preflight > 0, 'preflight nao encontrado na transacao comercial');
  for (const mutation of [
    'reserveEmissionCreditInTransaction',
    'tx.venda.update',
    'tx.venda.create',
    'tx.emissaoJob.create',
  ]) {
    assert.ok(transaction.indexOf(mutation) > preflight, `${mutation} ocorre antes do preflight`);
  }
  assert.ok(source.slice(workerStart).includes('await resolveEmissionFiscalContext'), 'worker deixou de repetir a validacao fiscal');
});
