'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, CheckCircle2, Clock, FileText, Lock, MapPin, Server, Settings, ShieldCheck } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import Sidebar from '@/components/Sidebar';
import ListaVendas from '@/components/ListaVendas';
import Vitrine from './Vitrine';

export default function ClienteDashboard() {
  const [nomeUsuario, setNomeUsuario] = useState('');
  const [planoDetalhes, setPlanoDetalhes] = useState<any>(null);
  const [perfilEmpresa, setPerfilEmpresa] = useState<any>(null);
  const [perfilCarregado, setPerfilCarregado] = useState(false);

  useEffect(() => {
    const userId = localStorage.getItem('userId');
    const contextId = localStorage.getItem('empresaContextId');

    // Agora só verificamos o userId! O token vai sozinho no cookie.
    if(userId) {
        fetch('/api/perfil', { 
            headers: {
                'x-user-id': userId,
                'x-empresa-id': contextId || ''
                // Cabeçalho Authorization removido com sucesso!
            }
        })
        .then(res => {
            if (res.status === 401) {
                window.location.href = '/login';
                return null;
            }
            return res.json();
        })
        .then(data => {
            if(data) {
                setNomeUsuario(data.nome);
                setPlanoDetalhes(data.planoDetalhado);
                setPerfilEmpresa(data);
            }
        })
        .catch(console.error)
        .finally(() => setPerfilCarregado(true));
    }
  }, []);
  
  const diasRestantes = planoDetalhes?.dataFim 
    ? Math.ceil((new Date(planoDetalhes.dataFim).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const isAdminPlan = planoDetalhes?.slug === 'ADMIN_ACCESS';
  
  // === LÓGICA DE TRAVAMENTO ===
  const isBloqueado = planoDetalhes?.status === 'EXPIRADO' || planoDetalhes?.status === 'INATIVO' || (diasRestantes !== null && diasRestantes < 0);
  
  const tituloAlerta = planoDetalhes?.status === 'INATIVO' ? 'Nenhum Plano Ativo' : 'Plano Expirado';
  const descAlerta = planoDetalhes?.status === 'INATIVO' 
    ? 'Para começar a emitir notas, você precisa escolher um plano.' 
    : 'Suas funcionalidades estão bloqueadas. Renove para continuar.';

  const diasCertificado = perfilEmpresa?.vencimentoCertificado
    ? Math.ceil((new Date(perfilEmpresa.vencimentoCertificado).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const certificadoVencendo = diasCertificado !== null && diasCertificado >= 0 && diasCertificado <= 30;
  const certificadoVencido = diasCertificado !== null && diasCertificado < 0;
  const ambienteLabel = perfilEmpresa?.ambiente === 'HOMOLOGACAO' ? 'Homologação' : 'Produção';

  const checklistFiscal = [
    {
      label: 'Cadastro da empresa',
      description: perfilEmpresa?.cadastroCompleto ? 'Dados obrigatórios preenchidos' : 'Complete os dados fiscais',
      ok: !!perfilEmpresa?.cadastroCompleto,
      href: '/configuracoes',
      icon: Settings,
    },
    {
      label: 'Certificado A1',
      description: perfilEmpresa?.temCertificado
        ? certificadoVencido
          ? 'Certificado vencido'
          : certificadoVencendo
            ? `Vence em ${diasCertificado} dias`
            : 'Certificado configurado'
        : 'Envie seu certificado digital',
      ok: !!perfilEmpresa?.temCertificado && !certificadoVencido,
      warning: certificadoVencendo,
      href: '/configuracoes',
      icon: ShieldCheck,
    },
    {
      label: 'Código IBGE',
      description: perfilEmpresa?.codigoIbge ? perfilEmpresa.codigoIbge : 'Obrigatório para emitir NFS-e',
      ok: !!perfilEmpresa?.codigoIbge,
      href: '/configuracoes',
      icon: MapPin,
    },
    {
      label: 'Ambiente',
      description: ambienteLabel,
      ok: perfilEmpresa?.ambiente === 'PRODUCAO',
      warning: perfilEmpresa?.ambiente === 'HOMOLOGACAO',
      href: '/configuracoes',
      icon: Server,
    },
  ];

  const proximaAcao = (() => {
    if (isBloqueado) {
      return {
        title: tituloAlerta,
        description: descAlerta,
        href: '/configuracoes/minha-conta',
        action: planoDetalhes?.status === 'INATIVO' ? 'Ver planos' : 'Renovar agora',
        tone: 'red',
        icon: Lock,
      };
    }
    if (!perfilEmpresa?.cadastroCompleto) {
      return {
        title: 'Complete o cadastro da empresa',
        description: 'Preencha os dados fiscais obrigatórios antes de emitir notas.',
        href: '/configuracoes',
        action: 'Completar cadastro',
        tone: 'amber',
        icon: Settings,
      };
    }
    if (!perfilEmpresa?.codigoIbge) {
      return {
        title: 'Código IBGE pendente',
        description: 'Sem o código IBGE, a NFS-e não consegue ser emitida corretamente.',
        href: '/configuracoes',
        action: 'Corrigir endereço',
        tone: 'amber',
        icon: MapPin,
      };
    }
    if (!perfilEmpresa?.temCertificado || certificadoVencido) {
      return {
        title: certificadoVencido ? 'Certificado vencido' : 'Configure o certificado A1',
        description: 'O certificado digital é necessário para assinar e emitir a nota.',
        href: '/configuracoes',
        action: 'Configurar certificado',
        tone: 'amber',
        icon: ShieldCheck,
      };
    }
    if (certificadoVencendo) {
      return {
        title: 'Certificado perto do vencimento',
        description: `Seu certificado vence em ${diasCertificado} dias. Antecipe a renovação para evitar bloqueios.`,
        href: '/configuracoes',
        action: 'Ver certificado',
        tone: 'amber',
        icon: CalendarDays,
      };
    }
    return {
      title: 'Você já pode emitir',
      description: 'Cadastro, IBGE e certificado estão prontos para a emissão de NFS-e.',
      href: '/emitir',
      action: 'Emitir nova nota',
      tone: 'blue',
      icon: FileText,
    };
  })();

  const exibirSaudeFiscal = perfilCarregado && (
    isBloqueado ||
    checklistFiscal.some((item) => !item.ok || item.warning)
  );

  return (
    <div className="saas-shell">
      
      <div className="hidden">
      <header className="flex justify-between items-center p-6 border-b bg-white sticky top-0 z-30 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
                <img src="/icons/G.png" alt="NFSeGoo" className="w-8 h-8 object-contain" />
                <div>
                    <h1 className="text-xl font-bold bg-gradient-to-r from-blue-700 to-emerald-400 bg-clip-text text-transparent leading-none tracking-tight">
                        NFSe<span className="font-light">Goo</span>
                    </h1>
                    <p className="text-xs text-gray-500 mt-1">Ambiente Beta</p>
                </div>
            </div>
        </div>
        <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 hidden md:block">Olá, {nomeUsuario}</span>
            <Sidebar /> 
        </div>
      </header>
      </div>
      <AppHeader title="NFSe Goo" subtitle={nomeUsuario ? `Olá, ${nomeUsuario}` : 'Ambiente Beta'} eyebrow="Dashboard" />

      <div className="saas-container flex flex-col xl:flex-row gap-8">
        
        {/* === VITRINE (MARGEM ESQUERDA) === */}
        <div className="w-full xl:w-[320px] shrink-0">
            <div className="xl:sticky xl:top-32 h-[450px]">
                <Vitrine />
            </div>
        </div>

        {/* === CONTEÚDO PRINCIPAL === */}
        <div className="flex-1 space-y-8 min-w-0">
            
            {/* === ALERTAS DO SISTEMA (Topo) === */}
            {isBloqueado && (
                <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-r-xl shadow-sm flex flex-col md:flex-row justify-between items-center gap-4 animate-in slide-in-from-top">
                    <div className="flex items-center gap-4">
                        <div className="bg-red-100 p-3 rounded-full text-red-600">
                            <Lock size={32}/>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-red-700">{tituloAlerta}</h2>
                            <p className="text-red-600 text-sm mt-1">{descAlerta}</p>
                        </div>
                    </div>
                    <Link href="/configuracoes/minha-conta" className="bg-red-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-red-700 transition shadow-lg shadow-red-200">
                        {planoDetalhes?.status === 'INATIVO' ? 'Ver Planos' : 'Renovar Agora'}
                    </Link>
                </div>
            )}

            {!isAdminPlan && !isBloqueado && planoDetalhes?.slug === 'TRIAL' && diasRestantes !== null && diasRestantes >= 0 && (
                <div className="tour-emitir-card bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 rounded-2xl shadow-lg flex flex-col md:flex-row justify-between items-center gap-4 animate-in slide-in-from-top duration-500">
                    <div className="flex items-center gap-4">
                        <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm">
                            <Clock size={32} className="text-white"/>
                        </div>
                        <div>
                            <h2 className="font-bold text-xl">Período de Teste Grátis</h2>
                            <p className="text-indigo-100 text-sm mt-1">
                                Aproveite! Faltam <strong>{diasRestantes} dias</strong> para encerrar seu acesso.
                            </p>
                        </div>
                    </div>
                    <Link href="/configuracoes/minha-conta" className="bg-white text-indigo-700 px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-50 transition shadow-md w-full md:w-auto text-center">
                        Assinar Agora 🚀
                    </Link>
                </div>
            )}
            
            {/* Orientacao fiscal e chamada principal */}
            {perfilCarregado && (
                <div className={`grid grid-cols-1 gap-6 ${exibirSaudeFiscal ? '2xl:grid-cols-[minmax(320px,0.9fr)_minmax(520px,1.1fr)]' : 'lg:grid-cols-2'}`}>
                    <ProximaAcaoCard data={proximaAcao} bloqueado={isBloqueado} />

                    {exibirSaudeFiscal && (
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
                            <div>
                                <h2 className="text-xl font-black text-slate-800">Saúde fiscal da empresa</h2>
                                <p className="text-sm text-slate-500 mt-1">Checklist dos pontos críticos para emissão.</p>
                            </div>
                            <span className="text-xs font-black text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
                                {checklistFiscal.filter((item) => item.ok).length}/{checklistFiscal.length} prontos
                            </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {checklistFiscal.map((item) => (
                                <SaudeFiscalItem key={item.label} item={item} />
                            ))}
                        </div>
                    </div>
                    )}

                    {!exibirSaudeFiscal && <MinhasNotasCard variant="hero" />}
                </div>
            )}

            {exibirSaudeFiscal && <MinhasNotasCard variant="wide" />}

            {/* Área de Atividade Recente */}
            <div className="bg-white p-6 md:p-8 border border-slate-200 rounded-2xl shadow-sm">
                <div className="flex justify-between items-end mb-6 border-b border-slate-100 pb-4">
                    <h3 className="font-black text-xl text-slate-800">Atividade Recente</h3>
                    <Link href="/cliente/notas" className="text-sm font-bold text-blue-600 hover:text-blue-800 transition">Ver tudo</Link>
                </div>
                <ListaVendas compact={true} />
            </div>

        </div>
      </div>
    </div>
  );
}

function ProximaAcaoCard({ data, bloqueado }: { data: any; bloqueado: boolean }) {
  const Icon = data.icon;
  const tones: Record<string, string> = {
    blue: 'bg-blue-600 text-white border-blue-600 shadow-blue-200',
    amber: 'bg-amber-50 text-amber-900 border-amber-200 shadow-amber-100',
    red: 'bg-red-50 text-red-900 border-red-200 shadow-red-100',
  };
  const buttonTones: Record<string, string> = {
    blue: 'bg-white text-blue-700 hover:bg-blue-50',
    amber: 'bg-amber-600 text-white hover:bg-amber-700',
    red: 'bg-red-600 text-white hover:bg-red-700',
  };

  return (
    <div className={`border rounded-2xl shadow-sm p-6 flex flex-col justify-between min-h-[230px] ${tones[data.tone] || tones.blue}`}>
      <div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] opacity-70">Próxima ação</p>
            <h2 className="text-2xl font-black mt-3 leading-tight">{data.title}</h2>
          </div>
          <div className="p-3 rounded-2xl bg-white/25 shrink-0">
            <Icon size={28} />
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 opacity-80">{data.description}</p>
      </div>

      <Link
        href={data.href}
        onClick={(e) => {
          if (bloqueado && data.href === '/emitir') {
            e.preventDefault();
            window.location.href = '/configuracoes/minha-conta';
          }
        }}
        className={`mt-6 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-black transition w-full sm:w-fit ${buttonTones[data.tone] || buttonTones.blue}`}
      >
        {data.action}
        <ArrowRight size={17} />
      </Link>
    </div>
  );
}

function MinhasNotasCard({ variant = 'wide' }: { variant?: 'hero' | 'wide' }) {
  const sizing = variant === 'hero' ? 'min-h-[230px]' : 'min-h-[150px]';

  return (
    <Link href="/cliente/notas" className="block">
      <div className={`tour-minhas-notas group p-8 border border-slate-200 rounded-2xl bg-white hover:border-blue-300 hover:shadow-md cursor-pointer transition flex flex-col justify-between ${sizing}`}>
        <div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Minhas Notas</h2>
          <p className="text-slate-500 text-sm">Consulte histórico completo. (Visualização liberada)</p>
        </div>
        <div className="mt-6 text-blue-600 font-bold group-hover:underline">
          Ver todas as notas ➜
        </div>
      </div>
    </Link>
  );
}

function SaudeFiscalItem({ item }: { item: any }) {
  const Icon = item.icon;
  const statusClass = item.ok
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : item.warning
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-700 border-red-200';

  return (
    <Link href={item.href} className={`border rounded-2xl p-4 transition hover:shadow-sm ${statusClass}`}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-white/70 shrink-0">
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-black text-sm truncate">{item.label}</p>
            {item.ok && <CheckCircle2 size={15} className="shrink-0" />}
          </div>
          <p className="text-xs mt-1 opacity-80 truncate">{item.description}</p>
        </div>
      </div>
    </Link>
  );
}
