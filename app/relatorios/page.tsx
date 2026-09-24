'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Filter, Loader2, Printer, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import type { FiscalReportData } from '@/app/services/fiscalReportService';
import { currentFiscalMonth, FISCAL_REPORT_ENVIRONMENTS, fiscalDateInBrazil, formatReportMoney, parseFiscalReportQuery, type FiscalReportEnvironment } from '@/app/utils/fiscal-report';

type Filters = { startDate: string; endDate: string; search: string; incluirCanceladas: boolean; ambiente: FiscalReportEnvironment };
const queryFor = (filters: Filters, page: number, complete = false) => new URLSearchParams({
  ...filters, incluirCanceladas: String(filters.incluirCanceladas), page: String(page), limit: '20', output: complete ? 'report' : 'page',
});
const displayDate = (value: string) => value.split('-').reverse().join('/');
const inputClass = 'mt-2 block h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100';
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RelatoriosPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<Filters | null>(null);
  const [applied, setApplied] = useState<Filters | null>(null);
  const [report, setReport] = useState<FiscalReportData | null>(null);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const initial: Filters = { ...currentFiscalMonth(), search: '', incluirCanceladas: false, ambiente: 'PRODUCAO' };
    setDraft(initial); setApplied(initial);
  }, []);

  useEffect(() => {
    if (!applied) return;
    const abort = new AbortController();
    setLoading(true); setError(''); setReport(null); setSelected([]); setActionMessage('');
    void fetch('/api/relatorios?' + queryFor(applied, page), { cache: 'no-store', signal: abort.signal,
      headers: { 'x-empresa-id': localStorage.getItem('empresaContextId') || '' },
    }).then(async response => {
      const data = await response.json();
      if (response.status === 401) router.push('/login');
      if (!response.ok) throw new Error(data.error || 'Relatório indisponível. Tente novamente.');
      if (!abort.signal.aborted) setReport(data);
    }).catch(reason => { if (!abort.signal.aborted) setError(reason.message || 'Falha de conexão.'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [applied, page, refresh, router]);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    try {
      parseFiscalReportQuery(queryFor(draft, 1));
      setApplied({ ...draft, search: draft.search.trim() }); setPage(1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Verifique os filtros.'); }
  };

  const generatePdf = async () => {
    if (!report || !applied || busy) return;
    setBusy(true); setActionMessage('');
    try {
      const response = await fetch('/api/relatorios?' + queryFor(report.filters, 1, true), {
        cache: 'no-store', headers: { 'x-empresa-id': report.prestador.id },
      });
      const complete: FiscalReportData & { error?: string } = await response.json();
      if (!response.ok) throw new Error(complete.error || 'Não foi possível obter o relatório completo.');
      const { createFiscalReportPdf } = await import('@/app/utils/fiscal-report-pdf');
      const pdf = createFiscalReportPdf(complete);
      download(pdf.output('blob'), `relatorio-${complete.ambiente}-${complete.filters.startDate}-${complete.filters.endDate}.pdf`);
      setActionMessage(`PDF completo gerado com ${complete.meta.total} linha(s), com a situação consultada agora.`);
    } catch (reason) { setActionMessage(reason instanceof Error ? reason.message : 'Falha ao gerar PDF.'); }
    finally { setBusy(false); }
  };

  const exportFiles = async (formato: 'XML' | 'PDF' | 'AMBOS') => {
    if (!report || !selected.length || busy) return;
    setBusy(true); setActionMessage('');
    try {
      const response = await fetch('/api/relatorios/export', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-empresa-id': report.prestador.id },
        body: JSON.stringify({ ids: selected, formato, ambiente: report.ambiente }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Exportação indisponível.');
      }
      if (!response.headers.get('content-type')?.includes('application/zip')) throw new Error('Resposta inesperada. Nenhum arquivo foi salvo.');
      download(await response.blob(), `NFSe-${report.ambiente}-documentos.zip`);
      setActionMessage('Download do ZIP iniciado. Confira também o arquivo LEIA-ME e o ambiente da pasta.');
    } catch (reason) { setActionMessage(reason instanceof Error ? reason.message : 'Falha de conexão. Nenhum ZIP parcial foi salvo.'); }
    finally { setBusy(false); }
  };

  const disabled = loading || busy || !!error;
  return (
    <div className="saas-shell">
      <header className="saas-page-header border-x-0 border-t-0">
        <div className="saas-content flex items-center justify-between gap-4 px-[var(--saas-gutter)] py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} aria-label="Voltar" className={buttonClass}><ChevronLeft size={18} /></button>
            <h1 className="text-xl font-bold text-slate-900">Relatórios fiscais</h1>
          </div>
          <Sidebar />
        </div>
      </header>
      <main className="saas-container space-y-6 py-7 pb-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Consulta fiscal</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Histórico de notas</h2>
            <p className="mt-1 text-sm text-slate-600">Consulte os registros da empresa selecionada por período, ambiente ou tomador.</p>
          </div>
          <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800">Acesso independente do plano e do saldo</span>
        </div>
        {draft && <form onSubmit={apply} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-2 border-b border-slate-100 pb-4">
            <span className="rounded-lg bg-blue-50 p-2 text-blue-700"><Filter size={18} /></span>
            <div><h3 className="font-bold text-slate-900">Filtros de consulta</h3><p className="text-xs text-slate-500">Defina os critérios e aplique para atualizar os resultados.</p></div>
          </div>
          <fieldset disabled={busy} className="grid gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-semibold text-slate-700">Ambiente
              <select value={draft.ambiente} onChange={e => setDraft({ ...draft, ambiente: e.target.value as FiscalReportEnvironment })} className={inputClass}>
                {Object.entries(FISCAL_REPORT_ENVIRONMENTS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">Início
              <input required type="date" min="2000-01-01" max="2100-12-31" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} className={inputClass} />
            </label>
            <label className="text-sm font-semibold text-slate-700">Fim
              <input required type="date" min="2000-01-01" max="2100-12-31" value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} className={inputClass} />
            </label>
            <label className="text-sm font-semibold text-slate-700 sm:col-span-2 xl:col-span-2">Tomador, documento, número ou serviço
              <div className="relative"><Search size={17} className="pointer-events-none absolute left-3.5 top-5 text-slate-400" /><input type="search" maxLength={200} placeholder="Busque por nome, CPF/CNPJ, número ou serviço" value={draft.search} onChange={e => setDraft({ ...draft, search: e.target.value })} className={inputClass + ' pl-10'} /></div>
            </label>
            <div className="flex items-center xl:justify-center">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4 accent-blue-700" checked={draft.incluirCanceladas} onChange={e => setDraft({ ...draft, incluirCanceladas: e.target.checked })} /> Incluir canceladas</label>
            </div>
            <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-xl bg-blue-700 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-50"><Search size={17} /> Aplicar filtros</button>
          </fieldset>
          <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">Período máximo de 366 dias no fuso de São Paulo. O PDF completo comporta até 1.000 notas.</p>
        </form>}

        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
          <p>{error}</p>
          <button onClick={() => setRefresh(n => n + 1)} className={buttonClass + ' mt-3'}>Tentar novamente</button>
        </div>}
        {loading && <p role="status" className="flex items-center gap-2 py-8"><Loader2 className="animate-spin" size={20} /> Carregando relatório...</p>}

        {!loading && report && !error && <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-label="Resumo dos filtros aplicados">
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-500">Empresa selecionada</p>
            <h2 className="font-bold text-slate-900">{report.prestador.razaoSocial || report.prestador.nomeFantasia}</h2>
            <p className="mt-1 break-words text-sm text-slate-600">{report.prestador.documento} · {report.prestador.cidade}/{report.prestador.uf}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-blue-50 px-3 py-1.5 text-blue-800">{FISCAL_REPORT_ENVIRONMENTS[report.ambiente].label}</span><span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">{displayDate(report.filters.startDate)} a {displayDate(report.filters.endDate)}</span>{report.filters.search && <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">Busca: {report.filters.search}</span>}</div>
            <dl className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{report.ambiente === 'PRODUCAO' ? 'Valor autorizado' : 'Valor dos registros (não é receita)'}</dt><dd className="mt-2 break-words text-2xl font-bold tracking-tight text-slate-900">{formatReportMoney(report.summary.totalValor)}</dd></div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Autorizadas no período/busca</dt><dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{report.summary.qtdAutorizadas}</dd></div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Canceladas (fora do total)</dt><dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{report.summary.qtdCanceladas}</dd></div>
            </dl>
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-950">{report.aviso}</p>
            {!!report.summary.notasSemAmbienteNoPeriodo && report.ambiente !== 'LEGADO' && <p className="mt-3 text-sm text-amber-900">{report.summary.notasSemAmbienteNoPeriodo} nota(s) sem ambiente confirmado foram excluídas deste ambiente. Selecione “Legado sem ambiente confirmado” para conferir.</p>}
            {!!report.summary.datasEstimadas && <p className="mt-2 text-sm text-amber-900">{report.summary.datasEstimadas} linha(s) usam data de cadastro por ausência da data oficial.</p>}
            {!!report.summary.metadadosLegados && <p className="mt-2 text-sm text-amber-900">{report.summary.metadadosLegados} linha(s) desta página não puderam ter os metadados confirmados pelo XML. Confira antes do fechamento.</p>}
          </section>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div className="flex items-start gap-3"><span className="rounded-lg bg-blue-50 p-2 text-blue-700"><FileText size={19} /></span><div><h2 className="font-bold text-slate-900">Notas encontradas <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{report.meta.total}</span></h2><p className="mt-1 text-xs text-slate-500">Selecione notas para baixar os documentos em ZIP.</p></div></div>
              <button onClick={generatePdf} disabled={disabled} className={buttonClass}><Printer size={16} /> PDF completo do relatório</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3 sm:px-6">
              <span className="mr-2 text-sm font-medium text-slate-700">{selected.length} selecionada(s) nesta página</span>
              {(['XML', 'PDF', 'AMBOS'] as const).map(format => <button key={format} onClick={() => exportFiles(format)} disabled={disabled || !selected.length} className={buttonClass}><Download size={15} /> ZIP {format === 'AMBOS' ? 'XML + PDF' : format}</button>)}
              {busy && <Loader2 aria-label="Preparando download" className="animate-spin text-blue-700" size={20} />}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <caption className="sr-only">Notas dos filtros aplicados. Os totais abrangem todas as páginas.</caption>
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600"><tr>
                  <th className="p-3"><input type="checkbox" aria-label="Selecionar todas as notas desta página" disabled={disabled || !report.data.length} checked={!!report.data.length && selected.length === report.data.length} onChange={e => setSelected(e.target.checked ? report.data.map(n => n.id) : [])} /></th>
                  {['Data', 'NFS-e', 'Tomador', 'Serviço', 'Valor', 'Situação'].map(label => <th key={label} className="p-3">{label}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {!report.data.length && <tr><td colSpan={7} className="p-8 text-center text-slate-600">Nenhuma nota encontrada para estes filtros.</td></tr>}
                  {report.data.map(note => <tr key={note.id} className={selected.includes(note.id) ? 'bg-blue-50' : 'hover:bg-slate-50/80'}>
                    <td className="p-3"><input type="checkbox" aria-label={'Selecionar NFS-e ' + (note.numeroExibicao || note.id)} disabled={disabled} checked={selected.includes(note.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, note.id] : prev.filter(id => id !== note.id))} /></td>
                    <td className="p-3 whitespace-nowrap">{displayDate(fiscalDateInBrazil(new Date(note.dataEmissao || note.createdAt)))}{!note.dataEmissao && <span className="block text-xs text-amber-800">Data de cadastro</span>}</td>
                    <td className="p-3 font-mono">{note.numeroExibicao || '-'}</td>
                    <td className="max-w-xs break-words p-3"><p className="font-semibold">{note.tomadorNomeExibicao}</p><p className="text-xs text-slate-600">{note.tomadorCnpj}</p>{note.tomadorNomeOrigem !== 'XML_ASSINADO' && <p className="text-xs text-amber-800">Nome do cadastro atual</p>}</td>
                    <td className="p-3 font-mono" title={note.descricao}>{note.codigoTribNacional || 'Não registrado'}</td>
                    <td className="p-3 whitespace-nowrap font-semibold">{formatReportMoney(note.valor)}</td>
                    <td className="p-3 text-xs font-semibold"><span className={note.status === 'CANCELADA' ? 'rounded-full bg-rose-50 px-2.5 py-1 text-rose-700' : 'rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700'}>{note.status}</span><span className="mt-2 block text-slate-500">{FISCAL_REPORT_ENVIRONMENTS[report.ambiente].label}</span></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
              <p className="text-sm">{report.data.length} de {report.meta.total} nota(s) · Página {report.meta.page} de {report.meta.totalPages}</p>
              <div className="flex gap-2">
                <button aria-label="Página anterior" onClick={() => setPage(p => p - 1)} disabled={disabled || page <= 1} className={buttonClass}><ChevronLeft size={18} /></button>
                <button aria-label="Próxima página" onClick={() => setPage(p => p + 1)} disabled={disabled || page >= report.meta.totalPages} className={buttonClass}><ChevronRight size={18} /></button>
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-600">O ZIP contém somente as notas selecionadas. PDFs precisam estar prontos no histórico; abra a nota para solicitar a preparação. Se faltar um documento, o lote inteiro é recusado.</p>
          <Link href="/cliente/dashboard" className="inline-block text-sm font-semibold text-blue-700 underline">Voltar ao histórico para consultar ou preparar documentos</Link>
        </>}
        {actionMessage && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">{actionMessage}</p>}
      </main>
    </div>
  );
}
