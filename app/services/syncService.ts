import { prisma } from '@/app/utils/prisma';


interface CnaeInput {
  codigo: string;
  descricao: string;
  principal?: boolean;
}

export async function syncCnaesGlobalmente(cnaes: CnaeInput[], codigoIbge?: string | null) {
  if (!cnaes || cnaes.length === 0) return;

  for (const item of cnaes) {
    // 1. Limpeza do Código (remove pontos, traços, barras)
    const codigoLimpo = String(item.codigo).replace(/\D/g, '');
    
    if (!codigoLimpo) continue;

    // --- A. GLOBAL CNAE ---
    // Verifica se já existe na tabela mestra
    const existeGlobal = await prisma.globalCnae.findUnique({
      where: { codigo: codigoLimpo }
    });

    // Se não existe, cria
    if (!existeGlobal) {
      await prisma.globalCnae.create({
        data: {
          codigo: codigoLimpo,
          descricao: item.descricao,
          itemLc: '', // Admin preencherá depois
          codigoTributacaoNacional: '' // Admin preencherá depois
        }
      });
      console.log(`[SYNC] CNAE Global criado: ${codigoLimpo}`);
    }

    // --- B. TRIBUTAÇÃO MUNICIPAL ---
    // Só cria se tivermos o IBGE da cidade
    if (codigoIbge) {
      // Verifica se JÁ EXISTE alguma regra para este CNAE nesta Cidade
      // (Não importa qual o código municipal, se já tiver um, não criamos duplicado)
      const existeRegra = await prisma.tributacaoMunicipal.findFirst({
        where: {
          cnae: codigoLimpo,
          codigoIbge: codigoIbge
        }
      });

      if (!existeRegra) {
        await prisma.tributacaoMunicipal.create({
          data: {
            cnae: codigoLimpo,
            codigoIbge: codigoIbge,
            codigoTributacaoMunicipal: 'A_DEFINIR', // Placeholder para editar depois
            descricaoServicoMunicipal: item.descricao
          }
        });
        console.log(`[SYNC] Regra Municipal criada: ${codigoLimpo} em ${codigoIbge}`);
      }
    }
  }
}
