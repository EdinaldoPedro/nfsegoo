/** Money stays in integer centavos. This module is shared by quotes and order validation. */
export class CommercialError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const MAX_CART_CENTS = 9_999_999_999; // Decimal(10,2), never silently truncate.
export const ADDON_TYPES = ['PACOTE_NOTAS', 'PACOTE_CLIENTES', 'PACOTE_PJ'] as const;
export type Product = {
  id: string; slug: string; name: string; tipo: string; active: boolean; privado: boolean;
  priceMonthly: unknown; priceYearly: unknown; maxNotasMensal: number; maxClientes: number; diasTeste: number;
};
export type Coupon = {
  id: string; codigo: string; ativo: boolean; validade: Date | null; limiteUsos: number | null;
  vezesUsado: number; tipoDesconto: string; valorDesconto: unknown; aplicarEm: string;
  maxCiclos: number | null; planosValidos: string | null; apenasPrimeiraCompra: boolean;
};
export type Cart = { planSlug: string | null; ciclo: 'MENSAL' | 'ANUAL'; qtdCiclos: number;
  pacotes: { planId: string; qtd: number }[]; cupom: string | null };
export type QuoteLine = { planId: string; slug: string; nome: string; tipo: string; quantidade: number;
  unitCents: number; totalCents: number; notas: number; clientes: number; empresas: number };
export type CommercialQuote = { version: 1; cart: Cart; lines: QuoteLine[]; planoCents: number;
  adicionaisCents: number; descontoCents: number; totalCents: number;
  coupon: { id: string; codigo: string; firstPurchaseOnly: boolean } | null };

export function moneyCents(value: unknown, label = 'Valor'): number {
  const raw = typeof value === 'number' || typeof value === 'string' ||
    (value && typeof value === 'object' && 'toFixed' in value) ? String(value) : '';
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw)) throw new CommercialError(`${label} deve ser positivo, com no máximo duas casas decimais.`);
  const [whole, fraction = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_CART_CENTS) throw new CommercialError(`${label} fora do limite suportado.`);
  return cents;
}

export function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new CommercialError(`${label} deve ser inteiro entre ${min} e ${max}.`);
  }
  return value;
}

export function normalizeCart(input: unknown): Cart {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Carrinho inválido.');
  const body = input as Record<string, unknown>;
  const planSlug = body.planSlug === null || body.planSlug === undefined ? null : body.planSlug;
  if (planSlug !== null && (typeof planSlug !== 'string' || !/^[\w-]{1,120}$/.test(planSlug))) throw new CommercialError('Plano inválido.');
  const ciclo = body.ciclo ?? 'MENSAL';
  if (ciclo !== 'MENSAL' && ciclo !== 'ANUAL') throw new CommercialError('Ciclo inválido.');
  const qtdCiclos = boundedInteger(body.qtdCiclos ?? 1, 1, ciclo === 'ANUAL' ? 1 : 12, 'Quantidade de ciclos');
  const rawAddons = body.pacotes ?? [];
  if (!Array.isArray(rawAddons) || rawAddons.length > 10) throw new CommercialError('Selecione no máximo 10 tipos de pacote.');
  const seen = new Set<string>();
  const pacotes = rawAddons.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.planId !== 'string' || !/^[\w-]{1,120}$/.test(item.planId) || seen.has(item.planId)) {
      throw new CommercialError('Pacote inválido ou repetido.');
    }
    seen.add(item.planId);
    return { planId: item.planId, qtd: boundedInteger(item.qtd, 1, 100, 'Quantidade do pacote') };
  }).sort((a, b) => a.planId.localeCompare(b.planId));
  if (!planSlug && pacotes.length === 0) throw new CommercialError('Selecione um plano ou pacote.');
  if (!planSlug && (ciclo !== 'MENSAL' || qtdCiclos !== 1)) throw new CommercialError('Pacotes avulsos não possuem ciclos antecipados.');
  const cupom = body.cupom === null || body.cupom === undefined || body.cupom === '' ? null : body.cupom;
  if (cupom !== null && (typeof cupom !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(cupom))) throw new CommercialError('Código de cupom inválido.');
  return { planSlug: planSlug as string | null, ciclo, qtdCiclos, pacotes, cupom: typeof cupom === 'string' ? cupom.toUpperCase() : null };
}

function roundRatio(amount: number, numerator: number, denominator: number) {
  return Number((BigInt(amount) * BigInt(numerator) + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
}

export function calculateQuote(cart: Cart, products: Product[], coupon: Coupon | null,
  context: { now: Date; hasPaidPurchase: boolean; reservedCouponUses: number; userReservedFirstPurchase: boolean }): CommercialQuote {
  const lines: QuoteLine[] = [];
  const available = (product: Product | undefined) => {
    if (!product || !product.active || product.privado || product.diasTeste > 0) throw new CommercialError('Produto indisponível para contratação pública.', 409);
    boundedInteger(product.maxNotasMensal, 0, 1_000_000, 'Limite de notas');
    boundedInteger(product.maxClientes, 0, 1_000_000, 'Limite de clientes');
    return product;
  };
  if (cart.planSlug) {
    const plan = available(products.find((p) => p.slug === cart.planSlug));
    if (plan.tipo !== 'PLANO') throw new CommercialError('O produto selecionado não é uma assinatura.');
    const unitCents = moneyCents(cart.ciclo === 'ANUAL' ? plan.priceYearly : plan.priceMonthly);
    if (unitCents === 0) throw new CommercialError('Este ciclo não está disponível para compra.');
    lines.push({ planId: plan.id, slug: plan.slug, nome: plan.name, tipo: plan.tipo, quantidade: cart.qtdCiclos,
      unitCents, totalCents: unitCents * cart.qtdCiclos, notas: plan.maxNotasMensal, clientes: plan.maxClientes, empresas: 0 });
  }
  for (const addon of cart.pacotes) {
    const plan = available(products.find((p) => p.id === addon.planId));
    if (!(ADDON_TYPES as readonly string[]).includes(plan.tipo)) throw new CommercialError('Tipo de pacote inválido.');
    const unitCents = moneyCents(plan.priceMonthly);
    if (unitCents === 0) throw new CommercialError('Pacote indisponível para compra.');
    const notas = plan.tipo === 'PACOTE_NOTAS' ? plan.maxNotasMensal * addon.qtd : 0;
    const clientes = plan.tipo === 'PACOTE_CLIENTES' ? plan.maxClientes * addon.qtd : 0;
    const empresas = plan.tipo === 'PACOTE_PJ' ? addon.qtd : 0;
    if (notas + clientes + empresas <= 0) throw new CommercialError('Pacote sem benefício configurado.', 409);
    lines.push({ planId: plan.id, slug: plan.slug, nome: plan.name, tipo: plan.tipo, quantidade: addon.qtd,
      unitCents, totalCents: unitCents * addon.qtd, notas, clientes, empresas });
  }
  const planoCents = lines.filter((l) => l.tipo === 'PLANO').reduce((s, l) => s + l.totalCents, 0);
  const adicionaisCents = lines.filter((l) => l.tipo !== 'PLANO').reduce((s, l) => s + l.totalCents, 0);
  if (planoCents + adicionaisCents > MAX_CART_CENTS) throw new CommercialError('Valor total excede o limite suportado.');
  let descontoCents = 0;
  if (cart.cupom) {
    if (!coupon || coupon.codigo !== cart.cupom || !coupon.ativo || (coupon.validade && coupon.validade <= context.now)) throw new CommercialError('Cupom indisponível.');
    if (coupon.limiteUsos !== null && coupon.vezesUsado + context.reservedCouponUses >= coupon.limiteUsos) throw new CommercialError('Cupom esgotado.');
    if (coupon.apenasPrimeiraCompra && (context.hasPaidPurchase || context.userReservedFirstPurchase)) throw new CommercialError('Cupom exclusivo da primeira compra.');
    if (!['CARRINHO_TOTAL', 'SO_ASSINATURA', 'SO_PACOTES', 'PLANOS_SELECIONADOS'].includes(coupon.aplicarEm)) throw new CommercialError('Regra do cupom inválida.');
    if (coupon.maxCiclos !== null) boundedInteger(coupon.maxCiclos, 1, 120, 'Meses do cupom');
    const selected = (coupon.planosValidos || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (coupon.aplicarEm === 'PLANOS_SELECIONADOS' && selected.length === 0) throw new CommercialError('Cupom sem produtos elegíveis.');
    let eligible = 0;
    for (const line of lines) {
      const base = line.tipo === 'PLANO';
      if (selected.length && !selected.includes(line.planId)) continue;
      if ((coupon.aplicarEm === 'SO_ASSINATURA' && !base) || (coupon.aplicarEm === 'SO_PACOTES' && base)) continue;
      const months = cart.qtdCiclos * (cart.ciclo === 'ANUAL' ? 12 : 1);
      eligible += base && coupon.maxCiclos !== null ? roundRatio(line.totalCents, Math.min(months, coupon.maxCiclos), months) : line.totalCents;
    }
    if (eligible === 0) throw new CommercialError('Cupom não aplicável aos itens do carrinho.');
    const value = moneyCents(coupon.valorDesconto, 'Desconto');
    if (!value || !['PORCENTAGEM', 'VALOR_FIXO'].includes(coupon.tipoDesconto) || (coupon.tipoDesconto === 'PORCENTAGEM' && value > 10_000)) throw new CommercialError('Desconto inválido.');
    descontoCents = coupon.tipoDesconto === 'PORCENTAGEM' ? roundRatio(eligible, value, 10_000) : Math.min(value, eligible);
  }
  return { version: 1, cart, lines, planoCents, adicionaisCents, descontoCents, totalCents: planoCents + adicionaisCents - descontoCents,
    coupon: coupon ? { id: coupon.id, codigo: coupon.codigo, firstPurchaseOnly: coupon.apenasPrimeiraCompra } : null };
}

export function assertOrderTransition(from: string, to: string) {
  const transitions: Record<string, string[]> = {
    AGUARDANDO_COMPROVANTE: ['COMPROVANTE_ENVIADO', 'EM_ANALISE', 'RECUSADO', 'CANCELADO', 'EXPIRADO'],
    COMPROVANTE_ENVIADO: ['EM_ANALISE', 'RECUSADO', 'CANCELADO', 'EXPIRADO'],
    EM_ANALISE: ['ATIVADO_MANUALMENTE', 'RECUSADO', 'CANCELADO', 'EXPIRADO'],
  };
  if (!transitions[from]?.includes(to)) throw new CommercialError('Transição de pedido não permitida. Atualize a página.', 409);
}

/** Clamps 31 January -> last day of February, preserving UTC time and the original anchor. */
export function addCalendarMonths(anchor: Date, months: number): Date {
  const result = new Date(anchor);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(anchor.getUTCDate(), last));
  return result;
}
