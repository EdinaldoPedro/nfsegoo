const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cancellationReason, prepareCancellationRequest, validateCancellationEvent } = require('../app/services/emissor/validation/CancellationEvent.ts');
const { signFiscalXml } = require('../app/services/emissor/validation/FiscalSignature.ts');
const { validateFiscalSchema } = require('../app/services/emissor/validation/FiscalSchema.ts');
const { signingCredentials, ns, key } = require('./fixtures/fiscal.cjs');
const input = { key, ambiente: 'PRODUCAO', authorDocument: '11222333000181', reason: { code: '1', justification: 'Erro identificado na descricao do servico' }, timestamp: new Date('2026-09-02T13:00:00Z') };
async function request(overrides = {}) { return prepareCancellationRequest({ ...input, ...overrides }, signingCredentials()); }
function event(requestXml, type = '101101') {
  return signFiscalXml(`<evento xmlns="${ns}" versao="1.01"><infEvento Id="EVT${key}${type}001"><verAplic>Portal-QA</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento><dhProc>2026-09-02T13:01:00+00:00</dhProc><nDFSe>456</nDFSe>${requestXml}</infEvento></evento>`, 'evento', signingCredentials());
}

test('cancelamento: motivos oficiais 1/2/9 e justificativa real limitada, sem texto inventado', () => {
  for (const code of ['1', '2', '9']) assert.equal(cancellationReason(code, input.reason.justification).code, code);
  for (const code of ['3', '4', '', null, 'outros']) assert.throws(() => cancellationReason(code, input.reason.justification));
  for (const reason of ['', 'curto', 'x'.repeat(256), 'Texto do motivo\ncom controle', 'Motivo com emoji 😃']) assert.throws(() => cancellationReason('1', reason));
});

test('cancelamento: pedido assinado preserva justificativa e escapa injecao XML', async () => {
  const justification = 'Erro: valor < 10 & nome "A"; revisar';
  const xml = await request({ reason: { code: '9', justification } });
  assert.ok(xml.includes('&lt;')); assert.ok(xml.includes('&amp;'));
  assert.ok(xml.includes('<cMotivo>9</cMotivo>'));
  assert.ok(!xml.includes('Solicitação do contribuinte'));
  const alpha = await request({ authorDocument: '12ABC34501DE35' });
  assert.ok(alpha.includes('<CNPJAutor>12ABC34501DE35</CNPJAutor>'));
  await validateFiscalSchema(alpha, 'pedRegEvento');
});

test('cancelamento: exige evento oficial vinculado ao pedido; pedido ecoado e E0840 nao bastam', async () => {
  const preparedRequest = await request();
  const expected = { key, ambiente: 'PRODUCAO', preparedRequest };
  const result = await validateCancellationEvent(event(preparedRequest), expected);
  assert.equal(result.dataCancelamento.toISOString(), '2026-09-02T13:01:00.000Z');
  assert.equal(result.protocolo, '456');
  for (const value of [preparedRequest, '<retorno>cancelada</retorno>', JSON.stringify({ erros: [{ Codigo: 'E0840' }] }), event(preparedRequest).replace('13:01:00', '13:02:00')]) await assert.rejects(validateCancellationEvent(value, expected));
  await assert.rejects(validateCancellationEvent(event(preparedRequest), { ...expected, key: '2'.repeat(50) }));
  await assert.rejects(validateCancellationEvent(event(preparedRequest), { ...expected, ambiente: 'HOMOLOGACAO' }));
});

test('cancelamento: evento autentico de outro pedido nao liquida a solicitacao local', async () => {
  const first = await request();
  const other = await request({ reason: { code: '2', justification: 'Servico contratado nao foi prestado' } });
  await assert.rejects(validateCancellationEvent(event(other), { key, ambiente: 'PRODUCAO', preparedRequest: first }), /não corresponde/);
  assert.equal((await validateCancellationEvent(event(other), { key, ambiente: 'PRODUCAO' })).type, '101101');
});

test('cancelamento: assinatura do prestador sem assinatura do portal nao comprova evento', async () => {
  const prepared = await request();
  const valid = event(prepared);
  const outerStart = valid.lastIndexOf('<Signature');
  await assert.rejects(validateCancellationEvent(valid.slice(0, outerStart) + '</evento>', { key, ambiente: 'PRODUCAO' }));
});

test('cancelamento: solicitacao de analise e indeferimento oficiais nao sao cancelamento', async () => {
  for (const [type, description, extra] of [
    ['101103', 'Solicitação de Análise Fiscal para Cancelamento de NFS-e', ''],
    ['105105', 'Cancelamento de NFS-e Indeferido por Análise Fiscal', '<CPFAgTrib>12345678909</CPFAgTrib>'],
  ]) {
    const unsigned = (await request()).replace(/<Signature[\s\S]*<\/Signature>/, '').replaceAll('101101', type)
      .replace('<xDesc>Cancelamento de NFS-e</xDesc>', `<xDesc>${description}</xDesc>${extra}`);
    const requestXml = signFiscalXml(unsigned, 'pedRegEvento', signingCredentials());
    const xml = event(requestXml, type);
    await validateFiscalSchema(xml, 'evento');
    await assert.rejects(validateCancellationEvent(xml, { key, ambiente: 'PRODUCAO' }), /não comprova cancelamento/);
  }
});
