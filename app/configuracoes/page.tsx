'use client';

import { useState, useEffect } from 'react';
import { 
  Building2, Save, ArrowLeft, Search, MapPin, Briefcase, 
  Lock, CheckCircle, Trash2, Info, Upload, FileKey, Settings, Loader2, AlertCircle
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';

export default function ConfiguracoesEmpresa() {
  const router = useRouter();
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
  const [validandoCertificado, setValidandoCertificado] = useState(false);
  const [certificadoCheck, setCertificadoCheck] = useState<{
    status: 'idle' | 'ok' | 'erro';
    mensagem: string;
    vencimento?: string | null;
  }>({ status: 'idle', mensagem: '' });
  const [dadosCertificado, setDadosCertificado] = useState<{ativo: boolean, vencimento: string | null}>({ ativo: false, vencimento: null });
  const [modoEdicaoCertificado, setModoEdicaoCertificado] = useState(false);

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
    ultimoDPS: 0
  });

  const showMessage = (texto: string, tipo: 'sucesso' | 'erro') => {
      setMsg({ texto, tipo });
      setTimeout(() => setMsg(null), 3000);
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
        if (contextId) setIsContador(true);

        const res = await fetch(`/api/perfil?t=${Date.now()}`, {
            cache: 'no-store',
            headers: { 
                'x-user-id': userId || '',
                'x-empresa-id': contextId || ''
            } 
        });

        if (res.ok) {
          const dados = await res.json();
          setEmpresa(prev => ({ 
              ...prev, 
              ...dados,
              // Garante que o IBGE vindo do banco seja lido corretamente
              codigoIbge: dados.codigoIbge || '',
              serieDPS: dados.serieDPS || '900',
              ultimoDPS: dados.ultimoDPS || 0,
              ambiente: dados.ambiente || 'HOMOLOGACAO'
          }));
          
          if (dados.atividades) setAtividades(dados.atividades);
          
          setDadosCertificado({
              ativo: dados.temCertificado,
              vencimento: dados.vencimentoCertificado
          });

          if (!dados.temCertificado) setModoEdicaoCertificado(true);
          if (dados.cadastroCompleto) setIsLocked(true);
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
    const docLimpo = empresa.documento.replace(/\D/g, '');
    
    if (isLocked && !forcarAtualizacao) return; 
    if (docLimpo.length !== 14) { alert("CNPJ inválido."); return; }

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

      const cnpjLimpo = empresa.documento.replace(/\D/g, '');
      if (cnpjLimpo.length !== 14) {
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
      if(!confirm("Tem certeza? Sem o certificado você não poderá emitir notas.")) return;
      await handleSalvar(null, { deletarCertificado: true });
      window.location.reload();
  };

  const handleSalvar = async (e: React.FormEvent | null, extraData: any = {}) => {
    if (e) e.preventDefault();
    
    // Trava que obriga a seleção do regime
    if (!empresa.regimeTributario) {
        showMessage('❌ É obrigatório selecionar o Regime Tributário.', 'erro');
        return;
    }

    if (certFile && certificadoCheck.status !== 'ok') {
        showMessage('Valide o certificado digital antes de salvar.', 'erro');
        return;
    }

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
            ...empresa, 
            cnaes: atividades,
            certificadoArquivo: certFile, 
            certificadoSenha: certSenha,
            ...extraData
        }),
      });

      const resposta = await res.json();

      if (res.ok) {
        showMessage('✅ Cadastro salvo com sucesso!', 'sucesso');
        if (certFile || extraData.deletarCertificado) {
            setTimeout(() => window.location.reload(), 1500);
        }
      } else { showMessage(`❌ ${resposta.error || 'Erro ao salvar.'}`, 'erro'); }
    } catch (error) { showMessage('❌ Erro de conexão.', 'erro'); } 
    finally { setLoading(false); }
  };

  const codigoIbgeLimpo = String(empresa.codigoIbge || '').replace(/\D/g, '');
  const ibgeValido = codigoIbgeLimpo.length >= 7;

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
                    <input type="text" className={`w-full pl-10 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono ${isLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white'}`} placeholder="00000000000191" value={empresa.documento || ''} onChange={e => setEmpresa({...empresa, documento: e.target.value})} maxLength={18} disabled={isLocked} />
                  </div>
                  {!isLocked && (
                      <button type="button" onClick={() => consultarCNPJ(false)} disabled={buscando} className="bg-blue-100 text-blue-700 px-6 py-2 rounded-lg font-medium hover:bg-blue-200 transition flex items-center gap-2 disabled:opacity-50">
                        {buscando ? '...' : <><Search size={20} /> Buscar</>}
                      </button>
                  )}
                </div>
              </div>

              <div><label className="block text-sm font-medium text-gray-700 mb-2">Razão Social</label><input type="text" className="w-full p-3 border rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed" value={empresa.razaoSocial || ''} readOnly /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">Nome Fantasia</label><input type="text" className="w-full p-3 border rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed" value={empresa.nomeFantasia || ''} readOnly /></div>

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
                    <select className="w-full p-3 border rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none" value={empresa.ambiente} onChange={e => setEmpresa({...empresa, ambiente: e.target.value})}>
                        <option value="HOMOLOGACAO">Homologação (Teste)</option>
                        <option value="PRODUCAO">Produção (Valendo)</option>
                    </select>
                    <p className={`text-xs mt-1 font-medium ${empresa.ambiente === 'PRODUCAO' ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {empresa.ambiente === 'PRODUCAO' ? 'Notas emitidas terão valor fiscal.' : 'Ambiente de testes, sem valor fiscal.'}
                    </p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Série do DPS</label>
                    <input type="text" className="w-full p-3 border rounded-lg bg-white text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none" value={empresa.serieDPS} onChange={e => setEmpresa({...empresa, serieDPS: e.target.value})} placeholder="Ex: 900"/>
                    <p className="text-xs text-slate-500 mt-1">Série usada na numeração da DPS. Geralmente "900" para testes ou "1" para produção.</p>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Último Número Usado</label>
                    <input type="number" className="w-full p-3 border rounded-lg bg-white text-blue-700 font-bold focus:ring-2 focus:ring-blue-500 outline-none" value={empresa.ultimoDPS} onChange={e => setEmpresa({...empresa, ultimoDPS: parseInt(e.target.value)})}/>
                    <p className="text-xs text-slate-500 mt-1">O sistema sempre usará o próximo número. Ex.: se está 0, a próxima emissão será 1.</p>
                </div>
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
              <div className={`px-6 py-3 rounded-lg text-sm font-bold shadow-md ${msg.tipo === 'sucesso' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
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
