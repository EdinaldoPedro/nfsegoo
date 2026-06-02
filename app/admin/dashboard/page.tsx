'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  CreditCard,
  Database,
  FileCheck,
  LifeBuoy,
  Loader2,
  MapPin,
  Receipt,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users
} from 'lucide-react';
import { useRouter } from 'next/navigation';

const statusNotaClasses: Record<string, string> = {
  AUTORIZADA: 'bg-emerald-100 text-emerald-700',
  PROCESSANDO: 'bg-blue-100 text-blue-700',
  RASCUNHO: 'bg-slate-100 text-slate-600',
  ERRO: 'bg-red-100 text-red-700',
  CANCELADA: 'bg-amber-100 text-amber-700'
};

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat('pt-BR').format(value || 0);
}

function formatMoney(value: number | undefined) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function formatDate(value?: string) {
  if (!value) return 'Agora';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

function KpiCard({ icon: Icon, label, value, hint, tone = 'blue' }: any) {
  const tones: any = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    purple: 'bg-purple-50 text-purple-700 ring-purple-100',
    red: 'bg-red-50 text-red-700 ring-red-100',
    slate: 'bg-slate-50 text-slate-700 ring-slate-100'
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
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

function Section({ title, subtitle, children, action }: any) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
        <div>
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ProgressRow({ label, value, total, tone = 'blue', right }: any) {
  const width = pct(value, total);
  const tones: any = {
    blue: 'bg-blue-600',
    emerald: 'bg-emerald-600',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    purple: 'bg-purple-600',
    slate: 'bg-slate-500'
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="truncate font-bold text-slate-700">{label}</span>
        <span className="shrink-0 text-slate-500">{right || formatNumber(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${tones[tone] || tones.blue}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function DictionaryList({ data, total, tone = 'blue', labels = {} }: any) {
  const entries = Object.entries(data || {}).sort((a: any, b: any) => b[1] - a[1]);
  if (!entries.length) return <p className="text-sm text-slate-500">Sem dados para exibir.</p>;

  return (
    <div className="space-y-4">
      {entries.map(([key, value]: any) => (
        <ProgressRow
          key={key}
          label={labels[key] || key}
          value={value}
          total={total || entries.reduce((acc: any, item: any) => acc + item[1], 0)}
          tone={tone}
        />
      ))}
    </div>
  );
}

function MiniTrend({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data || {});
  const max = Math.max(...entries.map(([, value]) => value), 1);
  const ultimos14 = entries.slice(-14);

  if (!ultimos14.length) {
    return <div className="flex h-32 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-400">Sem emissões recentes.</div>;
  }

  return (
    <div className="flex h-36 items-end gap-2 rounded-xl bg-slate-50 p-4">
      {ultimos14.map(([dia, value]) => (
        <div key={dia} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div
            className="w-full rounded-t-lg bg-blue-600"
            title={`${dia}: ${value} nota(s)`}
            style={{ height: `${Math.max(8, (value / max) * 100)}px` }}
          />
          <span className="w-full truncate text-center text-[10px] font-bold text-slate-400">{dia.slice(8, 10)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const carregarStats = async () => {
    setRefreshing(true);
    setError('');
    try {
      const res = await fetch('/api/admin/stats', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Nao foi possivel carregar as estatisticas.');
        setStats(null);
        return;
      }
      setStats(data);
    } catch (err) {
      console.error(err);
      setError('Erro de conexao ao carregar o dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    carregarStats();
  }, []);

  const totalStatusNotas = useMemo(() => {
    return Object.values(stats?.notas?.porStatus || {}).reduce((acc: any, item: any) => acc + item, 0);
  }, [stats]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="mr-2 animate-spin" /> Carregando painel analítico...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 shrink-0" size={22} />
            <div>
              <h1 className="text-xl font-black text-red-900">Dashboard indisponivel</h1>
              <p className="mt-1 text-sm font-semibold">{error}</p>
            </div>
          </div>
          <button
            onClick={carregarStats}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const resumo = stats?.resumo || {};
  const empresas = stats?.empresas || {};
  const suporte = stats?.suporte || {};
  const tecnico = stats?.tecnico || {};
  const financeiro = stats?.financeiro || {};
  const usuarios = stats?.usuarios || {};

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">Administração</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Dashboard Analítico</h1>
          <p className="mt-2 max-w-3xl text-slate-500">
            Visão executiva do SaaS: consumo, emissão, carteira, suporte, financeiro, cobertura fiscal e base técnica.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-white px-4 py-2 text-xs font-bold text-slate-500 ring-1 ring-slate-200">
            Atualizado em {formatDate(stats?.atualizadoEm)}
          </span>
          <button
            onClick={carregarStats}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} label="Usuários operacionais" value={formatNumber(resumo.usuariosOperacionais)} hint={`${formatNumber(usuarios.novosMes)} novos no mês (${resumo.crescimentoUsuariosMes || 0}%)`} />
        <KpiCard icon={Building2} label="Empresas no SaaS" value={formatNumber(resumo.empresas)} hint={`${formatNumber(resumo.empresasCompletas)} completas, ${formatNumber(resumo.empresasIncompletas)} pendentes`} tone="purple" />
        <KpiCard icon={FileCheck} label="Notas no mês" value={formatNumber(resumo.notasMes)} hint={`${resumo.variacaoNotasMes || 0}% contra o mês anterior`} tone="emerald" />
        <KpiCard icon={CreditCard} label="Receita paga no mês" value={formatMoney(financeiro.valorPagoMes)} hint={`${formatNumber(financeiro.faturasPagasMes)} faturas pagas`} tone="amber" />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Receipt} label="Valor fiscal emitido" value={formatMoney(resumo.valorNotasMes)} hint="Somente NFS-e autorizadas no mês" tone="emerald" />
        <KpiCard icon={LifeBuoy} label="Tickets abertos" value={formatNumber(suporte.abertos)} hint={`${formatNumber(suporte.novos7d)} novos nos últimos 7 dias`} tone={suporte.abertos ? 'amber' : 'slate'} />
        <KpiCard icon={AlertTriangle} label="Atenções fiscais" value={formatNumber((empresas.semIbge || 0) + (empresas.semCertificado || 0))} hint={`${formatNumber(empresas.semIbge)} sem IBGE, ${formatNumber(empresas.semCertificado)} sem certificado`} tone="red" />
        <KpiCard icon={Database} label="Base técnica" value={formatNumber(tecnico.globalCnae)} hint={`${formatNumber(tecnico.tributacoesMunicipais)} regras municipais`} tone="blue" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title="Consumo de NFS-e" subtitle="Volume emitido e distribuição por status.">
          <MiniTrend data={stats?.notas?.porDia30d || {}} />
          <div className="mt-5 flex flex-wrap gap-2">
            {Object.entries(stats?.notas?.porStatus || {}).map(([status, value]: any) => (
              <span key={status} className={`rounded-full px-3 py-1 text-xs font-black ${statusNotaClasses[status] || 'bg-slate-100 text-slate-600'}`}>
                {status}: {formatNumber(value)}
              </span>
            ))}
          </div>
          <div className="mt-5 space-y-4">
            <DictionaryList data={stats?.notas?.porStatus} total={totalStatusNotas} tone="emerald" />
          </div>
        </Section>

        <Section title="Usuários e perfis" subtitle="Separação entre comum, contador e equipe interna.">
          <DictionaryList
            data={usuarios.porRole}
            total={resumo.usuarios}
            tone="blue"
            labels={{ COMUM: 'Usuários comuns', CONTADOR: 'Contadores', MASTER: 'Master', ADMIN: 'Administradores', SUPORTE: 'Suporte', SUPORTE_TI: 'Suporte TI' }}
          />
        </Section>

        <Section title="Saúde fiscal das empresas" subtitle="Pontos que afetam emissão e suporte.">
          <div className="space-y-4">
            <ProgressRow label="Cadastros completos" value={resumo.empresasCompletas || 0} total={resumo.empresas || 0} tone="emerald" />
            <ProgressRow label="Sem código IBGE" value={empresas.semIbge || 0} total={resumo.empresas || 0} tone="red" />
            <ProgressRow label="Sem certificado A1" value={empresas.semCertificado || 0} total={resumo.empresas || 0} tone="amber" />
            <ProgressRow label="Certificados vencendo" value={empresas.certificadosVencendo || 0} total={resumo.empresas || 0} tone="amber" />
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Financeiro e planos" subtitle="Assinaturas, faturas, pedidos e cupons.">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-400">Assinaturas ativas</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{formatNumber(financeiro.assinaturasAtivas)}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-400">Faturas pendentes</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{formatNumber(financeiro.faturasPendentes)}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-400">Planos ativos</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{formatNumber(financeiro.planosAtivos)}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase text-slate-400">Cupons usados no mês</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{formatNumber(financeiro.cuponsUsadosMes)}</p>
            </div>
          </div>
          <div className="mt-5">
            <DictionaryList data={financeiro.pedidosPorStatus} tone="purple" />
          </div>
        </Section>

        <Section title="Suporte e operação interna" subtitle="Fila de atendimento e prioridade dos chamados.">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <p className="mb-4 text-sm font-black text-slate-700">Por status</p>
              <DictionaryList data={suporte.porStatus} total={suporte.total} tone="amber" />
            </div>
            <div>
              <p className="mb-4 text-sm font-black text-slate-700">Por prioridade</p>
              <DictionaryList data={suporte.porPrioridade} total={suporte.total} tone="red" />
            </div>
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section title="Cobertura por UF" subtitle="Onde estão as empresas cadastradas.">
          <div className="space-y-4">
            {(empresas.porUf || []).map((item: any) => (
              <ProgressRow key={item.uf} label={item.uf} value={item.total} total={resumo.empresas || 1} tone="blue" />
            ))}
          </div>
        </Section>

        <Section title="Municípios mais usados" subtitle="Base fiscal ligada ao código IBGE.">
          <div className="space-y-3">
            {(empresas.municipiosMaisUsados || []).map((item: any) => (
              <div key={`${item.codigoIbge}-${item.cidade}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-800">{item.cidade}/{item.uf}</p>
                  <p className="text-xs font-medium text-slate-400">IBGE {item.codigoIbge}</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 ring-1 ring-slate-200">{item.total}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="CNAEs mais recorrentes" subtitle="Atividades mais presentes na base.">
          <div className="space-y-3">
            {(tecnico.cnaesMaisUsados || []).map((item: any) => (
              <div key={`${item.codigo}-${item.descricao}`} className="rounded-xl bg-slate-50 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-sm font-black text-slate-800">{item.codigo}</p>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-600 ring-1 ring-slate-200">{item.total}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs font-medium text-slate-500">{item.descricao}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Section title="Base técnica fiscal" subtitle="Indicadores de cadastros internos que sustentam a emissão.">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-2xl bg-blue-50 p-4 text-blue-800">
              <BarChart3 size={20} />
              <p className="mt-3 text-2xl font-black">{formatNumber(tecnico.globalCnae)}</p>
              <p className="text-xs font-bold uppercase">CNAEs globais</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-800">
              <ShieldCheck size={20} />
              <p className="mt-3 text-2xl font-black">{formatNumber(tecnico.cnaesComRetencao)}</p>
              <p className="text-xs font-bold uppercase">Com retenção</p>
            </div>
            <div className="rounded-2xl bg-purple-50 p-4 text-purple-800">
              <MapPin size={20} />
              <p className="mt-3 text-2xl font-black">{formatNumber(tecnico.tributacoesMunicipais)}</p>
              <p className="text-xs font-bold uppercase">Tributações</p>
            </div>
            <div className="rounded-2xl bg-amber-50 p-4 text-amber-800">
              <CheckCircle2 size={20} />
              <p className="mt-3 text-2xl font-black">{formatNumber(tecnico.municipiosHomologados)}</p>
              <p className="text-xs font-bold uppercase">Municípios</p>
            </div>
          </div>
          <div className="mt-5">
            <DictionaryList data={tecnico.municipiosPorStatus} tone="blue" />
          </div>
        </Section>

        <Section title="Sistema e logs recentes" subtitle="Sinais de erro e últimos eventos técnicos.">
          <div className="mb-4 flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-red-700">
            <AlertTriangle size={22} />
            <div>
              <p className="text-2xl font-black">{formatNumber(stats?.sistema?.logsErro7d)}</p>
              <p className="text-sm font-bold">logs de erro nos últimos 7 dias</p>
            </div>
          </div>
          <div className="space-y-3">
            {(stats?.sistema?.logsRecentes || []).map((log: any) => (
              <div key={log.id} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">{log.level}</span>
                  <span className="text-xs text-slate-400">{formatDate(log.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm font-black text-slate-800">{log.action}</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{log.message}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
