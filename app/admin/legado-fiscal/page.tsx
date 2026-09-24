'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2 } from 'lucide-react';

type Item = { id: string; empresa: string; numero: string; status: string; dataEmissao: string | null;
  eligible: boolean; ambiente: 'PRODUCAO' | 'HOMOLOGACAO' | null; schema: 'ATUAL' | 'LEGADO_XNBS_CEP' | null; reason: string | null };
type Listing = { total: number; page: number; pageSize: number; pages: number; items: Item[] };
type Result = { id: string; status: 'CONFIRMADA' | 'REVISAO_MANUAL' | 'ALTERADA'; reason?: string };

export default function LegacyFiscalEnvironmentPage() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [justification, setJustification] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lastResults, setLastResults] = useState<Result[]>([]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/legado-fiscal?page=${page}`, { cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível conferir as notas legadas.');
      if (!signal?.aborted) { setListing(data); setSelected([]); setError(''); }
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Falha de conexão.');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [page]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, revision]);

  const eligibleIds = listing?.items.filter(item => item.eligible).map(item => item.id) || [];
  function toggle(id: string) { setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]); }

  async function confirm() {
    if (busy || !selected.length) return;
    setBusy(true); setError(''); setMessage(''); setLastResults([]);
    try {
      const response = await fetch('/api/admin/legado-fiscal', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, adminPassword: password, justification }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a conciliação.');
      setLastResults(data.results);
      setMessage(`${data.confirmed} ambiente(s) confirmado(s). ${data.results.length - data.confirmed} nota(s) permaneceram para revisão ou nova prévia.`);
      setRevision(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha de conexão.'); }
    finally { setPassword(''); setBusy(false); }
  }

  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <header className="space-y-2"><div className="flex items-center gap-3"><FileCheck2 className="text-blue-700" /><h1 className="text-2xl font-black text-slate-900">Conciliação fiscal legada</h1></div>
      <p className="max-w-4xl text-sm text-slate-600">Confirme o ambiente de notas históricas somente quando o XML preservado tiver assinatura íntegra e chave, prestador, número e valor compatíveis com o registro. Esta operação não transmite, cancela ou altera documentos fiscais.</p></header>
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mr-2 inline" size={18} /> A validação aqui confirma <strong>apenas o ambiente</strong> do XML preservado. A assinatura comprova a integridade dos dados assinados, mas não substitui uma nova consulta ao Portal Nacional nem certifica todos os metadados legados. Somente as divergências históricas conhecidas de xNBS/CEP podem passar sem o XSD atual.</div>
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-900">{error}</p>}
    {!!lastResults.length && lastResults.some(result => result.status !== 'CONFIRMADA') && <div className="rounded-xl border bg-white p-4 text-sm"><h2 className="font-bold">Itens não confirmados nesta operação</h2>
      {lastResults.filter(result => result.status !== 'CONFIRMADA').map(result => <p key={result.id} className="mt-2 font-mono text-xs">{result.id}: {result.reason || result.status}</p>)}</div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Notas sem ambiente registrado</h2><p className="text-sm text-slate-600">{listing?.total ?? '…'} registro(s) restantes · página {page} de {listing?.pages ?? 1}</p></div>
        <button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>Atualizar prévia</button></div>
      {loading ? <p role="status" className="mt-5 flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={18} /> Verificando assinaturas…</p> : <div className="mt-4 space-y-3">
        {listing?.items.map(item => <label key={item.id} className={`flex gap-3 rounded-xl border p-4 ${item.eligible ? 'border-emerald-200' : 'border-amber-200 bg-amber-50'}`}>
          <input type="checkbox" className="mt-1 h-4 w-4" disabled={!item.eligible || busy} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
          <span className="min-w-0 flex-1"><span className="block font-semibold">{item.empresa} · Nota {item.numero}</span>
            <span className="block text-xs text-slate-500">{item.id} · {item.status} · {item.dataEmissao ? new Date(item.dataEmissao).toLocaleDateString('pt-BR') : 'Data não informada'}</span>
            <span className={`mt-1 block text-sm ${item.eligible ? 'text-emerald-800' : 'text-amber-950'}`}>{item.eligible ? `Assinatura e dados conferidos · Ambiente: ${item.ambiente} · Esquema: ${item.schema === 'ATUAL' ? 'atual' : 'legado xNBS/CEP'}` : item.reason}</span></span>
          {item.eligible && <CheckCircle2 size={18} className="shrink-0 text-emerald-700" />}
        </label>)}
        {!listing?.items.length && <p className="py-8 text-center text-sm text-slate-600">Nenhuma nota pendente nesta página.</p>}
      </div>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={!eligibleIds.length || busy || loading} onClick={() => setSelected(selected.length === eligibleIds.length ? [] : eligibleIds)}>{selected.length === eligibleIds.length && eligibleIds.length ? 'Limpar seleção' : 'Selecionar confirmáveis desta página'}</button>
        <div className="flex gap-2"><button type="button" className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={page <= 1 || busy} onClick={() => setPage(value => value - 1)}>Anterior</button><button type="button" className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" disabled={page >= (listing?.pages ?? 1) || busy} onClick={() => setPage(value => value + 1)}>Próxima</button></div></div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Confirmar {selected.length} nota(s) selecionada(s)</h2>
      <p className="mt-1 text-sm text-slate-600">A senha administrativa e a justificativa são exigidas a cada lote. Cada alteração deixa o hash do XML e o responsável no log de auditoria.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2"><div><label htmlFor="legacy-reason" className="mb-1 block text-sm font-semibold">Justificativa</label><textarea id="legacy-reason" className="w-full rounded-lg border p-3 text-sm" minLength={10} maxLength={2000} value={justification} onChange={event => setJustification(event.target.value)} placeholder="Conciliação do ambiente a partir do XML assinado preservado" /></div>
        <div><label htmlFor="legacy-password" className="mb-1 block text-sm font-semibold">Sua senha atual</label><input id="legacy-password" type="password" autoComplete="current-password" className="w-full rounded-lg border p-3 text-sm" value={password} onChange={event => setPassword(event.target.value)} /></div></div>
      <button type="button" className="mt-4 rounded-lg bg-blue-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50" disabled={busy || !selected.length || justification.trim().length < 10 || !password} onClick={() => void confirm()}>{busy ? 'Conferindo e registrando…' : 'Confirmar ambientes selecionados'}</button>
    </section>
  </div>;
}
