const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCatalogProduct, validateCatalogCoupon } = require('../app/utils/commercial-catalog.ts');
const plan = { name: 'Plano QA', slug: 'PLANO_QA', priceMonthly: '12.50', priceYearly: '120.00', features: '["Um benefício"]', maxNotasMensal: '5', maxClientes: 10 };
const coupon = { codigo: 'teste', tipoDesconto: 'PORCENTAGEM', valorDesconto: '15.50', aplicarEm: 'CARRINHO_TOTAL' };

test('catalogo valida tipos, limites, centavos e texto sem coercoes permissivas', () => {
  assert.equal(validateCatalogProduct(plan).priceMonthly, 12.5);
  assert.equal(validateCatalogProduct(plan).maxNotasMensal, 5);
  for (const override of [{ features: '{}' }, { features: '[1]' }, { tipo: 'QUALQUER' }, { active: 'false' }, { maxNotasMensal: -1 },
    { maxClientes: '1x' }, { priceMonthly: '1.999' }, { slug: '<script>' }, { tipo: 'CUSTOM', privado: false }, { tipo: 'PACOTE_NOTAS', maxNotasMensal: 0 }]) {
    assert.throws(() => validateCatalogProduct({ ...plan, ...override }));
  }
});

test('cupom distingue estoque zero de ilimitado e rejeita desconto ou data invalida', () => {
  const now = new Date('2026-09-02T12:00:00Z');
  assert.equal(validateCatalogCoupon({ ...coupon, limiteUsos: '0' }, now).limiteUsos, 0);
  assert.equal(validateCatalogCoupon({ ...coupon, limiteUsos: '' }, now).limiteUsos, null);
  assert.equal(validateCatalogCoupon({ ...coupon, validade: '2026-09-03' }, now).validade.toISOString(), '2026-09-04T02:59:59.999Z');
  for (const override of [{ valorDesconto: 0 }, { valorDesconto: 101 }, { maxCiclos: 0 }, { aplicarEm: 'OUTRO' },
    { validade: '2026-02-30' }, { validade: '2025-01-01' }, { apenasPrimeiraCompra: 'true' }, { aplicarEm: 'PLANOS_SELECIONADOS' }, { planosValidos: 'id,id' }]) {
    assert.throws(() => validateCatalogCoupon({ ...coupon, ...override }, now));
  }
});
