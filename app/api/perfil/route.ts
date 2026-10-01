import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/app/utils/prisma';
import { validateRequest } from '@/app/utils/api-security';
import { getAccessibleEmpresaIds, hasInternalCustomerAccess, resolveEmpresaContexto } from '@/app/utils/access-control';
import { getEffectivePlanLimits } from '@/app/services/planService';
import { listDpsSequences } from '@/app/services/dpsSequenceService';
import { ProfileError, updateProfile } from '@/app/services/profileService';
import { checkRateLimit } from '@/app/utils/rate-limit';

export const dynamic = 'force-dynamic';


export const GET = withApiGuard(async function GET(request: Request) {
      const { targetId, errorResponse } = await validateRequest(request);
      if (errorResponse) return errorResponse;

      const userId = targetId;
      const contextEmpresaId = request.headers.get('x-empresa-id');

      if (!userId) return NextResponse.json({ error: 'Proibido' }, { status: 401 });

      const user = await prisma.user.findUnique({ where: { id: userId }, select: {
        id: true, role: true, empresaId: true, nome: true, email: true, cpf: true, telefone: true, cargo: true,
        tutorialStep: true, empresasAdicionais: true, createdAt: true, plano: true, planoCiclo: true,
        darkMode: true, idioma: true, notificacoesEmail: true,
      } });
      if (!user) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
      const isStaff = !['COMUM', 'CONTADOR'].includes(user.role);
      // Um colaborador interno pode também ser cliente do SaaS. Nesse caso,
      // somente as PJs das quais ele é titular ficam disponíveis no portal do
      // cliente; o cargo administrativo não concede acesso a empresas alheias.
      const staffCustomerAllowed = !isStaff || await hasInternalCustomerAccess(user.id);
      const accessibleIds = isStaff
        ? (!staffCustomerAllowed ? [] : (await prisma.empresa.findMany({ where: {
            arquivadoEm: null,
            OR: [{ proprietarioUserId: user.id }, ...(user.empresaId ? [{ id: user.empresaId }] : [])],
          }, select: { id: true } })).map(({ id }) => id))
        : await getAccessibleEmpresaIds(user) || [];
      const companies = accessibleIds.length ? await prisma.empresa.findMany({ where: { id: { in: accessibleIds }, arquivadoEm: null },
        select: { id: true, razaoSocial: true, documento: true, ambiente: true, cadastroCompleto: true,
          certificadoVencimento: true, certificadoValidadoEm: true }, orderBy: [{ razaoSocial: 'asc' }, { id: 'asc' }] }) : [];
      const listaEmpresas = companies.map(emp => ({ id: emp.id, razaoSocial: emp.razaoSocial, cnpj: emp.documento,
        ambiente: emp.ambiente, cadastroCompleto: emp.cadastroCompleto, certificadoVencimento: emp.certificadoVencimento,
        certificadoValidado: Boolean(emp.certificadoValidadoEm), isPrimary: emp.id === user.empresaId }));
      const limits = await getEffectivePlanLimits(user.id);
      const planoDetalhado = {
        nome: limits.planoBase?.nome || 'Sem plano vigente', slug: limits.planoBase?.slug || 'FREE',
        status: limits.allowedBase && !limits.unlimited && limits.notasUsadas >= limits.limiteNotas ? 'LIMITE_ATINGIDO' : limits.status,
        dataInicio: limits.planoBase?.dataInicio, dataFim: limits.planoBase?.dataFim,
        usoEmissoes: limits.notasUsadas, limiteEmissoes: limits.limiteNotas, diasTeste: limits.planoBase?.diasTeste || 0,
        usoClientes: limits.clientesUsados, limiteClientes: limits.limiteClientes, unlimited: limits.unlimited,
      };

      const hasContext = !!contextEmpresaId && !['null', 'undefined'].includes(contextEmpresaId);
      const accountOnly = new URL(request.url).searchParams.get('escopo') === 'CONTA' && !hasContext;
      const requestedEmpresaId = hasContext ? contextEmpresaId : (user.empresaId || accessibleIds[0] || null);
      const empresaAlvoId = accountOnly
        ? null
        : isStaff
          ? (requestedEmpresaId && accessibleIds.includes(requestedEmpresaId) ? requestedEmpresaId : null)
          : await resolveEmpresaContexto(user, contextEmpresaId);
      if (hasContext && !empresaAlvoId) return NextResponse.json({ error: 'Você não tem acesso aprovado a esta empresa.' }, { status: 403 });
      let dadosEmpresa: any = {};
      let temCertificado = false;
      if (empresaAlvoId) {
        const emp = await prisma.empresa.findFirst({ where: { id: empresaAlvoId, arquivadoEm: null }, select: {
          id: true, documento: true, ambiente: true, cadastroCompleto: true, serieDPS: true, ultimoDPS: true, email: true,
          razaoSocial: true, nomeFantasia: true, cep: true, logradouro: true, numero: true, complemento: true, bairro: true,
          cidade: true, uf: true, codigoIbge: true, aliquotaPadrao: true, issRetidoPadrao: true, tipoTributacaoPadrao: true,
          regimeEspecialTributacao: true, inscricaoMunicipal: true, regimeTributario: true, certificadoVencimento: true,
          updatedAt: true, atividades: { orderBy: [{ principal: 'desc' }, { codigo: 'asc' }], take: 101 },
        } });
        if (!emp) return NextResponse.json({ error: 'Empresa indisponível.' }, { status: 403 });
        if (emp.atividades.length > 100) return NextResponse.json({ error: 'Cadastro legado com mais de 100 atividades. Solicite revisão ao atendimento; não será carregada uma lista parcial para edição.' }, { status: 422 });
        const flags = await prisma.$queryRaw<Array<{ available: boolean }>>`
          SELECT (COALESCE(octet_length("certificadoA1"), 0) > 0) AS available FROM "Empresa" WHERE "id" = ${emp.id} AND "arquivadoEm" IS NULL
        `;
        temCertificado = flags[0]?.available ?? false;
        dadosEmpresa = { ...emp, sequenciasDps: await listDpsSequences(emp.id) };
      }

      let atividadesEnriquecidas = dadosEmpresa.atividades || [];
      if (atividadesEnriquecidas.length > 0) {
          const configuracoesProprias = await prisma.$queryRaw<Array<{ cnaeId: string; ativo: boolean; configuracao: any; versao: number; updatedAt: Date }>>`
            SELECT "cnaeId", "ativo", "configuracao", "versao", "updatedAt" FROM "EmpresaCnaeConfiguracaoFiscal" WHERE "empresaId" = ${empresaAlvoId!}
          `;
          const codes = atividadesEnriquecidas.map((item: any) => String(item.codigo).replace(/[./-]/g, ''));
          const variants = [...new Set<string>(codes.flatMap((code: string) => [code, code.replace(/^(\d{4})(\d)(\d{2})$/, '$1-$2/$3')]))];
          const globais = await prisma.globalCnae.findMany({ where: { codigo: { in: variants } } });
          const agora = new Date();
          const regrasMunicipais = await prisma.tributacaoMunicipal.findMany({ 
              where: {
                codigoIbge: dadosEmpresa.codigoIbge || '',
                cnae: { in: variants },
                ativo: true,
                AND: [
                  { OR: [{ inicioVigencia: null }, { inicioVigencia: { lte: agora } }] },
                  { OR: [{ fimVigencia: null }, { fimVigencia: { gte: agora } }] },
                ],
              },
              orderBy: [{ prioridade: 'desc' }, { updatedAt: 'desc' }],
          });

          atividadesEnriquecidas = atividadesEnriquecidas.map((local: any) => {
              // Limpa o CNAE local para a comparação
              const localClean = String(local.codigo).replace(/\D/g, '');
              
              // Procura no Admin cruzando apenas os números (Resolve empresas velhas e novas de uma vez)
              const global = globais.find((g: any) => String(g.codigo).replace(/\D/g, '') === localClean);
              const regraMun = regrasMunicipais.find((r: any) => String(r.cnae).replace(/\D/g, '') === localClean);

              const sugestaoNacional = global ? {
                origem: 'PADRAO_NACIONAL',
                titulo: 'Padrão nacional do SaaS',
                fonteNormativa: global.fonteNormativa || null,
                inicioVigencia: global.inicioVigencia?.toISOString() || null,
                fimVigencia: global.fimVigencia?.toISOString() || null,
                configuracao: {
                  codigoTributacaoNacional: global.codigoTributacaoNacional || '', itemLc: global.itemLc || '',
                  codigoTributacaoMunicipal: '', descricaoServicoMunicipal: '', tipoTributacao: '1',
                  aliquotaIss: global.aliquotaPadrao != null ? String(global.aliquotaPadrao) : '',
                  exigeCodigoTributacaoMunicipal: false, exigeNbs: Boolean(global.codigoNbs), nbsPadrao: global.codigoNbs || '',
                  modoRetencoes: global.modoRetencoes || 'SUGERIR', retemCrsf: global.retemCrsf,
                  aliquotaPisRetencao: global.aliquotaPisRetencao != null ? String(global.aliquotaPisRetencao) : '',
                  aliquotaCofinsRetencao: global.aliquotaCofinsRetencao != null ? String(global.aliquotaCofinsRetencao) : '',
                  aliquotaCsllRetencao: global.aliquotaCsllRetencao != null ? String(global.aliquotaCsllRetencao) : '',
                  retemIr: global.retemIr, aliquotaIr: global.aliquotaIr != null ? String(global.aliquotaIr) : '',
                  retemInss: global.temRetencaoInss, aliquotaInss: global.aliquotaInss != null ? String(global.aliquotaInss) : '',
                  habilitaIbsCbs: global.habilitaIbsCbs === true, codigoIndicadorOperacao: global.codigoIndicadorOperacao || '',
                  cstIbsCbs: global.cstIbsCbs || '', classeTribIbsCbs: global.classeTribIbsCbs || '',
                  finNfsePadrao: '0', indFinalPadrao: '0', indDestPadrao: '0', complementares: global.complementares || [],
                },
              } : null;
              const sugestaoMunicipal = regraMun ? {
                origem: 'REGRA_MUNICIPAL', titulo: `Regra municipal (${dadosEmpresa.codigoIbge})`, codigoIbge: dadosEmpresa.codigoIbge,
                fonteNormativa: regraMun.fonteNormativa || null, inicioVigencia: regraMun.inicioVigencia?.toISOString() || null,
                fimVigencia: regraMun.fimVigencia?.toISOString() || null,
                configuracao: {
                  ...(sugestaoNacional?.configuracao || {}), codigoTributacaoMunicipal: regraMun.codigoTributacaoMunicipal,
                  descricaoServicoMunicipal: regraMun.descricaoServicoMunicipal || '',
                  aliquotaIss: regraMun.aliquotaIss != null ? String(regraMun.aliquotaIss) : (sugestaoNacional?.configuracao.aliquotaIss || ''),
                  exigeCodigoTributacaoMunicipal: regraMun.exigeCodigoTributacaoMunicipal, exigeNbs: regraMun.exigeNbs,
                  nbsPadrao: regraMun.nbsPadrao || sugestaoNacional?.configuracao.nbsPadrao || '',
                  modoRetencoes: regraMun.modoRetencoes !== 'HERDAR' ? regraMun.modoRetencoes : (sugestaoNacional?.configuracao.modoRetencoes || 'SUGERIR'),
                  retemCrsf: regraMun.retemCrsf ?? sugestaoNacional?.configuracao.retemCrsf ?? false,
                  aliquotaPisRetencao: regraMun.aliquotaPisRetencao != null ? String(regraMun.aliquotaPisRetencao) : sugestaoNacional?.configuracao.aliquotaPisRetencao || '',
                  aliquotaCofinsRetencao: regraMun.aliquotaCofinsRetencao != null ? String(regraMun.aliquotaCofinsRetencao) : sugestaoNacional?.configuracao.aliquotaCofinsRetencao || '',
                  aliquotaCsllRetencao: regraMun.aliquotaCsllRetencao != null ? String(regraMun.aliquotaCsllRetencao) : sugestaoNacional?.configuracao.aliquotaCsllRetencao || '',
                  retemIr: regraMun.retemIr ?? sugestaoNacional?.configuracao.retemIr ?? false,
                  aliquotaIr: regraMun.aliquotaIr != null ? String(regraMun.aliquotaIr) : sugestaoNacional?.configuracao.aliquotaIr || '',
                  retemInss: regraMun.retemInss ?? sugestaoNacional?.configuracao.retemInss ?? false,
                  aliquotaInss: regraMun.aliquotaInss != null ? String(regraMun.aliquotaInss) : sugestaoNacional?.configuracao.aliquotaInss || '',
                  habilitaIbsCbs: regraMun.habilitaIbsCbs ?? sugestaoNacional?.configuracao.habilitaIbsCbs ?? false,
                  codigoIndicadorOperacao: regraMun.codigoIndicadorOperacao || sugestaoNacional?.configuracao.codigoIndicadorOperacao || '',
                  cstIbsCbs: regraMun.cstIbsCbs || sugestaoNacional?.configuracao.cstIbsCbs || '',
                  classeTribIbsCbs: regraMun.classeTribIbsCbs || sugestaoNacional?.configuracao.classeTribIbsCbs || '',
                  finNfsePadrao: regraMun.finNfsePadrao || '0', indFinalPadrao: regraMun.indFinalPadrao || '0', indDestPadrao: regraMun.indDestPadrao || '0',
                },
              } : null;

              return {
                  ...local,
                  configuracaoFiscalPropria: configuracoesProprias.find((config) => config.cnaeId === local.id) || null,
                  sugestaoFiscalNacional: sugestaoNacional,
                  sugestaoFiscalMunicipal: sugestaoMunicipal,
                  temRetencaoInss: regraMun?.retemInss ?? global?.temRetencaoInss ?? local.temRetencaoInss,
                  retemCrsf: regraMun?.retemCrsf ?? global?.retemCrsf ?? false,
                  aliquotaCrsf: global?.aliquotaCrsf ? Number(global.aliquotaCrsf) : 4.65,
                  aliquotaPisRetencao: regraMun?.aliquotaPisRetencao != null ? Number(regraMun.aliquotaPisRetencao) : (global?.aliquotaPisRetencao != null ? Number(global.aliquotaPisRetencao) : 0.65),
                  aliquotaCofinsRetencao: regraMun?.aliquotaCofinsRetencao != null ? Number(regraMun.aliquotaCofinsRetencao) : (global?.aliquotaCofinsRetencao != null ? Number(global.aliquotaCofinsRetencao) : 3.00),
                  aliquotaCsllRetencao: regraMun?.aliquotaCsllRetencao != null ? Number(regraMun.aliquotaCsllRetencao) : (global?.aliquotaCsllRetencao != null ? Number(global.aliquotaCsllRetencao) : 1.00),
                  valorMinimoRetencaoCrsf: regraMun?.valorMinimoRetencaoCrsf != null ? Number(regraMun.valorMinimoRetencaoCrsf) : (global?.valorMinimoRetencaoCrsf != null ? Number(global.valorMinimoRetencaoCrsf) : 10.01),
                  valorMinimoRetencaoIr: regraMun?.valorMinimoRetencaoIr != null ? Number(regraMun.valorMinimoRetencaoIr) : (global?.valorMinimoRetencaoIr != null ? Number(global.valorMinimoRetencaoIr) : 10.01),
                  retemIr: regraMun?.retemIr ?? global?.retemIr ?? false,
                  aliquotaIr: regraMun?.aliquotaIr != null ? Number(regraMun.aliquotaIr) : (global?.aliquotaIr != null ? Number(global.aliquotaIr) : 1.50),
                  aliquotaInss: regraMun?.aliquotaInss != null ? Number(regraMun.aliquotaInss) : (global?.aliquotaInss != null ? Number(global.aliquotaInss) : 11),
                  codigoNbs: regraMun?.nbsPadrao || global?.codigoNbs || local.codigoNbs,
                  exigeNbs: regraMun?.exigeNbs || false,
                  aliquotaIss: regraMun?.aliquotaIss ? Number(regraMun.aliquotaIss) : null,
                  modoRetencoes: regraMun?.modoRetencoes && regraMun.modoRetencoes !== 'HERDAR'
                    ? regraMun.modoRetencoes
                    : global?.modoRetencoes || 'SUGERIR',
                  fiscalRuleConfigured: !!regraMun,
                  ibscbsConfigured: !!(regraMun?.habilitaIbsCbs || global?.habilitaIbsCbs),
                  complementares: global?.complementares || [],
              };
          });
      }

      const { email: emailEmpresa, ...restEmpresa } = dadosEmpresa;

      return NextResponse.json({
        ...restEmpresa,
        emailComercial: emailEmpresa,
        temCertificado,
        empresaContextoId: empresaAlvoId,
        empresaAtualizadaEm: dadosEmpresa.updatedAt?.toISOString() ?? null,
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
        limiteEmpresasTotal: limits.limiteEmpresas,
        empresasUsadas: limits.empresasUsadas,
        podeCadastrarEmpresa: limits.allowedBase,
        planoIlimitado: limits.unlimited,
        
        listaEmpresas,
        empresaPrimariaId: user.empresaId,

        configuracoes: { darkMode: user.darkMode, idioma: user.idioma, notificacoesEmail: user.notificacoesEmail },
        planoDetalhado,
        planoSlug: user.plano, 
        planoCiclo: user.planoCiclo,
        isContextMode: !!empresaAlvoId && empresaAlvoId !== user.empresaId
      });
});

export const PUT = withApiGuard(async function PUT(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || user.id !== targetId) return NextResponse.json({ error: 'Alteração de perfil exige a própria conta.' }, { status: 403 });
  if (!await checkRateLimit(`profile_update_${user.id}`, 20, 5 * 60 * 1000)) return NextResponse.json({ error: 'Muitas alterações. Aguarde cinco minutos.' }, { status: 429 });
  try {
    return NextResponse.json(await updateProfile(user.id, request.headers.get('x-empresa-id'), await request.json()));
  } catch (error) {
    if (error instanceof ProfileError || (error instanceof Error && 'status' in error && Number(error.status) < 500)) {
      return NextResponse.json({ error: error.message }, { status: Number((error as ProfileError).status) });
    }
    throw error;
  }
}, { maxBodyBytes: 2 * 1024 * 1024 });
