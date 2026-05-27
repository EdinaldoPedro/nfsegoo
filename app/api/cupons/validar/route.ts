import { NextResponse } from 'next/server';
import { getAuthenticatedUser, unauthorized } from '@/app/utils/api-middleware';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';

export async function POST(request: Request) {
  const originError = validateSameOrigin(request);
  if (originError) return originError;

  const sizeError = validateJsonContentLength(request);
  if (sizeError) return sizeError;

  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();

  try {
    const body = await request.json();
    const { codigo, planoId, pacotesIds } = body;
    const codigoNormalizado = String(codigo || '').trim().toUpperCase();

    if (!codigoNormalizado) {
      return NextResponse.json({ error: 'Codigo nao informado.' }, { status: 400 });
    }

    const allowed = await checkRateLimit(`cupom_validar_${user.id}`, 20, 15 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json({ error: 'Muitas tentativas de cupom. Aguarde e tente novamente.' }, { status: 429 });
    }

    const cupom = await prisma.cupom.findUnique({
      where: { codigo: codigoNormalizado },
    });

    if (!cupom || !cupom.ativo) {
      return NextResponse.json({ error: 'Cupom invalido.' }, { status: 404 });
    }

    if (cupom.validade && new Date(cupom.validade) < new Date()) {
      return NextResponse.json({ error: 'Cupom invalido.' }, { status: 400 });
    }

    if (cupom.limiteUsos && cupom.vezesUsado >= cupom.limiteUsos) {
      return NextResponse.json({ error: 'Cupom invalido.' }, { status: 400 });
    }

    if (cupom.planosValidos && cupom.planosValidos.length > 0) {
      const planosPermitidos = cupom.planosValidos.split(',');
      const temPlanoValido = !!planoId && planosPermitidos.includes(planoId);
      const temPacoteValido =
        Array.isArray(pacotesIds) && pacotesIds.some((id) => typeof id === 'string' && planosPermitidos.includes(id));

      if (!temPlanoValido && !temPacoteValido) {
        return NextResponse.json({ error: 'Cupom nao aplicavel aos itens selecionados.' }, { status: 400 });
      }
    }

    return NextResponse.json({
      id: cupom.id,
      codigo: cupom.codigo,
      tipoDesconto: cupom.tipoDesconto,
      valorDesconto: Number(cupom.valorDesconto),
      aplicarEm: cupom.aplicarEm,
      maxCiclos: cupom.maxCiclos,
      planosValidos: cupom.planosValidos,
    });
  } catch (error) {
    console.error('Erro ao validar cupom:', error);
    return NextResponse.json({ error: 'Erro interno ao validar o cupom.' }, { status: 500 });
  }
}
