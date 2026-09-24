export interface IResultadoEmissao {
    sucesso: boolean;
    notaGov?: {
        numero: string;
        chave: string;
        protocolo: string;
        xml: string;
    };
    erros?: any[];
    xmlGerado?: string;
    motivo?: string;
    failureKind?: 'LOCAL_REJECTION' | 'PORTAL_REJECTION' | 'UNKNOWN';
}

export interface IResultadoConsulta {
    sucesso: boolean;
    situacao: 'AUTORIZADA' | 'CANCELADA' | 'PROCESSANDO' | 'ERRO';
    numeroNota?: string;      
    xmlDistribuicao?: string; 
    pdfBase64?: string;       
    protocolo?: string; // <--- CAMPO NOVO ADICIONADO
    motivo?: string;
    xmlEvento?: string;
    dataCancelamento?: Date;
}

export interface IResultadoCancelamento {
    sucesso: boolean;
    requestMatched?: boolean;
    dataCancelamento?: Date;
    xmlEvento?: string;       
    motivo?: string;
    failureKind?: 'LOCAL_REJECTION' | 'PORTAL_REJECTION' | 'UNKNOWN';
}

export interface IDadosEmissao {
    prestador: any;
    tomador: any;
    venda: any;
    servico: {
        valor: number;
        descricao: string;
        cnae: string;
        itemLc: string;
        codigoTribNacional: string;
    };
    ambiente: 'HOMOLOGACAO' | 'PRODUCAO';
    numeroDPS: number;
    serieDPS: string;
    dataCompetencia?: string;
    layoutVersion?: string;
    fiscalSnapshot?: unknown;
}

export interface IEmissorStrategy {
    preparar(dados: IDadosEmissao): Promise<string>;
    transmitirPreparado(xmlAssinado: string, empresa: any): Promise<IResultadoEmissao>;
    conciliarDps(xmlAssinado: string, empresa: any): Promise<IResultadoEmissao>;
    consultar(chave: string, empresa: any): Promise<IResultadoConsulta>;
    prepararCancelamento(chave: string, reason: { code: '1' | '2' | '9'; justification: string }, timestamp: Date, empresa: any): Promise<string>;
    transmitirCancelamento(xml: string, chave: string, empresa: any): Promise<IResultadoCancelamento>;
    conciliarCancelamento(xml: string, chave: string, empresa: any): Promise<IResultadoCancelamento>;
}
