import { ADDON_TYPES, boundedInteger, CommercialError, moneyCents } from './commercial-pricing';

function text(value: unknown, label: string, max: number, min = 0) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new CommercialError(`${label}: tamanho inválido.`);
  return value.trim();
}
function boolean(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new CommercialError('Campo booleano inválido.');
  return value;
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (typeof value === 'string' && /^\d{1,10}$/.test(value)) value = Number(value);
  return boundedInteger(value, min, max, label);
}

export function validateCatalogProduct(body: Record<string, unknown>) {
  const name = text(body.name, 'Nome', 100, 3);
  const slug = text(body.slug, 'Slug', 120, 1);
  if (!/^[a-z0-9_-]+$/i.test(slug)) throw new CommercialError('Slug deve conter apenas letras, números, hífen e sublinhado.');
  const tipo = text(body.tipo ?? 'PLANO', 'Tipo', 30, 1);
  if (!['PLANO', 'CUSTOM', ...ADDON_TYPES].includes(tipo)) throw new CommercialError('Tipo de produto inválido.');
  const maxNotasMensal = integer(body.maxNotasMensal ?? 0, 0, 1_000_000, 'Notas');
  const maxClientes = integer(body.maxClientes ?? 0, 0, 1_000_000, 'Clientes');
  const diasTeste = integer(body.diasTeste ?? 0, 0, 90, 'Dias de teste');
  let features: unknown;
  try { features = typeof body.features === 'string' ? JSON.parse(body.features) : body.features; } catch { throw new CommercialError('Benefícios devem ser uma lista válida.'); }
  if (!Array.isArray(features) || features.length > 30 || features.some((item) => typeof item !== 'string' || item.length > 160)) throw new CommercialError('Informe até 30 benefícios com até 160 caracteres.');
  if ((tipo === 'PACOTE_NOTAS' && maxNotasMensal <= 0) || (tipo === 'PACOTE_CLIENTES' && maxClientes <= 0)) throw new CommercialError('Pacote deve conceder um benefício maior que zero.');
  if (tipo !== 'PLANO' && diasTeste !== 0) throw new CommercialError('Apenas assinaturas podem ter dias de teste.');
  const privado = boolean(body.privado, false);
  if (tipo === 'CUSTOM' && !privado) throw new CommercialError('Planos personalizados precisam ser privados.');
  return { name, slug, tipo, maxNotasMensal, maxClientes, diasTeste, privado, description: text(body.description ?? '', 'Descrição', 2000),
    priceMonthly: moneyCents(body.priceMonthly ?? 0, 'Preço mensal') / 100,
    priceYearly: moneyCents(body.priceYearly ?? 0, 'Preço anual') / 100,
    features: JSON.stringify(features), active: boolean(body.active, true), recommended: boolean(body.recommended, false) };
}

export function validateCatalogCoupon(body: Record<string, unknown>, now = new Date()) {
  const codigo = text(body.codigo, 'Código', 40, 1).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(codigo)) throw new CommercialError('Código de cupom inválido.');
  const tipoDesconto = text(body.tipoDesconto, 'Tipo do desconto', 20);
  if (!['PORCENTAGEM', 'VALOR_FIXO'].includes(tipoDesconto)) throw new CommercialError('Tipo de desconto inválido.');
  const cents = moneyCents(body.valorDesconto, 'Desconto');
  if (cents === 0 || (tipoDesconto === 'PORCENTAGEM' && cents > 10_000)) throw new CommercialError('Desconto deve ser positivo e a porcentagem não pode ultrapassar 100%.');
  const aplicarEm = text(body.aplicarEm ?? 'CARRINHO_TOTAL', 'Escopo', 30);
  if (!['CARRINHO_TOTAL', 'SO_ASSINATURA', 'SO_PACOTES', 'PLANOS_SELECIONADOS'].includes(aplicarEm)) throw new CommercialError('Escopo inválido.');
  const optionalInteger = (value: unknown, min: number, max: number, label: string) => value === '' || value === null || value === undefined ? null : integer(value, min, max, label);
  const maxCiclos = optionalInteger(body.maxCiclos, 1, 120, 'Meses do desconto');
  const limiteUsos = optionalInteger(body.limiteUsos, 0, 1_000_000, 'Limite de usos');
  const rawPlans = text(body.planosValidos ?? '', 'Planos', 4000);
  const ids = rawPlans.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length > 30 || ids.some((id) => !/^[\w-]{1,120}$/.test(id)) || new Set(ids).size !== ids.length) throw new CommercialError('Lista de produtos inválida.');
  if (aplicarEm === 'PLANOS_SELECIONADOS' && !ids.length) throw new CommercialError('Selecione os produtos elegíveis.');
  let validade: Date | null = null;
  if (body.validade) {
    if (typeof body.validade !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.validade)) throw new CommercialError('Data de validade inválida.');
    const day = new Date(`${body.validade}T12:00:00Z`);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== body.validade) throw new CommercialError('Data de validade inválida.');
    validade = new Date(`${body.validade}T23:59:59.999-03:00`);
    if (validade <= now) throw new CommercialError('A validade deve ser futura.');
  }
  return { codigo, tipoDesconto, valorDesconto: cents / 100, aplicarEm, maxCiclos, limiteUsos, validade,
    parceiroNome: text(body.parceiroNome ?? '', 'Parceiro', 160) || null, planosValidos: ids.join(',') || null,
    apenasPrimeiraCompra: boolean(body.apenasPrimeiraCompra, false) };
}
