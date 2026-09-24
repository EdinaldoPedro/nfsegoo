import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isAdminRole } from '@/app/utils/access-control';
import { requireAdminReauthentication } from '@/app/utils/admin-security';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { validateCatalogProduct } from '@/app/utils/commercial-catalog';
import { prisma } from '@/app/utils/prisma';

export const GET = withApiGuard(async function GET(request: Request) {
  const admin = new URL(request.url).searchParams.get('visao') === 'admin';
  if (admin) {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    if (!isAdminRole(user.role)) return forbidden();
  }
  return NextResponse.json(await prisma.plan.findMany({ where: admin ? {} : { active: true, privado: false }, orderBy: [{ priceMonthly: 'asc' }, { id: 'asc' }], take: 200 }));
});

async function mutate(request: Request, action: 'CREATE' | 'UPDATE' | 'DISABLE') {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isAdminRole(user.role)) return forbidden();
  const body = await request.json();
  const authError = await requireAdminReauthentication({ actorId: user.id, password: body.adminPassword, justification: body.justification, action: `${action}_PRODUCT` });
  if (authError) return authError;
  if (action !== 'CREATE' && (typeof body.id !== 'string' || body.id.length > 120)) return NextResponse.json({ error: 'Produto inválido.' }, { status: 400 });
  try {
    const data = action === 'DISABLE' ? null : validateCatalogProduct(body);
    const result = await prisma.$transaction(async (tx) => {
      const previous = action === 'CREATE' ? null : await tx.plan.findUnique({ where: { id: body.id } });
      if (action !== 'CREATE' && !previous) throw new CommercialError('Produto não encontrado.', 404);
      if (previous && data && (data.slug !== previous.slug || data.tipo !== previous.tipo || data.diasTeste !== previous.diasTeste)) {
        throw new CommercialError('Slug, tipo e condição de teste são imutáveis. Crie outro produto e desative este para novas vendas.', 409);
      }
      const product = action === 'CREATE' ? await tx.plan.create({ data: data! })
        : await tx.plan.update({ where: { id: body.id }, data: action === 'DISABLE' ? { active: false, recommended: false } : data! });
      await tx.systemLog.create({ data: { level: 'INFO', module: 'FINANCEIRO', action: `${action}_PRODUCT`, userId: user.id,
        message: 'Catálogo comercial atualizado; contratos existentes preservados.', details: JSON.stringify({ productId: product.id, before: previous, after: product, justification: body.justification }) } });
      return product;
    });
    return NextResponse.json(result, { status: action === 'CREATE' ? 201 : 200 });
  } catch (error) {
    if (error instanceof CommercialError) return NextResponse.json({ error: error.message }, { status: error.status });
    if ((error as { code?: string }).code === 'P2002') return NextResponse.json({ error: 'Slug já cadastrado.' }, { status: 409 });
    throw error;
  }
}

export const POST = withApiGuard(async function POST(request: Request) { return mutate(request, 'CREATE'); });
export const PUT = withApiGuard(async function PUT(request: Request) { return mutate(request, 'UPDATE'); });
export const DELETE = withApiGuard(async function DELETE(request: Request) { return mutate(request, 'DISABLE'); });
