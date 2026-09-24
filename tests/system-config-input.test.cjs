const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSystemConfigMutation, publicSystemConfig } = require('../app/services/systemConfigService.ts');
const { isPrivateOrReservedIp, normalizeSmtpHost } = require('../app/utils/smtp-security.ts');

test('configuração global usa whitelist, versão e tipos estritos', () => {
  const parsed = parseSystemConfigMutation({ expectedVersion: null, manutencaoAtiva: true,
    adminPassword: 'x', justification: 'Mudança aprovada', confirmarAlteracaoManutencao: true });
  assert.equal(parsed.data.manutencaoAtiva, true);
  assert.equal(parsed.maintenanceConfirmed, true);
  assert.throws(() => parseSystemConfigMutation({ expectedVersion: null, modeloDpsJson: '{}', adminPassword: 'x', justification: 'válida' }), /Campos/);
  assert.throws(() => parseSystemConfigMutation({ expectedVersion: null, smtpPort: '587', adminPassword: 'x', justification: 'válida' }), /Porta/);
  assert.throws(() => parseSystemConfigMutation({ expectedVersion: undefined, adminPassword: 'x', justification: 'válida' }), /Versão/);
});

test('configuração SMTP normaliza host e bloqueia endereços privados/reservados', () => {
  assert.equal(normalizeSmtpHost('SMTP.Example.COM.'), 'smtp.example.com');
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('10.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('172.31.2.3'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.1'), true);
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.throws(() => normalizeSmtpHost('https://smtp.example.com'), /Host/);
});

test('leitura administrativa nunca devolve segredo SMTP ou campos internos', () => {
  const view = publicSystemConfig({ smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'u', smtpPass: 'v2:segredo',
    smtpSecure: false, emailRemetente: 'from@example.com', ibsCbsPilotoAtivo: true, ibsCbsMeiAtivo: false,
    ibsCbsSimplesAtivo: false, ibsCbsLucroPresumidoAtivo: true, manutencaoAtiva: false,
    manutencaoTitulo: null, manutencaoMensagem: null, manutencaoPrevisao: null, manutencaoAtualizadaEm: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'), version: 4, id: 'config', modeloDpsJson: '<segredo>', versaoApi: '1', ambiente: 'PRODUCAO' });
  assert.equal(view.smtpPass, '********');
  assert.equal(view.version, 4);
  assert.equal(Object.hasOwn(view, 'modeloDpsJson'), false);
  assert.doesNotMatch(JSON.stringify(view), /v2:segredo|<segredo>/);
});
