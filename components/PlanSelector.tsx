'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, PackagePlus } from 'lucide-react';

interface Plan {
  id: string; name: string; slug: string; tipo: string; active: boolean; privado: boolean; diasTeste: number;
  priceMonthly: string | number; priceYearly: string | number; features: string; recommended: boolean;
}
interface PlanSelectorProps { currentPlan: string; currentCycle?: string }

function features(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 30) : [];
  } catch { return []; }
}

export default function PlanSelector({ currentPlan, currentCycle }: PlanSelectorProps) {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [cycle, setCycle] = useState<'MENSAL' | 'ANUAL'>(currentCycle === 'ANUAL' ? 'ANUAL' : 'MENSAL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/plans', { signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error('Não foi possível carregar as ofertas. Atualize a página para tentar novamente.'); return res.json(); })
      .then((data) => { setPlans(Array.isArray(data) ? data : []); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message || 'Falha ao carregar ofertas.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const offers = plans.filter((plan) => plan.active && !plan.privado && plan.tipo === 'PLANO' && plan.diasTeste === 0
    && Number(cycle === 'ANUAL' ? plan.priceYearly : plan.priceMonthly) > 0);
  const select = (slug: string) => router.push(`/checkout?${new URLSearchParams({ plan: slug, cycle })}`);

  if (loading) return <p role="status" className="p-8 flex justify-center items-center gap-2"><Loader2 className="animate-spin" /> Carregando ofertas…</p>;
  if (error) return <p role="alert" className="p-8 text-red-700">{error}</p>;
  return <div className="w-full max-w-6xl mx-auto space-y-8">
    <div className="flex justify-center gap-2" role="group" aria-label="Ciclo da assinatura">
      {(['MENSAL', 'ANUAL'] as const).map((value) => <button key={value} type="button" aria-pressed={cycle === value}
        onClick={() => setCycle(value)} className={`px-6 py-3 rounded-xl font-bold ${cycle === value ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700'}`}>
        {value === 'ANUAL' ? 'Anual' : 'Mensal'}
      </button>)}
    </div>
    <p className="text-sm text-slate-600 text-center">Condições e total serão confirmados no checkout. A renovação antecipada começa após o período já contratado.</p>
    <div className="grid gap-5 md:grid-cols-3">
      {offers.map((plan) => {
        const current = currentPlan === plan.slug && (currentCycle || 'MENSAL') === cycle;
        const price = Number(cycle === 'ANUAL' ? plan.priceYearly : plan.priceMonthly);
        return <article key={plan.id} className="rounded-2xl border border-slate-200 bg-white p-6 flex flex-col">
          <h3 className="font-bold text-xl text-slate-900">{plan.name}</h3>
          {current && <p className="text-xs text-blue-700 mt-1">Plano atual</p>}
          <p className="text-2xl font-black text-slate-900 mt-3">{price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}<span className="text-sm font-normal">/{cycle === 'ANUAL' ? 'ano' : 'mês'}</span></p>
          <ul className="my-5 space-y-2 flex-1">{features(plan.features).map((feature, index) => <li key={index} className="flex gap-2 text-sm text-slate-700"><Check size={16} className="shrink-0 text-green-700" />{feature}</li>)}</ul>
          <button type="button" onClick={() => select(plan.slug)} className="rounded-xl bg-blue-700 text-white px-4 py-3 font-bold">{current ? 'Solicitar renovação antecipada' : 'Solicitar contratação'}</button>
        </article>;
      })}
    </div>
    {!offers.length && <p role="status" className="text-center text-slate-600">Nenhuma assinatura disponível neste ciclo.</p>}
    <section className="rounded-2xl bg-slate-900 p-6 text-white space-y-3">
      <h3 className="text-xl font-bold">Precisa de capacidade adicional?</h3>
      <p className="text-sm text-slate-300">Consulte os pacotes de notas, clientes e empresas no checkout. O uso dos pacotes exige assinatura vigente; preços e benefícios vêm do catálogo.</p>
      <button type="button" onClick={() => router.push('/checkout')} className="inline-flex gap-2 items-center rounded-xl bg-white text-slate-900 px-4 py-3 font-bold"><PackagePlus size={20} /> Ver pacotes adicionais</button>
    </section>
  </div>;
}
