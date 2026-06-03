'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { 
    Search, FileText, MoreVertical, Ban, RefreshCcw, 
    Loader2, AlertCircle, FileCode, Printer, AlertTriangle, 
    X, LifeBuoy, ChevronLeft, ChevronRight, Eye, CheckCircle2
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDialog } from '@/app/contexts/DialogContext';

interface ListaVendasProps {
  compact?: boolean; 
  onlyValid?: boolean;
}

export default function ListaVendas({ compact = false, onlyValid = false }: ListaVendasProps) {
  const router = useRouter();
  const dialog = useDialog();
  
  const [vendas, setVendas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Estados de Controle
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);
  const [viewingPdfId, setViewingPdfId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // === MENU FLUTUANTE ===
  const [activeMenu, setActiveMenu] = useState<{ id: string; top: number; left: number; alignBottom: boolean } | null>(null);

  // === CANCELAMENTO ===
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelData, setCancelData] = useState({ vendaId: '', tipo: '', detalhe: '' });
  const [cancelando, setCancelando] = useState(false);
  const [cancelProgress, setCancelProgress] = useState(0);

  const formatarData = (data?: string | Date | null) => {
      if (!data) return '-';
      return new Date(data).toLocaleDateString('pt-BR');
  };

  const MOTIVOS_CANCELAMENTO = [
      "Erro na emissão", "Serviço não prestado", "Erro de assinatura", "Duplicidade da nota", "Outros"
  ];

  const marcarPdfDisponivel = (notaId: string) => {
      setVendas((atuais) => atuais.map((venda) => ({
          ...venda,
          notas: venda.notas?.map((nota: any) => (
              nota.id === notaId ? { ...nota, pdfBase64: nota.pdfBase64 || '__PDF_DISPONIVEL__' } : nota
          )),
      })));
  };

  // Fecha menu ao rolar
  useEffect(() => {
      const handleScroll = () => setActiveMenu(null);
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
      return () => {
          window.removeEventListener('scroll', handleScroll, true);
          window.removeEventListener('resize', handleScroll);
      };
  }, []);

  useEffect(() => {
      if (!cancelando) return;
      const timer = window.setInterval(() => {
          setCancelProgress((progress) => Math.min(progress + 7, 88));
      }, 700);
      return () => window.clearInterval(timer);
  }, [cancelando]);

  // --- DOWNLOAD PDF (CORRIGIDO AUTH) ---
  const fetchPdfBlob = async (notaId: string) => {
      const userId = localStorage.getItem('userId');

      const res = await fetch('/api/notas/pdf', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'x-user-id': userId || ''
          },
          body: JSON.stringify({ notaId })
      });

      if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Erro ao buscar documento.");
      }

      return res.blob();
  };

  const handleViewPdf = async (notaId: string, numeroNota: number) => {
      const viewer = window.open('', '_blank');
      if (!viewer) {
          dialog.showAlert({ type: 'warning', description: 'O navegador bloqueou a abertura da visualizacao. Permita pop-ups para abrir o PDF.' });
          return;
      }

      try {
          setViewingPdfId(notaId);
          viewer.document.title = `NFSe-${numeroNota}`;
          viewer.document.body.innerHTML = '<p style="font-family: Arial; padding: 24px;">Carregando PDF...</p>';
          const blob = await fetchPdfBlob(notaId);
          const url = window.URL.createObjectURL(blob);
          viewer.location.href = url;
          marcarPdfDisponivel(notaId);
          setActiveMenu(null);
      } catch (e: any) {
          viewer.close();
          dialog.showAlert({ type: 'danger', description: "Erro: " + e.message });
      } finally {
          setViewingPdfId(null);
      }
  };

  const handleDownloadPdf = async (notaId: string, numeroNota: number, isCancelada: boolean) => {
      try {
          setDownloadingPdfId(notaId); 
          const blob = await fetchPdfBlob(notaId);
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = isCancelada ? `NFSe-CANCELADA-${numeroNota}.pdf` : `NFSe-${numeroNota}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
          marcarPdfDisponivel(notaId);
          setActiveMenu(null);
      } catch (e: any) { dialog.showAlert({ type: 'danger', description: "Erro: " + e.message }); } 
      finally { setDownloadingPdfId(null); }
  };

  const downloadBase64 = (base64: string, filename: string, mime: string) => {
    try {
        const link = document.createElement('a');
        link.href = `data:${mime};base64,${base64}`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) { dialog.showAlert("Erro ao baixar arquivo."); }
  };

  const handleDownloadXml = async (nota: any, isCancelada: boolean) => {
    const xmlNota = isCancelada ? (nota.xmlAutorizadoBase64 || nota.xmlBase64) : nota.xmlBase64;
    const xmlEvento = nota.xmlCancelamentoEventoBase64;

    if (isCancelada && xmlNota && xmlEvento) {
        try {
            const JSZip = (await import('jszip')).default;
            const zip = new JSZip();
            zip.file(`nota-${nota.numero}.xml`, xmlNota, { base64: true });
            zip.file(`nota-${nota.numero}-evento-cancelamento.xml`, xmlEvento, { base64: true });
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `nota-${nota.numero}-xmls.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (e) {
            dialog.showAlert("Erro ao baixar XMLs em ZIP.");
        }
        return;
    }

    if (xmlNota) {
        downloadBase64(xmlNota, `nota-${nota.numero}.xml`, 'text/xml');
    }
  };

  // --- BUSCA E PAGINAÇÃO ---
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(searchTerm); if (searchTerm !== debouncedSearch) setPage(1); }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchVendas = useCallback(() => {
    setLoading(true);
    const userId = localStorage.getItem('userId');
    const contextId = localStorage.getItem('empresaContextId'); 
    const limit = compact ? 5 : 10;
    const typeFilter = onlyValid ? 'valid' : 'all';

    if (!userId) return;

    fetch(`/api/notas?page=${page}&limit=${limit}&search=${debouncedSearch}&type=${typeFilter}`, {
        headers: { 
            'x-empresa-id': contextId || '',
            'x-user-id': userId || ''
        }
    })
    .then(r => r.json())
    .then(res => { setVendas(res.data || []); setTotalPages(res.meta?.totalPages || 1); })
    .catch(() => setVendas([]))
    .finally(() => setLoading(false));
  }, [page, debouncedSearch, compact, onlyValid]);

  useEffect(() => { fetchVendas(); }, [fetchVendas]);

  // --- PEDIR AJUDA (CORRIGIDO AUTH) ---
  const handlePedirAjuda = async (vendaId: string, motivoErro: string) => {
      const criarTicket = async (force = false) => {
          const userId = localStorage.getItem('userId');

          try {
              const res = await fetch('/api/suporte/tickets', {
                  method: 'POST',
                  headers: { 
                      'Content-Type': 'application/json', 
                      'x-user-id': userId || '' 
                  },
                  body: JSON.stringify({ 
                      assuntoId: 'AUTO_ERROR_REPORT', 
                      tituloManual: `Falha na Emissão - Venda #${vendaId.split('-')[0]}`,
                      descricao: `O cliente solicitou ajuda para a venda ${vendaId}.\n\nErro reportado: ${motivoErro || 'Não especificado'}.\n\nPor favor, verifique os logs do sistema.`,
                      prioridade: 'ALTA',
                      checkDuplicity: !force, 
                      vendaIdReferencia: vendaId
                  })
              });
              const data = await res.json();
              if (res.ok) {
                  dialog.showAlert({ type: 'success', title: 'Chamado Aberto!', description: `O ticket #${data.protocolo} foi criado.` });
              } else if (res.status === 409) {
                  if (await dialog.showConfirm({ type: 'warning', title: 'Chamado em Aberto', description: `${data.message}\n\nDeseja abrir um novo chamado mesmo assim?` })) {
                      criarTicket(true);
                  }
              } else {
                  dialog.showAlert({ type: 'danger', description: data.error || "Erro ao abrir chamado." });
              }
          } catch (e) { dialog.showAlert("Erro de conexão."); }
      };

      if (await dialog.showConfirm({ title: 'Abrir Chamado?', description: 'Nossa equipe analisará o erro.', confirmText: 'Sim, Solicitar Ajuda', type: 'info' })) {
          criarTicket();
      }
  };

  // --- MENU FLUTUANTE ---
  const toggleMenu = (e: React.MouseEvent<HTMLButtonElement>, id: string) => {
      e.stopPropagation();
      if (activeMenu?.id === id) { setActiveMenu(null); return; }
      const rect = e.currentTarget.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const alignBottom = spaceBelow > 220; 
      setActiveMenu({ id, top: alignBottom ? rect.bottom + 5 : rect.top - 5, left: rect.right, alignBottom });
  };

  const abrirModalCancelamento = (vendaId: string) => {
      setCancelData({ vendaId, tipo: '', detalhe: '' });
      setCancelProgress(0);
      setCancelModalOpen(true);
      setActiveMenu(null);
  };

  // --- CANCELAR NOTA (CORRIGIDO AUTH) ---
  const confirmarCancelamento = async () => {
      const justificativaCompleta = `${cancelData.tipo}: ${cancelData.detalhe}`;
      if (!cancelData.tipo) return dialog.showAlert("Selecione um motivo.");
      if (justificativaCompleta.length < 15) return dialog.showAlert("A justificativa deve ter no mínimo 15 caracteres.");

      if (!await dialog.showConfirm({ title: 'Cancelar Nota Fiscal?', description: 'Esta ação é irreversível.', confirmText: 'Sim, Cancelar', type: 'danger' })) return;

      setCancelando(true);
      setCancelProgress(8);
      const userId = localStorage.getItem('userId');

      try {
          setCancelProgress(28);
          const res = await fetch('/api/notas/gerenciar', {
              method: 'POST',
              headers: { 
                  'Content-Type': 'application/json', 
                  'x-user-id': userId || '' 
              },
              body: JSON.stringify({ acao: 'CANCELAR', vendaId: cancelData.vendaId, motivo: justificativaCompleta })
          });
          const data = await res.json();
          if(res.ok) { 
              setCancelProgress(100);
              await dialog.showAlert({ type: 'success', title: 'Sucesso', description: "Nota cancelada!" });
              setCancelModalOpen(false);
              fetchVendas(); 
          } else {
              setCancelProgress(0);
              dialog.showAlert({ type: 'danger', title: 'Falha', description: data.error });
          }
      } catch(e) { dialog.showAlert("Erro de conexão."); }
      finally { setCancelando(false); }
  };

  const handleCorrigir = (vendaId: string) => router.push(`/emitir?retry=${vendaId}`);

  // Dados do item ativo
  const activeVendaData = activeMenu ? vendas.find(v => v.id === activeMenu.id) : null;
  const activeNotaData = activeVendaData?.notas?.[0];
  const activeIsCancelada = activeVendaData?.status === 'CANCELADA' || activeNotaData?.status === 'CANCELADA';
  const activePdfDisponivel = Boolean(activeNotaData?.pdfBase64);
  const activePdfEmAndamento = activeNotaData?.id && downloadingPdfId === activeNotaData.id;
  const activePdfLabel = activePdfEmAndamento
      ? 'Buscando PDF...'
      : activePdfDisponivel
        ? (activeIsCancelada ? 'PDF Cancelamento' : 'PDF Oficial')
        : 'Baixar PDF';
  const cancelSteps = [
      { label: 'Validando pedido', doneAt: 20 },
      { label: 'Assinando evento', doneAt: 45 },
      { label: 'Transmitindo ao Portal Nacional', doneAt: 70 },
      { label: 'Sincronizando retorno', doneAt: 95 },
  ];
  const cancelStatus = cancelProgress >= 95
      ? 'Finalizando cancelamento'
      : cancelProgress >= 70
        ? 'Sincronizando com o Portal Nacional'
        : cancelProgress >= 45
          ? 'Transmitindo evento de cancelamento'
          : cancelProgress >= 20
            ? 'Preparando assinatura do evento'
            : 'Validando justificativa';

  return (
    <div className="saas-card overflow-hidden relative">
      
      {/* MENU FLUTUANTE (FIXO) */}
      {activeMenu && activeVendaData && (
          <>
            <div className="fixed inset-0 z-[9990]" onClick={() => setActiveMenu(null)}></div>
            <div 
                className="fixed bg-white border border-slate-100 rounded-lg shadow-2xl z-[9999] overflow-hidden w-48 animate-in fade-in zoom-in-95 duration-200"
                style={{
                    top: activeMenu.alignBottom ? activeMenu.top : 'auto',
                    bottom: activeMenu.alignBottom ? 'auto' : (window.innerHeight - activeMenu.top),
                    left: activeMenu.left - 192 
                }}
            >
                <div className="py-1">
                    <button onClick={() => handleViewPdf(activeNotaData.id, activeNotaData.numero)} disabled={viewingPdfId === activeNotaData.id}
                        className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-b border-slate-50">
                        {viewingPdfId === activeNotaData.id ? <Loader2 size={16} className="animate-spin"/> : <Eye size={16} className="text-blue-500"/>}
                        {viewingPdfId === activeNotaData.id ? 'Abrindo...' : 'Visualizar PDF'}
                    </button>

                    <button onClick={() => handleDownloadPdf(activeNotaData.id, activeNotaData.numero, activeIsCancelada)} disabled={downloadingPdfId === activeNotaData.id} 
                        className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex items-center gap-2 border-b border-slate-50 ${activePdfDisponivel && activeIsCancelada ? 'text-red-600 font-medium' : activePdfDisponivel ? 'text-slate-700' : 'text-blue-600 font-medium'}`}>
                        {activePdfEmAndamento ? (
                            <Loader2 size={16} className="animate-spin"/>
                        ) : activePdfDisponivel ? (
                            <Printer size={16}/>
                        ) : (
                            <RefreshCcw size={16}/>
                        )}
                        {activePdfLabel}
                    </button>
                    
                    {(activeNotaData.xmlBase64 || activeNotaData.xmlAutorizadoBase64) && (
                        <button onClick={() => handleDownloadXml(activeNotaData, activeIsCancelada)}
                            className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-b border-slate-50">
                            <FileCode size={16} className={activeIsCancelada && activeNotaData.xmlCancelamentoEventoBase64 ? 'text-red-500' : 'text-blue-500'}/>
                            {activeIsCancelada && activeNotaData.xmlCancelamentoEventoBase64 ? 'XMLs NFS-e + Evento' : 'XML NFS-e'}
                        </button>
                    )}

                    {!activeIsCancelada && (
                        <button onClick={() => abrirModalCancelamento(activeVendaData.id)} 
                            className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium">
                            <Ban size={16}/> Cancelar Nota
                        </button>
                    )}
                </div>
            </div>
          </>
      )}

      {/* MODAL CANCELAMENTO */}
      {cancelModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
                    <h3 className="font-bold text-red-700 flex items-center gap-2"><AlertTriangle size={20}/> Cancelar Nota</h3>
                    <button disabled={cancelando} onClick={() => setCancelModalOpen(false)} className="text-red-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"><X size={20}/></button>
                </div>
                {cancelando ? (
                    <div className="p-6 space-y-5">
                        <div className="flex flex-col items-center text-center">
                            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600 ring-8 ring-red-50">
                                <Loader2 className="animate-spin" size={30}/>
                            </div>
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-red-500">Cancelando NFS-e</p>
                            <h4 className="mt-1 text-lg font-black text-slate-900">{cancelStatus}</h4>
                            <p className="mt-2 text-sm text-slate-500">Mantenha esta janela aberta enquanto registramos o evento fiscal.</p>
                        </div>

                        <div>
                            <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
                                <span>Progresso</span>
                                <span>{cancelProgress}%</span>
                            </div>
                            <div className="h-3 overflow-hidden rounded-full bg-red-100">
                                <div className="h-full rounded-full bg-red-600 transition-all duration-700 ease-out" style={{ width: `${cancelProgress}%` }} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2">
                            {cancelSteps.map((step) => {
                                const done = cancelProgress >= step.doneAt;
                                const active = !done && cancelProgress >= step.doneAt - 25;
                                return (
                                    <div key={step.label} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : active ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                                        <div className={`flex h-7 w-7 items-center justify-center rounded-full ${done ? 'bg-emerald-100' : active ? 'bg-red-100' : 'bg-white'}`}>
                                            {done ? <CheckCircle2 size={16}/> : active ? <Loader2 className="animate-spin" size={15}/> : <Ban size={14}/>}
                                        </div>
                                        <span className="font-bold">{step.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Motivo</label>
                        <select className="w-full p-2.5 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-red-500 text-slate-700 text-sm"
                            value={cancelData.tipo} onChange={(e) => setCancelData({...cancelData, tipo: e.target.value})}>
                            <option value="">Selecione...</option>
                            {MOTIVOS_CANCELAMENTO.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Justificativa</label>
                        <textarea className="w-full p-2.5 border rounded-lg outline-none focus:ring-2 focus:ring-red-500 text-slate-700 h-24 resize-none text-sm"
                            placeholder="Descreva o motivo (min 15 caracteres)..." value={cancelData.detalhe} onChange={(e) => setCancelData({...cancelData, detalhe: e.target.value})}/>
                    </div>
                    <button onClick={confirmarCancelamento} className="w-full bg-red-600 text-white py-2.5 rounded-lg font-bold hover:bg-red-700 transition flex items-center justify-center gap-2 text-sm">
                        <Ban size={16}/> Confirmar Cancelamento
                    </button>
                </div>
                )}
            </div>
        </div>
      )}

      {/* HEADER E TABELA */}
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white">
        <h3 className="font-bold text-slate-700 flex items-center gap-2">
            <FileText size={20} className="text-blue-600"/> 
            {compact ? 'Últimas Vendas' : 'Histórico de Notas'}
        </h3>
        {!compact && (
            <div className="relative w-64">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                <input 
                    className="w-full pl-10 p-2 border rounded-lg text-sm outline-none focus:border-blue-500 transition"
                    placeholder="Buscar cliente, nota..." 
                    value={searchTerm} 
                    onChange={e => setSearchTerm(e.target.value)} 
                />
            </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500">
                <tr>
                    <th className="p-4">Nota</th>
                    <th className="p-4">Cliente</th>
                    <th className="p-4">Item (Serviço)</th>
                    <th className="p-4">Emissão</th>
                    <th className="p-4 text-right">Valor</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-right">Ações</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {loading ? (
                    <tr><td colSpan={7} className="p-8 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-2"/>Carregando...</td></tr>
                ) : vendas.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-slate-400">Nenhuma venda encontrada.</td></tr>
                ) : (
                    vendas.map((venda) => {
                        const nota = venda.notas[0]; 
                        const isCancelada = venda.status === 'CANCELADA' || nota?.status === 'CANCELADA';
                        const isAutorizada = venda.status === 'CONCLUIDA' || isCancelada;

                        return (
                            <tr key={venda.id} className="hover:bg-slate-50 transition">
                                <td className="p-4 font-mono font-medium text-slate-700">
                                    {nota?.numero || '-'}
                                </td>
                                <td className="p-4">
                                    <div className="font-bold text-slate-800">{venda.cliente.razaoSocial}</div>
                                    <div className="text-xs text-slate-400">{venda.cliente.documento}</div>
                                </td>
                                <td className="p-4">
                                    {nota?.codigoTribNacional ? (
                                        <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100 cursor-help" title={nota.nomeServico || venda.descricao}>
                                            {nota.codigoTribNacional}
                                        </span>
                                    ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="p-4 font-medium text-slate-600 whitespace-nowrap">
                                    {formatarData(nota?.dataEmissao || venda.createdAt)}
                                </td>
                                <td className="p-4 text-right font-bold text-slate-700">
                                    {Number(venda.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </td>
                                <td className="p-4 text-center">
                                    {venda.status === 'ERRO_EMISSAO' ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200" title={venda.motivoErro}>
                                            <AlertCircle size={10}/> FALHOU
                                        </span>
                                    ) : (
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                                            isCancelada ? 'bg-gray-100 text-gray-500 border-gray-200 line-through' :
                                            venda.status === 'CONCLUIDA' ? 'bg-green-100 text-green-700 border-green-200' :
                                            'bg-blue-50 text-blue-700 border-blue-200'
                                        }`}>
                                            {isCancelada ? 'CANCELADA' : (venda.status === 'CONCLUIDA' ? 'AUTORIZADA' : venda.status)}
                                        </span>
                                    )}
                                </td>
                                <td className="p-4 text-right">
                                    {venda.status === 'ERRO_EMISSAO' ? (
                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => handlePedirAjuda(venda.id, venda.motivoErro)} className="text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded-lg inline-flex items-center gap-1 transition">
                                                <LifeBuoy size={14}/> Ajuda
                                            </button>
                                            <button onClick={() => handleCorrigir(venda.id)} className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg inline-flex items-center gap-1 shadow-sm transition">
                                                <RefreshCcw size={12}/> Corrigir
                                            </button>
                                        </div>
                                    ) : isAutorizada && (
                                        <button 
                                            onClick={(e) => toggleMenu(e, venda.id)} 
                                            className={`p-2 rounded-full transition ${activeMenu?.id === venda.id ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-200 text-slate-400'}`}
                                        >
                                            <MoreVertical size={18}/>
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })
                )}
            </tbody>
        </table>
      </div>

      {!compact && totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex justify-between items-center bg-white">
              <span className="text-xs text-slate-500">Página {page} de {totalPages}</span>
              <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 border rounded hover:bg-slate-50 disabled:opacity-50 text-slate-600"><ChevronLeft size={16}/></button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 border rounded hover:bg-slate-50 disabled:opacity-50 text-slate-600"><ChevronRight size={16}/></button>
              </div>
          </div>
      )}
    </div>
  );
}
