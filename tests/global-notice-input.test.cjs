const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  noticeAudiences,
  parseNoticeArchive,
  parseNoticeMutation,
  serializeNotice,
} = require('../app/services/globalNoticeService.ts');

function valid(overrides = {}) {
  return {
    expectedVersion: null,
    titulo: 'Manutenção programada',
    mensagem: 'O portal ficará indisponível por alguns minutos.',
    tipo: 'INFO',
    status: 'RASCUNHO',
    publico: 'TODOS',
    iniciaEm: null,
    terminaEm: null,
    linkLabel: null,
    linkHref: null,
    anexoNome: null,
    anexoBase64: null,
    removerAnexo: false,
    notificarApp: false,
    adminPassword: 'não validada nesta camada',
    justification: 'Comunicado aprovado pela operação',
    ...overrides,
  };
}

test('avisos globais usam DTO estrito, versão e transições explícitas', () => {
  const created = parseNoticeMutation(valid(), 'create');
  assert.equal(created.data.status, 'RASCUNHO');
  assert.equal(created.expectedVersion, null);
  assert.throws(() => parseNoticeMutation(valid({ role: 'MASTER' }), 'create'), /Campos não permitidos/);
  assert.throws(() => parseNoticeMutation(valid({ status: 'ARQUIVADO' }), 'create'), /situação inválidos/);
  assert.throws(() => parseNoticeMutation(valid({ id: 'notice', expectedVersion: null }), 'update'), /Versão/);
  assert.deepEqual(parseNoticeArchive({ id: 'notice-1', expectedVersion: 3,
    adminPassword: 'x', justification: 'Arquivamento aprovado' }).expectedVersion, 3);
});

test('avisos validam agendamento, links e anexos por conteúdo real', () => {
  const startsAt = new Date(Date.now() + 60_000).toISOString();
  const scheduled = parseNoticeMutation(valid({ status: 'AGENDADO', iniciaEm: startsAt }), 'create');
  assert.equal(scheduled.data.status, 'ATIVO');
  assert.equal(scheduled.data.iniciaEm.toISOString(), startsAt);
  assert.throws(() => parseNoticeMutation(valid({ status: 'AGENDADO' }), 'create'), /início futuro/);
  assert.throws(() => parseNoticeMutation(valid({ linkHref: 'http://example.com', linkLabel: 'Abrir' }), 'create'), /HTTPS/);
  assert.throws(() => parseNoticeMutation(valid({ linkHref: '/ajuda' }), 'create'), /texto do link/);
  assert.throws(() => parseNoticeMutation(valid({ linkLabel: 'Abrir' }), 'create'), /destino/);

  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const attachment = parseNoticeMutation(valid({ anexoNome: 'evidência.png',
    anexoBase64: `data:image/png;base64,${pngBytes.toString('base64')}` }), 'create');
  assert.equal(attachment.data.attachment.fileName, 'evid_ncia.png');
  assert.match(attachment.data.attachment.base64, /^data:image\/png;base64,/);
  assert.throws(() => parseNoticeMutation(valid({ anexoNome: 'falso.pdf',
    anexoBase64: `data:application/pdf;base64,${pngBytes.toString('base64')}` }), 'create'), /Anexo inválido/);
});

test('públicos são isolados por perfil e serialização não contém binário', () => {
  assert.deepEqual(noticeAudiences('COMUM'), ['TODOS', 'CLIENTES']);
  assert.deepEqual(noticeAudiences('CONTADOR'), ['TODOS', 'CONTADORES']);
  assert.deepEqual(noticeAudiences('ADMIN'), ['TODOS']);
  const serialized = serializeNotice({ id: 'n1', status: 'ATIVO', iniciaEm: new Date(Date.now() + 60_000),
    terminaEm: null, anexoNome: 'guia.pdf', titulo: 'Título' });
  assert.equal(serialized.runtimeStatus, 'AGENDADO');
  assert.equal(serialized.attachmentHref, '/api/avisos/n1/anexo');
  assert.equal(Object.hasOwn(serialized, 'anexoBase64'), false);
});
