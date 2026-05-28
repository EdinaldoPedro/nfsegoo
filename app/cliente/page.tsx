'use client';

import { useEffect, useState } from 'react';
import { 
    Plus, Search, Edit, Trash2, MapPin, 
    User, Building2, Globe, Loader2, X, 
    ArrowLeft, Save, RefreshCw
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDialog } from '@/app/contexts/DialogContext';
import { validarCPF } from '@/app/utils/cpf';
import AppHeader from '@/components/AppHeader';

// Lista de Países para Padronização (ISO 3166 / BACEN simplificado) - SEM ACENTOS PARA SEGURANÇA
const LISTA_PAISES = [
    "Africa do Sul", "Alemanha", "Angola", "Arabia Saudita", "Argentina", "Australia", "Austria", 
    "Belgica", "Bolivia", "Brasil", "Canada", "Chile", "China", "Cingapura", "Colombia", "Coreia do Sul", 
    "Costa Rica", "Croacia", "Dinamarca", "Egito", "Emirados Arabes Unidos", "Equador", "Espanha", 
    "Estados Unidos", "Finlandia", "Franca", "Grecia", "Holanda", "Hong Kong", "India", "Indonesia", 
    "Irlanda", "Israel", "Italia", "Japao", "Mexico", "Noruega", "Nova Zelandia", "Panama", "Paraguai", 
    "Peru", "Polonia", "Portugal", "Reino Unido", "Russia", "Suecia", "Suica", "Tailandia", "Turquia", 
    "Uruguai", "Venezuela"
];

interface Cliente {
  id: string;
  nome: string;
  nomeFantasia?: string; 
  inscricaoMunicipal?: string; 
  email: string;
  documento: string;
  tipo: 'PJ' | 'PF' | 'EXT';
  cidade?: string;
  uf?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  codigoIbge?: string;
  pais?: string;
  moeda?: string;
}

export default function MeusClientes() {
  const router = useRouter();
  const dialog = useDialog();
  
  // === ESTADOS DE DADOS ===
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [filteredClientes, setFilteredClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  
  // === ESTADOS DE CONTROLE VISUAL ===
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [modalStep, setModalStep] = useState<'SELECAO' | 'FORMULARIO'>('SELECAO');
  
  const [salvando, setSalvando] = useState(false);
  const [buscandoDados, setBuscandoDados] = useState(false);
  const [nomePfBloqueado, setNomePfBloqueado] = useState(false);
  const [termoBusca, setTermoBusca] = useState('');
  
  // === ESTADO DO FORMULÁRIO ===
  const [clienteAtual, setClienteAtual] = useState<Cliente>({ 
    id: '', nome: '', nomeFantasia: '', inscricaoMunicipal: '', 
    email: '', documento: '', cidade: '', uf: '', cep: '', 
    logradouro: '', numero: '', bairro: '', codigoIbge: '',
    tipo: 'PJ', pais: 'Brasil', moeda: 'BRL'
  });

  const isPJ = clienteAtual.tipo === 'PJ';
  const isEdicaoPJ = !!clienteAtual.id && clienteAtual.tipo === 'PJ';

  // --- CARREGAMENTO ---
  const carregarClientes = async () => {
    setLoading(true);
    const userId = localStorage.getItem('userId');
    const contextId = localStorage.getItem('empresaContextId');

    if (!userId) return;
        try {
        const res = await fetch('/api/clientes', { 
            headers: { 'x-user-id': userId, 'x-empresa-id': contextId || '' } 
    });
      const dados = await res.json();
      
      // Ajuste para ler 'data' por causa da paginação
      if (dados && dados.data && Array.isArray(dados.data)) {
          setClientes(dados.data);
          setFilteredClientes(dados.data);
      } else if (Array.isArray(dados)) {
          setClientes(dados);
          setFilteredClientes(dados);
      }
    } catch (erro) { console.error(erro); } 
    finally { setLoading(false); }
  };

  useEffect(() => { carregarClientes(); }, []);

  useEffect(() => {
    if (!termoBusca) {
      setFilteredClientes(clientes);
    } else {
      const lower = termoBusca.toLowerCase();
      const filtrados = clientes.filter(c => 
        c.nome.toLowerCase().includes(lower) || 
        c.documento.includes(lower) || 
        (c.nomeFantasia && c.nomeFantasia.toLowerCase().includes(lower))
      );
      setFilteredClientes(filtrados);
    }
  }, [termoBusca, clientes]);

  // --- LÓGICA DO WIZARD ---
  const abrirNovoCadastro = () => {
    setNomePfBloqueado(false);
    setClienteAtual({ 
        id: '', nome: '', nomeFantasia: '', inscricaoMunicipal: '', email: '', 
        documento: '', cidade: '', uf: '', cep: '', logradouro: '', 
        numero: '', bairro: '', codigoIbge: '', tipo: 'PJ', pais: 'Brasil', moeda: 'BRL'
    });
    setModalStep('SELECAO');
    setIsFormOpen(true);
  }

  const selecionarTipo = (tipo: 'PJ' | 'PF' | 'EXT') => {
      setNomePfBloqueado(false);
      setClienteAtual(prev => ({ 
          ...prev, 
          tipo,
          pais: tipo === 'EXT' ? '' : 'Brasil',
          documento: '',
          nome: tipo === 'PF' ? '' : prev.nome,
      }));
      setModalStep('FORMULARIO');
  };

  const manterIbgeSeConsultaVierVazia = (codigoNovo: string | null | undefined, codigoAtual: string | null | undefined) => {
      const novoLimpo = String(codigoNovo || '').replace(/\D/g, '');
      return novoLimpo.length >= 7 ? novoLimpo : (codigoAtual || '');
  };

  const abrirEdicao = (cliente: Cliente) => {
    setNomePfBloqueado(false);
    setClienteAtual({ ...cliente, pais: cliente.pais || 'Brasil' });
    setModalStep('FORMULARIO'); 
    setIsFormOpen(true);
  }

  const voltarSelecao = () => {
    if (!clienteAtual.id) setModalStep('SELECAO');
  }

  // --- BUSCAS E VALIDAÇÕES ---
  
  // Verifica se o cliente já existe no banco
  const verificarClienteExistente = async (doc: string) => {
        setBuscandoDados(true);
        try {
            // OBS: O backend limpa caracteres não numéricos. 
            // Para NIF alfanumérico, o backend precisaria ser ajustado, 
            // mas assumindo NIF numérico ou backend tolerante:
            const res = await fetch('/api/clientes/check', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ documento: doc })
            });
            
            if (res.ok) {
                const dados = await res.json();
                if (dados) {
                    setNomePfBloqueado(false);
                    setClienteAtual(prev => ({ ...prev, ...dados }));
                    dialog.showAlert({ type: 'info', title: 'Cliente Encontrado', description: 'Dados carregados da sua base.' });
                    return true;
                }
            }
        } catch (e) { console.error(e); }
        finally { setBuscandoDados(false); }
        return false;
    };

  const consultarCpfNoPortal = async (cpfLimpo: string) => {
      setBuscandoDados(true);
      const userId = localStorage.getItem('userId');
      const contextId = localStorage.getItem('empresaContextId');

      try {
          const res = await fetch('/api/clientes/pf-portal', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'x-user-id': userId || '',
                  'x-empresa-id': contextId || '',
              },
              body: JSON.stringify({ cpf: cpfLimpo }),
          });

          const dados = await res.json();
          if (!res.ok) {
              setNomePfBloqueado(false);
              dialog.showAlert({
                  type: 'warning',
                  title: 'Consulta oficial nao concluida',
                  description: dados.error || 'Nao foi possivel validar o CPF no Portal Nacional agora.',
              });
              return false;
          }

          if (dados?.nome) {
              setClienteAtual(prev => ({
                  ...prev,
                  tipo: 'PF',
                  nome: dados.nome,
              }));
              setNomePfBloqueado(dados.origem === 'PORTAL_NACIONAL');
              dialog.showAlert({
                  type: 'success',
                  title: 'CPF validado no Portal Nacional',
                  description: 'Nome oficial carregado automaticamente.',
              });
              return true;
          }
      } catch {
          setNomePfBloqueado(false);
          dialog.showAlert({
              type: 'danger',
              description: 'Erro de conexao ao consultar CPF no Portal Nacional.',
          });
      } finally {
          setBuscandoDados(false);
      }

      return false;
  };

  // Busca CNPJ na API Externa
  const executarBuscaCNPJ = async (cnpjLimpo: string) => {
      setBuscandoDados(true);
      try {
          const res = await fetch('/api/external/cnpj', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cnpj: cnpjLimpo })
          });
          const dados = await res.json();
          if (res.ok) {
              setClienteAtual(prev => ({
                  ...prev,
                  nome: dados.razaoSocial, nomeFantasia: dados.nomeFantasia,
                  email: dados.email, cep: dados.cep,
                  logradouro: dados.logradouro, numero: dados.numero,
                  bairro: dados.bairro, cidade: dados.cidade, uf: dados.uf,
                  codigoIbge: manterIbgeSeConsultaVierVazia(dados.codigoIbge, prev.codigoIbge)
              }));
              dialog.showAlert({ type: 'success', description: 'Dados carregados da Receita!' });
          } else { 
              dialog.showAlert("CNPJ não encontrado na Receita."); 
          }
      } catch (e) { } 
      finally { setBuscandoDados(false); }
  };

  const handleAtualizarCadastroPJ = async () => {
      if (!isEdicaoPJ) return;

      const cnpjLimpo = clienteAtual.documento.replace(/\D/g, '');
      if (cnpjLimpo.length !== 14) {
          dialog.showAlert('CNPJ inválido para atualização automática.');
          return;
      }

      setBuscandoDados(true);

      try {
          const resCnpj = await fetch('/api/external/cnpj', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cnpj: cnpjLimpo })
          });
          const dados = await resCnpj.json();

          if (!resCnpj.ok) {
              dialog.showAlert('Não foi possível consultar o CNPJ no momento.');
              return;
          }

          setClienteAtual(prev => ({
              ...prev,
              nome: dados.razaoSocial,
              nomeFantasia: dados.nomeFantasia,
              email: dados.email,
              cep: dados.cep,
              logradouro: dados.logradouro,
              numero: dados.numero,
              bairro: dados.bairro,
              cidade: dados.cidade,
              uf: dados.uf,
              codigoIbge: manterIbgeSeConsultaVierVazia(dados.codigoIbge, prev.codigoIbge)
          }));

          dialog.showAlert({ type: 'success', description: 'Dados oficiais carregados. Clique em Salvar para confirmar.' });
      } catch {
          dialog.showAlert('Erro de conexão ao atualizar cadastro.');
      } finally {
          setBuscandoDados(false);
      }
  };

  const handleDocumentoChange = async (val: string) => {
      // === EXTERIOR ===
      if (clienteAtual.tipo === 'EXT') {
          // Permite letras e números para NIF/Passaporte
          setClienteAtual(prev => ({ ...prev, documento: val }));
          
          // Se tiver um tamanho razoável (ex: > 5), tenta checar se já existe no banco
          // Debounce manual simples: só chama se não estiver buscando
          if (val.length > 5 && !buscandoDados) {
               // Não bloqueia a digitação, faz silenciosamente ou só no onBlur seria melhor,
               // mas aqui vamos deixar o usuário digitar.
               // Se quiser checar, chame verificarClienteExistente(val) no onBlur do input.
          }
          return;
      }

      // === BRASIL (PJ/PF) ===
      let v = val.replace(/\D/g, '');
      const rawLength = v.length;

      // Máscara
      let documentoFormatado = v;
      if (clienteAtual.tipo === 'PF') {
          if (v.length <= 11) {
            documentoFormatado = v.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
          }
      } else {
          if (v.length <= 14) {
            documentoFormatado = v.slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
          }
      }

      setClienteAtual(prev => ({ ...prev, documento: documentoFormatado }));
      if (clienteAtual.tipo === 'PF' && rawLength < 11) {
          setNomePfBloqueado(false);
          setClienteAtual(prev => ({ ...prev, documento: documentoFormatado, nome: '' }));
      }

      // === AUTOMAÇÃO PF (11 Dígitos) ===
      if (clienteAtual.tipo === 'PF' && rawLength === 11) {
          if (!validarCPF(documentoFormatado)) {
               setNomePfBloqueado(false);
               dialog.showAlert({ type: 'warning', title: 'CPF Inválido', description: 'Verifique os números digitados.' });
               return;
          }
          const achouInterno = await verificarClienteExistente(v);
          if (!achouInterno) {
              await consultarCpfNoPortal(v);
          }
      }

      // === AUTOMAÇÃO PJ (14 Dígitos) ===
      if (clienteAtual.tipo === 'PJ' && rawLength === 14) {
          const achouInterno = await verificarClienteExistente(v);
          if (!achouInterno) {
              executarBuscaCNPJ(v);
          }
      }
  };

  const handleBuscarCep = async () => {
      if (clienteAtual.tipo === 'EXT') return;
      const cepLimpo = clienteAtual.cep?.replace(/\D/g, '');
      if (!cepLimpo || cepLimpo.length !== 8) return; 

      setBuscandoDados(true);
      try {
          const res = await fetch('/api/external/cep', { method: 'POST', body: JSON.stringify({ cep: cepLimpo }) });
          const dados = await res.json();
          if (res.ok) {
              setClienteAtual(prev => ({
                  ...prev,
                  logradouro: dados.logradouro, bairro: dados.bairro,
                  cidade: dados.cidade || dados.localidade, uf: dados.uf,
                  codigoIbge: manterIbgeSeConsultaVierVazia(dados.codigoIbge, prev.codigoIbge)
              }));
          }
      } catch (e) { } finally { setBuscandoDados(false); }
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (buscandoDados) {
      return dialog.showAlert({ type: 'info', title: 'Aguarde a consulta', description: 'O SaaS ainda esta buscando os dados oficiais deste cliente.' });
    }
    if (clienteAtual.tipo === 'PF' && !validarCPF(clienteAtual.documento || '')) {
      return dialog.showAlert({ type: 'warning', title: 'CPF invalido', description: 'Verifique o CPF antes de salvar.' });
    }
    if (!clienteAtual.nome) return dialog.showAlert("Nome é obrigatório.");
    
    setSalvando(true);
    // GARANTIR QUE AS VARIÁVEIS SÃO DEFINIDAS AQUI DENTRO:
    const userId = localStorage.getItem('userId');
    const contextId = localStorage.getItem('empresaContextId');

    try {
      const metodo = clienteAtual.id ? 'PUT' : 'POST';
      const res = await fetch('/api/clientes', {
        method: metodo,
        headers: { 
            'Content-Type': 'application/json', 
            'x-user-id': userId || '', 
            'x-empresa-id': contextId || ''
        },
        body: JSON.stringify({
            ...clienteAtual,
            nomeValidadoPortal: nomePfBloqueado,
        })
      });

      if (res.ok) {
        dialog.showAlert({ type: 'success', description: 'Salvo com sucesso!' });
        setIsFormOpen(false);
        carregarClientes();
      } else { 
          const err = await res.json();
          dialog.showAlert({ type: 'danger', description: err.error || 'Erro ao salvar.' }); 
      }
    } catch (error) { dialog.showAlert("Erro de conexão."); } 
    finally { setSalvando(false); }
 };

  const handleExcluir = async (id: string) => {
    if (!await dialog.showConfirm({ type: 'danger', title: 'Excluir?', description: 'Confirmar exclusão?' })) return;
    const userId = localStorage.getItem('userId');
    const contextId = localStorage.getItem('empresaContextId');

    await fetch(`/api/clientes?id=${id}`, {
        method: 'DELETE',
        headers: { 'x-user-id': userId || '', 'x-empresa-id': contextId || '' }
    });
    carregarClientes();
  };

  // Classes utilitárias para reutilização
  const labelClass = "block text-xs font-bold text-slate-500 mb-1 uppercase";
  const inputClass = "w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition text-sm text-slate-700";
  const formularioBloqueado = buscandoDados || salvando;

  return (
    <div className="saas-shell">
      <AppHeader
        title="Meus clientes"
        subtitle="Gerencie tomadores PF, PJ e Exterior."
        eyebrow="Carteira"
        backHref="/cliente/dashboard"
        action={(
          <button onClick={abrirNovoCadastro} className="saas-btn-primary">
            <Plus size={18} /> Novo cliente
          </button>
        )}
      />
      <div className="saas-container max-w-6xl space-y-6">
        <div className="hidden">
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* CABEÇALHO */}
        <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
                <button onClick={() => router.push('/cliente/dashboard')} className="p-2 hover:bg-slate-200 rounded-full transition text-slate-600">
                    <ArrowLeft size={24} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><User className="text-blue-600"/> Meus Clientes</h1>
                    <p className="text-slate-500 text-sm">Gerencie tomadores PF, PJ e Exterior.</p>
                </div>
            </div>
            
            <button onClick={abrirNovoCadastro} className="bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition flex items-center gap-2 font-medium shadow-md">
                <Plus size={20} /> Novo Cliente
            </button>
        </div>

        </div>
        </div>
        </div>

        {/* MODAL */}
        {isFormOpen && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                    
                    {/* Header do Modal */}
                    <div className="flex justify-between items-center p-6 border-b bg-white z-10">
                        <div className="flex items-center gap-3">
                            {/* Botão voltar só aparece se for formulario de novo cadastro */}
                            {modalStep === 'FORMULARIO' && !clienteAtual.id && (
                                <button disabled={formularioBloqueado} onClick={voltarSelecao} className="text-slate-400 hover:text-blue-600 disabled:opacity-40"><ArrowLeft size={20}/></button>
                            )}
                            <h3 className="font-bold text-lg text-slate-800">
                                {modalStep === 'SELECAO' ? 'Novo Cliente' : clienteAtual.id ? 'Editar Cliente' : `Novo - ${clienteAtual.tipo === 'EXT' ? 'Exterior' : clienteAtual.tipo}`}
                            </h3>
                        </div>
                        <button disabled={formularioBloqueado} onClick={() => setIsFormOpen(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 disabled:opacity-40"><X size={24} /></button>
                    </div>
            
                    <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                        
                        {/* --- ETAPA 1: SELEÇÃO --- */}
                        {modalStep === 'SELECAO' && (
                            <div className="space-y-6 py-4">
                                <p className="text-center text-slate-500">Selecione o tipo de cliente que deseja cadastrar:</p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <button onClick={() => selecionarTipo('PJ')} className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition gap-3 group h-40">
                                        <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition"><Building2 size={24}/></div>
                                        <span className="font-bold text-slate-700">Pessoa Jurídica</span>
                                        <span className="text-xs text-slate-400">CNPJ</span>
                                    </button>
                                    
                                    <button onClick={() => selecionarTipo('PF')} className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-xl hover:border-green-500 hover:bg-green-50 transition gap-3 group h-40">
                                        <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center group-hover:scale-110 transition"><User size={24}/></div>
                                        <span className="font-bold text-slate-700">Pessoa Física</span>
                                        <span className="text-xs text-slate-400">CPF</span>
                                    </button>

                                    <button onClick={() => selecionarTipo('EXT')} className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition gap-3 group h-40">
                                        <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center group-hover:scale-110 transition"><Globe size={24}/></div>
                                        <span className="font-bold text-slate-700">Exterior</span>
                                        <span className="text-xs text-slate-400">Internacional</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* --- ETAPA 2: FORMULÁRIO --- */}
                        {modalStep === 'FORMULARIO' && (
                            <form onSubmit={handleSalvar} className="space-y-6 animate-in slide-in-from-right-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className={labelClass}>
                                            {clienteAtual.tipo === 'PJ' ? 'CNPJ' : clienteAtual.tipo === 'PF' ? 'CPF' : 'NIF / Documento (Opcional)'}
                                        </label>
                                        <div className="relative">
                                            <input 
                                                className={`${inputClass} font-mono pr-10`}
                                                value={clienteAtual.documento || ''} 
                                                onChange={e => handleDocumentoChange(e.target.value)}
                                                disabled={formularioBloqueado || isEdicaoPJ}
                                                // Verifica se existe no banco ao sair do campo (para Exterior)
                                                onBlur={(e) => {
                                                    if(!formularioBloqueado && clienteAtual.tipo === 'EXT' && e.target.value.length > 3) verificarClienteExistente(e.target.value);
                                                }}
                                                placeholder={clienteAtual.tipo === 'EXT' ? 'Ex: 123456789' : 'Apenas números'}
                                                maxLength={clienteAtual.tipo === 'EXT' ? 20 : 18}
                                            />
                                            {buscandoDados && (
                                                <div className="absolute right-3 top-3 text-blue-500">
                                                    <Loader2 className="animate-spin" size={20}/>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <label className={labelClass}>Email</label>
                                        <input type="email" placeholder="email@cliente.com" className={inputClass}
                                            value={clienteAtual.email || ''} onChange={e => setClienteAtual({...clienteAtual, email: e.target.value})}
                                            disabled={formularioBloqueado}
                                        />
                                    </div>
                                </div>

                                <div className={`grid grid-cols-1 ${isPJ ? 'md:grid-cols-2' : ''} gap-6`}>
                                    <div>
                                        <label className={labelClass}>
                                            {isPJ ? 'Razão Social' : 'Nome Completo'}
                                        </label>
                                        <input 
                                            required 
                                            className={inputClass}
                                            value={clienteAtual.nome} 
                                            onChange={e => setClienteAtual({...clienteAtual, nome: e.target.value})}
                                            disabled={formularioBloqueado || isEdicaoPJ || nomePfBloqueado}
                                        />
                                        {nomePfBloqueado && (
                                            <p className="mt-1 text-xs font-medium text-green-700">
                                                Nome confirmado pelo Portal Nacional para este CPF.
                                            </p>
                                        )}
                                    </div>
                                    
                                    {isPJ && (
                                        <>
                                            <div>
                                                <label className={labelClass}>Nome Fantasia</label>
                                                <input className={inputClass}
                                                    value={clienteAtual.nomeFantasia || ''} onChange={e => setClienteAtual({...clienteAtual, nomeFantasia: e.target.value})}
                                                    disabled={formularioBloqueado || isEdicaoPJ}
                                                />
                                            </div>
                                            <div>
                                                <label className={labelClass}>Inscrição Municipal</label>
                                                <input className={inputClass}
                                                    value={clienteAtual.inscricaoMunicipal || ''} onChange={e => setClienteAtual({...clienteAtual, inscricaoMunicipal: e.target.value})}
                                                    placeholder="Apenas números"
                                                    disabled={formularioBloqueado}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>

                                {isEdicaoPJ && (
                                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                                        Para tomador com CNPJ, os dados são automáticos e não podem ser editados manualmente.
                                    </div>
                                )}

                                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 relative">
                                    <h4 className="font-bold text-sm text-slate-700 mb-3 flex items-center gap-2">
                                        <MapPin size={16}/> Endereço {clienteAtual.tipo === 'EXT' && '(Exterior)'}
                                    </h4>
                                    {buscandoDados && <div className="absolute top-4 right-4 flex items-center gap-2 text-xs text-blue-600"><Loader2 className="animate-spin" size={14}/> Buscando...</div>}

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {clienteAtual.tipo === 'EXT' && (
                                            <>
                                                <div className="md:col-span-2">
                                                    <label className={labelClass}>País</label>
                                                    <select 
                                                        className={`${inputClass} bg-yellow-50 font-bold text-slate-800`}
                                                        value={clienteAtual.pais || ''}
                                                        onChange={e => setClienteAtual({...clienteAtual, pais: e.target.value})}
                                                        disabled={formularioBloqueado}
                                                    >
                                                        <option value="">Selecione o País...</option>
                                                        {LISTA_PAISES.map(p => (
                                                            <option key={p} value={p}>{p}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                
                                                <div className="md:col-span-1">
                                                    <label className={labelClass}>Moeda</label>
                                                    <select 
                                                        className={`${inputClass} font-bold text-slate-800`}
                                                        value={clienteAtual.moeda || 'BRL'}
                                                        onChange={e => setClienteAtual({...clienteAtual, moeda: e.target.value})}
                                                        disabled={formularioBloqueado}
                                                    >
                                                        <option value="BRL">BRL - Real Brasileiro</option>
                                                        <option value="USD">USD - Dólar Americano</option>
                                                        <option value="EUR">EUR - Euro</option>
                                                        <option value="GBP">GBP - Libra Esterlina</option>
                                                        <option value="CAD">CAD - Dólar Canadiano</option>
                                                        <option value="AUD">AUD - Dólar Australiano</option>
                                                        <option value="JPY">JPY - Iene Japonês</option>
                                                        <option value="CHF">CHF - Franco Suíço</option>
                                                        <option value="CNY">CNY - Yuan Chinês</option>
                                                        <option value="MXN">MXN - Peso Mexicano</option>
                                                        <option value="ARS">ARS - Peso Argentino</option>
                                                        <option value="CLP">CLP - Peso Chileno</option>
                                                        <option value="COP">COP - Peso Colombiano</option>
                                                        <option value="PYG">PYG - Guarani Paraguaio</option>
                                                        <option value="UYU">UYU - Peso Uruguaio</option>
                                                    </select>
                                                </div>
                                            </>
                                        )}

                                        <div className="md:col-span-1">
                                            <label className={labelClass}>{clienteAtual.tipo === 'EXT' ? 'Zip Code' : 'CEP'}</label>
                                            <input required className={`${inputClass} font-bold text-blue-700`}
                                                value={clienteAtual.cep || ''} 
                                                onChange={e => setClienteAtual({...clienteAtual, cep: e.target.value})}
                                                onBlur={handleBuscarCep}
                                                placeholder={clienteAtual.tipo === 'EXT' ? 'Ex: A2B-3C4' : '00000-000'}
                                                disabled={formularioBloqueado || isEdicaoPJ}
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className={labelClass}>Logradouro</label>
                                            <input className={inputClass}
                                                value={clienteAtual.logradouro || ''} onChange={e => setClienteAtual({...clienteAtual, logradouro: e.target.value})}
                                                disabled={formularioBloqueado || isEdicaoPJ}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Número</label>
                                            <input required placeholder="Nº" className={inputClass}
                                                value={clienteAtual.numero || ''} onChange={e => setClienteAtual({...clienteAtual, numero: e.target.value})}
                                                disabled={formularioBloqueado || isEdicaoPJ}
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className={labelClass}>Bairro</label>
                                            <input className={inputClass}
                                                value={clienteAtual.bairro || ''} onChange={e => setClienteAtual({...clienteAtual, bairro: e.target.value})}
                                                disabled={formularioBloqueado || isEdicaoPJ}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClass}>Cidade</label>
                                            <input className={inputClass}
                                                value={clienteAtual.cidade || ''} onChange={e => setClienteAtual({...clienteAtual, cidade: e.target.value})}
                                                disabled={formularioBloqueado || isEdicaoPJ}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelClass}>{clienteAtual.tipo === 'EXT' ? 'Província/Estado' : 'UF'}</label>
                                            <input className={inputClass}
                                                value={clienteAtual.uf || ''} onChange={e => setClienteAtual({...clienteAtual, uf: e.target.value})} maxLength={clienteAtual.tipo === 'EXT' ? 50 : 2}
                                                disabled={formularioBloqueado || isEdicaoPJ}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </form>
                        )}
                    </div>

                    {/* Footer do Modal (Só aparece no formulário) */}
                    {modalStep === 'FORMULARIO' && (
                        <div className="flex justify-end gap-3 p-6 border-t bg-white">
                            <button type="button" disabled={formularioBloqueado} onClick={() => setIsFormOpen(false)} className="px-6 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition font-medium disabled:opacity-40">Cancelar</button>
                            {isEdicaoPJ && (
                                <button
                                    type="button"
                                    onClick={handleAtualizarCadastroPJ}
                                    disabled={buscandoDados || salvando}
                                    className="border border-orange-300 text-orange-700 px-6 py-2 rounded-lg hover:bg-orange-50 transition font-bold flex items-center gap-2 disabled:opacity-60"
                                >
                                    {buscandoDados ? <Loader2 className="animate-spin" size={18}/> : <RefreshCw size={18} />} Atualizar cadastro
                                </button>
                            )}
                            <button onClick={handleSalvar} disabled={formularioBloqueado} className="bg-green-600 text-white px-8 py-2 rounded-lg hover:bg-green-700 transition font-bold shadow-lg shadow-green-100 flex items-center gap-2 disabled:opacity-60">
                                {formularioBloqueado ? <><Loader2 className="animate-spin" size={18}/> Aguarde</> : <><Save size={18} /> Salvar</>}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* LISTAGEM (MANTIDA IGUAL AO ORIGINAL) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="relative w-full md:w-72">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                    <input 
                        className="w-full pl-10 p-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Buscar por nome ou documento..."
                        value={termoBusca}
                        onChange={e => setTermoBusca(e.target.value)}
                    />
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Documento</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Tipo</th>
                            <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Localização</th>
                            <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                        {loading ? (
                            <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400">Carregando...</td></tr>
                        ) : filteredClientes.length === 0 ? (
                            <tr><td colSpan={5} className="px-6 py-16 text-center text-slate-400">Nenhum cliente encontrado.</td></tr>
                        ) : (
                            filteredClientes.map((cliente) => (
                                <tr key={cliente.id} className="hover:bg-slate-50 transition">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-800">{cliente.nome}</div>
                                        {cliente.nomeFantasia && <div className="text-xs text-slate-500">{cliente.nomeFantasia}</div>}
                                    </td>
                                    <td className="px-6 py-4 font-mono text-xs text-slate-600">
                                        {cliente.documento || '-'}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-1 rounded text-[10px] font-bold border w-fit flex items-center gap-1 ${
                                            cliente.tipo === 'PJ' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                                            cliente.tipo === 'PF' ? 'bg-green-100 text-green-800 border-green-200' :
                                            'bg-purple-100 text-purple-800 border-purple-200'
                                        }`}>
                                            {cliente.tipo === 'EXT' ? <Globe size={10}/> : cliente.tipo === 'PJ' ? <Building2 size={10}/> : <User size={10}/>}
                                            {cliente.tipo}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                                        {cliente.cidade ? `${cliente.cidade}/${cliente.uf}` : <span className="text-slate-300 italic">--</span>}
                                    </td>
                                    <td className="px-6 py-4 text-right flex justify-end gap-2">
                                        <button onClick={() => abrirEdicao(cliente)} className="text-blue-600 hover:bg-blue-50 p-2 rounded"><Edit size={18}/></button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
      </div>
    </div>
  );
}
