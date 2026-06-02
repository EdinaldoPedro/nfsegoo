import { prisma } from '@/app/utils/prisma';

export async function marcarEmpresasProprietariasDoContador(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, empresaId: true },
  });

  if (!user) return [];

  const empresas = await prisma.empresa.findMany({
    where: {
      arquivadoEm: null,
      OR: [
        ...(user.empresaId ? [{ id: user.empresaId }] : []),
        { donoFaturamentoId: userId },
        { proprietarioUserId: userId } as any,
      ],
    } as any,
    select: { id: true, donoFaturamentoId: true },
  });

  const empresaIds = Array.from(new Set(empresas.map((empresa) => empresa.id)));
  if (empresaIds.length === 0) return [];

  await prisma.empresa.updateMany({
    where: { id: { in: empresaIds } },
    data: {
      proprietarioUserId: userId,
      contadorCustodianteId: userId,
      statusPropriedade: 'PROPRIETARIA',
      modoCobranca: 'RESPONSAVEL_UNICO',
    } as any,
  });

  await Promise.all(
    empresaIds.map((empresaId) =>
      prisma.contadorVinculo.upsert({
        where: { contadorId_empresaId: { contadorId: userId, empresaId } },
        create: {
          contadorId: userId,
          empresaId,
          status: 'APROVADO',
          clientePodeAcessarPortal: false,
          nivelPortal: 'NENHUM',
        } as any,
        update: {
          status: 'APROVADO',
          arquivadoEm: null,
          arquivadoPor: null,
          motivoArquivamento: null,
        } as any,
      })
    )
  );

  await prisma.empresa.updateMany({
    where: { id: { in: empresaIds }, donoFaturamentoId: null },
    data: { donoFaturamentoId: userId } as any,
  });

  return empresaIds;
}
