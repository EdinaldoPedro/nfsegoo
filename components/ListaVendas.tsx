'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { 
    Search, FileText, MoreVertical, Ban, RefreshCcw, 
    Loader2, AlertCircle, FileCode, Printer, AlertTriangle, 
    X, LifeBuoy, ChevronLeft, ChevronRight, Eye, CheckCircle2,
    Send, Pencil, Trash2
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDialog } from '@/app/contexts/DialogContext';
import { getEmissionIntent, clearEmissionIntent } from '@/app/utils/emission-intent';
import { fiscalOperationLabel, isFiscalOperationActive, isFiscalOperationPolling } from '@/app/utils/fiscal-operation-state';

interface ListaVendasProps {
  compact?: boolean; 
  onlyValid?: boolean;
}

class PdfPendingError extends Error {}

export default function ListaVendas({ compact = false, onlyValid = false }: ListaVendasProps) {
  const router = useRouter();
  const dialog = useDialog();
  
  const [vendas, setVendas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Estados de Controle
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);
  const [viewingPdfId, setViewingPdfId] = useState<string | null>(null);
  const [actionVendaId, setActionVendaId] = useState<string | null>(null);
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
  const cancelLock = useRef(false);
  const fetchVersion = useRef(0);
  const [listError, setListError] = useState('');
  const cancelIntentSlot = (vendaId: string) => `nfse.cancel-intent.v1:${localStorage.getItem('userId') || ''}:${vendaId}`;

  const formatarData = (data?: string | Date | null) => {
      if (!data) return '-';
      return new Date(data).toLocaleDateString('pt-BR');
  };

  const MOTIVOS_CANCELAMENTO = [
      { code: '1', label: 'Erro na emissão' }, { code: '2', label: 'Serviço não prestado' }, { code: '9', label: 'Outros' }
  ];

  const marcarPdfDisponivel = (notaId: string) => {
      setVendas((atuais) => atuais.map((venda) => ({
          ...venda,
          notas: venda.notas?.map((nota: any) => (
              nota.id === notaId ? { ...nota, hasPdf: true } : nota
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

  // --- DOWNLOAD PDF (CORRIGIDO AUTH) ---
  const fetchPdfBlob = async (notaId: string) => {
      const userId = localStorage.getItem('userId');

      const res = await fetch('/api/notas/pdf', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
              'x-user-id': userId || '',
              'x-portal-mode': 'customer'
          },
          body: JSON.stringify({ notaId })
      });

      if (res.status !== 200 || !res.headers.get('content-type')?.includes('application/pdf')) {
          const err = await res.json();
          if (res.status === 202 && err.pending) throw new PdfPendingError(err.error || 'PDF em preparação.');
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
          dialog.showAlert({ type: e instanceof PdfPendingError ? 'info' : 'danger',
              title: e instanceof PdfPendingError ? 'Preparando PDF' : 'Não foi possível abrir o PDF', description: e.message });
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
      } catch (e: any) { dialog.showAlert({ type: e instanceof PdfPendingError ? 'info' : 'danger',
          title: e instanceof PdfPendingError ? 'Preparando PDF' : 'Não foi possível baixar o PDF', description: e.message }); }
      finally { setDownloadingPdfId(null); }
  };

  const handleDownloadXml = async (nota: any, _isCancelada: boolean) => {
    setActiveMenu(null);
    try {
        const res = await fetch('/api/notas/' + encodeURIComponent(nota.id) + '/arquivos', { headers: { 'x-portal-mode': 'customer' } });
        if (!res.ok) { const error = await res.json(); throw new Error(error.error || 'Arquivo indisponível.'); }
        const zip = res.headers.get('content-type')?.includes('application/zip');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'NFSe-' + (nota.numeroOficial || nota.numero || 'sem-numero') + (zip ? '-XMLs-cancelamento.zip' : '.xml');
        document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error: any) { await dialog.showAlert({ type: 'warning', description: error.message || 'Não foi possível baixar o XML.' }); }
  };

  // --- BUSCA E PAGINAÇÃO ---
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(current => { if (searchTerm !== current) setPage(1); return searchTerm; }); }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchVendas = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    const version = ++fetchVersion.current;
    const userId = localStorage.getItem('userId');
    const contextId = localStorage.getItem('empresaContextId'); 
    const limit = compact ? 5 : 10;
    const typeFilter = onlyValid ? 'valid' : 'all';

    if (!userId) { setLoading(false); setVendas([]); setListError('Entre na sua conta para consultar o histórico.'); return; }

    fetch(`/api/notas?page=${page}&limit=${limit}&search=${encodeURIComponent(debouncedSearch)}&type=${typeFilter}`, {
        headers: { 
            'x-empresa-id': contextId || '',
            'x-user-id': userId || ''
        }
    })
    .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Histórico indisponível.'); return data; })
    .then(res => { if (version !== fetchVersion.current) return; setListError(''); setVendas(res.data || []); setTotalPages(res.meta?.totalPages || 1); })
    .catch((error) => { if (version === fetchVersion.current) setListError(error.message || 'Não foi possível atualizar o histórico.'); })
    .finally(() => {
        if (!silent && version === fetchVersion.current) setLoading(false);
    });
  }, [page, debouncedSearch, compact, onlyValid]);

  useEffect(() => { fetchVendas(); }, [fetchVendas]);

  useEffect(() => {
      if (!vendas.some((venda) => venda.status === 'PROCESSANDO' || venda.notas?.some((nota: any) => (nota.fiscalOperations?.[0]?.tipo === 'CANCELAR' && isFiscalOperationPolling(nota.fiscalOperations[0])) || ['PENDENTE', 'PROCESSANDO', 'ERRO_TEMPORARIO'].includes(nota.documentTask?.status)))) return;
      const interval = window.setInterval(() => { if (document.visibilityState === 'visible') fetchVendas(true); }, 5000);
      return () => window.clearInterval(interval);
  }, [vendas, fetchVendas]);

  // --- PEDIR AJUDA (CORRIGIDO AUTH) ---
  const handlePedirAjuda = async (vendaId: string, motivoErro: string, consultaFiscal = false) => {
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
                      tituloManual: `${consultaFiscal ? 'Consulta fiscal atrasada' : 'Falha na Emissão'} - Venda #${vendaId.split('-')[0]}`,
                      descricao: `O cliente solicitou ajuda para a venda ${vendaId}.\n\n${consultaFiscal ? 'Estado da consulta fiscal' : 'Erro reportado'}: ${motivoErro || 'Não especificado'}.\n\nPor favor, verifique os logs do sistema.`,
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

      if (await dialog.showConfirm({ title: 'Abrir Chamado?', description: consultaFiscal ? 'Nossa equipe verificará a consulta fiscal. A nota não será reenviada.' : 'Nossa equipe analisará o erro.', confirmText: 'Sim, Solicitar Ajuda', type: 'info' })) {
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
      const previous = vendas.find(v => v.id === vendaId)?.notas?.[0]?.fiscalOperations?.[0];
      if (previous && !isFiscalOperationActive(previous)) sessionStorage.removeItem(cancelIntentSlot(vendaId));
      setCancelModalOpen(true);
      setActiveMenu(null);
  };

  // --- CANCELAR NOTA (CORRIGIDO AUTH) ---
  const confirmarCancelamento = async () => {
      if (cancelLock.current) return;
      const justification = cancelData.detalhe.trim();
      if (!cancelData.tipo) return dialog.showAlert("Selecione um motivo.");
      if (justification.length < 15 || justification.length > 255) return dialog.showAlert("Escreva uma justificativa real com 15 a 255 caracteres.");
      if (/[^\x20-\x7e\xa0-\xff]/.test(justification)) return dialog.showAlert("Remova emojis e quebras de linha da justificativa.");
      cancelLock.current = true;
      try {
          if (!await dialog.showConfirm({ title: 'Solicitar cancelamento?', description: 'A nota somente será marcada como cancelada após confirmação fiscal. Um cancelamento confirmado é irreversível.', confirmText: 'Solicitar', type: 'danger' })) return;
          setCancelando(true);
          const slot = cancelIntentSlot(cancelData.vendaId);
          const payload = { acao: 'CANCELAR', vendaId: cancelData.vendaId, reasonCode: cancelData.tipo, justification };
          const intent = await getEmissionIntent(sessionStorage, slot, JSON.stringify(payload));
          const key = intent.key;
          const res = await fetch('/api/notas/gerenciar', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, idempotencyKey: key }),
          });
          const data = await res.json();
          if (!res.ok || !data.operation) {
              // These responses are conclusive local rejections, not a network timeout.
              if ([400, 403, 422].includes(res.status)) clearEmissionIntent(sessionStorage, slot, key);
              throw new Error(data.error || 'Não foi possível confirmar o registro. Atualize o histórico antes de tentar novamente.');
          }
          if (!isFiscalOperationActive(data.operation)) clearEmissionIntent(sessionStorage, slot, key);
          setCancelModalOpen(false);
          fetchVendas(true);
          await dialog.showAlert({ type: data.operation.status === 'ERRO_FINAL' ? 'warning' : 'info',
              title: fiscalOperationLabel(data.operation), description: data.operation.statusMessage || 'Acompanhe o resultado no histórico. Não é necessário manter esta janela aberta.' });
      } catch (error: any) {
          fetchVendas(true);
          await dialog.showAlert({ type: 'warning', title: 'Verifique o resultado antes de repetir',
              description: error.message || 'Conexão interrompida. A solicitação pode ter sido registrada; consulte o histórico.' });
      } finally { setCancelando(false); cancelLock.current = false; }
  };

  const handleCorrigir = (vendaId: string) => router.push(`/emitir?retry=${vendaId}`);

  const handleCopiarHomologacao = async (venda: any) => {
      setActiveMenu(null);
      const confirmed = await dialog.showConfirm({ type: 'info', title: 'Criar uma nova solicitação?',
        description: 'Os dados do teste serão copiados para revisão. A emissão original e seus documentos serão preservados. Confira o ambiente e as regras atuais antes de enviar.',
        confirmText: 'Revisar nova solicitação', cancelText: 'Voltar' });
      if (confirmed) router.push('/emitir?copiar=' + encodeURIComponent(venda.id));
  };

  const handleExcluirVenda = async (venda: any) => {
      const confirmado = await dialog.showConfirm({
          type: 'danger',
          title: 'Excluir esta venda?',
          description: 'A venda será removida do histórico visível. Esta ação só é permitida quando não existe uma nota fiscal válida vinculada.',
          confirmText: 'Excluir venda',
          cancelText: 'Cancelar',
      });
      if (!confirmado) return;

      const userId = localStorage.getItem('userId');
      setActionVendaId(venda.id);
      setActiveMenu(null);
      try {
          const res = await fetch('/api/notas/gerenciar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-user-id': userId || '' },
              body: JSON.stringify({ acao: 'EXCLUIR_VENDA', vendaId: venda.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Não foi possível excluir a venda.');
          setVendas((atuais) => atuais.filter((item) => item.id !== venda.id));
          await dialog.showAlert({ type: 'success', title: 'Venda excluída', description: 'A venda foi removida do histórico.' });
      } catch (error: any) {
          await dialog.showAlert({ type: 'danger', title: 'Exclusão bloqueada', description: error.message });
      } finally {
          setActionVendaId(null);
      }
  };

  // Dados do item ativo
  const activeVendaData = activeMenu ? vendas.find(v => v.id === activeMenu.id) : null;
  const activeNotaData = activeVendaData?.notas?.[0];
  const activeIsCancelada = activeVendaData?.status === 'CANCELADA' || activeNotaData?.status === 'CANCELADA';
  const activeHasValidNota = Boolean(activeNotaData && ['AUTORIZADA', 'CANCELADA'].includes(activeNotaData.status));
  const activeIsHomologacao = activeNotaData?.ambiente === 'HOMOLOGACAO' || activeVendaData?.status === 'HOMOLOGACAO_VALIDADA';
  const activePdfDisponivel = Boolean(activeNotaData?.hasPdf);
  const activePdfEmAndamento = activeNotaData?.id && downloadingPdfId === activeNotaData.id;
  const activePdfLabel = activePdfEmAndamento
      ? 'Buscando PDF...'
      : activePdfDisponivel
        ? (activeIsHomologacao ? 'PDF de teste' : activeIsCancelada ? 'PDF Cancelamento' : 'PDF Oficial')
        : 'Baixar PDF';
  const activeOperation = activeNotaData?.fiscalOperations?.[0];

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
                    {activeIsHomologacao && <button onClick={() => handleCopiarHomologacao(activeVendaData)}
                        className="w-full border-b border-slate-100 px-4 py-3 text-left text-sm font-semibold text-violet-700 hover:bg-violet-50">
                        Criar nova a partir deste teste
                    </button>}
                    {activeIsHomologacao && !activeHasValidNota && <p className="px-4 py-3 text-xs text-slate-600">Teste legado: solicite ao suporte a conferência dos documentos. O histórico será preservado.</p>}
                    {activeHasValidNota ? (
                      <>
                    <button onClick={() => handleViewPdf(activeNotaData.id, (activeNotaData.numeroOficial || activeNotaData.numero))} disabled={viewingPdfId === activeNotaData.id}
                        className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-b border-slate-50">
                        {viewingPdfId === activeNotaData.id ? <Loader2 size={16} className="animate-spin"/> : <Eye size={16} className="text-blue-500"/>}
                        {viewingPdfId === activeNotaData.id ? 'Abrindo...' : 'Visualizar PDF'}
                    </button>

                    <button onClick={() => handleDownloadPdf(activeNotaData.id, (activeNotaData.numeroOficial || activeNotaData.numero), activeIsCancelada)} disabled={downloadingPdfId === activeNotaData.id}
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
                    
                    {activeNotaData.hasXml && (
                        <button onClick={() => handleDownloadXml(activeNotaData, activeIsCancelada)}
                            className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-b border-slate-50">
                            <FileCode size={16} className={activeIsCancelada && activeNotaData.hasCancellationEvent ? 'text-red-500' : 'text-blue-500'}/>
                            {activeIsCancelada && activeNotaData.hasCancellationEvent ? 'XMLs NFS-e + Evento' : 'XML NFS-e'}
                        </button>
                    )}

                    {!activeIsCancelada && (
                        <button disabled={isFiscalOperationActive(activeOperation)} onClick={() => abrirModalCancelamento(activeVendaData.id)}
                            className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 font-medium disabled:opacity-50">
                            <Ban size={16}/> Solicitar cancelamento
                        </button>
                    )}
                    <button onClick={() => { setActiveMenu(null); router.push(`/cliente/suporte/novo?cancelamentoExterno=${encodeURIComponent(activeVendaData.id)}&nota=${encodeURIComponent(activeNotaData.numeroOficial || activeNotaData.numero || '')}`); }}
                        className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-t border-slate-100">
                        <LifeBuoy size={16}/> Informar cancelamento fora do SaaS
                    </button>
                      </>
                    ) : null}
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
                    <div className="p-6 text-center space-y-3" role="status" aria-live="polite">
                        <Loader2 className="animate-spin mx-auto text-red-600" size={30}/>
                        <h4 className="font-bold">Registrando a solicitação</h4>
                        <p className="text-sm text-slate-600">Aguardando confirmação do registro no sistema. A situação fiscal ainda não foi alterada.</p>
                    </div>
                ) : (
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Motivo</label>
                        <select className="w-full p-2.5 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-red-500 text-slate-700 text-sm"
                            value={cancelData.tipo} onChange={(e) => setCancelData({...cancelData, tipo: e.target.value})}>
                            <option value="">Selecione...</option>
                            {MOTIVOS_CANCELAMENTO.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Justificativa</label>
                        <textarea className="w-full p-2.5 border rounded-lg outline-none focus:ring-2 focus:ring-red-500 text-slate-700 h-24 resize-none text-sm"
                            minLength={15} maxLength={255} placeholder="Descreva o motivo real (15 a 255 caracteres)..." value={cancelData.detalhe} onChange={(e) => setCancelData({...cancelData, detalhe: e.target.value})}/>
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

      {listError && <div role="alert" className="p-4 text-sm text-amber-900 bg-amber-50">{listError} <button className="underline" onClick={() => fetchVendas()}>Atualizar</button></div>}
      <div className="saas-table-scroll">
        <table className="min-w-[760px] w-full text-left text-sm text-slate-600">
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
                    <tr><td colSpan={7} className="p-8 text-center text-slate-400">{onlyValid ? 'Nenhuma nota fiscal de produção encontrada.' : 'Nenhuma venda encontrada.'}</td></tr>
                ) : (
                    vendas.map((venda) => {
                        const nota = venda.notas[0]; 
                        const isCancelada = venda.status === 'CANCELADA' || nota?.status === 'CANCELADA';
                        const isAutorizada = venda.status === 'CONCLUIDA' || isCancelada;
                        const isHomologacao = nota?.ambiente === 'HOMOLOGACAO' || venda.emissaoAmbiente === 'HOMOLOGACAO' || venda.status === 'HOMOLOGACAO_VALIDADA';
                        const erroPrecisaSuporte = Boolean(venda.erroPrecisaSuporte);
                        const operation = nota?.fiscalOperations?.[0];
                        const emConciliacao = venda.emissaoStatus === 'RECONCILIACAO_MANUAL';

                        return (
                            <tr key={venda.id} className="hover:bg-slate-50 transition">
                                <td className="p-4 font-mono font-medium text-slate-700">
                                    {nota?.numeroOficial || nota?.numero || '-'}
                                </td>
                                <td className="p-4">
                                    <div className="font-bold text-slate-800">{nota?.tomadorNome || venda.cliente.razaoSocial}</div>
                                    <div className="text-xs text-slate-400">{nota?.tomadorCnpj || venda.cliente.documento}</div>
                                </td>
                                <td className="p-4">
                                    {nota?.codigoTribNacional ? (
                                        <div className="max-w-[320px]">
                                            <span
                                                className="inline-flex rounded border border-blue-100 bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-600"
                                                title={nota.nomeServico || nota.descricaoServicoInformada || venda.descricao}
                                            >
                                                {nota.codigoTribNacional}
                                            </span>
                                        </div>
                                    ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="p-4 font-medium text-slate-600 whitespace-nowrap">
                                    {formatarData(nota?.dataEmissao || venda.createdAt)}
                                </td>
                                <td className="p-4 text-right font-bold text-slate-700">
                                    {Number(nota?.valor ?? venda.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                </td>
                                <td className="p-4 text-center">
                                    {emConciliacao ? (
                                        <span title={venda.emissaoMensagem} className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-900">EM CONCILIAÇÃO</span>
                                    ) : venda.status === 'ERRO_EMISSAO' ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200" title={venda.motivoErro}>
                                            <AlertCircle size={10}/> FALHOU
                                        </span>
                                    ) : (
                                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                                            isCancelada ? 'bg-gray-100 text-gray-500 border-gray-200 line-through' :
                                            venda.status === 'CONCLUIDA' ? 'bg-green-100 text-green-700 border-green-200' :
                                            isHomologacao ? 'bg-violet-100 text-violet-700 border-violet-200' :
                                            'bg-blue-50 text-blue-700 border-blue-200'
                                        }`}>
                                            {isCancelada ? 'CANCELADA' : (venda.status === 'CONCLUIDA' ? 'AUTORIZADA' : isHomologacao ? 'HOMOLOGAÇÃO VALIDADA' : venda.status)}
                                        </span>
                                    )}
                                    {isHomologacao && <p className="mt-1 text-[10px] font-bold text-violet-700">HOMOLOGAÇÃO · SEM VALOR FISCAL</p>}
                                    {nota && !['PRODUCAO', 'HOMOLOGACAO'].includes(nota.ambiente) && <p className="mt-1 text-[10px] font-bold text-amber-800">AMBIENTE NÃO CONFIRMADO</p>}
                                    {operation?.tipo === 'CANCELAR' && (
                                        <div className="mt-2 max-w-[240px] text-xs text-slate-600" title={operation.statusMessage || ''}>
                                            {fiscalOperationLabel(operation)}
                                            {operation.status === 'RECONCILIACAO_MANUAL' && <button onClick={() => handlePedirAjuda(venda.id, fiscalOperationLabel(operation))} className="block mx-auto mt-1 underline text-amber-800">Solicitar ajuda</button>}
                                        </div>
                                    )}
                                </td>
                                <td className="p-4 text-right">
                                    {emConciliacao ? (
                                        <button onClick={() => handlePedirAjuda(venda.id, venda.emissaoMensagem)} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-900">Solicitar conciliação</button>
                                    ) : venda.status === 'PROCESSANDO' ? (
                                        <button onClick={() => router.push('/emitir')} className="rounded-lg border px-3 py-2 text-xs font-bold">Acompanhar</button>
                                    ) : venda.status === 'ERRO_EMISSAO' ? (
                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => handlePedirAjuda(venda.id, venda.motivoErro)} className="text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded-lg inline-flex items-center gap-1 transition">
                                                <LifeBuoy size={14}/> {erroPrecisaSuporte ? 'Abrir suporte' : 'Ajuda'}
                                            </button>
                                            {!erroPrecisaSuporte && (
                                                <button onClick={() => handleCorrigir(venda.id)} className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg inline-flex items-center gap-1 shadow-sm transition">
                                                    <RefreshCcw size={12}/> Corrigir
                                                </button>
                                            )}
                                        </div>
                                    ) : (isAutorizada || isHomologacao) && (
                                        <button 
                                            onClick={(e) => toggleMenu(e, venda.id)} 
                                            aria-label="Ações da nota" className={`p-2 rounded-full transition ${activeMenu?.id === venda.id ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-200 text-slate-400'}`}
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
