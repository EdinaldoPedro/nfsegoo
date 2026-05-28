'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  Briefcase,
  ChevronRight,
  DollarSign,
  Filter,
  Loader2,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users
} from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';

const STAFF_ROLES = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'];

const filtros = [
  { id: 'todos', label: 'Todos' },
  { id: 'ativos', label: 'Ativos' },
  { id: 'pagantes', label: 'Pagantes' },
  { id: 'trial', label: 'Trial/Gratuitos' },
  { id: 'contadores', label: 'Contadores' },
  { id: 'sem-plano', label: 'Sem plano' }
];

function moeda(valor: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}

function numero(valor: number) {
  return new Intl.NumberFormat('pt-BR').format(valor || 0);
}

function getPlanoAtivo(cliente: any) {
  return cliente.planHistories?.find((h: any) => h.status === 'ATIVO');
}

function getMrr(cliente: any) {
  return Number(getPlanoAtivo(cliente)?.plan?.priceMonthly || 0);
}

function Kpi({ icon: Icon, label, value, hint, tone = 'blue' }: any) {
  const tones: any = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    purple: 'bg-purple-50 text-purple-700 ring-purple-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
    slate: 'bg-slate-50 text-slate-700 ring-slate-100'
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ring-1 ${tones[tone] || tones.blue}`}>
          <Icon size={22} />
        </div>
      </div>
      {hint && <p className="mt-4 text-sm font-medium text-slate-500">{hint}</p>}
    </div>
  );
}

function ProgressRow({ label, value, total, tone = 'blue' }: any) {
  const width = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const tones: any = {
    blue: 'bg-blue-600',
    emerald: 'bg-emerald-600',
    purple: 'bg-purple-600',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    slate: 'bg-slate-500'
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="font-bold text-slate-700">{label}</span>
        <span className="text-slate-500">{numero(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${tones[tone] || tones.blue}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export default function CrmDashboard() {
  const dialog = useDialog();
  const [clientes, setClientes] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filtroBusca, setFiltroBusca] = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState('todos');

  useEffect(() => {
    const carregarClientes = async () => {
      try {
        const [usersRes, metricsRes] = await Promise.all([
          fetch('/api/admin/users', { cache: 'no-store' }),
          fetch('/api/crm/metrics', { cache: 'no-store' })
        ]);

        if (usersRes.ok) {
          const data = await usersRes.json();
          setClientes(data.filter((u: any) => !STAFF_ROLES.includes(u.role)));
        }

        if (metricsRes.ok) {
          setMetrics(await metricsRes.json());
        }
      } catch (error) {
        dialog.showAlert('Erro ao carregar clientes do CRM.');
      } finally {
        setLoading(false);
      }
    };
    carregarClientes();
  }, [dialog]);

  const indicadores = useMemo(() => {
    const clientesAtivos = clientes.filter((c) => c.planoStatus === 'active');
    const pagantes = clientes.filter((c) => getMrr(c) > 0);
    const trials = clientes.filter((c) => getPlanoAtivo(c) && getMrr(c) === 0);
    const semPlano = clientes.filter((c) => !getPlanoAtivo(c));
    const contadores = clientes.filter((c) => c.role === 'CONTADOR');
    const mrr = clientes.reduce((acc, cliente) => acc + getMrr(cliente), 0);
    const ticketMedio = pagantes.length ? mrr / pagantes.length : 0;

    return { clientesAtivos, pagantes, trials, semPlano, contadores, mrr, ticketMedio };
  }, [clientes]);

  const clientesFiltrados = useMemo(() => {
    const termo = filtroBusca.trim().toLowerCase();
    return clientes.filter((cliente) => {
      const plano = getPlanoAtivo(cliente);
      const mrr = getMrr(cliente);
      const texto = `${cliente.nome || ''} ${cliente.email || ''} ${cliente.empresa?.razaoSocial || ''} ${cliente.empresa?.documento || ''}`.toLowerCase();
      const passouBusca = !termo || texto.includes(termo);
      if (!passouBusca) return false;

      if (filtroAtivo === 'ativos') return cliente.planoStatus === 'active';
      if (filtroAtivo === 'pagantes') return mrr > 0;
      if (filtroAtivo === 'trial') return plano && mrr === 0;
      if (filtroAtivo === 'contadores') return cliente.role === 'CONTADOR';
      if (filtroAtivo === 'sem-plano') return !plano;
      return true;
    });
  }, [clientes, filtroAtivo, filtroBusca]);

  const topClientes = useMemo(() => {
    return [...clientes]
      .filter((cliente) => getMrr(cliente) > 0)
      .sort((a, b) => getMrr(b) - getMrr(a))
      .slice(0, 5);
  }, [clientes]);

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-purple-600">CRM / Clientes</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Gestão de Relacionamento</h1>
          <p className="mt-2 max-w-3xl text-slate-500">
            Acompanhe carteira, receita recorrente, perfis de cliente e oportunidades de ação comercial.
          </p>
        </div>
        <Link href="/admin/crm/metricas" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
          <TrendingUp size={18} /> Relatório financeiro
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Users} label="Total na carteira" value={numero(clientes.length)} hint={`${numero(indicadores.clientesAtivos.length)} contas ativas`} />
        <Kpi icon={DollarSign} label="MRR estimado" value={moeda(metrics?.mrrTotal ?? indicadores.mrr)} hint={`ARR ${moeda(metrics?.arrTotal ?? indicadores.mrr * 12)}`} tone="emerald" />
        <Kpi icon={Activity} label="Clientes pagantes" value={numero(metrics?.clientesPagantes ?? indicadores.pagantes.length)} hint={`Ticket médio ${moeda(indicadores.ticketMedio)}`} tone="purple" />
        <Kpi icon={TrendingDown} label="Churn 30 dias" value={`${metrics?.churnRate ?? 0}%`} hint={`${numero(metrics?.cancelamentos30d || 0)} cancelamentos recentes`} tone="amber" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-950">Carteira CRM</h2>
                <p className="mt-1 text-sm text-slate-500">{numero(clientesFiltrados.length)} contas exibidas</p>
              </div>
              <div className="relative w-full lg:w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="text"
                  placeholder="Buscar por nome, e-mail, empresa ou CNPJ..."
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-purple-300 focus:ring-2 focus:ring-purple-100"
                  value={filtroBusca}
                  onChange={(e) => setFiltroBusca(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {filtros.map((filtro) => (
                <button
                  key={filtro.id}
                  onClick={() => setFiltroAtivo(filtro.id)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black transition ${
                    filtroAtivo === filtro.id
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-purple-50 hover:text-purple-700'
                  }`}
                >
                  <Filter size={13} /> {filtro.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-black uppercase text-slate-400">
                <tr>
                  <th className="p-4">Cliente / Empresa</th>
                  <th className="p-4">Perfil</th>
                  <th className="p-4">Assinatura</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-slate-500">
                      <Loader2 className="mx-auto mb-2 animate-spin" /> Carregando carteira CRM...
                    </td>
                  </tr>
                ) : clientesFiltrados.length === 0 ? (
                  <tr><td colSpan={5} className="p-10 text-center text-slate-500">Nenhum cliente encontrado.</td></tr>
                ) : (
                  clientesFiltrados.map((cliente) => {
                    const planoAtivo = getPlanoAtivo(cliente);
                    const plano = planoAtivo?.plan;
                    const mrr = getMrr(cliente);
                    return (
                      <tr key={cliente.id} className="transition hover:bg-slate-50">
                        <td className="p-4">
                          <div className="font-black text-slate-900">{cliente.nome}</div>
                          <div className="text-xs font-medium text-slate-500">{cliente.email}</div>
                          {cliente.empresa?.razaoSocial && (
                            <div className="mt-1 max-w-xs truncate text-xs text-slate-400">{cliente.empresa.razaoSocial}</div>
                          )}
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase ${
                            cliente.role === 'CONTADOR' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {cliente.role === 'CONTADOR' ? 'Contador' : 'Comum'}
                          </span>
                        </td>
                        <td className="p-4">
                          {plano ? (
                            <div>
                              <div className="font-black text-blue-700">{plano.name}</div>
                              <div className="text-xs font-medium text-slate-500">{moeda(mrr)}/mês</div>
                            </div>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-400">Sem plano</span>
                          )}
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase ${
                            cliente.planoStatus === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {cliente.planoStatus || 'sem status'}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <Link href={`/admin/crm/${cliente.id}`} className="inline-flex items-center gap-1 rounded-xl bg-purple-50 px-3 py-2 text-xs font-black text-purple-700 transition hover:bg-purple-100">
                            Visão 360 <ChevronRight size={15} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-purple-50 p-3 text-purple-700">
                <Sparkles size={20} />
              </div>
              <div>
                <h2 className="font-black text-slate-950">Composição da base</h2>
                <p className="text-sm text-slate-500">Leitura rápida da carteira.</p>
              </div>
            </div>
            <div className="space-y-5">
              <ProgressRow label="Pagantes" value={indicatorsSafe(indicadores.pagantes.length)} total={clientes.length} tone="emerald" />
              <ProgressRow label="Trial/Gratuitos" value={indicatorsSafe(indicadores.trials.length)} total={clientes.length} tone="blue" />
              <ProgressRow label="Contadores" value={indicatorsSafe(indicadores.contadores.length)} total={clientes.length} tone="purple" />
              <ProgressRow label="Sem plano" value={indicatorsSafe(indicadores.semPlano.length)} total={clientes.length} tone="amber" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-black text-slate-950">Maiores MRR</h2>
                <p className="text-sm text-slate-500">Contas que mais pesam na receita.</p>
              </div>
              <ArrowUpRight className="text-slate-400" size={20} />
            </div>
            <div className="space-y-3">
              {topClientes.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Sem clientes pagantes para destacar.</p>
              ) : (
                topClientes.map((cliente) => (
                  <Link key={cliente.id} href={`/admin/crm/${cliente.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 transition hover:bg-purple-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-800">{cliente.nome}</p>
                      <p className="truncate text-xs text-slate-500">{cliente.email}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
                      {moeda(getMrr(cliente))}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-white/10 p-3 text-blue-200">
                <UserCheck size={20} />
              </div>
              <div>
                <h2 className="font-black">Sinais comerciais</h2>
                <p className="text-sm text-slate-300">Novos clientes nos últimos 30 dias.</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/10 p-4">
                <p className="text-2xl font-black">{numero(metrics?.novosClientes30d || 0)}</p>
                <p className="text-xs font-bold uppercase text-slate-300">Novas contas</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-4">
                <p className="text-2xl font-black">{numero(metrics?.clientesTrial ?? indicadores.trials.length)}</p>
                <p className="text-xs font-bold uppercase text-slate-300">Em trial/free</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function indicatorsSafe(value: number) {
  return Number.isFinite(value) ? value : 0;
}
