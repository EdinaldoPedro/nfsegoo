import { BaseStrategy } from './BaseStrategy';
import { IEmissorStrategy, IDadosEmissao, IResultadoEmissao, IResultadoConsulta, IResultadoCancelamento } from '../interfaces/IEmissorStrategy';
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';
import zlib from 'zlib';
import { NacionalAdapter } from '../adapters/NacionalAdapter';
import { ICanonicalRps } from '../interfaces/ICanonicalRps';
import { MeiHandler } from '../handlers/MeiHandler';
import { SimplesNacionalHandler } from '../handlers/SimplesNacionalHandler';

export class NacionalStrategy extends BaseStrategy implements IEmissorStrategy {
    
    private adapter: NacionalAdapter;

    constructor() {
        super();
        this.adapter = new NacionalAdapter();
    }

    async executar(dados: IDadosEmissao): Promise<IResultadoEmissao> {
        // === 0. SANITIZAÇÃO DE DADOS ===
        const omitirEnderecoTomador = dados.tomador.tipo === 'PF' && dados.tomador.semEndereco === true;

        if (!omitirEnderecoTomador && (!dados.tomador.numero || dados.tomador.numero.trim() === '')) {
            dados.tomador.numero = 'S/N';
        }
        if (!omitirEnderecoTomador && (!dados.tomador.bairro || dados.tomador.bairro.trim() === '')) {
            dados.tomador.bairro = 'Bairro';
        }
        
        // Garante que CEP tenha apenas números (EXCETO SE FOR EXTERIOR)
        if (dados.tomador.cep && dados.tomador.tipo !== 'EXT') {
            dados.tomador.cep = dados.tomador.cep.replace(/\D/g, '');
        }

        const { prestador, tomador, servico, numeroDPS, serieDPS, ambiente, dataCompetencia } = dados as any;

        // === DESCRIPTOGRAFIA EM MEMÓRIA (NOVO) ===

        try {
            // 1. Validações Prévias
            this.validarCertificado(prestador);
            this.validarTomador(tomador);

            // 2. SELEÇÃO DO HANDLER
            const regime = String(prestador.regimeTributario).toUpperCase();
            let handler;

            if (regime === 'MEI') {
                handler = new MeiHandler();
            } else {
                handler = new SimplesNacionalHandler();
            }

            // 3. Obtenção dos Dados Tributários
            const dadosTributarios = await handler.getDadosTributarios(servico, prestador);

            // 4. Montagem do Objeto Canônico
            const rps: ICanonicalRps = {
                prestador: {
                    id: prestador.id,
                    documento: prestador.documento,
                    inscricaoMunicipal: prestador.inscricaoMunicipal,
                    regimeTributario: prestador.regimeTributario as any,
                    endereco: {
                        codigoIbge: prestador.codigoIbge,
                        uf: prestador.uf
                    },
                    configuracoes: {
                        aliquotaPadrao: Number(prestador.aliquotaPadrao),
                        issRetido: dadosTributarios.issRetido,
                        tipoTributacao: prestador.tipoTributacaoPadrao,
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
                    semEndereco: tomador.semEndereco,

                    endereco: {
                        cep: tomador.cep,
                        logradouro: tomador.logradouro,
                        numero: tomador.numero, 
                        bairro: tomador.bairro,
                        cidade: tomador.cidade, // Cidade é necessária para <xCidade> no Exterior
                        codigoIbge: tomador.codigoIbge,
                        uf: tomador.uf
                    }
                },
                // === MERGE DO SERVIÇO (Garante que valorMoedaEstrangeira e codigoNbs não sejam perdidos) ===
                servico: {
                    ...servico,
                    ...dadosTributarios
                } as ICanonicalRps['servico'],
                
                meta: {
                    ambiente: ambiente,
                    serie: serieDPS,
                    numero: numeroDPS,
                    dataEmissao: new Date(),
                    dataCompetencia: dataCompetencia
                }
            };

            // 5. Adapter: Transformar RPS em XML
            const xmlGerado = this.adapter.toXml(rps);

            // 6. Assinar e Transmitir
            const idDps = `DPS${this.cleanString(rps.prestador.endereco.codigoIbge).padStart(7,'0')}2${this.cleanString(rps.prestador.documento).padStart(14,'0')}${this.cleanString(rps.meta.serie).padStart(5,'0')}${String(rps.meta.numero).padStart(15,'0')}`;
            
            const xmlAssinado = this.assinarXML(xmlGerado, idDps, prestador);
            return this.transmitirXML(xmlAssinado, prestador);

        } catch (error: any) {
            console.error("Erro na Strategy:", error);
            return { 
                sucesso: false, 
                motivo: `Erro Motor Fiscal: ${error.message}`, 
                erros: [{ codigo: "MOTOR_ERR", mensagem: error.message }] 
            };
        }
    }

    async consultar(chave: string, empresa: any): Promise<IResultadoConsulta> {
        try {
            // === DESCRIPTOGRAFIA EM MEMÓRIA (NOVO) ===

            const credenciais = this.extrairCredenciais(empresa, 'CONSULT_NFSE');
            const httpsAgent = new https.Agent({ cert: credenciais.cert, key: credenciais.key, rejectUnauthorized: true, family: 4 });
            
            const urlBase = empresa.ambiente === 'PRODUCAO' 
                ? "https://sefin.nfse.gov.br/SefinNacional/nfse" 
                : "https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse";
            
            const urlConsulta = `${urlBase}/${chave}`;
            console.log(`[CONSULTA] GET ${urlConsulta}`);

            const response = await axios.get(urlConsulta, {
                headers: { 
                    'Authorization': 'Basic ' + Buffer.from(`${this.cleanString(empresa.documento)}:${credenciais.senha}`).toString('base64')
                },
                httpsAgent
            });

            const data = response.data;
            let xmlRetorno = '';

            if (data.nfseXmlGZipB64) {
                const bufferRetorno = Buffer.from(data.nfseXmlGZipB64, 'base64');
                xmlRetorno = zlib.gunzipSync(bufferRetorno).toString('utf-8');
            } else if (typeof data === 'string' && data.includes('<')) {
                xmlRetorno = data;
            } else {
                xmlRetorno = JSON.stringify(data);
            }

            let numeroReal = '';
            const matchNum = xmlRetorno.match(/<nNfse>(\d+)<\/nNfse>/i) || xmlRetorno.match(/<nNFSe>(\d+)<\/nNFSe>/i);
            if (matchNum) numeroReal = matchNum[1];

            let protocoloRecuperado = data.protocolo || '';
            if (!protocoloRecuperado) {
                 let match = xmlRetorno.match(/:?nProt>(\d+)<\//i) || xmlRetorno.match(/"protocolo"\s*:\s*"?(\d+)"?/i);
                 if (!match) match = xmlRetorno.match(/:?nDFSe>(\d+)<\//i);
                 if (match) protocoloRecuperado = match[1];
                 else if (!protocoloRecuperado) protocoloRecuperado = chave;
            }

            let situacaoAtual: 'AUTORIZADA' | 'CANCELADA' = 'AUTORIZADA';
            if (xmlRetorno.includes('<cSit>2</cSit>') || 
                xmlRetorno.includes('<cSit>3</cSit>') || 
                xmlRetorno.includes('<e101101>')) {
                situacaoAtual = 'CANCELADA';
            }

            if (numeroReal || xmlRetorno.includes('Autorizado') || xmlRetorno.includes('chaveAcesso') || situacaoAtual === 'CANCELADA') {
                return {
                    sucesso: true,
                    situacao: situacaoAtual,
                    numeroNota: numeroReal || '0',
                    protocolo: protocoloRecuperado, 
                    xmlDistribuicao: Buffer.from(xmlRetorno).toString('base64'),
                    pdfBase64: undefined,
                    motivo: 'Consulta realizada com sucesso.'
                };
            }
            return { sucesso: false, situacao: 'ERRO', motivo: 'Sefaz retornou, mas sem XML válido.' };
        } catch (error: any) {
            console.error("Erro Axios GET:", error.message);
            return { sucesso: false, situacao: 'ERRO', motivo: error.message };
        }
    }

    async cancelar(chave: string, protocolo: string, motivoCompleto: string, empresa: any): Promise<IResultadoCancelamento> {
        try {
            // === DESCRIPTOGRAFIA EM MEMÓRIA (NOVO) ===

            const dhEvento = this.formatarDataSefaz(new Date());
            const tpEvento = '101101';
            const idPed = `PRE${chave}${tpEvento}`; 
            
            const MAPA_MOTIVOS: Record<string, string> = {
                "Erro na emissão": "1", "Serviço não prestado": "2", "Erro de assinatura": "3", "Duplicidade da nota": "4"
            };
            let cMotivo = "1";
            let xMotivo = motivoCompleto;
            const partesMotivo = motivoCompleto.split(':');
            if (partesMotivo.length > 1) {
                const chaveMotivo = partesMotivo[0].trim();
                if (MAPA_MOTIVOS[chaveMotivo]) {
                    cMotivo = MAPA_MOTIVOS[chaveMotivo];
                    xMotivo = partesMotivo.slice(1).join(':').trim();
                }
            }
            if (xMotivo.length < 15) xMotivo += " (Solicitação do contribuinte)";

            const infPedRegContent = 
                `<tpAmb>${empresa.ambiente === 'PRODUCAO' ? '1' : '2'}</tpAmb>` +
                `<verAplic>1.00</verAplic>` +
                `<dhEvento>${dhEvento}</dhEvento>` +
                `<CNPJAutor>${this.cleanString(empresa.documento)}</CNPJAutor>` +
                `<chNFSe>${chave}</chNFSe>` +
                `<${'e' + tpEvento}>` + 
                    `<xDesc>Cancelamento de NFS-e</xDesc>` +
                    `<cMotivo>${cMotivo}</cMotivo>` +
                    `<xMotivo>${xMotivo}</xMotivo>` + 
                `</${'e' + tpEvento}>`;

            const xmlParaAssinar = `<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00"><infPedReg Id="${idPed}">${infPedRegContent}</infPedReg></pedRegEvento>`;
            
            const xmlAssinado = this.assinarPedidoEvento(xmlParaAssinar, idPed, empresa);
            
            const xmlEnvio = `<?xml version="1.0" encoding="UTF-8"?>${xmlAssinado}`;
            const xmlBuffer = Buffer.from(xmlEnvio, 'utf-8');
            const xmlGzip = zlib.gzipSync(xmlBuffer);
            const payloadBase64 = xmlGzip.toString('base64');

            const credenciais = this.extrairCredenciais(empresa, 'CANCEL_NFSE');
            const httpsAgent = new https.Agent({ cert: credenciais.cert, key: credenciais.key, rejectUnauthorized: true, family: 4 });
            
            const urlBase = empresa.ambiente === 'PRODUCAO' 
                ? "https://sefin.nfse.gov.br/SefinNacional/nfse"
                : "https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse";
            const urlEventos = `${urlBase}/${chave}/eventos`;

            const response = await axios.post(urlEventos, 
                { pedidoRegistroEventoXmlGZipB64: payloadBase64 }, 
                {
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic ' + Buffer.from(`${this.cleanString(empresa.documento)}:${credenciais.senha}`).toString('base64') },
                    httpsAgent
                }
            );

            const data = response.data;
            const zipRetorno = data.eventoXmlGZipB64 || data.pedidoRegistroEventoXmlGZipB64;
            
            if (zipRetorno) {
                 const buff = Buffer.from(zipRetorno, 'base64');
                 const xmlRetorno = zlib.gunzipSync(buff).toString('utf-8');
                 return {
                     sucesso: true,
                     dataCancelamento: new Date(),
                     xmlEvento: Buffer.from(xmlRetorno).toString('base64'),
                     motivo: 'Cancelamento homologado.'
                 };
            }
            return { sucesso: false, motivo: "Evento rejeitado ou retorno inválido." };

        } catch (error: any) {
            let msgErro = error.message;
            if (error.response && error.response.data) {
                const erroData = JSON.stringify(error.response.data);
                if (erroData.includes("E0840")) {
                    return {
                        sucesso: true,
                        dataCancelamento: new Date(),
                        motivo: "Nota já estava cancelada na Sefaz (Sincronizado)."
                    };
                }
                msgErro = `Sefaz Recusou: ${erroData.substring(0, 100)}...`;
            }
            return { sucesso: false, motivo: msgErro };
        }
    }

    private assinarPedidoEvento(xml: string, tagId: string, empresa: any): string {
        try {
            const credenciais = this.extrairCredenciais(empresa, 'SIGN_CANCEL');
            const certClean = credenciais.cert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|[\r\n]/g, '');
            
            const match = xml.match(/<infPedReg[\s\S]*?<\/infPedReg>/);
            if (!match) throw new Error("Tag infPedReg não encontrada.");
            
            let nodeToSign = match[0]; 
            if (!nodeToSign.includes('xmlns="http://www.sped.fazenda.gov.br/nfse"')) {
                nodeToSign = nodeToSign.replace('<infPedReg', '<infPedReg xmlns="http://www.sped.fazenda.gov.br/nfse"');
            }

            const shasum = crypto.createHash('sha256');
            shasum.update(nodeToSign, 'utf8');
            const digestValue = shasum.digest('base64');

            const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod><Reference URI="#${tagId}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod><DigestValue>${digestValue}</DigestValue></Reference></SignedInfo>`;

            const signer = crypto.createSign('RSA-SHA256');
            signer.update(signedInfo);
            const signatureValue = signer.sign(credenciais.key, 'base64');

            const signatureXML = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certClean}</X509Certificate></X509Data></KeyInfo></Signature>`;

            return xml.replace('</pedRegEvento>', `${signatureXML}</pedRegEvento>`);
        } catch (e: any) { throw new Error(e.message); }
    }
}
