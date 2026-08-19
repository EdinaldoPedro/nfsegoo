import type { ICanonicalRps } from '../interfaces/ICanonicalRps';
import { retentionType } from '../fiscal/FiscalMath.ts';
import { validateNationalAddress } from '../../../utils/customer-address.ts';

export class NacionalAdapter {
    
    private clean(str: string | undefined): string {
        return str ? str.replace(/\D/g, '') : '';
    }
    
    private escapeXml(unsafe: string | undefined): string {
        if (!unsafe) return '';
        return unsafe.replace(/[<>&'"]/g, (c) => {
            switch (c) {
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '&': return '&amp;';
                case '\'': return '&apos;';
                case '"': return '&quot;';
                default: return c;
            }
        });
    }

    private mapRegime(regime: string): string {
        switch(String(regime || '').toUpperCase()) {
            case 'MEI': return '2'; 
            case 'SIMPLES': return '3';
            case 'LUCRO_PRESUMIDO': 
            case 'LUCRO_REAL': return '1';
            default: throw new Error(`Regime tributario nao suportado para a DPS: ${regime || 'nao informado'}.`);
        }
    }

    private formatData(date: Date): string {
        const timestamp = date.getTime();
        const offsetBrasilia = -3 * 60 * 60 * 1000;
        
        // --- PREVENÇÃO DO ERRO E0008 ---
        // Subtraímos 2 minutos (120.000 ms) do horário atual para garantir que o 
        // nosso XML nunca chegue "no futuro" para o relógio da Sefaz (Clock Skew).
        const margemDeSeguranca = 2 * 60 * 1000; 
        const dateBR = new Date(timestamp + offsetBrasilia - margemDeSeguranca);
        
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${dateBR.getUTCFullYear()}-${pad(dateBR.getUTCMonth() + 1)}-${pad(dateBR.getUTCDate())}T${pad(dateBR.getUTCHours())}:${pad(dateBR.getUTCMinutes())}:${pad(dateBR.getUTCSeconds())}-03:00`;
    }

    private mapPais(pais: string): string {
        // Converte para minúsculas e remove espaços extras para garantir a correspondência
        const p = pais.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        // Dicionário universal em minúsculas e sem acentos
        const dict: Record<string, string> = {
            "africa do sul": "ZA", "alemanha": "DE", "angola": "AO", "arabia saudita": "SA", 
            "argentina": "AR", "australia": "AU", "austria": "AT", "belgica": "BE", 
            "bolivia": "BO", "brasil": "BR", "canada": "CA", "chile": "CL", "china": "CN", 
            "cingapura": "SG", "colombia": "CO", "coreia do sul": "KR", "costa rica": "CR", 
            "croacia": "HR", "dinamarca": "DK", "egito": "EG", "emirados arabes unidos": "AE", 
            "equador": "EC", "espanha": "ES", "estados unidos": "US", "finlandia": "FI", 
            "franca": "FR", "grecia": "GR", "holanda": "NL", "hong kong": "HK", "india": "IN", 
            "indonesia": "ID", "irlanda": "IE", "israel": "IL", "italia": "IT", "japao": "JP", 
            "mexico": "MX", "noruega": "NO", "nova zelandia": "NZ", "panama": "PA", 
            "paraguai": "PY", "peru": "PE", "polonia": "PL", "portugal": "PT", 
            "reino unido": "GB", "russia": "RU", "suecia": "SE", "suica": "CH", 
            "tailandia": "TH", "turquia": "TR", "uruguai": "UY", "venezuela": "VE"
        };
        
        const isoInformado = pais.trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(isoInformado) && !['XX', 'ZZ'].includes(isoInformado)) return isoInformado;
        const codigo = dict[p];
        if (!codigo) throw new Error(`Pais exterior nao reconhecido: ${pais}. Revise o cadastro do tomador.`);
        return codigo;
    }

    private mapMoeda(moeda: string): string {
        // Tabela de Códigos Numéricos de Moeda (Padrão ISO 4217 / Sefaz)
        const dict: Record<string, string> = { 
            "BRL": "986", // Real
            "USD": "840", // Dólar Americano
            "EUR": "978", // Euro
            "GBP": "826", // Libra Esterlina
            "CAD": "124", // Dólar Canadiano
            "AUD": "036", // Dólar Australiano
            "JPY": "392", // Iene Japonês
            "CHF": "426", // Franco Suíço
            "CNY": "156", // Yuan Chinês
            "MXN": "484", // Peso Mexicano
            "ARS": "032", // Peso Argentino
            "CLP": "152", // Peso Chileno
            "COP": "170", // Peso Colombiano
            "PYG": "600", // Guarani Paraguaio
            "UYU": "858"  // Peso Uruguaio
        };
        
        const codigo = dict[moeda?.toUpperCase()];
        if (!codigo) throw new Error(`Moeda exterior nao reconhecida: ${moeda || 'nao informada'}. Revise o cadastro do tomador.`);
        return codigo;
    }

    public toXml(rps: ICanonicalRps): string {
        const p = rps.prestador;
        const t = rps.tomador;
        const s = rps.servico as any;
        const m = rps.meta;
        
        const r = s.retencoes || { pis: {}, cofins: {}, inss: {}, ir: {}, csll: {} };

        const dhEmi = this.formatData(m.dataEmissao);
        // Usa a data de competência fornecida ou cai para a data de emissão como fallback
        const dCompet = m.dataCompetencia ? m.dataCompetencia : dhEmi.split('T')[0]; 
        const documentoPrestador = this.clean(p.documento);
        const municipioPrestador = this.clean(p.endereco.codigoIbge);
        const serie = this.clean(m.serie);
        if (documentoPrestador.length !== 14) throw new Error('CNPJ do prestador deve possuir 14 digitos no leiaute de producao vigente.');
        if (municipioPrestador.length !== 7) throw new Error('Codigo IBGE do prestador deve possuir 7 digitos.');
        if (!/^\d{1,5}$/.test(serie)) throw new Error('Serie da DPS deve possuir de 1 a 5 digitos.');
        if (!Number.isInteger(Number(m.numero)) || Number(m.numero) <= 0 || String(m.numero).length > 15) throw new Error('Numero da DPS invalido.');
        const idDps = `DPS${municipioPrestador}2${documentoPrestador}${serie.padStart(5,'0')}${String(m.numero).padStart(15,'0')}`;
        
        const tpAmb = m.ambiente === 'PRODUCAO' ? '1' : '2';
        const opSimpNac = this.mapRegime(p.regimeTributario);
        
        const paisNormalizado = String(t.pais || '').trim().toUpperCase();
        const isExterior = t.tipo === 'EXT' || (!!paisNormalizado && !['BR', 'BRASIL', 'BRAZIL'].includes(paisNormalizado));
        const codPais = isExterior ? this.mapPais(t.pais || '') : 'BR';
        const codMoeda = isExterior ? this.mapMoeda(t.moeda || '') : '986';

        const docTomador = this.clean(t.documento);
        if (!isExterior && ![11, 14].includes(docTomador.length)) {
            throw new Error('CPF/CNPJ do tomador nacional invalido para a DPS.');
        }
        const tagDocTomador = docTomador.length === 11 ? `<CPF>${docTomador}</CPF>` : `<CNPJ>${docTomador}</CNPJ>`;
        if (!isExterior) {
            const endereco = validateNationalAddress(t.endereco || {});
            if (!endereco.valid) throw new Error(`Endereco do tomador incompleto: ${endereco.message}`);
        }
        if (isExterior) {
            const camposExterior = [
                ['codigo postal', t.endereco?.cep],
                ['cidade', t.endereco?.cidade],
                ['estado/provincia/regiao', t.endereco?.uf],
            ].filter(([, value]) => !String(value || '').trim());
            if (camposExterior.length) {
                throw new Error(`Endereco exterior incompleto: ${camposExterior.map(([field]) => field).join(', ')}.`);
            }
        }

        const razaoSocialTomador = this.escapeXml(t.razaoSocial);
        const enderecoLogradouro = this.escapeXml(t.endereco?.logradouro);
        const enderecoBairro = this.escapeXml(t.endereco?.bairro);
        const descricaoServico = this.escapeXml(s.descricao);

        // --- PRESTADOR ---
        let prestXml = `<prest>` + 
            `<CNPJ>${documentoPrestador}</CNPJ>` +
            (p.inscricaoMunicipal ? `<IM>${this.clean(p.inscricaoMunicipal)}</IM>` : '');
        
        // Dados de contato do Prestador (Requisito Sefin)
        if (p.telefone) prestXml += `<fone>${this.clean(p.telefone)}</fone>`;
        if (p.email) prestXml += `<email>${this.escapeXml(p.email)}</email>`;
        
        prestXml += `<regTrib><opSimpNac>${opSimpNac}</opSimpNac>`;
        if (opSimpNac === '3') prestXml += `<regApTribSN>1</regApTribSN>`;
        prestXml += `<regEspTrib>${p.configuracoes?.regimeEspecial || '0'}</regEspTrib></regTrib></prest>`;

        // --- TOMADOR ---

        let tomaXml = `<toma>`;
        if (isExterior) {
            if (t.nif) tomaXml += `<NIF>${this.escapeXml(t.nif)}</NIF>`;
            else tomaXml += `<cNaoNIF>2</cNaoNIF>`;
        } else {
            tomaXml += tagDocTomador;
        }

        // <--- ADICIONE ESTAS 3 LINHAS AQUI --->
        if (t.inscricaoMunicipal) {
            tomaXml += `<IM>${this.clean(t.inscricaoMunicipal)}</IM>`;
        }
        // <------------------------------------>

        tomaXml += `<xNome>${razaoSocialTomador}</xNome>`;

        tomaXml += `<end>`;
        if (isExterior) {
            tomaXml += `<endExt>` +
                       `<cPais>${codPais}</cPais>` +
                       `<cEndPost>${this.escapeXml(String(t.endereco?.cep || '').trim())}</cEndPost>` +
                       `<xCidade>${this.escapeXml(t.endereco?.cidade)}</xCidade>` +
                       `<xEstProvReg>${this.escapeXml(t.endereco?.uf)}</xEstProvReg>` +
                       `</endExt>`;
        } else {
            tomaXml += `<endNac><cMun>${this.clean(t.endereco?.codigoIbge)}</cMun><CEP>${this.clean(t.endereco?.cep)}</CEP></endNac>`;
        }
        tomaXml += `<xLgr>${enderecoLogradouro}</xLgr>` +
                   `<nro>${this.escapeXml(t.endereco?.numero)}</nro>`;
        if (t.endereco?.complemento) tomaXml += `<xCpl>${this.escapeXml(t.endereco.complemento)}</xCpl>`;
        if (enderecoBairro) tomaXml += `<xBairro>${enderecoBairro}</xBairro>`;
        tomaXml += `</end>`;
        if (t.email) tomaXml += `<email>${this.escapeXml(t.email)}</email>`;
        if (t.telefone) tomaXml += `<fone>${this.clean(t.telefone)}</fone>`;
        tomaXml += `</toma>`;

        // --- SERVIÇO ---
        let locPrestXml = isExterior 
            ? `<locPrest><cPaisPrestacao>${codPais}</cPaisPrestacao></locPrest>` 
            : `<locPrest><cLocPrestacao>${this.clean(p.endereco.codigoIbge)}</cLocPrestacao></locPrest>`;

        let servXml = `<serv>` + locPrestXml + `<cServ>` +
                      `<cTribNac>${this.clean(s.codigoTributacaoNacional)}</cTribNac>`;
        
        // === O "LEÃO DE CHÁCARA" ENTRA EM AÇÃO AQUI ===
        // Limpa a variável primeiro. Só desenha a tag se sobrar algum número de verdade.
        const codTribMunLimpo = this.clean(s.codigoTributacaoMunicipal);
        if (opSimpNac !== '2' && codTribMunLimpo.length > 0) {
            servXml += `<cTribMun>${codTribMunLimpo}</cTribMun>`;
        }
        
        servXml += `<xDescServ>${descricaoServico}</xDescServ>`;
        
        // Só injeta o NBS se o Backend tiver cruzado os dados e confirmado que precisa
        const nbsLimpo = s.codigoNbs ? this.clean(s.codigoNbs) : '';
        if (nbsLimpo.length > 0) {
            servXml += `<cNBS>${nbsLimpo}</cNBS>`;
        }
        
        servXml += `</cServ>`

        if (isExterior && s.valorMoedaEstrangeira) {
            servXml += `<comExt>` +
                       `<mdPrestacao>4</mdPrestacao>` +
                       `<vincPrest>0</vincPrest>` +
                       `<tpMoeda>${codMoeda}</tpMoeda>` +
                       `<vServMoeda>${Number(s.valorMoedaEstrangeira).toFixed(2)}</vServMoeda>` +
                       `<mecAFComexP>01</mecAFComexP>` +
                       `<mecAFComexT>01</mecAFComexT>` +
                       `<movTempBens>1</movTempBens>` +
                       `<mdic>0</mdic>` +
                       `</comExt>`;
        }
        servXml += `</serv>`;

        // --- TRIBUTOS (A MÁGICA DO LUCRO PRESUMIDO) ---
        let tribXml = `<tribMun>`;
        
        if (isExterior) {
            // Emissão para o Exterior - Força os códigos de exportação/isenção
            tribXml += `<tribISSQN>3</tribISSQN>`;
            tribXml += `<tpRetISSQN>1</tpRetISSQN>`;
        } else {
            // Regra Nacional normal
            tribXml += `<tribISSQN>${s.tipoTributacao || '1'}</tribISSQN>`;
            tribXml += `<tpRetISSQN>${s.issRetido ? '2' : '1'}</tpRetISSQN>`;
            
            // Tags pAliq e vISSQN soltas são exclusivas do Simples Nacional (opSimpNac = 3).
            // Lucro Presumido (1) NÃO leva essas tags aqui.
            if (opSimpNac === '3') {
                if (s.aliquotaAplicada && s.aliquotaAplicada > 0) tribXml += `<pAliq>${s.aliquotaAplicada.toFixed(2)}</pAliq>`;
            }
        }
        tribXml += `</tribMun>`;

        // === IMPOSTOS FEDERAIS ===
        const hasPis = r.pis?.retido && (r.pis.valor || 0) > 0;
        const hasCofins = r.cofins?.retido && (r.cofins.valor || 0) > 0;
        const hasIr = r.ir?.retido && (r.ir.valor || 0) > 0;
        const hasCsll = r.csll?.retido && (r.csll.valor || 0) > 0;
        const hasInss = r.inss?.retido && (r.inss.valor || 0) > 0;

        const federaisDevidos = s.tributosFederaisDevidos;
        const hasFederalDue = !!(federaisDevidos?.pis || federaisDevidos?.cofins);

        if (opSimpNac === '1' && !isExterior && (hasPis || hasCofins || hasIr || hasCsll || hasInss || hasFederalDue)) {
            tribXml += `<tribFed>`;
            
            if (hasPis || hasCofins || hasCsll || hasFederalDue) {
                const tpRet = retentionType({
                    pis: { retido: !!hasPis, valor: Number(r.pis?.valor || 0) },
                    cofins: { retido: !!hasCofins, valor: Number(r.cofins?.valor || 0) },
                    csll: { retido: !!hasCsll, valor: Number(r.csll?.valor || 0) },
                });

                tribXml += `<piscofins><CST>${this.clean(federaisDevidos?.cst || s.cstPisCofins || '01').padStart(2, '0')}</CST>`;
                if (hasFederalDue) {
                    tribXml += `<vBCPisCofins>${Number(federaisDevidos.baseCalculo).toFixed(2)}</vBCPisCofins>`;
                    if (federaisDevidos.pis) tribXml += `<pAliqPis>${Number(federaisDevidos.pis.aliquota).toFixed(2)}</pAliqPis>`;
                    if (federaisDevidos.cofins) tribXml += `<pAliqCofins>${Number(federaisDevidos.cofins.aliquota).toFixed(2)}</pAliqCofins>`;
                    if (federaisDevidos.pis) tribXml += `<vPis>${Number(federaisDevidos.pis.valor).toFixed(2)}</vPis>`;
                    if (federaisDevidos.cofins) tribXml += `<vCofins>${Number(federaisDevidos.cofins.valor).toFixed(2)}</vCofins>`;
                }
                tribXml += `<tpRetPisCofins>${tpRet}</tpRetPisCofins></piscofins>`;
            }

            if (hasInss) tribXml += `<vRetCP>${Number(r.inss.valor).toFixed(2)}</vRetCP>`;
            if (hasIr) tribXml += `<vRetIRRF>${Number(r.ir.valor).toFixed(2)}</vRetIRRF>`;
            
            // NT 007: vRetCSLL agrega os valores retidos de PIS, COFINS e CSLL.
            if (hasPis || hasCofins || hasCsll) {
                const totalPcc = (hasPis ? Number(r.pis.valor) : 0) + 
                                 (hasCofins ? Number(r.cofins.valor) : 0) + 
                                 (hasCsll ? Number(r.csll.valor) : 0);
                tribXml += `<vRetCSLL>${totalPcc.toFixed(2)}</vRetCSLL>`;
            }
            
            tribXml += `</tribFed>`;
        }

        // === TOTAIS DE TRIBUTOS (Transparência / IBPT) ===
        if (opSimpNac === '3') {
            const pSn = Number(s.aliquotaTotTribSN ?? 6);
            tribXml += `<totTrib><pTotTribSN>${pSn.toFixed(2)}</pTotTribSN></totTrib>`;
            
        } else if (opSimpNac === '1') {
            // 2. REGRA DO LUCRO PRESUMIDO / LUCRO REAL
            let pFed = Number(s.aliquotaTotTribFederal || 0);
            if (!pFed && hasFederalDue) {
                pFed = Number(federaisDevidos?.pis?.aliquota || 0) + Number(federaisDevidos?.cofins?.aliquota || 0);
            }

            // CORREÇÃO: Prioriza a alíquota vinda da Tabela Municipal (regra do SaaS). Se não achar, usa a alíquota genérica.
            const pMun = s.aliquotaMunicipio ? Number(s.aliquotaMunicipio) : (s.aliquota ? Number(s.aliquota) : 0);

            tribXml += `<totTrib><pTotTrib><pTotTribFed>${pFed.toFixed(2)}</pTotTribFed><pTotTribEst>0.00</pTotTribEst><pTotTribMun>${pMun.toFixed(2)}</pTotTribMun></pTotTrib></totTrib>`;
            
        } else {
            // 3. REGRA DO MEI
            tribXml += `<totTrib><indTotTrib>0</indTotTrib></totTrib>`;
        }

        let ibsCbsXml = '';
        const ibscbs = s.ibscbs;
        if (ibscbs?.enabled) {
            if (!ibscbs.finNFSe || !ibscbs.cIndOp || !ibscbs.indDest || !ibscbs.cst || !ibscbs.cClassTrib) {
                throw new Error('Classificacao IBS/CBS incompleta para gerar a DPS.');
            }
            ibsCbsXml = `<IBSCBS>` +
                `<finNFSe>${this.clean(ibscbs.finNFSe)}</finNFSe>` +
                (ibscbs.indFinal !== undefined ? `<indFinal>${this.clean(ibscbs.indFinal)}</indFinal>` : '') +
                `<cIndOp>${this.clean(ibscbs.cIndOp)}</cIndOp>` +
                `<indDest>${this.clean(ibscbs.indDest)}</indDest>` +
                `<valores><trib><gIBSCBS>` +
                    `<CST>${this.clean(ibscbs.cst).padStart(3, '0')}</CST>` +
                    `<cClassTrib>${this.clean(ibscbs.cClassTrib).padStart(6, '0')}</cClassTrib>` +
                `</gIBSCBS></trib></valores>` +
            `</IBSCBS>`;
        }

        // --- FINAL XML ---
        const layoutVersion = m.layoutVersion || '1.01';
        let xml = `<?xml version="1.0" encoding="UTF-8"?>` + 
        `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="${layoutVersion}">` +
            `<infDPS Id="${idDps}">` + 
                `<tpAmb>${tpAmb}</tpAmb>` + 
                `<dhEmi>${dhEmi}</dhEmi>` + 
                `<verAplic>1.10</verAplic>` + 
                `<serie>${m.serie}</serie>` + 
                `<nDPS>${m.numero}</nDPS>` + 
                `<dCompet>${dCompet}</dCompet>` + 
                `<tpEmit>1</tpEmit>` + 
                `<cLocEmi>${this.clean(p.endereco.codigoIbge)}</cLocEmi>` + 
                prestXml + 
                tomaXml + 
                servXml + 
                `<valores>` +
                    `<vServPrest><vServ>${s.valor.toFixed(2)}</vServ></vServPrest>` +
                    `<trib>${tribXml}</trib>` +
                `</valores>` + 
                ibsCbsXml +
            `</infDPS>` + 
        `</DPS>`;

        return xml;
    }
}
