'use strict';

const { PrismaClient } = require('@prisma/client');
require('./register-worker.cjs');
const { originalNfseEnvironment, validateNfseDocument } = require('../dist/worker/app/services/emissor/validation/AuthorizedNfseValidator.js');

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const where = {
    arquivadoEm: null,
    status: { in: ['AUTORIZADA', 'CANCELADA'] },
    chaveAcesso: { not: null },
    OR: [{ xmlAutorizadoBase64: { not: null } }, { xmlBase64: { not: null } }],
    documentTask: { is: null },
  };
  const notes = await prisma.notaFiscal.findMany({ where, select: { id: true, ambiente: true, chaveAcesso: true,
    prestadorCnpj: true, xmlAutorizadoBase64: true, xmlBase64: true }, orderBy: { id: 'asc' } });
  const verified = [];
  let manual = 0;
  for (const note of notes) {
    try {
      const xml = note.xmlAutorizadoBase64 || note.xmlBase64;
      const environment = note.ambiente || originalNfseEnvironment(xml);
      await validateNfseDocument(xml, environment, note.chaveAcesso, note.prestadorCnpj);
      verified.push(note.id);
    } catch { manual++; }
  }
  console.info(`[pdf-recovery] ${notes.length} nota(s) sem tarefa: ${verified.length} XML(s) passaram na validação atual; ${manual} exigem análise manual. Modo: ${apply ? 'enfileirar' : 'prévia'}.`);
  if (!apply || verified.length === 0) return;

  let queued = 0;
  for (let offset = 0; offset < verified.length; offset += 100) {
    const batch = verified.slice(offset, offset + 100);
    const result = await prisma.emissionDocumentTask.createMany({
      data: batch.map(notaId => ({ notaId })),
      skipDuplicates: true,
    });
    queued += result.count;
  }
  console.info(`[pdf-recovery] ${queued} tarefa(s) enfileirada(s). PDFs antigos e situação fiscal preservados; o worker fará a verificação antes de substituir cada PDF.`);
}

main().catch(error => {
  console.error('[pdf-recovery] Falha ao enfileirar documentos:', error instanceof Error ? error.message : 'erro desconhecido');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
