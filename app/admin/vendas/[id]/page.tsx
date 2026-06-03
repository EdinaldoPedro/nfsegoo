'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Building,
  CalendarDays,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Code,
  Copy,
  Download,
  FileCode2,
  FileJson,
  FileText,
  Hash,
  History,
  Layers,
  ListChecks,
  Loader2,
  MapPin,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Terminal,
  Trash2,
  User,
} from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';

type ActiveTab = 'resumo' | 'correcao' | 'validacao' | 'xml' | 'retornos' | 'logs';

const formatXml = (xml?: string | null) => {
  if (!xml) return '';
  try {
    let formatted = '';
    const reg = /(>)(<)(\/*)/g;
    let pad = 0;
    const xmlClean = xml.replace(reg, '$1\r\n$2$3');

    xmlClean.split('\r\n').forEach((node) => {
      let indent = 0;
      if (node.match(/.+<\/\w[^>]*>$/)) indent = 0;
      else if (node.match(/^<\/\w/)) {
        if (pad !== 0) pad -= 1;
      } else if (node.match(/^<\w[^>]*[^/]>.*$/)) indent = 1;

      let padding = '';
      for (let i = 0; i < pad; i += 1) padding += '  ';
      formatted += padding + node + '\r\n';
      pad += indent;
    });

    return formatted.trim();
  } catch {
    return xml || '';
  }
};

const downloadFile = (content: string, filename: string, type = 'text/xml') => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const formatMoney = (value: any) => {
  const parsed = Number(value || 0);
  return parsed.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatDate = (value?: string | Date | null) => {
  if (!value) return 'Não informado';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const onlyDate = (value?: string | Date | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const formatLogDetails = (rawDetails: any) => {
  try {
    if (!rawDetails) return null;
    let data = rawDetails;

    if (typeof data === 'string') {
      try {
        let parsed = JSON.parse(data);
        while (typeof parsed === 'string') {
          try {
            parsed = JSON.parse(parsed);
          } catch {
            break;
          }
        }
        data = parsed;
      } catch {
        if (data.trim().startsWith('<')) return formatXml(data);
        return data;
      }
    }

    if (data?.xmlGerado) return formatXml(data.xmlGerado);
    if (data?.xmlOriginal) return formatXml(data.xmlOriginal);
    if (data?.xml) return formatXml(data.xml);
    if (data?.dpsXmlGZipB64) return `[Arquivo GZIP - Tamanho: ${data.dpsXmlGZipB64.length} bytes]`;

    return JSON.stringify(data, null, 2);
  } catch {
    return String(rawDetails);
  }
};

function safeJson(raw: any) {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractCodigoErro(text?: string | null) {
  if (!text) return null;
  const match = text.match(/\bE\d{4}\b|\binv\d{4}\b|\b\d{3}\b/i);
  return match?.[0]?.toUpperCase() || null;
}

function fieldValue(value: any) {
  return value || value === 0 ? String(value) : 'Não informado';
}

function statusStyle(status: string) {
  if (status === 'ERRO_EMISSAO') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'CONCLUIDA') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'PROCESSANDO') return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function checkStyle(status: string) {
  if (status === 'error') {
    return { bg: 'bg-red-50', text: 'text-red-700', badge: 'bg-red-100 text-red-700 border-red-200', label: 'Bloqueio' };
  }
  if (status === 'warn') {
    return { bg: 'bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Atenção' };
  }
  if (status === 'ok') {
    return { bg: 'bg-emerald-50', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'OK' };
  }
  return { bg: 'bg-slate-50', text: 'text-slate-600', badge: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Info' };
}

function InfoItem({ label, value, mono = false }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 text-sm font-bold text-slate-800 break-words ${mono ? 'font-mono' : ''}`}>{fieldValue(value)}</p>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  mono = false,
  type = 'text',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-black uppercase tracking-wide text-slate-500 mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-100 disabled:text-slate-500 ${mono ? 'font-mono' : ''}`}
      />
    </label>
  );
}

function SectionShell({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 border border-blue-100">
          <Icon size={18} />
        </div>
        <div>
          <h3 className="font-black text-slate-900">{title}</h3>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function LogRow({ log }: { log: any }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!log.details;
  const conteudoFormatado = hasDetails ? formatLogDetails(log.details) : null;
  const isXml = conteudoFormatado?.trim().startsWith('<');

  return (
    <div className="relative pl-6 border-l-2 border-slate-200 pb-6 last:pb-0 group">
      <div
        className={`absolute -left-[7px] top-0 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm ${
          log.level === 'ERRO' ? 'bg-red-500' : log.action === 'REENVIO_MANUAL' ? 'bg-blue-600' : 'bg-emerald-500'
        }`}
      />
      <div className="flex flex-col gap-2">
        <div
          onClick={() => hasDetails && setExpanded(!expanded)}
          className={`flex justify-between items-start ${hasDetails ? 'cursor-pointer select-none' : ''}`}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded border uppercase ${
                  log.level === 'ERRO' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {log.action}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">{formatDate(log.createdAt)}</span>
            </div>
            <p className={`text-sm font-medium ${log.level === 'ERRO' ? 'text-red-700' : 'text-slate-700'}`}>{log.message}</p>
          </div>
          {hasDetails && (
            <div className="text-slate-400 group-hover:text-blue-500 transition pt-1">
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
          )}
        </div>
        {expanded && conteudoFormatado && (
          <div className="mt-2 animate-in slide-in-from-top-2 fade-in duration-200">
            <div className="rounded-lg overflow-hidden border border-slate-700 shadow-md bg-[#0f172a]">
              <div className="px-3 py-2 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
                <span className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-2">
                  {isXml ? <Code size={12} className="text-orange-400" /> : <Terminal size={12} className="text-blue-400" />}
                  {isXml ? 'XML estruturado' : 'Payload / resposta'}
                </span>
                <div className="flex gap-2">
                  {isXml && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadFile(conteudoFormatado, `log-${log.id}.xml`);
                      }}
                      className="text-slate-400 hover:text-white transition flex items-center gap-1 text-[10px] font-bold uppercase"
                    >
                      <Download size={12} /> Baixar
                    </button>
                  )}
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      navigator.clipboard.writeText(conteudoFormatado);
                    }}
                    className="text-slate-500 hover:text-white transition flex items-center gap-1 text-[10px] font-bold uppercase"
                  >
                    <Copy size={12} /> Copiar
                  </button>
                </div>
              </div>
              <div className="p-4 overflow-x-auto custom-scrollbar max-h-[500px]">
                <pre className={`text-xs font-mono leading-relaxed whitespace-pre-wrap ${isXml ? 'text-orange-200' : 'text-emerald-400'}`}>
                  {conteudoFormatado}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RetornoCard({ log, index }: { log: any; index: number }) {
  const parsed = safeJson(log.details);
  const detailText = typeof parsed === 'string' ? parsed : parsed ? JSON.stringify(parsed) : log.details;
  const codigo = extractCodigoErro(`${log.message} ${detailText}`) || `#${index + 1}`;
  const mensagem = log.message || detailText || 'Retorno sem mensagem.';

  return (
    <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-black text-white">{codigo}</span>
            <span className="text-xs font-bold text-red-500">{formatDate(log.createdAt)}</span>
          </div>
          <p className="mt-3 text-sm font-semibold leading-relaxed text-red-900">{mensagem}</p>
        </div>
        <span className="rounded-full border border-red-200 bg-white px-3 py-1 text-[10px] font-black uppercase text-red-700">
          Portal / emissão
        </span>
      </div>
      {detailText && detailText !== mensagem && (
        <pre className="mt-4 max-h-48 overflow-auto rounded-xl bg-white p-3 text-xs text-red-800 whitespace-pre-wrap border border-red-100">
          {formatLogDetails(log.details)}
        </pre>
      )}
    </div>
  );
}

export default function DetalheVendaCompleto() {
  const { id } = useParams();
  const router = useRouter();
  const dialog = useDialog();
  const vendaId = Array.isArray(id) ? id[0] : id;

  const [venda, setVenda] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [inspecionando, setInspecionando] = useState(false);
  const [reprocessandoPdf, setReprocessandoPdf] = useState(false);
  const [inspecao, setInspecao] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('resumo');

  const [formData, setFormData] = useState({
    descricao: '',
    valor: '',
    cnae: '',
    numeroDPS: '',
    serieDPS: '',
    dataCompetencia: '',
    aliquota: '',
    issRetido: 'false',
  });

  const fetchVenda = (silent = false) => {
    if (!silent && !venda) setLoading(true);
    fetch(`/api/admin/vendas/${vendaId}`)
      .then((r) => r.json())
      .then((data) => {
        setVenda(data);
        if (!isEditing && !silent) {
          let cnaeSalvo = data.notas?.[0]?.cnae || '';
          let dpsSalvo = '';
          let serieSalva = data.empresa?.serieDPS || '';
          let dataCompetencia = '';

          try {
            const logComPayload = data.logs.find((l: any) => l.details && (l.details.includes('payloadOriginal') || l.details.includes('codigoCnae')));
            if (logComPayload) {
              let raw = typeof logComPayload.details === 'string' ? JSON.parse(logComPayload.details) : logComPayload.details;
              if (raw.payloadOriginal) raw = raw.payloadOriginal;

              cnaeSalvo = cnaeSalvo || raw?.servico?.cnae || raw?.servico?.codigoCnae || '';
              dpsSalvo = raw?.numeroDPS || raw?.meta?.numero || '';
              serieSalva = raw?.serieDPS || raw?.meta?.serie || serieSalva || '';
              dataCompetencia = onlyDate(raw?.dataCompetencia || raw?.meta?.dataCompetencia);
            }
          } catch {}

          setFormData({
            descricao: data.descricao || '',
            valor: data.valor ? String(data.valor).replace('.', ',') : '',
            cnae: cnaeSalvo,
            numeroDPS: dpsSalvo,
            serieDPS: serieSalva,
            dataCompetencia,
            aliquota: '',
            issRetido: 'false',
          });
        }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchVenda();
  }, [vendaId]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (venda && venda.status === 'PROCESSANDO') {
      interval = setInterval(() => fetchVenda(true), 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [venda?.status]);

  const parseValor = (val: string) => {
    if (!val) return 0;
    const limpo = val.replace(/[^\d,]/g, '').replace(',', '.');
    return parseFloat(limpo);
  };

  const payloadEnvio = () => ({
    ...formData,
    valor: parseValor(formData.valor),
    issRetido: formData.issRetido === 'true',
  });

  const executarInspecao = async () => {
    setInspecionando(true);
    try {
      const res = await fetch(`/api/admin/vendas/${vendaId}/inspecao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: payloadEnvio() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na validação.');
      setInspecao(data);
    } catch (error: any) {
      dialog.showAlert({ type: 'danger', title: 'Erro na validação', description: error.message });
    } finally {
      setInspecionando(false);
    }
  };

  const handleSave = async (reenviar = false) => {
    setProcessing(true);
    const userId = localStorage.getItem('userId');
    const envio = payloadEnvio();

    try {
      await fetch(`/api/admin/vendas/${vendaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envio),
      });

      if (reenviar) {
        const resRetry = await fetch('/api/notas/retry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-user-id': userId || '' },
          body: JSON.stringify({ vendaId, dadosAtualizados: envio }),
        });

        const dataRetry = await resRetry.json();
        if (!resRetry.ok) throw new Error(dataRetry.error || 'Erro no processamento.');

        await dialog.showAlert({ type: 'success', title: 'Processando', description: 'Reenvio iniciado. Acompanhe na aba de Logs.' });

        setIsEditing(false);
        setVenda((prev: any) => ({ ...prev, status: 'PROCESSANDO' }));
        setActiveTab('logs');
        setTimeout(() => fetchVenda(true), 1000);
      } else {
        await dialog.showAlert({ type: 'success', title: 'Salvo', description: 'Dados atualizados com sucesso.' });
        setIsEditing(false);
        fetchVenda();
      }
    } catch (error: any) {
      dialog.showAlert({ type: 'danger', title: 'Erro', description: error.message });
      setTimeout(() => fetchVenda(true), 1000);
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async () => {
    const confirmacao = await dialog.showPrompt({
      type: 'danger',
      title: 'Zona de perigo',
      description: 'Esta ação arquiva a venda e suas notas quando permitido. Digite DELETAR para confirmar.',
      validationText: 'DELETAR',
      placeholder: "Digite 'DELETAR'",
    });

    if (confirmacao !== 'DELETAR') return;

    setProcessing(true);
    try {
      const res = await fetch(`/api/admin/vendas/${vendaId}`, { method: 'DELETE' });
      if (res.ok) {
        await dialog.showAlert({ type: 'success', description: 'Venda arquivada.' });
        router.push('/admin/emissoes');
      } else {
        const data = await res.json().catch(() => ({}));
        dialog.showAlert({ type: 'danger', description: data.error || 'Erro ao excluir.' });
      }
    } catch {
      dialog.showAlert('Erro de conexão.');
    } finally {
      setProcessing(false);
    }
  };

  const startCorrection = () => {
    setIsEditing(true);
    setActiveTab('correcao');
  };

  const validateAndOpen = async () => {
    await executarInspecao();
    setActiveTab('validacao');
  };

  const reprocessarPdf = async () => {
    const confirmar = await dialog.showConfirm({
      type: 'info',
      title: 'Atualizar PDF?',
      description: 'A bancada vai chamar o robo do Portal Nacional para baixar e salvar o PDF desta venda.',
      confirmText: 'Atualizar PDF',
    });

    if (!confirmar) return;

    setReprocessandoPdf(true);
    try {
      const res = await fetch(`/api/admin/vendas/${vendaId}/reprocessar-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Nao foi possivel atualizar o PDF.');

      await dialog.showAlert({ type: 'success', title: 'PDF atualizado', description: data.message || 'PDF salvo com sucesso.' });
      fetchVenda(true);
      setActiveTab('logs');
    } catch (error: any) {
      dialog.showAlert({ type: 'danger', title: 'Falha no PDF', description: error.message });
      fetchVenda(true);
    } finally {
      setReprocessandoPdf(false);
    }
  };

  const xmlData = useMemo(() => {
    if (!venda) return { prettyPayload: '// Payload indisponível', xmlExibicao: '', xmlDownload: '' };

    let prettyPayload = '// Payload indisponível';
    let xmlExibicao = '';
    let xmlDownload = '';

    try {
      const logComPayload = venda.logs.find(
        (l: any) => (l.action === 'EMISSAO_INICIADA' || l.action === 'NOTA_AUTORIZADA' || l.action === 'FALHA_EMISSAO' || l.action === 'DPS_GERADA') && l.details,
      );

      if (logComPayload) {
        let raw = typeof logComPayload.details === 'string' ? JSON.parse(logComPayload.details) : logComPayload.details;

        if (raw.xmlGerado) {
          xmlDownload = raw.xmlGerado;
          xmlExibicao = formatXml(raw.xmlGerado);
        }

        if (raw.payloadOriginal) raw = raw.payloadOriginal;
        prettyPayload = JSON.stringify(raw, null, 2);
      } else if (venda.payloadJson) {
        const raw = JSON.parse(venda.payloadJson);
        prettyPayload = JSON.stringify(raw, null, 2);
      }
    } catch {}

    return { prettyPayload, xmlExibicao, xmlDownload };
  }, [venda]);

  const retornoLogs = useMemo(() => {
    if (!venda?.logs) return [];
    return venda.logs.filter((log: any) => log.level === 'ERRO' || log.action === 'FALHA_EMISSAO' || /E\d{4}|inv\d{4}/i.test(`${log.message} ${log.details || ''}`));
  }, [venda]);

  const checksAgrupados = useMemo(() => {
    return inspecao?.checks?.reduce((acc: Record<string, any[]>, check: any) => {
      const group = check.group || 'Geral';
      acc[group] = acc[group] || [];
      acc[group].push(check);
      return acc;
    }, {}) || {};
  }, [inspecao]);

  if (loading && !venda) {
    return (
      <div className="h-screen flex items-center justify-center text-slate-500">
        <Loader2 className="animate-spin mr-2" /> Carregando venda...
      </div>
    );
  }

  if (!venda) return <div className="p-8">Venda não encontrada.</div>;

  const notaAtual = venda.notas?.[0];
  const nomeTomador = venda.cliente?.nome || venda.cliente?.razaoSocial || 'Tomador não informado';
  const ultimaMensagemErro = retornoLogs[0]?.message;
  const integridadePdf = {
    chaveOk: Boolean(notaAtual?.chaveAcesso),
    xmlOk: Boolean(notaAtual?.xmlAutorizadoBase64 || notaAtual?.xmlBase64),
    pdfOk: Boolean(notaAtual?.pdfBase64),
    notaAutorizada: venda.status === 'CONCLUIDA' || venda.status === 'CANCELADA' || notaAtual?.status === 'AUTORIZADA' || notaAtual?.status === 'CANCELADA',
  };
  const podeReprocessarPdf = integridadePdf.notaAutorizada && integridadePdf.chaveOk && integridadePdf.xmlOk && !integridadePdf.pdfOk;

  const tabs: Array<{ id: ActiveTab; label: string; icon: any; color: string }> = [
    { id: 'resumo', label: 'Resumo', icon: ClipboardList, color: 'blue' },
    { id: 'correcao', label: 'Correção', icon: Settings2, color: 'red' },
    { id: 'validacao', label: 'Validação', icon: ShieldCheck, color: 'emerald' },
    { id: 'xml', label: 'XML e JSON', icon: Code, color: 'purple' },
    { id: 'retornos', label: 'Retornos', icon: ListChecks, color: 'amber' },
    { id: 'logs', label: 'Logs', icon: Activity, color: 'orange' },
  ];

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur shadow-sm">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-full transition text-slate-500">
                <ArrowLeft size={20} />
              </button>
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-xl font-black text-slate-900">Bancada da venda #{venda.id.split('-')[0]}</h1>
                  <span className={`text-[10px] px-2 py-1 rounded-full border uppercase font-black ${statusStyle(venda.status)}`}>
                    {venda.status === 'PROCESSANDO' ? (
                      <span className="flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Processando</span>
                    ) : venda.status.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {venda.empresa.razaoSocial} para {nomeTomador}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={validateAndOpen}
                disabled={inspecionando}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-70"
              >
                {inspecionando ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                Validar
              </button>
              <button
                onClick={startCorrection}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 shadow-sm"
              >
                <Settings2 size={16} /> Corrigir
              </button>
              <button
                onClick={handleDelete}
                disabled={processing}
                className="inline-flex items-center gap-2 rounded-xl border border-red-100 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50"
              >
                <Trash2 size={16} /> Arquivar
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {venda.status === 'ERRO_EMISSAO' && (
            <section className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
                    <AlertTriangle size={23} />
                  </div>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-red-600">Falha na emissão</p>
                    <h2 className="mt-1 text-lg font-black text-red-950">Retorno do Portal precisa de correção técnica</h2>
                    <p className="mt-1 text-sm leading-relaxed text-red-800">{ultimaMensagemErro || 'A emissão falhou. Consulte Retornos, Validação, XML e Logs.'}</p>
                  </div>
                </div>
                <button
                  onClick={startCorrection}
                  className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 inline-flex items-center justify-center gap-2"
                >
                  <RefreshCw size={16} /> Abrir correção
                </button>
              </div>
            </section>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                const colorClass = active
                  ? tab.color === 'red'
                    ? 'border-red-600 text-red-700 bg-red-50'
                    : tab.color === 'emerald'
                      ? 'border-emerald-600 text-emerald-700 bg-emerald-50'
                      : tab.color === 'purple'
                        ? 'border-purple-600 text-purple-700 bg-purple-50'
                        : tab.color === 'amber'
                          ? 'border-amber-600 text-amber-700 bg-amber-50'
                          : tab.color === 'orange'
                            ? 'border-orange-600 text-orange-700 bg-orange-50'
                            : 'border-blue-600 text-blue-700 bg-blue-50'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50';

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`shrink-0 border-b-2 px-4 py-3 text-sm font-black transition inline-flex items-center gap-2 ${colorClass}`}
                  >
                    <Icon size={16} /> {tab.label}
                    {tab.id === 'logs' && venda.status === 'PROCESSANDO' && <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />}
                    {tab.id === 'retornos' && retornoLogs.length > 0 && <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] text-white">{retornoLogs.length}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {activeTab === 'resumo' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <InfoItem label="Status" value={venda.status.replace('_', ' ')} />
                <InfoItem label="Valor" value={formatMoney(venda.valor)} />
                <InfoItem label="Criada em" value={formatDate(venda.createdAt)} />
                <InfoItem label="Atualizada em" value={formatDate(venda.updatedAt)} />
              </div>

              <SectionShell title="Identificação da emissão" subtitle="Leitura rápida dos elementos que entram na DPS." icon={FileText}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <InfoItem label="Número DPS" value={formData.numeroDPS || `Próximo: ${(venda.empresa?.ultimoDPS || 0) + 1}`} mono />
                  <InfoItem label="Série DPS" value={formData.serieDPS || venda.empresa?.serieDPS || '900'} mono />
                  <InfoItem label="Ambiente" value={venda.empresa?.ambiente} />
                  <InfoItem label="CNAE" value={formData.cnae || notaAtual?.cnae} mono />
                  <InfoItem label="Data competência" value={formData.dataCompetencia || 'Usará data atual'} />
                  <InfoItem label="Nota vinculada" value={notaAtual?.numero || notaAtual?.chaveAcesso || 'Ainda não autorizada'} mono />
                </div>
              </SectionShell>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <SectionShell title="Prestador" subtitle="Empresa que está emitindo a nota." icon={Building}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoItem label="Razão social" value={venda.empresa.razaoSocial} />
                    <InfoItem label="CNPJ" value={venda.empresa.documento} mono />
                    <InfoItem label="Inscrição municipal" value={venda.empresa.inscricaoMunicipal} mono />
                    <InfoItem label="IBGE" value={venda.empresa.codigoIbge} mono />
                    <InfoItem label="Regime" value={venda.empresa.regimeTributario} />
                    <InfoItem label="Certificado" value={venda.empresa.certificadoVencimento ? `Vence em ${formatDate(venda.empresa.certificadoVencimento)}` : 'Não informado'} />
                  </div>
                </SectionShell>

                <SectionShell title="Tomador" subtitle="Pessoa física, jurídica ou exterior que recebe o serviço." icon={User}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoItem label="Nome/Razão social" value={nomeTomador} />
                    <InfoItem label="Documento" value={venda.cliente.documento} mono />
                    <InfoItem label="E-mail" value={venda.cliente.email} />
                    <InfoItem label="IBGE" value={venda.cliente.codigoIbge} mono />
                    <InfoItem label="Cidade/UF" value={`${fieldValue(venda.cliente.cidade)}/${fieldValue(venda.cliente.uf)}`} />
                    <InfoItem label="País" value={venda.cliente.pais} />
                  </div>
                </SectionShell>
              </div>
            </div>
          )}

          {activeTab === 'correcao' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-blue-950">Modo de correção técnica</p>
                  <p className="text-sm text-blue-700">Esta primeira versão corrige os campos já suportados pelo reenvio e organiza os demais campos para diagnóstico.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!isEditing && (
                    <button onClick={() => setIsEditing(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
                      Habilitar edição
                    </button>
                  )}
                  {isEditing && (
                    <>
                      <button onClick={() => { setIsEditing(false); fetchVenda(); }} className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50">
                        Cancelar
                      </button>
                      <button onClick={() => handleSave(false)} disabled={processing} className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-60">
                        Salvar rascunho
                      </button>
                      <button onClick={() => handleSave(true)} disabled={processing} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-2">
                        {processing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Salvar e reenviar
                      </button>
                    </>
                  )}
                </div>
              </div>

              <SectionShell title="RPS / DPS" subtitle="Campos chave da tentativa de emissão." icon={Hash}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <TextInput label="Número DPS" value={formData.numeroDPS} onChange={(value) => setFormData({ ...formData, numeroDPS: value })} placeholder="Automático" mono disabled={!isEditing} />
                  <TextInput label="Série DPS" value={formData.serieDPS} onChange={(value) => setFormData({ ...formData, serieDPS: value })} placeholder="900" mono disabled={!isEditing} />
                  <TextInput label="Data competência" type="date" value={formData.dataCompetencia} onChange={(value) => setFormData({ ...formData, dataCompetencia: value })} disabled={!isEditing} />
                  <InfoItem label="Tipo RPS" value="1" mono />
                </div>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <InfoItem label="Natureza da operação" value="Operação tributável" />
                  <InfoItem label="Optante Simples Nacional" value={String(venda.empresa.regimeTributario || '').toUpperCase() === 'MEI' || String(venda.empresa.regimeTributario || '').toUpperCase().includes('SIMPLES') ? 'Sim' : 'Conferir'} />
                  <InfoItem label="Regime especial" value={venda.empresa.regimeEspecialTributacao || 'Não informado'} />
                </div>
              </SectionShell>

              <SectionShell title="Serviço e tributação" subtitle="Primeiro bloco de edição real para corrigir rejeições de CNAE, descrição, valor e tributação." icon={Layers}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <TextInput label="CNAE" value={formData.cnae} onChange={(value) => setFormData({ ...formData, cnae: value })} mono disabled={!isEditing} />
                  <TextInput label="Valor do serviço" value={formData.valor} onChange={(value) => setFormData({ ...formData, valor: value })} mono disabled={!isEditing} />
                  <TextInput label="Alíquota ISS" value={formData.aliquota} onChange={(value) => setFormData({ ...formData, aliquota: value })} placeholder="Ex: 5,00" mono disabled={!isEditing} />
                </div>

                <div className="mt-4">
                  <label className="block">
                    <span className="block text-xs font-black uppercase tracking-wide text-slate-500 mb-1.5">Descrição do serviço</span>
                    <textarea
                      value={formData.descricao}
                      disabled={!isEditing}
                      rows={5}
                      onChange={(event) => setFormData({ ...formData, descricao: event.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </label>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <label className="block">
                    <span className="block text-xs font-black uppercase tracking-wide text-slate-500 mb-1.5">ISS retido?</span>
                    <select
                      value={formData.issRetido}
                      disabled={!isEditing}
                      onChange={(event) => setFormData({ ...formData, issRetido: event.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-100"
                    >
                      <option value="false">Não</option>
                      <option value="true">Sim</option>
                    </select>
                  </label>
                  <InfoItem label="Base de cálculo" value={formatMoney(parseValor(formData.valor))} />
                  <InfoItem label="Valor líquido" value={formatMoney(parseValor(formData.valor))} />
                  <InfoItem label="Código municipal" value="Resolvido pela regra municipal" />
                </div>
              </SectionShell>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <SectionShell title="Tomador do serviço" subtitle="Hoje é leitura para conferência. Edição granular entra na próxima etapa." icon={User}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoItem label="CNPJ/CPF" value={venda.cliente.documento} mono />
                    <InfoItem label="Razão social" value={nomeTomador} />
                    <InfoItem label="CEP" value={venda.cliente.cep} mono />
                    <InfoItem label="Logradouro" value={venda.cliente.logradouro} />
                    <InfoItem label="Número" value={venda.cliente.numero} />
                    <InfoItem label="Bairro" value={venda.cliente.bairro} />
                    <InfoItem label="Município IBGE" value={venda.cliente.codigoIbge} mono />
                    <InfoItem label="Cidade/UF" value={`${fieldValue(venda.cliente.cidade)}/${fieldValue(venda.cliente.uf)}`} />
                  </div>
                </SectionShell>

                <SectionShell title="Local de prestação" subtitle="Essencial para rejeições de incidência do ISSQN." icon={MapPin}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoItem label="Código IBGE usado" value={venda.empresa.codigoIbge} mono />
                    <InfoItem label="Município/UF" value={`${fieldValue(venda.empresa.cidade)}/${fieldValue(venda.empresa.uf)}`} />
                    <InfoItem label="CEP" value={venda.empresa.cep} mono />
                    <InfoItem label="Logradouro" value={venda.empresa.logradouro} />
                    <InfoItem label="Bairro" value={venda.empresa.bairro} />
                    <InfoItem label="Número" value={venda.empresa.numero} />
                  </div>
                </SectionShell>
              </div>

              <SectionShell title="Blocos avançados reservados" subtitle="Estrutura preparada para casos que exigirem destinatário, imóvel, construção civil ou deduções." icon={Settings2}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {['Destinatário', 'Imóvel', 'Construção civil', 'Deduções'].map((label) => (
                    <div key={label} className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center">
                      <p className="text-sm font-black text-slate-700">{label}</p>
                      <p className="text-xs text-slate-500 mt-1">Não usado nesta versão</p>
                    </div>
                  ))}
                </div>
              </SectionShell>
            </div>
          )}

          {activeTab === 'validacao' && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-gradient-to-br from-white to-emerald-50/60 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-emerald-700 font-black uppercase tracking-[0.18em] text-[11px] mb-2">
                      <ShieldCheck size={16} /> Bancada interna
                    </div>
                    <h2 className="text-xl font-black text-slate-900">Validação técnica da emissão</h2>
                    <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                      Gere uma prévia do DPS, regras fiscais, payload e XML sem assinar nem transmitir ao Portal Nacional.
                    </p>
                  </div>
                  <button
                    onClick={executarInspecao}
                    disabled={inspecionando}
                    className="px-5 py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-70 transition shadow-sm flex items-center justify-center gap-2"
                  >
                    {inspecionando ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                    {inspecionando ? 'Validando...' : 'Executar validação'}
                  </button>
                </div>

                {!inspecao ? (
                  <div className="p-10 text-center">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mb-4">
                      <ShieldCheck size={26} />
                    </div>
                    <h3 className="font-bold text-slate-800">Nenhuma validação executada</h3>
                    <p className="text-sm text-slate-500 mt-1">Use os dados atuais da tela ou ajuste campos em Correção e execute a validação antes de reenviar.</p>
                  </div>
                ) : (
                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div className={`rounded-xl border p-4 ${inspecao.resumo.status === 'BLOQUEADO' ? 'bg-red-50 border-red-200' : inspecao.resumo.status === 'COM_ALERTAS' ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                        <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Resultado</p>
                        <p className={`text-lg font-black mt-1 ${inspecao.resumo.status === 'BLOQUEADO' ? 'text-red-700' : inspecao.resumo.status === 'COM_ALERTAS' ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {inspecao.resumo.status === 'BLOQUEADO' ? 'Bloqueado' : inspecao.resumo.status === 'COM_ALERTAS' ? 'Com alertas' : 'Apto'}
                        </p>
                      </div>
                      <InfoItem label="Bloqueios" value={inspecao.resumo.erros} />
                      <InfoItem label="Alertas" value={inspecao.resumo.alertas} />
                      <InfoItem label="Aprovados" value={inspecao.resumo.oks} />
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {Object.entries(checksAgrupados).map(([group, checks]) => (
                        <div key={group} className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-sm font-black text-slate-800">{group}</h3>
                            <span className="text-[10px] font-bold text-slate-500 uppercase">{(checks as any[]).length} itens</span>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {(checks as any[]).map((check) => {
                              const style = checkStyle(check.status);
                              return (
                                <div key={check.id} className={`p-4 ${style.bg}`}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-bold text-slate-900">{check.label}</p>
                                      <p className={`text-xs mt-1 leading-relaxed ${style.text}`}>{check.message}</p>
                                    </div>
                                    <span className={`shrink-0 text-[10px] font-black uppercase px-2 py-1 rounded-full border ${style.badge}`}>{style.label}</span>
                                  </div>
                                  {(check.tag || check.field) && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {check.tag && <code className="text-[10px] px-2 py-1 rounded bg-white/80 border border-slate-200 text-slate-600">{check.tag}</code>}
                                      {check.field && <code className="text-[10px] px-2 py-1 rounded bg-white/80 border border-slate-200 text-slate-600">{check.field}</code>}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'xml' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in duration-300">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Code size={14} className="text-orange-500" /> Estrutura XML
                  </span>
                  {xmlData.xmlDownload && (
                    <button onClick={() => downloadFile(xmlData.xmlDownload, `nota-${venda.id}.xml`)} className="text-[10px] font-bold text-blue-600 hover:underline uppercase">
                      Baixar XML
                    </button>
                  )}
                </div>
                <div className="bg-slate-900 rounded-xl shadow-inner border border-slate-700 p-4 overflow-auto text-xs font-mono text-orange-200 h-[600px] custom-scrollbar">
                  <pre className="whitespace-pre-wrap leading-relaxed">{xmlData.xmlExibicao || formatXml(venda.xmlNota) || formatXml(venda.xmlErro) || '// XML ainda não gerado para esta tentativa'}</pre>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <FileJson size={14} className="text-blue-500" /> Payload JSON
                  </span>
                  <button onClick={() => navigator.clipboard.writeText(xmlData.prettyPayload)} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase">
                    Copiar JSON
                  </button>
                </div>
                <div className="bg-[#0f172a] rounded-xl shadow-inner border border-slate-800 p-4 overflow-auto text-xs font-mono text-emerald-400 h-[600px] custom-scrollbar">
                  <pre className="whitespace-pre-wrap leading-relaxed">{xmlData.prettyPayload}</pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'retornos' && (
            <div className="space-y-4">
              {retornoLogs.length === 0 ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                  <CheckCircle className="mx-auto text-emerald-500" size={40} />
                  <h3 className="mt-3 font-black text-slate-900">Nenhum retorno de erro registrado</h3>
                  <p className="mt-1 text-sm text-slate-500">Quando o Portal retornar rejeições, elas aparecerão aqui em ordem cronológica.</p>
                </section>
              ) : (
                retornoLogs.map((log: any, index: number) => <RetornoCard key={log.id} log={log} index={index} />)
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
              <div className="overflow-y-auto p-5 space-y-4 custom-scrollbar max-h-[650px]">
                {venda.logs.length === 0 ? <p className="text-center text-gray-400 text-sm">Nenhum registro.</p> : venda.logs.map((log: any) => <LogRow key={log.id} log={log} />)}
              </div>
            </div>
          )}
        </div>

        <aside className="space-y-6">
          <section className={`rounded-2xl p-6 border shadow-sm ${venda.status === 'ERRO_EMISSAO' ? 'bg-red-50 border-red-200' : venda.status === 'PROCESSANDO' ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200'}`}>
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Status atual</h4>
            {venda.status === 'ERRO_EMISSAO' ? (
              <div>
                <div className="flex items-center gap-2 text-red-700 font-black text-lg mb-2">
                  <AlertTriangle /> Falha na emissão
                </div>
                <p className="text-sm text-red-700 mb-4 leading-relaxed">A emissão foi rejeitada ou houve falha de transmissão. Use Correção e Validação antes de reenviar.</p>
                <button onClick={startCorrection} className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition shadow-sm flex items-center justify-center gap-2">
                  <RefreshCw size={16} /> Corrigir agora
                </button>
              </div>
            ) : venda.status === 'CONCLUIDA' ? (
              <div>
                <div className="flex items-center gap-2 text-emerald-600 font-black text-lg mb-2">
                  <CheckCircle /> Autorizada
                </div>
                <p className="text-sm text-slate-600">Nota fiscal emitida com sucesso.</p>
              </div>
            ) : venda.status === 'PROCESSANDO' ? (
              <div>
                <div className="flex items-center gap-2 text-blue-600 font-black text-lg mb-2 animate-pulse">
                  <Activity /> Processando
                </div>
                <p className="text-sm text-blue-700">Aguardando retorno do Portal Nacional.</p>
              </div>
            ) : (
              <div className="text-slate-600 font-black text-lg">{venda.status.replace('_', ' ')}</div>
            )}
          </section>

          <SectionShell title="Ações rápidas" icon={Send}>
            <div className="space-y-2">
              <button onClick={validateAndOpen} className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-100 flex items-center justify-center gap-2">
                <ShieldCheck size={16} /> Validar DPS
              </button>
              <button onClick={() => setActiveTab('xml')} className="w-full rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm font-bold text-purple-700 hover:bg-purple-100 flex items-center justify-center gap-2">
                <FileCode2 size={16} /> Ver XML e JSON
              </button>
              <button onClick={() => setActiveTab('retornos')} className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700 hover:bg-amber-100 flex items-center justify-center gap-2">
                <ListChecks size={16} /> Ver retornos
              </button>
            </div>
          </SectionShell>

          <SectionShell title="Integridade fiscal" icon={FileText}>
            <div className="space-y-3">
              <InfoItem label="Chave de acesso" value={integridadePdf.chaveOk ? 'OK' : 'Pendente'} />
              <InfoItem label="XML oficial" value={integridadePdf.xmlOk ? 'OK' : 'Pendente'} />
              <InfoItem label="PDF salvo" value={integridadePdf.pdfOk ? 'OK' : 'Ausente'} />
              {podeReprocessarPdf ? (
                <button
                  onClick={reprocessarPdf}
                  disabled={reprocessandoPdf}
                  className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {reprocessandoPdf ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  {reprocessandoPdf ? 'Atualizando PDF...' : 'Atualizar PDF'}
                </button>
              ) : (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
                  {integridadePdf.pdfOk
                    ? 'PDF ja esta salvo para esta venda.'
                    : 'O botao sera liberado quando a nota tiver chave e XML oficial.'}
                </p>
              )}
            </div>
          </SectionShell>

          <SectionShell title="Histórico técnico" icon={History}>
            <div className="space-y-3">
              <InfoItem label="Logs registrados" value={venda.logs?.length || 0} />
              <InfoItem label="Retornos de erro" value={retornoLogs.length} />
              <InfoItem label="Último evento" value={venda.logs?.[0] ? `${venda.logs[0].action} em ${formatDate(venda.logs[0].createdAt)}` : 'Sem eventos'} />
            </div>
          </SectionShell>

          <SectionShell title="Competência" icon={CalendarDays}>
            <div className="space-y-3">
              <InfoItem label="Venda criada" value={formatDate(venda.createdAt)} />
              <InfoItem label="Data de emissão" value={notaAtual?.dataEmissao ? formatDate(notaAtual.dataEmissao) : 'Ainda não autorizada'} />
              <InfoItem label="Competência editável" value={formData.dataCompetencia || 'Usará regra atual'} />
            </div>
          </SectionShell>

          <SectionShell title="Valor fiscal" icon={Banknote}>
            <div className="space-y-3">
              <InfoItem label="Valor da venda" value={formatMoney(venda.valor)} />
              <InfoItem label="Valor em edição" value={formatMoney(parseValor(formData.valor))} />
              <InfoItem label="ISS retido" value={formData.issRetido === 'true' ? 'Sim' : 'Não'} />
            </div>
          </SectionShell>
        </aside>
      </main>
    </div>
  );
}
