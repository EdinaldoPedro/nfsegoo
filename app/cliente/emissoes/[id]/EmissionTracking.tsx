'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Loader2, RefreshCw } from 'lucide-react';

const activeStatuses = new Set(['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO']);

function statusPresentation(status?: string) {
  if (status === 'AUTORIZADA') return { title: 'Nota autorizada', detail: 'A autorização foi confirmada e os documentos serão disponibilizados no histórico.', color: 'emerald', Icon: CheckCircle2 };
  if (status === 'RECONCILIACAO_MANUAL') return { title: 'Conciliação solicitada', detail: 'Nossa equipe precisa confirmar o resultado fiscal. Não emita outra nota para esta venda.', color: 'amber', Icon: AlertTriangle };
  if (status === 'ERRO_FINAL') return { title: 'Emissão não concluída', detail: 'Confira a orientação apresentada e solicite ajuda quando necessário.', color: 'red', Icon: AlertTriangle };
  if (status === 'ERRO_TEMPORARIO') return { title: 'Consultando o resultado', detail: 'A solicitação está preservada e uma nova consulta ocorrerá automaticamente.', color: 'blue', Icon: RefreshCw };
  if (status === 'PROCESSANDO') return { title: 'Emissão em processamento', detail: 'O resultado está sendo confirmado com o ambiente fiscal.', color: 'blue', Icon: Loader2 };
  return { title: 'Emissão na fila', detail: 'A solicitação foi registrada e aguarda processamento.', color: 'blue', Icon: Clock3 };
}

export default function EmissionTracking({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/notas/jobs/${encodeURIComponent(jobId)}`, {
        headers: { 'x-empresa-id': localStorage.getItem('empresaContextId') || '' },
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar esta emissão.');
      setJob(data);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível consultar esta emissão.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const presentation = statusPresentation(job?.status);
  const Icon = presentation.Icon;
  const active = activeStatuses.has(job?.status);
  const portalUnstable = job?.portalDiagnostic?.category === 'PORTAL_INSTABILITY'
    && job?.portalDiagnostic?.doubleChecked === true;
  const color = presentation.color === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : presentation.color === 'red'
      ? 'border-red-200 bg-red-50 text-red-900'
      : presentation.color === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-950'
        : 'border-blue-200 bg-blue-50 text-blue-950';

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/cliente/notas" className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-blue-700">
          <ArrowLeft size={17} /> Voltar para minhas notas
        </Link>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          <header className="bg-slate-950 px-6 py-7 text-white md:px-9">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">Acompanhamento da emissão</p>
            <h1 className="mt-2 text-2xl font-black">Solicitação fiscal</h1>
            <p className="mt-2 break-all font-mono text-xs text-slate-400">{jobId}</p>
          </header>

          <div className="space-y-5 p-6 md:p-9">
            {loading && !job ? (
              <div className="flex items-center justify-center gap-3 py-16 font-bold text-blue-700"><Loader2 className="animate-spin" /> Consultando...</div>
            ) : error ? (
              <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
                <strong>Não foi possível atualizar</strong><p className="mt-1 text-sm">{error}</p>
                <button onClick={() => void load()} className="mt-4 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-black">Tentar novamente</button>
              </div>
            ) : (
              <>
                <div className={`rounded-2xl border p-5 ${color}`} role="status">
                  <div className="flex items-start gap-4">
                    <Icon size={26} className={`mt-0.5 shrink-0 ${job.status === 'PROCESSANDO' ? 'animate-spin' : ''}`} />
                    <div>
                      <h2 className="text-xl font-black">{presentation.title}</h2>
                      <p className="mt-2 text-sm">{portalUnstable ? 'O Portal Nacional apresentou instabilidade em duas verificações consecutivas.' : job.statusMessage || presentation.detail}</p>
                      <p className="mt-2 text-sm font-semibold">{presentation.detail}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Status</p><p className="mt-1 font-bold text-slate-900">{job.status}</p></div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Tentativas</p><p className="mt-1 font-bold text-slate-900">{job.attempts}/{job.maxAttempts}</p></div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Última atualização</p><p className="mt-1 font-bold text-slate-900">{new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p></div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wider text-slate-400">Próxima consulta</p><p className="mt-1 font-bold text-slate-900">{job.nextAttemptAt ? new Date(job.nextAttemptAt).toLocaleString('pt-BR') : active ? 'Aguardando agendamento' : 'Não aplicável'}</p></div>
                </div>

                {active && <p className="text-center text-sm text-slate-500">Esta página é atualizada automaticamente. Não envie outra nota para a mesma venda.</p>}
                {job.status === 'AUTORIZADA' && <Link href="/cliente/notas" className="block rounded-xl bg-blue-600 px-5 py-3 text-center font-black text-white hover:bg-blue-700">Ver nota no histórico</Link>}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
