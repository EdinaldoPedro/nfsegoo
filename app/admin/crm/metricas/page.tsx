'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Users, AlertTriangle, ArrowLeft, DollarSign, Target, Activity } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDialog } from '@/app/contexts/DialogContext';

export default function MetricasCrm() {
    const router = useRouter();
    const dialog = useDialog();
    const [metrics, setMetrics] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchMetrics = async () => {
            try {
                const res = await fetch('/api/crm/metrics');
                if (res.ok) {
                    setMetrics(await res.json());
                }
            } catch (error) {
                dialog.showAlert('Erro ao carregar métricas.');
            } finally {
                setLoading(false);
            }
        };
        fetchMetrics();
    }, [dialog]);

    if (loading) return <div className="p-8 text-center text-slate-500 font-medium">A analisar dados financeiros...</div>;
    if (!metrics) return <div className="p-8 text-center text-red-500">Erro ao carregar dados.</div>;

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.push('/admin/crm')} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition text-slate-600">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Métricas e Receita</h1>
                        <p className="text-sm text-slate-500">Saúde financeira e retenção do seu SaaS (últimos 30 dias).</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 p-8 rounded-3xl shadow-lg text-white relative overflow-hidden">
                    <div className="absolute -right-4 -bottom-4 opacity-20"><DollarSign size={150}/></div>
                    <div className="relative z-10">
                        <p className="text-emerald-100 font-bold uppercase tracking-wider mb-2 text-sm flex items-center gap-2"><TrendingUp size={18}/> Receita Recorrente Mensal (MRR)</p>
                        <h2 className="text-5xl font-black mb-2">R$ {metrics.mrrTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
                        <p className="text-emerald-200 text-sm">Previsto para faturar todo o mês passivamente.</p>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-blue-700 to-blue-900 p-8 rounded-3xl shadow-lg text-white relative overflow-hidden">
                    <div className="absolute -right-4 -bottom-4 opacity-20"><Target size={150}/></div>
                    <div className="relative z-10">
                        <p className="text-blue-100 font-bold uppercase tracking-wider mb-2 text-sm flex items-center gap-2"><Activity size={18}/> Receita Anual Estimada (ARR)</p>
                        <h2 className="text-5xl font-black mb-2">R$ {metrics.arrTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h2>
                        <p className="text-blue-200 text-sm">O valor do seu SaaS num ano de operação.</p>
                    </div>
                </div>
            </div>

            <h3 className="font-bold text-lg text-slate-700 pt-4 border-t">Saúde da Carteira</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="bg-emerald-100 p-2 rounded-lg text-emerald-600"><Users size={20}/></div>
                        <p className="text-sm font-bold text-slate-500 uppercase">Pagantes</p>
                    </div>
                    <h3 className="text-3xl font-black text-slate-800">{metrics.clientesPagantes}</h3>
                    <p className="text-xs text-slate-400 mt-1">Assinaturas premium ativas</p>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="bg-yellow-100 p-2 rounded-lg text-yellow-600"><Activity size={20}/></div>
                        <p className="text-sm font-bold text-slate-500 uppercase">Em Trial (Teste)</p>
                    </div>
                    <h3 className="text-3xl font-black text-slate-800">{metrics.clientesTrial}</h3>
                    <p className="text-xs text-slate-400 mt-1">Potenciais conversões pendentes</p>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="bg-blue-100 p-2 rounded-lg text-blue-600"><TrendingUp size={20}/></div>
                        <p className="text-sm font-bold text-slate-500 uppercase">Novos (30d)</p>
                    </div>
                    <h3 className="text-3xl font-black text-slate-800">+{metrics.novosClientes30d}</h3>
                    <p className="text-xs text-slate-400 mt-1">Contas criadas no último mês</p>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="bg-red-100 p-2 rounded-lg text-red-600"><AlertTriangle size={20}/></div>
                        <p className="text-sm font-bold text-red-600 uppercase">Churn Rate</p>
                    </div>
                    <h3 className="text-3xl font-black text-red-600">{metrics.churnRate}%</h3>
                    <p className="text-xs text-red-400 mt-1">{metrics.cancelamentos30d} cancelamentos (30d)</p>
                </div>
            </div>
        </div>
    );
}
