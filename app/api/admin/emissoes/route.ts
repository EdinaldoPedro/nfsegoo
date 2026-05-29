import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { isSupportRole } from '@/app/utils/access-control';
import { prisma } from '@/app/utils/prisma';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!isSupportRole(user.role)) return forbidden();

  try {
    const emissores = await prisma.empresa.findMany({
      where: {
        arquivadoEm: null,
        OR: [{ certificadoA1: { not: null } }, { notasEmitidas: { some: {} } }, { logs: { some: {} } }],
      } as any,
      include: {
        _count: {
          select: { notasEmitidas: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const dataComErros = await Promise.all(
      emissores.map(async (emp) => {
        const [erros, vendasFalhas, vendasProcessando, vendasMes, ultimoErro, ultimaFalha] = await Promise.all([
          prisma.systemLog.count({
            where: {
              empresaId: emp.id,
              level: 'ERRO',
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          }),
          prisma.venda.count({
            where: { empresaId: emp.id, status: 'ERRO_EMISSAO', arquivadoEm: null },
          }),
          prisma.venda.count({
            where: { empresaId: emp.id, status: 'PROCESSANDO', arquivadoEm: null },
          }),
          prisma.venda.count({
            where: { empresaId: emp.id, createdAt: { gte: inicioMes }, arquivadoEm: null },
          }),
          prisma.systemLog.findFirst({
            where: { empresaId: emp.id, level: 'ERRO' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, action: true, message: true, createdAt: true, vendaId: true },
          }),
          prisma.venda.findFirst({
            where: { empresaId: emp.id, status: 'ERRO_EMISSAO', arquivadoEm: null },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, valor: true, updatedAt: true, cliente: { select: { nome: true, documento: true } } },
          }),
        ]);

        return {
          ...stripEmpresaSecrets(emp),
          errosRecentes: erros,
          vendasFalhas,
          vendasProcessando,
          vendasMes,
          ultimoErro,
          ultimaFalha: ultimaFalha ? {
            ...ultimaFalha,
            valor: Number(ultimaFalha.valor),
          } : null,
        };
      }),
    );

    return NextResponse.json(dataComErros);
  } catch {
    return NextResponse.json({ error: 'Erro interno ao listar.' }, { status: 500 });
  }
}
