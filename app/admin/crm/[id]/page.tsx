'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, Clock, MessageSquare, Activity, Mail, Send, AlertCircle, Building2, FileCheck, Wrench, ShieldCheck } from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';

export default function PerfilCrmCliente() {
    const params = useParams();
    const router = useRouter();
    const dialog = useDialog();

    const [user, setUser] = useState<any>(null);
    const [eventos, setEventos] = useState<any[]>([]);
    const [diagnostico, setDiagnostico] = useState<any>(null);
    const [novaNota, setNovaNota] = useState('');
    const [loading, setLoading] = useState(true);

    const carregarDados = async () => {
        setLoading(true);
        const token = localStorage.getItem('token');
        try {
            // 1. Busca os dados do utilizador
            const resUser = await fetch(`/api/admin/users/${params.id}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (resUser.ok) setUser(await resUser.json());

            // 2. Busca a Linha do Tempo (Eventos CRM)
            const resEventos = await fetch(`/api/admin/users/${params.id}/events`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (resEventos.ok) setEventos(await resEventos.json());

            const resDiagnostico = await fetch(`/api/admin/users/${params.id}/diagnostico`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (resDiagnostico.ok) setDiagnostico(await resDiagnostico.json());
        } catch (error) {
            dialog.showAlert('Erro ao carregar dados do CRM.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        carregarDados();
    }, [params.id]);

    const handleAdicionarNota = async () => {
        if (!novaNota.trim()) return;
        const token = localStorage.getItem('token');

        try {
            const res = await fetch(`/api/admin/users/${params.id}/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    titulo: 'Anotação Manual',
                    descricao: novaNota,
                    tipo: 'MANUAL'
                })
            });

            if (res.ok) {
                setNovaNota('');
                carregarDados(); // Recarrega a timeline
                dialog.showAlert({ type: 'success', description: 'Anotação registada com sucesso!' });
            }
        } catch (error) {
            dialog.showAlert('Erro ao salvar anotação.');
        }
    };

    // Função auxiliar para definir ícones e cores com base no tipo de evento
    const getEstiloEvento = (tipo: string) => {
        switch (tipo) {
            case 'MANUAL': return { icone: <MessageSquare size={16} />, cor: 'bg-purple-100 text-purple-600', borda: 'border-purple-200' };
            case 'FINANCEIRO': return { icone: <CreditCard size={16} />, cor: 'bg-emerald-100 text-emerald-600', borda: 'border-emerald-200' };
            case 'EMAIL': return { icone: <Mail size={16} />, cor: 'bg-orange-100 text-orange-600', borda: 'border-orange-200' };
            case 'SISTEMA': default: return { icone: <Activity size={16} />, cor: 'bg-blue-100 text-blue-600', borda: 'border-blue-200' };
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">A carregar perfil 360º...</div>;
    if (!user) return <div className="p-8 text-center text-red-500">Utilizador não encontrado.</div>;

    const planoAtivo = user.planHistories?.find((h: any) => h.status === 'ATIVO');
    const limites = diagnostico?.limites;
    const problemas = diagnostico?.problemas || [];
    const resumo = diagnostico?.resumo || {};
    const totalEmpresasOperacionais = (resumo.empresasProprietarias || 0) + (resumo.empresasCustodiadas || 0);

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            {/* CABEÇALHO */}
            <div className="flex items-center gap-4 mb-8">
                <button onClick={() => router.back()} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full transition text-slate-600">
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Visão 360º do Cliente</h1>
                    <p className="text-sm text-slate-500">Gestão de relacionamento e histórico da conta.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* COLUNA ESQUERDA: DADOS DO CLIENTE E PLANO */}
                <div className="lg:col-span-1 space-y-6">
                    {/* Cartão de Perfil */}
                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold text-xl">
                                {user.nome.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h2 className="font-bold text-slate-800 text-lg leading-tight">{user.nome}</h2>
                                <p className="text-sm text-slate-500">{user.email}</p>
                            </div>
                        </div>
                        <div className="border-t pt-4 space-y-2 text-sm">
                            <div className="flex justify-between"><span className="text-slate-500">Telefone:</span> <span className="font-medium">{user.telefone || 'Não informado'}</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Status:</span> 
                                <span className={`font-bold uppercase ${user.status === 'active' ? 'text-emerald-600' : 'text-red-500'}`}>{user.status}</span>
                            </div>
                            <div className="flex justify-between"><span className="text-slate-500">Perfil:</span> <span className="font-medium bg-slate-100 px-2 py-0.5 rounded text-xs">{user.role}</span></div>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <ShieldCheck size={18} className="text-blue-600" />
                                Raio-X operacional
                            </h3>
                            <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${problemas.length ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {problemas.length ? `${problemas.length} atenções` : 'OK'}
                            </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-4">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
                                    <FileCheck size={14} /> NFS-e
                                </div>
                                <p className="text-lg font-black text-slate-900 mt-1">
                                    {limites ? `${limites.notasUsadas}/${limites.limiteNotas || '∞'}` : '--'}
                                </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
                                    <Building2 size={14} /> Empresas
                                </div>
                                <p className="text-lg font-black text-slate-900 mt-1">{totalEmpresasOperacionais}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
                                    <Wrench size={14} /> Tickets
                                </div>
                                <p className="text-lg font-black text-slate-900 mt-1">{resumo.ticketsAbertos || 0}</p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400">
                                    <AlertCircle size={14} /> Erros
                                </div>
                                <p className="text-lg font-black text-slate-900 mt-1">{resumo.logsErroRecentes || 0}</p>
                            </div>
                        </div>

                        {problemas.length > 0 ? (
                            <div className="space-y-2 mb-4">
                                {problemas.slice(0, 3).map((problema: any, index: number) => (
                                    <div key={`${problema.tipo}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                                        <p className="text-xs font-black uppercase text-amber-700">{problema.tipo}</p>
                                        <p className="text-xs text-amber-800 mt-1">{problema.mensagem}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 mb-4">
                                <p className="text-xs font-bold text-emerald-700">Conta sem pendências operacionais críticas.</p>
                            </div>
                        )}

                        <div>
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Últimos rastros técnicos</p>
                            <div className="space-y-2">
                                {(diagnostico?.logsRecentes || []).slice(0, 3).map((log: any) => (
                                    <div key={log.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[10px] font-black uppercase text-slate-600 truncate">{log.action}</span>
                                            <span className="text-[10px] text-slate-400">{new Date(log.createdAt).toLocaleDateString('pt-BR')}</span>
                                        </div>
                                        <p className="text-xs text-slate-500 truncate mt-1">{log.message}</p>
                                    </div>
                                ))}
                                {(!diagnostico?.logsRecentes || diagnostico.logsRecentes.length === 0) && (
                                    <p className="text-xs text-slate-400">Nenhum rastro técnico recente encontrado.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Cartão de Assinatura / MRR */}
                    <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-6 rounded-2xl shadow-md text-white border border-slate-700 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10"><CreditCard size={64} /></div>
                        <h3 className="font-bold text-slate-300 text-sm uppercase mb-4 tracking-wider flex items-center gap-2"><Activity size={16}/> Plano Atual</h3>
                        
                        {planoAtivo ? (
                            <div>
                                <div className="text-2xl font-black text-white mb-1">{planoAtivo.plan?.name || 'Plano Personalizado'}</div>
                                <div className="text-emerald-400 font-bold mb-4">R$ {Number(planoAtivo.plan?.priceMonthly || 0).toFixed(2)} <span className="text-xs text-slate-400 font-normal">/ mês (MRR)</span></div>
                                
                                <div className="space-y-2">
                                    <div className="bg-slate-800/50 rounded-lg p-2 flex justify-between items-center text-sm border border-slate-700/50">
                                        <span className="text-slate-300">Notas Usadas:</span>
                                        <span className="font-bold text-white">{planoAtivo.notasEmitidas} / {planoAtivo.plan?.maxNotasMensal || '∞'}</span>
                                    </div>
                                    <div className="bg-slate-800/50 rounded-lg p-2 flex justify-between items-center text-sm border border-slate-700/50">
                                        <span className="text-slate-300">Renovação:</span>
                                        <span className="font-bold text-white">{planoAtivo.dataFim ? new Date(planoAtivo.dataFim).toLocaleDateString('pt-BR') : 'Vitalício'}</span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-4 text-center">
                                <AlertCircle className="text-yellow-500 mb-2" size={32}/>
                                <p className="font-bold text-yellow-500">Nenhum plano ativo</p>
                                <p className="text-xs text-slate-400 mt-1">Este cliente está sem cobertura.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* COLUNA DIREITA: TIMELINE (LINHA DO TEMPO) */}
                <div className="lg:col-span-2 flex flex-col h-[calc(100vh-140px)]">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 overflow-hidden">
                        
                        <div className="p-4 border-b bg-slate-50 flex items-center gap-2">
                            <Clock className="text-slate-500" size={20} />
                            <h3 className="font-bold text-slate-700">Linha do Tempo (Timeline)</h3>
                        </div>

                        {/* Lista de Eventos (Scrollável) */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
                            {eventos.length === 0 ? (
                                <div className="text-center text-slate-400 py-10">Nenhum evento registado para este cliente ainda.</div>
                            ) : (
                                <div className="relative border-l-2 border-slate-200 ml-3 space-y-8">
                                    {eventos.map((evento) => {
                                        const estilo = getEstiloEvento(evento.tipo);
                                        return (
                                            <div key={evento.id} className="relative pl-6">
                                                {/* Bolinha do ícone */}
                                                <div className={`absolute -left-3.5 top-0 w-7 h-7 rounded-full flex items-center justify-center border-2 border-white shadow-sm ${estilo.cor}`}>
                                                    {estilo.icone}
                                                </div>
                                                
                                                {/* Card do Evento */}
                                                <div className={`bg-white p-4 rounded-xl border shadow-sm hover:shadow-md transition-shadow ${estilo.borda}`}>
                                                    <div className="flex justify-between items-start mb-1">
                                                        <h4 className="font-bold text-slate-800 text-sm">{evento.titulo}</h4>
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase bg-slate-100 px-2 py-0.5 rounded">
                                                            {new Date(evento.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute:'2-digit' })}
                                                        </span>
                                                    </div>
                                                    {evento.descricao && (
                                                        <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap leading-relaxed">{evento.descricao}</p>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Área de Input (Nova Anotação) */}
                        <div className="p-4 border-t bg-white">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Adicionar Anotação Manual</label>
                            <div className="flex gap-2">
                                <textarea 
                                    value={novaNota}
                                    onChange={(e) => setNovaNota(e.target.value)}
                                    placeholder="Ex: Liguei para o cliente e ele tem interesse em fazer upgrade semana que vem..."
                                    className="flex-1 border rounded-xl p-3 text-sm resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                                    rows={2}
                                />
                                <button 
                                    onClick={handleAdicionarNota}
                                    disabled={!novaNota.trim()}
                                    className="bg-purple-600 text-white p-3 rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-sm"
                                >
                                    <Send size={20} />
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
