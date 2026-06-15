'use client';

import { useState, useEffect } from 'react';
import { 
    Search, Download, FileText, FileCode, Archive, 
    CheckSquare, Square, Loader2, ChevronLeft, ChevronRight, 
    Printer, Calendar, Filter, Lock, ArrowRight 
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { useDialog } from '@/app/contexts/DialogContext';
import Link from 'next/link';

// Importações para PDF
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function RelatoriosPage() {
    const router = useRouter();
    const dialog = useDialog();

    // Filtros
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [search, setSearch] = useState('');
    const [incluirCanceladas, setIncluirCanceladas] = useState(false);

    // Dados
    const [notas, setNotas] = useState<any[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [prestador, setPrestador] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [isBlocked, setIsBlocked] = useState(false);
    
    // Paginação
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // Seleção em Lote
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [downloading, setDownloading] = useState(false);

    // Data inicial padrão
    // Data inicial padrão
    useEffect(() => {
        const date = new Date();
        const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
        
        // Helper para formatar no padrão "YYYY-MM-DD" usando o fuso local do PC do usuário
        const formatLocal = (d: Date) => {
            const pad = (n: number) => n.toString().padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };

        setStartDate(formatLocal(firstDay));
        setEndDate(formatLocal(date));
    }, []);;

    // Buscar dados
    useEffect(() => {
        if(!startDate || !endDate) return;
        fetchData();
    }, [page, startDate, endDate, incluirCanceladas]); 

const fetchData = async () => {
        setLoading(true);
        const userId = localStorage.getItem('userId');
        const contextId = localStorage.getItem('empresaContextId');
        
        // Substituímos a checagem do token pela checagem do userId
        if (!userId) {
            router.push('/login');
            return;
        }

        try {
            const query = new URLSearchParams({
                page: page.toString(),
                limit: '20',
                startDate,
                endDate,
                incluirCanceladas: String(incluirCanceladas),
                search
            });

            const res = await fetch(`/api/relatorios?${query.toString()}`, {
                headers: { 
                    // 'Authorization' removido! O Cookie HttpOnly é enviado automaticamente.
                    'x-user-id': userId || '',
                    'x-empresa-id': contextId || ''
                }
            });
            
            if (res.status === 403) {
                setIsBlocked(true);
                setLoading(false);
                return; 
            }

            if (res.status === 401) {
                router.push('/login');
                return;
            }

            const data = await res.json();
            if (data.data) {
                setNotas(data.data);
                setSummary(data.summary);
                setPrestador(data.prestador || null);
                setTotalPages(data.meta.totalPages);
                setSelectedIds([]); 
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const formatCurrency = (val: any) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val || 0));
    };

    const formatDoc = (value?: string | null) => {
        const digits = String(value || '').replace(/\D/g, '');
        if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
        if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
        return value || '-';
    };

    const truncateText = (value: string, size = 56) => {
        return value.length > size ? `${value.slice(0, size)}...` : value;
    };

    // === GERAR RELATÓRIO PDF ===
    const handleGeneratePDF = () => {
        if (!summary) return;

        const doc = new jsPDF();
        const periodoRelatorio = `${new Date(startDate + 'T12:00:00').toLocaleDateString()} a ${new Date(endDate + 'T12:00:00').toLocaleDateString()}`;
        const prestadorNome = prestador?.razaoSocial || prestador?.nomeFantasia || 'Prestador nao identificado';
        const prestadorLocal = [prestador?.cidade, prestador?.uf].filter(Boolean).join('/');
        
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, 210, 34, 'F');

        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(147, 197, 253);
        doc.text("NFSeGoo | Relatório fiscal", 14, 12);

        doc.setFontSize(17);
        doc.setTextColor(255, 255, 255);
        doc.text("Relatório de Notas Fiscais", 14, 22);

        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(203, 213, 225);
        doc.text("Documento operacional para conferência, suporte fiscal e acompanhamento de emissão.", 14, 29);

        doc.setFillColor(248, 250, 252);
        doc.roundedRect(14, 40, 180, 28, 2, 2, 'F');

        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text("Prestador", 20, 48);
        doc.text("Período", 126, 48);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(71, 85, 105);
        doc.text(truncateText(prestadorNome, 56), 20, 54);
        doc.text(`CNPJ/CPF: ${formatDoc(prestador?.documento)}`, 20, 59);
        doc.text(`IM: ${prestador?.inscricaoMunicipal || '-'} | IBGE: ${prestador?.codigoIbge || '-'} | ${prestadorLocal || '-'}`, 20, 64);
        doc.text(periodoRelatorio, 126, 54);
        doc.text(`Gerado em: ${new Date().toLocaleString()}`, 126, 59);

        // Resumo
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(14, 75, 180, 20, 2, 2, 'F');
        
        doc.setFontSize(10);
        doc.setTextColor(80);
        doc.text("Valor Total (Autorizadas):", 20, 83);
        doc.text("Qtd. Notas:", 100, 83);
        doc.text("Canceladas:", 140, 83);

        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(22, 163, 74);
        doc.text(formatCurrency(summary.totalValor), 20, 90);
        
        doc.setTextColor(40);
        doc.text(String(summary.qtdAutorizadas), 100, 90);
        
        doc.setTextColor(220, 38, 38);
        doc.text(String(summary.qtdCanceladas), 140, 90);

        // Tabela PDF
        const tableData = notas.map(n => [
            new Date(n.dataEmissao || n.createdAt).toLocaleDateString(),
            n.numero || 'Pending',
            n.cliente?.razaoSocial || n.cliente?.nome || 'Consumidor',
            // CORREÇÃO 3: No PDF também mostramos o código se possível, ou a descrição curta
            n.codigoTribNacional || n.cnae || '-',
            formatCurrency(n.valor),
            n.status
        ]);

        autoTable(doc, {
            startY: 102,
            head: [['Data', 'Número', 'Tomador', 'Cód. Serviço', 'Valor', 'Status']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: [37, 99, 235] },
            styles: { fontSize: 8 },
            alternateRowStyles: { fillColor: [248, 250, 252] }
        });

        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(100);
            doc.text("Diretrizes NFSeGoo: valide valores, status e arquivos oficiais antes do fechamento contábil. Relatório sem valor fiscal autônomo.", 14, 286);
            doc.text(`Página ${i}/${pageCount}`, 180, 286);
        }

        doc.save(`relatorio_faturamento_${startDate}.pdf`);
    };

    // === EXPORTAÇÃO EM LOTE ===
    const handleExport = async (formato: 'XML' | 'PDF' | 'AMBOS') => {
        if (selectedIds.length === 0) return dialog.showAlert("Selecione pelo menos uma nota na tabela.");
        
        setDownloading(true);
        const userId = localStorage.getItem('userId');

        try {
            const res = await fetch('/api/relatorios/export', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'x-user-id': userId || '' 
                },
                body: JSON.stringify({ ids: selectedIds, formato })
            });

            const data = await res.json();
            
            if (res.ok && data.success) {
                const link = document.createElement('a');
                link.href = `data:application/zip;base64,${data.fileBase64}`;
                link.download = data.fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                dialog.showAlert({ type: 'success', description: "Download iniciado!" });
            } else {
                dialog.showAlert({ type: 'danger', description: "Erro: " + (data.error || "Acesso negado.") });
            }
        } catch (e) {
            dialog.showAlert("Erro de conexão.");
        } finally {
            setDownloading(false);
        }
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === notas.length) setSelectedIds([]);
        else setSelectedIds(notas.map(n => n.id));
    };

    const toggleSelectOne = (id: string) => {
        if (selectedIds.includes(id)) setSelectedIds(prev => prev.filter(i => i !== id));
        else setSelectedIds(prev => [...prev, id]);
    };

    if (isBlocked) {
        return (
            <div className="min-h-screen bg-slate-50">
                <header className="flex justify-between items-center p-6 border-b bg-white shadow-sm">
                    <div className="flex items-center gap-4">
                        <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500">
                            <ChevronLeft size={24}/>
                        </button>
                        <h1 className="text-xl font-bold text-slate-800">Relatórios Fiscais</h1>
                    </div>
                    <Sidebar />
                </header>
                <div className="flex flex-col items-center justify-center p-8 mt-12 text-center animate-in fade-in zoom-in duration-500">
                    <div className="bg-red-100 p-6 rounded-full text-red-500 mb-6 shadow-inner">
                        <Lock size={64} />
                    </div>
                    <h2 className="text-3xl font-bold text-slate-800 mb-4">Funcionalidade Bloqueada</h2>
                    <p className="text-slate-500 max-w-md mb-8 text-lg">
                        Seu plano atual não permite o acesso a relatórios avançados ou está expirado/inativo.
                    </p>
                    <Link href="/configuracoes/minha-conta" className="bg-blue-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition shadow-xl shadow-blue-200 flex items-center gap-2">
                        Ver Planos Disponíveis <ArrowRight size={20}/>
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="flex justify-between items-center p-6 border-b bg-white sticky top-0 z-30 shadow-sm">
                <div className="flex items-center gap-4">
                    <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500">
                        <ChevronLeft size={24}/>
                    </button>
                    <h1 className="text-xl font-bold text-slate-800">Relatórios Fiscais</h1>
                </div>
                <Sidebar />
            </header>

            <div className="p-6 max-w-7xl mx-auto space-y-6">
                
                {/* 1. RESUMO */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex flex-col md:flex-row justify-between gap-6">
                        <div>
                            <h2 className="text-sm font-bold text-slate-400 uppercase mb-1">Resumo do Período</h2>
                            <p className="text-slate-500 text-xs">
                                {startDate ? new Date(startDate + 'T12:00:00').toLocaleDateString() : '-'} até {endDate ? new Date(endDate + 'T12:00:00').toLocaleDateString() : '-'}
                            </p>
                            {prestador && (
                                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-blue-600">Prestador do relatório</p>
                                    <p className="mt-1 text-sm font-black text-slate-800">{prestador.razaoSocial || prestador.nomeFantasia}</p>
                                    <p className="mt-1 text-xs text-slate-500">
                                        CNPJ/CPF: {formatDoc(prestador.documento)} · IM: {prestador.inscricaoMunicipal || '-'} · IBGE: {prestador.codigoIbge || '-'} · {[prestador.cidade, prestador.uf].filter(Boolean).join('/') || '-'}
                                    </p>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-8">
                            <div className="text-right">
                                <p className="text-xs text-slate-500 font-bold uppercase">Valor Total (Autorizadas)</p>
                                <p className="text-2xl font-bold text-green-600">
                                    {loading ? '...' : formatCurrency(summary?.totalValor)}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-slate-500 font-bold uppercase">Emissões</p>
                                <p className="text-2xl font-bold text-blue-600">
                                    {loading ? '...' : summary?.qtdAutorizadas}
                                </p>
                            </div>
                             <div className="text-right border-l pl-8">
                                <p className="text-xs text-slate-400 font-bold uppercase">Canceladas</p>
                                <p className="text-2xl font-bold text-slate-500">
                                    {loading ? '...' : summary?.qtdCanceladas}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. FILTROS */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col xl:flex-row justify-between items-end gap-4">
                    <div className="flex flex-wrap items-end gap-3 w-full xl:w-auto">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Início</label>
                            <input type="date" className="p-2 border rounded-lg text-sm bg-slate-50" 
                                value={startDate} onChange={e => setStartDate(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Fim</label>
                            <input type="date" className="p-2 border rounded-lg text-sm bg-slate-50" 
                                value={endDate} onChange={e => setEndDate(e.target.value)} />
                        </div>
                        <div className="relative">
                             <div className="flex">
                                <input 
                                    className="pl-8 p-2 border rounded-l-lg text-sm w-48 outline-none"
                                    placeholder="Nome, CNPJ ou Nº..."
                                    value={search} onChange={e => setSearch(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && fetchData()}
                                />
                                <button onClick={fetchData} className="px-3 bg-blue-600 text-white rounded-r-lg hover:bg-blue-700">
                                    <Search size={16}/>
                                </button>
                             </div>
                             <Search className="absolute left-2.5 top-2.5 text-slate-400" size={14}/>
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer bg-slate-100 p-2 rounded-lg border h-[38px] select-none">
                            <input type="checkbox" className="w-4 h-4 text-blue-600 rounded" 
                                checked={incluirCanceladas} 
                                onChange={e => setIncluirCanceladas(e.target.checked)} />
                            <span className="text-xs font-bold text-slate-600">Exibir Canceladas</span>
                        </label>
                    </div>

                    <div className="flex gap-2 justify-end w-full xl:w-auto">
                        <button onClick={handleGeneratePDF} disabled={loading} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition shadow-sm mr-2">
                            <Printer size={14}/> Relatório PDF
                        </button>

                        {selectedIds.length > 0 && (
                            <>
                                <span className="text-xs font-bold text-slate-500 self-center mr-2 hidden md:block">
                                    {selectedIds.length} selecionado(s)
                                </span>
                                <button onClick={() => handleExport('XML')} disabled={downloading} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition disabled:opacity-50">
                                    {downloading ? <Loader2 className="animate-spin" size={14}/> : <FileCode size={14}/>} XML
                                </button>
                                <button onClick={() => handleExport('PDF')} disabled={downloading} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition disabled:opacity-50">
                                    {downloading ? <Loader2 className="animate-spin" size={14}/> : <FileText size={14}/>} PDF
                                </button>
                                <button onClick={() => handleExport('AMBOS')} disabled={downloading} className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition disabled:opacity-50">
                                    {downloading ? <Loader2 className="animate-spin" size={14}/> : <Archive size={14}/>} ZIP Completo
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* 3. TABELA */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b text-xs uppercase text-slate-500 font-bold">
                            <tr>
                                <th className="p-4 w-10 text-center">
                                    <button onClick={toggleSelectAll}>
                                        {selectedIds.length > 0 && selectedIds.length === notas.length 
                                            ? <CheckSquare className="text-blue-600" size={18}/> 
                                            : <Square className="text-slate-400" size={18}/>}
                                    </button>
                                </th>
                                <th className="p-4">Emissão</th>
                                <th className="p-4">Nota</th>
                                <th className="p-4">Tomador</th>
                                <th className="p-4">Cód. Serviço</th> {/* Mudei o título */}
                                <th className="p-4 text-right">Valor</th>
                                <th className="p-4 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr><td colSpan={7} className="p-12 text-center text-slate-400"><Loader2 className="animate-spin mx-auto mb-2"/> Carregando...</td></tr>
                            ) : notas.length === 0 ? (
                                <tr><td colSpan={7} className="p-12 text-center text-slate-400">Nenhuma nota encontrada.</td></tr>
                            ) : (
                                notas.map(nota => (
                                    <tr key={nota.id} className={`hover:bg-slate-50 transition ${selectedIds.includes(nota.id) ? 'bg-blue-50/50' : ''}`}>
                                        <td className="p-4 text-center">
                                            <button onClick={() => toggleSelectOne(nota.id)}>
                                                {selectedIds.includes(nota.id) 
                                                    ? <CheckSquare className="text-blue-600" size={18}/> 
                                                    : <Square className="text-slate-300 hover:text-slate-500" size={18}/>}
                                            </button>
                                        </td>
                                        <td className="p-4 text-slate-600 font-mono text-xs">
                                            {new Date(nota.dataEmissao || nota.createdAt).toLocaleDateString()}
                                            <span className="block text-[10px] text-slate-400">
                                                {new Date(nota.dataEmissao || nota.createdAt).toLocaleTimeString().slice(0,5)}
                                            </span>
                                        </td>
                                        <td className="p-4 font-bold text-slate-700">{nota.numero || '-'}</td>
                                        <td className="p-4">
                                            {/* === CORREÇÃO DO TOMADOR === */}
                                            {/* Tenta Razão Social, se não tiver, usa Nome, se não, Consumidor */}
                                            <div className="font-medium text-slate-800 line-clamp-1" title={nota.cliente.nomeFantasia}>
                                                {nota.cliente.razaoSocial || nota.cliente.nome || 'Consumidor'}
                                            </div>
                                            <div className="text-[10px] text-slate-400 font-mono">{nota.tomadorCnpj}</div>
                                        </td>
                                        <td className="p-4">
                                            <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100 cursor-help" title={nota.nomeServico || nota.descricao}>
                                                {nota.codigoTribNacional || nota.cnae || '-'}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right font-bold text-slate-700">
                                            {formatCurrency(nota.valor)}
                                        </td>
                                        <td className="p-4 text-center">
                                            {nota.status === 'AUTORIZADA' ? (
                                                <span className="px-2 py-1 rounded text-[10px] font-bold bg-green-100 text-green-700 border border-green-200">AUTORIZADA</span>
                                            ) : (
                                                <span className="px-2 py-1 rounded text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200 line-through">CANCELADA</span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                    <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
                        <span className="text-xs text-slate-500">Mostrando {notas.length} registros</span>
                        <div className="flex gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 bg-white border rounded hover:bg-slate-50 disabled:opacity-50"><ChevronLeft size={16}/></button>
                            <span className="px-3 py-2 text-sm font-bold text-slate-600 bg-white border rounded">{page} / {totalPages || 1}</span>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 bg-white border rounded hover:bg-slate-50 disabled:opacity-50"><ChevronRight size={16}/></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
