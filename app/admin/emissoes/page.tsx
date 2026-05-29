'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle,
  Clock3,
  FileWarning,
  Filter,
  Loader2,
  Search,
  Server,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

type FiltroStatus = 'todos' | 'falhas' | 'processando' | 'saudaveis' | 'pendencias';

function normalizar(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatarData(value?: string) {
  if (!value) return 'Sem registro';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusEmpresa(emp: any) {
  if ((emp.vendasFalhas || 0) > 0 || (emp.errosRecentes || 0) > 0) {
    return {
      label: 'Atenção',
      icon: AlertTriangle,
      className: 'bg-red-50 text-red-700 border-red-200',
      bar: 'bg-red-500',
    };
  }
  if ((emp.vendasProcessando || 0) > 0) {
    return {
      label: 'Processando',
      icon: Clock3,
      className: 'bg-blue-50 text-blue-700 border-blue-200',
      bar: 'bg-blue-500',
    };
  }
  if (!emp.temCertificado || !emp.codigoIbge) {
    return {
      label: 'Pendente',
      icon: FileWarning,
      className: 'bg-amber-50 text-amber-700 border-amber-200',
      bar: 'bg-amber-500',
    };
  }
  return {
    label: 'Saudável',
    icon: CheckCircle,
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bar: 'bg-emerald-500',
  };
}

export default function ListaEmissores() {
  const [emissores, setEmissores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<FiltroStatus>('todos');
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 10;

  useEffect(() => {
    const token = localStorage.getItem('token');

    fetch('/api/admin/emissoes', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('Falha ao buscar emissores');
        return r.json();
      })
      .then((data) => {
        setEmissores(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Não foi possível carregar a lista.');
        setLoading(false);
      });
  }, []);

  const resumo = useMemo(() => {
    return emissores.reduce(
      (acc, emp) => {
        acc.total += 1;
        acc.notas += emp._count?.notasEmitidas || 0;
        acc.mes += emp.vendasMes || 0;
        acc.falhas += emp.vendasFalhas || 0;
        acc.processando += emp.vendasProcessando || 0;
        if (!emp.temCertificado || !emp.codigoIbge) acc.pendencias += 1;
        return acc;
      },
      { total: 0, notas: 0, mes: 0, falhas: 0, processando: 0, pendencias: 0 },
    );
  }, [emissores]);

  const emissoresComAlerta = useMemo(() => {
    return emissores
      .filter((emp) => (emp.vendasFalhas || 0) > 0 || (emp.errosRecentes || 0) > 0)
      .sort((a, b) => (b.vendasFalhas || 0) - (a.vendasFalhas || 0))
      .slice(0, 5);
  }, [emissores]);

  const filtrados = useMemo(() => {
    const termo = normalizar(busca);

    return emissores.filter((emp) => {
      const matchBusca = !termo
        || normalizar(`${emp.razaoSocial} ${emp.nomeFantasia} ${emp.documento} ${emp.codigoIbge}`).includes(termo);

      const matchFiltro =
        filtro === 'todos'
        || (filtro === 'falhas' && ((emp.vendasFalhas || 0) > 0 || (emp.errosRecentes || 0) > 0))
        || (filtro === 'processando' && (emp.vendasProcessando || 0) > 0)
        || (filtro === 'saudaveis' && (emp.vendasFalhas || 0) === 0 && (emp.errosRecentes || 0) === 0 && (emp.vendasProcessando || 0) === 0 && emp.temCertificado && emp.codigoIbge)
        || (filtro === 'pendencias' && (!emp.temCertificado || !emp.codigoIbge));

      return matchBusca && matchFiltro;
    });
  }, [busca, emissores, filtro]);

  useEffect(() => {
    setPaginaAtual(1);
  }, [busca, filtro]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / itensPorPagina));
  const paginaSegura = Math.min(paginaAtual, totalPaginas);
  const inicioPagina = (paginaSegura - 1) * itensPorPagina;
  const emissoresPaginados = filtrados.slice(inicioPagina, inicioPagina + itensPorPagina);

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 text-slate-500">
      <Loader2 className="animate-spin mb-2" size={32}/>
      <p>Carregando painel de emissões...</p>
    </div>
  );

  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="p-6 space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white p-7 shadow-sm overflow-hidden relative">
        <div className="absolute right-8 top-6 w-40 h-40 border border-white/10 rounded-full"></div>
        <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-blue-200 font-black uppercase tracking-[0.2em] text-[11px] mb-3">
              <Activity size={16}/> Operação fiscal
            </div>
            <h1 className="text-3xl font-black">Central de Emissões</h1>
            <p className="text-sm text-blue-100 mt-2 max-w-2xl">
              Monitoramento técnico das empresas emissoras, falhas abertas, pendências cadastrais e volume de uso.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-full lg:min-w-[560px]">
            <div className="rounded-xl bg-white/10 border border-white/10 p-4">
              <p className="text-[10px] uppercase font-black tracking-widest text-blue-100">Emissores</p>
              <p className="text-2xl font-black mt-1">{resumo.total}</p>
            </div>
            <div className="rounded-xl bg-white/10 border border-white/10 p-4">
              <p className="text-[10px] uppercase font-black tracking-widest text-blue-100">Vendas/mês</p>
              <p className="text-2xl font-black mt-1">{resumo.mes}</p>
            </div>
            <div className="rounded-xl bg-red-500/15 border border-red-300/20 p-4">
              <p className="text-[10px] uppercase font-black tracking-widest text-red-100">Falhas</p>
              <p className="text-2xl font-black mt-1">{resumo.falhas}</p>
            </div>
            <div className="rounded-xl bg-blue-500/15 border border-blue-300/20 p-4">
              <p className="text-[10px] uppercase font-black tracking-widest text-blue-100">Processando</p>
              <p className="text-2xl font-black mt-1">{resumo.processando}</p>
            </div>
          </div>
        </div>
      </section>

      {emissoresComAlerta.length > 0 && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-red-100 text-red-700 flex items-center justify-center">
                <AlertTriangle size={22}/>
              </div>
              <div>
                <h2 className="text-lg font-black text-red-900">Emissões exigindo atenção</h2>
                <p className="text-sm text-red-700 mt-1">
                  Empresas com falhas abertas ou erros técnicos recentes. Priorize a validação antes de reenviar.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {emissoresComAlerta.map((emp) => (
                <Link
                  key={emp.id}
                  href={emp.ultimaFalha?.id ? `/admin/vendas/${emp.ultimaFalha.id}` : `/admin/emissoes/${emp.id}`}
                  className="px-3 py-2 rounded-xl bg-white border border-red-100 hover:border-red-300 transition min-w-[220px]"
                >
                  <p className="text-xs font-black text-red-800 truncate">{emp.razaoSocial}</p>
                  <p className="text-[11px] text-red-600 mt-0.5">
                    {emp.vendasFalhas || 0} falha(s) abertas • {emp.errosRecentes || 0} erro(s) 24h
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4">
        <div className="flex flex-col xl:flex-row xl:items-center gap-4">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"/>
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar por razão social, CNPJ ou IBGE..."
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-400 focus:ring-4 focus:ring-blue-50 outline-none text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              ['todos', 'Todos'],
              ['falhas', 'Com falhas'],
              ['processando', 'Processando'],
              ['pendencias', 'Pendências'],
              ['saudaveis', 'Saudáveis'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFiltro(value as FiltroStatus)}
                className={`px-4 py-2.5 rounded-xl text-xs font-black border transition flex items-center gap-2 ${
                  filtro === value
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-200 hover:text-blue-700'
                }`}
              >
                <Filter size={13}/> {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4">
        {filtrados.length === 0 ? (
          <div className="p-12 bg-white rounded-2xl shadow-sm text-center border border-dashed border-slate-300">
            <Server className="mx-auto text-slate-300 mb-4" size={48}/>
            <h3 className="text-lg font-bold text-slate-700">Nenhum emissor encontrado</h3>
            <p className="text-sm text-slate-400 mt-1">Ajuste os filtros ou busque por outro CNPJ.</p>
          </div>
        ) : (
          emissoresPaginados.map((emp) => {
            const status = statusEmpresa(emp);
            const StatusIcon = status.icon;

            return (
              <Link key={emp.id} href={`/admin/emissoes/${emp.id}`}>
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 hover:border-blue-300 hover:shadow-md transition cursor-pointer group relative overflow-hidden">
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${status.bar}`}></div>

                  <div className="p-5 pl-7">
                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className={`p-3 rounded-xl border ${status.className}`}>
                          <StatusIcon size={24}/>
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-black text-lg text-slate-900 group-hover:text-blue-700 transition truncate">
                              {emp.razaoSocial || emp.nomeFantasia || 'Empresa sem nome'}
                            </h3>
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-black uppercase ${status.className}`}>
                              <StatusIcon size={11}/> {status.label}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-mono mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span>CNPJ: {emp.documento || 'Não informado'}</span>
                            <span>IBGE: {emp.codigoIbge || 'Pendente'}</span>
                            <span>Ambiente: {emp.ambiente || 'Não definido'}</span>
                          </p>

                          {emp.ultimoErro && (
                            <div className="mt-3 rounded-xl bg-red-50 border border-red-100 p-3 max-w-3xl">
                              <p className="text-[10px] uppercase tracking-widest font-black text-red-600 mb-1">
                                Último erro • {formatarData(emp.ultimoErro.createdAt)}
                              </p>
                              <p className="text-sm text-red-800 line-clamp-2">{emp.ultimoErro.message}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-5 gap-3 xl:min-w-[620px]">
                        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
                          <p className="text-lg font-black text-slate-900">{emp._count?.notasEmitidas || 0}</p>
                          <p className="text-[10px] uppercase font-black text-slate-400">Notas</p>
                        </div>
                        <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-center">
                          <p className="text-lg font-black text-blue-700">{emp.vendasMes || 0}</p>
                          <p className="text-[10px] uppercase font-black text-blue-400">Mês</p>
                        </div>
                        <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
                          <p className="text-lg font-black text-red-700">{emp.vendasFalhas || 0}</p>
                          <p className="text-[10px] uppercase font-black text-red-400">Falhas</p>
                        </div>
                        <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center">
                          <p className="text-lg font-black text-amber-700">{emp.errosRecentes || 0}</p>
                          <p className="text-[10px] uppercase font-black text-amber-500">Erros 24h</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
                          <p className="text-lg font-black text-slate-900">{emp.vendasProcessando || 0}</p>
                          <p className="text-[10px] uppercase font-black text-slate-400">Fila</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        {emp.temCertificado ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-black rounded-full border border-emerald-200">
                            <ShieldCheck size={11}/> Certificado cadastrado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-700 text-[10px] font-black rounded-full border border-amber-200">
                            <XCircle size={11}/> Certificado pendente
                          </span>
                        )}
                        {emp.codigoIbge ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-[10px] font-black rounded-full border border-blue-200">
                            <Building2 size={11}/> IBGE informado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 text-[10px] font-black rounded-full border border-red-200">
                            <AlertTriangle size={11}/> IBGE pendente
                          </span>
                        )}
                      </div>

                      <div className="text-sm font-bold text-blue-700 flex items-center gap-2 group-hover:gap-3 transition-all">
                        Abrir emissor <ArrowRight size={16}/>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {filtrados.length > itensPorPagina && (
        <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-slate-500">
            Exibindo <span className="font-bold text-slate-800">{inicioPagina + 1}</span> a{' '}
            <span className="font-bold text-slate-800">{Math.min(inicioPagina + itensPorPagina, filtrados.length)}</span> de{' '}
            <span className="font-bold text-slate-800">{filtrados.length}</span> emissores
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaginaAtual((page) => Math.max(1, page - 1))}
              disabled={paginaSegura === 1}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-600 transition"
            >
              Anterior
            </button>

            {Array.from({ length: totalPaginas }).map((_, index) => {
              const page = index + 1;
              if (totalPaginas > 7 && page !== 1 && page !== totalPaginas && Math.abs(page - paginaSegura) > 1) {
                if (page === 2 || page === totalPaginas - 1) {
                  return <span key={page} className="px-2 text-slate-400">...</span>;
                }
                return null;
              }

              return (
                <button
                  key={page}
                  onClick={() => setPaginaAtual(page)}
                  className={`w-10 h-10 rounded-xl border text-sm font-black transition ${
                    paginaSegura === page
                      ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-700'
                  }`}
                >
                  {page}
                </button>
              );
            })}

            <button
              onClick={() => setPaginaAtual((page) => Math.min(totalPaginas, page + 1))}
              disabled={paginaSegura === totalPaginas}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-600 transition"
            >
              Próxima
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
