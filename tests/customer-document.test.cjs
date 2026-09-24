const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inferCustomerDocumentType, normalizeCustomerDocument } = require('../app/utils/customer-document.ts');

test('cliente nacional preserva CPF/CNPJ canonicos e infere apenas documento valido', () => {
  assert.deepEqual(normalizeCustomerDocument('PF', '123.456.789-09'), { tipo: 'PF', documento: '12345678909' });
  assert.deepEqual(normalizeCustomerDocument('PJ', '12.ABC.345/01DE-35'), { tipo: 'PJ', documento: '12ABC34501DE35' });
  assert.equal(inferCustomerDocumentType('', '12abc34501de35'), 'PJ');
  assert.equal(inferCustomerDocumentType('', 'nao-e-documento'), '');
  assert.throws(() => normalizeCustomerDocument('PJ', '12.ABC.345/01DE-36'), { status: 400 });
  assert.throws(() => normalizeCustomerDocument('', 'qualquer coisa'), { status: 400 });
});

test('cliente exterior aceita identificador limitado sem reinterpretar como CNPJ', () => {
  assert.deepEqual(normalizeCustomerDocument('EXT', '  PT-ABC 123  '), { tipo: 'EXT', documento: 'PT-ABC 123' });
  assert.deepEqual(normalizeCustomerDocument('EXT', ''), { tipo: 'EXT', documento: null });
  assert.throws(() => normalizeCustomerDocument('EXT', 'x'.repeat(41)), { status: 400 });
});
