'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OwnershipView } from '@/app/utils/company-ownership';

type ResponseData = { data: OwnershipView[]; terms: readonly string[]; meta: { page: number; total: number; totalPages: number } };
const emptyCreate = { empresaId: '', proposedOwnerId: '', caseTicketId: '', evidenceMessageId: '', confirmedCnpj: '', password: '', justification: '', evidenceVerified: false };

export default function OwnershipConsole({ administrative = false }: { administrative?: boolean }) {
  const [payload, setPayload] = useState<ResponseData | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState(emptyCreate);
  const endpoint = administrative ? '/api/admin/titularidade' : '/api/titularidade';
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${endpoint}?status=PENDING&page=${page}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível carregar as solicitações.');
      setPayload(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha ao carregar.'); }
    finally { setLoading(false); }
  }, [endpoint, page]);
  useEffect(() => { void load(); }, [load]);

  const send = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setError(''); setSuccess('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível concluir.');
      setSuccess(body.action === 'ACCEPT' ? 'Seu consentimento foi registrado.' : body.action === 'FINALIZE' ? 'Transferência concluída.' : 'Solicitação atualizada.');
      await load(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha na operação.'); return false; }
    finally { setBusy(''); }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await send({ requestId: crypto.randomUUID(), ...form }, 'create');
    setForm(previous => ({ ...(ok ? emptyCreate : previous), password: '' }));
  };
  const decide = async (request: OwnershipView, action: 'ACCEPT' | 'REJECT' | 'CANCEL' | 'FINALIZE') => {
    const password = prompt('Digite a senha atual desta conta para confirmar:') || '';
    if (!password) return;
    const justification = action === 'ACCEPT' ? undefined : prompt('Informe a justificativa (mínimo 10 caracteres):') || '';
    const reviewEvidenceMessageId = action === 'FINALIZE' ? prompt('ID da nota interna escrita por este revisor:') || '' : undefined;
    await send({ action, requestId: request.id, termsHash: request.termsHash, confirmedCnpj: request.documento, password,
      acknowledged: action === 'ACCEPT' || action === 'FINALIZE', evidenceVerified: action === 'FINALIZE',
      justification, reviewEvidenceMessageId }, `${request.id}:${action}`);
  };

  return <div className="space-y-6">
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
      <h2 className="font-black">O que este processo significa</h2>
      <p className="mt-1">Ele transfere a responsabilidade e o acesso ao cadastro dentro do NFSe Goo. Não altera a titularidade jurídica do CNPJ.</p>
    </section>
    {administrative && <form onSubmit={create} className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
      <div><h2 className="text-lg font-black">Abrir verificação</h2><p className="text-sm text-slate-600">Antes, valide documentos e representação humana no chamado. O chamado deve ter sido aberto pela conta destinatária.</p></div>
      <div className="grid gap-3 md:grid-cols-2">
        {([
          ['empresaId', 'ID interno da empresa'], ['proposedOwnerId', 'ID da conta destinatária'],
          ['caseTicketId', 'ID do chamado'], ['evidenceMessageId', 'ID da nota interna da análise'],
          ['confirmedCnpj', 'CNPJ confirmado'], ['password', 'Sua senha administrativa'],
        ] as const).map(([name, label]) => <label key={name} className="text-sm font-bold">{label}
          <input type={name === 'password' ? 'password' : 'text'} autoComplete={name === 'password' ? 'current-password' : 'off'}
            value={String(form[name])} onChange={event => setForm({ ...form, [name]: event.target.value })}
            required className="mt-1 w-full rounded-xl border border-slate-300 p-3 font-normal" />
        </label>)}
      </div>
      <label className="block text-sm font-bold">Justificativa da abertura
        <textarea value={form.justification} onChange={event => setForm({ ...form, justification: event.target.value })}
          minLength={10} maxLength={2000} required className="mt-1 min-h-24 w-full rounded-xl border border-slate-300 p-3 font-normal" />
      </label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.evidenceVerified}
        onChange={event => setForm({ ...form, evidenceVerified: event.target.checked })} required className="mt-1" />
        Conferi a autorização de representação e registrei apenas a conclusão necessária na nota interna, sem expor documentos nesta tela.</label>
      <button disabled={busy !== ''} className="rounded-xl bg-slate-900 px-5 py-3 font-bold text-white disabled:opacity-50">Criar solicitação sem conceder acesso</button>
    </form>}
    {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</div>}
    {success && <div role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 text-green-800">{success}</div>}
    <section aria-busy={loading} className="space-y-4">
      <h2 className="text-xl font-black">Solicitações pendentes</h2>
      {loading ? <p role="status">Carregando…</p> : !payload?.data.length ? <p className="rounded-xl border bg-white p-5 text-slate-600">Nenhuma transferência depende desta conta.</p> :
        payload.data.map(request => <article key={request.id} className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
          <div><h3 className="font-black">{request.razaoSocial}</h3><p className="text-sm text-slate-600">CNPJ {request.documento} · destino: {request.recipient.nome} ({request.recipient.email})</p>
            <p className="mt-1 text-xs">Expira em {new Date(request.expiresAt).toLocaleString('pt-BR')} · {request.mode === 'RECOVERY' ? 'recuperação com dupla revisão MASTER' : 'transferência'}</p></div>
          <ol className="list-decimal space-y-2 pl-5 text-sm">{payload.terms.map(term => <li key={term}>{term}</li>)}</ol>
          <div className="flex flex-wrap gap-2 text-xs">{request.requiredConsents.map(item => <span key={item.key}
            className={`rounded-full px-3 py-1 ${item.accepted ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>{item.label}: {item.accepted ? 'aceito' : 'pendente'}</span>)}</div>
          <div className="flex flex-wrap gap-2">
            {request.canConsent && <button disabled={busy !== ''} onClick={() => decide(request, 'ACCEPT')} className="rounded-xl bg-green-700 px-4 py-2 font-bold text-white">Li tudo e consentir</button>}
            {request.canReject && <button disabled={busy !== ''} onClick={() => decide(request, 'REJECT')} className="rounded-xl border border-red-300 px-4 py-2 font-bold text-red-700">Rejeitar</button>}
            {administrative && request.canFinalize && <button disabled={busy !== ''} onClick={() => decide(request, 'FINALIZE')} className="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white">Revisar e concluir</button>}
            {administrative && request.canCancel && <button disabled={busy !== ''} onClick={() => decide(request, 'CANCEL')} className="rounded-xl border px-4 py-2 font-bold">Cancelar</button>}
          </div>
        </article>)}
      {!!payload && <div className="flex items-center gap-3 text-sm"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button>
        <span>Página {page} de {payload.meta.totalPages} ({payload.meta.total})</span><button disabled={page >= payload.meta.totalPages} onClick={() => setPage(value => value + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Próxima</button></div>}
    </section>
  </div>;
}
