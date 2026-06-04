import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { createLog } from '@/app/services/logger';
import { EmissorFactory } from '@/app/services/emissor/factories/EmissorFactory'; 
import { getTributacaoPorCnae } from '@/app/utils/tributacao'; 
import { processarRetornoNota } from '@/app/services/notaProcessor';
import { unauthorized, forbidden } from '@/app/utils/api-middleware';
import { checkPlanLimits, incrementUsage, resolveBillingUserId } from '@/app/services/planService';
import { validateRequest } from "@/app/utils/api-security"; 

const prisma = new PrismaClient();

async function getEmpresaContexto(user: any, contextId: string | null) {
    const isStaff = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(user.role);
    
    if (contextId && contextId !== 'null' && contextId !== 'undefined') {
        // 1. Admin/Staff
        if (isStaff) return contextId;
        
        // 2. Própria empresa do usuário
        if (contextId === user.empresaId) return contextId;
        
        // 3. Colaborador/Convidado (UserCliente)
        const colaborador = await prisma.userCliente.findUnique({
            where: { userId_empresaId: { userId: user.id, empresaId: contextId } }
        });
        if (colaborador) return contextId;
        
        // 4. Contador aprovado
        const vinculo = await prisma.contadorVinculo.findUnique({
            where: { contadorId_empresaId: { contadorId: user.id, empresaId: contextId } }
        });
        if (vinculo && vinculo.status === 'APROVADO' && !(vinculo as any).arquivadoEm) return contextId;
        
        // 5. Dono do faturamento (Guarda-chuva)
        const empresaAdicional = null;
        if (empresaAdicional) return contextId;

        return null; 
    }
    
    return user.empresaId;
}

export async function POST(request: Request) {
  const { targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  
  const user = await prisma.user.findUnique({ where: { id: targetId } });
  if (!user) return unauthorized();

  const contextId = request.headers.get('x-empresa-id');
  let vendaIdLog = null;
  let empresaIdLog = null;

  try {
    const body = await request.json();
    const { clienteId, valor, descricao, codigoCnae, vendaId, aliquota, issRetido, retencoes, numeroDPS, serieDPS, valorMoedaEstrangeira, dataCompetencia } = body;

    const empresaIdAlvo = await getEmpresaContexto(user, contextId);
    if (!empresaIdAlvo) return forbidden();
    empresaIdLog = empresaIdAlvo;

    // --- PRÉ-VALIDAÇÕES ANTES DE CRIAR A VENDA ---
    const prestador = await prisma.empresa.findUnique({ where: { id: empresaIdAlvo } });
    if (!prestador || !prestador.documento) {
        return NextResponse.json({ 
            error: "Cadastro incompleto.", 
            userAction: "Você ainda não concluiu o cadastro da sua Empresa. Acesse as Configurações para preencher seus dados básicos." 
        }, { status: 400 });
    }

    if (!prestador.certificadoA1) {
        return NextResponse.json({ 
            error: "Certificado não encontrado.", 
            userAction: "Para emitir notas, você precisa de um Certificado Digital (e-CNPJ). Acesse as Configurações da Empresa e faça o upload do seu certificado A1." 
        }, { status: 400 });
    }

    const tomador = await prisma.cliente.findUnique({ where: { id: clienteId } }); 
    if (!tomador) throw new Error("Tomador (Cliente) não encontrado.");

    // === NOVO: INTELIGÊNCIA DE GUARDA-CHUVA (UMBRELLA BILLING) ===
    let planHistoryId: string | null = null;
    let donoFaturamentoId = await resolveBillingUserId({
        empresaId: empresaIdAlvo,
        actorUserId: user.id,
        acao: 'EMITIR'
    });
    
    // Se não tiver donoFaturamentoId (é a empresa primária de alguém), busca o dono original
    if (!donoFaturamentoId) {
        const donoEmpresa = await prisma.user.findFirst({
            where: { empresaId: empresaIdAlvo, role: { notIn: ['CONTADOR', 'SUPORTE', 'SUPORTE_TI'] } },
            orderBy: { createdAt: 'asc' }
        });
        if (donoEmpresa) donoFaturamentoId = donoEmpresa.id;
    }

    // Se achou alguém para pagar a conta, verifica o limite na carteira dele
    if (donoFaturamentoId) {
        const planCheck = await checkPlanLimits(donoFaturamentoId, 'EMITIR');
        if (!planCheck.allowed) {
            return NextResponse.json({ 
                error: "Limite de emissão atingido.", 
                userAction: "A carteira de consumo responsável por este CNPJ atingiu o limite ou o plano expirou.", 
                code: planCheck.status 
            }, { status: 403 });
        }
        planHistoryId = planCheck.historyId || null;
    } else {
        // Se a empresa é "Órfã" (criada do zero) e quem está a tentar emitir é o Contador
        if (user.role === 'CONTADOR') {
            const checkContador = await checkPlanLimits(user.id, 'EMITIR');
            if (!checkContador.allowed) {
                 return NextResponse.json({ 
                     error: "Limite do seu plano de Contador atingido.", 
                     userAction: "O seu limite global de emissões para empresas órfãs acabou. Renove o seu pacote.",
                     code: checkContador.status 
                 }, { status: 403 });
            }
            planHistoryId = checkContador.historyId || null;
        }
    }

    const valorFloat = parseFloat(valor);
    let venda;
    
    // SÓ CRIA A VENDA SE PASSOU NAS PRÉ-VALIDAÇÕES
    if (vendaId) {
        venda = await prisma.venda.update({
            where: { id: vendaId },
            data: { valor: valorFloat, descricao: descricao, status: "PROCESSANDO" }
        });
    } else {
        venda = await prisma.venda.create({
            data: { empresaId: prestador.id, clienteId: tomador.id, valor: valorFloat, descricao: descricao, status: "PROCESSANDO" }
        });
    }
    vendaIdLog = venda.id;

    let dpsFinal = 0;
    const serieFinal = serieDPS || prestador.serieDPS || '900';

    if (numeroDPS) {
        dpsFinal = parseInt(numeroDPS);
        if (dpsFinal > (prestador.ultimoDPS || 0) && prestador.ambiente === 'PRODUCAO') {
            await prisma.empresa.update({ where: { id: prestador.id }, data: { ultimoDPS: dpsFinal } });
        }
    } else {
        dpsFinal = (prestador.ultimoDPS || 0) + 1;
        if (prestador.ambiente === 'PRODUCAO') {
            await prisma.empresa.update({ where: { id: prestador.id }, data: { ultimoDPS: dpsFinal } });
        }
    }

    let cnaeFinal = codigoCnae ? String(codigoCnae).replace(/\D/g, '') : '';
    if (!cnaeFinal) {
        const cnaeBanco = await prisma.cnae.findFirst({ where: { empresaId: prestador.id, principal: true } });
        if (cnaeBanco) cnaeFinal = cnaeBanco.codigo.replace(/\D/g, '');
    }
    if (!cnaeFinal) throw new Error("CNAE é obrigatório para emissão.");

    let codigoTribNacional = '000000'; 
    let itemLc = '00.00';
    let nbsEncontrado = ''; 
    let codigoNbs = '';     

    const infoEstatica = getTributacaoPorCnae(cnaeFinal);
    if (infoEstatica) {
         itemLc = infoEstatica.itemLC;
         codigoTribNacional = infoEstatica.codigoTributacaoNacional.replace(/\D/g, '');
         if ((infoEstatica as any).codigoNbs) nbsEncontrado = (infoEstatica as any).codigoNbs;
    }
    
    const regraGlobal = await prisma.globalCnae.findUnique({ where: { codigo: cnaeFinal } });
    if (regraGlobal) {
        if (regraGlobal.itemLc) itemLc = regraGlobal.itemLc;
        if (regraGlobal.codigoTributacaoNacional) codigoTribNacional = regraGlobal.codigoTributacaoNacional.replace(/\D/g, '');
        if ((regraGlobal as any).codigoNbs) nbsEncontrado = (regraGlobal as any).codigoNbs;
    }

    const regraMunicipal = await prisma.tributacaoMunicipal.findFirst({
        where: {
            cnae: cnaeFinal,
            codigoIbge: prestador.codigoIbge || ''
        }
    });

    if (regraMunicipal?.exigeNbs && nbsEncontrado) {
        codigoNbs = nbsEncontrado;
    }

    const semEnderecoTomador = tomador.tipo === 'PF' && (tomador as any).semEndereco === true;
    const tomadorAdaptado = { 
        ...tomador, 
        razaoSocial: tomador.nome, 
        documento: tomador.documento || '', 
        inscricaoMunicipal: tomador.inscricaoMunicipal ? String(tomador.inscricaoMunicipal) : undefined,
        codigoIbge: semEnderecoTomador ? '' : tomador.codigoIbge || '9999999',
        tipo: tomador.tipo,
        nif: tomador.nif,
        pais: tomador.pais,
        moeda: tomador.moeda,
        semEndereco: semEnderecoTomador,
        endereco: {
            cep: semEnderecoTomador ? '' : tomador.cep || '',
            logradouro: semEnderecoTomador ? '' : tomador.logradouro || '',
            numero: semEnderecoTomador ? '' : tomador.numero || '',
            bairro: semEnderecoTomador ? '' : tomador.bairro || '',
            cidade: semEnderecoTomador ? '' : tomador.cidade || '',
            codigoIbge: semEnderecoTomador ? '' : tomador.codigoIbge || '9999999',
            uf: semEnderecoTomador ? '' : tomador.uf || ''
        }
    };

    const dadosParaEstrategia = {
        prestador, tomador: tomadorAdaptado, venda,
        servico: {
            valor: valorFloat, 
            valorMoedaEstrangeira: valorMoedaEstrangeira ? parseFloat(valorMoedaEstrangeira) : undefined,
            codigoNbs: codigoNbs, 
            codigoTributacaoMunicipal: regraMunicipal?.codigoTributacaoMunicipal,
            
            // ---> ADICIONE ESTA LINHA ABAIXO <---
            aliquotaMunicipio: regraMunicipal?.aliquotaIss ? Number(regraMunicipal.aliquotaIss) : null, 
            
            descricao, cnae: cnaeFinal, itemLc, codigoTribNacional,
            aliquota: aliquota ? parseFloat(aliquota) : 0, issRetido: !!issRetido, retencoes: retencoes
        },
        ambiente: prestador.ambiente as 'HOMOLOGACAO' | 'PRODUCAO',
        numeroDPS: dpsFinal, serieDPS: serieFinal, dataCompetencia: dataCompetencia
    };

    const strategy = EmissorFactory.getStrategy(prestador);
    
    let resultado: any; 
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
        resultado = await strategy.executar(dadosParaEstrategia);
        
        const erroTexto = resultado.erros ? JSON.stringify(resultado.erros).toLowerCase() : '';
        if (!resultado.sucesso && (erroTexto.includes('e999') || erroTexto.includes('e0008')) && tentativa < 5) {
            await new Promise(resolve => setTimeout(resolve, 4000));
            continue;
        }
        break; 
    }

    await createLog({
        level: 'INFO', action: 'EMISSAO_INICIADA',
        message: `Iniciando transmissão DPS ${dpsFinal} (Série ${serieFinal}) - Ambiente: ${prestador.ambiente}.`,
        empresaId: prestador.id, vendaId: venda.id,
        details: { payloadOriginal: dadosParaEstrategia, xmlGerado: resultado.xmlGerado }
    });

    // --- TRATAMENTO DE ERROS INTELIGENTE ---
    if (!resultado.sucesso) {
        let customUserAction = null;
        let apagarVenda = false; 
        let draftEligible = false;
        let draftReasonType = null;
        const errorStr = JSON.stringify(resultado.erros).toLowerCase();

        if (errorStr.includes('e999')) {
            customUserAction = "Instabilidade no Portal Nacional. Verifique se está no ambiente de 'Produção', se não estiver, mude e tente de novo.";
            apagarVenda = false; 
        }
        else if (errorStr.includes('inscrição municipal') || errorStr.includes('im ') || errorStr.includes('e0180') || errorStr.includes('e0183') || errorStr.includes('e0184')) {
            customUserAction = "Sua Inscrição Municipal está ausente ou incorreta. Por favor, acesse as Configurações da Empresa e atualize o número da sua I.M.";
            apagarVenda = true; 
            draftEligible = true;
            draftReasonType = 'INSCRICAO_MUNICIPAL';
        } 
        else if (errorStr.includes('já utilizado') || errorStr.includes('já existe') || errorStr.includes('duplicado') || errorStr.includes('e0171') || errorStr.includes('e0041')) {
            customUserAction = `O número de DPS ${dpsFinal} já foi utilizado. Por favor, altere o número do DPS para o próximo sequencial disponível.`;
            apagarVenda = true; 
            draftEligible = true;
            draftReasonType = 'DPS_DUPLICADO';
        }

        if (customUserAction && apagarVenda) {
            if (!vendaId) { 
                await prisma.venda.update({
                    where: { id: venda.id },
                    data: { status: 'DESCARTADA', arquivadoEm: new Date(), arquivadoPor: user.id, motivoArquivamento: 'Emissao descartada apos falha validada.' } as any
                });
            }
        } else {
            await prisma.venda.update({ where: { id: venda.id }, data: { status: 'ERRO_EMISSAO' } });
            await createLog({ level: 'ERRO', action: 'FALHA_EMISSAO', message: resultado.motivo || 'Rejeição Sefaz', empresaId: prestador.id, vendaId: venda.id, details: resultado.erros });
        }

        return NextResponse.json({ 
            error: "Emissão falhou.", 
            details: resultado.erros,
            userAction: customUserAction,
            draftEligible,
            draftReasonType,
        }, { status: 400 });
    }

    // --- CENÁRIO 1: BYPASS DE HOMOLOGAÇÃO ---
    if (prestador.ambiente === 'HOMOLOGACAO') {
        if (!vendaId) { 
                await prisma.venda.update({
                    where: { id: venda.id },
                    data: { status: 'DESCARTADA', arquivadoEm: new Date(), arquivadoPor: user.id, motivoArquivamento: 'Homologacao validada sem gerar nota fiscal.' } as any
                });
        }

        return NextResponse.json({ 
            success: true, 
            isHomologation: true, 
            message: "Tudo Certo! Sua nota é válida. Acesse as Configurações e mude para PRODUÇÃO para emitir com valor fiscal." 
        }, { status: 200 });
    }

    // === FLUXO DE PRODUÇÃO NORMAL (DESCONTA O LIMITE AQUI) ===
    if(planHistoryId) await incrementUsage(planHistoryId); // <--- O DESCONTO ACONTECE AQUI!

    const nota = await prisma.notaFiscal.create({
        data: {
            vendaId: venda.id, empresaId: prestador.id, clienteId: tomador.id, 
            numero: parseInt(resultado.notaGov!.numero) || 0, valor: valorFloat, descricao: descricao,
            prestadorCnpj: prestador.documento.replace(/\D/g, ''), tomadorCnpj: tomador.documento ? tomador.documento.replace(/\D/g, '') : 'EXTERIOR',
            status: 'AUTORIZADA', chaveAcesso: resultado.notaGov!.chave, protocolo: resultado.notaGov!.protocolo, 
            xmlBase64: resultado.notaGov!.xml, xmlAutorizadoBase64: resultado.notaGov!.xml, cnae: cnaeFinal, dataEmissao: new Date()
        } as any
    });

    await createLog({ level: 'INFO', action: 'NOTA_AUTORIZADA', message: `Nota ${nota.numero} autorizada!`, empresaId: prestador.id, vendaId: venda.id });
    
    // Agora sim acionamos o Processor para baixar o XML e PDF oficiais em segundo plano
    processarRetornoNota(nota.id, prestador.id, venda.id).catch(console.error);

    return NextResponse.json({ success: true, nota }, { status: 201 });

  } catch (error: any) {
    if(vendaIdLog) try { await prisma.venda.update({ where: { id: vendaIdLog }, data: { status: 'ERRO_EMISSAO' } }); } catch(e){}
    await createLog({ level: 'ERRO', action: 'ERRO_SISTEMA', message: error.message, empresaId: empresaIdLog || undefined, details: { stack: error.stack } });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// === GET: LISTAGEM DE NOTAS ===
export async function GET(request: Request) {
    const { targetId, errorResponse } = await validateRequest(request);
    if (errorResponse) return errorResponse;

    const user = await prisma.user.findUnique({ where: { id: targetId } });
    if (!user) return unauthorized();

    const contextId = request.headers.get('x-empresa-id');
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const typeFilter = searchParams.get('type') || 'all'; 
  
    try {
      const empresaIdAlvo = await getEmpresaContexto(user, contextId);
      if (!empresaIdAlvo) return NextResponse.json({ data: [], meta: { total: 0 } });
  
      const skip = (page - 1) * limit;
      
      const whereClause: any = {
          empresaId: empresaIdAlvo,
          arquivadoEm: null,
          ...(search && {
              OR: [
                  { cliente: { nome: { contains: search, mode: 'insensitive' } } }, 
                  { cliente: { documento: { contains: search } } },
                  ...( !isNaN(Number(search)) ? [{ numero: { equals: Number(search) } }] : [] )
              ]
          })
      };

      if (typeFilter === 'valid') {
          whereClause.status = { in: ['CONCLUIDA', 'CANCELADA', 'AUTORIZADA'] };
      }
  
      const [vendas, total] = await prisma.$transaction([
          prisma.venda.findMany({
              where: whereClause, take: limit, skip: skip, orderBy: { createdAt: 'desc' },
              include: {
                  cliente: { select: { nome: true, documento: true } },
                  notas: { select: { id: true, numero: true, status: true, vendaId: true, valor: true, cnae: true, dataEmissao: true, xmlBase64: true, xmlAutorizadoBase64: true, xmlCancelamentoEventoBase64: true, pdfBase64: true } as any },
                  logs: { where: { level: 'ERRO' }, orderBy: { createdAt: 'desc' }, take: 1, select: { message: true } }
              }
          }),
          prisma.venda.count({ where: whereClause })
      ]);
  
      const dadosFinais = vendas.map(v => {
          let codigoTribDisplay = '---';
          let nomeServicoDisplay = v.descricao || ''; 
          
          if (v.notas.length > 0 && v.notas[0].cnae) {
             const info = getTributacaoPorCnae(v.notas[0].cnae);
             if (info && info.codigoTributacaoNacional) {
                 codigoTribDisplay = info.codigoTributacaoNacional;
                 nomeServicoDisplay = info.descricao; 
             }
          }

          return {
            ...v,
            cliente: { 
                ...v.cliente, 
                razaoSocial: v.cliente?.nome || 'Consumidor'
            },
            notas: v.notas.map(n => ({ ...n, codigoTribNacional: codigoTribDisplay, nomeServico: nomeServicoDisplay })),
            motivoErro: v.status === 'ERRO_EMISSAO' && v.logs[0] ? v.logs[0].message : null
          };
      });
  
      return NextResponse.json({ data: dadosFinais, meta: { total, page, totalPages: Math.ceil(total / limit) } });
    } catch (error) { return NextResponse.json({ error: 'Erro ao buscar notas' }, { status: 500 }); }
}
