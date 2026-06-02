'use client';

import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Briefcase,
  Building2,
  CreditCard,
  LifeBuoy,
  List,
  Map,
  MapPin,
  Settings,
  Shield,
  Ticket,
  Users,
  Wrench,
} from 'lucide-react';

const bancadas = [
  {
    title: 'Bancada Operacional',
    description: 'Rotina diária de emissão, suporte, empresas e vínculos operacionais.',
    tone: 'blue',
    href: '/admin/emissoes',
    items: [
      { icon: Activity, label: 'Central de Emissões', href: '/admin/emissoes', hint: 'Falhas, emissores e acompanhamento fiscal.' },
      { icon: Building2, label: 'Base de Empresas', href: '/admin/empresas', hint: 'Cadastro, IBGE, carteiras e prestadores.' },
      { icon: LifeBuoy, label: 'Helpdesk / Suporte', href: '/admin/suporte', hint: 'Tickets e atendimento interno.' },
      { icon: Shield, label: 'Bancada de Vínculos', href: '/admin/vinculos-custodia', hint: 'Vínculos e custódia de carteiras.' },
    ],
  },
  {
    title: 'Bancada Técnica',
    description: 'Diagnóstico, manutenção fiscal, logs, cobertura, CNAEs e regras tributárias.',
    tone: 'purple',
    href: '/admin/logs',
    items: [
      { icon: Wrench, label: 'Logs do Sistema', href: '/admin/logs', hint: 'Eventos técnicos e investigação.' },
      { icon: List, label: 'Tabela CNAEs', href: '/admin/cnaes', hint: 'Códigos, NBS e retenções.' },
      { icon: MapPin, label: 'Tributação Municipal', href: '/admin/tributacao-municipal', hint: 'Regras por município e CNAE.' },
      { icon: Map, label: 'Mapa de Cobertura', href: '/admin/cobertura', hint: 'Municípios atendidos e pendências.' },
      { icon: Settings, label: 'Configurações', href: '/admin/configuracoes', hint: 'Parâmetros internos do sistema.' },
    ],
  },
  {
    title: 'Gestão do SaaS',
    description: 'Administração comercial, usuários, time interno, planos, CRM e cupons.',
    tone: 'slate',
    href: '/admin/dashboard',
    items: [
      { icon: Briefcase, label: 'CRM / Clientes', href: '/admin/crm', hint: 'Pipeline, clientes e relacionamento.' },
      { icon: CreditCard, label: 'Planos e Pacotes', href: '/admin/planos', hint: 'Planos, limites e ofertas.' },
      { icon: Ticket, label: 'Cupons & Parceiros', href: '/admin/cupons', hint: 'Campanhas e parcerias.' },
      { icon: Users, label: 'Configurar Contas', href: '/admin/usuarios', hint: 'Usuários e permissões.' },
      { icon: Shield, label: 'Colaboradores', href: '/admin/colaboradores', hint: 'Equipe interna e parceiros.' },
    ],
  },
];

const toneClasses: Record<string, any> = {
  blue: {
    shell: 'from-blue-600 to-cyan-600',
    badge: 'bg-blue-50 text-blue-700 border-blue-100',
    icon: 'bg-blue-50 text-blue-700',
    button: 'text-blue-700',
  },
  purple: {
    shell: 'from-purple-600 to-orange-500',
    badge: 'bg-purple-50 text-purple-700 border-purple-100',
    icon: 'bg-purple-50 text-purple-700',
    button: 'text-purple-700',
  },
  slate: {
    shell: 'from-slate-900 to-slate-700',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: 'bg-slate-100 text-slate-700',
    button: 'text-slate-800',
  },
};

export default function BancadasAdminPage() {
  return (
    <div className="space-y-8">
      <section className="rounded-3xl bg-slate-950 text-white overflow-hidden shadow-sm">
        <div className="relative p-8 lg:p-10">
          <div className="absolute right-8 top-6 h-40 w-40 rounded-full border border-white/10" />
          <div className="relative max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-200">Central interna</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight">Bancadas do Admin</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              As páginas atuais continuam nos mesmos endereços. Esta tela só organiza o trabalho interno por contexto:
              operação, diagnóstico técnico e gestão do SaaS.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {bancadas.map((bancada) => {
          const tone = toneClasses[bancada.tone];
          return (
            <section key={bancada.title} className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className={`bg-gradient-to-br ${tone.shell} p-6 text-white`}>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70">Bancada</p>
                <h2 className="mt-2 text-xl font-black">{bancada.title}</h2>
                <p className="mt-2 min-h-[48px] text-sm leading-relaxed text-white/80">{bancada.description}</p>
                <Link href={bancada.href} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-900 shadow-sm hover:bg-slate-50">
                  Abrir principal <ArrowRight size={16} />
                </Link>
              </div>

              <div className="p-4 space-y-3">
                {bancada.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 hover:border-blue-200 hover:bg-white hover:shadow-sm transition"
                    >
                      <div className={`shrink-0 rounded-xl p-2.5 ${tone.icon}`}>
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-black text-slate-900">{item.label}</p>
                          <ArrowRight size={15} className={`${tone.button} opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition`} />
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">{item.hint}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
