'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Search,
  User,
  Loader2,
  Edit,
  Save,
  X,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Mail,
  Users,
  Globe,
  Briefcase,
  FileText,
  AlertTriangle,
  Hash
} from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';

const inputBase = 'w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100';

export default function BaseEmpresas() {
  const dialog = useDialog();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewType, setViewType] = useState<'PRESTADOR' | 'TOMADOR'>('PRESTADOR');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [termo, setTermo] = useState('');
  const [editingItem, setEditingItem] = useState<any>(null);

  useEffect(() => {
    const delayDebounce = setTimeout(() => carregarDados(page, termo, viewType), 500);
    return () => clearTimeout(delayDebounce);
  }, [page, termo, viewType]);

  const carregarDados = (pagina: number, busca: string, tipo: string) => {
    setLoading(true);
    fetch(`/api/admin/empresas?page=${pagina}&limit=10&search=${busca}&type=${tipo}`)
      .then(r => r.json())
      .then(res => {
        setItems(res.data || []);
        setTotalPages(res.meta?.totalPages || 1);
        setTotalItems(res.meta?.total || 0);
      })
      .finally(() => setLoading(false));
  };

  const handleSave = async () => {
    try {
      const res = await fetch('/api/admin/empresas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingItem)
      });

      if (res.ok) {
        await dialog.showAlert({ type: 'success', title: 'Sucesso', description: 'Cadastro atualizado!' });
        setEditingItem(null);
        carregarDados(page, termo, viewType);
      } else {
        const data = await res.json().catch(() => ({}));
        dialog.showAlert({ type: 'danger', description: data.error || 'Erro ao salvar.' });
      }
    } catch {
      dialog.showAlert('Erro de conexão.');
    }
  };

  const handleDelete = async (id: string) => {
    const confirmacao = await dialog.showPrompt({
      type: 'danger',
      title: 'Zona de Perigo',
      description: 'Esta ação arquivará este cadastro. Digite EXCLUIR:',
      validationText: 'EXCLUIR',
      placeholder: "Digite 'EXCLUIR'"
    });

    if (confirmacao !== 'EXCLUIR') return;

    try {
      const res = await fetch(`/api/admin/empresas?id=${id}&type=${viewType}`, { method: 'DELETE' });
      if (res.ok) {
        await dialog.showAlert({ type: 'success', description: 'Registro removido.' });
        setEditingItem(null);
        carregarDados(page, termo, viewType);
      } else {
        const data = await res.json();
        dialog.showAlert({ type: 'danger', title: 'Falha', description: data.error || 'Erro ao excluir.' });
      }
    } catch {
      dialog.showAlert('Erro de conexão.');
    }
  };

  const handleUnbindClient = async (empresaId: string, clienteId: string, nomeCliente: string) => {
    const confirm = await dialog.showPrompt({
      type: 'danger',
      title: 'Desvincular Cliente',
      description: `Deseja remover ${nomeCliente} da carteira desta empresa?`,
      validationText: 'DESVINCULAR',
      placeholder: "Digite 'DESVINCULAR' para confirmar"
    });

    if (confirm !== 'DESVINCULAR') return;

    try {
      const res = await fetch(`/api/admin/empresas?id=${empresaId}&clienteId=${clienteId}&action=UNBIND`, { method: 'DELETE' });
      if (res.ok) {
        setEditingItem({
          ...editingItem,
          clientesVinculados: editingItem.clientesVinculados.filter((c: any) => c.id !== clienteId)
        });
        dialog.showAlert({ type: 'success', description: 'Cliente desvinculado com sucesso.' });
      }
    } catch {
      dialog.showAlert('Erro ao desvincular.');
    }
  };

  const resumo = useMemo(() => ({
    comIbge: items.filter(item => item.codigoIbge).length,
    semIbge: items.filter(item => !item.codigoIbge).length,
    exterior: items.filter(item => item.tipo === 'EXT').length
  }), [items]);

  const abrirEdicao = (item: any) => {
    setEditingItem({ ...item, codigoIbge: item.codigoIbge || '' });
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">Base operacional</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Base de Cadastros</h1>
          <p className="mt-2 max-w-3xl text-slate-500">
            Consulte e faça manutenção em emissores, tomadores, vínculos e dados fiscais críticos como o código IBGE.
          </p>
        </div>
        <div className="relative w-full lg:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            className={`${inputBase} pl-10`}
            placeholder={viewType === 'PRESTADOR' ? 'Buscar empresa, dono ou CNPJ...' : 'Buscar cliente, tomador ou documento...'}
            value={termo}
            onChange={e => { setTermo(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <FileText className="text-blue-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">{totalItems}</p>
          <p className="text-xs font-bold uppercase text-slate-400">Registros encontrados</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <MapPin className="text-emerald-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">{resumo.comIbge}</p>
          <p className="text-xs font-bold uppercase text-slate-400">Com IBGE nesta página</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <AlertTriangle className="text-amber-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">{resumo.semIbge}</p>
          <p className="text-xs font-bold uppercase text-slate-400">Sem IBGE nesta página</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => { setViewType('PRESTADOR'); setPage(1); }}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition ${viewType === 'PRESTADOR' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-blue-50 hover:text-blue-700'}`}
          >
            <Briefcase size={16} /> Emissores (Prestadores)
          </button>
          <button
            onClick={() => { setViewType('TOMADOR'); setPage(1); }}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition ${viewType === 'TOMADOR' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:bg-emerald-50 hover:text-emerald-700'}`}
          >
            <Users size={16} /> Tomadores (Clientes)
          </button>
        </div>
      </div>

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-5">
              <div>
                <h3 className="flex items-center gap-2 text-xl font-black text-slate-950">
                  <Edit size={22} /> Editar {viewType === 'PRESTADOR' ? 'Prestador' : 'Tomador'}
                </h3>
                <p className="mt-1 text-sm text-slate-500">Atualize dados cadastrais, endereço e informações fiscais.</p>
              </div>
              <button onClick={() => setEditingItem(null)} className="rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-red-500">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <label className="mb-1 block text-xs font-black uppercase text-blue-700">Razão social / Nome</label>
                <input className={inputBase} value={editingItem.razaoSocial || editingItem.nome || ''} onChange={e => setEditingItem({ ...editingItem, razaoSocial: e.target.value })} />
              </div>

              {viewType === 'PRESTADOR' && editingItem.clientesVinculados && (
                <div className="rounded-2xl border border-slate-200 p-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-black text-emerald-700">
                    <Users size={16} /> Carteira de Clientes ({editingItem.clientesVinculados.length})
                  </h4>
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                    {editingItem.clientesVinculados.length === 0 ? (
                      <p className="p-4 text-sm text-slate-400">Nenhum cliente vinculado.</p>
                    ) : (
                      editingItem.clientesVinculados.map((c: any) => (
                        <div key={c.id} className="flex items-center justify-between border-b p-3 last:border-0 hover:bg-white">
                          <div>
                            <p className="font-black text-slate-700">{c.nome}</p>
                            <p className="font-mono text-[11px] text-slate-500">{c.documento}</p>
                          </div>
                          <button onClick={() => handleUnbindClient(editingItem.id, c.id, c.nome)} className="rounded-xl p-2 text-red-400 hover:bg-red-50 hover:text-red-600">
                            <X size={16} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-black uppercase text-slate-500">Documento (CNPJ/CPF)</label>
                  <input className={`${inputBase} bg-slate-100 font-mono text-slate-500`} value={editingItem.documento || 'EXTERIOR'} disabled />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black uppercase text-slate-500">Inscrição Municipal</label>
                  <input className={inputBase} value={editingItem.inscricaoMunicipal || ''} onChange={e => setEditingItem({ ...editingItem, inscricaoMunicipal: e.target.value })} />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="mb-4 flex items-center gap-2 text-sm font-black text-blue-700"><MapPin size={16} /> Endereço oficial</h4>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                  <div className="md:col-span-2"><label className="mb-1 block text-xs font-black uppercase text-slate-500">CEP</label><input className={inputBase} value={editingItem.cep || ''} onChange={e => setEditingItem({ ...editingItem, cep: e.target.value })} /></div>
                  <div className="md:col-span-4"><label className="mb-1 block text-xs font-black uppercase text-slate-500">Logradouro</label><input className={inputBase} value={editingItem.logradouro || ''} onChange={e => setEditingItem({ ...editingItem, logradouro: e.target.value })} /></div>
                  <div className="md:col-span-2"><label className="mb-1 block text-xs font-black uppercase text-slate-500">Número</label><input className={inputBase} value={editingItem.numero || ''} onChange={e => setEditingItem({ ...editingItem, numero: e.target.value })} /></div>
                  <div className="md:col-span-2"><label className="mb-1 block text-xs font-black uppercase text-slate-500">Bairro</label><input className={inputBase} value={editingItem.bairro || ''} onChange={e => setEditingItem({ ...editingItem, bairro: e.target.value })} /></div>
                  <div className="md:col-span-2"><label className="mb-1 block text-xs font-black uppercase text-slate-500">Cidade</label><input className={inputBase} value={editingItem.cidade || ''} onChange={e => setEditingItem({ ...editingItem, cidade: e.target.value })} /></div>
                  <div className="md:col-span-2"><label className="mb-1 block text-xs font-black uppercase text-slate-500">UF</label><input className={inputBase} maxLength={2} value={editingItem.uf || ''} onChange={e => setEditingItem({ ...editingItem, uf: e.target.value.toUpperCase() })} /></div>
                  <div className="md:col-span-2">
                    <label className="mb-1 flex items-center gap-1 text-xs font-black uppercase text-blue-700"><Hash size={12} /> Código IBGE</label>
                    <input className={`${inputBase} border-blue-200 bg-blue-50 font-mono`} value={editingItem.codigoIbge || ''} onChange={e => setEditingItem({ ...editingItem, codigoIbge: e.target.value.replace(/\D/g, '') })} placeholder="Ex: 2611606" maxLength={7} />
                  </div>
                  <div className="md:col-span-2"><label className="mb-1 block text-xs font-black uppercase text-slate-500">Complemento</label><input className={inputBase} value={editingItem.complemento || ''} onChange={e => setEditingItem({ ...editingItem, complemento: e.target.value })} /></div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 p-5">
              <button onClick={() => handleDelete(editingItem.id)} className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-black text-red-500 transition hover:bg-red-50">
                <Trash2 size={16} /> Excluir Cadastro
              </button>
              <div className="flex gap-2">
                <button onClick={() => setEditingItem(null)} className="rounded-xl px-5 py-3 text-sm font-bold text-slate-600 transition hover:bg-white">Cancelar</button>
                <button onClick={handleSave} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700">
                  <Save size={18} /> Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 min-h-[400px] content-start">
        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500">
            <Loader2 className="mr-2 animate-spin" /> Carregando base...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">Nenhum cadastro encontrado nesta categoria.</div>
        ) : (
          items.map(item => (
            <div key={item.id} className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <div className={`rounded-2xl border p-3 ${viewType === 'PRESTADOR' ? 'border-blue-100 bg-blue-50 text-blue-600' : 'border-emerald-100 bg-emerald-50 text-emerald-600'}`}>
                    {viewType === 'PRESTADOR' ? <Building2 size={24} /> : <Users size={24} />}
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-black text-slate-900" title={item.razaoSocial}>{item.razaoSocial}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono uppercase text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-1">DOC: {item.documento || 'EXTERIOR'}</span>
                      {item.codigoIbge ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">IBGE: {item.codigoIbge}</span> : <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">Sem IBGE</span>}
                      {viewType === 'TOMADOR' && item.tipo === 'EXT' && <span className="flex items-center gap-1 rounded-full bg-purple-100 px-2 py-1 text-purple-700"><Globe size={10} /> Exterior</span>}
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 items-center gap-3 md:w-1/3 md:border-l md:border-slate-100 md:pl-6">
                  <div className="shrink-0 rounded-full bg-slate-100 p-2 text-slate-400">{viewType === 'PRESTADOR' ? <User size={18} /> : <Building2 size={18} />}</div>
                  <div className="min-w-0">
                    <p className="mb-0.5 text-[10px] font-black uppercase text-slate-400">{viewType === 'PRESTADOR' ? 'Cliente proprietário' : 'Empresa vinculada'}</p>
                    {viewType === 'PRESTADOR' ? (
                      item.donos?.length > 0 ? (
                        <><p className="truncate text-sm font-black text-slate-800">{item.donos[0].nome}</p><p className="flex items-center gap-1 truncate text-xs text-slate-500"><Mail size={10} /> {item.donos[0].email}</p></>
                      ) : <p className="text-xs italic text-red-400">Órfão (sem dono)</p>
                    ) : (
                      item.vinculo ? <><p className="truncate text-sm font-black text-slate-800">{item.vinculo.razaoSocial}</p><p className="font-mono text-xs text-slate-500">CNPJ: {item.vinculo.documento}</p></> : <p className="text-xs italic text-red-400">Sem empresa mãe</p>
                    )}
                  </div>
                </div>

                <button onClick={() => abrirEdicao(item)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-xs font-black text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                  <Edit size={16} /> Editar
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <span className="text-sm font-medium text-slate-500">Página {page} de {totalPages}</span>
        <div className="flex gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded-xl border bg-white p-2 text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"><ChevronLeft size={16} /></button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-xl border bg-white p-2 text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}
