'use client';
import { useEffect, useState } from 'react';
import {
  Shield,
  UserPlus,
  Trash2,
  Search,
  X,
  UserCog,
  Edit,
  Save,
  Briefcase,
  Building2,
  Ban,
  Clock3,
  RefreshCw,
  Users,
  FileCheck,
  Power,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { ROLE_LABELS, STAFF_ROLES } from '@/app/utils/permissions';
import { useDialog } from '@/app/contexts/DialogContext';

const MANAGED_COLLAB_ROLES = [...STAFF_ROLES, 'CONTADOR'];

export default function GestaoColaboradores() {
  const dialog = useDialog();
  const [colabs, setColabs] = useState<any[]>([]);
  const [candidatos, setCandidatos] = useState<any[]>([]); 
  
  // Modais
  const [modalNewOpen, setModalNewOpen] = useState(false);
  const [modalEditOpen, setModalEditOpen] = useState(false);
  
  // Estado para Criar/Promover
  const [searchUser, setSearchUser] = useState('');
  const [roleInput, setRoleInput] = useState('SUPORTE');
  const [filtroCandidato, setFiltroCandidato] = useState('');

  // Estado para Edição
  const [selectedUserFull, setSelectedUserFull] = useState<any>(null); 
  const [editLimit, setEditLimit] = useState(5); // Limite Empresas
  const [editLimiteNotas, setEditLimiteNotas] = useState<number | ''>(''); // NOVO: Limite Notas
  const [editLimiteClientes, setEditLimiteClientes] = useState<number | ''>(''); // NOVO: Limite Clientes
  const [editAssinaturaAtiva, setEditAssinaturaAtiva] = useState(true);
  const [editRenovacaoAutomatica, setEditRenovacaoAutomatica] = useState(true);
  const [novaProprietaria, setNovaProprietaria] = useState({ documento: '', razaoSocial: '' });
  const [loadingEdit, setLoadingEdit] = useState(false);

  const getActivePlanHistory = (user: any) => {
    return user?.planHistories?.find((h: any) => h.status === 'ATIVO' && h.plan) || user?.planHistories?.find((h: any) => h.plan) || null;
  };

  const getPlanInfo = (user: any) => {
    const history = getActivePlanHistory(user);
    const plan = history?.plan;
    const slug = plan?.slug || user?.plano || 'SEM_PLANO';
    const isLegacy = slug === 'PARCEIRO';
    const isCustom = plan?.tipo === 'CUSTOM' || slug.startsWith('parceiro-contabil-');
    const isContadorPrivate = slug.startsWith('CONTADOR_');
    const dataFim = history?.dataFim || user?.planoExpiresAt;
    const vencimento = dataFim ? new Date(dataFim) : null;

    return {
      history,
      plan,
      slug,
      name: plan?.name || slug,
      origem: isLegacy
        ? 'Legado'
        : isCustom
          ? 'Custom admin'
          : isContadorPrivate
            ? 'Plano privado'
            : plan
              ? 'Plano base'
              : 'Sem plano',
      isLegacy,
      isCustom,
      status: history?.status || user?.planoStatus || 'N/A',
      maxNotas: plan?.maxNotasMensal ?? 0,
      maxClientes: plan?.maxClientes ?? 0,
      vencimento,
    };
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'Sem vencimento';
    return date.toLocaleDateString('pt-BR');
  };

  const carregarDados = () => {
    fetch('/api/admin/users', { headers: {} })
    .then(r => r.json())
    .then(data => {
        if (Array.isArray(data)) {
            setColabs(data.filter((u: any) => MANAGED_COLLAB_ROLES.includes(u.role)));
            setCandidatos(data.filter((u: any) => !MANAGED_COLLAB_ROLES.includes(u.role)));
        }
    });
  };

  useEffect(() => { carregarDados(); }, []);

  // --- ABRIR EDIÇÃO ---
  const handleOpenEdit = async (userId: string) => {
      setLoadingEdit(true);
      setModalEditOpen(true);
      
      try {
          const res = await fetch(`/api/admin/users/${userId}`, { headers: {} });
          const data = await res.json();
          
          setSelectedUserFull(data);
          setRoleInput(data.role);
          setEditLimit(data.limiteEmpresas || 5);
          setNovaProprietaria({ documento: '', razaoSocial: '' });

          // Procura o plano ativo do Parceiro para preencher os inputs de notas e clientes
          const activePlanHistory = data.planHistories?.find((h: any) => h.status === 'ATIVO');
          const latestPlanHistory = activePlanHistory || data.planHistories?.[0];
          if (latestPlanHistory && latestPlanHistory.plan) {
              setEditLimiteNotas(latestPlanHistory.plan.maxNotasMensal);
              setEditLimiteClientes(latestPlanHistory.plan.maxClientes);
              setEditAssinaturaAtiva(latestPlanHistory.status === 'ATIVO');
              const dataFim = latestPlanHistory.dataFim ? new Date(latestPlanHistory.dataFim) : null;
              const diasRestantes = dataFim ? Math.ceil((dataFim.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 9999;
              setEditRenovacaoAutomatica(!dataFim || diasRestantes > 45);
          } else {
              setEditLimiteNotas('');
              setEditLimiteClientes('');
              setEditAssinaturaAtiva(false);
              setEditRenovacaoAutomatica(false);
          }

      } catch (e) {
          dialog.showAlert("Erro ao carregar detalhes.");
          setModalEditOpen(false);
      } finally {
          setLoadingEdit(false);
      }
  };

  // --- PROMOVER (Novo) ---
  const handlePromover = async () => {
    if (!searchUser) return dialog.showAlert("Selecione um usuário.");

    try {
        const res = await fetch('/api/admin/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json'},
            body: JSON.stringify({ id: searchUser, role: roleInput })
        });

        if (res.ok) {
            dialog.showAlert({ type: 'success', description: "Usuário promovido com sucesso!" });
            setModalNewOpen(false);
            carregarDados();
            setSearchUser('');
        } else {
            dialog.showAlert({ type: 'danger', description: "Erro ao promover." });
        }
    } catch (error) { dialog.showAlert("Erro de conexão."); }
  };

  // --- SALVAR EDIÇÃO ---
  const handleSaveEdit = async () => {
      if(!selectedUserFull) return;

      // Monta o payload de envio com os novos limites se for contador
      const payload: any = { role: roleInput, limiteEmpresas: editLimit };
      if (roleInput === 'CONTADOR') {
          if (editLimiteNotas !== '') payload.limiteNotas = editLimiteNotas;
          if (editLimiteClientes !== '') payload.limiteClientes = editLimiteClientes;
          payload.assinaturaAtiva = editAssinaturaAtiva;
          payload.renovacaoAutomatica = editRenovacaoAutomatica;
      }

      try {
          // 1. Atualiza Limites e Role (PATCH)
          const res = await fetch(`/api/admin/users/${selectedUserFull.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json'},
              body: JSON.stringify(payload)
          });

          // 2. Se mudou para Contador do zero (legado), garante o put secundário
          if(roleInput === 'CONTADOR' && selectedUserFull.role !== 'CONTADOR') {
               await fetch('/api/admin/users', {
                   method: 'PUT',
                   headers: { 'Content-Type': 'application/json'},
                   body: JSON.stringify({ id: selectedUserFull.id, role: 'CONTADOR' })
               });
          }

          if(res.ok) {
              dialog.showAlert({ type: 'success', description: "Dados e limites atualizados!" });
              setModalEditOpen(false);
              carregarDados();
          }
      } catch(e) { dialog.showAlert("Erro ao salvar."); }
  };

  const handleApplyDefaultPlan = async () => {
      if (!selectedUserFull) return;
      if (!await dialog.showConfirm({
          title: 'Aplicar plano padrao?',
          description: 'O contador passara para o CONTADOR_STARTER. Pacotes avulsos permanecem preservados.',
          type: 'warning'
      })) return;

      try {
          const res = await fetch(`/api/admin/users/${selectedUserFull.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: 'CONTADOR', aplicarPlanoPadrao: true })
          });
          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
              dialog.showAlert({ type: 'danger', description: data.error || 'Erro ao aplicar plano padrao.' });
              return;
          }

          dialog.showAlert({ type: 'success', description: 'Plano padrao aplicado ao contador.' });
          await handleOpenEdit(selectedUserFull.id);
          carregarDados();
      } catch {
          dialog.showAlert('Erro de conexao.');
      }
  };

  // --- DESVINCULAR EMPRESA ---
  const handleUnlinkCompany = async (vinculoId: string) => {
      if(!await dialog.showConfirm({ 
          title: 'Desvincular?', 
          description: 'O contador perderá o acesso a esta empresa.',
          type: 'warning'
      })) return;
      
      await fetch(`/api/contador/vinculo?id=${vinculoId}`, { method: 'DELETE', headers: {} });
      
      setSelectedUserFull((prev: any) => ({
          ...prev,
          empresasContabeis: prev.empresasContabeis.filter((v: any) => v.id !== vinculoId)
      }));
  };

  const handleAddEmpresaProprietaria = async () => {
      if (!selectedUserFull) return;
      const cnpjLimpo = novaProprietaria.documento.replace(/\D/g, '');
      if (cnpjLimpo.length !== 14) {
          dialog.showAlert({ type: 'warning', description: 'Informe um CNPJ valido.' });
          return;
      }

      try {
          const res = await fetch(`/api/admin/users/${selectedUserFull.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ addEmpresaProprietaria: novaProprietaria })
          });
          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
              dialog.showAlert({ type: 'danger', description: data.error || 'Erro ao incluir empresa proprietaria.' });
              return;
          }

          setSelectedUserFull((prev: any) => ({
              ...prev,
              empresasProprietarias: [...(prev.empresasProprietarias || []).filter((e: any) => e.id !== data.empresa.id), data.empresa],
              empresasContabeis: prev.empresasContabeis || []
          }));
          setNovaProprietaria({ documento: '', razaoSocial: '' });
          dialog.showAlert({ type: 'success', description: 'Empresa proprietaria marcada para o contador.' });
      } catch {
          dialog.showAlert('Erro de conexao.');
      }
  };

  const handleRemoveEmpresaProprietaria = async (empresaId: string) => {
      if (!selectedUserFull) return;
      if (!await dialog.showConfirm({
          title: 'Remover propriedade?',
          description: 'A empresa deixara de ser marcada como proprietaria deste contador.',
          type: 'warning'
      })) return;

      const res = await fetch(`/api/admin/users/${selectedUserFull.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeEmpresaProprietariaId: empresaId })
      });

      if (res.ok) {
          setSelectedUserFull((prev: any) => ({
              ...prev,
              empresasProprietarias: (prev.empresasProprietarias || []).filter((e: any) => e.id !== empresaId)
          }));
      }
  };

  // --- DEMITIR ---
  const handleDemitir = async (id: string) => {
      if(!await dialog.showConfirm({ type: 'danger', title: 'Remover Acesso', description: 'O usuário voltará a ser um cliente comum.' })) return;
      await fetch('/api/admin/users', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json'},
          body: JSON.stringify({ id, role: 'COMUM' }) 
      });
      carregarDados();
  }

  const candidatosFiltrados = candidatos.filter(c => c.nome.toLowerCase().includes(filtroCandidato.toLowerCase()) || c.email.includes(filtroCandidato));
  const totalContadores = colabs.filter((u) => u.role === 'CONTADOR').length;
  const totalEquipeInterna = colabs.filter((u) => u.role !== 'CONTADOR').length;
  const empresasNaCarteira = selectedUserFull?.empresasContabeis?.length || 0;
  const limiteEmpresasPct = editLimit ? Math.min(100, Math.round((empresasNaCarteira / editLimit) * 100)) : 0;
  const selectedPlanInfo = selectedUserFull ? getPlanInfo(selectedUserFull) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
            <p className="text-xs font-black uppercase tracking-[0.26em] text-blue-600">Administração</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Time Interno & Parceiros</h1>
            <p className="mt-1 text-sm text-slate-500">Gerencie acessos, carteiras e limites operacionais dos contadores parceiros.</p>
        </div>
        <button onClick={() => { setSearchUser(''); setModalNewOpen(true); }} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700">
            <UserPlus size={18} /> Novo Colaborador
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase text-slate-400">Colaboradores</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{colabs.length}</p>
            </div>
            <Shield className="text-blue-600" size={28} />
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase text-slate-400">Contadores parceiros</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{totalContadores}</p>
            </div>
            <Briefcase className="text-emerald-600" size={28} />
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase text-slate-400">Equipe interna</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{totalEquipeInterna}</p>
            </div>
            <Users className="text-purple-600" size={28} />
          </div>
        </div>
      </div>

      {/* MODAL NOVO */}
      {modalNewOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-6 py-5">
                    <div>
                      <h3 className="text-lg font-black text-slate-950">Adicionar ao Time</h3>
                      <p className="text-sm text-slate-500">Promova um usuário para equipe ou parceiro.</p>
                    </div>
                    <button onClick={() => setModalNewOpen(false)} className="rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-red-500"><X size={20}/></button>
                </div>
                <div className="space-y-4 p-6">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Buscar Usuário</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-3 text-gray-400" size={16}/>
                            <input className="w-full rounded-xl border border-slate-200 py-3 pl-9 pr-3 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100" placeholder="Nome ou Email..." onChange={e => setFiltroCandidato(e.target.value)}/>
                        </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-1">
                        {candidatosFiltrados.map(u => (
                            <div key={u.id} onClick={() => setSearchUser(u.id)} className={`flex cursor-pointer items-center justify-between rounded-lg p-3 transition hover:bg-blue-50 ${searchUser === u.id ? 'bg-blue-100 ring-1 ring-blue-200' : ''}`}>
                                <div><p className="text-sm font-bold">{u.nome}</p><p className="text-xs text-slate-500">{u.email}</p></div>
                                {searchUser === u.id && <UserCog size={16} className="text-blue-600"/>}
                            </div>
                        ))}
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cargo</label>
                        <select className="w-full rounded-xl border border-slate-200 p-3 font-semibold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" value={roleInput} onChange={e => setRoleInput(e.target.value)}>
                            <option value="SUPORTE">Suporte</option>
                            <option value="CONTADOR">Contador (Parceiro)</option>
                            <option value="ADMIN">Administrador</option>
                        </select>
                    </div>
                    <button onClick={handlePromover} disabled={!searchUser} className="w-full rounded-xl bg-green-600 py-3 font-bold text-white transition hover:bg-green-700 disabled:opacity-50">Confirmar</button>
                </div>
            </div>
        </div>
      )}

      {/* MODAL EDIÇÃO */}
      {modalEditOpen && selectedUserFull && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-5">
                    <div>
                      <h3 className="flex items-center gap-2 text-xl font-black text-slate-950"><UserCog size={22}/> Editar Colaborador</h3>
                      <p className="mt-1 text-sm text-slate-500">Ajuste acesso, assinatura, renovação e limites do parceiro.</p>
                    </div>
                    <button onClick={() => setModalEditOpen(false)} className="rounded-xl p-2 text-slate-400 transition hover:bg-white hover:text-red-500"><X size={20}/></button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-lg font-black text-blue-950">{selectedUserFull.nome}</p>
                            <p className="text-sm text-blue-700">{selectedUserFull.email}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-blue-200 px-3 py-1 text-xs font-black uppercase text-blue-800">{roleInput}</span>
                          {roleInput === 'CONTADOR' && (
                            <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${editAssinaturaAtiva ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                              {editAssinaturaAtiva ? 'Ativo' : 'Inativo'}
                            </span>
                          )}
                        </div>
                    </div>

                    {roleInput === 'CONTADOR' && selectedPlanInfo && (
                      <div className={`rounded-2xl border p-4 ${selectedPlanInfo.isLegacy ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex items-start gap-3">
                            <div className={`rounded-xl p-3 ${selectedPlanInfo.isLegacy ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                              {selectedPlanInfo.isLegacy ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
                            </div>
                            <div>
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Plano ativo</p>
                              <h4 className="mt-1 text-lg font-black text-slate-950">{selectedPlanInfo.name}</h4>
                              <p className="mt-1 text-sm text-slate-500">
                                Origem: <span className="font-bold text-slate-700">{selectedPlanInfo.origem}</span> · Status: <span className="font-bold text-slate-700">{selectedPlanInfo.status}</span> · Vence: <span className="font-bold text-slate-700">{formatDate(selectedPlanInfo.vencimento)}</span>
                              </p>
                            </div>
                          </div>

                          {selectedPlanInfo.isLegacy && (
                            <button
                              type="button"
                              onClick={handleApplyDefaultPlan}
                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-black text-white transition hover:bg-amber-700"
                            >
                              <RefreshCw size={16} /> Aplicar plano padrao
                            </button>
                          )}
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                            <p className="text-xs font-black uppercase text-slate-400">Limite NFS-e</p>
                            <p className="mt-1 text-xl font-black text-slate-950">{selectedPlanInfo.maxNotas}</p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                            <p className="text-xs font-black uppercase text-slate-400">Limite clientes</p>
                            <p className="mt-1 text-xl font-black text-slate-950">{selectedPlanInfo.maxClientes}</p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                            <p className="text-xs font-black uppercase text-slate-400">Slug</p>
                            <p className="mt-1 truncate text-sm font-black text-slate-950" title={selectedPlanInfo.slug}>{selectedPlanInfo.slug}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* DADOS E LIMITES DO PARCEIRO */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cargo do Usuário</label>
                            <select className="w-full rounded-xl border border-slate-200 bg-white p-3 font-semibold outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100" value={roleInput} onChange={e => setRoleInput(e.target.value)}>
                                <option value="SUPORTE">Suporte</option>
                                <option value="SUPORTE_TI">Suporte T.I</option>
                                <option value="CONTADOR">Contador Parceiro</option>
                                <option value="ADMIN">Admin</option>
                            </select>
                        </div>
                        
                        {roleInput === 'CONTADOR' && (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                  <button
                                    type="button"
                                    onClick={() => setEditAssinaturaAtiva(!editAssinaturaAtiva)}
                                    className={`rounded-2xl border p-4 text-left transition ${
                                      editAssinaturaAtiva
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                        : 'border-slate-200 bg-slate-50 text-slate-600'
                                    }`}
                                  >
                                    <Power size={18} />
                                    <p className="mt-2 text-sm font-black">{editAssinaturaAtiva ? 'Ativo' : 'Inativo'}</p>
                                    <p className="mt-1 text-xs font-medium opacity-80">Controla acesso do parceiro.</p>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditRenovacaoAutomatica(!editRenovacaoAutomatica)}
                                    disabled={!editAssinaturaAtiva}
                                    className={`rounded-2xl border p-4 text-left transition disabled:opacity-50 ${
                                      editRenovacaoAutomatica
                                        ? 'border-blue-200 bg-blue-50 text-blue-800'
                                        : 'border-amber-200 bg-amber-50 text-amber-800'
                                    }`}
                                  >
                                    <RefreshCw size={18} />
                                    <p className="mt-2 text-sm font-black">{editRenovacaoAutomatica ? 'Renovação automática' : '30 dias sem renovação'}</p>
                                    <p className="mt-1 text-xs font-medium opacity-80">Define validade da assinatura.</p>
                                  </button>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-purple-600 uppercase mb-1">Limite Empresas (CNPJs)</label>
                                    <input type="number" placeholder="Ex: 5" className="w-full rounded-xl border border-purple-200 bg-purple-50/50 p-3 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-100" value={editLimit} onChange={e => setEditLimit(Number(e.target.value))}/>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-green-600 uppercase mb-1">Limite NFS-e (Global/Mês)</label>
                                    <input type="number" placeholder="Ex: 5000" className="w-full rounded-xl border border-green-200 bg-green-50/50 p-3 outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-100" value={editLimiteNotas} onChange={e => setEditLimiteNotas(e.target.value !== '' ? Number(e.target.value) : '')}/>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-blue-600 uppercase mb-1">Limite Clientes (Carteira)</label>
                                    <input type="number" placeholder="Ex: 100" className="w-full rounded-xl border border-blue-200 bg-blue-50/50 p-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" value={editLimiteClientes} onChange={e => setEditLimiteClientes(e.target.value !== '' ? Number(e.target.value) : '')}/>
                                </div>
                            </>
                        )}
                    </div>

                    {roleInput === 'CONTADOR' && (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <Building2 className="text-purple-600" size={20} />
                          <p className="mt-3 text-2xl font-black text-slate-950">{empresasNaCarteira}/{editLimit || 0}</p>
                          <p className="text-xs font-bold uppercase text-slate-400">Empresas na carteira</p>
                          <div className="mt-3 h-2 rounded-full bg-slate-100">
                            <div className="h-2 rounded-full bg-purple-600" style={{ width: `${limiteEmpresasPct}%` }} />
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <FileCheck className="text-emerald-600" size={20} />
                          <p className="mt-3 text-2xl font-black text-slate-950">{editLimiteNotas || 0}</p>
                          <p className="text-xs font-bold uppercase text-slate-400">NFS-e globais por mês</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <Clock3 className="text-blue-600" size={20} />
                          <p className="mt-3 text-2xl font-black text-slate-950">{editRenovacaoAutomatica ? 'Auto' : '30 dias'}</p>
                          <p className="text-xs font-bold uppercase text-slate-400">Renovação</p>
                        </div>
                      </div>
                    )}

                    {/* LISTA DE EMPRESAS VINCULADAS */}
                    {roleInput === 'CONTADOR' && (
                        <div className="rounded-2xl border border-slate-200 p-4">
                            <h4 className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2"><Building2 size={16}/> Empresas Proprietarias ({selectedUserFull.empresasProprietarias?.length || 0})</h4>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
                                <input
                                  className="rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                  placeholder="CNPJ"
                                  value={novaProprietaria.documento}
                                  onChange={e => setNovaProprietaria({ ...novaProprietaria, documento: e.target.value })}
                                />
                                <input
                                  className="rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                                  placeholder="Razao social opcional"
                                  value={novaProprietaria.razaoSocial}
                                  onChange={e => setNovaProprietaria({ ...novaProprietaria, razaoSocial: e.target.value })}
                                />
                                <button
                                  type="button"
                                  onClick={handleAddEmpresaProprietaria}
                                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700"
                                >
                                  <Building2 size={16}/> Incluir
                                </button>
                            </div>
                            <div className="mt-3 max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                                {selectedUserFull.empresasProprietarias?.length === 0 || !selectedUserFull.empresasProprietarias ? (
                                    <p className="p-4 text-xs text-center text-slate-400">Nenhuma empresa proprietaria marcada.</p>
                                ) : (
                                    selectedUserFull.empresasProprietarias?.map((empresa: any) => (
                                        <div key={empresa.id} className="flex items-center justify-between border-b p-3 text-sm transition last:border-0 hover:bg-white">
                                            <div>
                                                <p className="font-bold text-slate-700">{empresa.razaoSocial}</p>
                                                <p className="text-[10px] text-slate-500">CNPJ: {empresa.documento}</p>
                                            </div>
                                            <button onClick={() => handleRemoveEmpresaProprietaria(empresa.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded border border-transparent hover:border-red-200 transition" title="Remover propriedade">
                                                <X size={14}/>
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {roleInput === 'CONTADOR' && (
                        <div className="rounded-2xl border border-slate-200 p-4">
                            <h4 className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2"><Building2 size={16}/> Carteira de Empresas Ativas ({selectedUserFull.empresasContabeis?.length || 0})</h4>
                            <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                                {selectedUserFull.empresasContabeis?.length === 0 ? (
                                    <p className="p-4 text-xs text-center text-slate-400">Nenhuma empresa vinculada.</p>
                                ) : (
                                    selectedUserFull.empresasContabeis?.map((v: any) => (
                                        <div key={v.id} className="flex items-center justify-between border-b p-3 text-sm transition last:border-0 hover:bg-white">
                                            <div>
                                                <p className="font-bold text-slate-700">{v.empresa.razaoSocial}</p>
                                                <p className="text-[10px] text-slate-500">CNPJ: {v.empresa.documento}</p>
                                            </div>
                                            <button onClick={() => handleUnlinkCompany(v.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded border border-transparent hover:border-red-200 transition" title="Desvincular do Contador">
                                                <Ban size={14}/>
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-5">
                    <button onClick={() => setModalEditOpen(false)} className="rounded-xl border border-transparent px-5 py-3 text-sm font-bold text-slate-600 transition hover:border-slate-200 hover:bg-white">Cancelar</button>
                    <button onClick={handleSaveEdit} className="flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-blue-700">
                        <Save size={16}/> Salvar Configurações
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* LISTA DE COLABORADORES */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
            <thead className="border-b bg-slate-50">
                <tr>
                    <th className="p-4 text-slate-500 font-bold uppercase text-xs">Nome</th>
                    <th className="p-4 text-slate-500 font-bold uppercase text-xs">Cargo</th>
                    <th className="p-4 text-slate-500 font-bold uppercase text-xs">Perfil</th>
                    <th className="p-4 text-slate-500 font-bold uppercase text-xs">Plano</th>
                    <th className="p-4 text-right text-slate-500 font-bold uppercase text-xs">Ações</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {colabs.map(user => (
                    <tr key={user.id} className="hover:bg-slate-50 transition">
                        <td className="p-4">
                            <p className="font-bold text-slate-800">{user.nome}</p>
                            <p className="text-xs text-slate-500">{user.email}</p>
                        </td>
                        <td className="p-4">
                            <span className={`px-2 py-1 rounded text-[10px] font-bold border uppercase flex items-center gap-1 w-fit ${
                                user.role === 'CONTADOR' ? 'bg-green-50 text-green-700 border-green-200' : 
                                'bg-blue-50 text-blue-700 border-blue-200'
                            }`}>
                                {user.role === 'CONTADOR' && <Briefcase size={10}/>}
                                {ROLE_LABELS[user.role] || user.role}
                            </span>
                        </td>
                        <td className="p-4">
                            <span className="text-xs font-semibold text-slate-500">
                              {user.role === 'CONTADOR' ? 'Parceiro contábil' : 'Equipe do SaaS'}
                            </span>
                        </td>
                        <td className="p-4">
                            {user.role === 'CONTADOR' ? (() => {
                                const planInfo = getPlanInfo(user);
                                return (
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            {planInfo.isLegacy && <AlertTriangle size={14} className="text-amber-600" />}
                                            <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                                                planInfo.isLegacy
                                                    ? 'bg-amber-100 text-amber-700'
                                                    : planInfo.isCustom
                                                        ? 'bg-purple-100 text-purple-700'
                                                        : 'bg-emerald-100 text-emerald-700'
                                            }`}>
                                                {planInfo.origem}
                                            </span>
                                        </div>
                                        <p className="max-w-[190px] truncate text-xs font-bold text-slate-700" title={planInfo.slug}>{planInfo.name}</p>
                                        <p className="text-[10px] text-slate-400">{planInfo.maxNotas} notas · {planInfo.maxClientes} clientes</p>
                                    </div>
                                );
                            })() : (
                                <span className="text-xs text-slate-400">N/A</span>
                            )}
                        </td>
                        <td className="p-4">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => handleOpenEdit(user.id)} className="text-blue-600 hover:bg-blue-50 p-2 border border-transparent hover:border-blue-200 rounded transition" title="Editar Limites / Cargo">
                                <Edit size={16} />
                            </button>
                            {user.role !== 'MASTER' && (
                                <button onClick={() => handleDemitir(user.id)} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition" title="Remover acesso">
                                    <Trash2 size={16} />
                                </button>
                            )}
                          </div>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
      </div>
    </div>
  );
}
