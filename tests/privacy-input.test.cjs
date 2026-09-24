const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrivacyRequestInput, parsePrivacyResolutionInput } = require('../app/services/privacyService.ts');

test('privacidade: titular escolhe somente direitos previstos e confirma senha', () => {
  assert.deepEqual(parsePrivacyRequestInput({ type: 'acesso', description: '', password: 'Senha@123' }), {
    type: 'ACESSO', description: null, password: 'Senha@123',
  });
  for (const input of [
    { type: 'APAGAR_TUDO', password: 'Senha@123' },
    { type: 'ACESSO', password: '' },
    { type: 'ACESSO', password: 'Senha@123', admin: true },
    { type: 'CORRECAO', description: 'curta', password: 'Senha@123' },
  ]) assert.throws(() => parsePrivacyRequestInput(input), { status: 400 });
});

test('privacidade: resolução exige versão, resposta e fundamento na recusa', () => {
  const base = { id: '00000000-0000-4000-8000-000000000000', version: 1, password: 'admin', justification: 'Análise documentada para o titular' };
  assert.equal(parsePrivacyResolutionInput({ ...base, action: 'INICIAR' }).action, 'INICIAR');
  assert.equal(parsePrivacyResolutionInput({ ...base, action: 'CONCLUIR', resolutionSummary: 'Dados corrigidos conforme a solicitação confirmada.' }).action, 'CONCLUIR');
  assert.equal(parsePrivacyResolutionInput({ ...base, action: 'RECUSAR', resolutionSummary: 'Pedido não pode ser atendido integralmente.', legalBasis: 'Conservação necessária para obrigação legal aplicável.' }).action, 'RECUSAR');
  for (const input of [
    { ...base, action: 'RECUSAR', resolutionSummary: 'Resposta suficientemente detalhada.' },
    { ...base, action: 'CONCLUIR' },
    { ...base, action: 'ANONIMIZAR', resolutionSummary: 'curta' },
    { ...base, action: 'INICIAR', version: 0 },
    { ...base, action: 'CONCLUIR', resolutionSummary: 'Resposta suficientemente detalhada.', role: 'MASTER' },
  ]) assert.throws(() => parsePrivacyResolutionInput(input), { status: 400 });
});
