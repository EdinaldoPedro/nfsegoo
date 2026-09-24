'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Building2, Save, ArrowLeft, Search, MapPin, Briefcase, 
  Lock, CheckCircle, Trash2, Info, Upload, FileKey, Settings, Loader2, AlertCircle
  , RefreshCw, ShieldCheck
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { useDialog } from '@/app/contexts/DialogContext';
import { normalizarRegimeTributario } from '@/app/utils/regime-tributario';
import { companyProfileFormFields } from '@/app/utils/company-profile-form';
import { MAX_STORED_DPS_NUMBER, nextDpsCandidate, normalizeDpsEnvironment, normalizeDpsNumber, normalizeDpsSeries } from '@/app/utils/dps-identity';
import { formatCnpjInput, normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';

export default function ConfiguracoesEmpresa() {
  const router = useRouter();
  const dialog = useDialog();
  const [loading, setLoading] = useState(false);
  const [carregandoPerfil, setCarregandoPerfil] = useState(true);
  const [erroCarregamento, setErroCarregamento] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [msg, setMsg] = useState<{texto: string, tipo: 'sucesso' | 'erro'} | null>(null);
  
  const [isLocked, setIsLocked] = useState(false);
  const [isContador, setIsContador] = useState(false);
  
  const [atividades, setAtividades] = useState<any[]>([]); 

  const [certFile, setCertFile] = useState<string | null>(null);
  const [certSenha, setCertSenha] = useState('');
  const [savedEnvironment, setSavedEnvironment] = useState('HOMOLOGACAO');
  const [companyContext, setCompanyContext] = useState<{ id: string | null; updatedAt: string | null }>({ id: null, updatedAt: null });
  const [validandoCertificado, setValidandoCertificado] = useState(false);
  const [certificadoCheck, setCertificadoCheck] = useState<{
    status: 'idle' | 'ok' | 'erro';
    mensagem: string;
    vencimento?: string | null;
  }>({ status: 'idle', mensagem: '' });
  const [dadosCertificado, setDadosCertificado] = useState<{ativo: boolean, vencimento: string | null}>({ ativo: false, vencimento: null });
  const [modoEdicaoCertificado, setModoEdicaoCertificado] = useState(false);
  const [sincronizandoDps, setSincronizandoDps] = useState(false);
  const [carregandoDps, setCarregandoDps] = useState(false);
  const [ultimoReservadoDps, setUltimoReservadoDps] = useState(0);
  const dpsRequestVersion = useRef(0);
  const [dpsStatus, setDpsStatus] = useState<{
    tipo: 'idle' | 'sucesso' | 'parcial' | 'erro';
    mensagem: string;
    sincronizadoEm?: string | null;
  }>({ tipo: 'idle', mensagem: '' });

  const [empresa, setEmpresa] = useState({
    documento: '',
    razaoSocial: '',
    nomeFantasia: '',
    cnaePrincipal: '',
    inscricaoMunicipal: '',
    regimeTributario: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    codigoIbge: '',
    email: '',
    ambiente: 'HOMOLOGACAO',
    serieDPS: '900',
    ultimoDPS: 0 as number | string
  });

  const showMessage = (texto: string, tipo: 'sucesso' | 'erro') => {
      setMsg({ texto, tipo });
      if (tipo === 'sucesso') setTimeout(() => setMsg(current => current?.texto === texto ? null : current), 5000);
  };

  const manterIbgeSeConsultaVierVazia = (codigoNovo: string | null | undefined, codigoAtual: string | null | undefined) => {
      const novoLimpo = String(codigoNovo || '').replace(/\D/g, '');
      return novoLimpo.length >= 7 ? novoLimpo : (codigoAtual || '');
  };

  useEffect(() => {
    const userId = localStorage.getItem('userId');

    if (!userId) { router.push('/login'); return; }

    async function carregarDados() {
      setCarregandoPerfil(true);
      setErroCarregamento('');
      try {
        const contextId = localStorage.getItem('empresaContextId');
        const res = await fetch(`/api/perfil?t=${Date.now()}`, {
            cache: 'no-store',
            headers: { 
                'x-user-id': userId || '',
                'x-empresa-id': contextId || ''
            } 
        });

        if (res.ok) {
          const dados = await res.json();
          setIsContador(dados.role === 'CONTADOR');
          setCompanyContext({ id: dados.empresaContextoId, updatedAt: dados.empresaAtualizadaEm });
          const ambienteCarregado = dados.ambiente || 'HOMOLOGACAO';
          setSavedEnvironment(ambienteCarregado);
          const serieOriginal = dados.serieDPS || '900';
          const serieCarregada = /^[0-9]{1,5}$/.test(serieOriginal) ? normalizeDpsSeries(serieOriginal) : serieOriginal;
          const sequenciaAtual = (dados.sequenciasDps || []).find((item: any) => item.ambiente === ambienteCarregado && item.serie === serieCarregada);
          setUltimoReservadoDps(sequenciaAtual?.ultimoReservado ?? 0);
          setEmpresa(prev => ({ 
              ...prev, 
              ...dados,
              ...companyProfileFormFields(dados),
              regimeTributario: normalizarRegimeTributario(dados.regimeTributario) || '',
              // Garante que o IBGE vindo do banco seja lido corretamente
              codigoIbge: dados.codigoIbge || '',
              serieDPS: serieCarregada,
              ultimoDPS: sequenciaAtual?.ultimoConfirmado ?? (ambienteCarregado === 'PRODUCAO' ? dados.ultimoDPS || 0 : 0),
              ambiente: ambienteCarregado
          }));
          if (sequenciaAtual?.sincronizadoEm) {
              setDpsStatus({ tipo: sequenciaAtual.statusSincronizacao === 'PARCIAL' ? 'parcial' : 'sucesso', mensagem: `Última sincronização: ${new Date(sequenciaAtual.sincronizadoEm).toLocaleString('pt-BR')}.`, sincronizadoEm: sequenciaAtual.sincronizadoEm });
          }
          
          if (dados.atividades) setAtividades(dados.atividades);
          
          setDadosCertificado({
              ativo: dados.temCertificado,
              vencimento: dados.vencimentoCertificado
          });

          if (!dados.temCertificado) setModoEdicaoCertificado(true);
          if (dados.empresaContextoId) setIsLocked(true);
        } else if (res.status === 401) {
            router.push('/login');
        } else {
            const resposta = await res.json().catch(() => ({}));
            setErroCarregamento(resposta.error || 'Não foi possível carregar os dados desta empresa.');
        }
      } catch (error) {
        console.error("Erro ao carregar perfil");
        setErroCarregamento('Falha de conexão ao carregar os dados da empresa.');
      } finally {
        setCarregandoPerfil(false);
      }
    }
    carregarDados();
  }, [router]);

  const consultarCNPJ = async (forcarAtualizacao = false) => {
    const docLimpo = normalizeCnpj(empresa.documento);
    
    if (isLocked && !forcarAtualizacao) return; 
    if (!docLimpo || !validarCNPJ(docLimpo)) {
      await dialog.showAlert({ type: 'warning', title: 'Revise o CNPJ', description: 'Informe um CNPJ válido para continuar.' });
      return;
    }
    if (/[A-Z]/.test(docLimpo)) {
      await dialog.showAlert({ type: 'info', title: 'Preenchimento manual', description: 'As consultas públicas ainda não atendem CNPJ alfanumérico. Preencha os dados cadastrais manualmente.' });
      return;
    }

    setBuscando(true);
    try {
      const res = await fetch('/api/external/cnpj', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ cnpj: docLimpo })
      });
      const dados = await res.json();

      if (res.ok) {
        setEmpresa(prev => ({
          ...prev,
          razaoSocial: dados.razaoSocial,
          nomeFantasia: dados.nomeFantasia,
          cnaePrincipal: dados.cnaePrincipal,
          cep: dados.cep,
          logradouro: dados.logradouro,
          numero: dados.numero,
          complemento: dados.complemento,
          bairro: dados.bairro,
          cidade: dados.cidade,
          uf: dados.uf,
          codigoIbge: manterIbgeSeConsultaVierVazia(dados.codigoIbge, prev.codigoIbge),
          email: dados.email || prev.email 
        }));
        setAtividades(dados.cnaes || []);
        showMessage('✅ Dados atualizados com base na Receita Federal!', 'sucesso');
      } else { showMessage('❌ ' + (dados.error || 'Erro ao buscar dados.'), 'erro'); }
    } catch (error) { showMessage('❌ Erro de conexão.', 'erro'); } 
    finally { setBuscando(false); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          if (file.size > 1024 * 1024 || !/\.(pfx|p12)$/i.test(file.name)) {
              setCertFile(null); e.target.value = '';
              setCertificadoCheck({ status: 'erro', mensagem: 'Selecione um arquivo .pfx ou .p12 de até 1 MiB.' });
              return;
          }
          setCertificadoCheck({ status: 'idle', mensagem: '' });
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64String = (reader.result as string).split(',')[1];
              setCertFile(base64String);
          };
          reader.readAsDataURL(file);
      }
  };

  const validarCertificadoAntesDeSalvar = async () => {
      if (!certFile || !certSenha) return;

      const cnpjLimpo = normalizeCnpj(empresa.documento);
      if (!cnpjLimpo || !validarCNPJ(cnpjLimpo)) {
          setCertificadoCheck({ status: 'erro', mensagem: 'Informe o CNPJ da empresa antes de validar o certificado.' });
          return;
      }

      setValidandoCertificado(true);
      setCertificadoCheck({ status: 'idle', mensagem: 'Validando certificado...' });

      const userId = localStorage.getItem('userId');
      const contextId = localStorage.getItem('empresaContextId');

      try {
          const res = await fetch('/api/perfil/validar-certificado', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'x-user-id': userId || '',
                  'x-empresa-id': contextId || ''
              },
              body: JSON.stringify({
                  documento: empresa.documento,
                  ambiente: empresa.ambiente,
                  certificadoArquivo: certFile,
                  certificadoSenha: certSenha
              })
          });

          const resposta = await res.json();
          if (!res.ok) {
              setCertificadoCheck({ status: 'erro', mensagem: resposta.error || 'Nao foi possivel validar o certificado.' });
              showMessage(`Erro no certificado: ${resposta.error || 'verifique o arquivo e a senha.'}`, 'erro');
              return;
          }

          setCertificadoCheck({
              status: 'ok',
              mensagem: 'Senha, validade e CNPJ conferidos com sucesso.',
              vencimento: resposta.vencimento || null
          });
      } catch {
          setCertificadoCheck({ status: 'erro', mensagem: 'Erro de conexao ao validar o certificado.' });
          showMessage('Erro de conexao ao validar o certificado.', 'erro');
      } finally {
          setValidandoCertificado(false);
      }
  };

  const handleDeletarCertificado = async () => {
      const password = await dialog.showPrompt({
        title: 'Remover certificado digital?',
        description: 'Digite a senha da sua conta para confirmar. Sem o A1, novas notas não poderão ser emitidas até cadastrar outro certificado.',
        inputType: 'password', placeholder: 'Senha de acesso à conta',
        confirmText: 'Remover certificado',
        cancelText: 'Manter certificado',
      });
      if (password === null) return;
      if (!password) { showMessage('Informe a senha de acesso à conta para remover o certificado.', 'erro'); return; }
      await handleSalvar(null, { deletarCertificado: true, accountPassword: password });
  };

  const carregarSequenciaDps = async (ambiente: string, serie: string) => {
      const version = ++dpsRequestVersion.current;
      const userId = localStorage.getItem('userId');
      const contextId = localStorage.getItem('empresaContextId');
      try {
          const serieNormalizada = normalizeDpsSeries(serie);
          normalizeDpsEnvironment(ambiente);
          setCarregandoDps(true);
          setEmpresa((atual) => ({ ...atual, ambiente, serieDPS: serieNormalizada, ultimoDPS: '' }));
          setUltimoReservadoDps(0);
          if (!companyContext.id) {
              setEmpresa(atual => ({ ...atual, ultimoDPS: 0 }));
              setDpsStatus({ tipo: 'idle', mensagem: 'Salve a nova empresa antes de consultar sua sequência.' });
              return;
          }
          const res = await fetch(`/api/dps/sincronizar?ambiente=${encodeURIComponent(ambiente)}&serie=${encodeURIComponent(serieNormalizada)}`, {
              cache: 'no-store',
              headers: { 'x-user-id': userId || '', 'x-empresa-id': contextId || '' },
          });
          const data = await res.json();
          if (version !== dpsRequestVersion.current) return;
          if (!res.ok) throw new Error(data.error || 'Não foi possível carregar a sequência.');
          setEmpresa((atual) => ({ ...atual, ambiente, serieDPS: serieNormalizada, ultimoDPS: data.ultimoConfirmado || 0 }));
          setUltimoReservadoDps(data.ultimoReservado ?? 0);
          setDpsStatus(data.sincronizadoEm
              ? { tipo: data.statusSincronizacao === 'PARCIAL' ? 'parcial' : 'sucesso', mensagem: `Última sincronização: ${new Date(data.sincronizadoEm).toLocaleString('pt-BR')}.`, sincronizadoEm: data.sincronizadoEm }
              : { tipo: 'idle', mensagem: 'Esta combinação de ambiente e série ainda não foi sincronizada.' });
      } catch (error: any) {
          if (version === dpsRequestVersion.current) setDpsStatus({ tipo: 'erro', mensagem: error.message });
      } finally {
          if (version === dpsRequestVersion.current) setCarregandoDps(false);
      }
  };

  const sincronizarNumeracaoDps = async () => {
      if (sincronizandoDps || carregandoDps) return false;
      try {
          normalizeDpsEnvironment(empresa.ambiente); normalizeDpsSeries(empresa.serieDPS); normalizeDpsNumber(empresa.ultimoDPS, true);
      } catch (error) { showMessage((error as Error).message, 'erro'); return false; }
      if (!dadosCertificado.ativo && !certFile) {
          showMessage('Cadastre e salve o certificado A1 antes de sincronizar.', 'erro');
          return false;
      }
      const confirmado = await dialog.showConfirm({
        type: 'info',
        title: 'Sincronizar numeração da DPS?',
        description: `Vamos consultar números consecutivos da série ${empresa.serieDPS}, no ambiente de ${empresa.ambiente === 'PRODUCAO' ? 'produção' : 'homologação'}. Lacunas posteriores não são detectadas. A consulta não emite nota fiscal nem reserva o próximo número.`,
        confirmText: 'Sincronizar agora',
        cancelText: 'Agora não',
      });
      if (!confirmado) return false;

      setSincronizandoDps(true);
      setDpsStatus({ tipo: 'idle', mensagem: 'Consultando a numeração no Portal Nacional sem emitir nota...' });
      const userId = localStorage.getItem('userId');
      const contextId = localStorage.getItem('empresaContextId');
      try {
          const res = await fetch('/api/dps/sincronizar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-user-id': userId || '', 'x-empresa-id': contextId || '' },
              body: JSON.stringify({ ambiente: empresa.ambiente, serie: empresa.serieDPS, ultimoConhecido: empresa.ultimoDPS }),
          });
          const data = await res.json();
          if (!res.ok && res.status !== 206) throw new Error(data.error || 'Não foi possível sincronizar a DPS.');
          setEmpresa((atual) => ({ ...atual, ultimoDPS: data.ultimoConfirmado }));
          setUltimoReservadoDps(data.ultimoReservado ?? 0);
          setDpsStatus({ tipo: data.completo ? 'sucesso' : 'parcial', mensagem: data.message, sincronizadoEm: data.sincronizadoEm || new Date().toISOString() });
          showMessage(data.completo ? 'Numeração DPS sincronizada com sucesso.' : 'Sincronização parcial. Você pode continuar pelo mesmo botão.', 'sucesso');
          return true;
      } catch (error: any) {
          setDpsStatus({ tipo: 'erro', mensagem: error.message });
          showMessage(error.message, 'erro');
          return false;
      } finally {
          setSincronizandoDps(false);
      }
  };

  const handleSalvar = async (e: React.FormEvent | null, extraData: { deletarCertificado?: boolean; accountPassword?: string } = {}) => {
    if (e) e.preventDefault();
    if (loading || carregandoDps || sincronizandoDps) return;
    try {
      normalizeDpsEnvironment(empresa.ambiente); normalizeDpsSeries(empresa.serieDPS); normalizeDpsNumber(empresa.ultimoDPS, true);
    } catch (error) { showMessage((error as Error).message, 'erro'); return; }
    
    // Trava que obriga a seleção do regime
    if (!empresa.regimeTributario) {
        showMessage('❌ É obrigatório selecionar o Regime Tributário.', 'erro');
        return;
    }

    if (!extraData.deletarCertificado && certFile && certificadoCheck.status !== 'ok') {
        showMessage('Valide o certificado digital antes de salvar.', 'erro');
        return;
    }

    const requiresPassword = extraData.deletarCertificado || !!certFile || (empresa.ambiente === 'PRODUCAO' && savedEnvironment !== 'PRODUCAO');
    let password = extraData.accountPassword;
    if (requiresPassword && !password) {
        password = await dialog.showPrompt({ title: 'Confirmar senha de acesso',
            description: certFile ? 'Digite a senha da sua conta para salvar o certificado. Não é a senha do arquivo A1.' : 'Digite a senha da sua conta para ativar o ambiente de produção.',
            inputType: 'password', placeholder: 'Senha de acesso à conta', confirmText: 'Confirmar e salvar' }) ?? undefined;
        if (password === undefined) return;
    }
    if (requiresPassword && !password) { showMessage('Informe a senha de acesso à conta para continuar.', 'erro'); return; }

    setLoading(true);
    const userId = localStorage.getItem('userId');
    const contextId = localStorage.getItem('empresaContextId');

    try {
      const res = await fetch('/api/perfil', {
        method: 'PUT',
        headers: { 
            'Content-Type': 'application/json', 
            'x-user-id': userId || '', 
            'x-empresa-id': contextId || ''
        },
        body: JSON.stringify({ 
            escopo: 'EMPRESA', empresaConfirmadaId: companyContext.id, empresaAtualizadaEm: companyContext.updatedAt,
            documento: empresa.documento, razaoSocial: empresa.razaoSocial, nomeFantasia: empresa.nomeFantasia,
            inscricaoMunicipal: empresa.inscricaoMunicipal, regimeTributario: empresa.regimeTributario,
            cep: empresa.cep, logradouro: empresa.logradouro, numero: empresa.numero, complemento: empresa.complemento,
            bairro: empresa.bairro, cidade: empresa.cidade, uf: empresa.uf, codigoIbge: empresa.codigoIbge,
            emailComercial: empresa.email, ambiente: empresa.ambiente, serieDPS: empresa.serieDPS, ultimoDPS: empresa.ultimoDPS,
            cnaes: atividades.map(item => ({ codigo: item.codigo, descricao: item.descricao, principal: item.principal === true })),
            certificadoArquivo: extraData.deletarCertificado ? undefined : certFile,
            certificadoSenha: extraData.deletarCertificado ? undefined : certFile ? certSenha : undefined,
            deletarCertificado: extraData.deletarCertificado === true, accountPassword: password,
        }),
      });

      const resposta = await res.json();

      if (res.ok) {
        setCompanyContext({ id: resposta.empresaId, updatedAt: resposta.empresaAtualizadaEm });
        setSavedEnvironment(empresa.ambiente);
        setIsLocked(true);
        await carregarSequenciaDps(empresa.ambiente, empresa.serieDPS);
        showMessage('✅ Cadastro salvo com sucesso!', 'sucesso');
        if (resposta.primeiroCertificadoCadastrado) {
            setDadosCertificado({ ativo: true, vencimento: certificadoCheck.vencimento || null });
            const desejaSincronizar = await dialog.showConfirm({
              type: 'success',
              title: 'Certificado salvo',
              description: 'O certificado foi validado. Deseja consultar agora a numeração da DPS no Portal Nacional? Essa consulta não emite nota fiscal.',
              confirmText: 'Sincronizar agora',
              cancelText: 'Fazer depois',
            });
            if (desejaSincronizar) await sincronizarNumeracaoDps();
            setTimeout(() => window.location.reload(), 1200);
        } else if (certFile || extraData.deletarCertificado) {
            setTimeout(() => window.location.reload(), 1500);
        }
      } else { showMessage(`❌ ${resposta.error || 'Erro ao salvar.'}`, 'erro'); }
    } catch (error) { showMessage('❌ Erro de conexão.', 'erro'); } 
    finally { setLoading(false); }
  };

  const codigoIbgeLimpo = String(empresa.codigoIbge || '').replace(/\D/g, '');
  const ibgeValido = codigoIbgeLimpo.length >= 7;
  const proximoCandidatoDps = (() => {
    try { return nextDpsCandidate(normalizeDpsNumber(empresa.ultimoDPS, true), ultimoReservadoDps)?.toString() ?? 'limite esgotado — solicite análise'; }
    catch { return 'informe um número inteiro válido'; }
  })();

  return (
    <div className="saas-shell">
      <AppHeader
        title={isContador ? 'Dados da empresa cliente' : 'Cadastro da empresa'}
        subtitle="Dados obrigatórios para emissão de Nota Fiscal (NFS-e)."
        eyebrow="Configurações"
        backHref="/cliente/dashboard"
      />
      <div className="saas-container max-w-4xl">
        
        <div className="hidden">
        <div className="flex justify-between items-center mb-8">
            <div className="flex items-center gap-4">
                <button onClick={() => router.back()} className="p-2 hover:bg-gray-200 rounded-full transition">
                    <ArrowLeft className="text-gray-600" />
                </button>
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">
                        {isContador ? 'Dados da Empresa (Cliente)' : 'Cadastro da Empresa'}
                    </h1>
                    <p className="text-gray-500">Dados obrigatórios para emissão de Nota Fiscal (NFS-e).</p>
                </div>
            </div>
        </div>
        </div>

        {!carregandoPerfil && !erroCarregamento && (isLocked ? (
            <div className="bg-orange-50 border-l-4 border-orange-400 p-4 mb-8 rounded-r shadow-sm flex flex-col md:flex-row items-start gap-4">
                <div className="flex items-start gap-3 flex-1">
                    <div className="text-orange-500 mt-1"><Info size={24} /></div>
                    <div>
                        <h3 className="font-bold text-orange-900">Cadastro Vinculado</h3>
                        <p className="text-sm text-orange-800 mt-1 leading-relaxed">
                            Este cadastro está associado ao CNPJ informado. Para garantir a segurança fiscal, a alteração do documento não é permitida manualmente.
                        </p>
                    </div>
                </div>
                <button onClick={() => consultarCNPJ(true)} disabled={buscando} className="whitespace-nowrap bg-white text-orange-700 border border-orange-200 px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-100 transition shadow-sm">
                    {buscando ? 'Buscando...' : '↻ Atualizar Dados da Receita'}
                </button>
            </div>
        ) : (
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-8 rounded-r shadow-sm flex items-start gap-4">
                <div className="text-blue-500 mt-1"><Briefcase size={24} /></div>
                <div>
                    <h3 className="font-bold text-blue-900">Configuração Inicial</h3>
                    <p className="text-sm text-blue-800 mt-1">Informe o <strong>CNPJ</strong> abaixo e clique em buscar.</p>
                </div>
            </div>
        ))}
        {carregandoPerfil ? (
          <div className="saas-card p-8 text-center text-slate-600">
            Carregando dados da empresa...
          </div>
        ) : erroCarregamento ? (
          <div className="saas-card border-red-100 bg-red-50 p-8 text-center">
            <h2 className="text-lg font-bold text-red-700">Não foi possível carregar esta empresa</h2>
            <p className="mt-2 text-sm text-red-600">{erroCarregamento}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-red-700"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
        <form onSubmit={(e) => handleSalvar(e)} className="saas-card overflow-hidden">
          
          <div className="p-8 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-blue-600 mb-6 flex items-center gap-2">
              <Briefcase size={20} /> Dados Cadastrais
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">CNPJ</label>
                <div className="flex gap-2 tour-cnpj-search">
                  <div className="relative flex-1">
                    <Building2 className="absolute left-3 top-3 text-gray-400" size={20} />
                    <input type="text" className={`w-full pl-10 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono ${isLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white'}`} placeholder="00.AAA.000/0000-00" value={empresa.documento || ''} onChange={e => setEmpresa({...empresa, documento: formatCnpjInput(e.target.value)})} maxLength={18} disabled={isLocked} />
                  </div>
                  {!isLocked && (
                      <button type="button" onClick={() => consultarCNPJ(false)} disabled={buscando} className="bg-blue-100 text-blue-700 px-6 py-2 rounded-lg font-medium hover:bg-blue-200 transition flex items-center gap-2 disabled:opacity-50">
                        {buscando ? '...' : <><Search size={20} /> Buscar</>}
                      </button>
                  )}
                </div>
              </div>

              <div><label className="block text-sm font-medium text-gray-700 mb-2">Razão Social</label><input type="text" className="w-full p-3 border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={empresa.razaoSocial || ''} onChange={e => setEmpresa({...empresa, razaoSocial: e.target.value})} /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">Nome Fantasia</label><input type="text" className="w-full p-3 border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={empresa.nomeFantasia || ''} onChange={e => setEmpresa({...empresa, nomeFantasia: e.target.value})} /></div>

              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6 tour-tributacao">
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Inscrição Municipal <span className="text-blue-600 text-xs">(Editável)</span></label>
                      <input type="text" className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white font-bold text-gray-800" placeholder="Ex: 12345" value={empresa.inscricaoMunicipal || ''} onChange={e => setEmpresa({...empresa, inscricaoMunicipal: e.target.value})}/>
                  </div>
                  <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Regime Tributário <span className="text-red-500 text-xs">* Obrigatório</span></label>
                      <select 
                        className={`w-full p-3 border rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none ${!empresa.regimeTributario ? 'border-red-300 text-gray-500' : 'text-gray-800'}`} 
                        value={empresa.regimeTributario || ''} 
                        onChange={e => setEmpresa({...empresa, regimeTributario: e.target.value})}
                        required
                      >
                          <option value="" disabled>Selecione um regime...</option>
                          <option value="MEI">Microempreendedor Individual (MEI)</option>
                          <option value="SIMPLES">Simples Nacional</option>
                          <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
                      </select>
                  </div>
              </div>

              <div className="md:col-span-2 bg-gray-50 p-4 rounded-lg border border-gray-200 mt-2 opacity-80">
                <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-bold text-gray-600 flex items-center gap-2">📋 Atividades (CNAEs) - Automático</h4>
                    <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full">{atividades.length} atividades</span>
                </div>
                {atividades.length === 0 ? (
                    <p className="text-xs text-gray-500 italic p-2">Nenhuma atividade carregada.</p>
                ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                        {atividades.map((cnae, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-xs bg-white p-3 rounded border border-gray-200 shadow-sm">
                                <span className={`font-bold px-2 py-1 rounded text-[10px] uppercase tracking-wide ${cnae.principal ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {cnae.principal ? 'Principal' : 'Secundário'}
                                </span>
                                <div>
                                    <span className="font-mono font-bold text-gray-800 text-sm block">{cnae.codigo}</span>
                                    <span className="text-gray-600 leading-tight">{cnae.descricao}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
              </div>
            </div>
          </div>

          <div className="p-8 border-b border-gray-100 bg-blue-50/30 tour-dps-config">
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-blue-800 flex items-center gap-2">
                <Settings size={20} /> Numeração e Ambiente (DPS)
              </h3>
              <p className="text-sm text-slate-500 mt-1">Esses dados controlam a sequência da DPS enviada ao ambiente nacional. Altere com cuidado para evitar duplicidade de numeração.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Ambiente de Emissão</label>
                    <select disabled={carregandoDps || sincronizandoDps || loading} className="w-full p-3 border rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none" value={empresa.ambiente} onChange={e => void carregarSequenciaDps(e.target.value, empresa.serieDPS)}>
                        <option value="HOMOLOGACAO">Homologação (Teste)</option>
                        <option value="PRODUCAO">Produção (Valendo)</option>
                    </select>
                    <p className={`text-xs mt-1 font-medium ${empresa.ambiente === 'PRODUCAO' ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {empresa.ambiente === 'PRODUCAO' ? 'Notas emitidas terão valor fiscal.' : 'Ambiente de testes, sem valor fiscal.'}
                    </p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Série do DPS</label>
                    <input type="text" inputMode="numeric" pattern="[0-9]{1,5}" disabled={carregandoDps || sincronizandoDps || loading} className="w-full p-3 border rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none" value={empresa.serieDPS} onChange={e => { ++dpsRequestVersion.current; setEmpresa({...empresa, serieDPS: e.target.value, ultimoDPS: ''}); setUltimoReservadoDps(0); }} onBlur={() => void carregarSequenciaDps(empresa.ambiente, empresa.serieDPS)} placeholder="Ex: 900" maxLength={5}/>
                    <p className="text-xs text-slate-500 mt-1">De 1 a 5 dígitos. Zeros à esquerda não criam outra série: 900 e 00900 compartilham a numeração.</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Último Número Confirmado</label>
                    <input type="number" min={0} max={MAX_STORED_DPS_NUMBER} step={1} disabled={carregandoDps || sincronizandoDps || loading} className="w-full p-3 border rounded-lg bg-white text-blue-700 font-bold focus:ring-2 focus:ring-blue-500 outline-none" value={empresa.ultimoDPS} onChange={e => setEmpresa({...empresa, ultimoDPS: e.target.value})}/>
                    <p className="text-xs text-slate-500 mt-1">Maior número reservado: <strong>{ultimoReservadoDps}</strong>. Próximo candidato local: <strong>{carregandoDps ? 'consultando...' : proximoCandidatoDps}</strong>. A reserva ocorre no processamento; números usados não são reutilizados.</p>
                </div>
            </div>
            <div className="mt-6 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><ShieldCheck size={21}/></div>
                  <div>
                    <h4 className="font-bold text-slate-900">Sincronização segura com o Portal Nacional</h4>
                    <p className="mt-1 text-sm text-slate-600">Consulta a existência das DPS sem transmitir XML e sem emitir nota fiscal.</p>
                  </div>
                </div>
                <button type="button" onClick={() => void sincronizarNumeracaoDps()} disabled={sincronizandoDps || carregandoDps || loading || (!dadosCertificado.ativo && !certFile)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {sincronizandoDps ? <Loader2 size={17} className="animate-spin"/> : <RefreshCw size={17}/>} {sincronizandoDps ? 'Sincronizando...' : 'Sincronizar numeração'}
                </button>
              </div>
              {dpsStatus.mensagem && (
                <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${dpsStatus.tipo === 'erro' ? 'border-red-200 bg-red-50 text-red-700' : dpsStatus.tipo === 'parcial' ? 'border-amber-200 bg-amber-50 text-amber-800' : dpsStatus.tipo === 'sucesso' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-100 bg-blue-50 text-blue-700'}`}>
                  {dpsStatus.mensagem}
                </div>
              )}
            </div>
          </div>

          <div className="p-8 border-b border-gray-100">
            <div className="mb-6">
                <h3 className="text-lg font-semibold text-blue-600 flex items-center gap-2"><MapPin size={20} /> Endereço da Empresa</h3>
                <p className="text-sm text-slate-500 mt-1">Endereço fiscal usado pelo Portal Nacional para validar município, tributação e emissão da NFS-e.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-x-8 gap-y-7">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">CEP</label>
                  <input className="saas-input" placeholder="00000-000" value={empresa.cep || ''} onChange={e => setEmpresa({...empresa, cep: e.target.value})}/>
                </div>
                <div className="md:col-span-5">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Logradouro</label>
                  <input className="saas-input" placeholder="Rua, avenida, travessa..." value={empresa.logradouro || ''} onChange={e => setEmpresa({...empresa, logradouro: e.target.value})}/>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Número</label>
                  <input className="saas-input" placeholder="Número" value={empresa.numero || ''} onChange={e => setEmpresa({...empresa, numero: e.target.value})}/>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Bairro</label>
                  <input className="saas-input" placeholder="Bairro" value={empresa.bairro || ''} onChange={e => setEmpresa({...empresa, bairro: e.target.value})}/>
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="company-complement" className="block text-sm font-medium text-slate-700 mb-2">Complemento</label>
                  <input id="company-complement" className="saas-input" maxLength={100} value={empresa.complemento || ''} onChange={e => setEmpresa({...empresa, complemento: e.target.value})}/>
                </div>
                <div className="md:col-span-4">
                  <label htmlFor="company-contact-email" className="block text-sm font-medium text-slate-700 mb-2">E-mail comercial da empresa</label>
                  <input id="company-contact-email" type="email" className="saas-input" maxLength={254} value={empresa.email || ''} onChange={e => setEmpresa({...empresa, email: e.target.value})}/>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Cidade</label>
                  <input className="saas-input" placeholder="Cidade" value={empresa.cidade || ''} onChange={e => setEmpresa({...empresa, cidade: e.target.value})}/>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-2">UF</label>
                  <input className="saas-input" placeholder="UF" value={empresa.uf || ''} onChange={e => setEmpresa({...empresa, uf: e.target.value})}/>
                </div>
                
                <div className="md:col-span-2">
                  <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    Código IBGE
                    <span className="group relative inline-flex">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black leading-none text-slate-500 ring-1 ring-slate-200">
                        *
                      </span>
                      <span className="pointer-events-none absolute left-1/2 top-6 z-30 w-72 -translate-x-1/2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium leading-relaxed text-white opacity-0 shadow-xl transition-opacity duration-150 delay-[1500ms] group-hover:opacity-100">
                        Caso a consulta automática não preencha o código do IBGE, solicite ao suporte a inclusão manual para este município.
                      </span>
                    </span>
                  </label>
                  <input
                    className="saas-input bg-slate-50 font-mono"
                    placeholder="Não informado"
                    readOnly
                    value={ibgeValido ? codigoIbgeLimpo : ''}
                  />
                </div>
                
            </div>
          </div>

          <div className="p-8 bg-slate-50 border-t border-slate-200 tour-certificado">
            <h3 className="text-lg font-semibold text-slate-700 mb-6 flex items-center gap-2">
                <Lock size={20} /> Certificado Digital A1
            </h3>

            {dadosCertificado.ativo ? (
                <div className="bg-white border-l-4 border-green-500 p-6 rounded shadow-sm mb-6 flex justify-between items-center">
                    <div>
                        <h4 className="font-bold text-green-700 flex items-center gap-2 text-lg">
                            <CheckCircle size={24}/> Certificado Válido e Configurado
                        </h4>
                        <p className="text-sm text-gray-500 mt-1">
                            Expira em: <span className="font-mono font-bold text-gray-800">{dadosCertificado.vencimento ? new Date(dadosCertificado.vencimento).toLocaleDateString() : 'Data não identificada'}</span>
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => setModoEdicaoCertificado(!modoEdicaoCertificado)} className="p-2 text-blue-600 hover:bg-blue-50 rounded transition" title="Atualizar / Substituir">
                            <FileKey size={20} />
                        </button>
                        <button type="button" onClick={handleDeletarCertificado} className="p-2 text-red-500 hover:bg-red-50 rounded transition" title="Excluir Certificado">
                            <Trash2 size={20} />
                        </button>
                    </div>
                </div>
            ) : null}

            {(modoEdicaoCertificado || !dadosCertificado.ativo) && (
                <div className="bg-white p-6 rounded-xl border border-dashed border-slate-300 hover:border-blue-400 transition group">
                    <label className="block text-sm font-bold text-slate-700 mb-4 group-hover:text-blue-600 transition flex items-center gap-2">
                        <FileKey size={18}/> {dadosCertificado.ativo ? 'Substituir Certificado Atual' : 'Configurar Novo Certificado'}
                    </label>
                    <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                        <label className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg cursor-pointer transition font-medium w-full md:w-auto border ${certFile ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}>
                            {certFile ? <CheckCircle size={18}/> : <Upload size={18} />}
                            {certFile ? 'Arquivo Selecionado' : 'Escolher Arquivo (.pfx)'}
                            <input type="file" accept=".pfx,.p12" onChange={handleFileChange} className="hidden"/>
                        </label>
                        <div className="relative w-full md:w-64">
                            <Lock className="absolute left-3 top-3 text-gray-400" size={16} />
                            <input
                              type="password"
                              placeholder="Senha do Certificado"
                              value={certSenha}
                              onChange={e => {
                                setCertSenha(e.target.value);
                                setCertificadoCheck({ status: 'idle', mensagem: '' });
                              }}
                              onBlur={validarCertificadoAntesDeSalvar}
                              className="pl-10 pr-10 p-3 border rounded-lg w-full text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            {validandoCertificado && <Loader2 className="absolute right-3 top-3 text-blue-500 animate-spin" size={18} />}
                        </div>
                    </div>
                    {certFile && !certificadoCheck.mensagem && (
                        <p className="mt-3 text-xs font-medium text-slate-500">
                            Digite a senha e clique fora do campo para validar antes de salvar.
                        </p>
                    )}
                    {certificadoCheck.mensagem && (
                        <div className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-sm font-medium ${
                          certificadoCheck.status === 'ok'
                            ? 'border-green-200 bg-green-50 text-green-800'
                            : certificadoCheck.status === 'erro'
                              ? 'border-red-200 bg-red-50 text-red-700'
                              : 'border-blue-200 bg-blue-50 text-blue-700'
                        }`}>
                            {certificadoCheck.status === 'ok' ? <CheckCircle size={18} /> : certificadoCheck.status === 'erro' ? <AlertCircle size={18} /> : <Loader2 className="animate-spin" size={18} />}
                            <div>
                                <p>{certificadoCheck.mensagem}</p>
                                {certificadoCheck.status === 'ok' && certificadoCheck.vencimento && (
                                    <p className="mt-1 text-xs opacity-80">Vencimento: {new Date(certificadoCheck.vencimento).toLocaleDateString()}</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
          </div>

          <div className="bg-gray-50 p-6 flex flex-col items-center gap-4 border-t sticky bottom-0 z-10 shadow-inner">
            {msg && (
              <div role={msg.tipo === 'erro' ? 'alert' : 'status'} className={`px-6 py-3 rounded-lg text-sm font-bold shadow-md ${msg.tipo === 'sucesso' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {msg.texto}
              </div>
            )}
            <button type="submit" disabled={loading || validandoCertificado || (!!certFile && certificadoCheck.status !== 'ok')} className="tour-save-btn w-full md:w-auto px-12 py-4 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-green-200 transform hover:scale-[1.02]">
              {loading ? 'Processando...' : <><Save size={20} /> Salvar Configurações</>}
            </button>
          </div>

        </form>
        )}
      </div>
    </div>
  );
}
