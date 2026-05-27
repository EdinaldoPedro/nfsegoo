'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
    ArrowLeft, Send, Paperclip, Clock, 
    User, FileText, Download, Loader2, 
    Headphones, CheckCircle, XCircle 
} from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext'; // <--- Dialog Padrão

interface Mensagem {
    id: string;
    mensagem: string;
    interno: boolean;
    anexoNome?: string;
    anexoBase64?: string;
    createdAt: string;
    usuario: { nome: string; role: string };
}

interface Ticket {
    id: string;
    protocolo: number;
    assunto: string;
    status: string;
    prioridade: string;
    descricao: string;
    anexoNome?: string;
    anexoBase64?: string;
    mensagens: Mensagem[];
    createdAt: string;
    updatedAt: string;
}

const STATUS_MAP: Record<string, string> = {
    'ABERTO': 'Aberto',
    'EM_ANDAMENTO': 'Em Atendimento',
    'AGUARDANDO_CLIENTE': 'Aguardando Você',
    'RESOLVIDO': 'Resolvido',
    'FECHADO': 'Fechado',
    'CANCELADO': 'Cancelado'
};

const STATUS_COLORS: Record<string, string> = {
    'ABERTO': 'bg-yellow-100 text-yellow-700',
    'EM_ANDAMENTO': 'bg-blue-100 text-blue-700',
    'AGUARDANDO_CLIENTE': 'bg-orange-100 text-orange-700',
    'RESOLVIDO': 'bg-green-100 text-green-700',
    'FECHADO': 'bg-gray-100 text-gray-600',
    'CANCELADO': 'bg-red-100 text-red-700'
};

export default function ClienteTicketDetalhes({ params }: { params: { id: string } }) {
    const router = useRouter();
    const dialog = useDialog();
    
    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    
    const [resposta, setResposta] = useState('');
    const [anexo, setAnexo] = useState<{ nome: string, base64: string } | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    // === CARREGAR DADOS ===
    useEffect(() => {
        const role = localStorage.getItem('userRole') || '';
        const isSupportMode = localStorage.getItem('isSupportMode') === 'true';
        const isInternalSupport = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(role);

        if (isInternalSupport && !isSupportMode) {
            router.replace('/admin/suporte');
            return;
        }

        fetchTicket();
        // Atualiza a cada 5 segundos para ver novas respostas em tempo real
        const interval = setInterval(fetchTicket, 5000); 
        return () => clearInterval(interval);
    }, [params.id]);

    // Scroll para baixo quando chegar mensagem nova
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [ticket?.mensagens]);

    const fetchTicket = async () => {
        try {
            const userId = localStorage.getItem('userId');

            const res = await fetch(`/api/suporte/tickets/${params.id}`, {
                headers: { 
                    'x-user-id': userId || ''
                }
            });
            
            if (res.status === 401) { router.push('/login'); return; }

            const data = await res.json();
            if (res.ok) setTicket(data);
            
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleEnviar = async () => {
        if (!resposta.trim() && !anexo) return;

        setSending(true);
        const userId = localStorage.getItem('userId');

        try {
            const res = await fetch('/api/suporte/tickets/mensagem', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-user-id': userId || ''
                },
                body: JSON.stringify({
                    ticketId: params.id,
                    mensagem: resposta,
                    anexoNome: anexo?.nome,
                    anexoBase64: anexo?.base64
                })
            });

            if (res.ok) {
                setResposta('');
                setAnexo(null);
                fetchTicket(); // Recarrega para mostrar a mensagem enviada
            } else {
                dialog.showAlert({ type: 'danger', description: "Erro ao enviar mensagem." });
            }
        } catch (e) {
            dialog.showAlert("Erro de conexão.");
        } finally {
            setSending(false);
        }
    };

    const handleAcaoTicket = async (acao: 'CANCELAR' | 'RESOLVER') => {
        const texto = acao === 'CANCELAR' ? 'cancelar este chamado' : 'marcar como resolvido';
        const status = acao === 'CANCELAR' ? 'CANCELADO' : 'RESOLVIDO';

        if (!await dialog.showConfirm({ title: 'Confirmar ação?', description: `Deseja realmente ${texto}?` })) return;

        const userId = localStorage.getItem('userId');

        try {
            const res = await fetch(`/api/suporte/tickets/${params.id}`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-user-id': userId || ''
                },
                body: JSON.stringify({ status })
            });

            if (res.ok) {
                fetchTicket();
                dialog.showAlert({ type: 'success', description: "Status atualizado!" });
            }
        } catch (e) { dialog.showAlert("Erro ao atualizar."); }
    };

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 10 * 1024 * 1024) return dialog.showAlert("Tamanho máximo: 10MB");
            const reader = new FileReader();
            reader.onloadend = () => {
                setAnexo({ nome: file.name, base64: (reader.result as string).split(',')[1] });
            };
            reader.readAsDataURL(file);
        }
    };

    const downloadAnexo = (base64: string, nome: string) => {
        const link = document.createElement('a');
        link.href = `data:application/octet-stream;base64,${base64}`;
        link.download = nome;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading) return <div className="flex justify-center items-center h-screen bg-slate-100"><Loader2 className="animate-spin text-blue-600" size={48} /></div>;
    if (!ticket) return <div className="p-8 text-center text-slate-500 h-screen flex items-center justify-center bg-slate-100">Chamado não encontrado.</div>;

    const isFinalizado = ['RESOLVIDO', 'FECHADO', 'CANCELADO'].includes(ticket.status);

    return (
        // === LAYOUT PRINCIPAL (FUNDO CINZA) ===
        <div className="min-h-screen bg-slate-100 md:p-6 flex items-center justify-center">
            
            {/* === CARD CENTRALIZADO (ENQUADRAMENTO) === 
                Em mobile: Tela cheia (w-full h-screen)
                Em desktop: Box flutuante (max-w-5xl h-[85vh])
            */}
            <div className="w-full max-w-5xl bg-white md:rounded-2xl md:shadow-2xl overflow-hidden flex flex-col h-screen md:h-[85vh] border border-slate-200">
                
                {/* --- HEADER --- */}
                <div className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm z-20 shrink-0">
                    <div className="flex items-center gap-4">
                        <button onClick={() => router.push('/cliente/suporte')} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 transition border border-transparent hover:border-slate-200">
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <div className="flex items-center gap-3">
                                <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded border">#{ticket.protocolo}</span>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${STATUS_COLORS[ticket.status] || 'bg-gray-100'}`}>
                                    {STATUS_MAP[ticket.status] || ticket.status}
                                </span>
                            </div>
                            <h1 className="text-lg font-bold text-slate-800 mt-1 line-clamp-1">
                                {ticket.assunto}
                            </h1>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {!isFinalizado && (
                            <>
                                <button onClick={() => handleAcaoTicket('RESOLVER')} className="hidden sm:flex px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold text-xs items-center gap-2 shadow-sm transition">
                                    <CheckCircle size={14}/> Resolvido
                                </button>
                                <button onClick={() => handleAcaoTicket('CANCELAR')} className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 font-bold text-xs flex items-center gap-2 transition">
                                    <XCircle size={14}/> Cancelar
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* --- ÁREA DE MENSAGENS (SCROLL) --- */}
                <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6 custom-scrollbar">
                    <div className="space-y-6 pb-4">
                        
                        {/* MENSAGEM INICIAL DO SISTEMA / DESCRIÇÃO */}
                        <div className="flex justify-center">
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-2xl w-full relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-slate-300"></div>
                                <div className="flex items-start gap-4">
                                    <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0 border border-slate-200">
                                        <FileText size={20}/>
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex justify-between items-start mb-2">
                                            <h3 className="font-bold text-slate-800 text-sm">Sua Solicitação Original</h3>
                                            <span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={12}/> {new Date(ticket.createdAt).toLocaleDateString()}</span>
                                        </div>
                                        <p className="text-slate-600 text-sm whitespace-pre-wrap leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                                            {ticket.descricao}
                                        </p>
                                        {ticket.anexoBase64 && (
                                            <button onClick={() => downloadAnexo(ticket.anexoBase64!, ticket.anexoNome!)} className="mt-3 flex items-center gap-2 text-slate-600 hover:text-blue-600 bg-white border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold transition w-fit shadow-sm">
                                                <Paperclip size={14}/> {ticket.anexoNome}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* DIVISOR */}
                        <div className="relative flex items-center justify-center my-6 opacity-60">
                            <span className="bg-slate-200 px-3 py-1 rounded-full text-[10px] text-slate-500 font-bold uppercase tracking-wide">Histórico</span>
                        </div>

                        {/* MENSAGENS DO CHAT */}
                        <div className="space-y-4">
                            {ticket.mensagens.map((msg) => {
                                // LÓGICA CORRIGIDA: Se NÃO for um cargo da equipa (Staff), então sou EU (Cliente)
                                const isStaff = ['ADMIN', 'MASTER', 'SUPORTE', 'SUPORTE_TI', 'CONTADOR'].includes(msg.usuario.role);
                                const isMe = !isStaff; 
                                
                                if (msg.interno) return null; 

                                return (
                                    <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`flex max-w-[85%] sm:max-w-[70%] gap-3 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                                            
                                            {/* AVATAR */}
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-sm border ${
                                                isMe 
                                                    ? 'bg-blue-100 text-blue-700 border-blue-200' // Eu (Cliente)
                                                    : 'bg-white text-orange-600 border-orange-200' // Suporte
                                            }`}>
                                                {isMe ? <User size={14}/> : <Headphones size={14}/>}
                                            </div>

                                            {/* BALÃO DE MENSAGEM */}
                                            <div className={`p-4 rounded-2xl shadow-sm text-sm border leading-relaxed whitespace-pre-wrap ${
                                                isMe 
                                                    ? 'bg-blue-600 text-white border-blue-600 rounded-tr-none' // Balão Azul (Direita)
                                                    : 'bg-white text-slate-700 border-slate-200 rounded-tl-none' // Balão Branco (Esquerda)
                                            }`}>
                                                <div className={`flex items-center justify-between gap-4 mb-1 text-[10px] font-bold uppercase tracking-wider ${
                                                    isMe ? 'text-blue-100' : 'text-slate-400'
                                                }`}>
                                                    <span>{isMe ? 'Você' : msg.usuario.nome}</span>
                                                    <span>{new Date(msg.createdAt).toLocaleTimeString().slice(0,5)}</span>
                                                </div>

                                                {msg.mensagem}

                                                {msg.anexoBase64 && (
                                                    <div className={`mt-3 pt-3 border-t ${isMe ? 'border-blue-500' : 'border-slate-100'}`}>
                                                        <button onClick={() => downloadAnexo(msg.anexoBase64!, msg.anexoNome!)} className={`flex items-center gap-2 text-xs font-bold underline decoration-dotted ${
                                                            isMe ? 'text-white' : 'text-blue-600'
                                                        }`}>
                                                            <Download size={14}/> {msg.anexoNome}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>
                    </div>
                </div>

                {/* --- INPUT AREA --- */}
                {!isFinalizado ? (
                    <div className="bg-white border-t p-4 shrink-0">
                        <div className="max-w-4xl mx-auto w-full">
                            {anexo && (
                                <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold w-fit border border-blue-200 mb-2 animate-in slide-in-from-bottom-2 shadow-sm">
                                    <Paperclip size={12}/> {anexo.nome}
                                    <button onClick={() => setAnexo(null)} className="hover:text-red-500 ml-2"><XCircle size={14}/></button>
                                </div>
                            )}
                            <div className="flex gap-3 items-end">
                                <label className="p-3 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-xl cursor-pointer transition border border-transparent hover:border-slate-200 h-12 flex items-center justify-center bg-white shadow-sm" title="Anexar">
                                    <Paperclip size={20}/>
                                    <input type="file" className="hidden" onChange={handleFile} accept="image/*,.pdf"/>
                                </label>
                                
                                <textarea 
                                    value={resposta}
                                    onChange={e => setResposta(e.target.value)}
                                    onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEnviar(); } }}
                                    className="flex-1 p-3 border border-slate-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none h-12 min-h-[48px] max-h-32 transition shadow-sm text-slate-700 bg-slate-50 focus:bg-white"
                                    placeholder="Digite sua resposta..."
                                />
                                
                                <button 
                                    onClick={handleEnviar} 
                                    disabled={sending || (!resposta.trim() && !anexo)} 
                                    className="h-12 w-12 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition flex items-center justify-center shadow-md hover:shadow-lg disabled:opacity-50 disabled:shadow-none"
                                >
                                    {sending ? <Loader2 className="animate-spin" size={20}/> : <Send size={20}/>}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="bg-gray-50 p-6 border-t text-center shrink-0">
                        <div className="max-w-md mx-auto">
                            <p className="text-sm text-gray-500 font-medium mb-2">Este chamado foi encerrado.</p>
                            <p className="text-xs text-gray-400">Caso precise de mais ajuda, abra um novo chamado.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
