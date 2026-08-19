import { IRegimeHandler } from "./IRegimeHandler";
import { ICanonicalRps } from "../interfaces/ICanonicalRps";
import { TaxCodeResolver } from "../resolvers/TaxCodeResolver";

export class SimplesNacionalHandler implements IRegimeHandler {
    async getDadosTributarios(venda: any, empresa: any): Promise<Partial<ICanonicalRps['servico']>> {
        
        // 1. Resolve particularidades municipais vigentes e pilotadas no banco.
        const codigosLocais = await TaxCodeResolver.resolve(
            empresa.codigoIbge, 
            venda.cnae || empresa.cnaePrincipal,
            empresa.id,
            venda.dataCompetencia,
        );

        // 2. Prepara Valores
        const valor = Number(venda.valor);
        const issRetido = venda.issRetido === true;

        const aliquota = Number(venda.aliquota) || Number(empresa.aliquotaPadrao) || 0;
            
        const valorIss = valor * (aliquota / 100);
        

        // 3. Processa Retenções Federais (se houver)
        const r = venda.retencoes || {}; 
        const retencoes = {
            pis: { valor: Number(r.pis?.valor) || 0, retido: !!r.pis?.retido, aliquota: Number(r.pis?.aliquota) || 0 },
            cofins: { valor: Number(r.cofins?.valor) || 0, retido: !!r.cofins?.retido, aliquota: Number(r.cofins?.aliquota) || 0 },
            inss: { valor: Number(r.inss?.valor) || 0, retido: !!r.inss?.retido, aliquota: Number(r.inss?.aliquota) || 0 },
            ir: { valor: Number(r.ir?.valor) || 0, retido: !!r.ir?.retido, aliquota: Number(r.ir?.aliquota) || 0 },
            csll: { valor: Number(r.csll?.valor) || 0, retido: !!r.csll?.retido, aliquota: Number(r.csll?.aliquota) || 0 }
        };

        // 4. Calcula Líquido
        let totalRetido = 0;
        if (issRetido) totalRetido += valorIss;
        if (retencoes.pis.retido) totalRetido += retencoes.pis.valor;
        if (retencoes.cofins.retido) totalRetido += retencoes.cofins.valor;
        if (retencoes.inss.retido) totalRetido += retencoes.inss.valor;
        if (retencoes.ir.retido) totalRetido += retencoes.ir.valor;
        if (retencoes.csll.retido) totalRetido += retencoes.csll.valor;

        return {
            valor: valor,
            valorLiquido: valor - totalRetido,
            descricao: venda.descricao,
            cnae: venda.cnae || empresa.cnaePrincipal,
            itemListaServico: venda.itemLc || '00.00',
            codigoTributacaoNacional: venda.codigoTribNacional, // Ex: 010601

            // Dados Fiscais
            aliquotaAplicada: aliquota,
            valorIss: valorIss,
            issRetido: issRetido,
            tipoTributacao: '1', // 1 - Tributação no município (Regra geral)

            // === A CORREÇÃO ESTÁ AQUI ===
            // Dá preferência para a regra local (se existir), senão usa o banco global (da rota API)
            codigoNbs: codigosLocais.codigoNbs || venda.codigoNbs,
            codigoTributacaoMunicipal: codigosLocais.codigoMunicipal || venda.codigoTributacaoMunicipal,

            retencoes: retencoes
        };
    }
}
