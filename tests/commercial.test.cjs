const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCart, calculateQuote, moneyCents, assertOrderTransition, addCalendarMonths } = require('../app/utils/commercial-pricing.ts');
const { quoteHash } = require('../app/services/commercialService.ts');
const { isCommercialRole, isSupportRole } = require('../app/utils/access-control.ts');
const { canAccessAdminPage } = require('../app/utils/admin-navigation.ts');
const { checkIsStaff } = require('../app/utils/permissions.ts');
const product = { id: 'plan-1', slug: 'BASIC', name: 'Basic', tipo: 'PLANO', active: true, privado: false,
  priceMonthly: '39.90', priceYearly: '399.00', maxNotasMensal: 30, maxClientes: 50, diasTeste: 0 };
const addon = { ...product, id: 'extra-1', slug: 'EXTRA', name: 'Mais notas', tipo: 'PACOTE_NOTAS', priceMonthly: '9.90', maxNotasMensal: 10 };
const coupon = { id: 'coupon-1', codigo: 'BEMVINDO', ativo: true, validade: null, limiteUsos: null, vezesUsado: 0,
  tipoDesconto: 'PORCENTAGEM', valorDesconto: '10.00', aplicarEm: 'CARRINHO_TOTAL', maxCiclos: null, planosValidos: null, apenasPrimeiraCompra: false };
const context = { now: new Date('2026-09-02T12:00:00Z'), hasPaidPurchase: false, reservedCouponUses: 0, userReservedFirstPurchase: false };
const cart = (overrides = {}) => normalizeCart({ planSlug: 'BASIC', ciclo: 'MENSAL', qtdCiclos: 1, ...overrides });

test('dinheiro rejeita arredondamento oculto, negativos, Infinity, notacao cientifica e overflow', () => {
  assert.equal(moneyCents('0.10'), 10);
  assert.equal(moneyCents('99999999.99'), 9_999_999_999);
  for (const value of [-1, Infinity, NaN, '1.001', '1e3', '100000000', {}, null, '1,23', '']) assert.throws(() => moneyCents(value));
});

test('carrinho limita ciclos e quantidade; proibe duplicatas, vazio, fracionarios e tipos coercivos', () => {
  for (const overrides of [{ qtdCiclos: 0 }, { qtdCiclos: 1.5 }, { qtdCiclos: 13 }, { qtdCiclos: '1' }, { ciclo: 'ANUAL', qtdCiclos: 2 }, { ciclo: 'SEMANAL' },
    { pacotes: [{ planId: 'extra-1', qtd: 0 }] }, { pacotes: [{ planId: 'extra-1', qtd: 101 }] }, { pacotes: [{ planId: 'extra-1', qtd: 1 }, { planId: 'extra-1', qtd: 2 }] }]) assert.throws(() => cart(overrides));
  assert.throws(() => normalizeCart({}));
  assert.throws(() => cart({ planSlug: null, ciclo: 'ANUAL', pacotes: [{ planId: 'extra-1', qtd: 1 }] }));
});

test('valores enviados pelo cliente nao participam do preco; beneficios avulsos multiplicam a quantidade', () => {
  const quote = calculateQuote(cart({ valorTotal: 0.01, pacotes: [{ planId: addon.id, qtd: 2 }] }), [product, addon], null, context);
  assert.equal(quote.totalCents, 5970);
  assert.equal(quote.lines[1].notas, 20);
  assert.equal(quote.lines[1].clientes, 0);
});

test('catalogo bloqueia produto privado, inativo, trial, ciclo gratis e troca de tipo', () => {
  for (const override of [{ privado: true }, { active: false }, { diasTeste: 7 }, { priceMonthly: '0' }, { tipo: 'CUSTOM' }, { maxNotasMensal: -1 }])
    assert.throws(() => calculateQuote(cart(), [{ ...product, ...override }], null, context));
  assert.throws(() => calculateQuote(cart({ pacotes: [{ planId: product.id, qtd: 1 }] }), [product], null, context));
  assert.throws(() => calculateQuote(cart({ pacotes: [{ planId: 'missing', qtd: 1 }] }), [product], null, context));
});

test('porcentagem usa centavos e arredonda meio para cima sem ponto flutuante', () => {
  const quote = calculateQuote(cart({ cupom: 'bemvindo' }), [{ ...product, priceMonthly: '0.05' }], coupon, context);
  assert.equal(quote.descontoCents, 1);
  assert.equal(quote.totalCents, 4);
});

test('desconto fixo nunca supera a base elegivel', () => {
  const quote = calculateQuote(cart({ cupom: 'BEMVINDO' }), [product], { ...coupon, tipoDesconto: 'VALOR_FIXO', valorDesconto: '5000' }, context);
  assert.equal(quote.descontoCents, 3990); assert.equal(quote.totalCents, 0);
});

test('cupom de dois meses sobre anual aplica apenas dois doze avos, nao dois anos', () => {
  const quote = calculateQuote(cart({ ciclo: 'ANUAL', cupom: 'BEMVINDO' }), [product], { ...coupon, valorDesconto: '100', maxCiclos: 2 }, context);
  assert.equal(quote.descontoCents, 6650); assert.equal(quote.totalCents, 33250);
});

test('cupom selecionado nao desconta item inelegivel; escopo de pacote nao afeta assinatura', () => {
  const items = cart({ cupom: 'BEMVINDO', pacotes: [{ planId: addon.id, qtd: 1 }] });
  for (const override of [{ aplicarEm: 'SO_PACOTES' }, { aplicarEm: 'PLANOS_SELECIONADOS', planosValidos: addon.id }]) {
    assert.equal(calculateQuote(items, [product, addon], { ...coupon, ...override }, context).descontoCents, 99);
  }
  assert.throws(() => calculateQuote(cart({ cupom: 'BEMVINDO' }), [product], { ...coupon, aplicarEm: 'SO_PACOTES' }, context));
});

test('cupom respeita validade, estoque zero, reservas e primeira compra', () => {
  for (const override of [{ ativo: false }, { validade: context.now }, { limiteUsos: 0 }, { limiteUsos: 1, vezesUsado: 1 }, { valorDesconto: '-1' }, { valorDesconto: '101' }])
    assert.throws(() => calculateQuote(cart({ cupom: 'BEMVINDO' }), [product], { ...coupon, ...override }, context));
  assert.throws(() => calculateQuote(cart({ cupom: 'BEMVINDO' }), [product], { ...coupon, limiteUsos: 1 }, { ...context, reservedCouponUses: 1 }));
  for (const override of [{ hasPaidPurchase: true }, { userReservedFirstPurchase: true }])
    assert.throws(() => calculateQuote(cart({ cupom: 'BEMVINDO' }), [product], { ...coupon, apenasPrimeiraCompra: true }, { ...context, ...override }));
});

test('fotografia tem hash estavel para JSONB e detecta preco ou beneficio alterado', () => {
  const quote = calculateQuote(cart(), [product], null, context);
  const reordered = Object.fromEntries(Object.entries(quote).reverse());
  reordered.lines = quote.lines.map((line) => Object.fromEntries(Object.entries(line).reverse()));
  assert.equal(quoteHash(quote), quoteHash(reordered));
  assert.notEqual(quoteHash(quote), quoteHash({ ...quote, totalCents: 1 }));
  assert.notEqual(quoteHash(quote), quoteHash({ ...quote, lines: [{ ...quote.lines[0], notas: 999 }] }));
});

test('pedido exige analise antes de ativacao; encerrados nao voltam a pendente', () => {
  assert.doesNotThrow(() => assertOrderTransition('COMPROVANTE_ENVIADO', 'EM_ANALISE'));
  assert.doesNotThrow(() => assertOrderTransition('EM_ANALISE', 'ATIVADO_MANUALMENTE'));
  assert.throws(() => assertOrderTransition('AGUARDANDO_COMPROVANTE', 'ATIVADO_MANUALMENTE'));
  for (const from of ['ATIVADO_MANUALMENTE', 'RECUSADO', 'CANCELADO', 'EXPIRADO']) for (const to of ['EM_ANALISE', 'COMPROVANTE_ENVIADO', 'ATIVADO_MANUALMENTE']) assert.throws(() => assertOrderTransition(from, to));
});

test('ciclos de calendario preservam ancoragem, ano bissexto e horario', () => {
  const jan = new Date('2028-01-31T17:33:12Z');
  assert.equal(addCalendarMonths(jan, 1).toISOString(), '2028-02-29T17:33:12.000Z');
  assert.equal(addCalendarMonths(jan, 2).toISOString(), '2028-03-31T17:33:12.000Z');
  assert.equal(addCalendarMonths(new Date('2028-02-29T12:00:00Z'), 12).toISOString(), '2029-02-28T12:00:00.000Z');
});

test('comercial tem MFA de staff mas nao suporte, impersonacao ou navegacao tecnica', () => {
  assert.equal(checkIsStaff('COMERCIAL'), true);
  assert.equal(isCommercialRole('COMERCIAL'), true);
  assert.equal(isSupportRole('COMERCIAL'), false);
  for (const role of ['COMUM', 'CONTADOR', 'SUPORTE', 'SUPORTE_TI']) assert.equal(isCommercialRole(role), false);
  assert.equal(canAccessAdminPage('COMERCIAL', '/admin/contratacoes'), true);
  for (const path of ['/admin/usuarios', '/admin/emissoes', '/admin/configuracoes', '/admin/logs', '/admin/contratacoes-falso']) assert.equal(canAccessAdminPage('COMERCIAL', path), false);
});
