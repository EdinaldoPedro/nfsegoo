import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { syncCnaesGlobalmente } from '@/app/services/syncService'; 
import { validateRequest } from '@/app/utils/api-security';
import { encrypt } from '@/app/utils/crypto';
import { hasEmpresaAccess, isAdminRole } from '@/app/utils/access-control';
import { validarCertificadoA1 } from '@/app/utils/certificadoA1Validation';
import { renovarUsoMensalSeNecessario } from '@/app/services/planService';

export const dynamic = 'force-dynamic';

const prisma = new PrismaClient();

async function buscarIbgePorCep(cep: string): Promise<string | null> {
    try {
        const cepLimpo = cep.replace(/\D/g, '');
        if (cepLimpo.length !== 8) return null;
        const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, { next: { revalidate: 3600 } });
        const data = await res.json();
        if (!data.erro && data.ibge) return data.ibge;
        return null;
    } catch (e) {
        return null;
    }
}

function codigoIbgeValido(codigo?: string | null) {
    return String(codigo || '').replace(/\D/g, '').length >= 7;
}

export async function GET(request: Request) {
  try {
      const { targetId, errorResponse } = await validateRequest(request);
      if (errorResponse) return errorResponse;

      const userId = targetId;
      const contextEmpresaId = request.headers.get('x-empresa-id');

      if (!userId) return NextResponse.json({ error: 'Proibido' }, { status: 401 });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { 
            empresa: true,
            empresasFaturadas: true,
            empresasProprietarias: true
        }
      });

      if (!user) return NextResponse.json({ error: 'User não encontrado' }, { status: 404 });

      const listaEmpresas: any[] = [];
      if (user.empresa) {
          listaEmpresas.push({ id: user.empresa.id, razaoSocial: user.empresa.razaoSocial || 'Minha Empresa Primária', cnpj: user.empresa.documento, isPrimary: true });
      }
      if (user.empresasFaturadas && user.empresasFaturadas.length > 0) {
          user.empresasFaturadas.forEach(emp => {
              if (emp.id !== user.empresaId) { 
                  listaEmpresas.push({ id: emp.id, razaoSocial: emp.razaoSocial || 'Empresa Adicional', cnpj: emp.documento, isPrimary: false });
              }
          });
      }
      if ((user as any).empresasProprietarias && (user as any).empresasProprietarias.length > 0) {
          (user as any).empresasProprietarias.forEach((emp: any) => {
              if (!listaEmpresas.some(e => e.id === emp.id)) {
                  listaEmpresas.push({ id: emp.id, razaoSocial: emp.razaoSocial || 'Empresa Proprietaria', cnpj: emp.documento, isPrimary: emp.id === user.empresaId });
              }
          });
      }

      const isStaff = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user.role);
      let planoDetalhado = null;

      if (isStaff) {
          planoDetalhado = {
              nome: 'Acesso Administrativo', slug: 'ADMIN_ACCESS', status: 'ATIVO',
              dataInicio: user.createdAt, dataFim: null, usoEmissoes: 0, limiteEmissoes: 0, diasTeste: 0,
              usoClientes: 0, limiteClientes: 0
          };
      } else {
            // === NOVO CÉREBRO NA API DE PERFIL ===
            await renovarUsoMensalSeNecessario(user.id);

            const historicosAtivos = await prisma.planHistory.findMany({
                where: { userId: user.id, status: 'ATIVO' },
                include: { plan: true },
                orderBy: { createdAt: 'asc' }
            });

            let limiteEmissoes = 0;
            let usoEmissoes = 0;
            let limiteClientes = 0;
            
            historicosAtivos.forEach((h: any) => {
                limiteEmissoes += h.plan.maxNotasMensal;
                usoEmissoes += h.notasEmitidas;
                limiteClientes += (h.plan.maxClientes || 0);
            });

            // Conta os clientes reais na carteira
            const usoClientes = await prisma.vinculoCarteira.count({
                where: {
                    arquivadoEm: null,
                    empresa: {
                        OR: [
                            { donoFaturamentoId: user.id },
                            { proprietarioUserId: user.id } as any,
                            { id: user.empresaId || '' }
                        ]
                    }
                }
            });

            const basePlan = historicosAtivos.find((h: any) => h.plan.tipo === 'PLANO') || historicosAtivos[0];

            let statusVisual = basePlan?.status || 'INATIVO';
            if (basePlan && limiteEmissoes > 0 && usoEmissoes >= limiteEmissoes) statusVisual = 'LIMITE_ATINGIDO';
            if (basePlan && basePlan.dataFim && new Date() > basePlan.dataFim) statusVisual = 'EXPIRADO';

            planoDetalhado = basePlan ? {
                nome: basePlan.plan?.name || 'Pacote Avulso', 
                slug: basePlan.plan?.slug || 'CUSTOM', 
                status: statusVisual,
                dataInicio: basePlan.dataInicio, 
                dataFim: basePlan.dataFim,
                usoEmissoes: usoEmissoes, 
                limiteEmissoes: limiteEmissoes, 
                diasTeste: basePlan.plan?.diasTeste || 0,
                usoClientes: usoClientes,
                limiteClientes: limiteClientes
            } : { nome: 'Sem Plano Ativo', slug: 'FREE', status: 'INATIVO', usoEmissoes: 0, limiteEmissoes: 0, usoClientes: 0, limiteClientes: 0 };
      }
      
      let empresaAlvoId = null;

      if (contextEmpresaId && contextEmpresaId !== 'null' && contextEmpresaId !== 'undefined') {
          if (isStaff) {
              empresaAlvoId = contextEmpresaId;
          } else {
              const isOwnCompany = listaEmpresas.some(e => e.id === contextEmpresaId);
              if (isOwnCompany) {
                  empresaAlvoId = contextEmpresaId;
              } else {
                  const vinculo = await prisma.contadorVinculo.findUnique({
                      where: { contadorId_empresaId: { contadorId: userId, empresaId: contextEmpresaId } }
                  });
                  if (vinculo) empresaAlvoId = contextEmpresaId; 
              }
          }
      }

      if (!empresaAlvoId) empresaAlvoId = user.empresaId;

      let dadosEmpresa: any = {};
      if (empresaAlvoId) {
          const emp = await prisma.empresa.findUnique({ where: { id: empresaAlvoId }, include: { atividades: true } });
          if (emp) {
              dadosEmpresa = emp;
              if (emp.cep && (!emp.codigoIbge || emp.codigoIbge.length < 7)) {
                  const ibgeNovo = await buscarIbgePorCep(emp.cep);
                  if (ibgeNovo) {
                      await prisma.empresa.update({ where: { id: emp.id }, data: { codigoIbge: ibgeNovo } });
                      dadosEmpresa.codigoIbge = ibgeNovo;
                  }
              }
          }
      }

      let atividadesEnriquecidas = dadosEmpresa.atividades || [];
      if (atividadesEnriquecidas.length > 0) {
          // CORREÇÃO CRÍTICA DO CNAE: Traz todos para fazer o match na memória ignorando pontos e traços
          const globais = await prisma.globalCnae.findMany();
          const regrasMunicipais = await prisma.tributacaoMunicipal.findMany({ 
              where: { codigoIbge: dadosEmpresa.codigoIbge || '' } 
          });

          atividadesEnriquecidas = atividadesEnriquecidas.map((local: any) => {
              // Limpa o CNAE local para a comparação
              const localClean = String(local.codigo).replace(/\D/g, '');
              
              // Procura no Admin cruzando apenas os números (Resolve empresas velhas e novas de uma vez)
              const global = globais.find((g: any) => String(g.codigo).replace(/\D/g, '') === localClean);
              const regraMun = regrasMunicipais.find((r: any) => String(r.cnae).replace(/\D/g, '') === localClean);

              return {
                  ...local,
                  temRetencaoInss: global?.temRetencaoInss || local.temRetencaoInss,
                  retemCrsf: global?.retemCrsf || false,
                  aliquotaCrsf: global?.aliquotaCrsf ? Number(global.aliquotaCrsf) : 4.65,
                  retemIr: global?.retemIr || false,
                  aliquotaIr: global?.aliquotaIr ? Number(global.aliquotaIr) : 1.50,
                  codigoNbs: global?.codigoNbs || local.codigoNbs,
                  aliquotaIss: regraMun?.aliquotaIss ? Number(regraMun.aliquotaIss) : null
              };
          });
      }

      // @ts-ignore
      const { certificadoA1, senhaCertificado, email: emailEmpresa, ...restEmpresa } = dadosEmpresa;

      return NextResponse.json({
        ...restEmpresa,
        emailComercial: emailEmpresa,
        temCertificado: !!certificadoA1,
        vencimentoCertificado: dadosEmpresa.certificadoVencimento,
        cadastroCompleto: dadosEmpresa.cadastroCompleto || false,
        atividades: atividadesEnriquecidas,

        role: user.role,
        id: user.id,
        nome: user.nome,
        email: user.email,
        cpf: user.cpf,
        telefone: user.telefone,
        cargo: user.cargo,
        tutorialStep: user.tutorialStep, 
        empresasAdicionais: user.empresasAdicionais,
        
        listaEmpresas,
        empresaPrimariaId: user.empresaId,

        configuracoes: { darkMode: user.darkMode, idioma: user.idioma, notificacoesEmail: user.notificacoesEmail },
        planoDetalhado,
        planoSlug: user.plano, 
        planoCiclo: user.planoCiclo,
        isContextMode: empresaAlvoId !== user.empresaId
      });
  } catch (error: any) {
      console.error("ERRO CRÍTICO NA API DE PERFIL:", error);
      return NextResponse.json({ error: 'Erro interno ao carregar perfil', detalhes: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { user: authenticatedUser, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  const userId = targetId;
  const contextEmpresaId = request.headers.get('x-empresa-id');
  const body = await request.json();

  if (!userId) return NextResponse.json({ error: 'Proibido' }, { status: 401 });

  try {
    const user = await prisma.user.findUnique({ 
        where: { id: userId },
        include: { empresa: true }
    });

    if (!user) {
        return NextResponse.json({ error: 'Usuario nao encontrado.' }, { status: 404 });
    }

    if (authenticatedUser?.id !== userId && !isAdminRole(authenticatedUser?.role)) {
        return NextResponse.json({ error: 'Acesso proibido.' }, { status: 403 });
    }

    const userDataToUpdate: any = {
        nome: body.nome,
        telefone: body.telefone,
        cargo: body.perfil?.cargo || body.cargo
    };

    if (body.configuracoes) {
        userDataToUpdate.darkMode = body.configuracoes.darkMode;
        userDataToUpdate.idioma = body.configuracoes.idioma;
        userDataToUpdate.notificacoesEmail = body.configuracoes.notificacoesEmail;
    }

    await prisma.user.update({ where: { id: userId }, data: userDataToUpdate });

    if (body.documento) {
      const cnpjLimpo = body.documento.replace(/\D/g, '');

      if (cnpjLimpo.length !== 14) {
          return NextResponse.json({ error: 'CNPJ invalido.' }, { status: 400 });
      }
      
      if (body.cep && (!body.codigoIbge || body.codigoIbge.length < 7)) {
          const ibgeResgatado = await buscarIbgePorCep(body.cep);
          if (ibgeResgatado) body.codigoIbge = ibgeResgatado;
      }

      const dadosEmpresa: any = {
          razaoSocial: body.razaoSocial, nomeFantasia: body.nomeFantasia, inscricaoMunicipal: body.inscricaoMunicipal,
          regimeTributario: body.regimeTributario, cep: body.cep, logradouro: body.logradouro,
          numero: body.numero, bairro: body.bairro, cidade: body.cidade, uf: body.uf,
          codigoIbge: body.codigoIbge, email: body.emailComercial || body.email,
          cadastroCompleto: true, serieDPS: body.serieDPS, 
          ultimoDPS: body.ultimoDPS ? parseInt(String(body.ultimoDPS)) : undefined, ambiente: body.ambiente
      };

      if (body.deletarCertificado) {
          dadosEmpresa.certificadoA1 = null; dadosEmpresa.senhaCertificado = null; dadosEmpresa.certificadoVencimento = null;
      } else if (body.certificadoArquivo && body.certificadoSenha) {
          try {
              const certificadoValidado = validarCertificadoA1(body.certificadoArquivo, body.certificadoSenha, cnpjLimpo);
              
              dadosEmpresa.certificadoA1 = encrypt(body.certificadoArquivo);
              dadosEmpresa.senhaCertificado = encrypt(body.certificadoSenha);
              dadosEmpresa.certificadoVencimento = certificadoValidado.vencimento;
          } catch (e: any) {
              if (e?.message) return NextResponse.json({ error: e.message }, { status: 400 });
              return NextResponse.json({ error: 'Senha incorreta ou arquivo inválido.' }, { status: 400 });
          }
      }

      const empresaExistente = await prisma.empresa.findUnique({
          where: { documento: cnpjLimpo },
          select: { id: true }
      });

      let empresaAlvoId: string | null = null;

      if (contextEmpresaId && contextEmpresaId !== 'null' && contextEmpresaId !== 'undefined') {
          const temAcessoAoContexto = await hasEmpresaAccess(user, contextEmpresaId);
          if (!temAcessoAoContexto) {
              return NextResponse.json({ error: 'Voce nao tem acesso a esta empresa.' }, { status: 403 });
          }

          if (empresaExistente && empresaExistente.id !== contextEmpresaId) {
              return NextResponse.json({ error: 'CNPJ ja cadastrado para outra empresa.' }, { status: 409 });
          }

          empresaAlvoId = contextEmpresaId;
      } else if (user.empresaId) {
          if (empresaExistente && empresaExistente.id !== user.empresaId) {
              return NextResponse.json({ error: 'CNPJ ja cadastrado para outra empresa.' }, { status: 409 });
          }

          empresaAlvoId = user.empresaId;
      } else if (empresaExistente) {
          const temAcessoEmpresaExistente = await hasEmpresaAccess(user, empresaExistente.id);
          if (!temAcessoEmpresaExistente) {
              return NextResponse.json({ error: 'CNPJ ja cadastrado para outra empresa.' }, { status: 409 });
          }

          empresaAlvoId = empresaExistente.id;
      }

      if (!codigoIbgeValido(dadosEmpresa.codigoIbge) && empresaAlvoId) {
          const empresaAtual = await prisma.empresa.findUnique({
              where: { id: empresaAlvoId },
              select: { codigoIbge: true }
          });
          if (codigoIbgeValido(empresaAtual?.codigoIbge)) {
              dadosEmpresa.codigoIbge = empresaAtual?.codigoIbge;
          }
      }

      const empresaSalva = empresaAlvoId
          ? await prisma.empresa.update({
              where: { id: empresaAlvoId },
              data: { documento: cnpjLimpo, ...dadosEmpresa }
          })
          : await prisma.empresa.create({
              data: { documento: cnpjLimpo, ...dadosEmpresa }
          });

      if (user?.empresaId !== empresaSalva.id && !contextEmpresaId) {
          await prisma.user.update({ where: { id: userId }, data: { empresaId: empresaSalva.id } });
      }

      if (body.cnaes && Array.isArray(body.cnaes)) {
          await prisma.cnae.deleteMany({ where: { empresaId: empresaSalva.id } });
          if (body.cnaes.length > 0) {
              await prisma.cnae.createMany({
                  data: body.cnaes.map((c: any) => ({
                      empresaId: empresaSalva.id, 
                      // CORREÇÃO CRÍTICA: Mantém a formatação do CNAE igual ao Painel Admin
                      codigo: String(c.codigo).trim(), 
                      descricao: c.descricao, 
                      principal: c.principal, 
                      codigoNbs: c.codigoNbs, 
                      temRetencaoInss: c.temRetencaoInss || false
                  }))
              });
              if (empresaSalva.codigoIbge) await syncCnaesGlobalmente(body.cnaes, empresaSalva.codigoIbge);
          }
      }
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
