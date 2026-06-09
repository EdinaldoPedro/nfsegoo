'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { User, Save, ArrowLeft, Mail, CreditCard, Settings, Monitor, X, Calendar, TrendingUp, Building2, Plus, KeyRound, Lock, CheckCircle, Loader2 } from 'lucide-react';
import PlanSelector from '@/components/PlanSelector';
import { useAppConfig } from '@/app/contexts/AppConfigContext';
import AppHeader from '@/components/AppHeader';

export default function MinhaContaPage() {
  const router = useRouter();
  const { darkMode, toggleDarkMode, language, changeLanguage } = useAppConfig();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [showPlans, setShowPlans] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailStep, setEmailStep] = useState<'send' | 'confirm'>('send');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailForm, setEmailForm] = useState({ newEmail: '', password: '', code: '' });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  
  // === ESTADOS PARA NOVA EMPRESA ===
  const [showAddPJ, setShowAddPJ] = useState(false);
  const [addingPJ, setAddingPJ] = useState(false);
  const [newPJ, setNewPJ] = useState({ razaoSocial: '', documento: '' });

  const [data, setData] = useState({
    nome: '', email: '', cpf: '', telefone: '',
    perfil: { cargo: '', empresa: '', avatarUrl: '' },
    configuracoes: { darkMode: false, idioma: 'pt-BR', notificacoesEmail: true },
    metadata: { createdAt: '', lastLoginAt: '', ipOrigem: '' },
    planoDetalhado: { 
        nome: '', slug: '', status: '', 
        usoEmissoes: 0, limiteEmissoes: 0, 
        usoClientes: 0, limiteClientes: 0, 
        dataInicio: '', dataFim: '' 
    },
    planoCiclo: 'MENSAL',
    empresasAdicionais: 0,
    listaEmpresas: [] as any[]
  });

  useEffect(() => {
    const userId = localStorage.getItem('userId');

    if (!userId) { router.push('/login'); return; }

    fetch('/api/perfil', { 
        headers: { 'x-user-id': userId } 
    })
      .then(res => {
          if (res.status === 401) { throw new Error("Sessão expirada"); }
          return res.json();
      })
      .then(apiData => {
        setData(prev => ({
            ...prev,
            ...apiData,
            perfil: {
                cargo: apiData.cargo || '', 
                empresa: apiData.razaoSocial || '',
                avatarUrl: ''
            },
            planoDetalhado: apiData.planoDetalhado || prev.planoDetalhado,
            planoCiclo: apiData.planoCiclo || 'MENSAL',
            empresasAdicionais: apiData.empresasAdicionais || 0,
            listaEmpresas: apiData.listaEmpresas || []
        }));

        if (apiData.configuracoes) {
            toggleDarkMode(apiData.configuracoes.darkMode);
            if(apiData.configuracoes.idioma) changeLanguage(apiData.configuracoes.idioma);
        }
        setLoading(false);
      })
      .catch(err => { 
          if(err.message === "Sessão expirada") router.push('/login');
          setLoading(false); 
      });
  }, [router]);
  
  const handlePlanChange = async (newSlug: string, newCiclo: string) => {
    const userId = localStorage.getItem('userId');
    try {
        const res = await fetch('/api/admin/users', { 
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-user-id': userId || ''},
            body: JSON.stringify({ id: userId, plano: newSlug, planoCiclo: newCiclo }) 
        });
        
        if(res.ok) {
            setShowPlans(false);
            setMsg('✅ Plano atualizado! Recarregando...');
            setTimeout(() => window.location.reload(), 1500);
        } else {
            alert("Erro ao alterar plano.");
        }
    } catch(e) { alert("Erro de conexão."); }
  };

  const handleSalvar = async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      const userId = localStorage.getItem('userId');
      try {
        const { planoDetalhado, planoCiclo, listaEmpresas, empresasAdicionais, ...restData } = data;
        const payload = {
            ...restData,
            cargo: restData.perfil.cargo, 
            configuracoes: { ...restData.configuracoes, darkMode: darkMode, idioma: language }
        };

        const res = await fetch('/api/perfil', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-user-id': userId || ''},
          body: JSON.stringify(payload) 
        });
        
        if (res.ok) { 
            setMsg('✅ Salvo!'); setTimeout(() => setMsg(''), 3000); 
        } else {
            const err = await res.json();
            alert("Erro ao salvar: " + (err.error || err.message));
        }
      } catch(e) {
          alert("Erro de conexão."); 
      } finally { setSaving(false); }
  };
  
  // === NOVA FUNÇÃO: CRIAR EMPRESA ADICIONAL ===
  const abrirTrocaEmail = () => {
      setEmailStep('send');
      setEmailError('');
      setEmailForm({ newEmail: '', password: '', code: '' });
      setShowEmailModal(true);
  };

  const handleSendEmailCode = async (e: React.FormEvent) => {
      e.preventDefault();
      setEmailLoading(true);
      setEmailError('');

      try {
          const res = await fetch('/api/auth/verify-email/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  newEmail: emailForm.newEmail,
                  password: emailForm.password
              })
          });
          const response = await res.json().catch(() => ({}));

          if (!res.ok) {
              setEmailError(response.error || 'Nao foi possivel enviar o codigo.');
              return;
          }

          setEmailStep('confirm');
      } catch {
          setEmailError('Erro de conexao.');
      } finally {
          setEmailLoading(false);
      }
  };

  const handleConfirmEmailCode = async (e: React.FormEvent) => {
      e.preventDefault();
      setEmailLoading(true);
      setEmailError('');

      try {
          const res = await fetch('/api/auth/verify-email/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: emailForm.code })
          });
          const response = await res.json().catch(() => ({}));

          if (!res.ok) {
              setEmailError(response.error || 'Nao foi possivel confirmar o codigo.');
              return;
          }

          setData(prev => ({ ...prev, email: emailForm.newEmail.trim().toLowerCase() }));
          setMsg('Email atualizado com sucesso!');
          setShowEmailModal(false);
          setTimeout(() => setMsg(''), 3000);
      } catch {
          setEmailError('Erro de conexao.');
      } finally {
          setEmailLoading(false);
      }
  };

  const handleChangePassword = async () => {
      setPasswordLoading(true);
      setPasswordError('');
      setPasswordSuccess('');

      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
          setPasswordError('A nova senha e a confirmacao nao coincidem.');
          setPasswordLoading(false);
          return;
      }

      try {
          const res = await fetch('/api/auth/change-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(passwordForm)
          });
          const response = await res.json().catch(() => ({}));

          if (!res.ok) {
              setPasswordError(response.error || 'Nao foi possivel alterar a senha.');
              return;
          }

          setPasswordSuccess(response.message || 'Senha alterada com sucesso.');
          setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
          setTimeout(() => setPasswordSuccess(''), 4000);
      } catch {
          setPasswordError('Erro de conexao.');
      } finally {
          setPasswordLoading(false);
      }
  };

  const handleCreatePJ = async (e: React.FormEvent) => {
      e.preventDefault();
      setAddingPJ(true);
      try {
          const res = await fetch('/api/empresas/adicional', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json'},
              body: JSON.stringify(newPJ)
          });
          if(res.ok) {
              alert("Empresa adicionada com sucesso!");
              window.location.reload();
          } else {
              const err = await res.json();
              alert(err.error || "Erro ao adicionar empresa.");
          }
      } catch(e) {
          alert("Erro de conexão.");
      } finally {
          setAddingPJ(false);
      }
  };

  const p = data.planoDetalhado;
  const isIlimitado = p.limiteEmissoes === 0;
  const percentUso = isIlimitado ? 0 : Math.min(100, (p.usoEmissoes / p.limiteEmissoes) * 100);
  const dataFimFormatada = p.dataFim ? new Date(p.dataFim).toLocaleDateString() : 'Vitalício / Recorrente';

  // Lógica de limite de PJs
  const empresasExtrasUsadas = data.listaEmpresas.filter(e => !e.isPrimary).length;
  const limiteAtingido = empresasExtrasUsadas >= data.empresasAdicionais;
  const senhaForte = passwordForm.newPassword.length >= 8 && /[A-Z]/.test(passwordForm.newPassword) && /[0-9]/.test(passwordForm.newPassword) && /[^A-Za-z0-9]/.test(passwordForm.newPassword);
  const senhaPodeSalvar = Boolean(passwordForm.currentPassword && senhaForte && passwordForm.newPassword === passwordForm.confirmPassword);

  if (loading) return (
    <div className="saas-shell flex items-center justify-center">
      <div className="saas-card px-8 py-6 text-center font-bold text-slate-500">Carregando perfil...</div>
    </div>
  );

  return (
    <div className="saas-shell relative transition-colors duration-300">
      <AppHeader
        title="Minha conta"
        subtitle="Gerencie assinatura, dados pessoais e preferências de uso."
        eyebrow="Configurações"
        backHref="/cliente/dashboard"
      />
      
      {/* MODAL PLANOS */}
      {showPlans && (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
             {/* ... conteúdo do modal de planos mantido igual ... */}
             <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto dark:bg-slate-800">
                <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white z-10 dark:bg-slate-800 dark:border-slate-700">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Alterar Assinatura</h2>
                    </div>
                    <button onClick={() => setShowPlans(false)} className="p-2 hover:bg-gray-100 rounded-full transition dark:hover:bg-slate-700">
                        <X size={24} className="text-gray-500 dark:text-gray-400"/>
                    </button>
                </div>
                <div className="p-8 bg-gray-50 dark:bg-slate-900">
                    <PlanSelector currentPlan={p.slug} currentCycle={data.planoCiclo} onSelectPlan={handlePlanChange} />
                </div>
            </div>
         </div>
      )}

      {/* MODAL NOVA EMPRESA */}
      {showAddPJ && (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
             <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden dark:bg-slate-800">
                <div className="p-6 border-b flex justify-between items-center bg-gray-50 dark:bg-slate-900 dark:border-slate-700">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2"><Building2 size={20}/> Novo CNPJ</h2>
                    <button onClick={() => setShowAddPJ(false)} className="p-2 hover:bg-gray-200 rounded-full transition dark:hover:bg-slate-700">
                        <X size={20} className="text-gray-500"/>
                    </button>
                </div>
                <form onSubmit={handleCreatePJ} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Razão Social</label>
                        <input required className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:border-slate-600 dark:text-white" 
                               value={newPJ.razaoSocial} onChange={e => setNewPJ({...newPJ, razaoSocial: e.target.value})} placeholder="Nome da Empresa" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CNPJ</label>
                        <input required className="w-full p-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:border-slate-600 dark:text-white" 
                               value={newPJ.documento} onChange={e => setNewPJ({...newPJ, documento: e.target.value})} placeholder="00.000.000/0000-00" />
                    </div>
                    <button type="submit" disabled={addingPJ} className="w-full py-3 mt-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
                        {addingPJ ? 'Criando...' : 'Vincular Empresa'}
                    </button>
                </form>
             </div>
         </div>
      )}

      {showEmailModal && (
         <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
             <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden dark:bg-slate-800">
                <div className="p-6 border-b flex justify-between items-center bg-gray-50 dark:bg-slate-900 dark:border-slate-700">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <Mail size={20}/> Trocar e-mail
                        </h2>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {emailStep === 'send' ? 'Enviaremos um codigo para o novo endereco.' : `Digite o codigo enviado para ${emailForm.newEmail}.`}
                        </p>
                    </div>
                    <button onClick={() => setShowEmailModal(false)} className="p-2 hover:bg-gray-200 rounded-full transition dark:hover:bg-slate-700">
                        <X size={20} className="text-gray-500"/>
                    </button>
                </div>

                <form onSubmit={emailStep === 'send' ? handleSendEmailCode : handleConfirmEmailCode} className="p-6 space-y-4">
                    {emailError && (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                            {emailError}
                        </div>
                    )}

                    {emailStep === 'send' ? (
                        <>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">E-mail atual</label>
                                <input className="w-full p-2.5 border rounded-lg bg-slate-50 text-slate-500 dark:bg-slate-900 dark:border-slate-600" disabled value={data.email} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Novo e-mail</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        required
                                        type="email"
                                        className="w-full p-2.5 pl-10 border rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:border-slate-600 dark:text-white"
                                        value={emailForm.newEmail}
                                        onChange={e => setEmailForm({...emailForm, newEmail: e.target.value})}
                                        placeholder="novo@email.com"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Senha atual</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        required
                                        type="password"
                                        className="w-full p-2.5 pl-10 border rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-slate-900 dark:border-slate-600 dark:text-white"
                                        value={emailForm.password}
                                        onChange={e => setEmailForm({...emailForm, password: e.target.value})}
                                        placeholder="Confirme sua senha"
                                    />
                                </div>
                            </div>
                            <button type="submit" disabled={emailLoading} className="w-full py-3 mt-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
                                {emailLoading ? <Loader2 className="animate-spin" size={18}/> : <><KeyRound size={18}/> Enviar codigo</>}
                            </button>
                        </>
                    ) : (
                        <>
                            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-blue-800">
                                Codigo valido por 15 minutos. Confira a caixa de entrada e spam.
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Codigo de verificacao</label>
                                <input
                                    required
                                    inputMode="numeric"
                                    maxLength={6}
                                    className="w-full rounded-xl border bg-slate-50 p-4 text-center font-mono text-2xl font-black tracking-[0.28em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:bg-slate-900 dark:border-slate-600 dark:text-white"
                                    value={emailForm.code}
                                    onChange={e => setEmailForm({...emailForm, code: e.target.value.replace(/\D/g, '')})}
                                    placeholder="000000"
                                />
                            </div>
                            <button type="submit" disabled={emailLoading || emailForm.code.length < 6} className="w-full py-3 mt-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
                                {emailLoading ? <Loader2 className="animate-spin" size={18}/> : <><CheckCircle size={18}/> Confirmar troca</>}
                            </button>
                            <button type="button" onClick={() => { setEmailStep('send'); setEmailError(''); }} className="w-full py-2 text-sm font-bold text-slate-500 hover:text-blue-700">
                                Alterar e-mail ou reenviar codigo
                            </button>
                        </>
                    )}
                </form>
             </div>
         </div>
      )}

      <div className="saas-container max-w-7xl">
        <div className="hidden">
        <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-4">
                <button onClick={() => router.back()} className="p-2 hover:bg-gray-200 rounded-full transition dark:hover:bg-slate-800">
                    <ArrowLeft className="text-gray-600 dark:text-gray-300" />
                </button>
                <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Minha Conta</h1>
            </div>
        </div>
        </div>

        <form onSubmit={handleSalvar}>
          <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
            <div className="space-y-6 xl:sticky xl:top-6">
              
              <div className="saas-card overflow-hidden dark:bg-slate-800 dark:border-slate-700">
                <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-slate-950 p-6 text-white">
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-white/15 text-3xl font-black ring-1 ring-white/20">
                      {data.nome.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-100">Conta</p>
                      <h2 className="mt-1 truncate text-xl font-black">{data.nome}</h2>
                      <p className="mt-1 text-sm text-blue-100">{data.perfil.cargo || 'Cliente'}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3 p-5">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-500 ring-1 ring-slate-100 dark:bg-slate-900 dark:border-slate-700">
                    <p className="font-black uppercase tracking-wider text-slate-400">Email principal</p>
                    <p className="mt-1 truncate font-bold text-slate-800 dark:text-slate-100">{data.email}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-slate-100 bg-white p-4 dark:bg-slate-900 dark:border-slate-700">
                      <p className="text-xs font-black uppercase text-slate-400">CPF</p>
                      <p className="mt-1 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{data.cpf || '-'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-white p-4 dark:bg-slate-900 dark:border-slate-700">
                      <p className="text-xs font-black uppercase text-slate-400">Telefone</p>
                      <p className="mt-1 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{data.telefone || '-'}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* CARD DE ASSINATURA */}
              <div className="saas-card p-6 relative overflow-hidden dark:bg-slate-800 dark:border-slate-700 flex flex-col gap-5">
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400"></div>
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="text-sm font-black text-gray-400 uppercase tracking-wider flex items-center gap-2 dark:text-gray-500"><CreditCard size={14}/> Assinatura</h3>
                    <p className="mt-2 text-2xl font-black text-slate-800 dark:text-white">{p.nome || 'Plano não definido'}</p>
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{data.planoCiclo}</p>
                  </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${p.status === 'ATIVO' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{p.status}</span>
                </div>
               <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-sm space-y-4 dark:bg-slate-900 dark:border-slate-700">
                    
                    {/* BARRA 1: EMISSÕES DE NOTAS */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-slate-500 flex items-center gap-1"><TrendingUp size={12}/> Emissões de Notas</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{p.usoEmissoes} / {isIlimitado ? '∞' : p.limiteEmissoes}</span>
                        </div>
                        {!isIlimitado && (
                            <div className="w-full bg-slate-200 rounded-full h-2 dark:bg-slate-700">
                                <div className={`h-2 rounded-full transition-all duration-500 ${percentUso > 80 ? 'bg-red-500' : 'bg-blue-500'}`} style={{width: `${percentUso}%`}}></div>
                            </div>
                        )}
                    </div>

                    {/* BARRA 2: LIMITE DE CLIENTES */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-slate-500 flex items-center gap-1"><User size={12}/> Limite de Clientes</span>
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{p.usoClientes} / {p.limiteClientes === 0 ? '∞' : p.limiteClientes}</span>
                        </div>
                        {p.limiteClientes > 0 && (
                            <div className="w-full bg-slate-200 rounded-full h-2 dark:bg-slate-700">
                                <div className={`h-2 rounded-full transition-all duration-500 ${Math.min(100, (p.usoClientes / p.limiteClientes) * 100) > 80 ? 'bg-red-500' : 'bg-purple-500'}`} style={{width: `${Math.min(100, (p.usoClientes / p.limiteClientes) * 100)}%`}}></div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700 pt-2">
                        <Calendar size={14} className="text-slate-400"/>
                        <span>Expira em: <strong>{dataFimFormatada}</strong></span>
                    </div>
                </div>
                <button type="button" onClick={() => setShowPlans(true)} className="saas-btn-secondary w-full">
                    Trocar de Plano
                </button>
              </div>

              {/* === NOVO: CARD DE MÚLTIPLAS EMPRESAS === */}
              {data.empresasAdicionais > 0 && (
                  <div className="saas-card p-6 dark:bg-slate-800 dark:border-slate-700 flex flex-col gap-4">
                      <div className="flex justify-between items-start gap-4">
                          <div>
                            <h3 className="text-sm font-black text-gray-400 uppercase tracking-wider flex items-center gap-2 dark:text-gray-500"><Building2 size={14}/> CNPJs extras</h3>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Empresas adicionais vinculadas ao plano.</p>
                          </div>
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">{empresasExtrasUsadas}/{data.empresasAdicionais}</span>
                      </div>
                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 dark:bg-slate-900 dark:border-slate-700">
                          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700">
                            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(100, (empresasExtrasUsadas / Math.max(1, data.empresasAdicionais)) * 100)}%` }}></div>
                          </div>
                      </div>
                      <button 
                          type="button" 
                          onClick={() => setShowAddPJ(true)} 
                          disabled={limiteAtingido}
                          className="saas-btn-secondary w-full disabled:opacity-50"
                      >
                          <Plus size={16}/> Adicionar Empresa
                      </button>
                      {limiteAtingido && <p className="text-[10px] text-red-500 text-center">Você atingiu o limite de empresas. Adquira mais pacotes para adicionar.</p>}
                  </div>
              )}

            </div>

            <div className="grid grid-cols-1 gap-6">
              <div className="saas-card order-2 p-6 dark:bg-slate-800 dark:border-slate-700">
                <div className={`flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between ${showPasswordForm ? 'mb-6' : ''}`}>
                    <h3 className="saas-section-title flex items-center gap-2 dark:text-white"><Lock size={20}/> Segurança da conta</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Atualize sua senha apenas quando necessário.</p>
                    {!showPasswordForm && (
                        <button
                            type="button"
                            onClick={() => {
                                setPasswordError('');
                                setPasswordSuccess('');
                                setShowPasswordForm(true);
                            }}
                            className="saas-btn-secondary justify-center"
                        >
                            <KeyRound size={18}/>
                            Alterar senha
                        </button>
                    )}
                </div>

                {false && !showPasswordForm && (
                    <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                            <p className="text-xs font-black uppercase tracking-wider text-slate-400">Senha</p>
                            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">Protegida</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900">
                            <p className="text-xs font-black uppercase tracking-wider text-slate-400">Recomendação</p>
                            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">Use uma senha forte</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setPasswordError('');
                                setPasswordSuccess('');
                                setShowPasswordForm(true);
                            }}
                            className="saas-btn-secondary justify-center"
                        >
                            <KeyRound size={18}/>
                            Alterar senha
                        </button>
                    </div>
                )}

                {showPasswordForm && (
                <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Senha atual</label>
                        <input
                            type="password"
                            className="saas-input dark:bg-slate-900 dark:border-slate-600 dark:text-white"
                            value={passwordForm.currentPassword}
                            onChange={e => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                            autoComplete="current-password"
                            placeholder="Senha atual"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nova senha</label>
                        <input
                            type="password"
                            className="saas-input dark:bg-slate-900 dark:border-slate-600 dark:text-white"
                            value={passwordForm.newPassword}
                            onChange={e => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                            autoComplete="new-password"
                            placeholder="Nova senha"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Confirmar senha</label>
                        <input
                            type="password"
                            className="saas-input dark:bg-slate-900 dark:border-slate-600 dark:text-white"
                            value={passwordForm.confirmPassword}
                            onChange={e => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                            autoComplete="new-password"
                            placeholder="Repita a senha"
                        />
                    </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:bg-slate-900 dark:border-slate-700">
                    <div className="flex flex-col gap-2 text-xs font-bold text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                        <span className={passwordForm.newPassword.length >= 8 ? 'text-emerald-600' : ''}>8+ caracteres</span>
                        <span className={/[A-Z]/.test(passwordForm.newPassword) ? 'text-emerald-600' : ''}>1 maiúscula</span>
                        <span className={/[0-9]/.test(passwordForm.newPassword) ? 'text-emerald-600' : ''}>1 número</span>
                        <span className={/[^A-Za-z0-9]/.test(passwordForm.newPassword) ? 'text-emerald-600' : ''}>1 especial</span>
                    </div>
                    {(passwordError || passwordSuccess) && (
                        <p className={`text-sm font-bold ${passwordError ? 'text-red-600' : 'text-emerald-600'}`}>
                            {passwordError || passwordSuccess}
                        </p>
                    )}
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={() => {
                            setShowPasswordForm(false);
                            setPasswordError('');
                            setPasswordSuccess('');
                            setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                        }}
                        className="saas-btn-secondary justify-center"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleChangePassword}
                        disabled={passwordLoading || !senhaPodeSalvar}
                        className="saas-btn-primary justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {passwordLoading ? <Loader2 className="animate-spin" size={18}/> : <KeyRound size={18}/>}
                        Confirmar alteração
                    </button>
                </div>
                </>
                )}
              </div>

              <div className="saas-card order-4 p-8 dark:bg-slate-800 dark:border-slate-700">
                <h3 className="saas-section-title mb-4 flex items-center gap-2 dark:text-white"><CheckCircle size={20}/> Documentos e termos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Link href="/termos-de-uso" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200">
                        Termos de uso
                        <p className="mt-1 text-xs font-medium text-slate-500">Condições de acesso, uso da plataforma e responsabilidades.</p>
                    </Link>
                    <Link href="/politica-de-privacidade" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200">
                        Política de privacidade
                        <p className="mt-1 text-xs font-medium text-slate-500">Tratamento de dados pessoais, fiscais e certificados digitais.</p>
                    </Link>
                </div>
              </div>

              <div className="saas-card order-1 p-8 dark:bg-slate-800 dark:border-slate-700">
                <h3 className="saas-section-title mb-6 flex items-center gap-2 dark:text-white"><User size={20}/> Dados pessoais</h3>
                {/* ... Campos de dados pessoais (iguais aos que você já tinha) ... */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome Completo</label>
                        <input className="saas-input dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={data.nome} onChange={e => setData({...data, nome: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                        <div className="flex gap-2">
                            <input className="saas-input bg-gray-50 text-gray-500 cursor-not-allowed dark:bg-slate-700 dark:border-slate-600" disabled value={data.email} />
                            <button
                                type="button"
                                onClick={abrirTrocaEmail}
                                className="shrink-0 rounded-xl border border-blue-200 bg-blue-50 px-4 text-xs font-black text-blue-700 transition hover:bg-blue-100"
                            >
                                Trocar
                            </button>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CPF</label>
                        <input className="saas-input bg-gray-50 text-gray-500 cursor-not-allowed dark:bg-slate-700 dark:border-slate-600" disabled value={data.cpf} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Telefone</label>
                        <input className="saas-input dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={data.telefone || ''} onChange={e => setData({...data, telefone: e.target.value})} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cargo</label>
                        <input className="saas-input dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={data.perfil.cargo} onChange={e => setData({...data, perfil: {...data.perfil, cargo: e.target.value}})} />
                    </div>
                </div>
              </div>

              <div className="saas-card order-3 p-8 dark:bg-slate-800 dark:border-slate-700">
                <h3 className="saas-section-title mb-6 flex items-center gap-2 dark:text-white"><Settings size={20}/> Preferências</h3>
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-2xl cursor-pointer hover:bg-slate-50 transition dark:border-slate-600" onClick={() => toggleDarkMode(!darkMode)}>
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-gray-100 rounded-full dark:bg-slate-600"><Monitor size={18} className="text-gray-600 dark:text-gray-300"/></div>
                            <div>
                                <p className="font-medium text-sm text-gray-800 dark:text-white">Modo Escuro (Dark Mode)</p>
                            </div>
                        </div>
                        <div className={`w-10 h-5 rounded-full p-1 transition-colors ${darkMode ? 'bg-blue-600' : 'bg-gray-300'}`}>
                            <div className={`bg-white w-3 h-3 rounded-full transform transition-transform ${darkMode ? 'translate-x-5' : ''}`}></div>
                        </div>
                    </div>
                    <div className="pt-2">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Idioma</label>
                        <select className="saas-input bg-white dark:bg-slate-900 dark:border-slate-600 dark:text-white" value={language} onChange={e => changeLanguage(e.target.value as any)}>
                            <option value="pt-BR">Português</option>
                            <option value="en-US">English</option>
                        </select>
                    </div>
                </div>
              </div>

              <div className="order-5 sticky bottom-4 z-10 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-xl shadow-slate-200/70 backdrop-blur md:flex-row md:items-center md:justify-between dark:border-slate-700 dark:bg-slate-800/95 dark:shadow-none">
                <span className={`text-sm font-bold transition-opacity ${msg ? 'opacity-100' : 'opacity-70'} ${msg.toLowerCase().includes('erro') ? 'text-red-600' : 'text-slate-500 dark:text-slate-300'}`}>{msg || 'Altere os dados necessários e confirme para salvar sua conta.'}</span>
                <button type="submit" disabled={saving} className="saas-btn-primary justify-center disabled:opacity-70 dark:shadow-none">
                  {saving ? 'Salvando...' : <><Save size={20} /> Salvar Alterações</>}
                </button>
              </div>

            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
