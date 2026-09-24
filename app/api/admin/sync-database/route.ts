import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { authorizeMaintenance } from '@/app/utils/maintenance-security';
import { createLog } from '@/app/services/logger';

export const POST = withApiGuard(async function POST(request: Request) {
  const { actor, body, error } = await authorizeMaintenance(request, 'SYNC_FISCAL_CATALOG', 'SINCRONIZAR CATALOGO FISCAL');
  if (error) return error;
  if (!actor || !body) return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 });

  try {
    // 1. Busca todos os CNAEs existentes nas empresas
    const cnaesExistentes = await prisma.cnae.findMany({
      include: { empresa: true }
    });

    let globalCount = 0;
    let municipalCount = 0;

    // 2. Itera sobre cada CNAE encontrado
    for (const item of cnaesExistentes) {
      
      // === LIMPEZA DOS DADOS ===
      // Remove tudo que não for número (pontos, traços, barras, espaços)
      const codigoLimpo = item.codigo.replace(/\D/g, ''); 

      if (!codigoLimpo) continue; // Pula se ficar vazio

      // --- A. Popular GlobalCnae (Lista Mestra) ---
      const existeGlobal = await prisma.globalCnae.findUnique({
        where: { codigo: codigoLimpo } // Busca pelo código limpo
      });

      if (!existeGlobal) {
        await prisma.globalCnae.create({
          data: {
            codigo: codigoLimpo, // Salva LIMPO no banco
            descricao: item.descricao,
            itemLc: '', 
            codigoTributacaoNacional: ''
          }
        });
        globalCount++;
      }

      // --- B. Popular TributacaoMunicipal ---
      if (item.empresa && item.empresa.codigoIbge) {
        const existeMunicipal = await prisma.tributacaoMunicipal.findFirst({
          where: {
            cnae: codigoLimpo, // Usa o código limpo
            codigoIbge: item.empresa.codigoIbge
          }
        });

        if (!existeMunicipal) {
          await prisma.tributacaoMunicipal.create({
            data: {
              cnae: codigoLimpo, // Salva LIMPO
              codigoIbge: item.empresa.codigoIbge,
              codigoTributacaoMunicipal: 'A_DEFINIR', 
              ativo: false,
              descricaoServicoMunicipal: item.descricao
            }
          });
          municipalCount++;
        }
      }
    }

    await createLog({
      level: 'ALERTA', action: 'FISCAL_CATALOG_MAINTENANCE', module: 'SEGURANCA', userId: actor.id,
      message: 'Catalogo fiscal sincronizado; novas regras municipais permanecem inativas.',
      details: { globalCount, municipalCount, justification: body.justification },
    });

    return NextResponse.json({
      success: true,
      message: "Sincronização com limpeza concluída!",
      details: {
        totalLidos: cnaesExistentes.length,
        novosGlobais: globalCount,
        novasRegrasMunicipais: municipalCount
      }
    });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro ao sincronizar.' }, { status: 500 });
  }
});
