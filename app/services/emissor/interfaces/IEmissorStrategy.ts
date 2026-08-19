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
}

export interface IResultadoConsulta {
    sucesso: boolean;
    situacao: 'AUTORIZADA' | 'CANCELADA' | 'PROCESSANDO' | 'ERRO';
    numeroNota?: string;      
    xmlDistribuicao?: string; 
    pdfBase64?: string;       
    protocolo?: string; // <--- CAMPO NOVO ADICIONADO
    motivo?: string;
}

export interface IResultadoCancelamento {
    sucesso: boolean;
    dataCancelamento?: Date;
    xmlEvento?: string;       
    motivo?: string;
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
    executar(dados: IDadosEmissao): Promise<IResultadoEmissao>;
    consultar(chave: string, empresa: any): Promise<IResultadoConsulta>;
    cancelar(chave: string, protocolo: string, motivo: string, empresa: any): Promise<IResultadoCancelamento>;
}
