const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatCnpj, formatCnpjInput, normalizeCnpj, validarCNPJ } = require('../app/utils/cnpj.ts');

test('CNPJ conserva zeros e letras; aceita exemplo DV oficial e inscricao publica alfanumerica', () => {
  for (const value of ['12.ABC.345/01DE-35', '12abc34501de35', '00.000.000/E08G-12', '00000000E08G12', '04.252.011/0001-10', '00000000000191']) assert.equal(validarCNPJ(value), true, value);
  assert.equal(normalizeCnpj(' 00.000.000/e08g-12 '), '00000000E08G12');
});
test('CNPJ alfanumerico e formatado sem perda de letras e com DV numerico', () => {
  assert.equal(formatCnpj('12ABC34501DE35'), '12.ABC.345/01DE-35');
  assert.equal(formatCnpjInput('12abc34501de35'), '12.ABC.345/01DE-35');
  assert.equal(formatCnpjInput('12abc34501deAB35'), '12.ABC.345/01DE-35');
});
test('CNPJ nao remove letras ou caracteres inesperados para fabricar outro documento', () => {
  for (const value of [null, 4252011000110, '00000000000000', '11111111111111', '12.ABC.345/01DE-36', '12ＡBC34501DE35', '12 ABC34501DE35', '04252011000110<script>', '04/252/011/0001/10', '00000000E08GAB']) assert.equal(validarCNPJ(value), false, String(value));
  assert.equal(normalizeCnpj('04X52011000110'), '04X52011000110');
  assert.equal(normalizeCnpj('04X252011000110'), '');
  assert.equal(validarCNPJ('04X252011000110'), false);
});
