'use client';
import { useEffect, useState, useRef } from 'react';
import { 
    Search, LogIn, CreditCard, Edit, Save, X, Building2, Unlink, 
    RefreshCw, KeyRound, AlertTriangle, ShieldCheck,
    History, Clock, CheckCircle, UserCog, User, PackagePlus, FileCheck2, Download, XCircle
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminAccountCompaniesPanel from '@/components/AdminAccountCompaniesPanel';
import { useDialog } from '@/app/contexts/DialogContext';

export default function GestaoClientes() {
  const router = useRouter();
  const dialog = useDialog();
  
  const [clientes, setClientes] = useState<any[]>([]);
  const [planosDisponiveis, setPlanosDisponiveis] = useState<any[]>([]);
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [listError, setListError] = useState('');
  
  const [editingUser, setEditingUser] = useState<any>(null);
  
  // === ESTADOS PARA MODAL DE CONFIRMAÇÃO (AUDITORIA) ===
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [operationId, setOperationId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingContractAction, setPendingContractAction] = useState<'plano' | 'pacote' | null>(null);

  // === ESTADOS PARA HISTÓRICO DE PLANOS ===
  const [historyUser, setHistoryUser] = useState<any>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyError, setHistoryError] = useState('');
  const historyRequest = useRef(0);
  const opcoesPlanoBase = (planosDisponiveis || []).flatMap((p: any) => {
      if (p.tipo && p.tipo !== 'PLANO') return [];
      if (Number(p.priceMonthly) === 0 && Number(p.priceYearly) > 0) {
          return [{ value: `${p.slug}|ANUAL`, label: `${p.name} Anual` }];
      }
      if (Number(p.priceMonthly) === 0) {
          return [{ value: `${p.slug}|MENSAL`, label: `${p.name} (Gratuito)` }];
      }
      return [{ value: `${p.slug}|MENSAL`, label: `${p.name} Mensal` }];
  });
  const opcoesPacotes = (planosDisponiveis || []).flatMap((p: any) => {
      if (!p.tipo || p.tipo === 'PLANO') return [];
      return [{ value: `${p.slug}|AVULSO`, label: p.name }];
  });

  useEffect(() => {
    // Busca planos com proteção contra erro
    fetch('/api/plans?visao=admin', { 
        cache: 'no-store'
    })
    .then(r => r.json())
    .then(data => {
        if (Array.isArray(data)) setPlanosDisponiveis(data);
        else setPlanosDisponiveis([]);
    })
    .catch(() => setPlanosDisponiveis([]));
    
  }, []);

  const carregarUsuarios = () => {
    const query = new URLSearchParams({ roles: 'COMUM', limit: '25', page: String(page) });
    if (term.trim()) query.set('search', term.trim());
    setListError('');
    fetch(`/api/admin/users?${query}`, { cache: 'no-store' }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Não foi possível carregar as contas.');
      if (Array.isArray(data?.data)) { setClientes(data.data); setTotalPages(data.meta?.totalPages || 1); }
    }).catch(error => { setClientes([]); setListError(error instanceof Error ? error.message : 'Falha ao carregar.'); });
  };
  useEffect(() => {
    const timer = setTimeout(carregarUsuarios, 250);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, term]);

  // --- 1. ABRIR MODAL DE CONFIRMAÇÃO ---
  const handlePreSaveUser = (action: 'plano' | 'pacote') => {
      if (!editingUser) return;
      if (action === 'plano' && !editingUser.planoCombinado) return;
      if (action === 'pacote' && !editingUser.pacoteCombinado) {
          return dialog.showAlert({ type: 'warning', description: 'Selecione um pacote para adicionar.' });
      }

      setPendingContractAction(action);
      setOperationId(crypto.randomUUID());
      setShowConfirmModal(true);
  };

  // --- 2. SALVAR COM AUDITORIA ---
  const handleConfirmChange = async () => {
      if(!justificativa || justificativa.trim().length < 10) return dialog.showAlert({type:'warning', description: 'Digite uma justificativa com pelo menos dez caracteres.'});
      if(!adminPassword) return dialog.showAlert({type:'warning', description: 'Digite sua senha.'});
      if (!pendingContractAction) return;

      setIsProcessing(true);
      const origemContrato = pendingContractAction === 'pacote' ? editingUser.pacoteCombinado : editingUser.planoCombinado;
      const [slug, ciclo] = origemContrato.split('|');

      try {
          const res = await fetch('/api/admin/users', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ 
                  id: editingUser.id, 
                  operationId,
                  plano: slug,
                  planoCiclo: ciclo,
                  justification: justificativa,
                  adminPassword: adminPassword
              })
          });

          if(res.ok) {
              setShowConfirmModal(false);
              setPendingContractAction(null);
              setEditingUser(null);
              setJustificativa('');
              setAdminPassword('');
              carregarUsuarios();
              dialog.showAlert({ type: 'success', title: pendingContractAction === 'pacote' ? 'Pacote adicionado' : 'Plano atualizado', description: pendingContractAction === 'pacote' ? 'O pacote foi adicionado e registrado no histórico.' : 'O plano foi atualizado e registrado no histórico.' });
          } else {
              const err = await res.json();
              dialog.showAlert({ type: 'danger', title: 'Falha ao atualizar contrato', description: err.error || 'A API não concluiu a gravação.' });
          }
      } catch (error) { 
          dialog.showAlert("Erro de conexão."); 
      } finally { 
          setIsProcessing(false); 
      }
  };

  // --- FUNÇÕES UTILITÁRIAS ---
  const solicitarAutorizacaoAdministrativa = async (acao: string) => {
      const justification = await dialog.showPrompt({
          title: 'Justificativa obrigatoria',
          description: `Descreva o motivo para ${acao}. Esta operacao sera auditada.`,
          placeholder: 'Informe o motivo com ao menos 10 caracteres',
          confirmText: 'Continuar',
      });
      if (!justification) return null;
      if (justification.trim().length < 10) {
          await dialog.showAlert({ type: 'warning', description: 'A justificativa precisa ter ao menos 10 caracteres.' });
          return null;
      }
      const password = await dialog.showPrompt({
          title: 'Confirme sua identidade',
          description: 'Digite sua senha administrativa para autorizar esta operacao.',
          placeholder: 'Senha administrativa',
          inputType: 'password',
          confirmText: 'Autorizar',
      });
      if (!password) return null;
      return { justification: justification.trim(), adminPassword: password };
  };

  const handleSendReset = async () => { await fetch('/api/auth/forgot-password', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ email: editingUser.email }) }); dialog.showAlert("Email enviado."); };
  
  const abrirEdicao = (user: any) => {
      // Opening a dialog is never a request to suspend, renew or grant a plan.
      setEditingUser({ ...user, planoCombinado: '', pacoteCombinado: '' });
      setJustificativa(''); setAdminPassword(''); setPendingContractAction(null);
  }

  // === 3. ABRIR HISTÓRICO ===
  const abrirHistorico = async (user: any, page = 1) => {
      const requestId = ++historyRequest.current;
      setHistoryUser(user); setHistoryPage(page); setLoadingHistory(true); setHistoryError(''); setHistoryData([]);
      try {
          const res = await fetch(`/api/admin/users/${user.id}/history?page=${page}`);
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Falha ao carregar histórico.');
          if (requestId !== historyRequest.current) return;
          setHistoryTotal(Number(res.headers.get('X-Total-Count') || 0));
          setHistoryData(Array.isArray(json) ? json : []);
      } catch (error) {
          if (requestId === historyRequest.current) setHistoryError(error instanceof Error ? error.message : 'Falha de conexão.');
      } finally { if (requestId === historyRequest.current) setLoadingHistory(false); }
  };

  const acessarSuporte = async (targetId: string) => {
    const adminId = localStorage.getItem('userId');
    const adminRole = localStorage.getItem('userRole');
    
    // VERIFICAÇÃO DE SEGURANÇA:
    // Só salva o backup se NÃO estivermos já em modo suporte.
    // Isso impede que salvemos o ID do cliente como se fosse o Admin.
    const jaEstaEmSuporte = localStorage.getItem('isSupportMode');

    if (adminId && !jaEstaEmSuporte) {
        localStorage.setItem('adminBackUpId', adminId);
        if (adminRole) localStorage.setItem('adminBackUpRole', adminRole);
    }

    const reason = await dialog.showPrompt({
      title: 'Justificativa do acesso',
      description: 'Informe por que precisa visualizar a conta. O acesso sera somente leitura e auditado.',
      placeholder: 'Ex.: investigar o ticket 1234 informado pelo cliente',
      confirmText: 'Continuar',
    });
    if (!reason) return;
    if (reason.trim().length < 10) {
      return dialog.showAlert({ type: 'warning', description: 'Informe uma justificativa com ao menos 10 caracteres.' });
    }

    const password = await dialog.showPrompt({
      title: 'Confirme sua identidade',
      description: 'Digite sua senha administrativa para iniciar a sessao de suporte por 30 minutos.',
      placeholder: 'Senha administrativa',
      inputType: 'password',
      confirmText: 'Iniciar acesso',
    });
    if (!password) return;

    try {
        const res = await fetch('/api/admin/impersonate', { 
            method: 'POST', 
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ targetUserId: targetId, reason: reason.trim(), password })
        });

        if (res.status === 401) {
            await dialog.showAlert({ type: 'warning', title: 'Sessão administrativa expirada', description: 'Autentique-se novamente antes de iniciar a impersonação.' });
            router.push('/login');
            return;
        }

        const data = await res.json();
        
        if(data.success) { 
            localStorage.setItem('userId', data.fakeSession.id); 
            localStorage.setItem('userRole', data.fakeSession.role); 
            localStorage.setItem('isSupportMode', 'true'); 
            localStorage.setItem('supportModeExpiresAt', data.expiresAt);
            
            // Remove contexto de empresa antiga para forçar o reload dos dados do cliente
            localStorage.removeItem('empresaContextId');

            router.push('/cliente/dashboard'); 
        } else {
            await dialog.showAlert({ type: 'danger', title: 'Falha ao acessar conta', description: data.error || 'A impersonação não foi iniciada.' });
        }
    } catch (e) {
        await dialog.showAlert({ type: 'danger', title: 'Falha de conexão', description: 'Não foi possível alcançar a API de impersonação.' });
    }
  };

  const filtered = clientes.filter(c => c.nome.toLowerCase().includes(term.toLowerCase()) || c.email.includes(term));
  const pacotesAtivosEdicao = (editingUser?.planHistories || []).filter((history: any) => history.plan?.tipo && history.plan.tipo !== 'PLANO');

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Clientes (SaaS)</h1>
        <div className="relative">
            <Search className="absolute left-3 top-3 text-slate-400" size={18} />
            <input aria-label="Buscar cliente" value={term} placeholder="Buscar cliente..." className="pl-10 p-2 border rounded-lg w-64" onChange={e => { setTerm(e.target.value); setPage(1); }} />
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
        <p className="mb-2 text-sm text-blue-900">Concessões administrativas não quitam pedidos. Pagamentos devem ser conferidos na área comercial.</p>
        <Link href="/admin/contratacoes" className="font-semibold text-blue-700 underline">Contratações e pagamentos</Link>
      </div>

      {historyUser && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white p-0 rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
                <div className="p-6 border-b flex justify-between items-center bg-slate-50">
                    <div>
                        <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                            <History className="text-blue-600"/> Histórico de Assinaturas
                        </h3>
                        <p className="text-sm text-slate-500">Cliente: <strong>{historyUser.nome}</strong></p>
                        <div className="flex items-center gap-3 mt-2 text-sm">
                          <button disabled={loadingHistory || historyPage <= 1} onClick={() => abrirHistorico(historyUser, historyPage - 1)} className="border rounded px-2 py-1 disabled:opacity-40">Anterior</button>
                          <span>Página {historyPage} de {Math.max(1, Math.ceil(historyTotal / 30))}</span>
                          <button disabled={loadingHistory || historyPage * 30 >= historyTotal} onClick={() => abrirHistorico(historyUser, historyPage + 1)} className="border rounded px-2 py-1 disabled:opacity-40">Próxima</button>
                        </div>
                    </div>
                    <button onClick={() => setHistoryUser(null)}><X size={24} className="text-slate-400 hover:text-red-500"/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                    {historyError ? <p role="alert" className="text-red-700">{historyError}</p> : loadingHistory ? (
                        <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
                            <RefreshCw className="animate-spin"/> Carregando...
                        </div>
                    ) : historyData.length === 0 ? (
                        <div className="text-center text-slate-400 py-10 flex flex-col items-center">
                            <p>Nenhum registro de histórico encontrado.</p>
                            <p className="text-xs mt-1">Não há contrato verificável nesta página.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {historyData.map((item: any) => (
                                <div key={item.id} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 relative overflow-hidden">
                                    <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${item.origem === 'MANUAL_ADMIN' ? 'bg-amber-500' : 'bg-blue-500'}`}></div>
                                    
                                    <div className="flex-1 pl-2">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-lg font-bold text-slate-800">{item.plano}</span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold border uppercase ${item.status === 'ATIVO' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                                                {item.status}
                                            </span>
                                        </div>
                                        <div className="text-xs text-slate-500 flex flex-wrap gap-4 font-mono">
                                            <span className="flex items-center gap-1"><Clock size={12}/> Início: {item.dataInicio ? new Date(item.dataInicio).toLocaleDateString() : '-'}</span>
                                            {item.dataFim ? (
                                                <span>Fim: {new Date(item.dataFim).toLocaleDateString()}</span>
                                            ) : (
                                                <span className="text-slate-600">Sem vencimento informado</span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="md:w-1/2 md:border-l border-t md:border-t-0 pl-0 md:pl-4 pt-4 md:pt-0 border-slate-100 flex flex-col justify-center">
                                        <div className="flex items-start gap-2">
                                            {item.origem === 'MANUAL_ADMIN' ? (
                                                <UserCog size={18} className="text-amber-600 mt-0.5 shrink-0"/>
                                            ) : (
                                                <CheckCircle size={18} className="text-blue-600 mt-0.5 shrink-0"/>
                                            )}
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase mb-1">
                                                    {item.origem === 'MANUAL_ADMIN' ? `Alterado por: ${item.adminNome}` : item.origem}
                                                </p>
                                                <p className="text-sm text-slate-700 leading-snug italic bg-slate-50 p-2 rounded border border-slate-100">
                                                    "{item.justificativa}"
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* === MODAL DE JUSTIFICATIVA E SENHA (AUDITORIA) === */}
      {showConfirmModal && (
          <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white p-6 rounded-lg shadow-2xl w-full max-w-sm border-t-4 border-amber-500">
                  <div className="flex items-center gap-3 mb-4 text-amber-600">
                      <AlertTriangle size={28}/>
                      <h3 className="font-bold text-lg leading-tight">Auditoria de Alteração</h3>
                  </div>
                  
                  <p className="text-sm text-slate-600 mb-4">
                      Você está alterando manualmente o contrato de um cliente. Essa ação será registrada nos logs do sistema em seu nome.
                  </p>

                  <div className="space-y-3">
                      <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1">Motivo da Alteração (Obrigatório)</label>
                          <textarea 
                              className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                              rows={3}
                              placeholder="Ex.: cortesia aprovada por falha no serviço (pagamentos são conciliados em Contratações)"
                              value={justificativa}
                              onChange={e => setJustificativa(e.target.value)}
                          />
                      </div>
                      
                      <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1">Confirme com SUA Senha</label>
                          <div className="relative">
                              <input 
                                  type="password"
                                  className="w-full pl-8 p-2 border rounded text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                  placeholder="Sua senha de login..."
                                  value={adminPassword}
                                  onChange={e => setAdminPassword(e.target.value)}
                              />
                              <ShieldCheck className="absolute left-2.5 top-2.5 text-slate-400" size={14}/>
                          </div>
                      </div>
                  </div>

                  <div className="flex gap-2 mt-6">
                      <button 
                          onClick={() => {
                              setShowConfirmModal(false);
                              setPendingContractAction(null);
                          }}
                          disabled={isProcessing}
                          className="flex-1 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded transition"
                      >
                          Cancelar
                      </button>
                      <button 
                          onClick={handleConfirmChange}
                          disabled={isProcessing}
                          className="flex-1 py-2 bg-amber-500 text-white font-bold rounded hover:bg-amber-600 transition flex justify-center items-center gap-2"
                      >
                          {isProcessing ? 'Validando...' : 'Confirmar e Salvar'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* MODAL DE EDIÇÃO PRINCIPAL */}
      {editingUser && !showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between mb-4">
                    <h3 className="font-bold text-lg text-slate-800">Gerenciar Cliente</h3>
                    <button aria-label="Fechar gerenciamento" onClick={() => { setEditingUser(null); }}><X size={20}/></button>
                </div>

                <div className="space-y-6">
                    {/* DADOS PESSOAIS */}
                    <div className="bg-gray-50 p-3 rounded border">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Dados Pessoais</label>
                        <p className="font-bold text-slate-700">{editingUser.nome}</p>
                        <p className="text-xs text-slate-500">{editingUser.email}</p>
                        
                        <div className="mt-3">
                             <button onClick={handleSendReset} className="bg-white border border-blue-200 text-blue-600 text-xs font-bold py-2 rounded hover:bg-blue-50 flex items-center justify-center gap-2 transition">
                                <KeyRound size={14}/> Reset Senha
                            </button>
                        </div>
                    </div>

                    <AdminAccountCompaniesPanel key={editingUser.id} userId={editingUser.id} onChanged={carregarUsuarios} />

                    {/* PLANO */}
                    <div className="border-t pt-4">
                        <label htmlFor="admin-plan-action" className="block text-xs font-bold text-green-700 uppercase mb-2 flex items-center gap-2">
                            <CreditCard size={16}/> Plano base
                        </label>
                        <select 
                            id="admin-plan-action"
                            className="w-full p-2 border rounded bg-white text-slate-800 focus:ring-2 focus:ring-green-500 text-sm"
                            value={editingUser.planoCombinado}
                            onChange={e => setEditingUser({...editingUser, planoCombinado: e.target.value})}
                        >
                            <option value="">Selecione explicitamente uma ação ou plano</option>
                            <option value="SUSPENDED|MENSAL" className="text-red-600 font-bold bg-red-50">Suspender operações (preservar contrato)</option>
                            <option value="REACTIVATE|MENSAL">Reativar acesso (sem renovar prazo)</option>
                            {opcoesPlanoBase.map((opcao: any) => (
                                <option key={opcao.value} value={opcao.value}>{opcao.label}</option>
                            ))}
                        </select>
                        <p className="text-[11px] text-slate-500 mt-2">
                            Escolher uma empresa não altera o contrato. Concessões, suspensão e reativação exigem uma ação separada e confirmada.
                        </p>
                    </div>

                    <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
                        <label className="block text-xs font-bold text-blue-700 uppercase mb-2 flex items-center gap-2">
                            <PackagePlus size={16}/> Pacotes avulsos
                        </label>
                        <select
                            className="w-full p-2 border rounded bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 text-sm"
                            value={editingUser.pacoteCombinado || ''}
                            onChange={e => setEditingUser({ ...editingUser, pacoteCombinado: e.target.value })}
                        >
                            <option value="">Selecione um pacote para adicionar</option>
                            {opcoesPacotes.map((opcao: any) => (
                                <option key={opcao.value} value={opcao.value}>{opcao.label}</option>
                            ))}
                        </select>
                        <p className="text-[11px] text-slate-500 mt-2">
                            Pacotes avulsos somam ao contrato atual sem substituir o plano base. Para liberar mais de uma unidade, repita a operacao.
                        </p>

                        {pacotesAtivosEdicao.length > 0 && (
                            <div className="mt-3">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Pacotes ativos</p>
                                <div className="flex flex-wrap gap-2">
                                    {pacotesAtivosEdicao.map((history: any) => (
                                        <span key={history.id} className="rounded-full border border-blue-200 bg-white px-2 py-1 text-[11px] font-bold text-blue-700">
                                            {history.plan?.name || history.plan?.slug}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end mt-3">
                            <button
                                onClick={() => handlePreSaveUser('pacote')}
                                disabled={!opcoesPacotes.length}
                                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex items-center gap-2 font-bold shadow-lg shadow-blue-100 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <PackagePlus size={18}/> Adicionar pacote
                            </button>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
                        <button disabled={!editingUser.planoCombinado} onClick={() => handlePreSaveUser('plano')} className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 flex items-center gap-2 font-bold shadow-lg shadow-green-100 transition disabled:opacity-50">
                            <Save size={18}/> Salvar plano
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* TABELA */}
      {listError && <p role="alert" className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">{listError}</p>}
      <div className="saas-table-scroll rounded-xl border bg-white shadow-sm">
        <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-slate-50 border-b">
                <tr>
                    <th className="p-4">Cliente</th>
                    <th className="p-4">Empresa</th>
                    <th className="p-4">Plano</th>
                    <th className="p-4 text-right">Ações</th>
                </tr>
            </thead>
            <tbody>
                {filtered.map(cli => (
                    <tr key={cli.id} className="border-b hover:bg-slate-50 transition">
                        <td className="p-4">
                            <p className="font-bold text-slate-800">{cli.nome}</p>
                            <p className="text-xs text-slate-500">{cli.email}</p>
                        </td>
                        <td className="p-4">
                            {cli.empresa ? (
                                <div>
                                    <p className="font-medium text-slate-700 text-xs line-clamp-1">{cli.empresa.razaoSocial}</p>
                                    <p className="text-[10px] text-slate-500 font-mono bg-slate-100 inline-block px-1 rounded mt-1">{cli.empresa.documento}</p>
                                </div>
                            ) : <span className="text-orange-400 text-xs font-bold bg-orange-50 px-2 py-1 rounded">Pendente</span>}
                        </td>
                        <td className="p-4">
                            {cli.plano === 'SEM_PLANO' || cli.planoStatus === 'suspended' ? (
                                <span className="flex items-center gap-1 w-fit text-red-700 bg-red-50 px-2 py-1 rounded text-[10px] font-bold border border-red-200 uppercase">
                                    SUSPENSO ⛔
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 w-fit text-green-700 bg-green-50 px-2 py-1 rounded text-[10px] font-bold border border-green-200 uppercase">
                                    {cli.plano} {cli.planoCiclo === 'ANUAL' ? '(A)' : '(M)'}
                                </span>
                            )}
                        </td>
                        <td className="p-4 text-right flex justify-end gap-2 items-center">
                            {/* BOTÃO HISTÓRICO */}
                            <button 
                                onClick={() => abrirHistorico(cli)} 
                                className="text-slate-600 hover:bg-slate-100 p-2 border border-slate-200 rounded transition" 
                                title="Histórico de Assinaturas"
                            >
                                <History size={16}/>
                            </button>
                            
                            <button onClick={() => abrirEdicao(cli)} className="text-blue-600 hover:bg-blue-50 p-2 border border-blue-100 rounded transition" title="Gerenciar">
                                <Edit size={16}/>
                            </button>
                            <button 
                                onClick={() => acessarSuporte(cli.id)}
                                className="bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded text-xs font-bold flex items-center gap-2 transition"
                                title="Acessar como este cliente"
                            >
                                <LogIn size={14}/>
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3 text-sm">
        <button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Anterior</button>
        <span>Página {page} de {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage(value => value + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Próxima</button>
      </div>
    </div>
  );
}
