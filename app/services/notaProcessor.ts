import { PrismaClient } from '@prisma/client';
import { EmissorFactory } from '@/app/services/emissor/factories/EmissorFactory';
import { NfsePortalDownloader } from '@/app/services/pdf/NfsePortalDownloader';
import { createLog } from '@/app/services/logger';
import zlib from 'zlib';

const prisma = new PrismaClient();

// === FLUXO DE EMISSÃO (CORRIGIDO: ATUALIZA NÚMERO DA NOTA) ===
export async function processarRetornoNota(notaId: string, empresaId: string, vendaId: string) {
    try {
        const nota = await prisma.notaFiscal.findUnique({
            where: { id: notaId },
            include: { empresa: true }
        });

        if (!nota || !nota.chaveAcesso) throw new Error("Nota sem chave de acesso.");

        // A. XML OFICIAL
        await createLog({ level: 'INFO', action: 'CONSULTA_XML_AUTORIZADO', message: 'Buscando XML de distribuição...', empresaId, vendaId });
        
        const strategy = EmissorFactory.getStrategy(nota.empresa);
        const consultaRes = await strategy.consultar(nota.chaveAcesso, nota.empresa);

        if (consultaRes.sucesso && consultaRes.xmlDistribuicao) {
            
            // === AQUI ESTAVA FALTANDO: ATUALIZAR O NÚMERO ===
            const dadosUpdate: any = { 
                xmlBase64: consultaRes.xmlDistribuicao,
                xmlAutorizadoBase64: consultaRes.xmlDistribuicao
            };

            // Se a consulta retornou um número válido (diferente de 0), atualiza no banco
            if (consultaRes.numeroNota && parseInt(consultaRes.numeroNota) > 0) {
                dadosUpdate.numero = parseInt(consultaRes.numeroNota);
            }

            await prisma.notaFiscal.update({ 
                where: { id: notaId }, 
                data: dadosUpdate 
            });

            await createLog({ 
                level: 'INFO', 
                action: 'XML_ATUALIZADO', 
                message: `XML Oficial salvo. Nota atualizada para Nº ${dadosUpdate.numero || nota.numero}`, 
                empresaId, 
                vendaId,
                details: { xml: consultaRes.xmlDistribuicao, numeroRecuperado: dadosUpdate.numero } 
            });
        }

        // B. PDF VIA BOT
        await createLog({ level: 'INFO', action: 'BOT_PDF_INICIADO', message: 'Baixando PDF Oficial...', empresaId, vendaId });
        
        try {
            const downloader = new NfsePortalDownloader();
            const pdfBuffer = await downloader.downloadPdfOficial(
                nota.chaveAcesso,
                nota.empresa.certificadoA1!,
                nota.empresa.senhaCertificado!,
                nota.empresa.id
            );
            const pdfGzip = zlib.gzipSync(pdfBuffer);
            const pdfBase64 = pdfGzip.toString('base64');

            await prisma.notaFiscal.update({ where: { id: notaId }, data: { pdfBase64: pdfBase64 } });
            await createLog({ 
                level: 'INFO', 
                action: 'PDF_CAPTURADO', 
                message: 'PDF Oficial salvo com sucesso!', 
                empresaId, 
                vendaId,
                details: { pdf: pdfBase64 } 
            });

        } catch (errBot: any) {
            await createLog({ level: 'ALERTA', action: 'FALHA_BOT_PDF', message: 'O robô não conseguiu baixar o PDF agora.', details: { erro: errBot.message }, empresaId, vendaId });
        }

        // C. FINALIZAÇÃO
        await prisma.venda.update({ where: { id: vendaId }, data: { status: 'CONCLUIDA' } });
        await createLog({ level: 'INFO', action: 'PROCESSO_FINALIZADO', message: 'Ciclo de emissão concluído.', empresaId, vendaId });

    } catch (error: any) {
        console.error("Erro pós-emissão:", error);
        await createLog({ level: 'ERRO', action: 'ERRO_PROCESSAMENTO', message: error.message, empresaId, vendaId });
    }
}

// === FLUXO DE CANCELAMENTO (MANTIDO IGUAL AO ÚLTIMO SUCESSO) ===
export async function processarCancelamentoNota(notaId: string, empresaId: string, vendaId: string) {
    try {
        const nota = await prisma.notaFiscal.findUnique({
            where: { id: notaId },
            include: { empresa: true }
        });

        if (!nota || !nota.chaveAcesso) throw new Error("Nota sem chave para processar cancelamento.");

        // 1. CONSULTA XML CANCELADO
        await createLog({
            level: 'INFO', action: 'SYNC_XML_CANCELAMENTO',
            message: 'Consultando Sefaz para buscar XML atualizado (Cancelado)...',
            empresaId, vendaId
        });

        const strategy = EmissorFactory.getStrategy(nota.empresa);
        const consultaRes = await strategy.consultar(nota.chaveAcesso, nota.empresa);

        if (consultaRes.sucesso && consultaRes.xmlDistribuicao) {
            await prisma.notaFiscal.update({
                where: { id: notaId },
                data: {
                    xmlBase64: consultaRes.xmlDistribuicao,
                    xmlAutorizadoBase64: (nota as any).xmlAutorizadoBase64 || nota.xmlBase64 || consultaRes.xmlDistribuicao
                } as any
            });

            await createLog({
                level: 'INFO', action: 'XML_SUBSTITUIDO',
                message: 'XML Autorizado substituído pelo XML de Cancelamento.',
                empresaId, vendaId,
                details: { xml: consultaRes.xmlDistribuicao }
            });
        }

        // 2. SUBSTITUIÇÃO DO PDF (BOT)
        await createLog({
            level: 'INFO', action: 'BOT_PDF_CANCELAMENTO',
            message: 'Acionando robô para baixar novo PDF com tarja de CANCELADO...',
            empresaId, vendaId
        });

        try {
            const downloader = new NfsePortalDownloader();
            const pdfBuffer = await downloader.downloadPdfOficial(
                nota.chaveAcesso,
                nota.empresa.certificadoA1!,
                nota.empresa.senhaCertificado!,
                nota.empresa.id
            );

            // Compacta e Substitui
            const pdfGzip = zlib.gzipSync(pdfBuffer);
            const pdfBase64 = pdfGzip.toString('base64');

            await prisma.notaFiscal.update({
                where: { id: notaId },
                data: { pdfBase64: pdfBase64 }
            });

            await createLog({
                level: 'INFO', action: 'PDF_ATUALIZADO',
                message: 'PDF atualizado com a tarja de CANCELAMENTO.',
                empresaId, vendaId,
                details: { pdf: pdfBase64 } 
            });

        } catch (errBot: any) {
            await createLog({
                level: 'ALERTA', action: 'FALHA_BOT_CANCELAMENTO',
                message: 'Não foi possível baixar o PDF Cancelado. O arquivo antigo permanece.',
                details: { erro: errBot.message },
                empresaId, vendaId
            });
        }

        await createLog({
            level: 'INFO', action: 'CANCELAMENTO_COMPLETO',
            message: 'Processo de pós-cancelamento finalizado.',
            empresaId, vendaId
        });

    } catch (error: any) {
        console.error("Erro pós-cancelamento:", error);
        await createLog({
            level: 'ERRO', action: 'ERRO_SYNC_CANCELAMENTO',
            message: 'Erro ao sincronizar arquivos de cancelamento.',
            details: { erro: error.message },
            empresaId, vendaId
        });
    }
}
