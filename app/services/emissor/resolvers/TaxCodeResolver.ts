import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class TaxCodeResolver {
    
    // Adicionamos empresaId opcional para buscar na tabela Cnae correta
    static async resolve(ibgeMunicipio: string, cnae: string, empresaId?: string, dataCompetencia?: string): Promise<{ codigoNbs?: string, codigoMunicipal?: string }> {
        let resultado = { codigoNbs: undefined as string | undefined, codigoMunicipal: undefined as string | undefined };
        const competencia = new Date(`${String(dataCompetencia || new Date().toISOString().slice(0, 10)).slice(0, 10)}T12:00:00.000Z`);

        const regras = await prisma.tributacaoMunicipal.findMany({
            where: {
                codigoIbge: ibgeMunicipio,
                ativo: true,
                AND: [
                    { OR: [{ inicioVigencia: null }, { inicioVigencia: { lte: competencia } }] },
                    { OR: [{ fimVigencia: null }, { fimVigencia: { gte: competencia } }] },
                ],
            },
            orderBy: [{ prioridade: 'desc' }, { updatedAt: 'desc' }],
        });
        const tributacao = regras.find((item) => String(item.cnae).replace(/\D/g, '') === String(cnae).replace(/\D/g, ''));
        if (tributacao?.codigoTributacaoMunicipal) {
            resultado.codigoMunicipal = tributacao.codigoTributacaoMunicipal;
        }

        if (tributacao?.exigeNbs) {
            if (tributacao.nbsPadrao) resultado.codigoNbs = tributacao.nbsPadrao;
            // Tenta buscar na tabela Cnae da empresa primeiro (se tiver ID)
            if (!resultado.codigoNbs && empresaId) {
                const cnaeEmpresa = await prisma.cnae.findFirst({
                    where: { codigo: cnae, empresaId: empresaId }
                });
                if (cnaeEmpresa?.codigoNbs) {
                    resultado.codigoNbs = cnaeEmpresa.codigoNbs;
                    return resultado; // Achou, retorna.
                }
            }

            // Fallback: Busca na tabela GlobalCnae se não achou na empresa
            const cnaeGlobal = !resultado.codigoNbs ? await prisma.globalCnae.findFirst({
                where: {
                    codigo: cnae,
                    AND: [
                        { OR: [{ inicioVigencia: null }, { inicioVigencia: { lte: competencia } }] },
                        { OR: [{ fimVigencia: null }, { fimVigencia: { gte: competencia } }] },
                    ],
                },
            }) : null;
            if (cnaeGlobal?.codigoNbs) {
                resultado.codigoNbs = cnaeGlobal.codigoNbs;
            }
        }

        return resultado;
    }
}
