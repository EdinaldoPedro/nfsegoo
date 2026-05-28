'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Edit,
  EyeOff,
  Package,
  Plus,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X,
  Zap
} from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';

type TabType = 'PLANO' | 'PACOTE';

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseFeatures(features: string) {
  try {
    const parsed = JSON.parse(features || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return features ? String(features).split(',').map((f) => f.trim()).filter(Boolean) : [];
  }
}

function productTypeLabel(tipo: string) {
  const labels: Record<string, string> = {
    PLANO: 'Assinatura',
    PACOTE_CLIENTES: 'Clientes',
    PACOTE_NOTAS: 'Notas',
    PACOTE_PJ: 'PJ adicional',
    CUSTOM: 'Customizado'
  };
  return labels[tipo] || tipo;
}

function inputClasses(tone = 'blue') {
  const ring = tone === 'amber' ? 'focus:ring-amber-100 focus:border-amber-300' : 'focus:ring-blue-100 focus:border-blue-300';
  return `w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none transition ${ring}`;
}

export default function AdminPlanos() {
  const dialog = useDialog();
  const [plans, setPlans] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('PLANO');
  const [editing, setEditing] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const carregar = () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    fetch('/api/plans?visao=admin', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = await r.json();
        if (r.ok && Array.isArray(data)) setPlans(data);
        else setPlans([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { carregar(); }, []);

  const abrirNovo = () => {
    setEditing({
      name: '',
      slug: '',
      description: '',
      priceMonthly: 0,
      priceYearly: 0,
      features: '[]',
      active: true,
      recommended: false,
      privado: false,
      maxNotasMensal: 0,
      diasTeste: 0,
      maxClientes: 0,
      tipo: activeTab === 'PACOTE' ? 'PACOTE_CLIENTES' : 'PLANO'
    });
  };

  const handleSave = async () => {
    const method = editing.id ? 'PUT' : 'POST';
    const token = localStorage.getItem('token');

    let parsedFeatures = editing.features;
    try {
      JSON.parse(editing.features);
    } catch {
      parsedFeatures = JSON.stringify(editing.features.split(',').map((f: string) => f.trim()).filter(Boolean));
    }

    try {
      const res = await fetch('/api/plans', {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...editing, features: parsedFeatures })
      });

      if (res.ok) {
        setEditing(null);
        await carregar();
        dialog.showAlert({ type: 'success', description: 'Salvo com sucesso!' });
      } else {
        const err = await res.json();
        dialog.showAlert({ type: 'danger', description: err.error });
      }
    } catch {
      dialog.showAlert('Erro de conexão.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!await dialog.showConfirm({ title: 'Excluir', description: 'Tem certeza?', type: 'danger', confirmText: 'Excluir' })) return;
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`/api/plans?id=${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        await carregar();
        dialog.showAlert({ type: 'success', description: 'Removido.' });
      } else {
        const data = await res.json();
        dialog.showAlert({ type: 'danger', description: data.error });
      }
    } catch {
      dialog.showAlert('Erro ao excluir.');
    }
  };

  const filteredItems = plans.filter((p) => activeTab === 'PLANO' ? p.tipo === 'PLANO' : p.tipo !== 'PLANO');

  const resumo = useMemo(() => {
    const planos = plans.filter((p) => p.tipo === 'PLANO');
    const pacotes = plans.filter((p) => p.tipo !== 'PLANO');
    return {
      ativos: plans.filter((p) => p.active).length,
      ocultos: plans.filter((p) => p.privado).length,
      destaques: plans.filter((p) => p.recommended).length,
      planos: planos.length,
      pacotes: pacotes.length
    };
  }, [plans]);

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">Catálogo comercial</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Planos e Pacotes</h1>
          <p className="mt-2 max-w-3xl text-slate-500">
            Organize assinaturas, pacotes avulsos, limites de uso, visibilidade e destaques comerciais do SaaS.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={carregar} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={abrirNovo} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">
            <Plus size={18} /> {activeTab === 'PLANO' ? 'Novo Plano' : 'Novo Pacote'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase text-slate-400">Produtos ativos</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{resumo.ativos}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase text-slate-400">Assinaturas</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{resumo.planos}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase text-slate-400">Pacotes</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{resumo.pacotes}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase text-slate-400">Ocultos / destaques</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{resumo.ocultos}/{resumo.destaques}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setActiveTab('PLANO')}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition ${
              activeTab === 'PLANO' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-blue-50 hover:text-blue-700'
            }`}
          >
            <Star size={16} /> Planos de assinatura
          </button>
          <button
            onClick={() => setActiveTab('PACOTE')}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition ${
              activeTab === 'PACOTE' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-blue-50 hover:text-blue-700'
            }`}
          >
            <Package size={16} /> Pacotes avulsos
          </button>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-5">
              <div>
                <h3 className="text-xl font-black text-slate-950">{editing.id ? `Editar ${editing.name}` : 'Criar novo produto'}</h3>
                <p className="mt-1 text-sm text-slate-500">Configure preço, limites, benefícios e visibilidade comercial.</p>
              </div>
              <button onClick={() => setEditing(null)} className="rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-red-500">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-black uppercase text-slate-500">Tipo de produto</label>
                  <select className={inputClasses()} value={editing.tipo} onChange={(e) => setEditing({ ...editing, tipo: e.target.value })}>
                    <option value="PLANO">Plano de assinatura</option>
                    <option value="PACOTE_CLIENTES">Pacote adicional de clientes</option>
                    <option value="PACOTE_NOTAS">Pacote adicional de notas</option>
                    <option value="PACOTE_PJ">Pacote de PJ adicional</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black uppercase text-slate-500">Slug interno</label>
                  <input className={`${inputClasses()} font-mono`} value={editing.slug || ''} onChange={(e) => setEditing({ ...editing, slug: e.target.value.toUpperCase() })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black uppercase text-slate-500">Nome comercial</label>
                  <input className={inputClasses()} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-black uppercase text-slate-500">Descrição curta</label>
                  <input className={inputClasses()} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <h4 className="mb-4 flex items-center gap-2 text-sm font-black text-blue-800"><Tag size={16} /> Preço e cobrança</h4>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {editing.tipo === 'PLANO' ? (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-black uppercase text-blue-700">Ciclo de cobrança</label>
                        <select
                          className={inputClasses()}
                          value={Number(editing.priceYearly) > 0 ? 'ANUAL' : 'MENSAL'}
                          onChange={(e) => {
                            const precoAtual = Number(editing.priceYearly) > 0 ? editing.priceYearly : editing.priceMonthly;
                            if (e.target.value === 'ANUAL') setEditing({ ...editing, priceYearly: precoAtual, priceMonthly: 0 });
                            else setEditing({ ...editing, priceMonthly: precoAtual, priceYearly: 0 });
                          }}
                        >
                          <option value="MENSAL">Mensal</option>
                          <option value="ANUAL">Anual</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-black uppercase text-blue-700">Preço</label>
                        <input
                          type="number"
                          className={inputClasses()}
                          value={Number(editing.priceYearly) > 0 ? editing.priceYearly : editing.priceMonthly}
                          onChange={(e) => {
                            if (Number(editing.priceYearly) > 0) setEditing({ ...editing, priceYearly: e.target.value, priceMonthly: 0 });
                            else setEditing({ ...editing, priceMonthly: e.target.value, priceYearly: 0 });
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="mb-1 block text-xs font-black uppercase text-blue-700">Preço único do pacote</label>
                      <input type="number" className={inputClasses()} value={editing.priceMonthly} onChange={(e) => setEditing({ ...editing, priceMonthly: e.target.value, priceYearly: 0 })} />
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                <h4 className="mb-4 flex items-center gap-2 text-sm font-black text-amber-800"><Zap size={16} /> Limites liberados</h4>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase text-amber-800">Limite NFS-e</label>
                    <input type="number" className={inputClasses('amber')} value={editing.maxNotasMensal} onChange={(e) => setEditing({ ...editing, maxNotasMensal: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-black uppercase text-amber-800">Limite clientes</label>
                    <input type="number" className={inputClasses('amber')} value={editing.maxClientes} onChange={(e) => setEditing({ ...editing, maxClientes: e.target.value })} />
                  </div>
                  {editing.tipo === 'PLANO' && (
                    <div>
                      <label className="mb-1 block text-xs font-black uppercase text-amber-800">Dias de teste</label>
                      <input type="number" className={inputClasses('amber')} value={editing.diasTeste} onChange={(e) => setEditing({ ...editing, diasTeste: e.target.value })} />
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-black uppercase text-slate-500">Benefícios</label>
                <textarea className={`${inputClasses()} h-28 font-mono`} value={editing.features} onChange={(e) => setEditing({ ...editing, features: e.target.value })} />
                <p className="mt-2 text-xs text-slate-500">Aceita JSON array ou benefícios separados por vírgula.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-5 md:grid-cols-3">
                {[
                  { key: 'active', label: 'Ativo', icon: Check, tone: 'emerald' },
                  { key: 'recommended', label: 'Destaque', icon: Sparkles, tone: 'purple' },
                  { key: 'privado', label: 'Oculto', icon: Shield, tone: 'slate' }
                ].map((item: any) => {
                  const Icon = item.icon;
                  const checked = !!editing[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setEditing({ ...editing, [item.key]: !checked })}
                      className={`rounded-2xl border p-4 text-left transition ${
                        checked ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <Icon size={18} />
                      <p className="mt-2 text-sm font-black">{item.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-5">
              <button onClick={() => setEditing(null)} className="rounded-xl px-5 py-3 text-sm font-bold text-slate-600 transition hover:bg-white">Cancelar</button>
              <button onClick={handleSave} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">
                <Save size={18} /> Salvar produto
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {filteredItems.length === 0 && !loading && (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
            Nenhum item cadastrado nesta categoria.
          </div>
        )}

        {filteredItems.map((plan) => {
          const isAnual = Number(plan.priceMonthly) === 0 && Number(plan.priceYearly) > 0 && plan.tipo === 'PLANO';
          const price = isAnual ? Number(plan.priceYearly) : Number(plan.priceMonthly);
          const label = plan.tipo === 'PLANO' ? (isAnual ? '/ano' : '/mês') : ' único';
          const featuresList = parseFeatures(plan.features);

          return (
            <div key={plan.id} className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${plan.recommended ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'} ${!plan.active ? 'opacity-60 grayscale' : ''}`}>
              <div className="p-6">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">{productTypeLabel(plan.tipo)}</span>
                      {plan.privado && <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black uppercase text-white"><EyeOff size={11} /> Oculto</span>}
                      {plan.recommended && <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black uppercase text-blue-700">Top</span>}
                    </div>
                    <h3 className="truncate text-xl font-black text-slate-950">{plan.name}</h3>
                    <p className="mt-1 font-mono text-xs text-slate-400">{plan.slug}</p>
                  </div>
                  <div className={`rounded-2xl p-3 ${plan.tipo === 'PLANO' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                    {plan.tipo === 'PLANO' ? <Star size={20} /> : <Package size={20} />}
                  </div>
                </div>

                <p className="min-h-10 text-sm leading-relaxed text-slate-500">{plan.description || 'Sem descrição comercial.'}</p>

                <div className="my-5">
                  {price === 0 && !isAnual ? (
                    <p className="text-4xl font-black text-emerald-600">Grátis</p>
                  ) : (
                    <p className="text-4xl font-black text-slate-950">{money(price)}<span className="text-sm font-bold text-slate-400">{label}</span></p>
                  )}
                </div>

                <div className="mb-5 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-lg font-black text-slate-900">{plan.maxNotasMensal || 0}</p>
                    <p className="text-[11px] font-bold uppercase text-slate-400">NFS-e</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-lg font-black text-slate-900">{plan.maxClientes || 0}</p>
                    <p className="text-[11px] font-bold uppercase text-slate-400">Clientes</p>
                  </div>
                </div>

                <div className="space-y-2">
                  {featuresList.slice(0, 5).map((feat: string, i: number) => (
                    <div key={`${feat}-${i}`} className="flex items-start gap-2 text-sm text-slate-600">
                      <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" /> {feat.trim()}
                    </div>
                  ))}
                  {featuresList.length === 0 && <p className="text-sm text-slate-400">Nenhum benefício informado.</p>}
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between border-t border-slate-100 bg-slate-50 p-4">
                <button onClick={() => handleDelete(plan.id)} className="rounded-xl p-2 text-red-400 transition hover:bg-red-50 hover:text-red-600">
                  <Trash2 size={18} />
                </button>
                <button onClick={() => setEditing({ ...plan, features: plan.features || '[]' })} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-black text-blue-700 ring-1 ring-blue-100 transition hover:bg-blue-50">
                  <Edit size={16} /> Editar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
