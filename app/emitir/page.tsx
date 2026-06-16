"use client";

import { useState, useEffect, Suspense } from "react";
import { CheckCircle, ArrowRight, ArrowLeft, Building2, Calculator, FileCheck, Briefcase, Loader2, Home, UserPlus, AlertTriangle, Send, FileSearch, FileCode2, BadgeCheck, ServerCog, FileClock, Trash2, HelpCircle, Info } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDialog } from "@/app/contexts/DialogContext";
import Link from "next/link";

interface CnaeDB {
  id: string;
  codigo: string;
  descricao: string;
  principal: boolean;
  codigoNbs?: string;
  temRetencaoInss?: boolean; 
  retemCrsf?: boolean;
  aliquotaCrsf?: number;
  retemIr?: boolean;
  aliquotaIr?: number;
  aliquotaIss?: number;
}

interface ClienteDB {
  id: string;
  nome: string;
  documento: string;
  email?: string;
  tipo: string;  
  moeda?: string;
}

interface NotaRascunho {
  id: string;
  motivo: string;
  motivoTipo: string;
  createdAt: string;
  payload: {
    nfData: any;
    retencoes: any;
  };
}

function EmitirNotaContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); 
  const retryId = searchParams.get('retry');
  const dialog = useDialog(); 

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingRetry, setLoadingRetry] = useState(false);
  const [rascunhos, setRascunhos] = useState<NotaRascunho[]>([]);
  const [loadingRascunhos, setLoadingRascunhos] = useState(false);
  const [activeRascunhoId, setActiveRascunhoId] = useState<string | null>(null);
  
  const [progressStatus, setProgressStatus] = useState("Iniciando...");
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressDetail, setProgressDetail] = useState("Conectando com o Portal Nacional.");
  
  const [clientes, setClientes] = useState<ClienteDB[]>([]);
  const [meusCnaes, setMeusCnaes] = useState<CnaeDB[]>([]);
  
  const [perfilEmpresa, setPerfilEmpresa] = useState<any>(null); 
  const [wasAboveThreshold, setWasAboveThreshold] = useState(false);

  const [nfData, setNfData] = useState({
    clienteId: "", 
    clienteNome: "", 
    servicoDescricao: "", 
    valor: "",
    valorMoedaEstrangeira: "", 
    codigoCnae: "", 
    aliquota: "", 
    issRetido: false,
    inssRetido: false,
    dataCompetencia: new Date().toLocaleDateString('en-CA'),
    numeroDPS: "",
    serieDPS: "",
  });

  // Estado das retenções agora guarda os números formatados como string (sem a trava do checkbox)
  const [retencoes, setRetencoes] = useState({
      inss: { aliquota: '0.00', valor: '0.00' },
      pis: { aliquota: '0.00', valor: '0.00' },
      cofins: { aliquota: '0.00', valor: '0.00' },
      csll: { aliquota: '0.00', valor: '0.00' },
      ir: { aliquota: '0.00', valor: '0.00' }
  });

  const getAuthHeaders = () => {
      const userId = localStorage.getItem('userId');
      const contextId = localStorage.getItem('empresaContextId');
      return {
          'Content-Type': 'application/json',
          'x-user-id': userId || '',
          'x-empresa-id': contextId || ''
      };
  };

  const carregarRascunhos = async () => {
      const userId = localStorage.getItem('userId');
      if (!userId) return;

      setLoadingRascunhos(true);
      try {
          const res = await fetch('/api/notas/rascunhos', { headers: getAuthHeaders() });
          const data = await res.json();
          setRascunhos(Array.isArray(data.data) ? data.data : []);
      } catch {
          setRascunhos([]);
      } finally {
          setLoadingRascunhos(false);
      }
  };

  const montarPayloadRascunho = () => ({
      nfData,
      retencoes,
      savedStep: 3,
  });

  const salvarRascunhoFalha = async (respostaErro: any) => {
      try {
          const res = await fetch('/api/notas/rascunhos', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({
                  motivo: respostaErro.userAction || respostaErro.error || 'Falha corrigivel na emissao.',
                  motivoTipo: respostaErro.draftReasonType || 'RETORNO_CORRIGIVEL',
                  payload: montarPayloadRascunho(),
              })
          });
          if (!res.ok) return false;
          await carregarRascunhos();
          return true;
      } catch {
          return false;
      }
  };

  const excluirRascunho = async (id: string, silencioso = false) => {
      try {
          const res = await fetch(`/api/notas/rascunhos?id=${id}`, {
              method: 'DELETE',
              headers: getAuthHeaders(),
          });
          if (!res.ok && !silencioso) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || 'Nao foi possivel excluir o rascunho.');
          }
          setRascunhos((atuais) => atuais.filter((item) => item.id !== id));
          if (activeRascunhoId === id) setActiveRascunhoId(null);
      } catch (error: any) {
          if (!silencioso) dialog.showAlert({ type: 'danger', title: 'Falha', description: error.message });
      }
  };

  const retomarRascunho = (rascunho: NotaRascunho) => {
      if (!rascunho.payload?.nfData) return;
      setNfData((prev) => ({ ...prev, ...rascunho.payload.nfData }));
      if (rascunho.payload.retencoes) setRetencoes(rascunho.payload.retencoes);
      setActiveRascunhoId(rascunho.id);
      setStep(3);
  };

  // === TRATAMENTO DE ERROS ===
  const tratarErroEmissao = async (respostaErro: any) => {
      if (respostaErro.userAction) {
          const actionText = respostaErro.userAction;
          const rascunhoSalvo = respostaErro.draftEligible ? await salvarRascunhoFalha(respostaErro) : false;
          const hintRascunho = rascunhoSalvo ? '\n\nSalvei um rascunho para voce retomar pela lateral desta tela.' : '';

          if (rascunhoSalvo) {
              if (respostaErro.draftReasonType === 'INSCRICAO_MUNICIPAL') {
                  const irConfig = await dialog.showConfirm({ type: 'danger', title: 'Inscricao Municipal (I.M)', description: `${actionText}${hintRascunho}`, confirmText: 'Atualizar I.M Agora', cancelText: 'Ficar na revisao' });
                  if (irConfig) router.push('/configuracoes');
                  else setStep(3);
                  return;
              }
              await dialog.showAlert({ type: 'warning', title: 'Rascunho salvo', description: `${actionText}${hintRascunho}` });
              setStep(3);
              return;
          }

          if (actionText.includes("Certificado Digital") || actionText.includes("Cadastro incompleto")) {
              const irConfig = await dialog.showConfirm({ type: 'danger', title: 'Atenção ao Cadastro', description: actionText, confirmText: 'Ir para Configurações', cancelText: 'Mais tarde' });
              if (irConfig) router.push('/configuracoes');
              return;
          }

          if (actionText.includes("Inscrição Municipal")) {
              const irConfig = await dialog.showConfirm({ type: 'danger', title: 'Inscrição Municipal (I.M)', description: actionText, confirmText: 'Atualizar I.M Agora', cancelText: 'Mais tarde' });
              if (irConfig) router.push('/configuracoes');
              return;
          }

          if (actionText.includes("número de DPS")) {
               await dialog.showAlert({ type: 'warning', title: 'Numeração Duplicada', description: actionText });
              router.push('/cliente/dashboard');
              return;
          }

          if (actionText.toLowerCase().includes('portal nacional indisponivel') || actionText.toLowerCase().includes('portal nacional indispon')) {
              await dialog.showAlert({ type: 'warning', title: 'Portal instável', description: actionText });
              router.push('/cliente/dashboard');
              return;
          }

          await dialog.showAlert({ type: 'warning', title: 'Atenção', description: actionText });
          router.push('/cliente/dashboard');
          return;
      }

      let msgTecnica = "";
      if (Array.isArray(respostaErro.details)) {
          msgTecnica = respostaErro.details.map((d: any) => d.mensagem || JSON.stringify(d)).join('. ');
      } else if (typeof respostaErro.details === 'string') {
          msgTecnica = respostaErro.details;
      } else {
          msgTecnica = respostaErro.error || "Erro desconhecido ao comunicar com a Prefeitura.";
      }

      await dialog.showAlert({ type: 'danger', title: 'Falha na Emissão', description: `Houve uma rejeição na Prefeitura: ${msgTecnica}` });
      router.push('/cliente/dashboard');
  };

  // === FORMATADORES DE MOEDA E PORCENTAGEM ===
  const formatarMoedaInput = (valor: string | number) => {
    const v = Number(valor) || 0;
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 }).format(v);
  };

  const formatarMoedaEstrangeiraInput = (valor: string | number, moeda: string = 'USD') => {
    const v = Number(valor) || 0;
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: moeda, minimumFractionDigits: 2 }).format(v);
    } catch (e) {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);
    }
  };

  const formatarPorcentagem = (inputValue: string) => {
      const apenasNumeros = inputValue.replace(/\D/g, "");
      if (!apenasNumeros) return "0.00";
      return (parseInt(apenasNumeros) / 100).toFixed(2);
  };

  const handleValorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const apenasNumeros = e.target.value.replace(/\D/g, "");
    if (!apenasNumeros) { setNfData({ ...nfData, valor: "0" }); return; }
    const valorNumerico = parseInt(apenasNumeros) / 100;
    setNfData({ ...nfData, valor: String(valorNumerico) });
  };

  const handleValorEstrangeiroChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const apenasNumeros = e.target.value.replace(/\D/g, "");
    if (!apenasNumeros) { setNfData({ ...nfData, valorMoedaEstrangeira: "0" }); return; }
    const valorNumerico = parseInt(apenasNumeros) / 100;
    setNfData({ ...nfData, valorMoedaEstrangeira: String(valorNumerico) });
  };

  // --- MÁSCARAS E LIMITES (DA DIREITA PARA ESQUERDA) ---
  const formatarPorcentagemDirEsq = (valor: string) => {
      const numeros = valor.replace(/\D/g, '');
      if (!numeros) return '0.00';
      return (parseInt(numeros, 10) / 100).toFixed(2);
  };

  const handleBlurLimites = (tipo: 'iss' | 'inss') => {
      if (tipo === 'iss') {
          let val = parseFloat(nfData.aliquota || '0');
          if (val < 2.00) val = 2.00;
          if (val > 5.00) val = 5.00;
          setNfData(prev => ({ ...prev, aliquota: val.toFixed(2) }));
      } else if (tipo === 'inss') {
          let val = parseFloat(retencoes.inss.aliquota || '0');
          if (val < 3.50) val = 3.50;
          if (val > 11.00) val = 11.00;
          handleAliquotaRetencaoChange('inss', val.toFixed(2));
      }
  };

  // === HANDLERS LIVRES PARA O USUÁRIO EDITAR RETENÇÕES ===
  const handleAliquotaRetencaoChange = (imposto: string, inputValue: string) => {
      const novaAliquota = formatarPorcentagem(inputValue);
      setRetencoes(prev => {
          const valorNota = parseFloat(nfData.valor) || 0;
          return {
              ...prev,
              [imposto]: { 
                  aliquota: novaAliquota, 
                  valor: (valorNota * (parseFloat(novaAliquota) / 100)).toFixed(2) 
              }
          };
      });
  };

  const handleValorRetencaoChange = (imposto: string, inputValue: string) => {
      const apenasNumeros = inputValue.replace(/\D/g, "");
      const novoValorStr = apenasNumeros ? (parseInt(apenasNumeros) / 100).toFixed(2) : "0.00";
      setRetencoes(prev => ({
          ...prev,
          [imposto]: { 
              ...prev[imposto as keyof typeof prev], 
              valor: novoValorStr 
          }
      }));
  };

  // === INTELIGÊNCIA CEREBRAL (Cálculo Automático) ===
  
  // 1. Dispara ao selecionar o Cliente ou o CNAE (Define o Padrão Inicial)
  useEffect(() => {
      const cliente = clientes.find(c => c.id === nfData.clienteId);
      const cnae = meusCnaes.find(c => c.codigo === nfData.codigoCnae);
      const valorFloat = parseFloat(nfData.valor) || 0;

      // Se for PF ou Exterior, esvazia tudo
      if (!cliente || !cnae || cliente.tipo === 'PF' || cliente.tipo === 'EXT') {
          setRetencoes({
              inss: { aliquota: '0.00', valor: '0.00' },
              pis: { aliquota: '0.00', valor: '0.00' },
              cofins: { aliquota: '0.00', valor: '0.00' },
              csll: { aliquota: '0.00', valor: '0.00' },
              ir: { aliquota: '0.00', valor: '0.00' }
          });
          if (cliente?.tipo === 'PF' || cliente?.tipo === 'EXT') {
              setNfData(prev => ({ ...prev, issRetido: false, inssRetido: false }));
          }
          return;
      }

      const isLucro = ['LUCRO_PRESUMIDO', 'LUCRO_REAL'].includes(perfilEmpresa?.regimeTributario);
      const next = {
          inss: { aliquota: '0.00', valor: '0.00' },
          pis: { aliquota: '0.00', valor: '0.00' },
          cofins: { aliquota: '0.00', valor: '0.00' },
          csll: { aliquota: '0.00', valor: '0.00' },
          ir: { aliquota: '0.00', valor: '0.00' }
      };

      // REGRA DO INSS (Para PJ que não seja MEI)
      if (cnae.temRetencaoInss && perfilEmpresa?.regimeTributario !== 'MEI') {
          setNfData(prev => ({ ...prev, inssRetido: false })); // INICIA DESMARCADO
          next.inss.aliquota = '11.00';
      } else {
          setNfData(prev => ({ ...prev, inssRetido: false }));
      }

      // Se for PJ e Lucro, monta a sugestão base de Federais
      if (cliente.tipo === 'PJ' && isLucro) {
          const isAbove = valorFloat > 215.05;

          if (cnae.retemIr) next.ir.aliquota = cnae.aliquotaIr ? Number(cnae.aliquotaIr).toFixed(2) : '1.50';

          if (cnae.retemCrsf && isAbove) {
              next.pis.aliquota = cnae.aliquotaCrsf ? (cnae.aliquotaCrsf * (0.65/4.65)).toFixed(2) : '0.65';
              next.cofins.aliquota = cnae.aliquotaCrsf ? (cnae.aliquotaCrsf * (3.00/4.65)).toFixed(2) : '3.00';
              next.csll.aliquota = cnae.aliquotaCrsf ? (cnae.aliquotaCrsf * (1.00/4.65)).toFixed(2) : '1.00';
          }
          setWasAboveThreshold(isAbove);
      }

      // Calcula os valores em R$ com as alíquotas definidas
      ['inss', 'pis', 'cofins', 'csll', 'ir'].forEach(key => {
          const k = key as keyof typeof next;
          next[k].valor = (valorFloat * (parseFloat(next[k].aliquota) / 100)).toFixed(2);
      });

      setRetencoes(next);
      
  }, [nfData.codigoCnae, nfData.clienteId, perfilEmpresa?.regimeTributario]);

  // 2. Dispara quando o Valor Bruto (R$) muda ou a trava dos 215 altera
  useEffect(() => {
      const cliente = clientes.find(c => c.id === nfData.clienteId);
      const cnae = meusCnaes.find(c => c.codigo === nfData.codigoCnae);
      const valorFloat = parseFloat(nfData.valor) || 0;
      const isAbove = valorFloat > 215.05;

      if (!cliente || !cnae || cliente.tipo === 'PF' || cliente.tipo === 'EXT') return;
      const isLucro = ['LUCRO_PRESUMIDO', 'LUCRO_REAL'].includes(perfilEmpresa?.regimeTributario);

      if (isLucro && cnae.retemCrsf && isAbove !== wasAboveThreshold) {
          setWasAboveThreshold(isAbove);
          setRetencoes(prev => {
              const next = JSON.parse(JSON.stringify(prev)); // Cópia segura
              if (isAbove) {
                  next.pis.aliquota = cnae.aliquotaCrsf ? (cnae.aliquotaCrsf * (0.65/4.65)).toFixed(2) : '0.65';
                  next.cofins.aliquota = cnae.aliquotaCrsf ? (cnae.aliquotaCrsf * (3.00/4.65)).toFixed(2) : '3.00';
                  next.csll.aliquota = cnae.aliquotaCrsf ? (cnae.aliquotaCrsf * (1.00/4.65)).toFixed(2) : '1.00';
              } else {
                  next.pis.aliquota = '0.00';
                  next.cofins.aliquota = '0.00';
                  next.csll.aliquota = '0.00';
              }
              // Calcula valores com a nova decisão
              ['inss', 'pis', 'cofins', 'csll', 'ir'].forEach(key => {
                  const k = key as keyof typeof next;
                  next[k].valor = (valorFloat * (parseFloat(next[k].aliquota) / 100)).toFixed(2);
              });
              return next;
          });
      } else {
          // Se não cruzou a linha, APENAS ATUALIZA A MATEMÁTICA com base na digitação
          setRetencoes(prev => {
              const next = JSON.parse(JSON.stringify(prev));
              ['inss', 'pis', 'cofins', 'csll', 'ir'].forEach(key => {
                  const k = key as keyof typeof next;
                  next[k].valor = (valorFloat * (parseFloat(next[k].aliquota) / 100)).toFixed(2);
              });
              return next;
          });
      }
  }, [nfData.valor, wasAboveThreshold]);

  // === CARREGAMENTO INICIAL ===
  useEffect(() => {
    const userId = localStorage.getItem('userId');
    const contextId = localStorage.getItem('empresaContextId');
    if(!userId) { router.push('/login'); return; }
    carregarRascunhos();

    fetch('/api/perfil', { headers: { 'x-user-id': userId, 'x-empresa-id': contextId || '' } })
      .then(res => res.json())
      .then(data => {
         if(data && !data.error) {
             setPerfilEmpresa(data);
             if (data.atividades && Array.isArray(data.atividades)) {
                 setMeusCnaes(data.atividades);
                 setNfData(prev => {
                     const updates: any = {};
                     let cnaePrincipalObj = null;

                     if (!retryId && !prev.codigoCnae && data.atividades.length > 0) {
                         cnaePrincipalObj = data.atividades.find((c: CnaeDB) => c.principal) || data.atividades[0];
                         updates.codigoCnae = cnaePrincipalObj.codigo;
                     } else {
                         cnaePrincipalObj = data.atividades.find((c: CnaeDB) => c.codigo === prev.codigoCnae);
                     }

                     let aliquotaSugerida = '0.00';
                     if (data.regimeTributario !== 'MEI') {
                         if (cnaePrincipalObj && cnaePrincipalObj.aliquotaIss !== null && cnaePrincipalObj.aliquotaIss !== undefined) {
                             aliquotaSugerida = Number(cnaePrincipalObj.aliquotaIss).toFixed(2);
                         } else if (data.aliquotaPadrao !== null && data.aliquotaPadrao !== undefined) {
                             aliquotaSugerida = Number(data.aliquotaPadrao).toFixed(2);
                         } else {
                             aliquotaSugerida = '3.00'; 
                         }
                     }

                     updates.aliquota = aliquotaSugerida;
                     updates.issRetido = data.issRetidoPadrao || false;
                     return { ...prev, ...updates };
                 });
             }
         }
      }).catch(console.error);

    // === CORREÇÃO DA LISTA DE CLIENTES (PAGINAÇÃO) ===
    fetch('/api/clientes', { headers: { 'x-user-id': userId, 'x-empresa-id': contextId || '' } })
    .then(res => res.json())
      .then(data => { 
        if (data && data.data && Array.isArray(data.data)) {
            setClientes(data.data);
        } else if (Array.isArray(data)) {
            setClientes(data);
        } else {
            setClientes([]);
        }
      }).catch(() => setClientes([]));

    if (retryId) {
        setLoadingRetry(true);
        fetch(`/api/vendas/${retryId}`, { 
            headers: {
                'x-user-id': userId,
                'x-empresa-id': contextId || ''
            }
        })
        .then(async res => {
            if (res.ok) {
                const venda = await res.json();
                
                // Atraso de 800ms garante que a lista de clientes e perfil já carregaram antes de montar a tela
                setTimeout(() => {
                    const nota = venda.notas?.[0] || {};
                    // Tenta encontrar o CNAE em todos os lugares possíveis onde o banco pode ter guardado
                    const cnaeParaUsar = venda.cnaeRecuperado || nota.cnae || nota.codigoCnae || venda.codigoCnae || "";
                    
                    let dataFormatada = undefined;
                    if (nota.dataCompetencia || venda.dataCompetencia) {
                        const d = new Date(nota.dataCompetencia || venda.dataCompetencia);
                        if (!isNaN(d.getTime())) {
                            dataFormatada = d.toISOString().split('T')[0];
                        }
                    }

                    setNfData(prev => ({
                        ...prev,
                        clienteId: venda.clienteId, 
                        clienteNome: venda.cliente?.razaoSocial || venda.cliente?.nome || "Cliente", 
                        valor: String(venda.valor),
                        valorMoedaEstrangeira: venda.valorMoedaEstrangeira !== null && venda.valorMoedaEstrangeira !== undefined ? String(venda.valorMoedaEstrangeira) : "",
                        servicoDescricao: venda.descricao || nota.servicoDescricao || "",
                        
                        // Restauração blindada do CNAE e Impostos
                        codigoCnae: cnaeParaUsar || "",
                        aliquota: nota.aliquota || venda.aliquota || prev.aliquota,
                        issRetido: nota.issRetido !== undefined ? nota.issRetido : (venda.issRetido !== undefined ? venda.issRetido : prev.issRetido),
                        inssRetido: nota.inssRetido !== undefined ? nota.inssRetido : prev.inssRetido,
                        dataCompetencia: dataFormatada || prev.dataCompetencia,
                        numeroDPS: venda.numeroDPS ? String(venda.numeroDPS) : prev.numeroDPS,
                        serieDPS: venda.serieDPS ? String(venda.serieDPS) : prev.serieDPS,
                    }));
                    
                    setStep(3); // Pula para o passo 3 só DEPOIS de preencher tudo
                    setLoadingRetry(false); // Remove a tela de carregamento
                }, 800); 
                
            } else {
                const erro = await res.json();
                dialog.showAlert({ type: 'danger', description: erro.error || "Erro ao recuperar dados da venda." });
                setLoadingRetry(false);
            }
        })
        .catch(() => {
            dialog.showAlert({ type: 'danger', description: "Erro de conexão ao recuperar dados." });
            setLoadingRetry(false);
        });
    }
  }, [router, retryId]);

  const handleNext = async () => {
    if (step === 1) {
        if (!nfData.clienteId) return dialog.showAlert("Selecione um cliente para continuar.");
        setStep(step + 1);
    } else { 
        setStep(step + 1); 
    }
  };

  const handleBack = () => setStep(step - 1);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const aguardarConclusaoDaNota = async (vendaId: string, headers: HeadersInit) => {
      const tentativas = 60;

      for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
          setProgressPercent(Math.min(95, 58 + tentativa));

          if (tentativa < 4) {
              setProgressStatus("Nota autorizada. Sincronizando retorno oficial...");
              setProgressDetail("Estamos buscando o XML de distribuição e preparando os arquivos fiscais.");
          } else if (tentativa < 12) {
              setProgressStatus("Baixando XML e PDF oficiais...");
              setProgressDetail("Aguarde só mais um pouco, o sistema está finalizando os documentos da nota.");
          } else {
              setProgressStatus("Conferindo disponibilidade da nota...");
              setProgressDetail("A nota já foi enviada ao processamento final. Mantemos esta tela até tudo ficar pronto.");
          }

          const vendaRes = await fetch(`/api/vendas/${vendaId}`, { headers });
          const venda = await vendaRes.json();

          if (!vendaRes.ok) {
              throw new Error(venda.error || 'Não foi possível acompanhar a emissão.');
          }

          const nota = venda.notas?.[0];
          if (venda.status === 'ERRO_EMISSAO') {
              throw new Error(venda.motivoErro || 'A emissão falhou durante o processamento final.');
          }

          if (venda.status === 'CONCLUIDA' && nota?.status === 'AUTORIZADA') {
              setProgressPercent(100);
              setProgressStatus("Nota disponível e autorizada.");
              setProgressDetail("Tudo pronto. Os documentos fiscais já foram sincronizados.");
              return venda;
          }

          await sleep(2000);
      }

      throw new Error('A nota foi autorizada, mas os arquivos ainda não ficaram disponíveis. Verifique novamente em instantes.');
  };

  const aguardarJobEmissao = async (jobId: string, headers: HeadersInit) => {
      const tentativas = 120;

      for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
          const jobRes = await fetch(`/api/notas/jobs/${jobId}`, { headers });
          const job = await jobRes.json();

          if (!jobRes.ok) {
              throw new Error(job.error || 'Nao foi possivel acompanhar a fila de emissao.');
          }

          if (job.status === 'PENDENTE') {
              setProgressPercent(Math.min(45, 25 + tentativa));
              setProgressStatus("Nota na fila de emissao...");
              setProgressDetail(job.statusMessage || "Aguardando uma janela segura para transmitir esta empresa.");
          } else if (job.status === 'PROCESSANDO') {
              setProgressPercent(Math.min(62, 42 + tentativa));
              setProgressStatus("Transmitindo para o Portal Nacional...");
              setProgressDetail(job.statusMessage || "A DPS esta sendo assinada e enviada ao ambiente nacional.");
          } else if (job.status === 'ERRO_TEMPORARIO') {
              setProgressPercent(55);
              setProgressStatus("Portal Nacional instavel...");
              setProgressDetail(job.statusMessage || "Vamos tentar novamente automaticamente sem trocar a DPS.");
          } else if (job.status === 'AUTORIZADA') {
              setProgressPercent(64);
              setProgressStatus(job.isHomologation ? "Validacao concluida." : "Autorizacao recebida.");
              setProgressDetail(job.statusMessage || "A nota foi autorizada e agora sera sincronizada.");
              return job;
          } else if (job.status === 'ERRO_FINAL') {
              const erro: any = new Error(job.userAction || job.error || job.statusMessage || 'A emissao falhou.');
              erro.respostaEmissao = job;
              throw erro;
          }

          await sleep(2000);
      }

      throw new Error('A emissao entrou na fila, mas ainda nao concluiu. Verifique suas notas novamente em instantes.');
  };

  const handleEmitir = async () => {
    if (!nfData.codigoCnae) { dialog.showAlert("Selecione uma Atividade (CNAE)."); return; }
    
    setLoading(true);
    setProgressPercent(10);
    setProgressStatus("Preparando envio...");
    setProgressDetail("Validando os dados da nota antes da transmissão.");

    const userId = localStorage.getItem('userId');
    const contextId = localStorage.getItem('empresaContextId'); 
    
    try {
      const payloadRetencoes = {
          inss: nfData.inssRetido && parseFloat(retencoes.inss.valor) > 0 ? { retido: true, valor: parseFloat(retencoes.inss.valor), aliquota: parseFloat(retencoes.inss.aliquota) } : null,
          pis: parseFloat(retencoes.pis.valor) > 0 ? { retido: true, valor: parseFloat(retencoes.pis.valor), aliquota: parseFloat(retencoes.pis.aliquota) } : null,
          cofins: parseFloat(retencoes.cofins.valor) > 0 ? { retido: true, valor: parseFloat(retencoes.cofins.valor), aliquota: parseFloat(retencoes.cofins.aliquota) } : null,
          ir: parseFloat(retencoes.ir.valor) > 0 ? { retido: true, valor: parseFloat(retencoes.ir.valor), aliquota: parseFloat(retencoes.ir.aliquota) } : null,
          csll: parseFloat(retencoes.csll.valor) > 0 ? { retido: true, valor: parseFloat(retencoes.csll.valor), aliquota: parseFloat(retencoes.csll.aliquota) } : null,
      };

      setProgressPercent(40);
      setProgressStatus("Transmitindo para o Portal Nacional...");
      setProgressDetail("Enviando a DPS assinada e aguardando autorização.");

      const idempotencyKey = retryId
        ? `retry-${retryId}-${Date.now()}`
        : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

      const res = await fetch('/api/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId || '', 'x-empresa-id': contextId || '', 'x-idempotency-key': idempotencyKey },
        body: JSON.stringify({
          vendaId: retryId || null, 
          clienteId: nfData.clienteId,
          valor: nfData.valor,
          valorMoedaEstrangeira: nfData.valorMoedaEstrangeira,
          descricao: nfData.servicoDescricao,
          codigoCnae: nfData.codigoCnae,
          aliquota: nfData.aliquota,
          issRetido: nfData.issRetido,
          dataCompetencia: nfData.dataCompetencia,
          numeroDPS: nfData.numeroDPS || undefined,
          serieDPS: nfData.serieDPS || undefined,
          retencoes: payloadRetencoes
        })
      });

      const resposta = await res.json();
      
      if (res.ok) {
        if (activeRascunhoId) await excluirRascunho(activeRascunhoId, true);
        if (resposta.emissaoJobId) {
            const jobFinal = await aguardarJobEmissao(resposta.emissaoJobId, {
                'x-user-id': userId || '',
                'x-empresa-id': contextId || ''
            });

            if (jobFinal.isHomologation) {
                setProgressPercent(100);
                setProgressStatus("Validacao concluida.");
                setProgressDetail("A configuracao foi aceita no ambiente de homologacao.");
                const irConfig = await dialog.showConfirm({ type: 'success', title: 'Tudo certo em Homologacao!', description: 'As configuracoes da sua nota estao perfeitas. Mude para PRODUCAO nas configuracoes.', confirmText: 'Mudar para Producao', cancelText: 'Voltar ao Inicio' });
                if (irConfig) router.push('/configuracoes');
                else router.push('/cliente/dashboard');
                return;
            }

            if (!jobFinal.vendaId) {
                throw new Error('Nota autorizada, mas a venda nao foi localizada para sincronizacao.');
            }

            setProgressPercent(68);
            setProgressStatus("Autorizacao recebida.");
            setProgressDetail("Agora vamos finalizar a sincronizacao antes de liberar a tela.");
            await aguardarConclusaoDaNota(jobFinal.vendaId, {
                'x-user-id': userId || '',
                'x-empresa-id': contextId || ''
            });
            await sleep(500);
            await dialog.showAlert({ type: 'success', title: 'Sucesso Total!', description: 'Nota emitida, autorizada e disponivel para download.' });
            router.push('/cliente/dashboard');
        } else if (resposta.isHomologation) {
            setProgressPercent(100);
            setProgressStatus("Validação concluída.");
            setProgressDetail("A configuração foi aceita no ambiente de homologação.");
            const irConfig = await dialog.showConfirm({ type: 'success', title: 'Tudo certo em Homologação!', description: 'As configurações da sua nota estão perfeitas. Mude para PRODUÇÃO nas configurações.', confirmText: 'Mudar para Produção', cancelText: 'Voltar ao Início' });
            if (irConfig) router.push('/configuracoes');
            else router.push('/cliente/dashboard');
        } else {
            setProgressPercent(58);
            setProgressStatus("Autorização recebida.");
            setProgressDetail("Agora vamos finalizar a sincronização antes de liberar a tela.");
            await aguardarConclusaoDaNota(resposta.nota.vendaId, {
                'x-user-id': userId || '',
                'x-empresa-id': contextId || ''
            });
            await sleep(500);
            await dialog.showAlert({ type: 'success', title: 'Sucesso Total!', description: 'Nota emitida, autorizada e disponível para download.' });
            router.push('/cliente/dashboard');
        }
      } else {
        await tratarErroEmissao(resposta);
      }
    } catch (error: any) { 
        if (error?.respostaEmissao) {
            await tratarErroEmissao(error.respostaEmissao);
            return;
        }
        await dialog.showAlert({ type: 'danger', title: 'Processamento interrompido', description: error?.message || "Erro de conexão. Verifique sua internet." }); 
        router.push('/cliente/dashboard');
    } 
    finally { setLoading(false); }
  };

  const clienteSel = clientes.find(c => c.id === nfData.clienteId);
  const isExterior = clienteSel?.tipo === 'EXT';
  const isPF = clienteSel?.tipo === 'PF';
  const isPJ = clienteSel?.tipo === 'PJ';
  
  const mostraRetencoesFederais = isPJ && !isPF && !isExterior && ['LUCRO_PRESUMIDO', 'LUCRO_REAL'].includes(perfilEmpresa?.regimeTributario);
  
  const cnaeSelecionadoObj = meusCnaes.find(c => c.codigo === nfData.codigoCnae);
  const cnaeRecuperadoForaDaLista = !!nfData.codigoCnae && !cnaeSelecionadoObj;

  const valorNumerico = parseFloat(nfData.valor) || 0;
  const valorEstrangeiroNum = parseFloat(nfData.valorMoedaEstrangeira) || 0;
  const isStep2Invalid = step === 2 && (valorNumerico <= 0 || !nfData.servicoDescricao.trim() || (isExterior && valorEstrangeiroNum <= 0));

  const cnaeDescricaoCurta = cnaeSelecionadoObj?.descricao ? (cnaeSelecionadoObj.descricao.length > 20 ? cnaeSelecionadoObj.descricao.substring(0, 20) + '...' : cnaeSelecionadoObj.descricao) : '';

  // === CÁLCULOS FINAIS ===
  const valorIss = nfData.issRetido ? (valorNumerico * (parseFloat(nfData.aliquota || "0") / 100)) : 0;
  const valorInss = nfData.inssRetido ? (valorNumerico * (parseFloat(retencoes.inss.aliquota || "0") / 100)) : 0;
  
  const totalRetidoFederais = ['pis', 'cofins', 'csll', 'ir'].reduce((acc, curr) => acc + parseFloat(retencoes[curr as keyof typeof retencoes].valor || "0"), 0);
  const totalDeducoes = valorIss + valorInss + totalRetidoFederais;
  const valorLiquido = valorNumerico - totalDeducoes;

  if(loadingRetry) return <div className="h-screen flex items-center justify-center text-blue-600 font-bold"><Loader2 className="animate-spin mr-2"/> Recuperando dados...</div>;

  // --- VALIDAÇÃO DATA DE COMPETÊNCIA ---
  const maxDateStr = new Date().toLocaleDateString('en-CA');
  const minDateObj = new Date();
  minDateObj.setDate(minDateObj.getDate() - 30);
  const minDateStr = minDateObj.toLocaleDateString('en-CA');
  
  const isDataCompetenciaInvalida = nfData.dataCompetencia > maxDateStr || nfData.dataCompetencia < minDateStr;
  const etapasEmissao = [
      { label: 'Preparação', icon: FileCheck, doneAt: 20 },
      { label: 'Transmissão', icon: Send, doneAt: 50 },
      { label: 'Autorização', icon: BadgeCheck, doneAt: 60 },
      { label: 'Sincronização', icon: FileSearch, doneAt: 96 },
      { label: 'Disponível', icon: FileCode2, doneAt: 100 },
  ];

  return (
    <div className="max-w-7xl mx-auto py-10 px-4 relative">
      {loading && (
        <div className="fixed inset-0 z-[9999] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl border border-blue-100 overflow-hidden">
            <div className="relative bg-slate-950 text-white p-8 overflow-hidden">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:32px_32px]" />
              <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-blue-500/30 blur-3xl" />
              <div className="absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl" />
              <div className="relative flex items-center gap-4">
                <div className="h-14 w-14 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-950/30">
                  <ServerCog className="animate-pulse" size={28} />
                </div>
                <div>
                  <p className="text-sm font-bold text-blue-200 uppercase tracking-wider">Processando NFS-e</p>
                  <h3 className="text-2xl font-black mt-1">{progressStatus}</h3>
                </div>
              </div>
            </div>

            <div className="p-7">
              <div className="flex justify-between text-xs font-black text-blue-700 mb-2">
                <span>{progressDetail}</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full transition-all duration-700 ease-out" style={{ width: `${progressPercent}%` }} />
              </div>

              <div className="grid grid-cols-5 gap-2 mt-7">
                {etapasEmissao.map((etapa) => {
                  const Icon = etapa.icon;
                  const concluida = progressPercent >= etapa.doneAt;
                  const ativa = !concluida && progressPercent >= etapa.doneAt - 20;

                  return (
                    <div key={etapa.label} className="flex flex-col items-center gap-2 text-center">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center border transition ${
                        concluida ? 'bg-green-50 border-green-200 text-green-700' :
                        ativa ? 'bg-blue-50 border-blue-200 text-blue-700' :
                        'bg-slate-50 border-slate-200 text-slate-400'
                      }`}>
                        {ativa ? <Loader2 className="animate-spin" size={18} /> : <Icon size={18} />}
                      </div>
                      <span className={`text-[11px] font-bold leading-tight ${concluida ? 'text-green-700' : ativa ? 'text-blue-700' : 'text-slate-400'}`}>{etapa.label}</span>
                    </div>
                  );
                })}
              </div>

              <p className="mt-6 text-center text-xs text-slate-500">
                Pode levar alguns segundos. Vamos manter esta tela até a nota ficar autorizada e disponível no histórico.
              </p>
            </div>
          </div>
        </div>
      )}
      <div className="mb-6">
        <button onClick={() => router.push('/cliente/dashboard')} className="flex items-center gap-2 text-slate-500 hover:text-blue-600 transition font-medium text-sm group">
            <div className="p-2 bg-white rounded-full border border-slate-200 group-hover:border-blue-200 group-hover:bg-blue-50 transition"><Home size={18} /></div> Voltar ao Início
        </button>
      </div>

      <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-bold text-slate-800">{retryId ? `Corrigir Venda` : 'Emitir Nova NFS-e'}</h2>
          {retryId && <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold">MODO CORREÇÃO</span>}
      </div>

      <div className="flex justify-between mb-8 relative">
        <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-200 -z-10 transform -translate-y-1/2"></div>
        {[{ id: 1, label: "Tomador", icon: Building2 }, { id: 2, label: "Serviço", icon: Calculator }, { id: 3, label: "Revisão", icon: FileCheck }].map((s) => (
          <div key={s.id} className={`flex flex-col items-center bg-slate-100 px-4 py-2 rounded-lg ${step >= s.id ? "text-blue-600" : "text-slate-400"}`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${step >= s.id ? "bg-blue-600 text-white" : "bg-slate-300 text-slate-500"}`}><s.icon size={20} /></div>
            <span className="text-sm font-medium">{s.label}</span>
          </div>
        ))}
      </div>

      <GuiaEmissao step={step} ambiente={perfilEmpresa?.ambiente} />

      {step === 1 && (
        <aside className="mb-6 bg-white border border-slate-200 rounded-xl shadow-sm p-5 lg:fixed lg:left-6 lg:top-44 lg:w-[290px] lg:max-h-[calc(100vh-190px)] lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Rascunhos</p>
              <h3 className="text-lg font-black text-slate-900">Notas pendentes</h3>
            </div>
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <FileClock size={20} />
            </div>
          </div>

          {loadingRascunhos ? (
            <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
              <Loader2 className="animate-spin" size={16} /> Carregando...
            </div>
          ) : rascunhos.length === 0 ? (
            <p className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-sm text-slate-500">
              Rascunhos aparecem aqui quando uma emissao falha por algo corrigivel.
            </p>
          ) : (
            <div className="space-y-3">
              {rascunhos.map((rascunho) => {
                const draftData = rascunho.payload?.nfData || {};
                const cliente = draftData.clienteNome || 'Tomador';
                const valorDraft = Number(draftData.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                const ativo = activeRascunhoId === rascunho.id;

                return (
                  <div key={rascunho.id} className={`rounded-xl border p-3 transition ${ativo ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-800">{cliente}</p>
                        <p className="text-xs font-bold text-slate-500 mt-0.5">{valorDraft}</p>
                      </div>
                      <button
                        onClick={() => excluirRascunho(rascunho.id)}
                        className="shrink-0 rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                        title="Excluir rascunho"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-slate-500 cursor-help" title={rascunho.motivo}>{rascunho.motivo}</p>
                    <button
                      onClick={() => retomarRascunho(rascunho)}
                      className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700"
                    >
                      Retomar na revisao
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      )}

      <div className="bg-white p-8 rounded-xl shadow-lg border border-slate-200">
        
        {step === 1 && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-semibold text-slate-700">Quem é o cliente?</h3>
                <Link href="/cliente" className="text-sm text-blue-600 font-bold hover:underline flex items-center gap-1"><UserPlus size={16}/> Cadastrar Novo Cliente</Link>
            </div>

            <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Selecione o Tomador (Cliente)</label>
                {clientes.length === 0 ? (
                    <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
                        <p className="text-slate-500 mb-2">Nenhum cliente encontrado.</p>
                        <Link href="/cliente" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold inline-block hover:bg-blue-700">Cadastrar Primeiro Cliente</Link>
                    </div>
                ) : (
                    // Para os Clientes:
                    <select className="w-full p-3 border rounded-lg bg-slate-50 outline-blue-500 text-slate-700 font-medium" value={nfData.clienteId} onChange={(e) => { const selected = clientes.find(c => c.id === e.target.value); setNfData({ ...nfData, clienteId: e.target.value, clienteNome: selected?.nome || "" }); }}>
                        <option value="">-- Selecione na lista --</option>
                        {clientes.map(cliente => {
                            const nomeCurto = cliente.nome.length > 60 ? cliente.nome.substring(0, 60) + '...' : cliente.nome;
                            return (
                                <option key={cliente.id} value={cliente.id}>
                                    {nomeCurto} ({cliente.documento || 'Exterior'})
                                </option>
                            );
                        })}
                    </select>
                )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h3 className="text-xl font-semibold text-slate-700">Detalhes do Serviço</h3>
            
            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                <label className="block text-sm font-bold text-yellow-800 mb-2 flex items-center gap-2"><Briefcase size={18} /> Atividade Econômica (CNAE)</label>
                <select className="w-full p-3 border rounded-lg bg-white outline-blue-500 text-slate-700" value={nfData.codigoCnae} onChange={(e) => setNfData({...nfData, codigoCnae: e.target.value})}>
                    {!nfData.codigoCnae && <option value="">Selecione uma atividade...</option>}
                    {cnaeRecuperadoForaDaLista && (
                        <option value={nfData.codigoCnae}>
                            {nfData.codigoCnae} - CNAE recuperado da venda
                        </option>
                    )}
                    {meusCnaes.map(cnae => {
                        const descCurta = cnae.descricao.length > 60 ? cnae.descricao.substring(0, 60) + '...' : cnae.descricao;
                        return (
                            <option key={cnae.id} value={cnae.codigo}>
                                {cnae.codigo} - {descCurta}
                            </option>
                        );
                    })}
                </select>
            </div>

            {isExterior ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-purple-50 p-4 rounded-lg border border-purple-100">
                    <div>
                        <label className="block text-sm font-medium text-purple-900 mb-2">Valor Faturado ({clienteSel?.moeda || 'USD'})</label>
                        <input type="text" inputMode="numeric" className="w-full p-3 border border-purple-200 rounded-lg outline-purple-500 text-slate-700 text-lg font-bold" value={formatarMoedaEstrangeiraInput(nfData.valorMoedaEstrangeira, clienteSel?.moeda)} onChange={handleValorEstrangeiroChange} placeholder="0.00" />
                        <p className="text-[10px] text-purple-600 mt-1">* Valor na moeda do contrato (Obrigatório Sefaz)</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Valor Convertido (R$)</label>
                        <input type="text" inputMode="numeric" className="w-full p-3 border rounded-lg outline-blue-500 text-slate-700 text-lg font-bold" value={formatarMoedaInput(nfData.valor)} onChange={handleValorChange} placeholder="R$ 0,00" />
                        <p className="text-[10px] text-slate-500 mt-1">* Valor fiscal em Reais para cálculo de impostos</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-2">Valor do Serviço (R$)</label>
                        <input type="text" inputMode="numeric" className="w-full p-3 border rounded-lg outline-blue-500 text-slate-700 text-lg font-bold" value={formatarMoedaInput(nfData.valor)} onChange={handleValorChange} placeholder="R$ 0,00" />
                    </div>
                </div>
            )}
            
            {/* SÓ MOSTRA SE NÃO FOR PF e NÃO FOR EXTERIOR */}
            {perfilEmpresa?.regimeTributario !== 'MEI' && !isExterior && !isPF && (
                <div className="mt-6 border-t pt-4">
                    <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><Calculator size={16}/> Impostos e Retenções</h4>

                    {/* CAIXAS LADO A LADO: ISS e INSS */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 mt-4">
                        {/* CAIXA DE ISS (MUNICIPAL) */}
                        <div className="bg-slate-50 p-3 rounded border">
                            <label className="flex items-center gap-2 cursor-pointer mb-2">
                                <input type="checkbox" className="w-4 h-4 text-blue-600 rounded" checked={nfData.issRetido} onChange={e => setNfData({...nfData, issRetido: e.target.checked})} />
                                <span className="text-sm text-slate-700 font-medium">ISS Retido pelo Tomador?</span>
                            </label>
                            
                            {nfData.issRetido && (
                                 <div className="flex items-center gap-2 animate-in fade-in pt-2 border-t border-slate-200 mt-2">
                                    <span className="text-xs font-bold text-slate-500 uppercase">Alíquota (2% a 5%):</span>
                                    <input 
                                        type="text" inputMode="numeric"
                                        className="w-24 p-1.5 border rounded text-sm outline-blue-500 text-center font-bold text-slate-700" 
                                        value={nfData.aliquota} 
                                        onChange={e => setNfData({...nfData, aliquota: formatarPorcentagemDirEsq(e.target.value)})}
                                        onBlur={() => handleBlurLimites('iss')}
                                    />
                                    <span className="text-xs text-slate-500">%</span>
                                </div>
                            )}
                        </div>

                        {/* CAIXA DE INSS (FEDERAL) */}
                        {cnaeSelecionadoObj?.temRetencaoInss && perfilEmpresa?.regimeTributario !== 'MEI' && (
                            <div className="bg-slate-50 p-3 rounded border">
                                <label className="flex items-center gap-2 cursor-pointer mb-2">
                                    <input type="checkbox" className="w-4 h-4 text-blue-600 rounded" checked={nfData.inssRetido} onChange={e => setNfData({...nfData, inssRetido: e.target.checked})} />
                                    <span className="text-sm text-slate-700 font-medium">INSS Retido pelo Tomador?</span>
                                </label>
                                
                                {nfData.inssRetido && (
                                     <div className="flex items-center gap-2 animate-in fade-in pt-2 border-t border-slate-200 mt-2">
                                        <span className="text-xs font-bold text-slate-500 uppercase">Alíquota (3.5% a 11%):</span>
                                        <input 
                                            type="text" inputMode="numeric"
                                            className="w-24 p-1.5 border rounded text-sm outline-blue-500 text-center font-bold text-slate-700" 
                                            value={retencoes.inss.aliquota} 
                                            onChange={e => handleAliquotaRetencaoChange('inss', formatarPorcentagemDirEsq(e.target.value))}
                                            onBlur={() => handleBlurLimites('inss')}
                                        />
                                        <span className="text-xs text-slate-500">%</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {mostraRetencoesFederais && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                            {['pis', 'cofins', 'csll', 'ir'].map(imposto => {
                                // === LÓGICA DE OCULTAÇÃO (SÓ EXIBE SE O ADMIN ATIVOU) ===
                                if (['pis', 'cofins', 'csll'].includes(imposto) && !cnaeSelecionadoObj?.retemCrsf) return null;
                                if (imposto === 'ir' && !cnaeSelecionadoObj?.retemIr) return null;

                                const dadosImposto = retencoes[imposto as keyof typeof retencoes];
                                const isActive = parseFloat(dadosImposto.valor) > 0 || parseFloat(dadosImposto.aliquota) > 0;
                                
                                return (
                                <div key={imposto} className={`flex flex-col p-3 border rounded transition ${isActive ? 'bg-blue-50 border-blue-300 shadow-sm' : 'bg-white border-slate-200'}`}>
                                    <span className="text-xs font-bold text-slate-700 uppercase mb-2">{imposto}</span>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center gap-1">
                                            <label className="text-[10px] text-slate-500 uppercase w-1/3">Alíq.</label>
                                            <div className="flex items-center w-2/3">
                                                <input type="text" inputMode="numeric" className="w-full p-1 border rounded text-xs outline-blue-500 text-right font-bold" value={dadosImposto.aliquota} onChange={e => handleAliquotaRetencaoChange(imposto, e.target.value)} />
                                                <span className="text-[10px] text-slate-400 ml-1">%</span>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center gap-1">
                                            <label className="text-[10px] text-slate-500 uppercase w-1/3">Valor</label>
                                            <div className="flex items-center w-2/3">
                                                <span className="text-[10px] text-slate-400 mr-1">R$</span>
                                                <input type="text" inputMode="numeric" className={`w-full p-1 border rounded text-xs outline-blue-500 text-right font-bold ${isActive ? 'text-blue-700' : 'text-slate-500'}`} value={dadosImposto.valor} onChange={e => handleValorRetencaoChange(imposto, e.target.value)} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )})}
                        </div>
                    )}
                </div>
            )}
            
            <div className="pt-4 border-t">
              <label className="block text-sm font-medium text-slate-700 mb-2">Discriminação do Serviço</label>
              <textarea rows={4} placeholder="Descrição detalhada do serviço prestado..." className="w-full p-3 border rounded-lg outline-blue-500 text-slate-700 resize-none" value={nfData.servicoDescricao} onChange={(e) => setNfData({...nfData, servicoDescricao: e.target.value})}></textarea>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <h3 className="text-xl font-semibold text-slate-700">Revisão e Fechamento</h3>
            <div className="bg-slate-50 p-6 rounded-lg space-y-4 border border-slate-200">
              
              <div className="flex justify-between border-b border-slate-200 pb-2 items-center">
                  <span className="text-slate-500 text-sm">Tomador:</span>
                  <span className="font-medium text-slate-900 text-sm">{nfData.clienteNome}</span>
              </div>
              
              <div className="flex justify-between border-b border-slate-200 pb-2 items-center">
                  <span className="text-slate-500 text-sm">Atividade (CNAE):</span>
                  <span className="font-medium text-slate-900 text-sm text-right max-w-xs truncate">{nfData.codigoCnae} {cnaeDescricaoCurta ? `- ${cnaeDescricaoCurta}` : ''}</span>
              </div>
              
              {/* === DATA DE COMPETÊNCIA EDITÁVEL COM DESTAQUE SUTIL === */}
              <div className="flex justify-between border-b border-slate-200 pb-2 items-center">
                  <span className="text-slate-500 text-sm">Data de Competência:</span>
                  <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider hidden sm:block" title="Pode alterar a data se precisar">EDITÁVEL até 30 Dias ➔</span>
                      <input 
                          type="date" 
                          className={`text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 hover:border-blue-300 rounded-md px-2 py-1 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer text-right shadow-sm ${isDataCompetenciaInvalida ? 'text-red-600 border-red-300 bg-red-50' : ''}`}
                          max={maxDateStr}
                          min={minDateStr}
                          value={nfData.dataCompetencia}
                          onChange={(e) => setNfData({...nfData, dataCompetencia: e.target.value})}
                      />
                  </div>
              </div>

              {/* === DESCRIÇÃO LADO A LADO === */}
              <div className="flex justify-between border-b border-slate-200 pb-3 gap-4">
                  <span className="text-slate-500 text-sm whitespace-nowrap">Descrição:</span>
                  <span className="font-medium text-slate-700 text-sm text-right whitespace-pre-wrap">
                      {nfData.servicoDescricao || "Sem descrição informada."}
                  </span>
              </div>              

              <div className="flex justify-between pt-2 items-center">
                  <span className="text-slate-500 text-sm">Valor Bruto:</span>
                  <span className="font-bold text-slate-900 text-lg">{valorNumerico.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
              
              {/* === DEDUÇÕES DINÂMICAS === */}
              {isPJ && !isPF && !isExterior && totalDeducoes > 0 && (
                  <div className="bg-red-50 p-3 rounded border border-red-100 mt-2">
                      <p className="text-[10px] font-bold text-red-800 uppercase mb-2 tracking-wider">Deduções na Fonte</p>
                      
                      {nfData.issRetido && (
                          <div className="flex justify-between text-sm text-red-600 mb-1">
                              <span>ISS ({nfData.aliquota}%):</span>
                              <span>- {valorIss.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                          </div>
                      )}
                      
                      {/* === INSS AGORA APARECE AQUI! === */}
                      {nfData.inssRetido && (
                          <div className="flex justify-between text-sm text-red-600 mb-1">
                              <span>INSS ({retencoes.inss.aliquota}%):</span>
                              <span>- {valorInss.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                          </div>
                      )}
                      
                      {['pis', 'cofins', 'csll', 'ir'].map(key => {
                          const data = retencoes[key as keyof typeof retencoes];
                          if (parseFloat(data.valor) > 0) {
                              return (
                                  <div key={key} className="flex justify-between text-sm text-red-600 mb-1">
                                      <span className="uppercase">{key} ({data.aliquota}%):</span>
                                      <span>- {parseFloat(data.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                  </div>
                              );
                          }
                          return null;
                      })}
                      
                      <div className="flex justify-between pt-2 border-t border-red-200 mt-2 text-sm font-bold text-slate-800">
                          <span>Valor Líquido a Receber:</span>
                          <span className="text-green-700">{valorLiquido.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                      </div>
                  </div>
              )}

              {isExterior && (
                  <div className="flex justify-between pt-2 border-t border-slate-200 mt-2">
                      <span className="text-slate-500">Valor Faturado ({clienteSel?.moeda || 'USD'}):</span>
                      <span className="font-bold text-purple-700 text-lg">{formatarMoedaEstrangeiraInput(nfData.valorMoedaEstrangeira, clienteSel?.moeda)}</span>
                  </div>
              )}
            </div>

            {perfilEmpresa?.ambiente === 'HOMOLOGACAO' ? (
                 <div className="bg-orange-50 border border-orange-200 p-3 rounded-lg flex items-start gap-2 text-sm text-orange-800 font-medium"><AlertTriangle size={18} className="shrink-0 mt-0.5" /><p>Você está no ambiente de <strong>HOMOLOGAÇÃO</strong>. A nota será apenas validada pela prefeitura, sem valor fiscal. Se quiser emitir com valor, mude para Produção nas configurações.</p></div>
            ) : (
                <p className="text-xs text-center text-slate-400">Ao clicar em emitir, a nota será processada no ambiente nacional e possuirá valor fiscal.</p>
            )}
          </div>
        )}

        <div className="flex justify-between mt-8 pt-6 border-t border-slate-100">
          <div>
            {step > 1 && !loading && (
                <button onClick={handleBack} className="flex items-center gap-2 text-slate-500 px-4 py-2 hover:bg-gray-100 rounded"><ArrowLeft size={18} /> Voltar</button>
            )}
          </div>
          
          <div className="w-full flex justify-end">
            {step < 3 ? (
                <button onClick={handleNext} disabled={loading || (step === 1 && !nfData.clienteId) || isStep2Invalid} className={`bg-blue-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed`}>
                    {loading ? <Loader2 className="animate-spin" size={18}/> : 'Próximo'} <ArrowRight size={18} />
                </button>
            ) : (
                loading ? (
                    <div className="w-full max-w-xs"><div className="flex justify-between text-xs font-bold text-blue-600 mb-1"><span>{progressStatus}</span><span>{progressPercent}%</span></div><div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden"><div className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }}></div></div></div>
                ) : (
                    <button onClick={handleEmitir} disabled={isDataCompetenciaInvalida} className={`${perfilEmpresa?.ambiente === 'HOMOLOGACAO' ? 'bg-orange-500 hover:bg-orange-600' : 'bg-green-600 hover:bg-green-700'} text-white px-8 py-3 rounded-lg flex items-center gap-2 shadow-lg font-bold transition-transform transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none`}><CheckCircle size={20} /> {perfilEmpresa?.ambiente === 'HOMOLOGACAO' ? 'VALIDAR NOTA (TESTE)' : 'EMITIR NOTA'}</button>
                )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GuiaEmissao({ step, ambiente }: { step: number; ambiente?: string }) {
  const orientacoes: Record<number, { title: string; description: string; tips: string[]; tone: string }> = {
    1: {
      title: 'Escolha o tomador correto',
      description: 'A nota herda os dados fiscais do cliente selecionado. Se for PF sem endereco, use o cadastro preparado para esse caso.',
      tips: ['Confira CPF/CNPJ antes de avancar.', 'Se o cliente nao existir, cadastre primeiro.', 'Rascunhos aparecem aqui quando uma emissao falha por algo corrigivel.'],
      tone: 'blue',
    },
    2: {
      title: 'Preencha o servico com calma',
      description: 'CNAE, valor e descricao definem a tributacao enviada ao Portal Nacional.',
      tips: ['Use o CNAE correto para evitar rejeicao.', 'Retencoes aparecem conforme regra fiscal cadastrada.', 'O valor precisa ser maior que zero.'],
      tone: 'slate',
    },
    3: {
      title: ambiente === 'HOMOLOGACAO' ? 'Revise antes de validar' : 'Revise antes de emitir',
      description: ambiente === 'HOMOLOGACAO'
        ? 'Em homologacao a nota e apenas validada, sem valor fiscal.'
        : 'Depois de autorizada, cancelamento exige justificativa e fica registrado no Portal Nacional.',
      tips: ['A data de competencia pode ser ajustada dentro do limite permitido.', 'DPS fica automatico; altere apenas se o Portal pedir.', 'Acompanhe o processamento ate a nota aparecer no historico.'],
      tone: ambiente === 'HOMOLOGACAO' ? 'amber' : 'green',
    },
  };

  const atual = orientacoes[step] || orientacoes[1];
  const toneClass: Record<string, string> = {
    blue: 'border-blue-100 bg-blue-50 text-blue-900',
    slate: 'border-slate-200 bg-white text-slate-800',
    green: 'border-emerald-100 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
  };

  return (
    <section className={`mb-6 rounded-2xl border p-4 shadow-sm ${toneClass[atual.tone]}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80">
            <HelpCircle size={19} />
          </div>
          <div>
            <h3 className="text-sm font-black">{atual.title}</h3>
            <p className="mt-1 text-sm leading-6 opacity-80">{atual.description}</p>
          </div>
        </div>
        <div className="grid gap-2 text-xs font-semibold opacity-80 md:min-w-[330px]">
          {atual.tips.map((tip) => (
            <span key={tip} className="flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0" />
              {tip}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function EmitirNotaPage() {
    return (
        <Suspense fallback={<div className="h-screen flex items-center justify-center text-slate-500"><Loader2 className="animate-spin mr-2"/> Carregando...</div>}>
            <EmitirNotaContent />
        </Suspense>
    );
}
