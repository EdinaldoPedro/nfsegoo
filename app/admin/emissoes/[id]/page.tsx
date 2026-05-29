'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Building2,
  CheckCircle,
  Clock3,
  FileText,
  Filter,
  Loader2,
  RefreshCcw,
  Search,
  Server,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

type StatusFiltro = 'todos' | 'falhas' | 'autorizadas' | 'processando' | 'pendentes' | 'canceladas';

function formatMoney(value: any) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(value?: string) {
  if (!value) return 'Sem data';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function statusMeta(status: string) {
  if (status === 'CONCLUIDA') {
    return { label: 'Autorizada', icon: CheckCircle, badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' };
  }
  if (status === 'ERRO_EMISSAO') {
    return { label: 'Falhou', icon: AlertTriangle, badge: 'bg-red-50 text-red-700 border-red-200', bar: 'bg-red-500' };
  }
  if (status === 'PROCESSANDO') {
    return { label: 'Processando', icon: Clock3, badge: 'bg-blue-50 text-blue-700 border-blue-200', bar: 'bg-blue-500' };
  }
  if (status === 'CANCELADA') {
    return { label: 'Cancelada', icon: Ban, badge: 'bg-slate-100 text-slate-600 border-slate-200', bar: 'bg-slate-400' };
  }
  return { label: 'Pendente', icon: FileText, badge: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-500' };
}

function metricCard(label: string, value: any, tone = 'slate') {
  const tones: Record<string, string> = {
    slate: 'bg-white border-slate-200 text-slate-900',
    red: 'bg-red-50 border-red-200 text-red-800',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
  };

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
      <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

export default function DetalheEmissor() {
  const { id } = useParams();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [ambienteAtual, setAmbienteAtual] = useState('');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<StatusFiltro>('todos');
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 12;

  useEffect(() => {
    carregarDados();
  }, [id]);

  useEffect(() => {
    setPaginaAtual(1);
  }, [busca, filtro]);

  const carregarDados = (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    fetch(`/api/admin/emissoes/${id}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Erro na API');
        return json;
      })
      .then((resData) => {
        setData(resData);
        setAmbienteAtual(resData.empresa.ambiente || 'HOMOLOGACAO');
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  const handleMudarAmbiente = async (novoAmbiente: string) => {
    if (!confirm(`Deseja alterar o ambiente para ${novoAmbiente}?`)) return;

    const ambienteAnterior = ambienteAtual;
    setAmbienteAtual(novoAmbiente);

    try {
      const res = await fetch('/api/admin/empresas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ambiente: novoAmbiente }),
      });

      if (res.ok) alert('Ambiente atualizado com sucesso!');
      else {
        setAmbienteAtual(ambienteAnterior);
        alert('Erro ao salvar ambiente no banco.');
      }
    } catch {
      setAmbienteAtual(ambienteAnterior);
      alert('Erro de conexão.');
    }
  };

  const empresa = data?.empresa;
  const vendas = data?.vendas || [];

  const resumo = useMemo(() => {
    return vendas.reduce(
      (acc: any, venda: any) => {
        acc.total += 1;
        acc.valor += Number(venda.valor || 0);
        if (venda.status === 'CONCLUIDA') acc.autorizadas += 1;
        else if (venda.status === 'ERRO_EMISSAO') acc.falhas += 1;
        else if (venda.status === 'PROCESSANDO') acc.processando += 1;
        else if (venda.status === 'CANCELADA') acc.canceladas += 1;
        else acc.pendentes += 1;
        return acc;
      },
      { total: 0, valor: 0, autorizadas: 0, falhas: 0, processando: 0, pendentes: 0, canceladas: 0 },
    );
  }, [vendas]);

  const vendasComFalha = useMemo(() => vendas.filter((venda: any) => venda.status === 'ERRO_EMISSAO').slice(0, 4), [vendas]);

  const vendasFiltradas = useMemo(() => {
    const termo = normalize(busca);
    return vendas.filter((venda: any) => {
      const cliente = venda.cliente || {};
      const nota = venda.notas?.[0];
      const matchBusca = !termo || normalize(`${cliente.razaoSocial} ${cliente.nome} ${cliente.documento} ${venda.id} ${nota?.numero || ''}`).includes(termo);
      const matchFiltro =
        filtro === 'todos'
        || (filtro === 'falhas' && venda.status === 'ERRO_EMISSAO')
        || (filtro === 'autorizadas' && venda.status === 'CONCLUIDA')
        || (filtro === 'processando' && venda.status === 'PROCESSANDO')
        || (filtro === 'pendentes' && venda.status === 'PENDENTE')
        || (filtro === 'canceladas' && venda.status === 'CANCELADA');

      return matchBusca && matchFiltro;
    });
  }, [busca, filtro, vendas]);

  const totalPaginas = Math.max(1, Math.ceil(vendasFiltradas.length / itensPorPagina));
  const paginaSegura = Math.min(paginaAtual, totalPaginas);
  const inicio = (paginaSegura - 1) * itensPorPagina;
  const vendasPaginadas = vendasFiltradas.slice(inicio, inicio + itensPorPagina);

  if (loading && !data) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        <Loader2 className="animate-spin text-blue-600 mr-3" size={34} />
        Carregando emissor...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center flex-col gap-4">
        <AlertTriangle className="text-red-500" size={50} />
        <h2 className="text-xl font-bold text-slate-700">Erro ao carregar dados</h2>
        <p className="text-red-600 bg-red-50 p-4 rounded border border-red-200 font-mono text-sm">{error}</p>
      </div>
    );
  }

  if (!empresa) return null;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex gap-4">
              <button onClick={() => router.back()} className="mt-1 h-11 w-11 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 flex items-center justify-center">
                <ArrowLeft size={20} />
              </button>

              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-black text-slate-950">{empresa.razaoSocial}</h1>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <Server size={14} className="text-slate-400" />
                    <select
                      value={ambienteAtual}
                      onChange={(event) => handleMudarAmbiente(event.target.value)}
                      className={`bg-transparent text-xs font-black uppercase outline-none cursor-pointer ${
                        ambienteAtual === 'PRODUCAO' ? 'text-red-600' : 'text-blue-600'
                      }`}
                    >
                      <option value="HOMOLOGACAO">Homologação</option>
                      <option value="PRODUCAO">Produção</option>
                    </select>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${empresa.temCertificado ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                    {empresa.temCertificado ? <ShieldCheck size={11} /> : <XCircle size={11} />}
                    {empresa.temCertificado ? 'Certificado cadastrado' : 'Sem certificado'}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 font-mono">
                  <span>CNPJ: {empresa.documento}</span>
                  <span>IM: {empresa.inscricaoMunicipal || '-'}</span>
                  <span>IBGE: {empresa.codigoIbge || 'Pendente'}</span>
                  <span>{empresa.cidade || 'Cidade não informada'}/{empresa.uf || '--'}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => carregarDados(true)}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            >
              {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
              Atualizar
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
          {metricCard('Vendas', resumo.total)}
          {metricCard('Autorizadas', resumo.autorizadas, 'emerald')}
          {metricCard('Falhas', resumo.falhas, 'red')}
          {metricCard('Processando', resumo.processando, 'blue')}
          {metricCard('Pendentes', resumo.pendentes, 'amber')}
          {metricCard('Valor total', formatMoney(resumo.valor))}
        </section>

        {vendasComFalha.length > 0 && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h2 className="text-lg font-black text-red-950">Emissões com falha neste emissor</h2>
                  <p className="text-sm text-red-700 mt-1">Abra uma venda para acessar a bancada de correção, validação, XML e retornos do Portal.</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {vendasComFalha.map((venda: any) => (
                  <button
                    key={venda.id}
                    onClick={() => router.push(`/admin/vendas/${venda.id}`)}
                    className="rounded-xl border border-red-100 bg-white px-3 py-2 text-left hover:border-red-300 min-w-[220px]"
                  >
                    <p className="text-xs font-black text-red-900 truncate">{venda.cliente?.razaoSocial || 'Consumidor final'}</p>
                    <p className="text-[11px] text-red-600 mt-0.5">{formatMoney(venda.valor)} • {formatDate(venda.updatedAt || venda.createdAt)}</p>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder="Buscar por tomador, documento, ID da venda ou número da nota..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-50"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                ['todos', 'Todos'],
                ['falhas', 'Falhas'],
                ['autorizadas', 'Autorizadas'],
                ['processando', 'Processando'],
                ['pendentes', 'Pendentes'],
                ['canceladas', 'Canceladas'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFiltro(value as StatusFiltro)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition ${
                    filtro === value
                      ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700'
                  }`}
                >
                  <Filter size={13} /> {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-4 flex items-center justify-between">
            <div>
              <h3 className="font-black text-slate-900 flex items-center gap-2"><Activity size={18} /> Histórico de transações</h3>
              <p className="text-sm text-slate-500 mt-0.5">Exibindo as últimas vendas registradas para este emissor.</p>
            </div>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-black text-slate-600">{vendasFiltradas.length} registros</span>
          </div>

          {vendasPaginadas.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              Nenhuma venda encontrada para os filtros atuais.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {vendasPaginadas.map((venda: any) => {
                const meta = statusMeta(venda.status);
                const Icon = meta.icon;
                const nota = venda.notas?.[0];
                const cliente = venda.cliente?.razaoSocial || venda.cliente?.nome || 'Consumidor final';

                return (
                  <button
                    key={venda.id}
                    onClick={() => router.push(`/admin/vendas/${venda.id}`)}
                    className="relative w-full p-5 text-left hover:bg-slate-50 transition group"
                  >
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${meta.bar}`} />
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between pl-2">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className={`rounded-xl border p-3 ${meta.badge}`}>
                          <Icon size={20} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-black text-slate-900 text-base truncate">{cliente}</p>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black uppercase ${meta.badge}`}>
                              <Icon size={11} /> {meta.label}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 font-mono">
                            {formatDate(venda.createdAt)} • ID {venda.id.split('-')[0]} • DOC {venda.cliente?.documento || '-'}
                          </p>
                          {venda.status === 'ERRO_EMISSAO' && (
                            <p className="mt-2 text-xs font-semibold text-red-700">Clique para abrir a bancada de correção desta venda.</p>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 xl:min-w-[520px]">
                        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                          <p className="text-[10px] uppercase font-black text-slate-400">Valor</p>
                          <p className="font-black text-slate-900">{formatMoney(venda.valor)}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                          <p className="text-[10px] uppercase font-black text-slate-400">Nota</p>
                          <p className="font-black text-slate-900">{nota?.numero || '-'}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                          <p className="text-[10px] uppercase font-black text-slate-400">Série</p>
                          <p className="font-black text-slate-900">{nota?.serie || nota?.numero ? 'DPS' : '-'}</p>
                        </div>
                        <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] uppercase font-black text-blue-400">Abrir</p>
                            <p className="font-black text-blue-800">Detalhes</p>
                          </div>
                          <ArrowRight size={18} className="text-blue-600 group-hover:translate-x-1 transition" />
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {vendasFiltradas.length > itensPorPagina && (
          <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <p className="text-sm text-slate-500">
              Exibindo <span className="font-bold text-slate-800">{inicio + 1}</span> a{' '}
              <span className="font-bold text-slate-800">{Math.min(inicio + itensPorPagina, vendasFiltradas.length)}</span> de{' '}
              <span className="font-bold text-slate-800">{vendasFiltradas.length}</span> vendas
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPaginaAtual((page) => Math.max(1, page - 1))}
                disabled={paginaSegura === 1}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 transition"
              >
                Anterior
              </button>
              <span className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white">
                {paginaSegura} / {totalPaginas}
              </span>
              <button
                onClick={() => setPaginaAtual((page) => Math.min(totalPaginas, page + 1))}
                disabled={paginaSegura === totalPaginas}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 transition"
              >
                Próxima
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
