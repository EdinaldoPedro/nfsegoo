import { PrismaClient } from '@prisma/client';
import { syncCnaesGlobalmente } from './syncService';
import { validarCPF } from '@/app/utils/cpf'; 
import { createLog } from '@/app/services/logger';

const prisma = new PrismaClient();

const STATUS_VINCULO = {
  APROVADO: 'APROVADO',
  PENDENTE_DONO: 'PENDENTE_DONO',
  PENDENTE_CUSTODIANTE: 'PENDENTE_CUSTODIANTE',
} as const;
type StatusVinculo = (typeof STATUS_VINCULO)[keyof typeof STATUS_VINCULO];

function safeString(val: any): string | null {
    if (val === null || val === undefined) return null;
    const str = String(val).trim();
    return str === "" ? null : str;
}

// === HELPER NOVO: Fetch Seguro (Evita erro 403) ===
async function fetchSafe(url: string) {
    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (compatible; EmissorNFSe/1.0; +https://brasilapi.com.br)' 
            }
        });
        clearTimeout(id);
        return res;
    } catch (e) { return null; }
}

export async function upsertEmpresaAndLinkUser(documento: string, userId: string, dadosManuais?: any, userRole: string = 'COMUM') {
  const docLimpo = documento.replace(/\D/g, '');
  
  console.log(`\n🔍 [SERVICE] Upsert: ${docLimpo} | Role: ${userRole}`);

  if (docLimpo.length !== 14 && docLimpo.length !== 11) throw new Error("Documento inválido.");
  if (docLimpo.length === 11 && !validarCPF(docLimpo)) throw new Error("CPF Inválido.");

  let dadosApi: any = null;
  
  if (docLimpo.length === 14) {
      console.log(`🌍 [SERVICE] Buscando dados na BrasilAPI...`);
      const res = await fetchSafe(`https://brasilapi.com.br/api/cnpj/v1/${docLimpo}`);
      
      if (!res || !res.ok) {
          throw new Error("CNPJ inválido ou não encontrado na base da Receita Federal.");
      }

      const raw = await res.json();
      let ibgeValido = null;
      if (raw.codigo_municipio) {
          const cod = String(raw.codigo_municipio).replace(/\D/g, '');
          if (cod.length === 7) ibgeValido = cod;
      }
      dadosApi = {
          razaoSocial: raw.razao_social,
          nomeFantasia: raw.nome_fantasia || raw.razao_social,
          email: raw.email,
          cep: raw.cep,
          logradouro: raw.logradouro,
          numero: raw.numero,
          bairro: raw.bairro,
          cidade: raw.municipio,
          uf: raw.uf,
          codigoIbge: ibgeValido, 
          cnaes: []
      };
      if (raw.cnae_fiscal) dadosApi.cnaes.push({ codigo: String(raw.cnae_fiscal), descricao: raw.cnae_fiscal_descricao, principal: true });
      if (raw.cnaes_secundarios) {
          raw.cnaes_secundarios.forEach((c: any) => dadosApi.cnaes.push({ codigo: String(c.codigo), descricao: c.descricao, principal: false }));
      }
  }

  const fontePrincipal = dadosApi || dadosManuais || {};
  const fonteSecundaria = dadosManuais || {};
  
  const ibgeP = safeString(fontePrincipal.codigoIbge);
  const ibgeS = safeString(fonteSecundaria.codigoIbge);
  let ibgeFinal = (ibgeP && ibgeP.length === 7) ? ibgeP : ((ibgeS && ibgeS.length === 7) ? ibgeS : null);

  const dadosFinais = {
      razaoSocial: safeString(fontePrincipal.razaoSocial || fontePrincipal.nome) || safeString(fonteSecundaria.razaoSocial || fonteSecundaria.nome) || `Empresa ${docLimpo}`,
      nomeFantasia: safeString(fontePrincipal.nomeFantasia) || safeString(fonteSecundaria.nomeFantasia) || safeString(fontePrincipal.razaoSocial),
      email: safeString(fontePrincipal.email) || safeString(fonteSecundaria.email),
      cep: safeString(fontePrincipal.cep) || safeString(fonteSecundaria.cep),
      logradouro: safeString(fontePrincipal.logradouro) || safeString(fonteSecundaria.logradouro),
      numero: safeString(fontePrincipal.numero) || safeString(fonteSecundaria.numero),
      bairro: safeString(fontePrincipal.bairro) || safeString(fonteSecundaria.bairro),
      cidade: safeString(fontePrincipal.cidade) || safeString(fonteSecundaria.cidade),
      uf: safeString(fontePrincipal.uf) || safeString(fonteSecundaria.uf),
      codigoIbge: ibgeFinal,
      inscricaoMunicipal: safeString(fontePrincipal.inscricaoMunicipal) || safeString(fonteSecundaria.inscricaoMunicipal),
      cadastroCompleto: !!(dadosApi || dadosManuais?.razaoSocial)
  };

  if (!dadosFinais.codigoIbge && dadosFinais.cep && dadosFinais.cep.length >= 8) {
      const cepOnly = dadosFinais.cep.replace(/\D/g, '');
      const resCep = await fetchSafe(`https://viacep.com.br/ws/${cepOnly}/json/`);
      if (resCep && resCep.ok) {
          const dataCep = await resCep.json();
          if (!dataCep.erro && dataCep.ibge) {
              dadosFinais.codigoIbge = dataCep.ibge;
              if (!dadosFinais.uf) dadosFinais.uf = dataCep.uf;
              if (!dadosFinais.cidade) dadosFinais.cidade = dataCep.localidade;
          }
      }
  }

  const listaCnaesRaw = (dadosApi && dadosApi.cnaes) ? dadosApi.cnaes : (dadosManuais?.cnaes || []);
  let cnaesUnicos: any[] = [];
  if (Array.isArray(listaCnaesRaw)) {
      const mapUnicos = new Map();
      listaCnaesRaw.forEach((c: any) => {
          const cod = String(c.codigo).replace(/\D/g, '');
          mapUnicos.set(cod, { codigo: cod, descricao: c.descricao, principal: c.principal });
      });
      cnaesUnicos = Array.from(mapUnicos.values());
  }

  const empresaProcessada = await prisma.$transaction(async (tx) => {
      const empresaExistente = await tx.empresa.findUnique({
          where: { documento: docLimpo },
          include: { donoUser: true }
      });

      // >> CONTADOR CADASTRANDO <<
      if (userRole === 'CONTADOR') {
          const proprietarioAtualId = (empresaExistente as any)?.proprietarioUserId || null;
          const donoLegadoReal = empresaExistente?.donoUser && empresaExistente.donoUser.role !== 'CONTADOR'
              ? empresaExistente.donoUser
              : null;
          const temDonoReal = (!!donoLegadoReal && donoLegadoReal.id !== userId) || (!!proprietarioAtualId && proprietarioAtualId !== userId);
          const vinculoAprovadoAtual = empresaExistente
              ? await tx.contadorVinculo.findFirst({
                  where: {
                      empresaId: empresaExistente.id,
                      status: STATUS_VINCULO.APROVADO,
                      arquivadoEm: null,
                      contadorId: { not: userId },
                  } as any,
                  orderBy: { updatedAt: 'desc' },
              })
              : null;
          const custodianteAtualId = (empresaExistente as any)?.contadorCustodianteId || vinculoAprovadoAtual?.contadorId || null;
          const temOutroCustodiante = !!custodianteAtualId && custodianteAtualId !== userId;

          let statusVinculo: StatusVinculo = STATUS_VINCULO.APROVADO;
          if (temDonoReal) {
              statusVinculo = STATUS_VINCULO.PENDENTE_DONO;
          } else if (temOutroCustodiante) {
              statusVinculo = STATUS_VINCULO.PENDENTE_CUSTODIANTE;
          }

          const dadosAtualizacao: any = { ...dadosFinais, lastApiCheck: new Date() };
          if (empresaExistente && !temDonoReal && temOutroCustodiante && !(empresaExistente as any).contadorCustodianteId) {
              dadosAtualizacao.contadorCustodianteId = custodianteAtualId;
          }
          if (!empresaExistente || (!temDonoReal && !temOutroCustodiante)) {
              dadosAtualizacao.contadorCustodianteId = userId;
              dadosAtualizacao.statusPropriedade = 'CUSTODIADA';
              dadosAtualizacao.modoCobranca = (empresaExistente as any)?.modoCobranca || 'RESPONSAVEL_UNICO';
              if (!(empresaExistente as any)?.donoFaturamentoId) {
                  dadosAtualizacao.donoFaturamentoId = userId;
              }
          }

          // ATENÇÃO: Se não existe, o CONTADOR vira o donoFaturamentoId
          const dadosCriacao = { 
              documento: docLimpo, 
              ...dadosFinais, 
              lastApiCheck: new Date(),
              donoFaturamentoId: userId,
              contadorCustodianteId: userId,
              statusPropriedade: 'CUSTODIADA',
              modoCobranca: 'RESPONSAVEL_UNICO'
          } as any;

          const empresa = await tx.empresa.upsert({
              where: { documento: docLimpo },
              update: dadosAtualizacao,
              create: dadosCriacao
          });

          if (cnaesUnicos.length > 0 && (!empresaExistente || !empresaExistente.cadastroCompleto)) {
              await tx.cnae.deleteMany({ where: { empresaId: empresa.id } });
              await tx.cnae.createMany({ data: cnaesUnicos.map(c => ({ ...c, empresaId: empresa.id })) });
          }

          const vinculoExistente = await tx.contadorVinculo.findUnique({
              where: { contadorId_empresaId: { contadorId: userId, empresaId: empresa.id } }
          });

          if (vinculoExistente && !(vinculoExistente as any).arquivadoEm && vinculoExistente.status !== 'DESVINCULADO') {
              throw new Error("Empresa jÃ¡ vinculada ou solicitaÃ§Ã£o pendente.");
          }

          await tx.contadorVinculo.upsert({
              where: { contadorId_empresaId: { contadorId: userId, empresaId: empresa.id } },
              create: {
                  contadorId: userId,
                  empresaId: empresa.id,
                  status: statusVinculo,
                  clientePodeAcessarPortal: false,
                  nivelPortal: 'NENHUM'
              } as any,
              update: {
                  status: statusVinculo,
                  arquivadoEm: null,
                  arquivadoPor: null,
                  motivoArquivamento: null,
                  clientePodeAcessarPortal: false,
                  nivelPortal: 'NENHUM'
              } as any
          });

          return {
              ...empresa,
              _statusVinculo: statusVinculo,
              _wasExisting: !!empresaExistente,
              _temDonoReal: temDonoReal,
              _temOutroCustodiante: temOutroCustodiante,
          };
      } 
      
      // >> CLIENTE COMUM CADASTRANDO (RESOLUÇÃO DA FALHA 1) <<
      else {
          if (empresaExistente) {
              // Se já tem dono e NÃO É um contador
              const proprietarioAtualId = (empresaExistente as any)?.proprietarioUserId || null;
              if (proprietarioAtualId && proprietarioAtualId !== userId) {
                  throw new Error("Esta empresa ja pertence a outro usuario.");
              }

              if (empresaExistente.donoUser && empresaExistente.donoUser.role !== 'CONTADOR' && empresaExistente.donoUser.id !== userId) {
                  throw new Error("Esta empresa já pertence a outro usuário.");
              }
              
              // === SOLUÇÃO FALHA 1: REIVINDICAÇÃO (CLAIM) ===
              // Se a empresa era orfã OU pertencia a um Contador
              if (!empresaExistente.donoUser || (empresaExistente.donoUser && empresaExistente.donoUser.role === 'CONTADOR')) {
                  // O contador que geria a empresa tem o vínculo suspenso para 'PENDENTE'
                  await tx.contadorVinculo.updateMany({ 
                      where: { empresaId: empresaExistente.id }, 
                      data: { status: STATUS_VINCULO.PENDENTE_DONO }
                  });
              }
          }

          const empresa = await tx.empresa.upsert({
              where: { documento: docLimpo },
              update: { 
                  ...dadosFinais, 
                  lastApiCheck: new Date(), 
                  donoUser: { connect: { id: userId } },
                  donoFaturamentoId: userId,
                  proprietarioUserId: userId,
                  contadorCustodianteId: null,
                  statusPropriedade: 'PROPRIETARIA',
                  modoCobranca: 'RESPONSAVEL_UNICO'
              } as any,
              create: { 
                  documento: docLimpo, 
                  ...dadosFinais, 
                  lastApiCheck: new Date(), 
                  donoUser: { connect: { id: userId } },
                  donoFaturamentoId: userId,
                  proprietarioUserId: userId,
                  statusPropriedade: 'PROPRIETARIA',
                  modoCobranca: 'RESPONSAVEL_UNICO'
              } as any
          });

          if (cnaesUnicos.length > 0) {
              await tx.cnae.deleteMany({ where: { empresaId: empresa.id } });
              await tx.cnae.createMany({ data: cnaesUnicos.map(c => ({ ...c, empresaId: empresa.id })) });
          }

          await tx.userCliente.upsert({
              where: { userId_empresaId: { userId, empresaId: empresa.id } },
              create: { userId, empresaId: empresa.id, apelido: dadosFinais.nomeFantasia },
              update: {}
          });
          
          await tx.user.update({ where: { id: userId }, data: { empresaId: empresa.id } });

          return {
              ...empresa,
              _statusPropriedadeFinal: 'PROPRIETARIA',
              _wasExisting: !!empresaExistente,
          };
      }
  });

  try {
      if (userRole === 'CONTADOR') {
          const empresaContador = empresaProcessada as any;
          const actionByStatus: Record<string, string> = {
              APROVADO: empresaContador._wasExisting ? 'VINCULO_CONTADOR_APROVADO' : 'EMPRESA_CUSTODIADA_CRIADA',
              PENDENTE_DONO: 'VINCULO_CONTADOR_PENDENTE_DONO',
              PENDENTE_CUSTODIANTE: 'VINCULO_CONTADOR_PENDENTE_CUSTODIANTE',
          };

          await createLog({
              level: empresaContador._statusVinculo === STATUS_VINCULO.APROVADO ? 'INFO' : 'ALERTA',
              action: actionByStatus[empresaContador._statusVinculo] || 'VINCULO_CONTADOR_SOLICITADO',
              message: empresaContador._statusVinculo === STATUS_VINCULO.APROVADO
                  ? 'Vinculo contabil aprovado automaticamente.'
                  : 'Solicitacao de vinculo contabil registrada aguardando aprovacao.',
              empresaId: empresaContador.id,
              userId,
              module: 'VINCULOS',
              details: {
                  documento: docLimpo,
                  statusVinculo: empresaContador._statusVinculo,
                  empresaExistia: empresaContador._wasExisting,
                  temDonoReal: empresaContador._temDonoReal,
                  temOutroCustodiante: empresaContador._temOutroCustodiante,
              },
          });
      } else if ((empresaProcessada as any)._statusPropriedadeFinal === 'PROPRIETARIA') {
          await createLog({
              level: 'INFO',
              action: empresaProcessada._wasExisting ? 'EMPRESA_REIVINDICADA_PROPRIETARIO' : 'EMPRESA_PROPRIETARIA_CRIADA',
              message: empresaProcessada._wasExisting
                  ? 'Empresa reivindicada por proprietario real.'
                  : 'Empresa criada com proprietario real.',
              empresaId: empresaProcessada.id,
              userId,
              module: 'VINCULOS',
              details: { documento: docLimpo, empresaExistia: empresaProcessada._wasExisting },
          });
      }
  } catch (error) {
      console.error('[EMPRESA_SERVICE] Falha ao auditar vinculo:', error);
  }

  if (cnaesUnicos.length > 0 && dadosFinais.codigoIbge) {
      await syncCnaesGlobalmente(cnaesUnicos, dadosFinais.codigoIbge);
  }
  
  return empresaProcessada;
}
