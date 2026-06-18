'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Package, Globe, Lightbulb, ChevronRight, TrendingUp } from 'lucide-react';

export default function Vitrine() {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [supportLink, setSupportLink] = useState('/cliente/suporte');
    const [newTicketLink, setNewTicketLink] = useState('/cliente/suporte/novo');
    
    // Estado para guardar os números reais do banco
    const [stats, setStats] = useState({ totalNotas: 0, totalClientes: 0, municipios: 0, valorMes: 0 });

    // Busca as estatísticas ao carregar
    useEffect(() => {
        const userId = localStorage.getItem('userId');

        if (userId) {
            fetch(`/api/saas/stats?t=${Date.now()}`, { 
                cache: 'no-store',
                headers: { 'x-user-id': userId } 
            })
                .then(res => {
                    if (!res.ok) throw new Error('Erro na API');
                    return res.json();
                })
                .then(data => {
                    if (data && !data.error) setStats(data);
                })
                .catch(console.error);
        }
    }, []);

    useEffect(() => {
        const userRole = localStorage.getItem('userRole') || '';
        const isSupportMode = localStorage.getItem('isSupportMode') === 'true';
        const isInternalSupport = ['MASTER', 'ADMIN', 'SUPORTE', 'SUPORTE_TI'].includes(userRole);

        if (isInternalSupport && !isSupportMode) {
            setSupportLink('/admin/suporte');
            setNewTicketLink('/admin/suporte');
        }
    }, []);

    // === DADOS DA VITRINE ===
    const vitrineCards = [
        {
            id: 'dashboard', 
            titulo: "O Poder da Nossa Rede",
            descricao: "Milhares de notas são emitidas diariamente. Confie na robustez do sistema para escalar o seu negócio de forma segura.",
            badge: "NÚMEROS DA PLATAFORMA",
            btnTexto: "Ver Nossos Planos",
            btnLink: "/configuracoes/minha-conta",
            bgClass: "bg-gradient-to-br from-slate-800 to-slate-900",
            Icon: TrendingUp,
            isDashboard: true
        },
        {
            id: 1,
            titulo: "Pacotes Avulsos de Notas",
            descricao: "O seu volume de faturação aumentou este mês? Adquira notas extras sem alterar a sua subscrição atual.",
            badge: "NOVIDADE",
            btnTexto: "Ver Pacotes",
            btnLink: "/configuracoes/minha-conta",
            bgClass: "bg-gradient-to-br from-blue-600 to-indigo-700",
            Icon: Package
        },
        {
            id: 2,
            titulo: "Fature para o Exterior",
            descricao: "Sabia que o nosso sistema permite emitir faturas em Dólar e Euro de forma nativa e automática?",
            badge: "DICA",
            btnTexto: "Saber Mais",
            btnLink: supportLink,
            bgClass: "bg-gradient-to-br from-emerald-500 to-teal-700",
            Icon: Globe
        },
        {
            id: 3,
            titulo: "Precisa de Ajuda?",
            descricao: "A nossa equipa de suporte está pronta para ajudar a configurar o seu certificado digital ou tirar dúvidas.",
            badge: "SUPORTE",
            btnTexto: "Abrir Ticket",
            btnLink: newTicketLink,
            bgClass: "bg-gradient-to-br from-amber-500 to-orange-600",
            Icon: Lightbulb
        }
    ];

    // Motor do Carrossel (Pausa no hover, roda a cada 6s para dar tempo de ler)
    useEffect(() => {
        if (isPaused) return;
        
        const timer = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % vitrineCards.length);
        }, 6000); 
        
        return () => clearInterval(timer);
    }, [isPaused, vitrineCards.length]);

    return (
        <div 
            className="relative h-full min-h-[220px] w-full overflow-hidden rounded-2xl border border-slate-200 shadow-sm group sm:min-h-[250px] xl:min-h-[420px]"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
        >
            {vitrineCards.map((card, index) => {
                const isActive = index === currentIndex;
                const Icon = card.Icon;
                
                return (
                    <div 
                        key={card.id}
                        className={`absolute inset-0 flex h-full w-full flex-col justify-between p-5 transition-all duration-700 ease-in-out sm:p-6 xl:p-8 ${card.bgClass} ${isActive ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none'}`}
                    >
                        <div className="absolute right-0 top-0 p-4 opacity-10 transform transition-transform duration-700 group-hover:scale-110 xl:p-6">
                            <Icon className="h-24 w-24 xl:h-[140px] xl:w-[140px]" />
                        </div>
                        
                        {card.isDashboard ? (
                            // === LAYOUT ESPECIAL DO MINI DASHBOARD ===
                            <div className="relative z-10 flex flex-col h-full">
                                <div>
                                    <span className="inline-block px-3 py-1 bg-white/20 backdrop-blur-md text-white text-[10px] font-black uppercase tracking-widest rounded-full mb-3">
                                        {card.badge}
                                    </span>
                                    <h3 className="mb-2 text-xl font-black leading-tight text-white drop-shadow-sm xl:text-2xl">{card.titulo}</h3>
                                    <p className="mb-4 line-clamp-2 text-xs font-medium text-slate-300 xl:line-clamp-none">{card.descricao}</p>
                                </div>
                                
                                {/* === NOVO LAYOUT DE CAIXAS (TOTALMENTE VISÍVEL) === */}
                                <div className="mb-4 mt-auto hidden w-full flex-col gap-3 xl:flex">
                                    
                                    {/* Linha Superior: 3 Contadores Menores */}
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="bg-white/10 rounded-xl p-3 border border-white/10 backdrop-blur-sm flex flex-col justify-center transition hover:bg-white/20">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase mb-1">NFS-e</span>
                                            <span className="text-xl font-black text-white">{stats.totalNotas}</span>
                                        </div>
                                        <div className="bg-white/10 rounded-xl p-3 border border-white/10 backdrop-blur-sm flex flex-col justify-center transition hover:bg-white/20">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase mb-1">Clientes</span>
                                            <span className="text-xl font-black text-white">{stats.totalClientes}</span>
                                        </div>
                                        <div className="bg-white/10 rounded-xl p-3 border border-white/10 backdrop-blur-sm flex flex-col justify-center transition hover:bg-white/20">
                                            <span className="text-[10px] text-slate-400 font-bold uppercase mb-1">Cidades</span>
                                            <span className="text-xl font-black text-white">{stats.municipios}</span>
                                        </div>
                                    </div>

                                    {/* Linha Inferior: Faturamento (Largura Total) */}
                                    <div className="bg-blue-500/20 rounded-xl p-4 border border-blue-400/30 backdrop-blur-sm flex flex-col justify-center transition hover:bg-blue-500/30 w-full">
                                        <span className="text-[10px] text-blue-200 font-bold uppercase mb-1">Faturamento do Mês</span>
                                        <span className="text-2xl font-black text-blue-100 whitespace-nowrap">
                                            {Number(stats.valorMes).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </span>
                                    </div>

                                </div>
                                
                                <div className="mt-auto">
                                    <Link href={card.btnLink} className="flex items-center gap-2 text-white/90 hover:text-white py-1 text-sm font-bold transition-colors w-fit group/btn">
                                        {card.btnTexto} <ChevronRight size={16} className="group-hover/btn:translate-x-1 transition-transform" />
                                    </Link>
                                </div>
                            </div>
                        ) : (
                            // === LAYOUT DOS CARDS NORMAIS ===
                            <>
                                <div className="relative z-10">
                                    <span className="inline-block px-3 py-1 bg-white/20 backdrop-blur-md text-white text-[10px] font-black uppercase tracking-widest rounded-full mb-4">
                                        {card.badge}
                                    </span>
                                    <h3 className="mb-2 text-xl font-black leading-tight text-white drop-shadow-sm xl:mb-3 xl:text-2xl">{card.titulo}</h3>
                                    <p className="line-clamp-2 max-w-[95%] text-sm font-medium leading-relaxed text-white/90 xl:line-clamp-none xl:max-w-[90%]">
                                        {card.descricao}
                                    </p>
                                </div>

                                <div className="relative z-10 mt-auto flex items-center justify-between pt-4 xl:pt-6">
                                    <Link href={card.btnLink} className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 xl:px-5 xl:py-2.5">
                                        {card.btnTexto} <ChevronRight size={16} />
                                    </Link>
                                </div>
                            </>
                        )}
                    </div>
                );
            })}

            {/* Bolinhas Indicadoras (Navegação) */}
            <div className="absolute bottom-5 left-0 right-0 flex justify-center gap-2 z-20">
                {vitrineCards.map((_, idx) => (
                    <button 
                        key={idx} 
                        onClick={() => setCurrentIndex(idx)}
                        className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? 'w-6 bg-white' : 'w-2 bg-white/40 hover:bg-white/60'}`}
                        aria-label={`Ir para o slide ${idx + 1}`}
                    />
                ))}
            </div>
        </div>
    );
}
