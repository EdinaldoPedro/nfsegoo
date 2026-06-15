'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Copy,
  Database,
  Eye,
  Filter,
  Mail,
  RefreshCw,
  Search,
  Server,
  Terminal,
  X,
} from 'lucide-react';

type LogItem = {
  id: string;
  level: 'INFO' | 'ERRO' | 'ALERTA' | 'DEBUG';
  action: string;
  message: string;
  details?: string | null;
  module?: string | null;
  traceId?: string | null;
  userId?: string | null;
  requestPath?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  debugHint?: string | null;
  createdAt: string;
  empresa?: { razaoSocial?: string | null } | null;
  venda?: { id: string; status: string } | null;
};

type DiagnosticsCheck = {
  id: string;
  label: string;
  status: 'OK' | 'ALERTA' | 'ERRO';
  durationMs?: number | null;
  message: string;
  details?: any;
  hint?: string | null;
};

const levelOptions = ['ALL', 'INFO', 'ALERTA', 'ERRO', 'DEBUG'];
const periodOptions = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
];

function levelStyle(level: string) {
  if (level === 'ERRO') return 'bg-red-50 text-red-700 border-red-200';
  if (level === 'ALERTA') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (level === 'DEBUG') return 'bg-slate-100 text-slate-500 border-slate-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

function levelIcon(level: string) {
  if (level === 'ERRO') return <AlertTriangle size={17} className="text-red-500" />;
  if (level === 'ALERTA') return <AlertTriangle size={17} className="text-amber-500" />;
  if (level === 'DEBUG') return <Terminal size={17} className="text-slate-500" />;
  return <CheckCircle size={17} className="text-emerald-500" />;
}

function diagnosticIcon(id: string) {
  if (id.includes('smtp') || id.includes('email')) return Mail;
  if (id.includes('database')) return Database;
  return Server;
}

function truncate(value?: string | null, size = 64) {
  if (!value) return '-';
  return value.length > size ? `${value.slice(0, size)}...` : value;
}

export default function SystemLogs() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsCheck[]>([]);
  const [stats, setStats] = useState<any>({});
  const [modules, setModules] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('ALL');
  const [moduleFilter, setModuleFilter] = useState('ALL');
  const [period, setPeriod] = useState('24h');
  const [includeDebug, setIncludeDebug] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [traceFilter, setTraceFilter] = useState('');

  const traceEvents = useMemo(() => {
    if (!selectedLog?.traceId) return [];
    return logs
      .filter((log) => log.traceId === selectedLog.traceId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [logs, selectedLog]);

  const carregar = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const params = new URLSearchParams({
      limit: '120',
      period,
      level,
      module: moduleFilter,
      debug: includeDebug ? 'true' : 'false',
      errorsOnly: errorsOnly ? 'true' : 'false',
    });

    if (search.trim()) params.set('search', search.trim());
    if (traceFilter.trim()) params.set('traceId', traceFilter.trim());

    try {
      const response = await fetch(`/api/admin/logs?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await response.json();
      if (Array.isArray(data.data)) setLogs(data.data);
      setStats(data.stats || {});
      setModules(data.filters?.modules || []);
    } finally {
      setLoading(false);
    }
  };

  const carregarDiagnostico = async () => {
    setDiagnosticsLoading(true);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch('/api/admin/logs/diagnostics', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await response.json();
      setDiagnostics(Array.isArray(data.checks) ? data.checks : []);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, [level, moduleFilter, period, includeDebug, errorsOnly, traceFilter]);

  useEffect(() => {
    carregarDiagnostico();
  }, []);

  const statCards = [
    { label: 'Erros 24h', value: stats.errors24h || 0, icon: AlertTriangle, tone: 'text-red-600 bg-red-50 border-red-100' },
    { label: 'Alertas 24h', value: stats.alerts24h || 0, icon: Activity, tone: 'text-amber-600 bg-amber-50 border-amber-100' },
    { label: 'E-mails enviados', value: stats.emailSuccess24h || 0, icon: Mail, tone: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
    { label: 'Falhas SMTP', value: stats.emailErrors24h || 0, icon: Server, tone: 'text-rose-600 bg-rose-50 border-rose-100' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
                <Terminal size={22} />
              </div>
              <div>
                <p className="text-xs font-black uppercase text-blue-600">Bancada tecnica</p>
                <h1 className="text-3xl font-black text-slate-950">Logs e diagnostico</h1>
              </div>
            </div>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Rastreie fluxos internos, falhas de e-mail, APIs fiscais e retornos uteis para suporte.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={carregarDiagnostico}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <Server size={17} className={diagnosticsLoading ? 'animate-spin' : ''} />
              Diagnosticar
            </button>
            <button
              onClick={carregar}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
            >
              <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-slate-400">{card.label}</p>
                    <p className="mt-1 text-3xl font-black text-slate-950">{card.value}</p>
                  </div>
                  <div className={`flex h-11 w-11 items-center justify-center rounded-lg border ${card.tone}`}>
                    <Icon size={20} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_390px]">
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-64 flex-1">
                  <Search className="absolute left-3 top-3 text-slate-400" size={18} />
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:bg-white"
                    placeholder="Buscar por mensagem, acao, empresa ou payload..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') carregar();
                    }}
                  />
                </div>

                <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700">
                  {periodOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>

                <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700">
                  {levelOptions.map((item) => <option key={item} value={item}>{item === 'ALL' ? 'Todos niveis' : item}</option>)}
                </select>

                <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-700">
                  <option value="ALL">Todos modulos</option>
                  {modules.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>

                <button
                  onClick={() => setErrorsOnly((value) => !value)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-sm font-bold ${errorsOnly ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  <Filter size={16} />
                  So problemas
                </button>

                <button
                  onClick={() => setIncludeDebug((value) => !value)}
                  className={`rounded-lg border px-3 py-3 text-sm font-bold ${includeDebug ? 'border-slate-400 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  Debug
                </button>
              </div>

              {traceFilter && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                  <span>Filtrando rastreio: <strong>{traceFilter}</strong></span>
                  <button onClick={() => setTraceFilter('')} className="font-bold hover:underline">Limpar</button>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="max-h-[640px] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="p-3">Nivel</th>
                      <th className="p-3">Hora</th>
                      <th className="p-3">Modulo</th>
                      <th className="p-3">Acao</th>
                      <th className="p-3">Mensagem</th>
                      <th className="p-3">Tempo</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLog(log)}
                        className={`cursor-pointer border-b border-slate-100 hover:bg-blue-50 ${selectedLog?.id === log.id ? 'bg-blue-50' : ''}`}
                      >
                        <td className="p-3">
                          <div className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-black ${levelStyle(log.level)}`}>
                            {levelIcon(log.level)}
                            {log.level}
                          </div>
                        </td>
                        <td className="p-3 font-mono text-xs text-slate-500">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </td>
                        <td className="p-3">
                          <span className="rounded bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{log.module || 'SISTEMA'}</span>
                        </td>
                        <td className="p-3 font-mono text-xs font-bold text-slate-700">{truncate(log.action, 34)}</td>
                        <td className="max-w-sm p-3 text-slate-600">
                          <div className="truncate">{log.message}</div>
                          {log.debugHint && <div className="mt-1 truncate text-xs text-amber-700">{log.debugHint}</div>}
                        </td>
                        <td className="p-3 text-xs text-slate-500">
                          {typeof log.durationMs === 'number' ? `${log.durationMs}ms` : '-'}
                        </td>
                        <td className="p-3 text-right">
                          <button className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-white">
                            <Eye size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!logs.length && (
                      <tr>
                        <td colSpan={7} className="p-10 text-center text-sm text-slate-500">
                          Nenhum evento encontrado para os filtros atuais.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-black uppercase text-blue-600">Health check</p>
                  <h2 className="text-lg font-black text-slate-900">Conexoes do SaaS</h2>
                </div>
                <button onClick={carregarDiagnostico} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50">
                  <RefreshCw size={16} className={diagnosticsLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              <div className="space-y-2">
                {diagnostics.map((check) => {
                  const Icon = diagnosticIcon(check.id);
                  return (
                    <div key={check.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${check.status === 'OK' ? 'bg-emerald-50 text-emerald-600' : check.status === 'ALERTA' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
                          <Icon size={17} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-black text-slate-800">{check.label}</p>
                            <span className={`rounded-full px-2 py-1 text-[10px] font-black ${check.status === 'OK' ? 'bg-emerald-100 text-emerald-700' : check.status === 'ALERTA' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                              {check.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-500">{check.message}</p>
                          {check.hint && <p className="mt-2 rounded bg-amber-50 p-2 text-xs font-medium text-amber-800">{check.hint}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!diagnostics.length && (
                  <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                    Clique em diagnosticar para verificar banco, SMTP e ultimas falhas.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-slate-200 bg-white/70 p-4 text-sm text-slate-500 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Eye size={17} />
                </div>
                <div>
                  <p className="font-black text-slate-800">Detalhe sob demanda</p>
                  <p className="mt-1 leading-relaxed">
                    Clique no olho de qualquer evento para abrir logs, payload e linha do tempo em uma janela lateral.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {selectedLog && (
          <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-[2px]" onClick={() => setSelectedLog(null)}>
            <aside
              className="h-full w-full max-w-2xl overflow-hidden bg-slate-950 text-slate-300 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex h-full flex-col">
                <div className="border-b border-slate-800 bg-slate-900/80 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">Evento selecionado</p>
                      <h2 className="mt-1 truncate text-xl font-black text-white">{selectedLog.action}</h2>
                      <p className="mt-2 text-sm text-slate-400">{selectedLog.message}</p>
                    </div>
                    <button onClick={() => setSelectedLog(null)} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
                      <X size={18} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 space-y-4 overflow-auto p-5 text-xs">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    <InfoLine label="ID" value={selectedLog.id} />
                    <InfoLine label="Data" value={new Date(selectedLog.createdAt).toLocaleString()} />
                    <InfoLine label="Modulo" value={selectedLog.module || 'SISTEMA'} />
                    <InfoLine label="Status HTTP" value={selectedLog.statusCode ? String(selectedLog.statusCode) : '-'} />
                    <InfoLine label="Empresa" value={selectedLog.empresa?.razaoSocial || 'N/A'} />
                    <InfoLine label="Venda" value={selectedLog.venda?.id ? selectedLog.venda.id.slice(0, 8) : 'N/A'} />
                  </div>

                  {selectedLog.traceId && (
                    <div className="rounded-xl border border-blue-900 bg-blue-950/50 p-4">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-black text-blue-200">Rastreio</span>
                        <div className="flex gap-3">
                          <button onClick={() => navigator.clipboard.writeText(selectedLog.traceId || '')} className="inline-flex items-center gap-1 font-bold text-blue-200 hover:text-white"><Copy size={14} /> copiar</button>
                          <button onClick={() => { setTraceFilter(selectedLog.traceId || ''); setSelectedLog(null); }} className="font-bold text-blue-200 hover:text-white">ver fluxo</button>
                        </div>
                      </div>
                      <p className="break-all font-mono text-blue-100">{selectedLog.traceId}</p>
                    </div>
                  )}

                  {selectedLog.debugHint && (
                    <div className="rounded-xl border border-amber-700 bg-amber-950/40 p-4 text-amber-100">
                      <p className="mb-1 font-black">Diagnostico sugerido</p>
                      <p className="leading-relaxed">{selectedLog.debugHint}</p>
                    </div>
                  )}

                  {traceEvents.length > 1 && (
                    <div>
                      <p className="mb-2 font-black text-white">Linha do tempo do fluxo</p>
                      <div className="space-y-2">
                        {traceEvents.map((event) => (
                          <div key={event.id} className="flex gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
                            <Clock size={14} className="mt-0.5 text-slate-500" />
                            <div>
                              <p className="font-mono text-[11px] text-slate-400">{new Date(event.createdAt).toLocaleTimeString()}</p>
                              <p className="font-bold text-slate-100">{event.action}</p>
                              <p className="text-slate-400">{event.message}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-800 bg-black/40 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="font-black text-blue-300">// Payload / detalhes</p>
                      <button onClick={() => navigator.clipboard.writeText(selectedLog.details || '')} className="inline-flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-white">
                        <Copy size={14} />
                        copiar
                      </button>
                    </div>
                    <pre className="max-h-[44vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-green-300">
                      {selectedLog.details || 'Nenhum detalhe adicional.'}
                    </pre>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900 p-2">
      <p className="text-[10px] font-black uppercase text-slate-500">{label}</p>
      <p className="mt-1 truncate text-slate-200">{value}</p>
    </div>
  );
}
