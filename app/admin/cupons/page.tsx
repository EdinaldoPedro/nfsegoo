'use client';

import { useState, useEffect } from 'react';
import { 
    Ticket, Plus, Trash2, Calendar, Users, 
    CheckCircle2, Loader2, Tag, Percent, DollarSign, 
    List as ListIcon, ArrowRight, ArrowLeftRight, ShieldAlert,
    Eye, Receipt, X // <--- Adicione estes 3 aqui!
} from 'lucide-react';

interface Plano { id: string; name: string; tipo: string; }

export default function AdminCuponsPage() {
    const [activeTab, setActiveTab] = useState<'CREATE' | 'CONSULT'>('CREATE');
    // Estado para o Modal de Raio-X
    const [cupomDetalhe, setCupomDetalhe] = useState<any | null>(null);
    
    // Dados do Sistema
    const [cupons, setCupons] = useState<any[]>([]);
    const [planosSistema, setPlanosSistema] = useState<Plano[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    
    // Estado do Formulário
    const [formData, setFormData] = useState({
        codigo: '',
        parceiroNome: '',
        tipoDesconto: 'PORCENTAGEM',
        valorDesconto: '',
        maxCiclos: '',
        limiteUsos: '',
        validade: '',
        apenasPrimeiraCompra: false
    });
    
    // Estado do Container Dinâmico
    const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);

    const carregarDados = async () => {
        setLoading(true);
        try {
            // Busca Cupons
            const resCupons = await fetch('/api/admin/cupons');
            const dataCupons = await resCupons.json();
            if (Array.isArray(dataCupons)) setCupons(dataCupons);

            // Busca Planos e Pacotes para o Container
            const resPlanos = await fetch('/api/plans');
            const dataPlanos = await resPlanos.json();
            if (Array.isArray(dataPlanos)) setPlanosSistema(dataPlanos);
            
        } catch (error) {
            console.error("Erro ao carregar dados", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregarDados(); }, []);

    // Lógica do Container "Click to Move"
    const togglePlanSelection = (planoId: string) => {
        setSelectedPlanIds(prev => 
            prev.includes(planoId) 
                ? prev.filter(id => id !== planoId) 
                : [...prev, planoId]
        );
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                ...formData,
                planosValidos: selectedPlanIds.length > 0 ? selectedPlanIds.join(',') : null,
                aplicarEm: selectedPlanIds.length > 0 ? 'PLANOS_SELECIONADOS' : 'CARRINHO_TOTAL'
            };

            const res = await fetch('/api/admin/cupons', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (res.ok) {
                alert("Cupom criado com sucesso!");
                setFormData({ codigo: '', parceiroNome: '', tipoDesconto: 'PORCENTAGEM', valorDesconto: '', maxCiclos: '', limiteUsos: '', validade: '', apenasPrimeiraCompra: false });
                setSelectedPlanIds([]);
                carregarDados();
                setActiveTab('CONSULT');
            } else {
                const data = await res.json();
                alert(data.error || "Erro ao criar cupom.");
            }
        } catch (error) {
            alert("Erro de conexão.");
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm("Tem certeza que deseja apagar este cupom? Esta ação não pode ser desfeita.")) return;
        
        try {
            const res = await fetch(`/api/admin/cupons?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                carregarDados(); // Recarrega a tabela automaticamente
            } else {
                alert("Erro ao apagar o cupom.");
            }
        } catch (error) {
            alert("Erro de conexão ao tentar apagar.");
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-6xl">
                {/* CABEÇALHO E ABAS */}
                <div className="mb-8">
                    <h1 className="text-2xl md:text-3xl font-black text-slate-800 flex items-center gap-3 mb-6">
                        <Ticket className="text-blue-600" size={32} /> 
                        Motor de Cupons e Parceiros
                    </h1>
                    
                    <div className="flex bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm w-full md:w-fit">
                        <button 
                            onClick={() => setActiveTab('CREATE')}
                            className={`flex-1 md:flex-none px-6 py-2.5 text-sm font-bold rounded-lg transition flex items-center justify-center gap-2 ${activeTab === 'CREATE' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                        >
                            <Plus size={16}/> Criar Estratégia
                        </button>
                        <button 
                            onClick={() => setActiveTab('CONSULT')}
                            className={`flex-1 md:flex-none px-6 py-2.5 text-sm font-bold rounded-lg transition flex items-center justify-center gap-2 ${activeTab === 'CONSULT' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                        >
                            <ListIcon size={16}/> Consultar & Relatórios
                        </button>
                    </div>
                </div>

                {/* =======================================================
                    ABA 1: CRIAR CUPOM (FORMULÁRIO AVANÇADO)
                ======================================================= */}
                {activeTab === 'CREATE' && (
                    <form onSubmit={handleCreate} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                                <Tag className="text-blue-600" size={20}/> Defina as regras do novo cupom
                            </h2>
                        </div>
                        
                        <div className="p-6 md:p-8 space-y-8">
                            
                            {/* 1. IDENTIFICAÇÃO E VALOR */}
                            <div>
                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">1. Identificação e Valor</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-2">Código do Cupom *</label>
                                        <input required placeholder="EX: VIMDA_A" value={formData.codigo} className="w-full p-3 border border-slate-200 rounded-xl font-black uppercase text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition" onChange={e => setFormData({...formData, codigo: e.target.value.toUpperCase()})}/>
                                    </div>
                                    
                                    {/* O INPUT VISUAL APRIMORADO */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-2">Desconto *</label>
                                        <div className="flex bg-slate-100 border border-slate-200 rounded-xl p-1 focus-within:ring-2 focus-within:ring-blue-500 transition">
                                            <button type="button" onClick={() => setFormData({...formData, tipoDesconto: formData.tipoDesconto === 'PORCENTAGEM' ? 'VALOR_FIXO' : 'PORCENTAGEM'})} className="flex items-center justify-center w-12 bg-white rounded-lg shadow-sm border border-slate-200 text-blue-600 font-black hover:bg-blue-50 transition">
                                                {formData.tipoDesconto === 'PORCENTAGEM' ? <Percent size={16}/> : <DollarSign size={16}/>}
                                            </button>
                                            <input required type="number" step="0.01" placeholder={formData.tipoDesconto === 'PORCENTAGEM' ? 'Ex: 50' : 'Ex: 100.00'} value={formData.valorDesconto} className="w-full p-2 bg-transparent font-black text-slate-800 outline-none px-3" onChange={e => setFormData({...formData, valorDesconto: e.target.value})}/>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-2">Parceiro Vinculado (Opcional)</label>
                                        <input placeholder="Ex: Escritório XPTO" value={formData.parceiroNome} className="w-full p-3 border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition" onChange={e => setFormData({...formData, parceiroNome: e.target.value})}/>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-slate-100"/>

                            {/* 2. CONTAINER DINÂMICO (ABRANGÊNCIA) */}
                            <div>
                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center justify-between">
                                    <span>2. Abrangência do Cupom</span>
                                    {selectedPlanIds.length === 0 && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full normal-case tracking-normal">Aplica no carrinho inteiro</span>}
                                </h3>
                                <p className="text-sm text-slate-500 mb-4">Clique num item para adicioná-lo ou removê-lo. Se deixar vazio, o cupom será válido para qualquer produto.</p>
                                
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                                    {/* LISTA DE DISPONÍVEIS */}
                                    <div>
                                        <div className="text-xs font-bold text-slate-500 mb-2 text-center">Itens Disponíveis</div>
                                        <div className="bg-white border border-slate-200 rounded-lg p-2 h-48 overflow-y-auto space-y-1 custom-scrollbar">
                                            {planosSistema.filter(p => !selectedPlanIds.includes(p.id)).map(plano => (
                                                <button key={`disp-${plano.id}`} type="button" onClick={() => togglePlanSelection(plano.id)} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md transition flex items-center justify-between group">
                                                    <span className="truncate">{plano.name}</span>
                                                    <ArrowRight size={14} className="text-slate-300 group-hover:text-blue-500"/>
                                                </button>
                                            ))}
                                            {planosSistema.filter(p => !selectedPlanIds.includes(p.id)).length === 0 && <div className="text-center text-xs text-slate-400 mt-10">Nenhum item restante.</div>}
                                        </div>
                                    </div>

                                    {/* LISTA DE SELECIONADOS */}
                                    <div>
                                        <div className="text-xs font-bold text-blue-600 mb-2 text-center flex items-center justify-center gap-1">
                                            <CheckCircle2 size={12}/> Válido Apenas Para
                                        </div>
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 h-48 overflow-y-auto space-y-1 custom-scrollbar">
                                            {planosSistema.filter(p => selectedPlanIds.includes(p.id)).map(plano => (
                                                <button key={`sel-${plano.id}`} type="button" onClick={() => togglePlanSelection(plano.id)} className="w-full text-left px-3 py-2 text-sm text-blue-800 bg-white shadow-sm border border-blue-100 hover:bg-red-50 hover:text-red-600 hover:border-red-200 rounded-md transition flex items-center justify-between group">
                                                    <span className="truncate font-medium">{plano.name}</span>
                                                    <Trash2 size={14} className="opacity-0 group-hover:opacity-100"/>
                                                </button>
                                            ))}
                                            {selectedPlanIds.length === 0 && <div className="text-center text-xs text-blue-400 mt-10 italic">Selecione itens ao lado 👉</div>}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-slate-100"/>

                            {/* 3. TRAVAS DE SEGURANÇA E DATA */}
                            <div>
                                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">3. Travas de Segurança & Data</h3>
                                
                                <label className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer hover:bg-amber-100/50 transition mb-6 w-fit">
                                    <input type="checkbox" checked={formData.apenasPrimeiraCompra} onChange={e => setFormData({...formData, apenasPrimeiraCompra: e.target.checked})} className="w-5 h-5 text-amber-600 rounded border-amber-300 focus:ring-amber-500"/>
                                    <div>
                                        <span className="block font-bold text-amber-900 text-sm flex items-center gap-1"><ShieldAlert size={14}/> Apenas Primeira Compra</span>
                                        <span className="text-xs text-amber-700">Impede que clientes antigos usem na renovação.</span>
                                    </div>
                                </label>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-2">Validade (Data Exata)</label>
                                        <input type="date" value={formData.validade} className="w-full p-3 border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({...formData, validade: e.target.value})}/>
                                        <p className="text-[10px] text-slate-400 mt-1">Deixe vazio se não expirar.</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-2">Limite Total de Usos</label>
                                        <input type="number" placeholder="Ex: 100" value={formData.limiteUsos} className="w-full p-3 border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({...formData, limiteUsos: e.target.value})}/>
                                        <p className="text-[10px] text-slate-400 mt-1">Quantas vezes no total pode ser usado.</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-2">Máximo de Ciclos (Meses)</label>
                                        <input type="number" placeholder="Ex: 2" value={formData.maxCiclos} className="w-full p-3 border border-slate-200 rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none" onChange={e => setFormData({...formData, maxCiclos: e.target.value})}/>
                                        <p className="text-[10px] text-slate-400 mt-1">Se colocar 2, dá desconto só em até 2 meses de plano.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end">
                            <button type="submit" disabled={saving} className="px-8 py-3.5 bg-blue-600 text-white rounded-xl font-black shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition flex items-center gap-2 disabled:opacity-50">
                                {saving ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle2 size={20} />}
                                {saving ? 'A Criar...' : 'Salvar e Ativar Cupom'}
                            </button>
                        </div>
                    </form>
                )}

               {/* =======================================================
                    ABA 2: CONSULTAR CUPONS & RELATÓRIOS
                ======================================================= */}
                {activeTab === 'CONSULT' && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                                <ListIcon className="text-blue-600" size={20}/> Relatório de Parcerias
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left whitespace-nowrap">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Código / Parceiro</th>
                                        <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Desconto</th>
                                        <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Métricas de Uso</th>
                                        <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                                        <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {loading ? (
                                        <tr><td colSpan={5} className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-blue-600" /></td></tr>
                                    ) : cupons.length === 0 ? (
                                        <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-medium">Nenhum cupom criado ainda.</td></tr>
                                    ) : cupons.map((cupom: any) => {
                                        
                                        let statusBadge = <span className="text-xs bg-green-100 text-green-700 font-bold px-3 py-1.5 rounded-lg">Ativo</span>;
                                        if (cupom.limiteUsos && cupom.vezesUsado >= cupom.limiteUsos) {
                                            statusBadge = <span className="text-xs bg-red-100 text-red-700 font-bold px-3 py-1.5 rounded-lg">Esgotado</span>;
                                        } else if (cupom.validade && new Date(cupom.validade) < new Date()) {
                                            statusBadge = <span className="text-xs bg-amber-100 text-amber-700 font-bold px-3 py-1.5 rounded-lg">Expirado</span>;
                                        }

                                        return (
                                            <tr key={cupom.id} className="hover:bg-slate-50/50 transition">
                                                <td className="px-6 py-4">
                                                    <span className="block font-black text-slate-700 text-lg">{cupom.codigo}</span>
                                                    <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                                                        <Users size={12}/> {cupom.parceiroNome || 'Orgânico'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-sm font-bold border border-green-200">
                                                        {cupom.tipoDesconto === 'PORCENTAGEM' ? <Percent size={14}/> : <DollarSign size={14}/>}
                                                        {cupom.tipoDesconto === 'PORCENTAGEM' ? `${cupom.valorDesconto}%` : `R$ ${cupom.valorDesconto}`}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-black text-slate-700">{cupom.vezesUsado} resgates</span>
                                                        <span className="text-[10px] text-slate-400 font-medium">Limite: {cupom.limiteUsos ? cupom.limiteUsos : 'Ilimitado'}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">{statusBadge}</td>
                                                <td className="px-6 py-4 text-right">
                                                    {/* BOTÃO RAIO-X */}
                                                    <button 
                                                        onClick={() => setCupomDetalhe(cupom)}
                                                        className="p-2.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition shadow-sm border border-transparent mr-2" 
                                                        title="Ver Relatório Detalhado"
                                                    >
                                                        <Eye size={18}/>
                                                    </button>
                                                    {/* BOTÃO APAGAR */}
                                                    <button 
                                                        onClick={() => handleDelete(cupom.id)}
                                                        className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition shadow-sm border border-transparent" 
                                                    >
                                                        <Trash2 size={18}/>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* =======================================================
                    MODAL DE RAIO-X (RELATÓRIO FINANCEIRO DO PARCEIRO)
                ======================================================= */}
                {cupomDetalhe && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
                        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8">
                            
                            {/* CABEÇALHO DO MODAL */}
                            <div className="p-6 border-b flex justify-between items-center bg-slate-50">
                                <div>
                                    <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                        <Receipt className="text-blue-600"/> Relatório de Resgates
                                    </h2>
                                    <p className="text-xs font-bold text-slate-500 mt-1 uppercase tracking-wider">
                                        Cupom: <span className="text-blue-600">{cupomDetalhe.codigo}</span> | Parceiro: {cupomDetalhe.parceiroNome || 'Nenhum'}
                                    </p>
                                </div>
                                <button onClick={() => setCupomDetalhe(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-200 text-slate-500 hover:bg-slate-300 transition font-bold"><X size={18}/></button>
                            </div>

                            {/* MÉTRICAS GLOBAIS NO TOPO */}
                            <div className="grid grid-cols-3 gap-4 p-6 bg-slate-100 border-b border-slate-200">
                                <div className="bg-white p-4 rounded-xl shadow-sm">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Total de Resgates</p>
                                    <p className="text-2xl font-black text-slate-800">{cupomDetalhe.logs?.length || 0}</p>
                                </div>
                                <div className="bg-white p-4 rounded-xl shadow-sm">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Desconto Total Gerado</p>
                                    <p className="text-2xl font-black text-red-500">
                                        R$ {cupomDetalhe.logs?.reduce((acc: number, log: any) => acc + Number(log.descontoAplicado), 0).toFixed(2) || "0.00"}
                                    </p>
                                </div>
                                <div className="bg-white p-4 rounded-xl shadow-sm border-2 border-blue-100">
                                    <p className="text-[10px] font-bold text-blue-500 uppercase">Status da Campanha</p>
                                    <p className="text-xl font-black text-blue-700 mt-1">{cupomDetalhe.ativo ? 'Em andamento' : 'Pausada'}</p>
                                </div>
                            </div>

                            {/* TABELA DE LOGS (QUEM USOU E QUANDO) */}
                            <div className="max-h-[400px] overflow-y-auto custom-scrollbar p-6">
                                <h3 className="text-sm font-black text-slate-800 mb-4 border-b pb-2">Histórico de Clientes</h3>
                                
                                {cupomDetalhe.logs?.length === 0 ? (
                                    <div className="text-center p-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                        Este cupom ainda não foi utilizado por nenhum cliente.
                                    </div>
                                ) : (
                                    <table className="w-full text-left text-sm">
                                        <thead className="text-xs text-slate-400 uppercase bg-slate-50">
                                            <tr>
                                                <th className="px-4 py-3 font-bold">Data</th>
                                                <th className="px-4 py-3 font-bold">Cliente</th>
                                                <th className="px-4 py-3 font-bold text-right">Desconto (R$)</th>
                                                <th className="px-4 py-3 font-bold">Status Fatura</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {cupomDetalhe.logs?.map((log: any) => (
                                                <tr key={log.id} className="hover:bg-slate-50">
                                                    <td className="px-4 py-3 font-medium text-slate-600">
                                                        {new Date(log.createdAt).toLocaleDateString('pt-BR')} <span className="text-[10px] text-slate-400 ml-1">{new Date(log.createdAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="block font-bold text-slate-800">{log.user.nome}</span>
                                                        <span className="block text-xs text-slate-500">{log.user.email}</span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black text-red-500">
                                                        - R$ {Number(log.descontoAplicado).toFixed(2)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase ${log.fatura.status === 'PAGO' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                                            {log.fatura.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
