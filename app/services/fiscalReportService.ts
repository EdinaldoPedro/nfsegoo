import { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { hasCustomerCompanyAccess, resolveEmpresaContexto } from '@/app/utils/access-control';
import { fiscalReportError, FISCAL_REPORT_ENVIRONMENTS, MAX_FISCAL_REPORT_ROWS, parseFiscalReportQuery, type FiscalReportEnvironment } from '@/app/utils/fiscal-report';
import { validateNfseDocument } from '@/app/services/emissor/validation/AuthorizedNfseValidator';

export function noteEnvironmentWhere(ambiente: FiscalReportEnvironment): Prisma.NotaFiscalWhereInput {
  return ambiente === 'LEGADO' ? { OR: [{ ambiente: null }, { ambiente: { notIn: ['PRODUCAO', 'HOMOLOGACAO'] } }] } : { ambiente };
}

export function noteDateWhere(startsAt: Date, endsAt: Date): Prisma.NotaFiscalWhereInput {
  const range = { gte: startsAt, lt: endsAt };
  return { OR: [{ dataEmissao: range }, { dataEmissao: null, createdAt: range }] };
}

export async function resolveReportCompany(tx: Prisma.TransactionClient, userId: string, contextId: string | null) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, empresaId: true } });
  if (!user) return fiscalReportError('Perfil sem acesso a este relatório.', 403);
  const companyId = await resolveEmpresaContexto(user, contextId, tx);
  if (!companyId || !await hasCustomerCompanyAccess(user, companyId, tx)) return fiscalReportError('Selecione uma empresa à qual você tenha acesso.', 403);
  return companyId;
}

export const fiscalReportNoteSelect = {
  id: true, numero: true, numeroOficial: true, ambiente: true, status: true, valor: true,
  descricao: true, codigoServico: true, tomadorCnpj: true, tomadorNome: true, metadadosVerificadosEm: true,
  dataEmissao: true, createdAt: true, dataCancelamento: true,
  cliente: { select: { nome: true, nomeFantasia: true } },
  documentTask: { select: { status: true } },
} satisfies Prisma.NotaFiscalSelect;

export async function getFiscalReport(userId: string, contextId: string | null, query: URLSearchParams, now = new Date()) {
  const filters = parseFiscalReportQuery(query, now);
  // No subscription check: access to one's fiscal history is not confiscated
  // when a paid plan expires or emission credits run out.
  const report = await prisma.$transaction(async (tx) => {
    const empresaId = await resolveReportCompany(tx, userId, contextId);
    const searchWhere: Prisma.NotaFiscalWhereInput = filters.search ? { OR: [
      { tomadorCnpj: { contains: filters.search } }, { tomadorNome: { contains: filters.search, mode: 'insensitive' } },
      { cliente: { nome: { contains: filters.search, mode: 'insensitive' } } }, { codigoServico: { contains: filters.search } },
      ...(/^[0-9]{1,13}$/.test(filters.search) ? [{ numeroOficial: String(Number(filters.search)) },
        ...(Number(filters.search) <= 2_147_483_647 ? [{ numero: Number(filters.search) }] : [])] : []),
    ] } : {};
    const common: Prisma.NotaFiscalWhereInput = { empresaId, arquivadoEm: null, AND: [noteDateWhere(filters.startsAt, filters.endsAt), searchWhere] };
    const scope: Prisma.NotaFiscalWhereInput = { AND: [common, noteEnvironmentWhere(filters.ambiente)] };
    const where: Prisma.NotaFiscalWhereInput = { ...scope, status: filters.incluirCanceladas ? { in: ['AUTORIZADA', 'CANCELADA'] } : 'AUTORIZADA' };
    const [rows, total, authorized, cancelled, unknown, estimatedDates, unverifiedMetadata, company] = await Promise.all([
      tx.notaFiscal.findMany({ where, select: fiscalReportNoteSelect, orderBy: [{ dataEmissao: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * filters.limit, take: filters.limit }),
      tx.notaFiscal.count({ where }),
      tx.notaFiscal.aggregate({ where: { ...scope, status: 'AUTORIZADA' }, _sum: { valor: true }, _count: { id: true } }),
      tx.notaFiscal.count({ where: { ...scope, status: 'CANCELADA' } }),
      tx.notaFiscal.count({ where: { AND: [common, noteEnvironmentWhere('LEGADO')], status: { in: ['AUTORIZADA', 'CANCELADA'] } } }),
      tx.notaFiscal.count({ where: { ...where, dataEmissao: null } }),
      tx.notaFiscal.count({ where: { ...where, metadadosVerificadosEm: null } }),
      tx.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { id: true, razaoSocial: true, nomeFantasia: true, documento: true,
        inscricaoMunicipal: true, cidade: true, uf: true, codigoIbge: true } }),
    ]);
    if (filters.output === 'report' && total > MAX_FISCAL_REPORT_ROWS) return fiscalReportError(`O relatório possui ${total} notas. Selecione um período/busca com até ${MAX_FISCAL_REPORT_ROWS} notas para gerar o PDF completo.`, 422);
    return {
      data: rows.map((note) => ({ ...note, valor: note.valor.toFixed(2), dataEmissao: note.dataEmissao?.toISOString() ?? null,
        createdAt: note.createdAt.toISOString(), dataCancelamento: note.dataCancelamento?.toISOString() ?? null,
        metadadosVerificadosEm: note.metadadosVerificadosEm?.toISOString() ?? null,
        numeroExibicao: note.numeroOficial || (note.numero ? String(note.numero) : null),
        tomadorNomeExibicao: note.tomadorNome || note.cliente?.nome || 'Não informado',
        tomadorNomeOrigem: note.tomadorNome ? 'XML_ASSINADO' : 'CADASTRO_ATUAL',
        codigoTribNacional: note.codigoServico, nomeServico: note.descricao,
      })),
      meta: { page: filters.page, limit: filters.limit, total, totalPages: Math.max(1, Math.ceil(total / filters.limit)), complete: filters.output === 'report' },
      summary: { totalValor: authorized._sum.valor?.toFixed(2) ?? '0.00', qtdAutorizadas: authorized._count.id, qtdCanceladas: cancelled,
        periodo: { start: filters.startDate, end: filters.endDate }, notasSemAmbienteNoPeriodo: unknown,
        datasEstimadas: estimatedDates, metadadosLegados: unverifiedMetadata },
      filters: { ambiente: filters.ambiente, startDate: filters.startDate, endDate: filters.endDate, search: filters.search, incluirCanceladas: filters.incluirCanceladas },
      ambiente: filters.ambiente, aviso: FISCAL_REPORT_ENVIRONMENTS[filters.ambiente].notice, geradoEm: now.toISOString(), prestador: company,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 });

  // A restored database can have signed official XML without the derived
  // columns introduced later. Verify only the visible page after the short
  // report transaction, then render from the XML without mutating fiscal data.
  const legacyIds = report.data.filter(note => !note.metadadosVerificadosEm || !note.codigoTribNacional || !note.tomadorNome).map(note => note.id);
  if (!legacyIds.length) return { ...report, summary: { ...report.summary, metadadosLegados: 0 } };
  const verified = new Map<string, Awaited<ReturnType<typeof validateNfseDocument>>>();
  for (let offset = 0; offset < legacyIds.length; offset += 20) {
    const sources = await prisma.notaFiscal.findMany({ where: { id: { in: legacyIds.slice(offset, offset + 20) }, empresaId: report.prestador.id },
      select: { id: true, ambiente: true, chaveAcesso: true, prestadorCnpj: true, xmlAutorizadoBase64: true, xmlBase64: true } });
    await Promise.all(sources.map(async source => {
      const xml = source.xmlAutorizadoBase64 || source.xmlBase64;
      if (!xml || !source.ambiente || !source.chaveAcesso) return;
      try { verified.set(source.id, await validateNfseDocument(xml, source.ambiente, source.chaveAcesso, source.prestadorCnpj)); }
      catch { /* Never present unverified XML as official metadata. */ }
    }));
  }
  const data = report.data.map(note => {
    const xml = verified.get(note.id);
    if (!xml) return note;
    return { ...note, tomadorCnpj: xml.tomadorDocumento || note.tomadorCnpj,
      tomadorNomeExibicao: xml.tomadorNome || note.tomadorNomeExibicao,
      tomadorNomeOrigem: xml.tomadorNome ? 'XML_ASSINADO' : note.tomadorNomeOrigem,
      codigoTribNacional: xml.codigoServico || note.codigoTribNacional,
      nomeServico: xml.descricao || note.nomeServico };
  });
  return { ...report, data, summary: { ...report.summary,
    metadadosLegados: data.filter(note => !note.codigoTribNacional || note.tomadorNomeOrigem !== 'XML_ASSINADO').length } };
}

export type FiscalReportData = Awaited<ReturnType<typeof getFiscalReport>>;
