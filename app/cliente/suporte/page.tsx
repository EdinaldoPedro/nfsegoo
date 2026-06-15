'use client';
import { useEffect, useState } from 'react';
import { Plus, MessageSquare, Clock, CheckCircle, UserCheck, Check, X, AlertTriangle, ArrowLeft, Search, Filter, BadgeHelp, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function MeusChamados() {
  const router = useRouter();
  const [tickets, setTickets] = useState<any[]>([]); 
  const [filteredTickets, setFilteredTickets] = useState<any[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<any[]>([]); 
  const [loading, setLoading] = useState(true);
  
  const [termoBusca, setTermoBusca] = useState('');

  useEffect(() => {
    const role = localStorage.getItem('userRole') || '';
    const isSupportMode = localStorage.getItem('isSupportMode') === 'true';
    const isInternalSupport = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(role);

    if (isInternalSupport && !isSupportMode) {
        router.replace('/admin/suporte');
        return;
    }

    carregarDados();
  }, []);

  // Filtro local
  useEffect(() => {
    if (!termoBusca) {
        setFilteredTickets(tickets);
    } else {
        const lower = termoBusca.toLowerCase();
        const filtrados = tickets.filter(t => 
            t.assunto.toLowerCase().includes(lower) || 
            String(t.protocolo).includes(lower) ||
            (t.categoria && t.categoria.toLowerCase().includes(lower))
        );
        setFilteredTickets(filtrados);
    }
  }, [termoBusca, tickets]);

  const carregarDados = async () => {
    const userId = localStorage.getItem('userId');
    
    // Header seguro
    const headers = { 
        'x-user-id': userId || ''
    };
    
    setLoading(true);
    try {
        // 1. Busca Tickets
        const resTickets = await fetch('/api/suporte/tickets', { headers });
        const dataTickets = await resTickets.json();
        if (Array.isArray(dataTickets)) {
            setTickets(dataTickets);
            setFilteredTickets(dataTickets);
        } else {
            setTickets([]);
            setFilteredTickets([]);
        }

        // 2. Busca Solicitações de Contador
        const resSolicitacoes = await fetch('/api/contador/vinculo?mode=cliente', { headers });
        const dataSolicitacoes = await resSolicitacoes.json();
        if (Array.isArray(dataSolicitacoes)) setSolicitacoes(dataSolicitacoes);

    } catch (err) {
        console.error("Erro ao carregar dados:", err);
    } finally {
        setLoading(false);
    }
  };

  const responderSolicitacao = async (vinculoId: string, acao: 'APROVAR' | 'REJEITAR', nomeContador: string) => {
      const termo = acao === 'APROVAR' 
        ? `ATENÇÃO: Ao aprovar, você confirma que conhece o contador(a) "${nomeContador}" e AUTORIZA o acesso dele(a) aos dados fiscais e cadastrais da sua empresa nesta plataforma.\n\nDeseja confirmar o acesso?`
        : `Deseja recusar o acesso de "${nomeContador}"?`;

      if(!confirm(termo)) return;

      const userId = localStorage.getItem('userId');

      try {
          const res = await fetch('/api/contador/vinculo', {
              method: 'PUT',
              headers: {
                  'Content-Type': 'application/json', 
                  'x-user-id': userId || ''
              },
              body: JSON.stringify({ vinculoId, acao })
          });
          
          if(res.ok) {
              alert(acao === 'APROVAR' ? "Acesso concedido com sucesso!" : "Solicitação recusada.");
              setSolicitacoes(prev => prev.filter(s => s.id !== vinculoId));
          } else {
              alert("Erro ao processar solicitação.");
          }
      } catch (e) { alert("Erro de conexão."); }
  };

  const getStatusInfo = (s: string) => {
      switch(s) {
          case 'ABERTO': 
              return { label: 'Não Iniciado', class: 'bg-blue-50 text-blue-700 border-blue-200' };
          case 'EM_ANDAMENTO': 
              return { label: 'Em Andamento', class: 'bg-yellow-50 text-yellow-700 border-yellow-200' };
          case 'AGUARDANDO_CLIENTE': 
              return { label: 'Aguardando Você', class: 'bg-orange-50 text-orange-700 border-orange-200' };
          case 'RESOLVIDO': 
              return { label: 'Concluído', class: 'bg-green-50 text-green-700 border-green-200' };
          case 'FECHADO': 
              return { label: 'Fechado', class: 'bg-gray-100 text-gray-600 border-gray-200' };
          default: 
              return { label: s, class: 'bg-gray-100 text-gray-600' };
      }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
                <button onClick={() => router.push('/cliente/dashboard')} className="p-2 bg-white border border-slate-200 rounded-full hover:bg-slate-100 transition text-slate-500">
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <MessageSquare className="text-blue-600" size={24}/> Central de Suporte
                    </h1>
                    <p className="text-slate-500 text-sm">Acompanhe seus tickets e solicitações de acesso.</p>
                </div>
            </div>
            
            <div className="flex gap-3">
                <Link 
                    href="/cliente/suporte/novo"
                    className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition flex items-center gap-2 shadow-md font-medium"
                >
                    <Plus size={20} /> Abrir Novo Chamado
                </Link>
            </div>
        </div>

        {/* ÁREA DE SOLICITAÇÕES */}
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-white p-3 text-blue-600 shadow-sm">
                        <BadgeHelp size={24} />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-slate-800">Antes de abrir chamado</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-600">
                            Consulte os guias rápidos sobre emissão, certificado, DPS, PDF/XML e cancelamento.
                        </p>
                    </div>
                </div>
                <Link
                    href="/cliente/ajuda"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black text-blue-700 shadow-sm ring-1 ring-blue-100 transition hover:bg-blue-600 hover:text-white"
                >
                    Abrir Central de Ajuda <ArrowRight size={16} />
                </Link>
            </div>
        </div>

        {solicitacoes.length > 0 && (
            <div className="bg-white border-l-4 border-orange-500 rounded-xl shadow-sm p-6 animate-in fade-in slide-in-from-top-4">
                <div className="flex items-start gap-4 mb-4">
                    <div className="p-2 bg-orange-50 text-orange-600 rounded-lg shrink-0">
                        <UserCheck size={24}/>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Solicitações de Acesso</h2>
                        <p className="text-slate-500 text-sm mt-1">
                            Contadores solicitando permissão para gerenciar sua empresa.
                        </p>
                    </div>
                </div>

                <div className="grid gap-3">
                    {solicitacoes.map(sol => (
                        <div key={sol.id} className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-white border rounded-full flex items-center justify-center font-bold text-slate-600 shadow-sm">
                                    {sol.contador.nome.charAt(0)}
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800 text-sm">{sol.contador.nome}</p>
                                    <p className="text-xs text-slate-500">{sol.contador.email}</p>
                                </div>
                            </div>
                            
                            <div className="flex gap-2 w-full md:w-auto">
                                <button 
                                    onClick={() => responderSolicitacao(sol.id, 'APROVAR', sol.contador.nome)}
                                    className="flex-1 md:flex-none bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-green-700 flex items-center justify-center gap-2 transition"
                                >
                                    <Check size={14}/> Autorizar
                                </button>
                                <button 
                                    onClick={() => responderSolicitacao(sol.id, 'REJEITAR', sol.contador.nome)}
                                    className="flex-1 md:flex-none bg-white border border-red-200 text-red-600 px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-50 flex items-center justify-center gap-2 transition"
                                >
                                    <X size={14}/> Negar
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* LISTA DE CHAMADOS */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
                <h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm uppercase tracking-wide">
                    <Filter size={16} className="text-slate-400"/> Meus Tickets
                </h3>
                <div className="relative w-full md:w-72">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                    <input 
                        className="w-full pl-10 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition"
                        placeholder="Buscar por assunto ou protocolo..."
                        value={termoBusca}
                        onChange={e => setTermoBusca(e.target.value)}
                    />
                </div>
            </div>

            {loading ? (
                <div className="text-center p-12 text-slate-400">Carregando...</div>
            ) : filteredTickets.length === 0 ? (
                <div className="text-center p-16 flex flex-col items-center">
                    <div className="bg-slate-50 p-4 rounded-full mb-4">
                        <MessageSquare className="text-slate-300" size={32}/>
                    </div>
                    <h3 className="font-bold text-slate-700 text-lg">Nenhum chamado encontrado</h3>
                    <p className="text-slate-500 text-sm mt-1 max-w-xs">
                        Se tiver alguma dúvida ou problema, não hesite em abrir um novo ticket.
                    </p>
                </div>
            ) : (
                <div className="divide-y divide-slate-100">
                    {filteredTickets.map(t => (
                        <Link key={t.id} href={`/cliente/suporte/${t.id}`}>
                            <div className="p-5 hover:bg-slate-50 transition flex flex-col md:flex-row justify-between items-start md:items-center gap-4 group cursor-pointer border-l-4 border-transparent hover:border-blue-500">
                                <div className="flex gap-4 items-center">
                                    <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs shrink-0 border border-blue-100">
                                        #{t.protocolo}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800 group-hover:text-blue-600 transition text-base">{t.assunto}</h3>
                                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                                            <span className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded"><Clock size={10}/> {new Date(t.createdAt).toLocaleDateString()}</span>
                                            {t.categoria && <span>• {t.categoria}</span>}
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
                                    {(() => {
                                        const statusInfo = getStatusInfo(t.status);
                                        return (
                                            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase border flex items-center gap-1.5 ${statusInfo.class}`}>
                                                {t.status === 'RESOLVIDO' && <CheckCircle size={10}/>}
                                                {statusInfo.label}
                                            </span>
                                        );
                                    })()}
                                    <ArrowLeft size={16} className="text-slate-300 rotate-180 group-hover:text-blue-500 transition-transform group-hover:translate-x-1"/>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
