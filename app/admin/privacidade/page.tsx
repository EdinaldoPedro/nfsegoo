'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';

type Item = {
  id: string; type: string; status: string; description: string | null; dueAt: string; createdAt: string;
  resolutionSummary: string | null; legalBasis: string | null; version: number;
  subject: { id: string; nome: string; email: string; privacyErasedAt: string | null };
  resolvedBy: { id: string; nome: string } | null;
};

type PageData = { data: Item[]; meta: { page: number; total: number; totalPages: number } };
const labels: Record<string, string> = { PENDENTE: 'Recebida', EM_ANALISE: 'Em análise', AGUARDANDO_TITULAR: 'Aguardando titular', CONCLUIDA: 'Concluída', RECUSADA: 'Não atendida' };

async function message(response: Response, fallback: string) {
  try { const data = await response.json(); return data.error || fallback; } catch { return fallback; }
}

export default function AdminPrivacyPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [filter, setFilter] = useState('ABERTAS');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Item | null>(null);
  const [action, setAction] = useState('INICIAR');
  const [summary, setSummary] = useState('');
  const [legalBasis, setLegalBasis] = useState('');
  const [password, setPassword] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async (targetPage = page, targetFilter = filter) => {
    const response = await fetch(`/api/admin/privacidade/solicitacoes?status=${encodeURIComponent(targetFilter)}&page=${targetPage}&limit=25`, { cache: 'no-store' });
    if (!response.ok) throw new Error(await message(response, 'Não foi possível carregar as solicitações.'));
    setData(await response.json());
  }, [filter, page]);

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : 'Falha de conexão.')); }, [load]);

  const choose = (item: Item) => {
    setSelected(item); setAction(item.status === 'PENDENTE' ? 'INICIAR' : 'CONCLUIR');
    setSummary(item.resolutionSummary || ''); setLegalBasis(item.legalBasis || ''); setPassword(''); setJustification(''); setError(''); setSuccess('');
  };

  const resolve = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      const response = await fetch('/api/admin/privacidade/solicitacoes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        id: selected.id, version: selected.version, action, resolutionSummary: summary || undefined,
        legalBasis: legalBasis || undefined, password, justification,
      }) });
      if (!response.ok) throw new Error(await message(response, 'Não foi possível atualizar a solicitação.'));
      setSelected(null); setPassword(''); setJustification(''); setSummary(''); setLegalBasis('');
      setSuccess('Solicitação atualizada e registrada na auditoria.'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha de conexão.'); }
    finally { setBusy(false); }
  };

  const inputClass = 'mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
  return <div className="space-y-6 text-slate-900">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-black text-blue-700">Governança de dados</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-black sm:text-3xl"><ShieldCheck /> Direitos dos titulares</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Bancada restrita a MASTER e ADMIN. Toda decisão exige reautenticação, justificativa operacional e fica auditada.</p></div>
      <button type="button" onClick={() => void load().catch(cause => setError(cause.message))} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-blue-700"><RefreshCw size={16} /> Atualizar</button></header>

    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p>}
    {success && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">{success}</p>}

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-end justify-between gap-4">
      <label htmlFor="privacy-filter" className="text-sm font-bold">Fila<select id="privacy-filter" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }} className="ml-3 rounded-lg border border-slate-300 p-2"><option value="ABERTAS">Abertas</option><option value="ATRASADAS">Atrasadas</option><option value="CONCLUIDAS">Encerradas</option><option value="TODAS">Todas</option></select></label>
      <p className="text-sm text-slate-500">{data ? `${data.meta.total} solicitação(ões)` : 'Carregando…'}</p></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Prazo</th><th className="p-3">Titular</th><th className="p-3">Direito</th><th className="p-3">Estado</th><th className="p-3">Protocolo</th><th className="p-3">Ação</th></tr></thead><tbody>
        {data?.data.map(item => { const overdue = new Date(item.dueAt).getTime() < Date.now() && !['CONCLUIDA', 'RECUSADA'].includes(item.status); return <tr key={item.id} className="border-b border-slate-100 align-top"><td className={`p-3 ${overdue ? 'font-black text-red-700' : ''}`}>{overdue && <AlertTriangle size={15} className="mr-1 inline" />}{new Date(item.dueAt).toLocaleDateString('pt-BR')}</td><td className="p-3"><p className="font-bold">{item.subject.nome}</p><p className="break-all text-xs text-slate-500">{item.subject.email}</p></td><td className="p-3 font-semibold">{item.type}</td><td className="p-3">{labels[item.status] || item.status}</td><td className="max-w-48 break-all p-3 font-mono text-xs">{item.id}</td><td className="p-3"><button type="button" disabled={['CONCLUIDA', 'RECUSADA'].includes(item.status)} onClick={() => choose(item)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">Tratar</button></td></tr>; })}
      </tbody></table>{data?.data.length === 0 && <p className="py-8 text-center text-sm text-slate-500">Nenhuma solicitação neste filtro.</p>}</div>
      {data && data.meta.totalPages > 1 && <div className="mt-4 flex items-center justify-end gap-3"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-40">Anterior</button><span className="text-sm">Página {page} de {data.meta.totalPages}</span><button disabled={page >= data.meta.totalPages} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-3 py-2 text-sm font-bold disabled:opacity-40">Próxima</button></div>}
    </section>

    {selected && <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-lg sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black">Tratar {selected.type}</h2><p className="mt-1 break-all font-mono text-xs text-slate-500">{selected.id}</p></div><button onClick={() => setSelected(null)} className="text-sm font-bold text-slate-600">Fechar</button></div>
      {selected.description && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm"><span className="font-black">Pedido do titular:</span><p className="mt-2 whitespace-pre-wrap">{selected.description}</p></div>}
      <div className="mt-5 grid gap-4 md:grid-cols-2"><label htmlFor="privacy-action" className="text-sm font-bold">Decisão<select id="privacy-action" value={action} onChange={event => setAction(event.target.value)} className={inputClass}><option value="INICIAR">Iniciar análise</option><option value="SOLICITAR_INFO">Solicitar informação adicional</option><option value="CONCLUIR">Concluir atendimento</option><option value="RECUSAR">Não atender, com fundamento</option>{selected.type === 'ELIMINACAO' && <option value="ANONIMIZAR">Anonimizar a conta</option>}</select></label>
        <label htmlFor="privacy-admin-password" className="text-sm font-bold">Sua senha atual<input id="privacy-admin-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className={inputClass} /></label></div>
      {action !== 'INICIAR' && <label htmlFor="privacy-answer" className="mt-4 block text-sm font-bold">Resposta ao titular<textarea id="privacy-answer" rows={4} maxLength={4000} value={summary} onChange={event => setSummary(event.target.value)} className={inputClass} /></label>}
      {(action === 'RECUSAR' || legalBasis) && <label htmlFor="privacy-legal" className="mt-4 block text-sm font-bold">Fundamentação legal<textarea id="privacy-legal" rows={3} maxLength={3000} value={legalBasis} onChange={event => setLegalBasis(event.target.value)} className={inputClass} /></label>}
      <label htmlFor="privacy-justification" className="mt-4 block text-sm font-bold">Justificativa interna da ação<input id="privacy-justification" maxLength={500} value={justification} onChange={event => setJustification(event.target.value)} className={inputClass} placeholder="Motivo operacional auditável; não inclua senha ou segredo." /></label>
      {action === 'ANONIMIZAR' && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900"><AlertTriangle className="mr-2 inline" size={18} />A anonimização encerra sessões e substitui identificadores da conta. O sistema recusa a operação se houver empresa, contrato, cobrança, emissão, transferência ou suporte que exija retenção/tratamento prévio.</p>}
      <button type="button" disabled={busy || !password || justification.trim().length < 10 || (action !== 'INICIAR' && summary.trim().length < 15) || (action === 'RECUSAR' && legalBasis.trim().length < 15)} onClick={() => void resolve()} className="mt-5 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white disabled:opacity-40">Confirmar decisão</button>
    </section>}
  </div>;
}
