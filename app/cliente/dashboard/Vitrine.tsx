'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Globe, Lightbulb, Package, TrendingUp } from 'lucide-react';

type PlatformStats = {
  totalNotas: number;
  totalClientes: number;
  municipios: number;
  valorMes: number;
};

export default function Vitrine() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [supportLink, setSupportLink] = useState('/cliente/suporte');
  const [newTicketLink, setNewTicketLink] = useState('/cliente/suporte/novo');
  const [stats, setStats] = useState<PlatformStats>({ totalNotas: 0, totalClientes: 0, municipios: 0, valorMes: 0 });

  useEffect(() => {
    const userId = localStorage.getItem('userId');
    if (userId) {
      fetch(`/api/saas/stats?t=${Date.now()}`, { cache: 'no-store', headers: { 'x-user-id': userId } })
        .then((response) => {
          if (!response.ok) throw new Error('Erro ao carregar os números da plataforma');
          return response.json();
        })
        .then((data) => data && !data.error && setStats(data))
        .catch(console.error);
    }

    const role = localStorage.getItem('userRole') || '';
    const internal = localStorage.getItem('isSupportMode') === 'true' || ['ADMIN', 'SUPORTE', 'SUPER_ADMIN'].includes(role);
    if (internal) {
      setSupportLink('/admin/suporte');
      setNewTicketLink('/admin/suporte');
    }
  }, []);

  const cards = [
    {
      id: 'network',
      badge: 'Números da plataforma',
      title: 'O Poder da Nossa Rede',
      description: 'Milhares de notas são emitidas diariamente. Confie na robustez do sistema para escalar o seu negócio de forma segura.',
      action: 'Ver nossos planos',
      href: '/configuracoes/minha-conta',
      tone: 'bg-gradient-to-br from-slate-800 to-slate-950',
      icon: Globe,
      kind: 'network',
    },
    {
      id: 'monthly-volume',
      badge: 'Movimento da plataforma',
      title: 'Faturamento emitido no mês',
      description: 'Valor total das NFS-e emitidas pelo SaaS no mês atual.',
      action: 'Conhecer a plataforma',
      href: '/configuracoes/minha-conta',
      tone: 'bg-gradient-to-br from-emerald-600 to-teal-800',
      icon: TrendingUp,
      kind: 'revenue',
    },
    {
      id: 'packages',
      badge: 'Novidade',
      title: 'Pacotes Avulsos de Notas',
      description: 'Seu volume aumentou? Adquira notas extras sem alterar sua assinatura atual.',
      action: 'Ver pacotes',
      href: '/configuracoes/minha-conta',
      tone: 'bg-gradient-to-br from-blue-600 to-indigo-700',
      icon: Package,
      kind: 'standard',
    },
    {
      id: 'international',
      badge: 'Dica',
      title: 'Fature para o Exterior',
      description: 'Emita para clientes internacionais em Dólar e Euro de forma nativa.',
      action: 'Saber mais',
      href: supportLink,
      tone: 'bg-gradient-to-br from-violet-600 to-purple-800',
      icon: Globe,
      kind: 'standard',
    },
    {
      id: 'support',
      badge: 'Suporte',
      title: 'Precisa de Ajuda?',
      description: 'Nossa equipe está pronta para ajudar na configuração e na operação fiscal.',
      action: 'Abrir atendimento',
      href: newTicketLink,
      tone: 'bg-gradient-to-br from-amber-500 to-orange-600',
      icon: Lightbulb,
      kind: 'standard',
    },
  ];

  useEffect(() => {
    if (isPaused) return;
    const timer = window.setInterval(() => setCurrentIndex((index) => (index + 1) % cards.length), 6000);
    return () => window.clearInterval(timer);
  }, [isPaused, cards.length]);

  const money = Number(stats.valorMes || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <section className="group relative h-[260px] w-full overflow-hidden rounded-2xl border border-slate-200 shadow-sm sm:h-[320px] min-[1440px]:h-[700px]" onMouseEnter={() => setIsPaused(true)} onMouseLeave={() => setIsPaused(false)}>
      {cards.map((card, index) => {
        const Icon = card.icon;
        const active = currentIndex === index;
        return (
          <article key={card.id} className={`absolute inset-0 flex h-full flex-col p-6 pb-12 text-white transition-all duration-700 ${card.tone} ${active ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-8 opacity-0'}`}>
            <Icon className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 opacity-[0.08]" />
            <div className="relative z-10">
              <span className="inline-flex rounded-full bg-white/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest backdrop-blur">{card.badge}</span>
              <h3 className="mt-4 text-2xl font-black leading-tight">{card.title}</h3>
              <p className="mt-3 line-clamp-3 text-sm font-medium leading-relaxed text-white/85">{card.description}</p>
            </div>

            {card.kind === 'network' && (
              <div className="relative z-10 mt-auto grid grid-cols-3 gap-3 py-6">
                {[['NFS-e', stats.totalNotas], ['Clientes', stats.totalClientes], ['Cidades', stats.municipios]].map(([label, value]) => (
                  <div key={String(label)} className="min-w-0 rounded-xl border border-white/10 bg-white/10 p-3 backdrop-blur-sm">
                    <span className="block truncate text-[10px] font-bold uppercase text-white/60">{label}</span>
                    <span className="mt-1 block text-xl font-black">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {card.kind === 'revenue' && (
              <div className="relative z-10 my-auto rounded-2xl border border-white/20 bg-white/15 p-5 backdrop-blur-sm">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-100">Total emitido pelo SaaS</span>
                <strong className="mt-2 block break-words text-3xl font-black tracking-tight">{money}</strong>
                <span className="mt-2 block text-xs font-semibold text-emerald-50/80">Competência do mês atual</span>
              </div>
            )}

            <Link href={card.href} className={`relative z-10 inline-flex w-fit items-center gap-2 text-sm font-bold text-white/90 hover:text-white ${card.kind === 'standard' ? 'mt-auto' : ''}`}>
              {card.action} <ChevronRight size={16} />
            </Link>
          </article>
        );
      })}

      <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center gap-2">
        {cards.map((card, index) => (
          <button key={card.id} type="button" onClick={() => setCurrentIndex(index)} className={`h-1.5 rounded-full transition-all ${currentIndex === index ? 'w-6 bg-white' : 'w-2 bg-white/40 hover:bg-white/60'}`} aria-label={`Ir para ${card.title}`} />
        ))}
      </div>
    </section>
  );
}
