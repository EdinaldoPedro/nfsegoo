'use client';

import { useEffect, useState } from 'react';
import { Search, Edit, Save, X, ChevronLeft, ChevronRight, CheckCircle, XCircle, Briefcase, FileCode2, ShieldCheck, Percent } from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';

const inputBase = 'w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100';

export default function AdminCnaes() {
  const dialog = useDialog();
  const [cnaes, setCnaes] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [termoBusca, setTermoBusca] = useState('');
  const limit = 10;
  const [editing, setEditing] = useState<any>(null);

  useEffect(() => {
    const delayDebounce = setTimeout(() => carregar(page, termoBusca), 500);
    return () => clearTimeout(delayDebounce);
  }, [page, termoBusca]);

  const carregar = (pagina: number, busca: string) => {
    fetch(`/api/admin/cnaes?page=${pagina}&limit=${limit}&search=${busca}`, { headers: {} })
      .then(r => r.json())
      .then(res => {
        setCnaes(res.data || []);
        setTotalPages(res.meta?.totalPages || 1);
        setTotalItems(res.meta?.total || 0);
      })
      .catch(err => console.error('Erro ao carregar CNAEs:', err));
  };

  const handleSave = async () => {
    const payloadToSave = { ...editing, aliquotaCrsf: editing.retemCrsf ? editing.aliquotaCrsf : null, aliquotaIr: editing.retemIr ? editing.aliquotaIr : null };
    const res = await fetch('/api/admin/cnaes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadToSave) });
    if (res.ok) {
      setEditing(null);
      carregar(page, termoBusca);
      dialog.showAlert({ type: 'success', description: 'Tributação atualizada!' });
    } else {
      dialog.showAlert({ type: 'danger', description: 'Erro ao salvar.' });
    }
  };

  const handleToggleRetencao = (campoBooleano: string, campoAliquota: string, valorPadrao: number) => {
    setEditing((prev: any) => {
      const isAtivando = !prev[campoBooleano];
      return { ...prev, [campoBooleano]: isAtivando, [campoAliquota]: isAtivando ? valorPadrao : null };
    });
  };

  const comTribNacional = cnaes.filter(c => c.codigoTributacaoNacional).length;
  const comRetencao = cnaes.filter(c => c.temRetencaoInss || c.retemCrsf || c.retemIr).length;

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">Base nacional</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Tabela Nacional de CNAEs</h1>
          <p className="mt-2 max-w-3xl text-slate-500">Configure código de tributação nacional, NBS e retenções aplicáveis por atividade.</p>
        </div>
        <div className="relative w-full lg:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input placeholder="Buscar CNAE ou descrição..." className={`${inputBase} pl-10`} value={termoBusca} onChange={e => { setTermoBusca(e.target.value); setPage(1); }} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Briefcase className="text-blue-600" /><p className="mt-3 text-3xl font-black text-slate-950">{totalItems}</p><p className="text-xs font-bold uppercase text-slate-400">Atividades nacionais</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><FileCode2 className="text-purple-600" /><p className="mt-3 text-3xl font-black text-slate-950">{comTribNacional}</p><p className="text-xs font-bold uppercase text-slate-400">Com trib. nacional na página</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><ShieldCheck className="text-emerald-600" /><p className="mt-3 text-3xl font-black text-slate-950">{comRetencao}</p><p className="text-xs font-bold uppercase text-slate-400">Com retenções na página</p></div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b bg-slate-50 px-6 py-5">
              <div><h3 className="text-xl font-black text-slate-950">Configurar tributação</h3><p className="text-sm text-slate-500">Ajuste regras nacionais e retenções para este CNAE.</p></div>
              <button onClick={() => setEditing(null)} className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-red-500"><X size={20} /></button>
            </div>
            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="mb-1 block text-xs font-black uppercase text-slate-400">CNAE bloqueado</label>
                <input className={`${inputBase} bg-white font-mono font-black text-slate-700`} value={editing.codigo} disabled />
                <p className="mt-2 text-sm leading-relaxed text-slate-500">{editing.descricao}</p>
              </div>

              <div>
                <h4 className="mb-3 text-sm font-black uppercase text-slate-500">Padrão nacional</h4>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div><label className="mb-1 block text-xs font-black uppercase text-slate-500">Item LC 116/03</label><input className={inputBase} value={editing.itemLc || ''} onChange={e => setEditing({ ...editing, itemLc: e.target.value })} placeholder="Ex: 1.07" /></div>
                  <div><label className="mb-1 block text-xs font-black uppercase text-slate-500">Cód. Trib. Nacional</label><input className={inputBase} value={editing.codigoTributacaoNacional || ''} onChange={e => setEditing({ ...editing, codigoTributacaoNacional: e.target.value })} placeholder="Ex: 01.07.01" /></div>
                  <div><label className="mb-1 block text-xs font-black uppercase text-slate-500">Código NBS</label><input className={inputBase} value={editing.codigoNbs || ''} onChange={e => setEditing({ ...editing, codigoNbs: e.target.value })} placeholder="Ex: 123456789" /></div>
                </div>
              </div>

              <div>
                <h4 className="mb-3 text-sm font-black uppercase text-slate-500">Regras de retenção</h4>
                <div className="space-y-3">
                  <button type="button" onClick={() => setEditing({ ...editing, temRetencaoInss: !editing.temRetencaoInss })} className={`w-full rounded-2xl border p-4 text-left transition ${editing.temRetencaoInss ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}><p className="font-black">Reter INSS?</p><p className="text-sm opacity-75">11% calculado automaticamente no app.</p></button>
                  <div className={`rounded-2xl border p-4 ${editing.retemCrsf ? 'border-purple-200 bg-purple-50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center justify-between gap-4"><button type="button" onClick={() => handleToggleRetencao('retemCrsf', 'aliquotaCrsf', 4.65)} className="text-left"><p className="font-black text-slate-800">Reter CRSF?</p><p className="text-sm text-slate-500">PIS/COFINS/CSLL.</p></button>{editing.retemCrsf && <div className="relative w-28"><Percent className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} /><input type="number" step="0.01" className={`${inputBase} pl-8 text-center`} value={editing.aliquotaCrsf || ''} onChange={e => setEditing({ ...editing, aliquotaCrsf: e.target.value })} /></div>}</div>
                  </div>
                  <div className={`rounded-2xl border p-4 ${editing.retemIr ? 'border-orange-200 bg-orange-50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center justify-between gap-4"><button type="button" onClick={() => handleToggleRetencao('retemIr', 'aliquotaIr', 1.50)} className="text-left"><p className="font-black text-slate-800">Reter IR?</p><p className="text-sm text-slate-500">Imposto de renda retido na fonte.</p></button>{editing.retemIr && <div className="relative w-28"><Percent className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} /><input type="number" step="0.01" className={`${inputBase} pl-8 text-center`} value={editing.aliquotaIr || ''} onChange={e => setEditing({ ...editing, aliquotaIr: e.target.value })} /></div>}</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-slate-50 p-5"><button onClick={() => setEditing(null)} className="rounded-xl px-5 py-3 text-sm font-bold text-slate-600 hover:bg-white">Cancelar</button><button onClick={handleSave} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700"><Save size={18} /> Salvar alterações</button></div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs font-black uppercase text-slate-400">
            <tr><th className="p-4">CNAE</th><th className="p-4">Descrição</th><th className="p-4 text-center">Trib. Nac.</th><th className="p-4 text-center">INSS</th><th className="p-4 text-center">CRSF</th><th className="p-4 text-center">IR</th><th className="p-4 text-right">Ação</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cnaes.length === 0 ? <tr><td colSpan={7} className="p-12 text-center text-slate-400">Nenhum CNAE encontrado.</td></tr> : cnaes.map(cnae => (
              <tr key={cnae.id} className="transition hover:bg-slate-50">
                <td className="p-4 font-mono font-black text-slate-800">{cnae.codigo}</td>
                <td className="max-w-[320px] truncate p-4 text-xs font-medium text-slate-600" title={cnae.descricao}>{cnae.descricao}</td>
                <td className="p-4 text-center">{cnae.codigoTributacaoNacional ? <span className="rounded-full border border-blue-200 bg-blue-100 px-3 py-1 text-[10px] font-black text-blue-800">{cnae.codigoTributacaoNacional}</span> : <span className="text-slate-300">-</span>}</td>
                <td className="p-4 text-center">{cnae.temRetencaoInss ? <CheckCircle size={17} className="mx-auto text-emerald-500" /> : <XCircle size={17} className="mx-auto text-slate-200" />}</td>
                <td className="p-4 text-center">{cnae.retemCrsf ? <span className="text-xs font-black text-purple-600">{Number(cnae.aliquotaCrsf).toFixed(2)}%</span> : <XCircle size={17} className="mx-auto text-slate-200" />}</td>
                <td className="p-4 text-center">{cnae.retemIr ? <span className="text-xs font-black text-orange-600">{Number(cnae.aliquotaIr).toFixed(2)}%</span> : <XCircle size={17} className="mx-auto text-slate-200" />}</td>
                <td className="p-4 text-right"><button onClick={() => setEditing(cnae)} className="rounded-xl p-2 text-blue-600 hover:bg-blue-50"><Edit size={18} /></button></td>
              </tr>
            ))}
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
