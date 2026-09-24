import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { authorizeMaintenance } from '@/app/utils/maintenance-security';
import { createLog } from '@/app/services/logger';

export const POST = withApiGuard(async function POST(request: Request) {
  const { actor, body, error } = await authorizeMaintenance(request, 'FIX_DUPLICATE_CNAES', 'REMOVER CNAES DUPLICADOS');
  if (error) return error;
  if (!actor || !body) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });

  try {
    // 1. Pega todos os CNAEs do sistema
    const allCnaes = await prisma.cnae.findMany({ orderBy: [{ principal: 'desc' }, { id: 'asc' }] });
    
    const vistos = new Set();
    const paraDeletar = [];

    // 2. Identifica duplicatas
    for (const cnae of allCnaes) {
      // Cria uma chave única: ID da Empresa + Código do CNAE
      const chaveUnica = `${cnae.empresaId}-${cnae.codigo.replace(/\D/g, '')}`;

      if (vistos.has(chaveUnica)) {
        // Se já vimos essa chave, esse registro é duplicado. Marca para deletar.
        paraDeletar.push(cnae.id);
      } else {
        vistos.add(chaveUnica);
      }
    }

    // 3. Deleta as duplicatas
    const dryRun = body.dryRun !== false;
    if (!dryRun && paraDeletar.length > 0) {
      await prisma.cnae.deleteMany({
        where: {
          id: { in: paraDeletar }
        }
      });
    }

    await createLog({
      level: 'ALERTA', action: 'DUPLICATE_CNAES_MAINTENANCE', module: 'SEGURANCA', userId: actor.id,
      message: dryRun ? 'Simulacao de deduplicacao de CNAEs.' : 'CNAEs duplicados removidos.',
      details: { dryRun, count: paraDeletar.length, justification: body.justification },
    });

    return NextResponse.json({
      message: dryRun ? 'Simulacao concluida; nenhum registro alterado.' : 'Limpeza concluida',
      dryRun,
      totalAnalisado: allCnaes.length,
      duplicatasEncontradas: paraDeletar.length,
      duplicatasRemovidas: dryRun ? 0 : paraDeletar.length
    });

  } catch (error) {
    return NextResponse.json({ error: 'Erro ao limpar' }, { status: 500 });
  }
});
