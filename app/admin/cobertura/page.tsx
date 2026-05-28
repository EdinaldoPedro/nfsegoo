'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { MapPin, Plus, Trash2, ChevronLeft, ChevronRight, Edit, Search, X, Save, Filter, Globe2, Layers, CheckCircle2 } from 'lucide-react';

const STATUS_OPTS = [
  { val: 0, label: 'Integrado', detail: 'Operação liberada', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  { val: 1, label: 'Beta', detail: 'Monitorar emissão', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  { val: 2, label: 'Em Integração', detail: 'Em implantação', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  { val: 3, label: 'Em Desenvolvimento', detail: 'Backlog técnico', color: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' },
];

const inputBase = 'rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100';

export default function GestaoCobertura() {
  const [cidades, setCidades] = useState<any[]>([]);
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
      status: filtroStatus
    });

    fetch(`/api/admin/cobertura?${params.toString()}`)
      .then(r => r.json())
      .then(res => {
        setCidades(res.data || []);
        setTotalPages(res.meta?.totalPages || 1);
      });
  }, [busca, filtroRegime, filtroUF, filtroStatus]);

  useEffect(() => { carregar(page); }, [page, carregar]);

  const salvar = async () => {
    if (!form.uf || !form.nome) return alert('Preencha UF e Nome.');
    setLoading(true);
    const res = await fetch('/api/admin/cobertura', {
      method: form.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
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
  const limparFiltros = () => { setBusca(''); setFiltroUF(''); setFiltroRegime(''); setFiltroStatus(''); setPage(1); };

  const resumo = useMemo(() => ({
    integradas: cidades.filter(c => c.status === 0).length,
    beta: cidades.filter(c => c.status === 1).length,
    regimes: new Set(cidades.map(c => c.regime)).size,
  }), [cidades]);

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">Operação fiscal</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Mapa de Cobertura</h1>
          <p className="mt-2 max-w-3xl text-slate-500">Controle os municípios disponíveis por regime, status de integração e fase de implantação.</p>
        </div>
        <button onClick={salvar} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60">
          {form.id ? <Save size={18} /> : <Plus size={18} />} {form.id ? 'Salvar cidade' : 'Adicionar cidade'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Globe2 className="text-blue-600" /><p className="mt-3 text-3xl font-black text-slate-950">{cidades.length}</p><p className="text-xs font-bold uppercase text-slate-400">Itens nesta página</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><CheckCircle2 className="text-emerald-600" /><p className="mt-3 text-3xl font-black text-slate-950">{resumo.integradas}</p><p className="text-xs font-bold uppercase text-slate-400">Integrados visíveis</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Layers className="text-purple-600" /><p className="mt-3 text-3xl font-black text-slate-950">{resumo.regimes}</p><p className="text-xs font-bold uppercase text-slate-400">Regimes na seleção</p></div>
      </div>

      <div className={`rounded-2xl border p-5 shadow-sm ${form.id ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-950">{form.id ? <Edit size={18} /> : <Plus size={18} />} {form.id ? 'Editando município' : 'Nova cobertura'}</h2>
          {form.id && <button onClick={cancelarEdicao} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-600 ring-1 ring-slate-200">Cancelar edição</button>}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <div><label className="mb-1 block text-xs font-black uppercase text-slate-500">UF</label><input className={`${inputBase} w-full uppercase`} maxLength={2} value={form.uf} onChange={e => setForm({ ...form, uf: e.target.value.toUpperCase() })} placeholder="PE" /></div>
          <div className="md:col-span-2"><label className="mb-1 block text-xs font-black uppercase text-slate-500">Cidade</label><input className={`${inputBase} w-full`} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Recife" /></div>
          <div><label className="mb-1 block text-xs font-black uppercase text-slate-500">Regime</label><select className={`${inputBase} w-full`} value={form.regime} onChange={e => setForm({ ...form, regime: e.target.value })}><option value="SN">Simples Nacional</option><option value="LP">Lucro Presumido</option></select></div>
          <div><label className="mb-1 block text-xs font-black uppercase text-slate-500">Status</label><select className={`${inputBase} w-full`} value={form.status} onChange={e => setForm({ ...form, status: parseInt(e.target.value) })}>{STATUS_OPTS.map(s => <option key={s.val} value={s.val}>{s.label}</option>)}</select></div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input className={`${inputBase} w-full pl-10`} placeholder="Pesquisar município..." value={busca} onChange={e => { setBusca(e.target.value); setPage(1); }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <select className={inputBase} value={filtroUF} onChange={e => { setFiltroUF(e.target.value); setPage(1); }}><option value="">Todas UFs</option>{['SP','RJ','MG','RS','PR','PE','BA','SC','GO'].map(uf => <option key={uf} value={uf}>{uf}</option>)}</select>
              <select className={inputBase} value={filtroRegime} onChange={e => { setFiltroRegime(e.target.value); setPage(1); }}><option value="">Todos regimes</option><option value="SN">Simples Nacional</option><option value="LP">Lucro Presumido</option></select>
              <select className={inputBase} value={filtroStatus} onChange={e => { setFiltroStatus(e.target.value); setPage(1); }}><option value="">Todos status</option>{STATUS_OPTS.map(s => <option key={s.val} value={s.val}>{s.label}</option>)}</select>
              {(busca || filtroUF || filtroRegime || filtroStatus) && <button onClick={limparFiltros} className="inline-flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600"><X size={14} /> Limpar</button>}
            </div>
          </div>
        </div>

        <table className="w-full text-left text-sm">
          <thead className="border-b bg-white text-xs font-black uppercase text-slate-400">
            <tr><th className="p-4">Regime</th><th className="p-4">UF</th><th className="p-4">Cidade</th><th className="p-4">Status</th><th className="p-4 text-right">Ação</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cidades.map(c => {
              const status = STATUS_OPTS.find(s => s.val === c.status) || STATUS_OPTS[3];
              return (
                <tr key={c.id} className="transition hover:bg-slate-50">
                  <td className="p-4"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{c.regime}</span></td>
                  <td className="p-4 font-black text-slate-700">{c.uf}</td>
                  <td className="p-4 font-semibold text-slate-800">{c.nome}</td>
                  <td className="p-4"><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black ${status.color}`}><span className={`h-2 w-2 rounded-full ${status.dot}`} />{status.label}</span><p className="mt-1 text-xs text-slate-400">{status.detail}</p></td>
                  <td className="p-4"><div className="flex justify-end gap-2"><button onClick={() => editar(c)} className="rounded-xl p-2 text-blue-600 hover:bg-blue-50"><Edit size={18} /></button><button onClick={() => deletar(c.id)} className="rounded-xl p-2 text-red-500 hover:bg-red-50"><Trash2 size={18} /></button></div></td>
                </tr>
              );
            })}
            {cidades.length === 0 && <tr><td colSpan={5} className="p-10 text-center text-slate-400">Nenhuma cidade encontrada com estes filtros.</td></tr>}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t bg-slate-50 p-4">
          <span className="text-sm font-medium text-slate-500">Página {page} de {totalPages}</span>
          <div className="flex gap-2"><button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded-xl border bg-white p-2 text-slate-600 disabled:opacity-50"><ChevronLeft size={16} /></button><button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-xl border bg-white p-2 text-slate-600 disabled:opacity-50"><ChevronRight size={16} /></button></div>
        </div>
      </div>
    </div>
  );
}
