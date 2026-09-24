'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { fiscalOperationLabel } from '@/app/utils/fiscal-operation-state';

type Item = { id: string; notaId: string; vendaId: string | null; numero: string; empresa: string;
  status: string; statusMessage: string | null; attempts: number; maxAttempts: number;
  createdAt: string; updatedAt: string; nextAttemptAt: string | null; leaseUntil: string | null };
type Health = { workerOnline: boolean; lastHeartbeatAt: string | null; counts: Record<string, number>;
  active: number; waitingTooLong: number; retryOverdue: number; processingExpired: number;
  manual: number; needsAttention: boolean; oldest: Item[] };

function date(value: string | null) { return value ? new Date(value).toLocaleString('pt-BR') : '—'; }
export default function FiscalConsultationsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/admin/emissoes/retomar', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.consultations) throw new Error(data.error || 'Não foi possível consultar a fila fiscal.');
        if (active) { setHealth(data.consultations); setError(''); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Falha de conexão.'); }
      finally { if (active) setLoading(false); }
    }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [revision]);

  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-black text-slate-900">Consultas fiscais</h1>
      <p className="mt-2 text-sm text-slate-600">Fila de conferência de notas no Portal Nacional. Uma pendência não altera a situação fiscal da nota nem autoriza reemissão.</p></div>
      <button type="button" onClick={() => setRevision(value => value + 1)} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"><RefreshCw size={16} /> Atualizar</button></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {loading && !health && <p role="status" className="text-sm">Conferindo fila e processador…</p>}
    {health && <>
      <div role={health.needsAttention ? 'alert' : 'status'} className={`rounded-xl border p-4 text-sm ${health.needsAttention ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950'}`}>
        {health.needsAttention ? <AlertTriangle size={18} className="mr-2 inline" /> : <CheckCircle2 size={18} className="mr-2 inline" />}
        {health.workerOnline ? 'Processador de consultas ativo.' : 'Processador de consultas sem heartbeat recente.'}
        {health.active > 0 && ` ${health.active} operação(ões) aguardando ou em processamento.`}
        {health.manual > 0 && ` ${health.manual} requer(em) revisão manual.`}
        <span className="mt-1 block text-xs">Último heartbeat: {date(health.lastHeartbeatAt)}. Atraso acima de 5 minutos exige investigação; não reenvie uma nota para “destravar” a fila.</span>
        {!health.workerOnline && <div className="mt-3 rounded-lg border border-amber-300 bg-white/70 p-3 text-sm">
          <strong>O certificado não inicia esta fila.</strong> Atualizar só recarrega o painel; Abrir venda só mostra os dados da nota.
          <span className="mt-1 block">No desenvolvimento local, execute <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">npm run worker:consultations:local</code> em outro terminal. Esse comando compila e supervisiona o worker de consultas. Em produção, restabeleça o serviço supervisionado de consultas. Nenhum botão desta página transmite operações fiscais.</span>
        </div>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Aguardando', health.counts.PENDENTE || 0], ['Consultando', health.counts.PROCESSANDO || 0],
          ['Tentativa futura', health.counts.ERRO_TEMPORARIO || 0], ['Revisão manual', health.manual],
        ].map(([label, count]) => <div key={label} className="rounded-xl border bg-white p-4"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><strong className="mt-2 block text-2xl">{count}</strong></div>)}
      </div>
      <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        <Clock3 size={16} className="mr-2 inline" /> Pendentes há mais de 5 min: <strong>{health.waitingTooLong}</strong> · Retentativas vencidas: <strong>{health.retryOverdue}</strong> · Processamentos com posse expirada: <strong>{health.processingExpired}</strong>
      </p>
      <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">Operações que precisam de acompanhamento</h2>
        <div className="mt-4 space-y-3">{health.oldest.map(item => <article key={item.id} className="rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-3"><div><strong>{item.empresa} · Nota {item.numero}</strong><p className="mt-1 text-slate-600">{fiscalOperationLabel({ ...item, tipo: 'CONSULTAR' }, { workerOnline: health.workerOnline })} · tentativa {item.attempts}/{item.maxAttempts} · solicitada em {date(item.createdAt)}</p></div>
            {item.vendaId && <Link className="font-bold text-blue-700 underline" href={`/admin/vendas/${item.vendaId}`}>Abrir venda</Link>}</div>
          <p className="mt-2 text-xs text-slate-500">{item.statusMessage || 'Sem detalhe adicional.'}{item.nextAttemptAt ? ` Próxima tentativa: ${date(item.nextAttemptAt)}.` : ''}</p>
        </article>)}
        {!health.oldest.length && <p className="text-sm text-slate-600">Nenhuma consulta aguardando tratamento.</p>}</div>
      </section>
    </>}
  </div>;
}
