'use client';

import Link from "next/link";
import { useState, useEffect, useRef, ReactNode } from "react";
import { CheckCircle, ArrowRight, MapPin, Info, Loader2, Zap, Package, Shield, Smartphone, Users, Cloud, ChevronLeft, ChevronRight,ChevronDown, Briefcase, Calculator, Handshake } from "lucide-react";

// === COMPONENTE DE ANIMAÇÃO DE ROLAGEM (SCROLL REVEAL) ===
function Reveal({ children, delay = 0, className = "" }: { children: ReactNode, delay?: number, className?: string }) {
    const [isVisible, setIsVisible] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
                observer.disconnect();
            }
        }, { threshold: 0.1 });

        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div 
            ref={ref} 
            className={`transition-all duration-1000 ease-out ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'} ${className}`}
            style={{ transitionDelay: `${delay}ms` }}
        >
            {children}
        </div>
    );
}

// === CONFIGURAÇÕES DE STATUS DO MAPA ===
type StatusID = 0 | 1 | 2 | 3;
interface StatusConfig { label: string; color: string; dotColor: string; }
const getStatusConfig = (status: StatusID): StatusConfig => {
  switch (status) {
    case 0: return { label: 'Integrado', color: 'bg-green-100 text-green-700 border-green-200', dotColor: 'bg-green-500' };
    case 1: return { label: 'Integrado (Beta)', color: 'bg-blue-100 text-blue-700 border-blue-200', dotColor: 'bg-blue-500' };
    case 2: return { label: 'Em Integração', color: 'bg-amber-100 text-amber-700 border-amber-200', dotColor: 'bg-amber-500' };
    case 3: return { label: 'Em Desenvolvimento', color: 'bg-slate-100 text-slate-500 border-slate-200', dotColor: 'bg-slate-400' };
    default: return { label: 'Desconhecido', color: 'bg-gray-100', dotColor: 'bg-gray-400' };
  }
};

export default function LandingPage() {
  const [regime, setRegime] = useState('MEI');
  const [filtroUf, setFiltroUf] = useState('TODOS');
  const [cidadesDb, setCidadesDb] = useState([]);
  const [scrolled, setScrolled] = useState(false);
  
  const [planos, setPlanos] = useState([]);
  const [loadingMap, setLoadingMap] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // === ROLAGEM SUAVE PARA ÂNCORAS ===
  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const element = document.getElementById(id);
    if (element) {
      // Pega a posição do elemento e subtrai a altura do header fixo (aprox 80px)
      const offsetTop = element.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: offsetTop, behavior: 'smooth' });
    }
  };

  // Efeito do Header Fixo
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
      fetch('/api/admin/cobertura').then(r => r.json()).then(data => { if(Array.isArray(data)) setCidadesDb(data as never[]); }).finally(() => setLoadingMap(false));
      fetch('/api/plans').then(r => r.json()).then(data => {
            if(Array.isArray(data)) {
                const planosOrdenados = data.filter((p: any) => p.active && (!p.tipo || p.tipo === 'PLANO')).sort((a: any, b: any) => {
                    const precoA = Number(a.priceMonthly) > 0 ? Number(a.priceMonthly) : Number(a.priceYearly);
                    const precoB = Number(b.priceMonthly) > 0 ? Number(b.priceMonthly) : Number(b.priceYearly);
                    return precoA - precoB;
                });
                setPlanos(planosOrdenados as never[]);
            }
        }).finally(() => setLoadingPlans(false));
  }, []);

  // Carrossel Automático
  useEffect(() => {
      if (isPaused || planos.length === 0) return;
      const interval = setInterval(() => {
          if (scrollContainerRef.current) {
              const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
              const card = scrollContainerRef.current.children[0] as HTMLElement;
              if (!card) return;
              const gap = 24; 
              const scrollAmount = card.offsetWidth + gap;
              if (scrollLeft + clientWidth >= scrollWidth - 10) scrollContainerRef.current.scrollTo({ left: 0, behavior: 'smooth' });
              else scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
          }
      }, 2500);
      return () => clearInterval(interval);
  }, [isPaused, planos]);

  const scroll = (direction: 'left' | 'right') => {
      if (scrollContainerRef.current) {
          const card = scrollContainerRef.current.children[0] as HTMLElement;
          if (!card) return;
          const scrollAmount = card.offsetWidth + 24;
          scrollContainerRef.current.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
      }
  }

  const cidadesDoRegime = cidadesDb.filter((c: any) => c.regime === regime);
  const cidadesFiltradas = cidadesDoRegime.filter((c: any) => filtroUf === 'TODOS' || c.uf === filtroUf);
  const ufsDisponiveis = Array.from(new Set(cidadesDoRegime.map((c: any) => c.uf))).sort();
  useEffect(() => { setFiltroUf('TODOS'); }, [regime]);

  const featuresList = [
      { title: "Emissão Rápida", desc: "Emita suas notas fiscais em poucos segundos, sem burocracia.", icon: Zap, corTexto: "text-amber-600", corFundo: "bg-amber-100" },
      { title: "Pacotes Avulsos", desc: "Aumentou o volume este mês? Compre pacotes extras de notas a qualquer momento.", icon: Package, corTexto: "text-blue-600", corFundo: "bg-blue-100" },
      { title: "Gestão de Clientes", desc: "Mantenha o cadastro dos seus tomadores de serviço organizado.", icon: Users, corTexto: "text-indigo-600", corFundo: "bg-indigo-100" },
      { title: "Suporte Web e Mobile", desc: "Acesse nosso painel de qualquer dispositivo com design responsivo.", icon: Smartphone, corTexto: "text-emerald-600", corFundo: "bg-emerald-100" },
      { title: "Backup em Nuvem", desc: "Suas notas e cadastros salvos com segurança nos melhores servidores.", icon: Cloud, corTexto: "text-sky-600", corFundo: "bg-sky-100" },
      { title: "Certificado A1", desc: "Integração transparente com o seu Certificado Digital e-CNPJ A1.", icon: Shield, corTexto: "text-rose-600", corFundo: "bg-rose-100" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans selection:bg-blue-200 selection:text-blue-900 overflow-hidden">
      
      {/* CSS CUSTOMIZADO PARA ANIMAÇÕES FLUTUANTES (BLOBS) */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob { animation: blob 7s infinite; }
        .animation-delay-2000 { animation-delay: 2s; }
        .animation-delay-4000 { animation-delay: 4s; }
      `}} />

      {/* === HEADER === */}
      <header className={`fixed top-0 w-full z-50 transition-all duration-500 ease-in-out ${scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm py-3 translate-y-0' : 'bg-transparent py-5 animate-in slide-in-from-top-full duration-700'}`}>
        <div className="flex justify-between items-center px-6 max-w-7xl mx-auto">
            <Link href="/" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-2xl font-black text-blue-600 flex items-center gap-2 tracking-tight group hover:scale-105 transition-transform active:scale-95">
                <img src="/icons/G.png" alt="NFSeGoo" className="w-8 h-8 object-contain" />
                <span className="bg-gradient-to-r from-blue-700 to-emerald-400 bg-clip-text text-transparent">
                    NFSe<span className="font-light">Goo</span>
                </span>
            </Link>
            <nav className="space-x-2 hidden md:flex items-center">
                
                {/* MENU DROPDOWN: SOLUÇÕES */}
                <div className="relative group">
                    <button className="text-slate-500 hover:text-blue-600 font-bold px-4 py-2 transition-colors flex items-center gap-1 cursor-default">
                        Soluções <ChevronDown size={16} className="group-hover:rotate-180 transition-transform duration-200" />
                    </button>
                    
                    {/* Caixinha Flutuante (Aparece no Hover) */}
                    <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform translate-y-2 group-hover:translate-y-0 flex flex-col p-2 z-50">
                        
                        <Link href="/cadastro" className="p-3 hover:bg-blue-50 rounded-xl flex items-center gap-3 transition-colors group/item">
                            <div className="bg-blue-100 text-blue-600 p-2.5 rounded-lg group-hover/item:scale-110 transition-transform"><Briefcase size={18}/></div>
                            <div className="text-left">
                                <p className="text-sm font-bold text-slate-800">Ei, PJ!</p>
                                <p className="text-[11px] text-slate-500 font-medium leading-tight mt-0.5">Empresas e Prestadores</p>
                            </div>
                        </Link>
                        
                        <Link href="/cadastro?tipo=contador" className="p-3 hover:bg-emerald-50 rounded-xl flex items-center gap-3 transition-colors group/item mt-1">
                            <div className="bg-emerald-100 text-emerald-600 p-2.5 rounded-lg group-hover/item:scale-110 transition-transform"><Calculator size={18}/></div>
                            <div className="text-left">
                                <p className="text-sm font-bold text-slate-800">Ei, Contador!</p>
                                <p className="text-[11px] text-slate-500 font-medium leading-tight mt-0.5">Gestão de BPO Financeiro</p>
                            </div>
                        </Link>
                        
                        <a href="https://wa.me/seu-numero" target="_blank" rel="noreferrer" className="p-3 hover:bg-purple-50 rounded-xl flex items-center gap-3 transition-colors group/item mt-1">
                            <div className="bg-purple-100 text-purple-600 p-2.5 rounded-lg group-hover/item:scale-110 transition-transform"><Handshake size={18}/></div>
                            <div className="text-left">
                                <p className="text-sm font-bold text-slate-800">Seja Parceiro</p>
                                <p className="text-[11px] text-slate-500 font-medium leading-tight mt-0.5">Altos volumes e Contratos</p>
                            </div>
                        </a>
                    </div>
                </div>

                <a href="#planos" onClick={(e) => scrollToSection(e, 'planos')} className="text-slate-500 hover:text-blue-600 font-bold px-4 py-2 transition-colors cursor-pointer">Planos</a>
                <a href="#cobertura" onClick={(e) => scrollToSection(e, 'cobertura')} className="text-slate-500 hover:text-blue-600 font-bold px-4 py-2 transition-colors cursor-pointer">Cidades</a>
                
                <div className="h-6 w-px bg-slate-300 mx-2"></div>
                
                <Link href="/login" className="text-blue-600 hover:text-blue-800 font-bold px-4 py-2 transition-colors active:scale-95">Login</Link>
                <Link href="/cadastro" className="bg-blue-600 text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 font-bold shadow-lg shadow-blue-200 hover:shadow-blue-400 hover:-translate-y-0.5 active:scale-95 active:translate-y-0 transition-all">
                    Começar Grátis
                </Link>
            </nav>
        </div>
      </header>

      <main className="pt-32 relative">
        
        {/* === BLOBS FLUTUANTES NO FUNDO (EFEITO VIVO) === */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
            <div className="absolute top-20 left-10 w-72 h-72 bg-blue-400/20 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob"></div>
            <div className="absolute top-40 right-20 w-72 h-72 bg-purple-400/20 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-2000"></div>
            <div className="absolute -bottom-8 left-40 w-72 h-72 bg-indigo-400/20 rounded-full mix-blend-multiply filter blur-3xl opacity-70 animate-blob animation-delay-4000"></div>
        </div>

        {/* === HERO SECTION === */}
        <div className="max-w-7xl mx-auto px-6 pb-20 pt-10 text-center relative z-10">
            <Reveal delay={100}>
                <span className="bg-white text-blue-700 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider mb-8 inline-block border border-blue-100 shadow-md shadow-blue-100/50 hover:scale-105 transition-transform cursor-default">
                    🚀 Versão 1.2 Beta Lançada
                </span>
            </Reveal>
            
            <Reveal delay={200}>
                <h1 className="text-4xl md:text-6xl lg:text-7xl font-black text-slate-900 mb-6 leading-tight tracking-tight">
                Emita Notas Fiscais Nacionais <br /> <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">sem dor de cabeça</span>
                </h1>
            </Reveal>

            <Reveal delay={300}>
                <p className="text-lg md:text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
                O sistema ideal para prestadores de serviço e MEIs. Simples, rápido e integrado ao novo Portal Nacional da Receita Federal.
                </p>
            </Reveal>

            <Reveal delay={400}>
                <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Link href="/cadastro" className="group flex items-center justify-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-xl text-lg font-bold hover:bg-blue-700 shadow-xl shadow-blue-200 hover:shadow-blue-400 hover:-translate-y-1 active:scale-95 active:translate-y-0 transition-all">
                    Criar Conta Agora <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </Link>
                <a href="#cobertura" onClick={(e) => scrollToSection(e, 'cobertura')} className="flex items-center justify-center gap-2 bg-white text-slate-700 border border-slate-200 px-8 py-4 rounded-xl text-lg font-bold hover:bg-slate-50 hover:border-slate-300 hover:-translate-y-1 active:scale-95 active:translate-y-0 transition-all shadow-sm cursor-pointer">
                    Ver Cidades Atendidas
                </a>
                </div>
            </Reveal>
        </div>
       

        {/* === FEATURES === */}
        <div className="max-w-7xl mx-auto px-6 py-12 mb-10 relative z-10">
            <Reveal>
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-bold text-slate-800">Tudo o que você precisa em um só lugar</h2>
                    <p className="text-slate-500 mt-4 text-lg">Nossa plataforma foi desenhada para descomplicar a sua rotina fiscal.</p>
                </div>
            </Reveal>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuresList.map((item, i) => {
                const IconComponent = item.icon;
                return (
                <Reveal key={i} delay={i * 100}>
                    <div className="flex flex-col items-start bg-white/80 backdrop-blur-sm p-8 rounded-3xl shadow-sm border border-slate-100 hover:border-blue-300 hover:shadow-xl hover:-translate-y-2 transition-all duration-300 group cursor-default">
                        <div className={`${item.corFundo} ${item.corTexto} p-4 rounded-2xl mb-6 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-300`}>
                            <IconComponent size={32} strokeWidth={2.5} />
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-3">{item.title}</h3>
                        <p className="text-slate-600 text-sm leading-relaxed">{item.desc}</p>
                    </div>
                </Reveal>
            )})}
            </div>
        </div>

         <SecaoPublicoAlvo />

        {/* === SEÇÃO DE COBERTURA === */}
        <div id="cobertura" className="bg-white py-24 border-t border-slate-200 relative z-10">
            <div className="max-w-5xl mx-auto px-6">
                <Reveal>
                    <div className="text-center mb-12">
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-800 mb-4">Municípios Integrados</h2>
                        <p className="text-slate-500 max-w-2xl mx-auto text-lg">
                            Verifique a disponibilidade do nosso motor fiscal de acordo com o seu regime tributário e localização.
                        </p>
                    </div>
                </Reveal>

                <Reveal delay={200}>
                    <div className="flex justify-center mb-8">
                        <div className="bg-slate-100 p-1.5 rounded-2xl inline-flex gap-1 overflow-x-auto max-w-full shadow-inner border border-slate-200">
                            <button onClick={() => setRegime('MEI')} className={`whitespace-nowrap px-8 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 ${regime === 'MEI' ? 'bg-white text-blue-600 shadow-md border border-slate-200/50' : 'text-slate-500 hover:text-slate-800'}`}>
                                MEI (Nacional)
                            </button>
                            <button onClick={() => setRegime('SN')} className={`whitespace-nowrap px-8 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 ${regime === 'SN' ? 'bg-white text-blue-600 shadow-md border border-slate-200/50' : 'text-slate-500 hover:text-slate-800'}`}>
                                Simples Nacional
                            </button>
                            <button onClick={() => setRegime('LP')} className={`whitespace-nowrap px-8 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 ${regime === 'LP' ? 'bg-white text-blue-600 shadow-md border border-slate-200/50' : 'text-slate-500 hover:text-slate-800'}`}>
                                Lucro Presumido
                            </button>
                        </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-3xl p-8 min-h-[350px] shadow-sm relative overflow-hidden group">
                        {regime === 'MEI' && (
                            <div className="flex flex-col items-center justify-center h-full text-center space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 relative z-10 py-10">
                                <div className="relative">
                                    <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-20"></div>
                                    <div className="w-24 h-24 bg-gradient-to-br from-blue-100 to-blue-200 rounded-full flex items-center justify-center text-blue-600 relative z-10 shadow-lg shadow-blue-200/50 group-hover:scale-110 transition-transform duration-500">
                                        <MapPin size={48} className="drop-shadow-sm animate-bounce" style={{animationDuration: '3s'}}/>
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-3xl font-black text-slate-800 mb-3">Cobertura Nacional Ativa</h3>
                                    <p className="text-slate-600 max-w-md mx-auto text-lg leading-relaxed mb-6">Para MEIs, nosso sistema está integrado com o padrão nacional, atendendo a <strong>todos os municípios do Brasil</strong>.</p>
                                    <StatusBadge status={1} />
                                </div>
                            </div>
                        )}

                        {(regime === 'SN' || regime === 'LP') && (
                            <div className="animate-in fade-in slide-in-from-bottom-8 duration-500">
                                <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4 border-b border-slate-200 pb-6">
                                    <h3 className="font-bold text-slate-700 flex items-center gap-2 text-lg">
                                        <MapPin size={20} className="text-blue-500 group-hover:animate-bounce"/> 
                                        {regime === 'SN' ? 'Cidades Homologadas (Simples Nacional)' : 'Cidades Homologadas (Lucro Presumido)'}
                                    </h3>
                                    
                                    <div className="flex items-center gap-3 bg-white p-2 rounded-xl shadow-sm border border-slate-200 hover:border-blue-300 transition-colors">
                                        <span className="text-xs font-bold text-slate-400 uppercase pl-2">UF:</span>
                                        <select className="p-2 border-none bg-transparent font-bold text-blue-600 outline-none cursor-pointer" value={filtroUf} onChange={(e) => setFiltroUf(e.target.value)}>
                                            <option value="TODOS">Todas as Regiões</option>
                                            {ufsDisponiveis.map(uf => <option key={uf as string} value={uf as string}>{uf as string}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {loadingMap ? (
                                    <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-500" size={40}/></div>
                                ) : (
                                    <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar"> 
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {cidadesFiltradas.length > 0 ? (
                                                cidadesFiltradas.map((cidade: any, idx) => (
                                                    <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center hover:border-blue-400 hover:shadow-md hover:-translate-y-1 active:scale-95 transition-all cursor-default group/card">
                                                        <div>
                                                            <p className="font-bold text-slate-800 truncate max-w-[140px] group-hover/card:text-blue-700 transition-colors" title={cidade.nome}>{cidade.nome}</p>
                                                            <span className="text-[10px] font-black text-slate-500 bg-slate-100 px-2 py-0.5 rounded tracking-wider">{cidade.uf}</span>
                                                        </div>
                                                        <StatusBadge status={cidade.status as StatusID} mini />
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="col-span-full flex flex-col items-center justify-center py-16 text-center text-slate-400">
                                                    <Info size={48} className="text-slate-300 mb-4 animate-pulse" />
                                                    <p className="text-lg font-medium text-slate-500">Nenhuma cidade integrada para este filtro ainda.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </Reveal>

                <Reveal delay={300}>
                    <div className="mt-8 flex flex-wrap justify-center gap-4 md:gap-8 pt-4">
                        <LegendItem status={0} />
                        <LegendItem status={1} />
                        <LegendItem status={2} />
                        <LegendItem status={3} />
                    </div>
                </Reveal>
            </div>
        </div>

        {/* === SEÇÃO DE PLANOS (CARROSSEL AUTOMÁTICO) === */}
        <div id="planos" className="bg-slate-900 py-24 relative overflow-hidden">
            {/* Efeitos de Fundo (Luzes desfocadas) */}
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-[100px] pointer-events-none animate-pulse" style={{animationDuration: '4s'}}></div>
            <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[100px] pointer-events-none animate-pulse" style={{animationDuration: '6s'}}></div>

            <div className="max-w-7xl mx-auto px-6 mb-16 relative z-10">
                <Reveal>
                    <div className="text-center">
                        <h2 className="text-3xl md:text-5xl font-black text-white mb-6">Planos que crescem com você</h2>
                        <p className="text-slate-400 max-w-2xl mx-auto text-lg md:text-xl">
                            Escolha a opção ideal para o seu volume de notas. Sem fidelidade, cancele quando quiser.
                        </p>
                    </div>
                </Reveal>
            </div>

            {loadingPlans ? (
                <div className="flex justify-center p-12 relative z-10"><Loader2 className="animate-spin text-blue-500" size={40}/></div>
            ) : planos.length > 0 ? (
                <Reveal delay={200} className="relative z-10">
                    <div 
                        className="relative max-w-[1400px] mx-auto group px-4 md:px-12"
                        onMouseEnter={() => setIsPaused(true)}
                        onMouseLeave={() => setIsPaused(false)}
                    >
                        <button onClick={() => scroll('left')} className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 z-20 bg-slate-800 p-3.5 rounded-full shadow-xl border border-slate-700 text-white hover:bg-blue-600 hover:border-blue-500 transition-all opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95">
                            <ChevronLeft size={24}/>
                        </button>
                        
                        <button onClick={() => scroll('right')} className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 z-20 bg-slate-800 p-3.5 rounded-full shadow-xl border border-slate-700 text-white hover:bg-blue-600 hover:border-blue-500 transition-all opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95">
                            <ChevronRight size={24}/>
                        </button>

                        <div 
                            ref={scrollContainerRef}
                            className="flex gap-6 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-12 pt-4 px-2"
                            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                        >
                            <style dangerouslySetInnerHTML={{ __html: `::-webkit-scrollbar { display: none; }` }} />
                            
                            {planos.map((plano: any) => {
                                let parsedFeatures: string[] = [];
                                try { parsedFeatures = JSON.parse(plano.features); } catch { parsedFeatures = plano.features ? String(plano.features).split(',') : []; }
                                const isAnual = Number(plano.priceMonthly) === 0 && Number(plano.priceYearly) > 0;
                                const price = isAnual ? Number(plano.priceYearly) : Number(plano.priceMonthly);
                                const label = isAnual ? '/ano' : '/mês';

                                return (
                                    <div 
                                        key={plano.id} 
                                        className={`snap-start shrink-0 w-full sm:w-[calc(50%-12px)] lg:w-[calc(25%-18px)] bg-slate-800/80 backdrop-blur-sm rounded-3xl p-8 border hover:-translate-y-3 hover:shadow-2xl hover:shadow-blue-900/50 transition-all duration-500 flex flex-col relative ${plano.recommended ? 'border-blue-500 shadow-lg shadow-blue-900/30' : 'border-slate-700 hover:border-slate-400'}`}
                                    >
                                        {plano.recommended && (
                                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg shadow-blue-500/30 whitespace-nowrap animate-pulse">
                                                Mais Popular
                                            </div>
                                        )}
                                        
                                        <div className="mb-6 mt-2">
                                            <h3 className="text-xl font-black text-white mb-2 truncate" title={plano.name}>{plano.name.replace('Plano ', '')}</h3>
                                            <p className="text-slate-400 text-sm h-10 line-clamp-2">{plano.description || 'Para o seu negócio.'}</p>
                                        </div>
                                        
                                        <div className="mb-6 border-b border-slate-700 pb-6 group-hover:border-slate-500 transition-colors">
                                            {price === 0 && !isAnual ? (
                                                <span className="text-4xl font-black text-emerald-400">Grátis</span>
                                            ) : (
                                                <>
                                                    <span className="text-4xl font-black text-white">
                                                        R$ {price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                    </span>
                                                    <span className="text-slate-400 font-medium text-sm"> {label}</span>
                                                </>
                                            )}
                                        </div>
                                        
                                        <ul className="space-y-4 mb-8 flex-1">
                                            <li className="flex items-start gap-3 text-slate-300">
                                                <CheckCircle size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                                                <span className="font-medium text-sm">
                                                    {plano.maxNotasMensal > 0 ? <strong className="text-white">{plano.maxNotasMensal} Notas</strong> : <strong className="text-white">Notas Ilimitadas</strong>}
                                                </span>
                                            </li>
                                            <li className="flex items-start gap-3 text-slate-300">
                                                <CheckCircle size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                                                <span className="font-medium text-sm">
                                                    {plano.maxClientes > 0 ? <strong className="text-white">{plano.maxClientes} Clientes</strong> : <strong className="text-white">Clientes Ilimitados</strong>}
                                                </span>
                                            </li>
                                            {parsedFeatures.slice(0, 4).map((feat, i) => (
                                                <li key={i} className="flex items-start gap-3 text-slate-400">
                                                    <CheckCircle size={18} className="text-blue-400 flex-shrink-0 mt-0.5 opacity-70" />
                                                    <span className="text-sm leading-tight">{feat.trim()}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        
                                        <Link href={`/cadastro?plan=${plano.slug}`} className={`w-full py-4 rounded-xl font-bold text-sm text-center transition-all active:scale-95 ${plano.recommended ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/50 hover:-translate-y-1' : 'bg-slate-700 text-white hover:bg-slate-600 hover:-translate-y-1'}`}>
                                            Assinar Agora
                                        </Link>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </Reveal>
            ) : (
                <div className="text-center text-slate-500 relative z-10">Nenhum plano disponível no momento.</div>
            )}
        </div>
      </main>

      {/* === FOOTER === */}
      <footer className="bg-slate-950 pt-16 pb-8 border-t border-slate-800 overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <Reveal>
                <div className="flex items-center justify-center gap-2 text-3xl font-black mb-6 tracking-tight group hover:scale-105 transition-transform cursor-pointer">
                    <img src="/icons/G.png" alt="NFSeGoo" className="w-10 h-10 object-contain group-hover:-translate-y-1 transition-transform" />
                    <span className="bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                        NFSe<span className="font-light">Goo</span>
                    </span>
                </div>
            </Reveal>
            <Reveal delay={100}>
                <p className="text-slate-400 max-w-md mx-auto mb-10 text-sm leading-relaxed">
                    Ajudamos empreendedores a simplificar a emissão de notas fiscais com tecnologia e automação em todo o Brasil.
                </p>
            </Reveal>
            <Reveal delay={200}>
                <div className="mb-8 flex flex-wrap items-center justify-center gap-4 text-sm font-bold text-slate-500">
                    <Link href="/termos-de-uso" className="transition hover:text-blue-300">Termos de Uso</Link>
                    <Link href="/politica-de-privacidade" className="transition hover:text-blue-300">Privacidade</Link>
                    <Link href="/politica-de-cookies" className="transition hover:text-blue-300">Cookies</Link>
                </div>
                <div className="border-t border-slate-800/50 pt-8 text-slate-600 text-sm font-medium">
                    © {new Date().getFullYear()} NFSe Goo. Todos os direitos reservados.
                </div>
            </Reveal>
          </div>
      </footer>
    </div>
  );
}

// Componentes Visuais de Apoio
function StatusBadge({ status, mini = false }: { status: StatusID, mini?: boolean }) {
    const config = getStatusConfig(status);
    if (mini) return <div className={`w-3 h-3 rounded-full shadow-sm ${config.dotColor}`} title={config.label}></div>;
    return <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold border ${config.color}`}><span className={`w-2.5 h-2.5 rounded-full ${config.dotColor} animate-pulse`}></span>{config.label}</span>;
}

function LegendItem({ status }: { status: StatusID }) {
    const config = getStatusConfig(status);
    return <div className="flex items-center gap-2 hover:scale-105 transition-transform cursor-default"><span className={`w-3 h-3 rounded-full shadow-sm ${config.dotColor}`}></span><span className="text-xs font-bold text-slate-600 uppercase tracking-wide">{config.label}</span></div>;
}

// === SEÇÃO DE PÚBLICO ALVO ===
function SecaoPublicoAlvo() {
  return (
    <div className="max-w-7xl mx-auto px-6 py-12 relative z-10">
        <Reveal>
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-slate-800">
                A solução perfeita para o seu perfil
              </h2>
              <p className="mt-4 text-lg text-slate-500">
                Escolha como você quer usar a plataforma e descubra recursos feitos sob medida.
              </p>
            </div>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* CARD 1: EI PJ */}
          <Reveal delay={100}>
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 hover:shadow-xl hover:border-blue-300 hover:-translate-y-2 transition-all duration-300 relative overflow-hidden group h-full flex flex-col cursor-default">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Briefcase size={120} className="text-blue-600" />
                </div>
                <div className="w-14 h-14 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-transform">
                  <Briefcase className="text-blue-600" size={28} />
                </div>
                <h3 className="text-2xl font-black text-slate-800 mb-3">Ei, PJ!</h3>
                <p className="text-slate-600 mb-6 flex-1 text-sm leading-relaxed">
                  Ideal para prestadores de serviço, MEIs e pequenas empresas. Emita suas notas de forma 100% automática e sem burocracia.
                </p>
                <ul className="space-y-3 mb-8 text-sm text-slate-600 font-medium">
                  <li className="flex items-center gap-2"><CheckCircle size={16} className="text-blue-500"/> Emissão rápida</li>
                  <li className="flex items-center gap-2"><CheckCircle size={16} className="text-blue-500"/> Controle de limites</li>
                  <li className="flex items-center gap-2"><CheckCircle size={16} className="text-blue-500"/> Planos self-service</li>
                </ul>
                <Link href="/cadastro" className="inline-flex items-center justify-center gap-2 w-full bg-blue-50 text-blue-700 font-bold py-3 rounded-xl hover:bg-blue-600 hover:text-white transition-colors">
                  Criar minha conta <ArrowRight size={18} />
                </Link>
              </div>
          </Reveal>

          {/* CARD 2: EI CONTADOR */}
          <Reveal delay={200}>
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 hover:shadow-xl hover:border-emerald-300 hover:-translate-y-2 transition-all duration-300 relative overflow-hidden group h-full flex flex-col cursor-default">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Calculator size={120} className="text-emerald-600" />
                </div>
                <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:-rotate-6 transition-transform">
                  <Calculator className="text-emerald-600" size={28} />
                </div>
                <h3 className="text-2xl font-black text-slate-800 mb-3">Ei, Contador!</h3>
                <p className="text-slate-600 mb-6 flex-1 text-sm leading-relaxed">
                  O paraíso do BPO Financeiro. Gerencie múltiplos CNPJs num dashboard unificado, emita notas e tenha controle da carteira.
                </p>
                <ul className="space-y-3 mb-8 text-sm text-slate-600 font-medium">
                  <li className="flex items-center gap-2"><CheckCircle size={16} className="text-emerald-500"/> Multi-empresas</li>
                  <li className="flex items-center gap-2"><CheckCircle size={16} className="text-emerald-500"/> Vínculo de CNPJ</li>
                  <li className="flex items-center gap-2"><CheckCircle size={16} className="text-emerald-500"/> Gestão centralizada</li>
                </ul>
                <Link href="/cadastro?tipo=contador" className="inline-flex items-center justify-center gap-2 w-full bg-emerald-50 text-emerald-700 font-bold py-3 rounded-xl hover:bg-emerald-600 hover:text-white transition-colors">
                  Cadastrar escritório <ArrowRight size={18} />
                </Link>
              </div>
          </Reveal>

          {/* CARD 3: SEJA PARCEIRO */}
          <Reveal delay={300}>
              <div className="bg-slate-900 rounded-3xl shadow-md border border-slate-800 p-8 hover:shadow-xl hover:border-purple-500 hover:-translate-y-2 transition-all duration-300 relative overflow-hidden group h-full flex flex-col cursor-default">
                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Handshake size={120} className="text-purple-400" />
                </div>
                <div className="w-14 h-14 bg-purple-900/50 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-6 transition-transform">
                  <Handshake className="text-purple-400" size={28} />
                </div>
                <h3 className="text-2xl font-black text-white mb-3">Seja Parceiro</h3>
                <p className="text-slate-400 mb-6 flex-1 text-sm leading-relaxed">
                  Volume alto? Temos contratos customizados. Limites massivos e negociação direta com nossa diretoria para grandes operações.
                </p>
                <ul className="space-y-3 mb-8 text-sm text-slate-300 font-medium">
                  <li className="flex items-center gap-2"><CheckCircle size={16} className="text-purple-400"/> Limites customizados</li>
                  <li className="flex items-center gap-2"><CheckCircle size={16} className="text-purple-400"/> Faturamento sob medida</li>
                  <li className="flex items-center gap-2"><CheckCircle size={16} className="text-purple-400"/> Atendimento VIP</li>
                </ul>
                <a href="https://wa.me/seu-numero" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 w-full bg-purple-900/40 text-purple-300 font-bold py-3 rounded-xl hover:bg-purple-600 hover:text-white transition-colors border border-purple-800/50 hover:border-transparent">
                  Falar com Comercial <ArrowRight size={18} />
                </a>
              </div>
          </Reveal>

        </div>
    </div>
  );
}
