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
  Users,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { ROLE_LABELS, STAFF_ROLES } from '@/app/utils/permissions';
import { useDialog } from '@/app/contexts/DialogContext';
import AccountantBenefitPanel from './AccountantBenefitPanel';
import AdminAccountCompaniesPanel from '@/components/AdminAccountCompaniesPanel';
import Link from 'next/link';

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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [listError, setListError] = useState('');
  const [totalManaged, setTotalManaged] = useState(0);

  // Estado para Edição
  const [selectedUserFull, setSelectedUserFull] = useState<any>(null); 
  const [editLimit, setEditLimit] = useState(5); // Limite Empresas
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [customerAccess, setCustomerAccess] = useState<{ enabled: boolean } | null>(null);
  const [customerPlans, setCustomerPlans] = useState<Array<{ slug: string; name: string; tipo: string }>>([]);
  const [customerPlanSelection, setCustomerPlanSelection] = useState('');
  const [customerActionPending, setCustomerActionPending] = useState(false);

  const solicitarAutorizacaoAdministrativa = async (acao: string) => {
    const justification = await dialog.showPrompt({
      title: 'Justificativa obrigatoria',
      description: `Descreva o motivo para ${acao}. A operacao ficara registrada na auditoria.`,
      placeholder: 'Informe o motivo com ao menos 10 caracteres',
      confirmText: 'Continuar',
    });
    if (!justification) return null;
    if (justification.trim().length < 10) {
      await dialog.showAlert({ type: 'warning', description: 'A justificativa precisa ter ao menos 10 caracteres.' });
      return null;
    }

    const adminPassword = await dialog.showPrompt({
      title: 'Confirme sua identidade',
      description: 'Digite sua senha administrativa para autorizar a operacao sensivel.',
      placeholder: 'Senha administrativa',
      inputType: 'password',
      confirmText: 'Autorizar',
    });
    if (!adminPassword) return null;
    return { justification: justification.trim(), adminPassword };
  };

  const getActivePlanHistory = (user: any) => {
    const now = Date.now();
    return user?.planHistories?.find((h: any) => h.status === 'ATIVO' && !h.arquivadoEm && ['PLANO', 'CUSTOM'].includes(h.tipoContratado)
      && new Date(h.dataInicio).getTime() <= now && (!h.dataFim || new Date(h.dataFim).getTime() > now)) || null;
  };

  const getPlanInfo = (user: any) => {
    const history = getActivePlanHistory(user);
    const plan = user?.limits?.planoBase ? { ...user.limits.planoBase, name: user.limits.planoBase.nome } : history?.plan;
    const slug = plan?.slug || 'SEM_PLANO';
    const isLegacy = slug === 'PARCEIRO';
    const isCustom = plan?.tipo === 'CUSTOM' || slug.startsWith('parceiro-contabil-');
    const isContadorPrivate = slug.startsWith('CONTADOR_');
    const dataFim = plan?.dataFim || history?.dataFim;
    const vencimento = dataFim ? new Date(dataFim) : null;

    return {
      history,
      plan,
      slug,
      name: history?.nomeContratado || plan?.name || slug,
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
      status: user?.planoStatus === 'suspended' ? 'SUSPENSO' : (user?.limits?.status || history?.status || 'INATIVO'),
      maxNotas: user?.limits?.limiteNotas ?? history?.limiteNotasContratado ?? 0,
      maxClientes: user?.limits?.limiteClientes ?? history?.limiteClientesContratado ?? 0,
      vencimento,
    };
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'Sem vencimento';
    return date.toLocaleDateString('pt-BR');
  };

  const carregarDados = () => {
    const candidateQuery = new URLSearchParams({ roles: 'COMUM', limit: '25' });
    if (filtroCandidato.trim()) candidateQuery.set('search', filtroCandidato.trim());
    Promise.all([
      fetch(`/api/admin/users?roles=${localStorage.getItem('userRole') === 'MASTER' ? 'MASTER,' : ''}ADMIN,SUPORTE,SUPORTE_TI,COMERCIAL,CONTADOR&limit=25&page=${page}`).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; }),
      fetch(`/api/admin/users?${candidateQuery}`).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; }),
    ]).then(([managed, candidates]) => {
      if (Array.isArray(managed?.data)) { setColabs(managed.data); setTotalPages(managed.meta?.totalPages || 1); setTotalManaged(managed.meta?.total || 0); }
      if (Array.isArray(candidates?.data)) setCandidatos(candidates.data);
      setListError('');
    }).catch(error => { setListError(error instanceof Error ? error.message : 'Falha ao carregar contas.'); });
  };

  useEffect(() => {
    const timer = setTimeout(carregarDados, 250);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filtroCandidato]);

  // --- ABRIR EDIÇÃO ---
  const handleOpenEdit = async (userId: string) => {
      setLoadingEdit(true);
      setModalEditOpen(true);
      setCustomerAccess(null);
      setCustomerPlanSelection('');
      
      try {
          const res = await fetch(`/api/admin/users/${userId}`, { headers: {} });
          const data = await res.json();
          
          if (!res.ok) throw new Error(data.error || 'Erro ao carregar detalhes.');
          setSelectedUserFull(data);
          setRoleInput(data.role);
          setEditLimit(data.limiteEmpresas ?? 5);
          if (['SUPORTE', 'SUPORTE_TI', 'COMERCIAL'].includes(data.role)) {
            const [accessResponse, plansResponse] = await Promise.all([
              fetch(`/api/admin/users/${userId}/acesso-cliente`, { cache: 'no-store' }),
              fetch('/api/plans?visao=admin', { cache: 'no-store' }),
            ]);
            if (!accessResponse.ok) throw new Error('Falha ao consultar acesso de cliente.');
            setCustomerAccess(await accessResponse.json());
            if (plansResponse.ok) {
              const plans = await plansResponse.json();
              setCustomerPlans(Array.isArray(plans) ? plans.filter((plan: any) => ['PLANO', 'CUSTOM'].includes(plan.tipo)) : []);
            }
          }


      } catch (e) {
          dialog.showAlert("Erro ao carregar detalhes.");
          setModalEditOpen(false);
      } finally {
          setLoadingEdit(false);
      }
  };

  const changeCustomerAccess = async () => {
    if (!selectedUserFull || !customerAccess || customerActionPending) return;
    const action = customerAccess.enabled ? 'REVOKE' : 'GRANT';
    const authorization = await solicitarAutorizacaoAdministrativa(action === 'GRANT' ? 'liberar a área do cliente' : 'revogar a área do cliente');
    if (!authorization) return;
    setCustomerActionPending(true);
    try {
      const response = await fetch(`/api/admin/users/${selectedUserFull.id}/acesso-cliente`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...authorization }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível alterar a permissão.');
      setCustomerAccess({ enabled: data.enabled });
      dialog.showAlert({ type: 'success', description: data.enabled ? 'Área do cliente liberada. O plano continua independente.' : 'Área do cliente bloqueada. O contrato não foi alterado.' });
    } catch (error) {
      dialog.showAlert({ type: 'danger', description: error instanceof Error ? error.message : 'Falha na operação.' });
    } finally { setCustomerActionPending(false); }
  };

  const grantCustomerPlan = async () => {
    if (!selectedUserFull || !customerPlanSelection || customerActionPending) return;
    const authorization = await solicitarAutorizacaoAdministrativa('conceder um plano separado ao colaborador');
    if (!authorization) return;
    setCustomerActionPending(true);
    try {
      const response = await fetch('/api/admin/users', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedUserFull.id, operationId: crypto.randomUUID(), plano: customerPlanSelection,
          planoCiclo: 'MENSAL', ...authorization }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível conceder o plano.');
      dialog.showAlert({ type: 'success', description: 'Plano concedido e registrado no histórico, sem criar pagamento.' });
      setCustomerPlanSelection('');
      await handleOpenEdit(selectedUserFull.id);
    } catch (error) {
      dialog.showAlert({ type: 'danger', description: error instanceof Error ? error.message : 'Falha na operação.' });
    } finally { setCustomerActionPending(false); }
  };

  // --- PROMOVER (Novo) ---
  const handlePromover = async () => {
    if (!searchUser) return dialog.showAlert("Selecione um usuário.");
    const authorization = await solicitarAutorizacaoAdministrativa('alterar o papel deste usuario');
    if (!authorization) return;

    try {
        const res = await fetch('/api/admin/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json'},
            body: JSON.stringify({ id: searchUser, role: roleInput, ...authorization })
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
      const authorization = await solicitarAutorizacaoAdministrativa('salvar os acessos e limites deste usuario');
      if (!authorization) return;

      const payload = { role: roleInput, limiteEmpresas: editLimit, ...authorization };

      try {
          // 1. Atualiza Limites e Role (PATCH)
          const res = await fetch(`/api/admin/users/${selectedUserFull.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json'},
              body: JSON.stringify(payload)
          });

          if(res.ok) {
              dialog.showAlert({ type: 'success', description: "Acesso e limite de empresas atualizados. Contratos preservados." });
              setModalEditOpen(false);
              carregarDados();
          } else {
              const error = await res.json();
              dialog.showAlert({ type: 'danger', description: error.error || 'Não foi possível salvar.' });
          }
      } catch(e) { dialog.showAlert("Erro ao salvar."); }
  };

  // --- DESVINCULAR EMPRESA ---
  const handleUnlinkCompany = async (vinculoId: string) => {
      if(!await dialog.showConfirm({ 
          title: 'Desvincular?', 
          description: 'O contador perderá o acesso a esta empresa.',
          type: 'warning'
      })) return;
      
      const authorization = await solicitarAutorizacaoAdministrativa('revogar o vínculo contábil');
      if (!authorization) return;
      const res = await fetch(`/api/contador/vinculo?id=${vinculoId}`, { method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authorization) });
      if (!res.ok) {
          const data = await res.json();
          await dialog.showAlert({ type: 'danger', description: data.error || 'Não foi possível revogar o vínculo.' });
          return;
      }
      
      setSelectedUserFull((prev: any) => ({
          ...prev,
          empresasContabeis: prev.empresasContabeis.filter((v: any) => v.id !== vinculoId)
      }));
  };

  // --- DEMITIR ---
  const handleDemitir = async (id: string) => {
      if(!await dialog.showConfirm({ type: 'danger', title: 'Remover Acesso', description: 'O usuário voltará a ser um cliente comum.' })) return;
      const authorization = await solicitarAutorizacaoAdministrativa('remover o acesso interno deste usuario');
      if (!authorization) return;
      await fetch('/api/admin/users', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json'},
          body: JSON.stringify({ id, role: 'COMUM', ...authorization })
      });
      carregarDados();
  }

  const candidatosFiltrados = candidatos.filter(c => c.nome.toLowerCase().includes(filtroCandidato.toLowerCase()) || c.email.includes(filtroCandidato));
  const totalContadores = colabs.filter((u) => u.role === 'CONTADOR').length;
  const totalEquipeInterna = colabs.filter((u) => u.role !== 'CONTADOR').length;
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
              <p className="mt-2 text-3xl font-black text-slate-950">{totalManaged}</p>
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
                            <input aria-label="Buscar conta candidata" value={filtroCandidato} className="w-full rounded-xl border border-slate-200 py-3 pl-9 pr-3 text-sm outline-none transition focus:border-blue-300 focus:ring-2 focus:ring-blue-100" placeholder="Nome ou Email..." onChange={e => setFiltroCandidato(e.target.value)}/>
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
                      <p className="mt-1 text-sm text-slate-500">Acesso e contratos são operações separadas e auditadas.</p>
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

                        </div>
                    </div>

                    {selectedUserFull.role === 'CONTADOR' && selectedPlanInfo && (
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

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-bold">Papel de acesso
                        <select className="block w-full rounded-xl border p-3 mt-1" value={roleInput} onChange={(e) => setRoleInput(e.target.value)}>
                          <option value="COMUM">Usuário comum</option><option value="SUPORTE">Suporte</option>
                          <option value="SUPORTE_TI">Suporte T.I.</option><option value="COMERCIAL">Comercial</option>
                          <option value="CONTADOR">Contador parceiro</option><option value="ADMIN">Administrador</option>
                          <option value="MASTER">Master</option>
                        </select>
                      </label>
                      <label className="text-sm font-bold">Limite de empresas (salvo junto com o acesso)
                        <input type="number" min="0" max="10000" step="1" value={editLimit} onChange={(e) => setEditLimit(Number(e.target.value))} className="block w-full rounded-xl border p-3 mt-1" />
                      </label>
                      <p className="text-sm text-slate-600 sm:col-span-2">Mudar o papel não concede assinatura, não renova prazos e não transfere propriedade de empresas. Salve a promoção antes de conceder benefícios ao contador.</p>
                    </div>
                    {['SUPORTE', 'SUPORTE_TI', 'COMERCIAL'].includes(selectedUserFull.role) && (
                      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                        <h4 className="font-bold text-slate-900">Uso pessoal da área do cliente</h4>
                        <p className="text-sm text-slate-600">O cargo interno não libera acesso à própria empresa. Esta permissão e o plano são concedidos separadamente; empresas de terceiros continuam fora desse acesso.</p>
                        <p className="text-sm font-semibold">Permissão: {customerAccess === null ? 'Carregando...' : customerAccess.enabled ? 'Liberada' : 'Bloqueada'}</p>
                        <button type="button" disabled={!customerAccess || customerActionPending} onClick={changeCustomerAccess}
                          className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-40">
                          {customerAccess?.enabled ? 'Bloquear área do cliente' : 'Liberar área do cliente'}
                        </button>
                        {customerAccess?.enabled && <div className="flex flex-wrap gap-2 border-t pt-3">
                          <label className="sr-only" htmlFor="internal-customer-plan">Plano pessoal</label>
                          <select id="internal-customer-plan" value={customerPlanSelection} onChange={event => setCustomerPlanSelection(event.target.value)}
                            className="min-w-52 flex-1 rounded-lg border px-3 py-2 text-sm">
                            <option value="">Selecione um plano mensal</option>
                            {customerPlans.map(plan => <option key={plan.slug} value={plan.slug}>{plan.name}</option>)}
                          </select>
                          <button type="button" disabled={!customerPlanSelection || customerActionPending} onClick={grantCustomerPlan}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Conceder plano</button>
                        </div>}
                      </section>
                    )}
                    {selectedUserFull.role === 'CONTADOR' && <AccountantBenefitPanel key={selectedUserFull.id} userId={selectedUserFull.id}
                      suspended={selectedUserFull.planoStatus === 'suspended'} onChanged={async () => { await handleOpenEdit(selectedUserFull.id); carregarDados(); }} />}

                    {['COMUM', 'CONTADOR'].includes(selectedUserFull.role) && <AdminAccountCompaniesPanel key={selectedUserFull.id} userId={selectedUserFull.id} onChanged={carregarDados} />}

                    {selectedUserFull.role === 'CONTADOR' && (
                        <div className="rounded-2xl border border-slate-200 p-4">
                            <h4 className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2"><Building2 size={16}/> Carteira de Empresas Ativas ({selectedUserFull._count?.empresasContabeis ?? selectedUserFull.empresasContabeis?.length ?? 0})</h4>
                            {selectedUserFull._count?.empresasContabeis > 50 && <p className="mb-2 text-xs text-slate-600">Mostrando os 50 vínculos ativos mais recentes. Consulte todos em <Link className="underline" href="/admin/vinculos-custodia">Vínculos e custódia</Link>.</p>}
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
      {listError && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">{listError}</p>}
      <div className="saas-table-scroll rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-[760px] w-full text-left text-sm">
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
      <div className="flex items-center justify-end gap-3 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button>
        <span>Página {page} de {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(value => value + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Próxima</button>
      </div>
    </div>
  );
}
