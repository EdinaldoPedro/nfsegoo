import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { fiscalCnpj, isNfseId } from '@/app/utils/fiscal-identifiers';
import { directElement, fiscalXml } from './emissor/validation/FiscalXml';
import { verifiedFiscalReference } from './emissor/validation/FiscalSignature';
import { FiscalSchemaError, validateFiscalSchema } from './emissor/validation/FiscalSchema';

const legacySelect = {
  id: true, empresaId: true, vendaId: true, numero: true, numeroOficial: true, ambiente: true,
  status: true, arquivadoEm: true, chaveAcesso: true, prestadorCnpj: true,
  valor: true, xmlAutorizadoBase64: true, xmlBase64: true, dataEmissao: true,
  empresa: { select: { razaoSocial: true, documento: true } },
} satisfies Prisma.NotaFiscalSelect;

type LegacyNote = Prisma.NotaFiscalGetPayload<{ select: typeof legacySelect }>;
type Verified = { ambiente: 'PRODUCAO' | 'HOMOLOGACAO'; xmlHash: string; schema: 'ATUAL' | 'LEGADO_XNBS_CEP' };
type Inspection = { eligible: true; verified: Verified } | { eligible: false; reason: string };

function signedEnvironment(note: LegacyNote, source: string): Omit<Verified, 'schema'> {
  const xml = fiscalXml(source);
  const signed = verifiedFiscalReference(xml, 'NFSe');
  const id = signed.getAttribute('Id') || '';
  if (!isNfseId(id) || !note.chaveAcesso || id.slice(3) !== note.chaveAcesso) throw new Error('Chave assinada divergente.');
  const dps = directElement(directElement(signed, 'DPS'), 'infDPS');
  const value = directElement(directElement(directElement(dps, 'valores'), 'vServPrest'), 'vServ').textContent || '';
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value) || new Prisma.Decimal(value).toFixed(2) !== note.valor.toFixed(2)) {
    throw new Error('Valor assinado divergente.');
  }
  const number = directElement(signed, 'nNFSe').textContent || '';
  if (!/^[1-9][0-9]{0,12}$/.test(number) || note.numeroOficial && note.numeroOficial !== number) throw new Error('Número oficial divergente.');
  const issuer = fiscalCnpj(note.prestadorCnpj);
  if (!issuer || fiscalCnpj(note.empresa.documento) !== issuer
    || fiscalCnpj(directElement(directElement(signed, 'emit'), 'CNPJ').textContent || '') !== issuer
    || fiscalCnpj(directElement(directElement(dps, 'prest'), 'CNPJ').textContent || '') !== issuer) {
    throw new Error('Prestador assinado divergente.');
  }
  const environment = directElement(dps, 'tpAmb').textContent;
  if (environment !== '1' && environment !== '2') throw new Error('Ambiente assinado desconhecido.');
  return { ambiente: environment === '1' ? 'PRODUCAO' : 'HOMOLOGACAO', xmlHash: createHash('sha256').update(xml).digest('hex') };
}

/** Only confirms the environment of a historical stored NFSe. This deliberately
 * does not assert that all legacy metadata passes today's XSD or alter any
 * amounts, dates, status, XML, PDF, or fiscal authorization evidence. */
export async function inspectLegacyFiscalEnvironment(note: LegacyNote): Promise<Inspection> {
  if (note.ambiente !== null || note.arquivadoEm || !['AUTORIZADA', 'CANCELADA'].includes(note.status)) {
    return { eligible: false, reason: 'Nota fora do escopo de conciliação.' };
  }
  const source = note.xmlAutorizadoBase64 || note.xmlBase64;
  if (!source) return { eligible: false, reason: 'XML autorizado não está disponível.' };
  try {
    const verified = signedEnvironment(note, source);
    // If both historical XML columns differ, neither may silently contradict
    // the other. Both signatures and immutable fiscal identifiers must agree.
    if (note.xmlAutorizadoBase64 && note.xmlBase64 && note.xmlAutorizadoBase64 !== note.xmlBase64) {
      const alternate = signedEnvironment(note, note.xmlBase64);
      if (alternate.ambiente !== verified.ambiente) throw new Error('XMLs preservados divergem.');
    }
    let schema: Verified['schema'] = 'ATUAL';
    try { await validateFiscalSchema(source, 'NFSe'); }
    catch (error) {
      // Only the two known fields found in the preserved 2026 legacy corpus
      // can bypass the current XSD for environment reconciliation. This does
      // not mark other metadata as verified or weaken new issuance validation.
      if (!(error instanceof FiscalSchemaError) || !error.fields.length
        || error.fields.some(field => field !== 'xNBS' && field !== 'CEP')) throw error;
      schema = 'LEGADO_XNBS_CEP';
    }
    return { eligible: true, verified: { ...verified, schema } };
  } catch {
    return { eligible: false, reason: 'XML, assinatura ou dados fiscais divergentes; análise manual necessária.' };
  }
}

export async function listLegacyFiscalEnvironments(page: number) {
  const where: Prisma.NotaFiscalWhereInput = { ambiente: null, arquivadoEm: null };
  const [total, notes] = await Promise.all([
    prisma.notaFiscal.count({ where }),
    prisma.notaFiscal.findMany({ where, select: legacySelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 50, take: 50 }),
  ]);
  return { total, page, pageSize: 50, pages: Math.max(1, Math.ceil(total / 50)), items: await Promise.all(notes.map(async (note) => {
    const inspection = await inspectLegacyFiscalEnvironment(note);
    return { id: note.id, empresa: note.empresa.razaoSocial, numero: note.numeroOficial || (note.numero ? String(note.numero) : '—'),
      status: note.status, dataEmissao: note.dataEmissao?.toISOString() || null,
      eligible: inspection.eligible, ambiente: inspection.eligible ? inspection.verified.ambiente : null,
      schema: inspection.eligible ? inspection.verified.schema : null,
      reason: inspection.eligible ? null : inspection.reason };
  })) };
}

export async function confirmLegacyFiscalEnvironments(actorId: string, ids: string[], justification: string) {
  const results: Array<{ id: string; status: 'CONFIRMADA' | 'REVISAO_MANUAL' | 'ALTERADA'; ambiente?: string; reason?: string }> = [];
  for (const id of ids) {
    const note = await prisma.notaFiscal.findUnique({ where: { id }, select: legacySelect });
    if (!note || note.ambiente !== null) { results.push({ id, status: 'ALTERADA', reason: 'Nota não encontrada ou já conciliada.' }); continue; }
    const inspection = await inspectLegacyFiscalEnvironment(note);
    if (!inspection.eligible) { results.push({ id, status: 'REVISAO_MANUAL', reason: inspection.reason }); continue; }
    const result = await prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
      if (!actor || !['ADMIN', 'MASTER'].includes(actor.role)) throw Object.assign(new Error('Acesso administrativo revogado.'), { status: 403 });
      await tx.$queryRaw`SELECT "id" FROM "NotaFiscal" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.notaFiscal.findUnique({ where: { id }, select: legacySelect });
      if (!current || current.ambiente !== null || current.arquivadoEm || current.status !== note.status
        || current.xmlAutorizadoBase64 !== note.xmlAutorizadoBase64 || current.xmlBase64 !== note.xmlBase64
        || current.chaveAcesso !== note.chaveAcesso || current.prestadorCnpj !== note.prestadorCnpj
        || !current.valor.equals(note.valor) || current.numeroOficial !== note.numeroOficial || current.empresaId !== note.empresaId) {
        return { id, status: 'ALTERADA' as const, reason: 'Nota alterada durante a conferência; atualize a prévia.' };
      }
      await tx.notaFiscal.update({ where: { id }, data: { ambiente: inspection.verified.ambiente } });
      await tx.systemLog.create({ data: { level: 'ALERTA', action: 'LEGACY_FISCAL_ENVIRONMENT_CONFIRMED', module: 'FISCAL',
        message: 'Ambiente histórico confirmado exclusivamente a partir da referência XML assinada.', userId: actorId,
        empresaId: current.empresaId, vendaId: current.vendaId,
        details: JSON.stringify({ notaId: id, previousEnvironment: null, environment: inspection.verified.ambiente,
          originalXmlSha256: inspection.verified.xmlHash, method: 'SIGNED_XML_ENVIRONMENT_ONLY', schema: inspection.verified.schema, justification }) } });
      return { id, status: 'CONFIRMADA' as const, ambiente: inspection.verified.ambiente };
    });
    results.push(result);
  }
  return results;
}
