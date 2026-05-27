'use client';
import { useEffect, useState } from 'react';
import { Clock, User, Settings, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function AdminSuporte() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Função para calcular tempo decorrido
  const getTempo = (criadoEm: string, status: string, atualizadoEm: string) => {
      const inicio = new Date(criadoEm).getTime();
      const fim = ['RESOLVIDO', 'FECHADO'].includes(status) ? new Date(atualizadoEm).getTime() : new Date().getTime();
      
      const diff = fim - inicio;
      const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
      const horas = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      
      if (dias > 0) return `${dias}d ${horas}h`;
      return `${horas}h`;
  };

  const getPriorityColor = (p: string) => {
      if (p === 'CRITICA') return 'bg-red-100 text-red-700 border-red-200';
      if (p === 'ALTA') return 'bg-orange-100 text-orange-700 border-orange-200';
      return 'bg-blue-50 text-blue-700 border-blue-200';
  };

  const getStatusColor = (s: string) => {
      if (s === 'RESOLVIDO') return 'bg-green-100 text-green-700 border-green-200';
      if (s === 'FECHADO') return 'bg-gray-100 text-gray-600 border-gray-200';
      if (s === 'AGUARDANDO_CLIENTE') return 'bg-orange-50 text-orange-700 border-orange-200';
      return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const carregar = () => {
      fetch('/api/admin/suporte', { cache: 'no-store' })
        .then(r => r.json())
        .then(data => setTickets(Array.isArray(data) ? data : []))
        .catch(() => setTickets([]))
        .finally(() => setLoading(false));
  };

  useEffect(() => { carregar(); }, []);

  if(loading) return <div className="flex h-screen items-center justify-center text-slate-500"><Loader2 className="animate-spin mr-2"/> Carregando painel...</div>;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-slate-800">Helpdesk</h1>
          <Link href="/admin/suporte/catalogo" className="bg-slate-800 text-white px-4 py-2 rounded flex items-center gap-2 hover:bg-slate-900 text-sm font-bold shadow-md transition">
              <Settings size={16}/> Configurar Catálogo
          </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b text-slate-500 uppercase text-xs">
                  <tr>
                      <th className="p-4">Assunto / Cliente</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Prioridade</th>
                      <th className="p-4">Tempo</th>
                      <th className="p-4">Atendente</th>
                      <th className="p-4 text-right">Ação</th>
                  </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                  {tickets.length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-gray-400">Nenhum chamado encontrado.</td></tr>
                  ) : tickets.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50 transition">
                          <td className="p-4">
                              <div className="flex items-center gap-2 mb-1">
                                  <span className="font-bold text-slate-600 text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">#{t.protocolo}</span>
                                  <p className="font-bold text-slate-800 line-clamp-1">{t.assunto}</p>
                              </div>
                              <p className="text-xs text-slate-500">{t.solicitante?.nome}</p>
                          </td>
                          <td className="p-4">
                              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${getStatusColor(t.status)}`}>
                                  {t.status.replace('_', ' ')}
                              </span>
                          </td>
                          <td className="p-4">
                              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${getPriorityColor(t.prioridade)}`}>
                                  {t.prioridade}
                              </span>
                          </td>
                          <td className="p-4 font-mono text-xs text-slate-500">
                              <Clock size={12} className="inline mr-1"/>
                              {getTempo(t.createdAt, t.status, t.updatedAt)}
                          </td>
                          <td className="p-4 text-xs">
                              {t.atendente ? (
                                  <div className="flex items-center gap-2">
                                      <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-[10px]">
                                          {t.atendente.nome.charAt(0)}
                                      </div>
                                      <span className="truncate max-w-[80px]">{t.atendente.nome.split(' ')[0]}</span>
                                  </div>
                              ) : <span className="text-slate-300 italic">--</span>}
                          </td>
                          <td className="p-4 text-right">
                              <Link href={`/admin/suporte/${t.id}`} className="text-blue-600 hover:text-blue-800 font-bold text-xs bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
                                  Atender
                              </Link>
                          </td>
                      </tr>
                  ))}
              </tbody>
          </table>
      </div>
    </div>
  );
}
