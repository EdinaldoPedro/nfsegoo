import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { upsertEmpresaAndLinkUser } from '@/app/services/empresaService';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

const prisma = new PrismaClient();
const PENDING_LINK_STATUSES = ['PENDENTE', 'PENDENTE_DONO', 'PENDENTE_CUSTODIANTE'];

// GET
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');

  try {
    if (mode === 'contador') {
        if (!['CONTADOR', 'MASTER', 'ADMIN'].includes(user.role)) return forbidden();
        const vinculos = await prisma.contadorVinculo.findMany({
            where: { contadorId: user.id, arquivadoEm: null } as any,
            include: { empresa: true },
            orderBy: { updatedAt: 'desc' }
        });

        const inicioMes = new Date();
        inicioMes.setDate(1);
        inicioMes.setHours(0, 0, 0, 0);

        const vinculosComResumo = await Promise.all(vinculos.map(async (vinculo) => {
            const [notasMes, ultimaNota, clientesCarteira] = await Promise.all([
                prisma.notaFiscal.count({
                    where: {
                        empresaId: vinculo.empresaId,
                        status: 'AUTORIZADA',
                        arquivadoEm: null,
                        OR: [
                            { dataEmissao: { gte: inicioMes } },
                            { dataEmissao: null, createdAt: { gte: inicioMes } }
                        ]
                    } as any
                }),
                prisma.notaFiscal.findFirst({
                    where: { empresaId: vinculo.empresaId, status: 'AUTORIZADA', arquivadoEm: null } as any,
                    orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }],
                    select: { dataEmissao: true, createdAt: true, valor: true }
                }),
                prisma.vinculoCarteira.count({
                    where: { empresaId: vinculo.empresaId, arquivadoEm: null } as any
                })
            ]);

            return {
                ...vinculo,
                empresa: stripEmpresaSecrets(vinculo.empresa),
                resumo: {
                    notasMes,
                    clientesCarteira,
                    ultimaEmissao: ultimaNota?.dataEmissao || ultimaNota?.createdAt || null,
                    valorUltimaNota: ultimaNota?.valor || null
                }
            };
        }));

        return NextResponse.json(vinculosComResumo);
    }
    if (mode === 'pendentes-custodia') {
        if (!['CONTADOR', 'MASTER', 'ADMIN'].includes(user.role)) return forbidden();

        const empresasCustodiadas = await prisma.empresa.findMany({
            where: {
                OR: [
                    { contadorCustodianteId: user.id },
                    {
                        contadoresLink: {
                            some: {
                                contadorId: user.id,
                                status: 'APROVADO',
                                arquivadoEm: null,
                            } as any,
                        },
                    },
                ],
                arquivadoEm: null,
            } as any,
            select: { id: true },
        });
        const empresaIds = empresasCustodiadas.map((empresa) => empresa.id);

        if (empresaIds.length === 0) return NextResponse.json([]);

        const solicitacoes = await prisma.contadorVinculo.findMany({
            where: {
                empresaId: { in: empresaIds },
                contadorId: { not: user.id },
                status: 'PENDENTE_CUSTODIANTE',
                arquivadoEm: null,
            } as any,
            include: {
                contador: { select: { id: true, nome: true, email: true, telefone: true } },
                empresa: true,
            },
            orderBy: { updatedAt: 'asc' },
        });

        return NextResponse.json(solicitacoes.map((vinculo: any) => ({
            ...vinculo,
            empresa: stripEmpresaSecrets(vinculo.empresa),
        })));
    }
    if (mode === 'cliente') {
        if (!user.empresaId) return NextResponse.json([]);
        const solicitacoes = await prisma.contadorVinculo.findMany({
            where: { empresaId: user.empresaId, status: { in: ['PENDENTE', 'PENDENTE_DONO'] }, arquivadoEm: null } as any,
            include: { contador: { select: { nome: true, email: true } } }
        });
        return NextResponse.json(solicitacoes);
    }
    return NextResponse.json([]);
  } catch (e) { return NextResponse.json({ error: 'Erro ao buscar dados.' }, { status: 500 }); }
}

// POST
export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  
  if (user.role !== 'CONTADOR' && !['MASTER','ADMIN'].includes(user.role)) {
      return NextResponse.json({ error: 'Apenas contadores.' }, { status: 403 });
  }

  try {
    const { cnpj } = await request.json();
    if (!cnpj) return NextResponse.json({ error: 'CNPJ obrigatório.' }, { status: 400 });
    const cnpjLimpo = cnpj.replace(/\D/g, '');

    const dadosContador = await prisma.user.findUnique({ where: { id: user.id }, include: { empresasContabeis: true } });
    if (dadosContador) {
        const limite = dadosContador.limiteEmpresas || 100;
        if (dadosContador.empresasContabeis.length >= limite) return NextResponse.json({ error: `Limite atingido.` }, { status: 403 });
    }

    // Chama Service
    const resultado: any = await upsertEmpresaAndLinkUser(cnpjLimpo, user.id, null, 'CONTADOR');
    
    // Verifica se ficou PENDENTE ou APROVADO
    const isPendente = PENDING_LINK_STATUSES.includes(resultado._statusVinculo);
    const messageByStatus: Record<string, string> = {
        APROVADO: 'Empresa vinculada com sucesso!',
        PENDENTE: 'Solicitacao enviada ao dono da empresa.',
        PENDENTE_DONO: 'Solicitacao enviada ao dono da empresa.',
        PENDENTE_CUSTODIANTE: 'Solicitacao registrada. A liberacao depende do contador custodiante atual.'
    };

    return NextResponse.json({ 
        success: true, 
        message: messageByStatus[resultado._statusVinculo] || (isPendente ? 'Solicitacao pendente.' : 'Empresa vinculada com sucesso!'),
        status: resultado._statusVinculo 
    });

  } catch (e: any) { 
      console.error("[CONTADOR] Erro:", e);
      if (e.message && (e.message.includes("Empresa") && e.message.toLowerCase().includes("vinculada"))) {
          return NextResponse.json({ error: "Esta empresa já está na sua lista (ou aguardando aprovação)." }, { status: 409 });
      }
      return NextResponse.json({ error: 'Erro: ' + e.message }, { status: 500 }); 
  }
}

// PUT
export async function PUT(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    try {
        const { vinculoId, acao } = await request.json();
        const vinculo = await prisma.contadorVinculo.findUnique({
            where: { id: vinculoId },
            include: {
                empresa: {
                    select: {
                        id: true,
                        contadorCustodianteId: true,
                        donoFaturamentoId: true,
                    } as any,
                },
            },
        });
        if (!vinculo) return forbidden();

        const isCustodiaTransferencia = vinculo.status === 'PENDENTE_CUSTODIANTE';
        if (isCustodiaTransferencia) {
            const empresa = (vinculo as any).empresa;
            const isCustodianteDireto = empresa?.contadorCustodianteId === user.id;
            const vinculoAprovadoDoUsuario = await prisma.contadorVinculo.findFirst({
                where: {
                    empresaId: vinculo.empresaId,
                    contadorId: user.id,
                    status: 'APROVADO',
                    arquivadoEm: null,
                } as any,
                select: { id: true },
            });
            if (!isCustodianteDireto && !vinculoAprovadoDoUsuario && !['MASTER', 'ADMIN'].includes(user.role)) return forbidden();

            if (acao === 'REJEITAR') {
                await prisma.contadorVinculo.update({
                    where: { id: vinculoId },
                    data: { status: 'REJEITADO', arquivadoEm: new Date(), arquivadoPor: user.id, motivoArquivamento: 'Solicitacao rejeitada pelo contador custodiante.' } as any
                });
                return NextResponse.json({ success: true, message: 'Solicitacao recusada.' });
            }

            if (acao === 'LIBERAR_ACESSO') {
                await prisma.contadorVinculo.update({
                    where: { id: vinculoId },
                    data: {
                        status: 'APROVADO',
                        arquivadoEm: null,
                        arquivadoPor: null,
                        motivoArquivamento: null,
                    } as any,
                });
                return NextResponse.json({ success: true, message: 'Acesso concedido. A custodia principal foi mantida.' });
            }

            const custodianteAnteriorId = empresa?.contadorCustodianteId || user.id;
            const trocarCobranca = !empresa?.donoFaturamentoId || empresa.donoFaturamentoId === custodianteAnteriorId;

            await prisma.$transaction([
                prisma.contadorVinculo.updateMany({
                    where: {
                        empresaId: vinculo.empresaId,
                        contadorId: { not: vinculo.contadorId },
                        status: 'APROVADO',
                        arquivadoEm: null,
                    } as any,
                    data: {
                        status: 'DESVINCULADO',
                        arquivadoEm: new Date(),
                        arquivadoPor: user.id,
                        motivoArquivamento: 'Custodia transferida pelo contador atual.',
                    } as any,
                }),
                prisma.contadorVinculo.update({
                    where: { id: vinculoId },
                    data: { status: 'APROVADO', arquivadoEm: null, arquivadoPor: null, motivoArquivamento: null } as any,
                }),
                prisma.empresa.update({
                    where: { id: vinculo.empresaId },
                    data: {
                        contadorCustodianteId: vinculo.contadorId,
                        statusPropriedade: 'CUSTODIADA',
                        ...(trocarCobranca ? { donoFaturamentoId: vinculo.contadorId } : {}),
                    } as any,
                }),
            ]);

            return NextResponse.json({ success: true, message: 'Vinculo liberado e custodia transferida.' });
        }

        if (!vinculo || vinculo.empresaId !== user.empresaId) return forbidden();
        
        if (acao === 'REJEITAR') {
            await prisma.contadorVinculo.update({
                where: { id: vinculoId },
                data: { status: 'REJEITADO', arquivadoEm: new Date(), arquivadoPor: user.id, motivoArquivamento: 'Solicitacao rejeitada pelo cliente.' } as any
            });
            return NextResponse.json({ success: true, message: 'Recusado.' });
        }
        await prisma.contadorVinculo.update({ where: { id: vinculoId }, data: { status: 'APROVADO' } });
        return NextResponse.json({ success: true, message: 'Aprovado!' });
    } catch (e) { return NextResponse.json({ error: 'Erro interno.' }, { status: 500 }); }
}

// DELETE
export async function DELETE(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'ID necessário' }, { status: 400 });
        const vinculo = await prisma.contadorVinculo.findUnique({ where: { id } });
        if (!vinculo) return NextResponse.json({ error: 'Vínculo não encontrado' }, { status: 404 });
        if (vinculo.contadorId !== user.id && !['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
        await prisma.contadorVinculo.update({
            where: { id },
            data: { status: 'DESVINCULADO', arquivadoEm: new Date(), arquivadoPor: user.id, motivoArquivamento: 'Desvinculo solicitado pelo usuario.' } as any
        });
        return NextResponse.json({ success: true });
    } catch (e) { return NextResponse.json({ error: 'Erro ao desvincular.' }, { status: 500 }); }
}
