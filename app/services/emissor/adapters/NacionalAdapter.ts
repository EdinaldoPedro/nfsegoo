import { ICanonicalRps } from '../interfaces/ICanonicalRps';
import { decrypt } from '@/app/utils/crypto';

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
        switch(regime) {
            case 'MEI': return '2'; 
            case 'SIMPLES': return '3';
            case 'LUCRO_PRESUMIDO': 
            case 'LUCRO_REAL': return '1';
            default: return '1';
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
        const p = pais.trim().toLowerCase();
        
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
        
        return dict[p] || "XX"; // Se algo muito estranho acontecer, o fallback de segurança é US
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
        
        // Retorna a moeda correspondente ou o Dólar (840) como fallback padrão para exportação
        return dict[moeda?.toUpperCase()] || "840";
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
        const idDps = `DPS${this.clean(p.endereco.codigoIbge).padStart(7,'0')}2${this.clean(p.documento).padStart(14,'0')}${this.clean(m.serie).padStart(5,'0')}${String(m.numero).padStart(15,'0')}`;
        
        const tpAmb = m.ambiente === 'PRODUCAO' ? '1' : '2';
        const opSimpNac = this.mapRegime(p.regimeTributario);
        
        const isExterior = t.tipo === 'EXT' || (t.pais && t.pais !== 'Brasil' && t.pais !== 'BR');
        const codPais = this.mapPais(t.pais || 'Estados Unidos');
        const codMoeda = this.mapMoeda(t.moeda || 'USD');

        const docTomador = this.clean(t.documento);
        const tagDocTomador = docTomador.length === 11 ? `<CPF>${docTomador}</CPF>` : `<CNPJ>${docTomador}</CNPJ>`;
        const omitirEnderecoTomador = !isExterior && docTomador.length === 11 && t.semEndereco === true;

        const razaoSocialTomador = this.escapeXml(t.razaoSocial);
        const enderecoLogradouro = this.escapeXml(t.endereco?.logradouro);
        const enderecoBairro = this.escapeXml(t.endereco?.bairro);
        const descricaoServico = this.escapeXml(s.descricao);

        // --- PRESTADOR ---
        let prestXml = `<prest>` + 
            `<CNPJ>${this.clean(p.documento)}</CNPJ>` + 
            (p.inscricaoMunicipal ? `<IM>${this.clean(p.inscricaoMunicipal)}</IM>` : '');
        
        // Dados de contato do Prestador (Requisito Sefin)
        if (p.telefone) prestXml += `<fone>${this.clean(p.telefone)}</fone>`;
        if (p.email) prestXml += `<email>${p.email}</email>`;
        
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

        if (!omitirEnderecoTomador) {
            tomaXml += `<end>`;
            if (isExterior) {
                tomaXml += `<endExt>` +
                           `<cPais>${codPais}</cPais>` +
                           `<cEndPost>${this.escapeXml(this.clean(t.endereco?.cep) || '00000')}</cEndPost>` +
                           `<xCidade>${this.escapeXml(t.endereco?.cidade || 'Exterior')}</xCidade>` +
                           `<xEstProvReg>${this.escapeXml(t.endereco?.uf || 'EX')}</xEstProvReg>` +
                           `</endExt>`;
            } else {
                tomaXml += `<endNac><cMun>${this.clean(t.endereco?.codigoIbge)}</cMun><CEP>${this.clean(t.endereco?.cep)}</CEP></endNac>`;
            }
            tomaXml += `<xLgr>${enderecoLogradouro}</xLgr>` +
                       `<nro>${this.escapeXml(t.endereco?.numero) || 'SN'}</nro>`;
            if (t.endereco?.complemento) tomaXml += `<xCpl>${this.escapeXml(t.endereco.complemento)}</xCpl>`;
            if (enderecoBairro) tomaXml += `<xBairro>${enderecoBairro}</xBairro>`;
            tomaXml += `</end>`;
        }
        if (t.email) tomaXml += `<email>${t.email}</email>`;
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
        if (codTribMunLimpo.length > 0) {
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

        if (opSimpNac === '1' && !isExterior && (hasPis || hasCofins || hasIr || hasCsll || hasInss)) {
            tribXml += `<tribFed>`;
            
            // Mantém as tags PIS e COFINS intactas, apenas adiciona o tpRetPisCofins no final do bloco
            if (hasPis || hasCofins || hasCsll) {
                // Tabela tpRetPisCofins da NT 007
                let tpRet = '0';
                if (hasPis && hasCofins && hasCsll) tpRet = '3';
                else if (hasPis && hasCofins && !hasCsll) tpRet = '1';
                else if (hasPis && !hasCofins && !hasCsll) tpRet = '5';
                else if (!hasPis && hasCofins && !hasCsll) tpRet = '6';
                else if (!hasPis && !hasCofins && hasCsll) tpRet = '8';
                
                tribXml += `<piscofins><CST>01</CST><vBCPisCofins>${s.valor.toFixed(2)}</vBCPisCofins>`;
                
                // DE VOLTA: Tags de alíquota e valor do PIS e COFINS
                if (hasPis) tribXml += `<pAliqPis>${Number(r.pis.aliquota).toFixed(2)}</pAliqPis>`;
                if (hasCofins) tribXml += `<pAliqCofins>${Number(r.cofins.aliquota).toFixed(2)}</pAliqCofins>`;
                if (hasPis) tribXml += `<vPis>${Number(r.pis.valor).toFixed(2)}</vPis>`;
                if (hasCofins) tribXml += `<vCofins>${Number(r.cofins.valor).toFixed(2)}</vCofins>`;
                
                tribXml += `<tpRetPisCofins>${tpRet}</tpRetPisCofins></piscofins>`;
            }

            if (hasInss) tribXml += `<vRetCP>${Number(r.inss.valor).toFixed(2)}</vRetCP>`;
            if (hasIr) tribXml += `<vRetIRRF>${Number(r.ir.valor).toFixed(2)}</vRetIRRF>`;
            
            // AQUI ESTÁ A MÁGICA: A tag vRetCSLL recebe a soma (PIS + COFINS + CSLL)
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
            // 1. REGRA DO SIMPLES NACIONAL (Fixo em 6.00%)
            tribXml += `<totTrib><pTotTribSN>6.00</pTotTribSN></totTrib>`;
            
        } else if (opSimpNac === '1') {
            // 2. REGRA DO LUCRO PRESUMIDO / LUCRO REAL
            let pFed = 0;
            // Soma APENAS PIS, COFINS e CSLL (Para cravar os 4.65%)
            if (hasPis) pFed += Number(r.pis.aliquota || 0);
            if (hasCofins) pFed += Number(r.cofins.aliquota || 0);
            if (hasCsll) pFed += Number(r.csll.aliquota || 0);

            // CORREÇÃO: Prioriza a alíquota vinda da Tabela Municipal (regra do SaaS). Se não achar, usa a alíquota genérica.
            const pMun = s.aliquotaMunicipio ? Number(s.aliquotaMunicipio) : (s.aliquota ? Number(s.aliquota) : 0);

            tribXml += `<totTrib><pTotTrib><pTotTribFed>${pFed.toFixed(2)}</pTotTribFed><pTotTribEst>0.00</pTotTribEst><pTotTribMun>${pMun.toFixed(2)}</pTotTribMun></pTotTrib></totTrib>`;
            
        } else {
            // 3. REGRA DO MEI
            tribXml += `<totTrib><indTotTrib>0</indTotTrib></totTrib>`;
        }

        // --- FINAL XML ---
        let xml = `<?xml version="1.0" encoding="UTF-8"?>` + 
        `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">` + 
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
            `</infDPS>` + 
        `</DPS>`;

        return xml;
    }
}
