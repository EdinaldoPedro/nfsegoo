'use client';

import { useEffect, useState } from 'react';
import { Search, Edit, Save, X, Plus, Trash2, MapPin, ChevronLeft, ChevronRight, Briefcase, Percent, FileCode2, Database } from 'lucide-react';
import SearchableSelect from '@/components/SearchableSelect';
import { useDialog } from '@/app/contexts/DialogContext';

const inputBase = 'w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100';

export default function TributacaoMunicipalPage() {
  const dialog = useDialog();
  const [lista, setLista] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [termoBusca, setTermoBusca] = useState('');
  const limit = 10;
  const [listaCnaes, setListaCnaes] = useState<any[]>([]);
  const [listaCidades, setListaCidades] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({
    id: '',
    cnae: '',
    codigoIbge: '',
    codigoTributacaoMunicipal: '',
    descricaoServicoMunicipal: '',
    aliquotaIss: '',
    exigeNbs: false
  });

  useEffect(() => {
    const delayDebounce = setTimeout(() => carregarRegras(page, termoBusca), 500);
    return () => clearTimeout(delayDebounce);
  }, [page, termoBusca]);

  useEffect(() => { carregarAuxiliares(); }, []);

  const carregarRegras = (pagina: number, busca: string = '') => {
    const token = localStorage.getItem('token');
    fetch(`/api/admin/tributacao-municipal?page=${pagina}&limit=${limit}&search=${busca}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(res => {
        setLista(res.data || []);
        setTotalPages(res.meta?.totalPages || 1);
        setTotalItems(res.meta?.total || 0);
      })
      .catch(err => console.error('Erro ao carregar regras:', err));
  };

  const carregarAuxiliares = async () => {
    const token = localStorage.getItem('token');
    fetch('/api/admin/cnaes?limit=1000', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(res => setListaCnaes(Array.isArray(res) ? res : (res.data || [])))
      .catch(() => setListaCnaes([]));

    fetch('/api/admin/empresas?limit=1000', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((res: any) => {
        const listaEmpresas = res.data || (Array.isArray(res) ? res : []);
        const cidadesMap = new Map();
        listaEmpresas.forEach((emp: any) => {
          if (emp.codigoIbge && emp.cidade) cidadesMap.set(emp.codigoIbge, { ibge: emp.codigoIbge, nome: `${emp.cidade}/${emp.uf}` });
        });
        setListaCidades(Array.from(cidadesMap.values()));
      })
      .catch(err => console.error('Erro ao carregar cidades', err));
  };

  const abrirNovo = () => {
    setEditing(null);
    setForm({ id: '', cnae: '', codigoIbge: '', codigoTributacaoMunicipal: '', descricaoServicoMunicipal: '', aliquotaIss: '', exigeNbs: false });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.cnae || !form.codigoIbge || !form.codigoTributacaoMunicipal) return dialog.showAlert('Preencha os campos obrigatórios.');
    const token = localStorage.getItem('token');
    const payload = { ...form, aliquotaIss: form.aliquotaIss ? parseFloat(form.aliquotaIss) : null };
    const res = await fetch('/api/admin/tributacao-municipal', {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      setModalOpen(false);
      carregarRegras(page, termoBusca);
      dialog.showAlert({ type: 'success', description: 'Regra salva com sucesso!' });
    } else {
      dialog.showAlert({ type: 'danger', description: data.error || 'Erro ao salvar.' });
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await dialog.showConfirm({ title: 'Excluir regra?', description: 'Esta ação removerá a configuração tributária para este município.', type: 'danger', confirmText: 'Sim, excluir' });
    if (!confirmed) return;
    const token = localStorage.getItem('token');
    await fetch(`/api/admin/tributacao-municipal?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    carregarRegras(page, termoBusca);
    dialog.showAlert({ type: 'success', description: 'Regra removida.' });
  };

  const getNomeCidade = (ibge: string) => listaCidades.find(c => c.ibge === ibge)?.nome || ibge;
  const opcoesCnae = listaCnaes.map(c => ({ value: c.codigo, label: c.codigo, subLabel: c.descricao }));
  const opcoesCidade = listaCidades.map(c => ({ value: c.ibge, label: c.nome, subLabel: `IBGE: ${c.ibge}` }));
  const comIss = lista.filter(item => item.aliquotaIss).length;
  const exigeNbs = lista.filter(item => item.exigeNbs).length;

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">Base municipal</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Tributação Municipal</h1>
          <p className="mt-2 max-w-3xl text-slate-500">Mapeie CNAE, município, código tributário municipal, alíquota ISS e exigência de NBS.</p>
        </div>
        <button onClick={abrirNovo} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"><Plus size={18} /> Nova regra</button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Database className="text-blue-600" /><p className="mt-3 text-3xl font-black text-slate-950">{totalItems}</p><p className="text-xs font-bold uppercase text-slate-400">Regras cadastradas</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Percent className="text-emerald-600" /><p className="mt-3 text-3xl font-black text-slate-950">{comIss}</p><p className="text-xs font-bold uppercase text-slate-400">Com ISS na página</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><FileCode2 className="text-purple-600" /><p className="mt-3 text-3xl font-black text-slate-950">{exigeNbs}</p><p className="text-xs font-bold uppercase text-slate-400">Exigem NBS na página</p></div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b bg-slate-50 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-950">Regras municipais</h2>
            <p className="text-sm text-slate-500">{totalItems} regras encontradas</p>
          </div>
          <div className="relative w-full lg:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input className={`${inputBase} pl-10`} placeholder="Pesquisar CNAE, cidade ou CTM..." value={termoBusca} onChange={e => { setTermoBusca(e.target.value); setPage(1); }} />
          </div>
        </div>

        <table className="w-full text-left text-sm">
          <thead className="border-b bg-white text-xs font-black uppercase text-slate-400">
            <tr><th className="p-4">CNAE</th><th className="p-4">Cidade</th><th className="p-4">Código Municipal</th><th className="p-4 text-center">ISS</th><th className="p-4 text-center">NBS</th><th className="p-4 text-right">Ações</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lista.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-slate-400">Nenhum registro encontrado.</td></tr> : lista.map(item => (
              <tr key={item.id} className="transition hover:bg-slate-50">
                <td className="p-4"><span className="font-mono font-black text-slate-800">{item.cnae}</span></td>
                <td className="p-4"><div className="flex flex-col"><span className="flex items-center gap-1 font-bold text-slate-700"><MapPin size={14} className="text-blue-500" />{getNomeCidade(item.codigoIbge)}</span><span className="pl-5 font-mono text-[10px] text-slate-400">IBGE: {item.codigoIbge}</span></div></td>
                <td className="p-4"><span className="rounded-full border border-orange-200 bg-orange-100 px-3 py-1 text-xs font-black text-orange-800">{item.codigoTributacaoMunicipal}</span></td>
                <td className="p-4 text-center">{item.aliquotaIss ? <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">{Number(item.aliquotaIss).toFixed(2)}%</span> : <span className="text-slate-300">-</span>}</td>
                <td className="p-4 text-center">{item.exigeNbs ? <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-black text-purple-700">Sim</span> : <span className="text-slate-300">-</span>}</td>
                <td className="p-4"><div className="flex justify-end gap-2"><button onClick={() => { setEditing(item); setForm({ ...item, aliquotaIss: item.aliquotaIss ? String(item.aliquotaIss) : '', exigeNbs: item.exigeNbs || false }); setModalOpen(true); }} className="rounded-xl p-2 text-blue-600 hover:bg-blue-50"><Edit size={18} /></button><button onClick={() => handleDelete(item.id)} className="rounded-xl p-2 text-red-500 hover:bg-red-50"><Trash2 size={18} /></button></div></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t bg-slate-50 p-4">
          <span className="text-sm font-medium text-slate-500">Página {page} de {totalPages}</span>
          <div className="flex gap-2"><button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded-xl border bg-white p-2 text-slate-600 disabled:opacity-50"><ChevronLeft size={16} /></button><button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-xl border bg-white p-2 text-slate-600 disabled:opacity-50"><ChevronRight size={16} /></button></div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-2xl overflow-visible rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b bg-slate-50 px-6 py-5">
              <div><h3 className="text-xl font-black text-slate-950">{editing ? 'Editar regra municipal' : 'Nova regra municipal'}</h3><p className="text-sm text-slate-500">Defina o cruzamento entre atividade, município e tributação.</p></div>
              <button onClick={() => setModalOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-red-500"><X size={20} /></button>
            </div>
            <div className="space-y-5 p-6">
              <div><label className="mb-1 block text-xs font-black uppercase text-slate-500">CNAE</label><SearchableSelect options={opcoesCnae} value={form.cnae} onChange={(val) => setForm({ ...form, cnae: val })} placeholder="Busque pelo código ou nome..." disabled={!!editing} /></div>
              <div><label className="mb-1 block text-xs font-black uppercase text-slate-500">Cidade</label><SearchableSelect options={opcoesCidade} value={form.codigoIbge} onChange={(val) => setForm({ ...form, codigoIbge: val })} placeholder="Busque pela cidade..." disabled={!!editing} /></div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div><label className="mb-1 block text-xs font-black uppercase text-blue-700">Cód. Municipal (CTM)</label><input className={`${inputBase} bg-blue-50`} value={form.codigoTributacaoMunicipal} onChange={e => setForm({ ...form, codigoTributacaoMunicipal: e.target.value })} placeholder="Ex: 010700188" /></div><div><label className="mb-1 block text-xs font-black uppercase text-emerald-700">Alíquota ISS (%)</label><input type="number" step="0.01" min="0" max="5" className={`${inputBase} bg-emerald-50`} value={form.aliquotaIss || ''} onChange={e => setForm({ ...form, aliquotaIss: e.target.value })} placeholder="Ex: 3.00" /></div></div>
              <div><label className="mb-1 block text-xs font-black uppercase text-slate-500">Descrição</label><textarea className={`${inputBase} resize-none`} value={form.descricaoServicoMunicipal || ''} onChange={e => setForm({ ...form, descricaoServicoMunicipal: e.target.value })} rows={3} /></div>
              <label className={`flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl border p-4 transition ${form.exigeNbs ? 'border-purple-300 bg-purple-50 text-purple-800' : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-purple-200 hover:bg-purple-50/40'}`}>
                <input
                  type="checkbox"
                  checked={form.exigeNbs}
                  onChange={(event) => setForm({ ...form, exigeNbs: event.target.checked })}
                  className="sr-only"
                />
                <div>
                  <p className="font-black">Prefeitura exige código NBS?</p>
                  <p className="text-sm opacity-80">Marque quando o município exigir NBS obrigatório para esta regra.</p>
                </div>
                <span className={`relative h-7 w-12 shrink-0 rounded-full border transition ${form.exigeNbs ? 'border-purple-500 bg-purple-600' : 'border-slate-300 bg-white'}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${form.exigeNbs ? 'left-6' : 'left-1'}`} />
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t bg-slate-50 p-5"><button onClick={() => setModalOpen(false)} className="rounded-xl px-5 py-3 text-sm font-bold text-slate-600 hover:bg-white">Cancelar</button><button onClick={handleSave} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700"><Save size={18} /> Salvar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
