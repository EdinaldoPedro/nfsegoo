'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
    ArrowLeft, ShoppingCart, ShieldCheck, 
    Loader2, Calendar, Ticket, PackagePlus, ChevronDown, Tag
} from 'lucide-react';

interface Plan {
    id: string;
    name: string;
    slug: string;
    description: string;
    priceMonthly: number;
    priceYearly: number;
}

interface CartAddons {
    [planId: string]: number;
}

interface CupomAtivo {
    id: string;
    codigo: string;
    tipoDesconto: string;
    valorDesconto: number;
    aplicarEm: string;
    maxCiclos: number | null;
    planosValidos: string | null; // <--- NOVA PROPRIEDADE
}

function CheckoutContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const planSlug = searchParams.get('plan');
    const cycleParam = searchParams.get('cycle'); 
    
    const [loading, setLoading] = useState(true);
    const [basePlans, setBasePlans] = useState<Plan[]>([]); 
    const [plano, setPlano] = useState<Plan | null>(null);
    const [pacotesDisponiveis, setPacotesDisponiveis] = useState<Plan[]>([]); 

    const [processing, setProcessing] = useState(false);
    const [loadingText, setLoadingText] = useState('Solicitar Ativação Manual');
    const [requestSent, setRequestSent] = useState('');
    const [, setStep] = useState<1 | 2>(1);
    const [, setCopiado] = useState(false);
    
    
    const [ciclo, setCiclo] = useState<'MENSAL' | 'ANUAL'>((cycleParam as 'MENSAL'|'ANUAL') || 'MENSAL');
    const [qtdCiclos, setQtdCiclos] = useState(1);
    const [quantidadesPacotes, setQuantidadesPacotes] = useState<CartAddons>({});
    
    const [cupomDigitado, setCupomDigitado] = useState('');
    const [cupomAtivo, setCupomAtivo] = useState<CupomAtivo | null>(null);
    const [erroCupom, setErroCupom] = useState('');
    const [loadingCupom, setLoadingCupom] = useState(false);

    useEffect(() => {
        fetch('/api/plans')
            .then(r => r.json())
            .then((plans: Plan[]) => {
                const principais = plans.filter(p => !p.slug.toLowerCase().includes('pacote') && p.slug !== 'TRIAL' && p.slug !== 'PARCEIRO');
                setBasePlans(principais);

                const selected = plans.find(p => p.slug === planSlug);
                if (selected && !selected.slug.toLowerCase().includes('pacote') && selected.slug !== 'TRIAL') {
                    setPlano(selected);
                    const ehAnual = Number(selected.priceMonthly) === 0 && Number(selected.priceYearly) > 0;
                    setCiclo(ehAnual ? 'ANUAL' : 'MENSAL');
                    if (ehAnual) setQtdCiclos(1);
                }

                let pacotesDoBanco = plans.filter(p => p.slug.toLowerCase().includes('pacote'));
                
                pacotesDoBanco.sort((a, b) => {
                    if (a.slug.includes('NOTA')) return -1;
                    if (b.slug.includes('NOTA')) return 1;
                    return 0;
                });

                setPacotesDisponiveis(pacotesDoBanco);

                const extrasIniciais = Number(searchParams.get('extras'));
                if (extrasIniciais > 0 && pacotesDoBanco.length > 0) {
                    setQuantidadesPacotes({ [pacotesDoBanco[0].id]: extrasIniciais });
                }

                setLoading(false);
            })
            .catch(err => {
                console.error("Erro ao buscar planos:", err);
                setLoading(false);
            });
    }, [planSlug, searchParams]);

    if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={40}/></div>;

    if (planSlug === 'PARCEIRO' || planSlug === 'parceiro-contabil') {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
                <div className="bg-white p-10 rounded-3xl shadow-xl max-w-lg text-center border border-slate-200">
                    <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                        <ShieldCheck size={40} />
                    </div>
                    <h2 className="text-2xl font-black text-slate-800 mb-4">Plano Parceiro Contábil</h2>
                    <p className="text-slate-600 mb-8 leading-relaxed">
                        Os planos para contadores possuem condições exclusivas e faturamento unificado via contrato interno.
                    </p>
                    <div className="flex flex-col gap-3">
                        <button className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition shadow-lg">Falar com um Consultor (WhatsApp)</button>
                        <button onClick={() => router.back()} className="w-full py-4 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition">Voltar</button>
                    </div>
                </div>
            </div>
        );
    }

    const precoUnitarioPlano = plano ? (ciclo === 'MENSAL' ? Number(plano.priceMonthly) : Number(plano.priceYearly)) : 0;
    const subtotalPlano = precoUnitarioPlano * qtdCiclos; 
    
    let valorTotalPacotes = 0;
    pacotesDisponiveis.forEach(pacote => {
        const qtd = quantidadesPacotes[pacote.id] || 0;
        valorTotalPacotes += qtd * Number(pacote.priceMonthly); 
    });
    
    const subtotal = subtotalPlano + valorTotalPacotes;
    
    // ==========================================
    // A MATEMÁTICA CORRIGIDA E INTELIGENTE!
    // ==========================================
    let baseCalculoDesconto = 0;
    const ciclosComDesconto = cupomAtivo?.maxCiclos ? Math.min(qtdCiclos, cupomAtivo.maxCiclos) : qtdCiclos;
    const valorPlanoComDescontoAplicavel = precoUnitarioPlano * ciclosComDesconto;

    if (cupomAtivo) {
        if (cupomAtivo.aplicarEm === 'PLANOS_SELECIONADOS' && cupomAtivo.planosValidos) {
            const permitidos = cupomAtivo.planosValidos.split(',');
            
            // Soma o desconto no Plano Principal SE ele estiver na lista de permitidos
            if (plano && permitidos.includes(plano.id)) {
                baseCalculoDesconto += valorPlanoComDescontoAplicavel;
            }
            
            // Soma o desconto nos Pacotes Extras SE eles estiverem na lista de permitidos
            pacotesDisponiveis.forEach(pacote => {
                if (permitidos.includes(pacote.id)) {
                    const qtd = quantidadesPacotes[pacote.id] || 0;
                    baseCalculoDesconto += qtd * Number(pacote.priceMonthly);
                }
            });
            
        } else if (cupomAtivo.aplicarEm === 'SO_ASSINATURA') {
            baseCalculoDesconto = valorPlanoComDescontoAplicavel;
        } else if (cupomAtivo.aplicarEm === 'SO_PACOTES') {
            baseCalculoDesconto = valorTotalPacotes;
        } else {
            // CARRINHO TOTAL
            baseCalculoDesconto = valorPlanoComDescontoAplicavel + valorTotalPacotes;
        }
    }

    let valorDesconto = 0;
    if (cupomAtivo) {
        if (cupomAtivo.tipoDesconto === 'PORCENTAGEM') {
            valorDesconto = baseCalculoDesconto * (cupomAtivo.valorDesconto / 100);
        } else {
            valorDesconto = Math.min(cupomAtivo.valorDesconto, baseCalculoDesconto);
        }
    }

    const total = Math.max(0, subtotal - valorDesconto);

    const labelCiclo = ciclo === 'MENSAL' ? 'Mês' : 'Ano';
    const labelPlural = ciclo === 'MENSAL' ? 'Meses' : 'Anos';
    const isAnual = ciclo === 'ANUAL';

    const handleQtdPlanoChange = (delta: number) => {
        const novoValor = qtdCiclos + delta;
        if (novoValor < 0) return;
        if (isAnual && novoValor > 1) return; 
        setQtdCiclos(novoValor);
    };

    const atualizarQtdPacote = (pacoteId: string, delta: number) => {
        setQuantidadesPacotes(prev => {
            const atual = prev[pacoteId] || 0;
            const novoValor = Math.max(0, atual + delta);
            return { ...prev, [pacoteId]: novoValor };
        });
    };

    const handleAplicarCupom = async () => {
        setErroCupom('');
        const codigo = cupomDigitado.trim().toUpperCase();
        if (!codigo) return;

        setLoadingCupom(true);

        // Mapeia quais pacotes o cliente adicionou no carrinho
        const pacotesIds = pacotesDisponiveis
            .filter(p => (quantidadesPacotes[p.id] || 0) > 0)
            .map(p => p.id);

        try {
            const res = await fetch('/api/cupons/validar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    codigo, 
                    planoId: plano?.id,
                    pacotesIds // <--- ENVIANDO OS PACOTES AGORA!
                })
            });

            const data = await res.json();

            if (res.ok) {
                setCupomAtivo(data);
                setCupomDigitado('');
            } else {
                setErroCupom(data.error || 'Cupom inválido.');
            }
        } catch (error) {
            setErroCupom('Erro de conexão ao validar o cupom.');
        } finally {
            setLoadingCupom(false);
        }
    };

    const handleRemoverCupom = () => {
        setCupomAtivo(null);
        setCupomDigitado('');
        setErroCupom('');
    };

    const handleManualCheckout = async () => {
        setProcessing(true);
        setLoadingText('Registrando solicitacao...');

        try {
            const pacotesComprados = pacotesDisponiveis
                .filter(p => (quantidadesPacotes[p.id] || 0) > 0)
                .map(p => ({ planId: p.id, qtd: quantidadesPacotes[p.id] }));

            const res = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    planSlug: plano?.slug || null,
                    ciclo,
                    qtdCiclos,
                    pacotes: pacotesComprados,
                    cupom: cupomAtivo?.codigo || null
                })
            });

            const data = await res.json();

            if (!res.ok) {
                alert(data.error || 'Erro ao registrar a solicitacao.');
                setLoadingText('Solicitar Ativacao Manual');
                setProcessing(false);
                return;
            }

            setRequestSent('Solicitacao registrada. O checkout automatico esta em desenvolvimento. Para agilizar, fale com o administrador por um contato conhecido ou pelo suporte.');
            setLoadingText('Solicitacao enviada');
            setProcessing(false);
        } catch (error) {
            console.error(error);
            alert('Erro de conexao ao registrar a solicitacao.');
            setLoadingText('Solicitar Ativacao Manual');
            setProcessing(false);
        }
    };

    const handleSolicitarAtivacao = async () => {
        if (typeof window !== 'undefined') return handleManualCheckout();
        setProcessing(true);
        setLoadingText('Registrando solicitaÃ§Ã£o...');

        try {
            await new Promise(r => setTimeout(r, 600)); 
            setLoadingText('Validando itens...');

            const pacotesComprados = pacotesDisponiveis
                .filter(p => (quantidadesPacotes[p.id] || 0) > 0)
                .map(p => ({ planId: p.id, qtd: quantidadesPacotes[p.id] }));

            await new Promise(r => setTimeout(r, 600)); 
            setLoadingText('Gerando cobrança PIX...');

            const res = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    planSlug: plano?.slug || null,
                    ciclo,
                    qtdCiclos, 
                    pacotes: pacotesComprados, 
                    cupom: cupomAtivo?.codigo || null 
                })
            });

            const data = await res.json();
            
            if (res.ok) {
                setLoadingText('Tudo pronto!');
                await new Promise(r => setTimeout(r, 400));
                setStep(2); 
            } else {
                alert(data.error || 'Erro ao gerar o pedido.');
                setLoadingText('Finalizar Pedido');
                setProcessing(false);
            }
        } catch (error) {
            console.error(error);
            alert('Erro de conexão ao gerar o PIX.');
            setLoadingText('Finalizar Pedido');
            setProcessing(false);
        }
    };

    const handleCopiarPix = () => {
        navigator.clipboard.writeText("00020101021126580014br.gov.bcb.pix...");
        setCopiado(true);
        setTimeout(() => setCopiado(false), 3000);
    };

    void handleCopiarPix;

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
            <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                <div className="lg:col-span-2 space-y-6">
                    <button onClick={() => router.back()} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 font-bold text-sm transition">
                        <ArrowLeft size={18}/> Voltar
                    </button>

                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <ShoppingCart className="text-blue-600"/> Finalizar Contratação
                    </h1>

                    <div className={`bg-white p-6 rounded-xl shadow-sm border transition duration-300 ${qtdCiclos === 0 ? 'border-dashed border-slate-300 opacity-75' : 'border-slate-200'}`}>
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="relative">
                                        <select 
                                            value={plano?.id || ''}
                                            onChange={(e) => {
                                                const novoPlano = basePlans.find(p => p.id === e.target.value);
                                                setPlano(novoPlano || null);
                                                if (novoPlano) {
                                                    const ehAnual = Number(novoPlano.priceMonthly) === 0 && Number(novoPlano.priceYearly) > 0;
                                                    setCiclo(ehAnual ? 'ANUAL' : 'MENSAL');
                                                    if (qtdCiclos === 0) setQtdCiclos(1);
                                                    else if (ehAnual && qtdCiclos > 1) setQtdCiclos(1);
                                                }
                                                // TRAVA DE SEGURANÇA: Remove cupom ao mudar de plano!
                                                if (cupomAtivo) {
                                                    setCupomAtivo(null);
                                                    setErroCupom('O plano foi alterado. Por favor, aplique o cupom novamente.');
                                                }
                                            }}
                                            className="appearance-none bg-slate-100 hover:bg-slate-200 border-none text-slate-800 py-1.5 pl-3 pr-8 rounded-lg font-bold text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer transition max-w-[200px] sm:max-w-none truncate"
                                        >
                                            <option value="">Nenhum Plano</option>
                                            {basePlans.map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={16} className="absolute right-2 top-2.5 text-slate-500 pointer-events-none" />
                                    </div>
                                    {plano && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">{ciclo}</span>}
                                </div>
                                <p className="text-slate-500 text-sm ml-1">{plano ? plano.description : 'Apenas pacotes avulsos.'}</p>
                            </div>
                            
                            {plano && (
                                <div className="text-right">
                                    <span className="text-2xl font-black text-slate-800">{precoUnitarioPlano.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                    <span className="text-xs text-slate-400 block">/{labelCiclo.toLowerCase()}</span>
                                </div>
                            )}
                        </div>

                        {plano && (
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 flex items-center justify-between">
                                <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                    <Calendar size={16} className={qtdCiclos === 0 ? 'text-slate-400' : 'text-blue-600'}/> 
                                    {qtdCiclos === 0 ? 'Plano removido' : `Garanta ${qtdCiclos} ${qtdCiclos > 1 ? labelPlural.toLowerCase() : labelCiclo.toLowerCase()}`}
                                </span>
                                <div className="flex items-center gap-3 bg-white p-1 rounded-lg shadow-sm border border-slate-200">
                                    <button onClick={() => handleQtdPlanoChange(-1)} disabled={qtdCiclos === 0} className="w-8 h-8 font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-30 rounded transition">-</button>
                                    <span className={`text-lg font-bold w-8 text-center ${qtdCiclos === 0 ? 'text-slate-400' : 'text-blue-700'}`}>{qtdCiclos}</span>
                                    <button onClick={() => handleQtdPlanoChange(1)} disabled={isAnual && qtdCiclos >= 1} className="w-8 h-8 font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-30 rounded transition">+</button>
                                </div>
                            </div>
                        )}
                    </div>

                    {pacotesDisponiveis.length > 0 && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2 border-b pb-4 mb-4">
                                <PackagePlus className="text-blue-600"/> Adicionais e Extras
                            </h3>
                            
                            <div className="space-y-4">
                                {pacotesDisponiveis.map(pacote => {
                                    const price = Number(pacote.priceMonthly);
                                    const qtd = quantidadesPacotes[pacote.id] || 0;
                                    const isNotas = pacote.slug.includes('NOTA');
                                    
                                    return (
                                        <div key={pacote.id} className={`flex items-center justify-between p-4 rounded-xl border ${isNotas ? 'bg-blue-50/50 border-blue-100' : 'bg-slate-50 border-slate-100'}`}>
                                            <div>
                                                <span className={`block font-bold ${isNotas ? 'text-blue-800' : 'text-slate-800'}`}>{pacote.name}</span>
                                                <span className="text-xs text-slate-500">R$ {price.toFixed(2).replace('.',',')} / unid.</span>
                                            </div>
                                            <div className="flex items-center gap-3 bg-white p-1 rounded-lg border shadow-sm">
                                                <button onClick={() => atualizarQtdPacote(pacote.id, -1)} className="w-8 h-8 text-slate-500 hover:bg-slate-100 rounded font-bold">-</button>
                                                <span className={`text-lg font-bold w-8 text-center ${qtd > 0 ? (isNotas ? 'text-blue-600' : 'text-slate-800') : 'text-slate-400'}`}>{qtd}</span>
                                                <button onClick={() => atualizarQtdPacote(pacote.id, 1)} className="w-8 h-8 text-slate-500 hover:bg-slate-100 rounded font-bold">+</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="lg:col-span-1">
                    <div className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 sticky top-6">
                        <h3 className="font-bold text-slate-800 mb-6 text-lg border-b pb-4">Resumo do Pedido</h3>
                        
                        <div className="space-y-3 text-sm text-slate-600 mb-6">
                            {plano && qtdCiclos > 0 && (
                                <div className="flex justify-between font-medium text-slate-800">
                                    <span>{plano.name} ({qtdCiclos}x)</span>
                                    <span>{subtotalPlano.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                </div>
                            )}
                            
                            {pacotesDisponiveis.map(pacote => {
                                const qtd = quantidadesPacotes[pacote.id] || 0;
                                if (qtd === 0) return null;
                                const valorItem = qtd * Number(pacote.priceMonthly);
                                return (
                                    <div key={`resumo-${pacote.id}`} className="flex justify-between text-slate-500">
                                        <span>{qtd}x {pacote.name.replace('Pacote ', '')}</span>
                                        <span>{valorItem.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                    </div>
                                );
                            })}

                            {total === 0 && <div className="text-center text-slate-400 italic">Seu carrinho está vazio</div>}
                        </div>

                        <div className="mb-6">
                            {cupomAtivo ? (
                                <div className="bg-green-50 border-2 border-dashed border-green-300 p-4 rounded-xl flex items-center justify-between transition-all">
                                    <div>
                                        <div className="flex items-center gap-2 text-green-700 font-bold mb-0.5">
                                            <Ticket size={16}/> {cupomAtivo.codigo}
                                        </div>
                                        <p className="text-xs text-green-600 font-medium">
                                            -{cupomAtivo.tipoDesconto === 'PORCENTAGEM' ? `${cupomAtivo.valorDesconto}%` : `R$ ${cupomAtivo.valorDesconto}`} aplicado
                                        </p>
                                    </div>
                                    <button onClick={handleRemoverCupom} className="text-xs font-bold text-slate-400 hover:text-red-500 transition px-2 py-1 bg-white rounded shadow-sm">
                                        Remover
                                    </button>
                                </div>
                            ) : (
                                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                                        <Tag size={12}/> Tem cupom de desconto?
                                    </label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            value={cupomDigitado}
                                            onChange={(e) => setCupomDigitado(e.target.value.toUpperCase())}
                                            placeholder="Ex: PROMO20"
                                            className="w-full p-2.5 border border-slate-200 rounded-lg uppercase text-sm focus:ring-2 focus:ring-blue-500 outline-none transition disabled:opacity-50"
                                            disabled={loadingCupom}
                                        />
                                        <button 
                                            onClick={handleAplicarCupom} 
                                            disabled={loadingCupom || !cupomDigitado}
                                            className="bg-slate-800 text-white px-4 py-2.5 rounded-lg text-sm font-bold hover:bg-slate-700 transition disabled:opacity-50 flex items-center justify-center min-w-[80px]"
                                        >
                                            {loadingCupom ? <Loader2 size={16} className="animate-spin" /> : 'Aplicar'}
                                        </button>
                                    </div>
                                    {erroCupom && <p className="text-red-500 text-xs mt-2 flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-red-500"></span> {erroCupom}</p>}
                                </div>
                            )}
                        </div>

                        <div className="border-t pt-4 mb-6">
                            {cupomAtivo && (
                                <div className="flex justify-between items-center mb-1 text-sm text-green-600 font-bold">
                                    <span>Desconto</span>
                                    <span>-{valorDesconto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-end mt-2">
                                <span className="font-bold text-slate-800">Estimativa comercial</span>
                                <span className="text-3xl font-black text-slate-900 leading-none">{total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                            </div>
                        </div>

                        {requestSent && (
                            <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                                {requestSent}
                            </div>
                        )}

                        <button 
                            onClick={handleSolicitarAtivacao}
                            disabled={processing || total === 0 || !!requestSent}
                            className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {processing ? <Loader2 className="animate-spin"/> : <ShieldCheck size={20}/>}
                            {processing ? loadingText : 'Solicitar Ativação Manual'}
                        </button>
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">Em desenvolvimento</p>
                            <p className="mt-1 text-xs leading-relaxed text-amber-900">
                                O checkout automatico ainda esta em desenvolvimento. Para contratar ou ativar um plano ou pacote, entre em contato com o administrador por um canal conhecido ou abra um chamado no suporte.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function Page() {
    return <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={40}/></div>}><CheckoutContent /></Suspense>
}
