import { prisma } from '@/app/utils/prisma';
import { requestFiscalDocument } from './fiscalNoteService';

// Compatibility entry points enqueue only document work. No remote consultation,
// fiscal status change, archive, or replacement of the authorized XML.
async function enqueueDocument(notaId: string, empresaId: string, vendaId: string) {
  return prisma.$transaction(async (tx) => {
    const nota = await tx.notaFiscal.findUnique({ where: { id: notaId } });
    if (!nota || nota.empresaId !== empresaId || nota.vendaId !== vendaId) throw new Error('Vínculo da nota inconsistente.');
    if (!['AUTORIZADA', 'CANCELADA'].includes(nota.status)) throw new Error('Nota ainda não possui situação fiscal confirmada.');
    return requestFiscalDocument(tx, nota.id);
  });
}
export const processarRetornoNota = enqueueDocument;
export const processarCancelamentoNota = enqueueDocument;
