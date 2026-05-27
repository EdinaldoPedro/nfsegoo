'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Send, Shield, User, Lock, Clock, Book, ArrowLeft, Paperclip, Download, X, MessageCircle, Loader2, AlertTriangle } from 'lucide-react';
// 1. Importar o Dialog
import { useDialog } from '@/app/contexts/DialogContext';

const STATUS_MAP: Record<string, string> = {
    'ABERTO': 'Não Iniciado',
    'EM_ANDAMENTO': 'Em Andamento',
    'AGUARDANDO_CLIENTE': 'Aguardando Cliente',
    'RESOLVIDO': 'Resolvido',
    'FECHADO': 'Fechado'
};

const STATUS_COLORS: Record<string, string> = {
    'ABERTO': 'bg-slate-100 text-slate-700 border-slate-200',
    'EM_ANDAMENTO': 'bg-blue-50 text-blue-700 border-blue-200',
    'AGUARDANDO_CLIENTE': 'bg-orange-50 text-orange-700 border-orange-200',
    'RESOLVIDO': 'bg-green-50 text-green-700 border-green-200',
    'FECHADO': 'bg-gray-100 text-gray-600 border-gray-200'
};

export default function ResolucaoAdmin() {
  const { id } = useParams();
  const router = useRouter();
  const dialog = useDialog(); // 2. Inicializar o Dialog
  
  const [ticket, setTicket] = useState<any>(null);
  const [staffMembers, setStaffMembers] = useState<any[]>([]); 
  const [novaMsg, setNovaMsg] = useState('');
  const [activeTab, setActiveTab] = useState<'CLIENTE' | 'INTERNO'>('CLIENTE');
  const [anexo, setAnexo] = useState<{base64: string, nome: string} | null>(null);
  const [tempoDecorrido, setTempoDecorrido] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const msgEndRef = useRef<HTMLDivElement>(null);

  const carregarDados = useCallback(async () => {
      try {
          const token = localStorage.getItem('token'); // <--- RECUPERA TOKEN
          const userId = localStorage.getItem('userId');

          // Busca Ticket com Token
          const resTicket = await fetch(`/api/admin/suporte/${id}`, {
              headers: { 
                  'x-user-id': userId || '',
                  'Authorization': `Bearer ${token}` // <--- ENVIA TOKEN
              }
          });

          if (resTicket.status === 401) { router.push('/login'); return; }
          if (!resTicket.ok) throw new Error("Erro ao buscar ticket");
          
          const dataTicket = await resTicket.json();
          if (dataTicket.error) throw new Error(dataTicket.error);
          setTicket(dataTicket);

          // Busca Staff com Token (se necessário)
          if (staffMembers.length === 0) {
              const resUsers = await fetch('/api/admin/users', {
                  headers: { 'Authorization': `Bearer ${token}` } // <--- ENVIA TOKEN
              });
              
              if (resUsers.ok) {
                  const dataUsers = await resUsers.json();
                  // Verifica se dataUsers.data existe (paginação) ou se é array direto
                  const lista = dataUsers.data || (Array.isArray(dataUsers) ? dataUsers : []);
                  const staff = lista.filter((u: any) => ['ADMIN', 'MASTER', 'SUPORTE', 'SUPORTE_TI', 'CONTADOR'].includes(u.role));
                  setStaffMembers(staff);
              }
          }
          setError(''); 
      } catch (e: any) { 
          if (!ticket) setError(e.message || "Erro desconhecido");
      } finally {
          setLoading(false);
      }
  }, [id, staffMembers.length, ticket, router]);

  useEffect(() => { 
      carregarDados(); 
      const interval = setInterval(carregarDados, 10000); 
      return () => clearInterval(interval);
  }, [carregarDados]);

  useEffect(() => {
      if (!ticket) return;
      const updateTimer = () => {
          const inicio = new Date(ticket.createdAt).getTime();
          const isFinalizado = ['RESOLVIDO', 'FECHADO'].includes(ticket.status);
          const fim = isFinalizado ? new Date(ticket.updatedAt).getTime() : new Date().getTime();
          const diff = fim - inicio;
          const dias = Math.floor(diff / 86400000);
          const horas = Math.floor((diff % 86400000) / 3600000);
          const minutos = Math.floor((diff % 3600000) / 60000);
          let str = dias > 0 ? `${dias}d ` : '';
          str += `${horas}h ${minutos}m`;
          if(isFinalizado) str += ' (Finalizado)';
          setTempoDecorrido(str);
      };
      updateTimer();
      if (!['RESOLVIDO', 'FECHADO'].includes(ticket.status)) {
          const timer = setInterval(updateTimer, 60000);
          return () => clearInterval(timer);
      }
  }, [ticket?.status, ticket?.createdAt, ticket?.updatedAt]);

  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [ticket?.mensagens?.length, activeTab]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if(file) {
          if (file.size > 10 * 1024 * 1024) return dialog.showAlert("O arquivo deve ter no máximo 10MB."); // <--- Dialog
          const reader = new FileReader();
          reader.onload = () => setAnexo({ base64: reader.result as string, nome: file.name });
          reader.readAsDataURL(file);
      }
  };

  const enviarMsg = async () => {
      if(!novaMsg.trim() && !anexo) return;
      
      const userId = localStorage.getItem('userId');
      const token = localStorage.getItem('token'); // <--- RECUPERA TOKEN
      const tempMsg = novaMsg;
      
      setNovaMsg(''); 
      
      try {
          const res = await fetch('/api/suporte/tickets/mensagem', {
              method: 'POST',
              headers: {
                  'Content-Type':'application/json', 
                  'x-user-id': userId || '',
                  'Authorization': `Bearer ${token}` // <--- ENVIA TOKEN
              },
              body: JSON.stringify({ 
                  ticketId: id, mensagem: tempMsg, interno: activeTab === 'INTERNO',
                  anexoBase64: anexo?.base64, anexoNome: anexo?.nome
              })
          });

          if (!res.ok) throw new Error();

          setAnexo(null);
          carregarDados();
      } catch (e) { 
          dialog.showAlert("Erro ao enviar mensagem."); // <--- Dialog
          setNovaMsg(tempMsg); 
      }
  };

  const atualizarTicket = async (campo: string, valor: string) => {
      // === PROMPT PADRÃO (Dialog) ===
      if (campo === 'status') {
          const confirmed = await dialog.showConfirm({
              title: 'Alterar Status?',
              description: `Deseja alterar o status do chamado para "${STATUS_MAP[valor] || valor}"?`,
              confirmText: 'Sim, Alterar',
              type: 'info'
          });
          if (!confirmed) return;
      }

      const token = localStorage.getItem('token'); // <--- RECUPERA TOKEN

      try {
          const res = await fetch(`/api/admin/suporte/${id}`, {
              method: 'PUT', 
              headers: {
                  'Content-Type':'application/json',
                  'Authorization': `Bearer ${token}` // <--- ENVIA TOKEN
              },
              body: JSON.stringify({ [campo]: valor })
          });
          
          if (!res.ok) throw new Error();
          
          carregarDados();
          if (campo === 'status') dialog.showAlert({ type: 'success', description: "Status atualizado!" });

      } catch (e) { 
          dialog.showAlert("Erro ao atualizar o ticket."); 
      }
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-slate-50 text-blue-600 gap-2"><Loader2 className="animate-spin" size={32}/></div>;
  if (error) return <div className="flex h-screen items-center justify-center text-red-500 gap-2"><AlertTriangle/> {error}</div>;
  if (!ticket) return null;

  const mensagensFiltradas = ticket.mensagens?.filter((m: any) => activeTab === 'INTERNO' ? m.interno : !m.interno) || [];

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
        
        {/* SIDEBAR */}
        <div className="w-80 bg-white border-r flex flex-col shrink-0 h-full shadow-lg z-20">
            <div className="p-5 border-b">
                <button onClick={() => router.back()} className="text-xs text-slate-500 hover:text-blue-600 mb-4 flex items-center gap-1 transition font-bold uppercase tracking-wide">
                    <ArrowLeft size={14}/> Voltar
                </button>
                <div className="flex justify-between items-start mb-2">
                    <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded border">#{ticket.protocolo}</span>
                    <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1"><Clock size={12}/> {tempoDecorrido}</div>
                </div>
                <h1 className="font-bold text-lg text-slate-800 leading-tight mb-2">{ticket.assunto}</h1>
                
                {ticket.anexoBase64 && (
                    <a href={ticket.anexoBase64} download={ticket.anexoNome} className="flex items-center gap-2 p-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-100 hover:bg-blue-100 transition w-full truncate mt-3">
                        <Paperclip size={14}/> Anexo da Abertura
                    </a>
                )}
            </div>

            {/* Instruções do Catálogo */}
            {ticket.catalogItem?.instrucoes && (
                <div className="p-4 bg-yellow-50 border-b border-yellow-200">
                    <h4 className="text-[10px] font-black text-yellow-800 uppercase mb-2 flex items-center gap-2 tracking-wider">
                        <Book size={12}/> Procedimento Interno
                    </h4>
                    <p className="text-xs text-yellow-900 leading-relaxed whitespace-pre-line bg-white/60 p-3 rounded border border-yellow-200/50">
                        {ticket.catalogItem.instrucoes}
                    </p>
                </div>
            )}
            
            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
                <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Status</label>
                    <select className={`w-full p-2.5 rounded-lg border text-sm font-bold cursor-pointer outline-none transition ${STATUS_COLORS[ticket.status]}`}
                        value={ticket.status} onChange={(e) => atualizarTicket('status', e.target.value)}>
                        {Object.entries(STATUS_MAP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Atendente</label>
                    <select className="w-full p-2.5 rounded-lg border text-sm bg-white outline-blue-500 text-slate-700" value={ticket.atendenteId || ''} onChange={(e) => atualizarTicket('atendenteId', e.target.value)}>
                        <option value="">-- Não atribuído --</option>
                        {staffMembers.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                </div>

                <div className="pt-6 border-t mt-4">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold border border-slate-200">
                            {ticket.solicitante.nome.charAt(0)}
                        </div>
                        <div>
                            <p className="font-bold text-slate-700 text-sm">{ticket.solicitante.nome}</p>
                            <p className="text-xs text-slate-400">{ticket.solicitante.email}</p>
                        </div>
                    </div>
                    {ticket.solicitante.empresa && (
                        <div className="bg-slate-50 p-3 rounded-lg border text-xs">
                            <p className="font-bold text-slate-700 mb-1 flex items-center gap-1"><Shield size={12}/> Empresa</p>
                            <p className="text-slate-600 truncate">{ticket.solicitante.empresa.razaoSocial}</p>
                            <p className="font-mono text-slate-400 mt-0.5">{ticket.solicitante.empresa.documento}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* CHAT AREA */}
        <div className="flex-1 flex flex-col bg-slate-100 relative">
            
            {/* TABS */}
            <div className="bg-white border-b flex px-6 shadow-sm z-10 sticky top-0 justify-center">
                <div className="flex gap-4">
                    <button onClick={() => setActiveTab('CLIENTE')} className={`flex items-center gap-2 px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'CLIENTE' ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
                        <MessageCircle size={18}/> Chat Cliente
                    </button>
                    <button onClick={() => setActiveTab('INTERNO')} className={`flex items-center gap-2 px-6 py-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'INTERNO' ? 'border-yellow-500 text-yellow-700 bg-yellow-50/50' : 'border-transparent text-slate-500 hover:bg-slate-50'}`}>
                        <Lock size={16}/> Notas Internas
                    </button>
                </div>
            </div>

            {/* MENSAGENS (CONTAINER CENTRALIZADO) */}
            <div className={`flex-1 p-6 overflow-y-auto custom-scrollbar ${activeTab === 'INTERNO' ? 'bg-yellow-50/30' : ''}`}>
                <div className="max-w-4xl mx-auto space-y-6"> {/* <--- AQUI ESTÁ O TRUQUE DO TAMANHO */}
                    <div className="flex justify-center mb-4">
                        <div className={`text-[10px] px-3 py-1 rounded-full uppercase font-bold shadow-sm backdrop-blur-sm border ${
                            activeTab === 'INTERNO' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' : 'bg-slate-200 text-slate-600 border-slate-300'
                        }`}>
                            {activeTab === 'INTERNO' ? '🔒 Área Privada da Equipe' : '🌎 Visível para o Cliente'}
                        </div>
                    </div>

                    {mensagensFiltradas.length === 0 && (
                        <div className="text-center text-slate-400 mt-20 flex flex-col items-center gap-3 opacity-50">
                            <MessageCircle size={48} strokeWidth={1}/>
                            <p>Nenhuma mensagem nesta aba.</p>
                        </div>
                    )}

                    {mensagensFiltradas.map((msg: any) => {
                        const isStaff = ['ADMIN','SUPORTE','MASTER', 'SUPORTE_TI', 'CONTADOR'].includes(msg.usuario.role);
                        const isMe = isStaff;

                        return (
                            <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div className={`flex max-w-[85%] ${isMe ? 'flex-row-reverse' : 'flex-row'} gap-3`}>
                                    
                                    {/* AVATAR */}
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-sm border ${
                                        isMe ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-white text-slate-600 border-slate-200'
                                    }`}>
                                        {isMe ? <Shield size={14}/> : <User size={14}/>}
                                    </div>

                                    {/* BALÃO */}
                                    <div className={`p-4 rounded-2xl shadow-sm relative text-sm border leading-relaxed whitespace-pre-wrap ${
                                        msg.interno 
                                            ? 'bg-yellow-100 border-yellow-200 text-yellow-900 rounded-tr-none' 
                                            : isMe 
                                                ? 'bg-blue-600 text-white border-blue-600 rounded-tr-none' 
                                                : 'bg-white text-slate-700 border-slate-200 rounded-tl-none'
                                    }`}>
                                        
                                        <div className={`flex items-center justify-between gap-4 mb-1 text-[10px] font-bold uppercase tracking-wider ${
                                            msg.interno ? 'text-yellow-700' : isMe ? 'text-blue-200' : 'text-slate-400'
                                        }`}>
                                            <span>{msg.usuario.nome}</span>
                                            <span>{new Date(msg.createdAt).toLocaleTimeString().slice(0,5)}</span>
                                        </div>

                                        {msg.mensagem}

                                        {msg.anexoBase64 && (
                                            <div className={`mt-3 pt-3 border-t ${msg.interno ? 'border-yellow-200' : isMe ? 'border-blue-500' : 'border-slate-100'}`}>
                                                <a href={msg.anexoBase64} download={msg.anexoNome} className={`flex items-center gap-2 text-xs font-bold underline decoration-dotted ${
                                                    msg.interno ? 'text-yellow-800' : isMe ? 'text-white' : 'text-blue-600'
                                                }`}>
                                                    <Download size={14}/> {msg.anexoNome}
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={msgEndRef} />
                </div>
            </div>

            {/* INPUT AREA */}
            <div className={`p-4 border-t ${activeTab === 'INTERNO' ? 'bg-yellow-50 border-yellow-200' : 'bg-white'}`}>
                <div className="max-w-3xl mx-auto"> {/* <--- LARGURA MÁXIMA CONTROLADA */}
                    {anexo && (
                        <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold w-fit border border-blue-200 mb-2 animate-in slide-in-from-bottom-2 shadow-sm">
                            <Paperclip size={12}/> {anexo.nome}
                            <button onClick={() => setAnexo(null)} className="hover:text-red-500 ml-2"><X size={14}/></button>
                        </div>
                    )}
                    <div className="flex gap-3 items-end">
                        <label className="p-3 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-xl cursor-pointer transition border border-transparent hover:border-slate-200 h-12 flex items-center justify-center bg-white shadow-sm" title="Anexar">
                            <Paperclip size={20}/>
                            <input type="file" className="hidden" onChange={handleFile} accept="image/*,.pdf"/>
                        </label>
                        
                        <div className="flex-1 relative">
                            <textarea 
                                className={`w-full p-3 pr-10 border rounded-xl outline-none resize-none h-12 min-h-[48px] max-h-32 transition shadow-sm focus:ring-2 focus:ring-offset-1 ${
                                    activeTab === 'INTERNO' 
                                    ? 'bg-white border-yellow-300 focus:ring-yellow-400 text-yellow-900 placeholder:text-yellow-400/70' 
                                    : 'bg-white border-slate-200 focus:border-blue-400 focus:ring-blue-100 text-slate-700'
                                }`}
                                placeholder={activeTab === 'INTERNO' ? "Escreva uma nota interna (cliente NÃO vê)..." : "Escreva sua resposta..."}
                                value={novaMsg} 
                                onChange={e => setNovaMsg(e.target.value)}
                                onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMsg(); } }}
                            />
                        </div>
                        
                        <button 
                            onClick={enviarMsg} 
                            disabled={!novaMsg.trim() && !anexo}
                            className={`h-12 w-12 rounded-xl transition flex items-center justify-center text-white shadow-md hover:shadow-lg disabled:opacity-50 disabled:shadow-none ${
                                activeTab === 'INTERNO' ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                        >
                            <Send size={20}/>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}
