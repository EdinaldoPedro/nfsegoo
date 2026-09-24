import { BaseStrategy } from './BaseStrategy';
import { IEmissorStrategy, IDadosEmissao, IResultadoEmissao, IResultadoConsulta, IResultadoCancelamento } from '../interfaces/IEmissorStrategy';
import { NacionalAdapter } from '../adapters/NacionalAdapter';
import { ICanonicalRps } from '../interfaces/ICanonicalRps';
import { MeiHandler } from '../handlers/MeiHandler';
import { SimplesNacionalHandler } from '../handlers/SimplesNacionalHandler';
import { assertValidDpsXml } from '../validation/DpsPreflightValidator';
import { FiscalSchemaError, validateFiscalSchema } from '../validation/FiscalSchema';
import { validateNationalAddress } from '@/app/utils/customer-address';
import { assertRegimeTributarioSuportado } from '@/app/utils/regime-tributario';

export class NacionalStrategy extends BaseStrategy implements IEmissorStrategy {
    
    private adapter: NacionalAdapter;

    constructor() {
        super();
        this.adapter = new NacionalAdapter();
    }

    async preparar(dados: IDadosEmissao): Promise<string> {
        // === 0. SANITIZAÇÃO DE DADOS ===
        const paisTomador = String(dados.tomador.pais || '').trim().toUpperCase();
        const tomadorExterior = dados.tomador.tipo === 'EXT' || (!!paisTomador && !['BR', 'BRASIL', 'BRAZIL'].includes(paisTomador));

        // Garante que CEP tenha apenas números (EXCETO SE FOR EXTERIOR)
        if (dados.tomador.cep && !tomadorExterior) {
            dados.tomador.cep = dados.tomador.cep.replace(/\D/g, '');
        }
        if (!tomadorExterior) {
            const endereco = validateNationalAddress(dados.tomador);
            if (!endereco.valid) {
                const prefixo = dados.tomador.tipo === 'PF' ? 'Endereco obrigatorio da pessoa fisica' : 'Endereco do tomador incompleto';
                throw Object.assign(new Error(`${prefixo}: ${endereco.message}`), { status: 400 });
            }
            dados.tomador.semEndereco = false;
        }
        if (tomadorExterior) {
            const camposExterior = [
                ['pais', dados.tomador.pais],
                ['moeda', dados.tomador.moeda],
                ['codigo postal', dados.tomador.cep],
                ['cidade', dados.tomador.cidade],
                ['estado/provincia/regiao', dados.tomador.uf],
                ['logradouro', dados.tomador.logradouro],
            ].filter(([, value]) => !String(value || '').trim());
            if (camposExterior.length) {
                throw Object.assign(new Error(`Cadastro do tomador exterior incompleto: ${camposExterior.map(([field]) => field).join(', ')}.`), { status: 400 });
            }
        }

        const { prestador, tomador, servico, numeroDPS, serieDPS, ambiente, dataCompetencia } = dados as any;

        // === DESCRIPTOGRAFIA EM MEMÓRIA (NOVO) ===

        try {
            // 1. Validações Prévias
            this.validarCertificado(prestador);
            this.validarTomador(tomador);

            // 2. SELEÇÃO DO HANDLER
            const regime = assertRegimeTributarioSuportado(prestador.regimeTributario);
            let handler;

            if (regime === 'MEI') {
                handler = new MeiHandler();
            } else {
                handler = new SimplesNacionalHandler();
            }

            // 3. Obtenção dos Dados Tributários
            const dadosTributarios = await handler.getDadosTributarios(servico, prestador);
            const servicoCanonico: any = { ...dadosTributarios, ...servico };

            // O payload da tela/admin nao pode reintroduzir campos dispensados para MEI.
            // NBS e IBS/CBS permanecem porque aparecem no XML oficial autorizado do cenario de referencia.
            if (regime === 'MEI') {
                servicoCanonico.codigoTributacaoMunicipal = undefined;
                servicoCanonico.aliquotaAplicada = 0;
                servicoCanonico.aliquotaMunicipio = undefined;
                servicoCanonico.valorIss = 0;
                servicoCanonico.issRetido = false;
                servicoCanonico.tipoTributacao = '1';
                servicoCanonico.tributosFederaisDevidos = undefined;
                servicoCanonico.retencoes = {
                    pis: { valor: 0, retido: false },
                    cofins: { valor: 0, retido: false },
                    inss: { valor: 0, retido: false },
                    ir: { valor: 0, retido: false },
                    csll: { valor: 0, retido: false },
                };
            }

            // 4. Montagem do Objeto Canônico
            const rps: ICanonicalRps = {
                prestador: {
                    id: prestador.id,
                    documento: prestador.documento,
                    inscricaoMunicipal: prestador.inscricaoMunicipal,
                    regimeTributario: regime,
                    telefone: prestador.telefone,
                    email: prestador.email,
                    endereco: {
                        codigoIbge: prestador.codigoIbge,
                        uf: prestador.uf
                    },
                    configuracoes: {
                        aliquotaPadrao: Number(prestador.aliquotaPadrao),
                        issRetido: servico.issRetido ?? dadosTributarios.issRetido,
                        tipoTributacao: servico.tipoTributacao || prestador.tipoTributacaoPadrao,
                        regimeEspecial: prestador.regimeEspecialTributacao
                    }
                },
                tomador: {
                    documento: tomador.documento,
                    inscricaoMunicipal: tomador.inscricaoMunicipal,
                    razaoSocial: tomador.razaoSocial,
                    email: tomador.email,
                    telefone: tomador.telefone,
                    
                    // === DADOS OBRIGATÓRIOS PARA EXPORTAÇÃO (CORREÇÃO AQUI) ===
                    tipo: tomador.tipo,
                    nif: tomador.nif,
                    pais: tomador.pais,
                    moeda: tomador.moeda,
                    semEndereco: false,

                    endereco: {
                        cep: tomador.cep,
                        logradouro: tomador.logradouro,
                        numero: tomador.numero,
                        complemento: tomador.complemento,
                        bairro: tomador.bairro,
                        cidade: tomador.cidade, // Cidade é necessária para <xCidade> no Exterior
                        codigoIbge: tomador.codigoIbge,
                        uf: tomador.uf
                    }
                },
                // === MERGE DO SERVIÇO (Garante que valorMoedaEstrangeira e codigoNbs não sejam perdidos) ===
                servico: servicoCanonico as ICanonicalRps['servico'],
                
                meta: {
                    ambiente: ambiente,
                    serie: serieDPS,
                    numero: numeroDPS,
                    dataEmissao: new Date(),
                    dataCompetencia: dataCompetencia,
                    layoutVersion: (dados as any).layoutVersion || '1.01',
                    fiscalSnapshot: (dados as any).fiscalSnapshot,
                }
            };

            // 5. Adapter: Transformar RPS em XML
            const xmlGerado = this.adapter.toXml(rps);
            assertValidDpsXml(xmlGerado);

            // 6. Assinar e Transmitir
            const idDps = `DPS${this.cleanString(rps.prestador.endereco.codigoIbge).padStart(7,'0')}2${this.cleanString(rps.prestador.documento).padStart(14,'0')}${this.cleanString(rps.meta.serie).padStart(5,'0')}${String(rps.meta.numero).padStart(15,'0')}`;
            
            const xmlAssinado = this.assinarXML(xmlGerado, idDps, prestador);
            await validateFiscalSchema(xmlAssinado, 'DPS');
            return xmlAssinado;

        } catch (error: any) {
            if (error instanceof FiscalSchemaError) throw Object.assign(error, { status: 400 });
            if ([400, 403].includes(error?.status)) throw error;
            throw new Error('Motor fiscal temporariamente indisponível para preparação.', { cause: error });
        }
    }

}
