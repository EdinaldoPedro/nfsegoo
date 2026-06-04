'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Edit,
  Filter,
  Globe2,
  Layers,
  MapPin,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';

const STATUS_OPTS = [
  { val: 0, label: 'Integrado', detail: 'Operação liberada', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  { val: 1, label: 'Beta', detail: 'Monitorar emissão', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  { val: 2, label: 'Em Integração', detail: 'Em implantação', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  { val: 3, label: 'Em Desenvolvimento', detail: 'Backlog técnico', color: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' },
];

const REGIME_LABELS: Record<string, string> = {
  SN: 'Simples Nacional',
  LP: 'Lucro Presumido',
};

const inputBase = 'rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100';

export default function GestaoCobertura() {
  const [cidades, setCidades] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>({});
  const [form, setForm] = useState({ id: '', uf: '', nome: '', status: 2, regime: 'SN' });
  const [busca, setBusca] = useState('');
  const [filtroRegime, setFiltroRegime] = useState('');
  const [filtroUF, setFiltroUF] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 10;

  const carregar = useCallback((pagina: number) => {
    const params = new URLSearchParams({
      page: pagina.toString(),
      limit: limit.toString(),
      search: busca,
      regime: filtroRegime,
      uf: filtroUF,
      status: filtroStatus,
    });

    fetch(`/api/admin/cobertura?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        setCidades(res.data || []);
        setMeta(res.meta || {});
        setTotalPages(res.meta?.totalPages || 1);
      });
  }, [busca, filtroRegime, filtroUF, filtroStatus]);

  useEffect(() => {
    carregar(page);
  }, [page, carregar]);

  const salvar = async () => {
    if (!form.uf || !form.nome) return alert('Preencha UF e cidade.');
    setLoading(true);
    const res = await fetch('/api/admin/cobertura', {
      method: form.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    if (res.ok) {
      cancelarEdicao();
      carregar(page);
    } else {
      alert('Erro ao salvar.');
    }
    setLoading(false);
  };

  const deletar = async (id: string) => {
    if (!confirm('Remover cidade?')) return;
    await fetch(`/api/admin/cobertura?id=${id}`, { method: 'DELETE' });
    carregar(page);
  };

  const editar = (cidade: any) => {
    setForm({ id: cidade.id, uf: cidade.uf, nome: cidade.nome, status: cidade.status, regime: cidade.regime || 'SN' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelarEdicao = () => setForm({ id: '', uf: '', nome: '', status: 2, regime: 'SN' });

  const limparFiltros = () => {
    setBusca('');
    setFiltroUF('');
    setFiltroRegime('');
    setFiltroStatus('');
    setPage(1);
  };

  const ufsDisponiveis = meta.ufs || [];
  const regimesDisponiveis = meta.regimes || [];
  const statusCounts = meta.statusCounts || {};

  const resumo = useMemo(() => ({
    total: meta.totalGeral ?? cidades.length,
    filtrados: meta.total ?? cidades.length,
    integradas: statusCounts['0'] || 0,
    beta: statusCounts['1'] || 0,
    ufs: ufsDisponiveis.length,
    regimes: regimesDisponiveis.length,
  }), [cidades.length, meta.total, meta.totalGeral, regimesDisponiveis.length, statusCounts, ufsDisponiveis.length]);

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-3xl bg-slate-950 text-white shadow-sm">
        <div className="relative flex flex-col justify-between gap-6 p-8 lg:flex-row lg:items-end">
          <div className="absolute right-8 top-6 h-40 w-40 rounded-full border border-white/10" />
          <div className="relative">
            <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-300">Operação fiscal</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">Mapa de Cobertura</h1>
            <p className="mt-2 max-w-3xl text-slate-300">
              Controle os municípios cadastrados por UF, regime, status de integração e fase de implantação.
            </p>
          </div>
          <button onClick={salvar} disabled={loading} className="relative inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60">
            {form.id ? <Save size={18} /> : <Plus size={18} />} {form.id ? 'Salvar cidade' : 'Adicionar cidade'}
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Globe2 className="text-blue-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">{resumo.total}</p>
          <p className="text-xs font-bold uppercase text-slate-400">Municípios cadastrados</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <CheckCircle2 className="text-emerald-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">{resumo.integradas}</p>
          <p className="text-xs font-bold uppercase text-emerald-600">Integrados</p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
          <MapPin className="text-blue-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">{resumo.ufs}</p>
          <p className="text-xs font-bold uppercase text-blue-600">UFs cadastradas</p>
        </div>
        <div className="rounded-2xl border border-purple-200 bg-purple-50 p-5 shadow-sm">
          <Layers className="text-purple-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">{resumo.regimes}</p>
          <p className="text-xs font-bold uppercase text-purple-600">Regimes cadastrados</p>
        </div>
      </section>

      <section className={`rounded-2xl border p-5 shadow-sm ${form.id ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">
              {form.id ? <Edit size={18} /> : <Plus size={18} />} {form.id ? 'Editando município' : 'Nova cobertura'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">Cadastre a disponibilidade do município por regime e fase operacional.</p>
          </div>
          {form.id && <button onClick={cancelarEdicao} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-600 ring-1 ring-slate-200">Cancelar edição</button>}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-black uppercase text-slate-500">UF</label>
            <input className={`${inputBase} w-full uppercase`} maxLength={2} value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} placeholder="PE" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-black uppercase text-slate-500">Cidade</label>
            <input className={`${inputBase} w-full`} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Recife" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-black uppercase text-slate-500">Regime</label>
            <select className={`${inputBase} w-full`} value={form.regime} onChange={(e) => setForm({ ...form, regime: e.target.value })}>
              <option value="SN">Simples Nacional</option>
              <option value="LP">Lucro Presumido</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-black uppercase text-slate-500">Status</label>
            <select className={`${inputBase} w-full`} value={form.status} onChange={(e) => setForm({ ...form, status: parseInt(e.target.value) })}>
              {STATUS_OPTS.map((s) => <option key={s.val} value={s.val}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input className={`${inputBase} w-full pl-10`} placeholder="Pesquisar município ou UF..." value={busca} onChange={(e) => { setBusca(e.target.value); setPage(1); }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <select className={inputBase} value={filtroUF} onChange={(e) => { setFiltroUF(e.target.value); setPage(1); }}>
                <option value="">Todas UFs cadastradas</option>
                {ufsDisponiveis.map((uf: string) => <option key={uf} value={uf}>{uf}</option>)}
              </select>
              <select className={inputBase} value={filtroRegime} onChange={(e) => { setFiltroRegime(e.target.value); setPage(1); }}>
                <option value="">Todos regimes</option>
                {regimesDisponiveis.map((regime: string) => <option key={regime} value={regime}>{REGIME_LABELS[regime] || regime}</option>)}
              </select>
              <select className={inputBase} value={filtroStatus} onChange={(e) => { setFiltroStatus(e.target.value); setPage(1); }}>
                <option value="">Todos status</option>
                {STATUS_OPTS.map((s) => <option key={s.val} value={s.val}>{s.label}</option>)}
              </select>
              {(busca || filtroUF || filtroRegime || filtroStatus) && (
                <button onClick={limparFiltros} className="inline-flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">
                  <X size={14} /> Limpar
                </button>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Filter size={14} />
            <span><strong className="text-slate-800">{resumo.filtrados}</strong> resultado(s) nos filtros atuais.</span>
            {filtroUF && <span className="rounded-full bg-blue-100 px-2 py-1 font-bold text-blue-700">UF {filtroUF}</span>}
            {filtroRegime && <span className="rounded-full bg-purple-100 px-2 py-1 font-bold text-purple-700">{REGIME_LABELS[filtroRegime] || filtroRegime}</span>}
          </div>
        </div>

        <table className="w-full text-left text-sm">
          <thead className="border-b bg-white text-xs font-black uppercase text-slate-400">
            <tr>
              <th className="p-4">Regime</th>
              <th className="p-4">UF</th>
              <th className="p-4">Cidade</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cidades.map((cidade) => {
              const status = STATUS_OPTS.find((s) => s.val === cidade.status) || STATUS_OPTS[3];
              return (
                <tr key={cidade.id} className="transition hover:bg-slate-50">
                  <td className="p-4"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{cidade.regime}</span></td>
                  <td className="p-4 font-black text-slate-700">{cidade.uf}</td>
                  <td className="p-4 font-semibold text-slate-800">{cidade.nome}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black ${status.color}`}>
                      <span className={`h-2 w-2 rounded-full ${status.dot}`} />{status.label}
                    </span>
                    <p className="mt-1 text-xs text-slate-400">{status.detail}</p>
                  </td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => editar(cidade)} className="rounded-xl p-2 text-blue-600 hover:bg-blue-50"><Edit size={18} /></button>
                      <button onClick={() => deletar(cidade.id)} className="rounded-xl p-2 text-red-500 hover:bg-red-50"><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {cidades.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-slate-400">Nenhuma cidade encontrada com estes filtros.</td></tr>}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t bg-slate-50 p-4">
          <span className="text-sm font-medium text-slate-500">Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-xl border bg-white p-2 text-slate-600 disabled:opacity-50"><ChevronLeft size={16} /></button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-xl border bg-white p-2 text-slate-600 disabled:opacity-50"><ChevronRight size={16} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}
