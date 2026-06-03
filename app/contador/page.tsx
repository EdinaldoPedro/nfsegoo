'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileWarning,
  Filter,
  Loader2,
  LogOut,
  Plus,
  Search,
  Send,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  Users,
  X,
} from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';

const PAGE_SIZE = 12;
const STATUS_PENDENTES = ['PENDENTE', 'PENDENTE_DONO', 'PENDENTE_CUSTODIANTE'];
const isStatusPendente = (status?: string) => STATUS_PENDENTES.includes(status || '');
const textoStatusPendente = (status?: string) => {
  if (status === 'PENDENTE_CUSTODIANTE') return 'Pendente com o contador atual.';
  return 'Aprovação pendente pelo dono.';
};

const filtrosRapidos = [
  { id: 'TODOS', label: 'Todos' },
  { id: 'PENDENCIAS', label: 'Com pendência' },
  { id: 'SEM_CERTIFICADO', label: 'Sem certificado' },
  { id: 'CERTIFICADO_VENCENDO', label: 'Próximo vencimento' },
  { id: 'SEM_EMISSAO', label: 'Sem emissão recente' },
  { id: 'CADASTRO_INCOMPLETO', label: 'Cadastro incompleto' },
];

export default function ContadorDashboard() {
  const router = useRouter();
  const { showAlert, showConfirm } = useDialog();

  const [empresas, setEmpresas] = useState<any[]>([]);
  const [solicitacoesCustodia, setSolicitacoesCustodia] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processandoSolicitacaoId, setProcessandoSolicitacaoId] = useState<string | null>(null);
  const [novoCnpj, setNovoCnpj] = useState('');
  const [processando, setProcessando] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [termoBusca, setTermoBusca] = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState('TODOS');
  const [ordenacao, setOrdenacao] = useState('RECENTES');
  const [pagina, setPagina] = useState(1);
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      localStorage.clear();
      sessionStorage.clear();
      router.push('/login');
    } catch (error) {
      console.error('Erro ao terminar sessão', error);
    }
  };

  const carregar = () => {
    const userId = localStorage.getItem('userId');
    if (!userId) return router.push('/login');

    Promise.all([
      fetch('/api/contador/vinculo?mode=contador', {
        headers: { 'x-user-id': userId },
      }).then((r) => r.json()),
      fetch('/api/contador/vinculo?mode=pendentes-custodia', {
        headers: { 'x-user-id': userId },
      }).then((r) => r.json()),
    ])
      .then(([empresasData, solicitacoesData]) => {
        if (Array.isArray(empresasData)) setEmpresas(empresasData);
        if (Array.isArray(solicitacoesData)) setSolicitacoesCustodia(solicitacoesData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    setPagina(1);
    setSelecionados([]);
  }, [termoBusca, filtroAtivo, ordenacao]);

  const formatarDocumento = (documento?: string) => {
    const digits = (documento || '').replace(/\D/g, '');
    if (digits.length !== 14) return documento || 'Documento não informado';
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  };

  const formatarData = (data?: string | null) => {
    if (!data) return 'Sem emissão';
    return new Intl.DateTimeFormat('pt-BR').format(new Date(data));
  };

  const diasAte = (data?: string | null) => {
    if (!data) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const alvo = new Date(data);
    alvo.setHours(0, 0, 0, 0);
    return Math.ceil((alvo.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  };

  const temPendencia = (item: any) => {
    const empresa = item.empresa || {};
    return item.status !== 'APROVADO' || !empresa.temCertificado || !empresa.cadastroCompleto || !empresa.codigoIbge;
  };

  const certificadoVencendo = (item: any) => {
    const dias = diasAte(item.empresa?.certificadoVencimento);
    return dias !== null && dias >= 0 && dias <= 30;
  };

  const semEmissaoRecente = (item: any) => {
    const ultima = item.resumo?.ultimaEmissao;
    if (!ultima) return true;
    const dias = Math.floor((Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24));
    return dias > 30;
  };

  const normalizarBusca = (valor: string) => {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  };

  const empresasFiltradas = useMemo(() => {
    const texto = normalizarBusca(termoBusca);
    const termoNumerico = termoBusca.replace(/\D/g, '');

    return empresas
      .filter((item) => {
        const empresa = item.empresa || {};
        const documento = empresa.documento || '';
        const buscaOk = !texto || [
          empresa.razaoSocial,
          empresa.nomeFantasia,
          empresa.email,
          empresa.cidade,
          empresa.uf,
        ].some((valor) => normalizarBusca(String(valor || '')).includes(texto)) || (
          termoNumerico.length > 0 && documento.replace(/\D/g, '').includes(termoNumerico)
        );

        if (!buscaOk) return false;

        if (filtroAtivo === 'PENDENCIAS') return temPendencia(item);
        if (filtroAtivo === 'SEM_CERTIFICADO') return !empresa.temCertificado;
        if (filtroAtivo === 'CERTIFICADO_VENCENDO') return certificadoVencendo(item);
        if (filtroAtivo === 'SEM_EMISSAO') return semEmissaoRecente(item);
        if (filtroAtivo === 'CADASTRO_INCOMPLETO') return !empresa.cadastroCompleto || !empresa.codigoIbge;
        return true;
      })
      .sort((a, b) => {
        if (ordenacao === 'NOME') return String(a.empresa?.razaoSocial || '').localeCompare(String(b.empresa?.razaoSocial || ''));
        if (ordenacao === 'VOLUME') return (b.resumo?.notasMes || 0) - (a.resumo?.notasMes || 0);
        if (ordenacao === 'PENDENCIAS') return Number(temPendencia(b)) - Number(temPendencia(a));
        if (ordenacao === 'CERTIFICADO') return (diasAte(a.empresa?.certificadoVencimento) ?? 9999) - (diasAte(b.empresa?.certificadoVencimento) ?? 9999);
        return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
      });
  }, [empresas, termoBusca, filtroAtivo, ordenacao]);

  const totalPaginas = Math.max(1, Math.ceil(empresasFiltradas.length / PAGE_SIZE));
  const inicioPagina = (pagina - 1) * PAGE_SIZE;
  const empresasPaginadas = empresasFiltradas.slice(inicioPagina, inicioPagina + PAGE_SIZE);

  const resumo = useMemo(() => {
    const aprovadas = empresas.filter((item) => item.status === 'APROVADO');
    return {
      total: empresas.length,
      notasMes: empresas.reduce((acc, item) => acc + (item.resumo?.notasMes || 0), 0),
      pendencias: empresas.filter(temPendencia).length,
      certificadosVencendo: empresas.filter(certificadoVencendo).length,
      aguardando: empresas.filter((item) => isStatusPendente(item.status)).length,
      clientes: aprovadas.reduce((acc, item) => acc + (item.resumo?.clientesCarteira || 0), 0),
    };
  }, [empresas]);

  const handleAdicionarCliente = async () => {
    const cnpjLimpo = novoCnpj.replace(/\D/g, '');

    if (cnpjLimpo.length !== 14) {
      return showAlert({
        type: 'warning',
        title: 'CNPJ inválido',
        description: 'O CNPJ deve conter exatamente 14 números.',
      });
    }

    setProcessando(true);
    setStatusMsg('Consultando Receita Federal...');

    const userId = localStorage.getItem('userId');

    try {
      const res = await fetch('/api/contador/vinculo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId || '',
        },
        body: JSON.stringify({ cnpj: cnpjLimpo }),
      });

      const data = await res.json();

      if (res.ok) {
        setNovoCnpj('');
        setStatusMsg('');

        await showAlert({
          type: 'success',
          title: 'Sucesso!',
          description: data.message || 'Empresa vinculada com sucesso!',
        });

        setLoading(true);
        carregar();
      } else {
        setStatusMsg('');
        showAlert({
          type: 'danger',
          title: 'Falha ao vincular',
          description: data.error || 'Ocorreu um erro ao processar sua solicitação.',
        });
      }
    } catch (e) {
      setStatusMsg('');
      showAlert({
        type: 'danger',
        title: 'Erro de conexão',
        description: 'Não foi possível conectar ao servidor. Verifique sua internet.',
      });
    } finally {
      setProcessando(false);
    }
  };

  const resolverSolicitacaoCustodia = async (vinculoId: string, acao: 'LIBERAR_ACESSO' | 'TRANSFERIR_CUSTODIA' | 'REJEITAR') => {
    const isAcesso = acao === 'LIBERAR_ACESSO';
    const isTransferencia = acao === 'TRANSFERIR_CUSTODIA';
    const confirmar = await showConfirm({
      type: isTransferencia ? 'warning' : isAcesso ? 'info' : 'danger',
      title: isTransferencia ? 'Transferir custodia?' : isAcesso ? 'Conceder acesso?' : 'Recusar solicitacao?',
      description: isTransferencia
        ? 'O novo contador virara o custodiante principal e seu vinculo aprovado sera encerrado.'
        : isAcesso
          ? 'O novo contador ganhara acesso operacional, mas voce continuara como custodiante principal.'
          : 'A solicitacao sera recusada e o contador solicitante nao tera acesso.',
      confirmText: isTransferencia ? 'Transferir' : isAcesso ? 'Dar acesso' : 'Recusar',
    });
    if (!confirmar) return;

    const userId = localStorage.getItem('userId');
    setProcessandoSolicitacaoId(vinculoId);
    try {
      const res = await fetch('/api/contador/vinculo', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId || '',
        },
        body: JSON.stringify({ vinculoId, acao }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao resolver solicitacao.');

      await showAlert({
        type: 'success',
        title: 'Solicitacao atualizada',
        description: data.message || 'Solicitacao resolvida.',
      });
      carregar();
    } catch (error: any) {
      showAlert({
        type: 'danger',
        title: 'Falha',
        description: error.message || 'Nao foi possivel resolver a solicitacao.',
      });
    } finally {
      setProcessandoSolicitacaoId(null);
    }
  };

  const acessarEmpresa = (empresaId: string, status: string) => {
    if (status !== 'APROVADO') {
      showAlert({
        type: 'info',
        title: 'Acesso restrito',
        description: 'Você só pode acessar o painel quando o vínculo for aprovado.',
      });
      return;
    }

    localStorage.setItem('empresaContextId', empresaId);
    window.dispatchEvent(new Event('storage'));
    router.push('/cliente/dashboard');
  };

  const alternarSelecionado = (id: string) => {
    setSelecionados((atual) => atual.includes(id) ? atual.filter((item) => item !== id) : [...atual, id]);
  };

  const exportarLista = () => {
    const base = selecionados.length
      ? empresasFiltradas.filter((item) => selecionados.includes(item.id))
      : empresasFiltradas;

    const linhas = [
      ['Razão Social', 'CNPJ', 'Cidade', 'UF', 'Status', 'Certificado', 'Notas no mês', 'Última emissão'],
      ...base.map((item) => [
        item.empresa?.razaoSocial || '',
        item.empresa?.documento || '',
        item.empresa?.cidade || '',
        item.empresa?.uf || '',
        item.status || '',
        item.empresa?.temCertificado ? 'Sim' : 'Não',
        String(item.resumo?.notasMes || 0),
        item.resumo?.ultimaEmissao ? formatarData(item.resumo.ultimaEmissao) : '',
      ]),
    ];

    const csv = linhas.map((linha) => linha.map((campo) => `"${String(campo).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'carteira-contador.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const statusBadge = (status: string) => {
    if (status === 'APROVADO') {
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200"><CheckCircle size={12} /> Ativo</span>;
    }
    if (isStatusPendente(status)) {
      return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700 ring-1 ring-amber-200"><Clock size={12} /> Aguardando</span>;
    }
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700 ring-1 ring-red-200"><AlertTriangle size={12} /> Recusado</span>;
  };

  return (
    <div className="saas-shell text-slate-950">
      <div className="saas-container max-w-7xl py-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Área do contador</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Painel do Contador</h1>
            <p className="mt-1 text-sm text-slate-600">Acompanhe sua carteira, pendências e empresas vinculadas.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => router.push('/')} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 shadow-sm transition hover:border-blue-200 hover:text-blue-700">
              <ArrowLeft size={17} /> Voltar ao site
            </button>
            <button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-2xl border border-red-100 bg-white px-4 py-2.5 text-sm font-bold text-red-600 shadow-sm transition hover:bg-red-50">
              <LogOut size={17} /> Sair
            </button>
          </div>
        </header>

        <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <ResumoCard icon={Building2} label="Empresas vinculadas" value={resumo.total} tone="blue" />
          <ResumoCard icon={BadgeCheck} label="Notas no mês" value={resumo.notasMes} tone="emerald" />
          <ResumoCard icon={FileWarning} label="Com pendências" value={resumo.pendencias} tone="amber" />
          <ResumoCard icon={ShieldCheck} label="Certificados vencendo" value={resumo.certificadosVencendo} tone="red" />
          <ResumoCard icon={Users} label="Clientes nas carteiras" value={resumo.clientes} tone="slate" />
        </section>

        <section className="mb-6 rounded-[28px] border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
            <div className="flex flex-1 items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Plus size={24} />
              </span>
              <div>
                <h3 className="font-black text-slate-900">Adicionar novo cliente</h3>
                <p className="text-sm text-slate-500">Informe o CNPJ para solicitar ou criar o vínculo automaticamente.</p>
              </div>
            </div>

            <div className="w-full lg:w-auto">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 font-mono text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 sm:w-72"
                  placeholder="CNPJ somente números"
                  value={novoCnpj}
                  onChange={(e) => setNovoCnpj(e.target.value.replace(/\D/g, ''))}
                  maxLength={14}
                  disabled={processando}
                />
                <button
                  onClick={handleAdicionarCliente}
                  disabled={processando || novoCnpj.length < 14}
                  className="inline-flex min-w-[150px] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {processando ? <Loader2 className="animate-spin" size={18} /> : <><Send size={17} /> Adicionar</>}
                </button>
              </div>
              {statusMsg && <p className="ml-1 mt-2 text-xs font-bold text-blue-600 animate-pulse">{statusMsg}</p>}
            </div>
          </div>
        </section>

        {solicitacoesCustodia.length > 0 && (
          <section className="mb-6 rounded-[28px] border border-amber-200 bg-amber-50 p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-amber-600 ring-1 ring-amber-200">
                  <ShieldQuestion size={23} />
                </span>
                <div>
                  <h3 className="font-black text-slate-900">Solicitacoes de transferencia</h3>
                  <p className="text-sm font-medium text-amber-800">Outros contadores solicitaram acesso a empresas sob sua custodia.</p>
                </div>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200">
                {solicitacoesCustodia.length} pendente{solicitacoesCustodia.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {solicitacoesCustodia.map((solicitacao) => {
                const empresa = solicitacao.empresa || {};
                const contador = solicitacao.contador || {};
                const processandoSolicitacao = processandoSolicitacaoId === solicitacao.id;

                return (
                  <div key={solicitacao.id} className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-mono text-[11px] font-black text-slate-400">{formatarDocumento(empresa.documento)}</p>
                        <h4 className="mt-1 font-black text-slate-900">{empresa.razaoSocial || 'Empresa sem nome'}</h4>
                        <p className="mt-1 text-sm font-medium text-slate-500">
                          Solicitante: {contador.nome || contador.email || 'contador nao identificado'}
                        </p>
                        {contador.email && <p className="text-xs font-bold text-slate-400">{contador.email}</p>}
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <button
                          disabled={processandoSolicitacao}
                          onClick={() => resolverSolicitacaoCustodia(solicitacao.id, 'REJEITAR')}
                          className="inline-flex items-center justify-center rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Recusar
                        </button>
                        <button
                          disabled={processandoSolicitacao}
                          onClick={() => resolverSolicitacaoCustodia(solicitacao.id, 'LIBERAR_ACESSO')}
                          className="inline-flex min-w-[96px] items-center justify-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {processandoSolicitacao ? <Loader2 className="animate-spin" size={14} /> : <ShieldCheck size={14} />}
                          Dar acesso
                        </button>
                        <button
                          disabled={processandoSolicitacao}
                          onClick={() => resolverSolicitacaoCustodia(solicitacao.id, 'TRANSFERIR_CUSTODIA')}
                          className="inline-flex min-w-[106px] items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {processandoSolicitacao ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle size={14} />}
                          Transferir
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="mb-5 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 lg:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  className="w-full rounded-2xl border border-slate-200 py-3 pl-11 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  placeholder="Buscar por razão social, fantasia, CNPJ, cidade ou e-mail..."
                  value={termoBusca}
                  onChange={(e) => setTermoBusca(e.target.value)}
                />
              </div>

              <label className="relative min-w-[230px]">
                <SlidersHorizontal className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <select
                  value={ordenacao}
                  onChange={(e) => setOrdenacao(e.target.value)}
                  className="w-full appearance-none rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-bold text-slate-700 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                >
                  <option value="RECENTES">Mais recentes</option>
                  <option value="NOME">Nome A-Z</option>
                  <option value="VOLUME">Maior volume de emissão</option>
                  <option value="PENDENCIAS">Pendências primeiro</option>
                  <option value="CERTIFICADO">Certificado vencendo primeiro</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={exportarLista} disabled={!empresasFiltradas.length} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                <Download size={17} /> Exportar {selecionados.length ? `(${selecionados.length})` : ''}
              </button>
              {selecionados.length > 0 && (
                <button onClick={() => setSelecionados([])} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-500 transition hover:bg-slate-50">
                  <X size={17} /> Limpar seleção
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {filtrosRapidos.map((filtro) => (
              <button
                key={filtro.id}
                onClick={() => setFiltroAtivo(filtro.id)}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-black transition ${filtroAtivo === filtro.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700'}`}
              >
                <Filter size={13} />
                {filtro.label}
              </button>
            ))}
          </div>
        </section>

        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-800">
            <Building2 size={20} /> Minhas empresas
            <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-black text-slate-600">{empresasFiltradas.length}</span>
          </h2>
          <p className="text-xs font-bold text-slate-500">Exibindo {empresasPaginadas.length} de {empresasFiltradas.length} empresas</p>
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-slate-200 bg-white p-16 text-center">
            <Loader2 className="mx-auto animate-spin text-blue-500" size={34} />
            <p className="mt-3 text-sm font-bold text-slate-500">Carregando carteira...</p>
          </div>
        ) : empresasFiltradas.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {empresasPaginadas.map((item) => {
                const empresa = item.empresa || {};
                const diasCertificado = diasAte(empresa.certificadoVencimento);
                const selecionado = selecionados.includes(item.id);

                return (
                  <article key={item.id} className={`relative flex min-h-[260px] flex-col justify-between rounded-[22px] border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${selecionado ? 'border-blue-400 ring-4 ring-blue-100' : 'border-slate-200'} ${item.status !== 'APROVADO' ? 'bg-slate-50' : ''}`}>
                    <div>
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-500">
                          <input
                            type="checkbox"
                            checked={selecionado}
                            onChange={() => alternarSelecionado(item.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          Selecionar
                        </label>
                        {statusBadge(item.status)}
                      </div>

                      <p className="mb-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-bold text-slate-500">
                        {formatarDocumento(empresa.documento)}
                      </p>
                      <h3 className="line-clamp-2 min-h-[48px] text-lg font-black leading-tight text-slate-900" title={empresa.razaoSocial}>
                        {empresa.razaoSocial || 'Empresa sem nome'}
                      </h3>
                      <p className="mt-1 text-sm font-medium text-slate-500">
                        {empresa.cidade && empresa.uf ? `${empresa.cidade}/${empresa.uf}` : 'Localização não informada'}
                      </p>

                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                        <InfoPill label="Certificado" value={empresa.temCertificado ? (diasCertificado !== null ? `${diasCertificado} dias` : 'Ativo') : 'Ausente'} danger={!empresa.temCertificado || (diasCertificado !== null && diasCertificado <= 30)} />
                        <InfoPill label="Última emissão" value={formatarData(item.resumo?.ultimaEmissao)} muted={!item.resumo?.ultimaEmissao} />
                        <InfoPill label="Notas no mês" value={item.resumo?.notasMes || 0} />
                        <InfoPill label="Clientes" value={item.resumo?.clientesCarteira || 0} />
                      </div>

                      {(!empresa.cadastroCompleto || !empresa.codigoIbge) && (
                        <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
                          Cadastro precisa de atenção{!empresa.codigoIbge ? ': IBGE ausente' : ''}
                        </div>
                      )}
                    </div>

                    {item.status === 'APROVADO' ? (
                      <button
                        onClick={() => acessarEmpresa(empresa.id, item.status)}
                        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-black text-blue-700 transition hover:bg-blue-600 hover:text-white"
                      >
                        Acessar painel <ArrowRight size={17} />
                      </button>
                    ) : (
                      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-center text-xs font-bold text-slate-500">
                        {isStatusPendente(item.status) ? textoStatusPendente(item.status) : 'Acesso negado.'}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="mt-6 flex flex-col items-center justify-between gap-3 rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm sm:flex-row">
              <p className="px-2 text-sm font-bold text-slate-500">Página {pagina} de {totalPaginas}</p>
              <div className="flex items-center gap-2">
                <button disabled={pagina === 1} onClick={() => setPagina((p) => Math.max(1, p - 1))} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                  <ChevronLeft size={17} /> Anterior
                </button>
                <button disabled={pagina === totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
                  Próxima <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-[28px] border-2 border-dashed border-slate-200 bg-white p-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-50 text-blue-600">
              <Building2 size={30} />
            </div>
            <h3 className="mt-5 text-xl font-black text-slate-900">Nenhuma empresa encontrada</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Ajuste os filtros ou adicione um CNPJ para começar a montar sua carteira contábil.
            </p>
            <button onClick={() => { setFiltroAtivo('TODOS'); setTermoBusca(''); }} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-blue-50 hover:text-blue-700">
              <X size={17} /> Limpar filtros
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResumoCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    slate: 'bg-slate-100 text-slate-700',
  };

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
        </div>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tones[tone] || tones.slate}`}>
          <Icon size={23} />
        </span>
      </div>
    </div>
  );
}

function InfoPill({ label, value, danger, muted }: { label: string; value: string | number; danger?: boolean; muted?: boolean }) {
  return (
    <div className={`rounded-2xl px-3 py-2 ring-1 ${danger ? 'bg-red-50 text-red-700 ring-red-100' : muted ? 'bg-slate-50 text-slate-400 ring-slate-100' : 'bg-slate-50 text-slate-700 ring-slate-100'}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.1em] opacity-70">{label}</p>
      <p className="mt-1 truncate text-sm font-black">{value}</p>
    </div>
  );
}
