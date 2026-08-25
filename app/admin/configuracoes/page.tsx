'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Edit3,
  Eye,
  Landmark,
  Loader2,
  Mail,
  Paperclip,
  Power,
  PlusCircle,
  Save,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

type AvisoGlobal = {
  id?: string;
  titulo: string;
  mensagem: string;
  tipo: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  status: 'RASCUNHO' | 'AGENDADO' | 'ATIVO' | 'PAUSADO' | 'ARQUIVADO';
  publico: 'TODOS' | 'CLIENTES' | 'CONTADORES';
  iniciaEm?: string;
  terminaEm?: string;
  linkLabel?: string;
  linkHref?: string;
  anexoNome?: string;
  anexoBase64?: string;
  notificarApp?: boolean;
  runtimeStatus?: string;
  updatedAt?: string;
  createdAt?: string;
};

const avisoInicial: AvisoGlobal = {
  titulo: '',
  mensagem: '',
  tipo: 'INFO',
  status: 'RASCUNHO',
  publico: 'TODOS',
  iniciaEm: '',
  terminaEm: '',
  linkLabel: '',
  linkHref: '',
  anexoNome: '',
  anexoBase64: '',
  notificarApp: false,
};

const MAX_AVISO_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export default function AdminConfig() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'FISCAL' | 'EMAIL' | 'MANUTENCAO' | 'AVISOS'>('FISCAL');
  const [config, setConfig] = useState<any>({});
  const [avisos, setAvisos] = useState<AvisoGlobal[]>([]);
  const [avisoForm, setAvisoForm] = useState<AvisoGlobal>(avisoInicial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [salvandoAviso, setSalvandoAviso] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; tipo: 'sucesso' | 'erro' } | null>(null);

  const showMessage = (texto: string, tipo: 'sucesso' | 'erro') => {
    setMsg({ texto, tipo });
    setTimeout(() => setMsg(null), 5000);
  };

  const carregarAvisos = async () => {
    const res = await fetch('/api/admin/avisos', { cache: 'no-store' });
    if (!res.ok) throw new Error('Erro ao carregar avisos');
    const data = await res.json();
    setAvisos(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/config'),
      fetch('/api/admin/avisos', { cache: 'no-store' }),
    ])
      .then(async ([configRes, avisosRes]) => {
        if (configRes.status === 401 || configRes.status === 403 || avisosRes.status === 401 || avisosRes.status === 403) {
          router.push('/login');
          throw new Error('Sem permissao');
        }
        if (!configRes.ok) throw new Error('Erro ao carregar configuracoes');

        const configData = await configRes.json();
        const avisosData = avisosRes.ok ? await avisosRes.json() : [];
        return { configData, avisosData };
      })
      .then(({ configData, avisosData }) => {
        setConfig(configData);
        setAvisos(Array.isArray(avisosData) ? avisosData : []);
      })
      .catch((err) => {
        console.error(err);
        if (err.message !== 'Sem permissao') {
          showMessage('Erro ao carregar dados do servidor.', 'erro');
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  const resetAvisoForm = () => setAvisoForm(avisoInicial);

  const editarAviso = (aviso: AvisoGlobal) => {
    setAvisoForm({
      ...aviso,
      iniciaEm: aviso.iniciaEm ? new Date(aviso.iniciaEm).toISOString().slice(0, 16) : '',
      terminaEm: aviso.terminaEm ? new Date(aviso.terminaEm).toISOString().slice(0, 16) : '',
      linkLabel: aviso.linkLabel || '',
      linkHref: aviso.linkHref || '',
      anexoNome: aviso.anexoNome || '',
      anexoBase64: aviso.anexoBase64 || '',
      notificarApp: aviso.notificarApp || false,
    });
    setActiveTab('AVISOS');
  };

  const handleAvisoFile = (file?: File | null) => {
    if (!file) return;
    if (file.size > MAX_AVISO_ATTACHMENT_BYTES) {
      showMessage('Use anexos de ate 2 MB para manter o carregamento leve.', 'erro');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvisoForm((prev) => ({
        ...prev,
        anexoNome: file.name,
        anexoBase64: String(reader.result || ''),
      }));
    };
    reader.readAsDataURL(file);
  };

  const salvarAviso = async () => {
    if (!avisoForm.titulo.trim() || !avisoForm.mensagem.trim()) {
      showMessage('Informe titulo e mensagem do aviso.', 'erro');
      return;
    }

    setSalvandoAviso(true);
    try {
      const res = await fetch('/api/admin/avisos', {
        method: avisoForm.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(avisoForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar aviso.');
      await carregarAvisos();
      resetAvisoForm();
      showMessage('Aviso salvo com sucesso.', 'sucesso');
    } catch (error: any) {
      showMessage(error.message || 'Erro ao salvar aviso.', 'erro');
    } finally {
      setSalvandoAviso(false);
    }
  };

  const arquivarAviso = async (id?: string) => {
    if (!id) return;
    if (!confirm('Arquivar este aviso? Ele deixara de aparecer para os clientes.')) return;

    try {
      const res = await fetch(`/api/admin/avisos?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao arquivar aviso.');
      await carregarAvisos();
      if (avisoForm.id === id) resetAvisoForm();
      showMessage('Aviso arquivado.', 'sucesso');
    } catch (error: any) {
      showMessage(error.message || 'Erro ao arquivar aviso.', 'erro');
    }
  };

  const persistConfig = async (
    nextConfig = config,
    successMessage = 'Configuracoes salvas com sucesso.',
    confirmarAlteracaoManutencao = false,
  ) => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nextConfig, confirmarAlteracaoManutencao }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig(data);
        showMessage(successMessage, 'sucesso');
        return true;
      }
      showMessage(`Erro ao salvar: ${data.error || 'Desconhecido'}`, 'erro');
      return false;
    } catch {
      showMessage('Erro de conexao com o servidor.', 'erro');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    void persistConfig();
  };

  const handleMaintenanceToggle = async (checked: boolean) => {
    const confirmed = window.confirm(checked
      ? 'Ativar o modo de manutenção agora? Clientes e contadores com sessão ativa serão direcionados para a página de atualização.'
      : 'Desativar o modo de manutenção e liberar novamente o acesso de clientes e contadores?');
    if (!confirmed) return;

    const previous = config;
    const next = { ...config, manutencaoAtiva: checked };
    setConfig(next);
    const saved = await persistConfig(
      next,
      checked ? 'Modo de manutenção ativado.' : 'Modo de manutenção desativado. Operação liberada.',
      true,
    );
    if (!saved) setConfig(previous);
  };

  const handleTestEmail = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/admin/config/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        showMessage(data.message, 'sucesso');
      } else {
        alert(`Falha no teste: ${data.details || data.error}`);
        showMessage(`Falha: ${data.error}`, 'erro');
      }
    } catch {
      alert('Erro de conexao ao tentar testar.');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500 flex-col gap-2">
        <Loader2 className="animate-spin text-blue-600" size={32} />
        <p>Carregando configuracoes...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl bg-slate-50">
      <div className="flex items-center gap-4 mb-8">
        <div className="p-3 bg-purple-600 text-white rounded-lg shadow-md">
          <Settings size={32} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Configuracoes do SaaS</h1>
          <p className="text-slate-500">Definicoes globais que afetam regras fiscais, envio de e-mails, comunicados e operacao do sistema.</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200 mb-6 overflow-x-auto">
        <button onClick={() => setActiveTab('FISCAL')} className={`pb-3 px-6 font-bold text-sm flex items-center gap-2 transition border-b-2 whitespace-nowrap ${activeTab === 'FISCAL' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Landmark size={18} /> Pilotagem Fiscal
        </button>
        <button onClick={() => setActiveTab('EMAIL')} className={`pb-3 px-6 font-bold text-sm flex items-center gap-2 transition border-b-2 whitespace-nowrap ${activeTab === 'EMAIL' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Mail size={18} /> Servidor de E-mail (SMTP)
        </button>
        <button onClick={() => setActiveTab('MANUTENCAO')} className={`pb-3 px-6 font-bold text-sm flex items-center gap-2 transition border-b-2 whitespace-nowrap ${activeTab === 'MANUTENCAO' ? 'border-amber-600 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Power size={18} /> Manutenção
        </button>
        <button onClick={() => setActiveTab('AVISOS')} className={`pb-3 px-6 font-bold text-sm flex items-center gap-2 transition border-b-2 whitespace-nowrap ${activeTab === 'AVISOS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Bell size={18} /> Avisos Globais
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 relative">
        {msg && (
          <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-lg text-sm font-bold shadow-2xl animate-in fade-in slide-in-from-top-4 flex items-center gap-3 border ${msg.tipo === 'sucesso' ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
            {msg.tipo === 'sucesso' ? <ShieldCheck size={20} className="text-green-600" /> : <AlertTriangle size={20} className="text-red-600" />}
            {msg.texto}
          </div>
        )}

        {activeTab === 'EMAIL' && (
          <EmailSettings
            config={config}
            setConfig={setConfig}
            saving={saving}
            testing={testing}
            handleSave={handleSave}
            handleTestEmail={handleTestEmail}
          />
        )}

        {activeTab === 'FISCAL' && (
          <FiscalSettings
            config={config}
            setConfig={setConfig}
            saving={saving}
            handleSave={handleSave}
          />
        )}

        {activeTab === 'MANUTENCAO' && (
          <MaintenanceSettings
            config={config}
            setConfig={setConfig}
            saving={saving}
            handleSave={handleSave}
            handleToggle={handleMaintenanceToggle}
          />
        )}

        {activeTab === 'AVISOS' && (
          <AvisosSettings
            avisos={avisos}
            avisoForm={avisoForm}
            setAvisoForm={setAvisoForm}
            salvandoAviso={salvandoAviso}
            resetAvisoForm={resetAvisoForm}
            editarAviso={editarAviso}
            handleAvisoFile={handleAvisoFile}
            salvarAviso={salvarAviso}
            arquivarAviso={arquivarAviso}
          />
        )}
      </div>
    </div>
  );
}

const regimesIbsCbs = [
  {
    field: 'ibsCbsMeiAtivo',
    label: 'MEI',
    description: 'Libera o grupo IBS/CBS para Microempreendedor Individual antes da obrigatoriedade.',
    defaultEnabled: false,
  },
  {
    field: 'ibsCbsSimplesAtivo',
    label: 'Simples Nacional',
    description: 'Libera o grupo para empresas optantes pelo Simples antes da obrigatoriedade.',
    defaultEnabled: false,
  },
  {
    field: 'ibsCbsLucroPresumidoAtivo',
    label: 'Lucro Presumido',
    description: 'Mantém o preenchimento da transição para empresas no Lucro Presumido.',
    defaultEnabled: true,
  },
  {
    field: 'ibsCbsLucroRealAtivo',
    label: 'Lucro Real',
    description: 'Mantém o preenchimento da transição para empresas no Lucro Real.',
    defaultEnabled: true,
  },
] as const;

function FiscalToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${checked ? 'bg-emerald-600' : 'bg-slate-300'} ${disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function MaintenanceSettings({
  config,
  setConfig,
  saving,
  handleSave,
  handleToggle,
}: {
  config: any;
  setConfig: (config: any) => void;
  saving: boolean;
  handleSave: () => void;
  handleToggle: (checked: boolean) => void;
}) {
  const active = Boolean(config.manutencaoAtiva);

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-left-4 duration-300">
      <div className={`flex flex-col gap-5 rounded-2xl border p-6 md:flex-row md:items-center md:justify-between ${active ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex gap-4">
          <div className={`h-fit rounded-full bg-white p-3 shadow-sm ring-1 ${active ? 'text-amber-700 ring-amber-200' : 'text-emerald-700 ring-emerald-100'}`}>
            <Power size={26} />
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-black text-slate-950">Modo de manutenção do SaaS</h3>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${active ? 'bg-amber-600 text-white' : 'bg-emerald-700 text-white'}`}>
                {active ? 'Acesso pausado' : 'Operacao normal'}
              </span>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-700">
              Quando ativo, clientes e contadores são direcionados para a página de atualização. Administradores e suporte continuam com acesso para acompanhar e liberar o sistema.
            </p>
          </div>
        </div>
        <FiscalToggle
          checked={active}
          disabled={saving}
          label={active ? 'Desativar modo de manutenção' : 'Ativar modo de manutenção'}
          onChange={handleToggle}
        />
      </div>

      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">Comunicação ao usuário</p>
        <h3 className="mt-1 text-xl font-black text-slate-900">Conteúdo da página de atualização</h3>
        <p className="mt-1 text-sm text-slate-500">Prepare a mensagem antes de ativar a chave. Campos vazios usam o texto padrão do SaaS.</p>
      </div>

      <div className="grid gap-5">
        <div>
          <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">Titulo principal</label>
          <input
            value={config.manutencaoTitulo || ''}
            maxLength={120}
            onChange={(event) => setConfig({ ...config, manutencaoTitulo: event.target.value })}
            placeholder="Estamos realizando uma atualização"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">Mensagem</label>
          <textarea
            value={config.manutencaoMensagem || ''}
            maxLength={1200}
            rows={5}
            onChange={(event) => setConfig({ ...config, manutencaoMensagem: event.target.value })}
            placeholder="Estamos trabalhando para deixar sua experiência ainda melhor."
            className="w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
          />
        </div>
        <div>
          <label className="mb-2 block text-xs font-black uppercase tracking-wide text-slate-600">Previsão ou próxima atualização</label>
          <input
            value={config.manutencaoPrevisao || ''}
            maxLength={160}
            onChange={(event) => setConfig({ ...config, manutencaoPrevisao: event.target.value })}
            placeholder="Ex.: Retorno previsto para hoje, às 22h"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
          />
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-950">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-blue-700" size={21} />
          <p><strong>Proteção operacional:</strong> sessões abertas verificam o estado a cada 30 segundos e ao voltar para a aba. Uma sessão expirada é encerrada e enviada ao login, sem deixar a tela congelada.</p>
        </div>
      </div>

      <div className="flex flex-col justify-end gap-3 border-t border-slate-200 pt-5 sm:flex-row">
        <button onClick={() => window.open('/manutencao?preview=1', '_blank', 'noopener,noreferrer')} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50">
          <Eye size={17} /> Pré-visualizar página
        </button>
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-black text-white shadow-lg transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
          Salvar texto da manutenção
        </button>
      </div>
    </div>
  );
}

function FiscalSettings({
  config,
  setConfig,
  saving,
  handleSave,
}: {
  config: any;
  setConfig: (config: any) => void;
  saving: boolean;
  handleSave: () => void;
}) {
  const masterEnabled = config.ibsCbsPilotoAtivo ?? true;

  return (
    <div className="space-y-7 animate-in fade-in slide-in-from-left-4 duration-300">
      <div className="flex flex-col gap-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-4">
          <div className="h-fit rounded-full border border-emerald-100 bg-white p-3 text-emerald-700 shadow-sm">
            <Landmark size={26} />
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-black text-emerald-950">Preenchimento de IBS e CBS</h3>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${masterEnabled ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-600'}`}>
                {masterEnabled ? 'Piloto ativo' : 'Piloto pausado'}
              </span>
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-emerald-900">
              A chave geral controla a antecipação no SaaS. Depois dela, escolha quais regimes participam do piloto.
            </p>
          </div>
        </div>
        <FiscalToggle
          checked={masterEnabled}
          label="Ativar pilotagem global de IBS e CBS"
          onChange={(checked) => setConfig({ ...config, ibsCbsPilotoAtivo: checked })}
        />
      </div>

      <div>
        <div className="mb-4">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Liberação por regime</p>
          <h3 className="text-xl font-black text-slate-900">Quem participa da antecipação</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {regimesIbsCbs.map((regime) => {
            const enabled = config[regime.field] ?? regime.defaultEnabled;
            return (
              <div key={regime.field} className={`flex items-start justify-between gap-4 rounded-xl border p-5 transition ${masterEnabled ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'}`}>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <strong className="text-sm text-slate-900">{regime.label}</strong>
                    <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${enabled && masterEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                      {enabled && masterEnabled ? 'Liberado' : 'Aguardando'}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500">{regime.description}</p>
                </div>
                <FiscalToggle
                  checked={enabled}
                  disabled={!masterEnabled}
                  label={`Ativar IBS e CBS para ${regime.label}`}
                  onChange={(checked) => setConfig({ ...config, [regime.field]: checked })}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0 text-amber-700" size={21} />
          <div>
            <strong>Trava de conformidade</strong>
            <p className="mt-1 leading-relaxed">
              Desligar uma chave pausa somente a antecipação. Quando a operação atingir a data oficial de obrigatoriedade, o motor fiscal preencherá IBS/CBS automaticamente e registrará a origem da decisão na nota.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <strong className="text-sm text-slate-900">Exceções específicas</strong>
          <p className="mt-1 text-xs text-slate-500">Município e CNAE continuam disponíveis para ajustes pontuais, subordinados às chaves acima e à obrigatoriedade legal.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/admin/cnaes" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Regras por CNAE</a>
          <a href="/admin/tributacao-municipal" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">Regras municipais</a>
        </div>
      </div>

      <div className="flex justify-end border-t border-slate-100 pt-6">
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-700 px-8 py-4 font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-emerald-800 disabled:opacity-50">
          {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          {saving ? 'Salvando...' : 'Salvar pilotagem fiscal'}
        </button>
      </div>
    </div>
  );
}

function EmailSettings({
  config,
  setConfig,
  saving,
  testing,
  handleSave,
  handleTestEmail,
}: {
  config: any;
  setConfig: (config: any) => void;
  saving: boolean;
  testing: boolean;
  handleSave: () => void;
  handleTestEmail: () => void;
}) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-left-4 duration-300">
      <div className="bg-purple-50 p-5 rounded-lg border border-purple-100 flex gap-4">
        <div className="p-2 bg-white rounded-full h-fit text-purple-600 shadow-sm border border-purple-100">
          <Server size={24} />
        </div>
        <div>
          <h3 className="font-bold text-purple-900 text-lg">Configuracao do Servidor de Saida</h3>
          <p className="text-sm text-purple-800 mt-1 opacity-90 leading-relaxed">
            Configure o provedor que enviara os e-mails do sistema. Use o botao de teste para validar a conexao.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Host SMTP</label>
            <input className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" placeholder="ex: smtp.gmail.com" value={config.smtpHost || ''} onChange={e => setConfig({ ...config, smtpHost: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Porta</label>
            <input type="number" className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" placeholder="587" value={config.smtpPort || ''} onChange={e => setConfig({ ...config, smtpPort: parseInt(e.target.value, 10) })} />
          </div>
          <label className="flex items-center gap-3 cursor-pointer p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition select-none bg-white shadow-sm">
            <input type="checkbox" checked={config.smtpSecure || false} onChange={e => setConfig({ ...config, smtpSecure: e.target.checked })} className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500" />
            <div>
              <span className="block text-sm font-bold text-slate-700">Usar Conexao Segura (SSL/TLS)</span>
              <span className="block text-xs text-slate-400">Recomendado para porta 465.</span>
            </div>
          </label>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Usuario / E-mail de Login</label>
            <input className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" value={config.smtpUser || ''} placeholder="usuario@provedor.com" onChange={e => setConfig({ ...config, smtpUser: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Senha do E-mail</label>
            <input type="password" className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" placeholder="********" onChange={e => setConfig({ ...config, smtpPass: e.target.value })} />
            <p className="text-[10px] text-orange-500 mt-1 ml-1 font-medium">Deixe em branco para manter a senha atual salva.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Remetente Personalizado (Campo From)</label>
            <input className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-500 outline-none" placeholder="ex: nao-responda@seusistema.com" value={config.emailRemetente || ''} onChange={e => setConfig({ ...config, emailRemetente: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="pt-8 mt-8 border-t border-gray-100 flex justify-end gap-3">
        <button onClick={handleTestEmail} disabled={testing} className="px-6 py-4 rounded-xl text-purple-700 bg-purple-50 font-bold flex items-center gap-2 border border-purple-100 hover:bg-purple-100 transition disabled:opacity-50">
          {testing ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
          {testing ? 'Testando...' : 'Testar Conexao'}
        </button>
        <button onClick={handleSave} disabled={saving} className="px-8 py-4 rounded-xl text-white font-bold flex items-center gap-2 shadow-lg transition transform hover:-translate-y-0.5 disabled:opacity-50 bg-purple-600 hover:bg-purple-700">
          {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
          {saving ? 'Salvando...' : 'Salvar Configuracoes'}
        </button>
      </div>
    </div>
  );
}

function AvisosSettings({
  avisos,
  avisoForm,
  setAvisoForm,
  salvandoAviso,
  resetAvisoForm,
  editarAviso,
  handleAvisoFile,
  salvarAviso,
  arquivarAviso,
}: {
  avisos: AvisoGlobal[];
  avisoForm: AvisoGlobal;
  setAvisoForm: (aviso: AvisoGlobal) => void;
  salvandoAviso: boolean;
  resetAvisoForm: () => void;
  editarAviso: (aviso: AvisoGlobal) => void;
  handleAvisoFile: (file?: File | null) => void;
  salvarAviso: () => void;
  arquivarAviso: (id?: string) => void;
}) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="bg-blue-50 p-5 rounded-lg border border-blue-100 flex gap-4">
        <div className="p-2 bg-white rounded-full h-fit text-blue-600 shadow-sm border border-blue-100">
          <Bell size={24} />
        </div>
        <div>
          <strong className="text-blue-950">Bancada de avisos globais</strong>
          <p className="text-sm text-blue-800 mt-1 opacity-90 leading-relaxed">
            Crie comunicados, alertas automaticos e anexos para aparecerem na central de notificacoes dos clientes.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Editor</p>
              <h3 className="text-xl font-black text-slate-900">{avisoForm.id ? 'Editar aviso' : 'Novo aviso'}</h3>
            </div>
            <button onClick={resetAvisoForm} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
              <PlusCircle size={17} /> Novo
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Titulo</label>
              <input className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" value={avisoForm.titulo} onChange={e => setAvisoForm({ ...avisoForm, titulo: e.target.value })} placeholder="Ex: Portal Nacional instavel" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Tipo</label>
              <select className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white" value={avisoForm.tipo} onChange={e => setAvisoForm({ ...avisoForm, tipo: e.target.value as AvisoGlobal['tipo'] })}>
                <option value="INFO">Informativo</option>
                <option value="SUCCESS">Sucesso</option>
                <option value="WARNING">Atencao</option>
                <option value="CRITICAL">Critico</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Publico</label>
              <select className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white" value={avisoForm.publico} onChange={e => setAvisoForm({ ...avisoForm, publico: e.target.value as AvisoGlobal['publico'] })}>
                <option value="TODOS">Todos os clientes</option>
                <option value="CLIENTES">Usuarios cliente</option>
                <option value="CONTADORES">Contadores</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Inicio da exibicao</label>
              <input type="datetime-local" className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" value={avisoForm.iniciaEm || ''} onChange={e => setAvisoForm({ ...avisoForm, iniciaEm: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Fim da exibicao</label>
              <input type="datetime-local" className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" value={avisoForm.terminaEm || ''} onChange={e => setAvisoForm({ ...avisoForm, terminaEm: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Status</label>
              <select className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white" value={avisoForm.status} onChange={e => setAvisoForm({ ...avisoForm, status: e.target.value as AvisoGlobal['status'] })}>
                <option value="RASCUNHO">Rascunho</option>
                <option value="AGENDADO">Agendado</option>
                <option value="ATIVO">Ativo</option>
                <option value="PAUSADO">Pausado</option>
              </select>
            </div>
            <label className="flex h-[50px] cursor-pointer items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 text-sm font-bold text-blue-900 hover:bg-blue-100">
              <input
                type="checkbox"
                checked={avisoForm.notificarApp || false}
                onChange={e => setAvisoForm({ ...avisoForm, notificarApp: e.target.checked })}
                className="h-5 w-5 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Notificar no app</span>
            </label>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Arquivo opcional</label>
              <label className="flex h-[50px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                <span className="truncate">{avisoForm.anexoNome || 'Selecionar anexo'}</span>
                <Paperclip size={17} />
                <input type="file" className="hidden" onChange={e => handleAvisoFile(e.target.files?.[0])} />
              </label>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Texto do botao</label>
              <input className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" value={avisoForm.linkLabel || ''} onChange={e => setAvisoForm({ ...avisoForm, linkLabel: e.target.value })} placeholder="Ex: Abrir guia" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Link do botao</label>
              <input className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" value={avisoForm.linkHref || ''} onChange={e => setAvisoForm({ ...avisoForm, linkHref: e.target.value })} placeholder="/central-ajuda ou https://..." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Mensagem</label>
              <textarea rows={5} className="w-full p-4 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none" value={avisoForm.mensagem} onChange={e => setAvisoForm({ ...avisoForm, mensagem: e.target.value })} placeholder="Mensagem clara para o usuario final." />
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-100 pt-5">
            {avisoForm.anexoNome ? (
              <button onClick={() => setAvisoForm({ ...avisoForm, anexoNome: '', anexoBase64: '' })} className="inline-flex items-center gap-2 text-sm font-bold text-red-600 hover:text-red-700">
                <Trash2 size={16} /> Remover anexo
              </button>
            ) : <span className="text-xs text-slate-400">Anexos ficam salvos junto do aviso.</span>}
            <button onClick={salvarAviso} disabled={salvandoAviso} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-black text-white shadow-lg shadow-blue-100 hover:bg-blue-700 disabled:opacity-50">
              {salvandoAviso ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
              {avisoForm.id ? 'Atualizar aviso' : 'Salvar aviso'}
            </button>
          </div>
        </div>

        <div className="space-y-5">
          <AvisoPreview aviso={avisoForm} />
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-center gap-2 text-sm font-black text-slate-800">
              <CalendarClock size={18} className="text-blue-600" /> Regra de exibicao
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              So avisos ativos dentro da janela de datas aparecem no dashboard. Se houver varios, o cliente vera os mais recentes primeiro e podera expandir a lista.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Historico</p>
            <h3 className="text-lg font-black text-slate-900">Avisos cadastrados</h3>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">{avisos.length}</span>
        </div>
        <div className="divide-y divide-slate-100">
          {avisos.length === 0 ? (
            <div className="p-8 text-sm text-slate-500">Nenhum aviso criado ainda.</div>
          ) : avisos.map((aviso) => (
            <div key={aviso.id} className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${getNoticeTone(aviso.tipo).badge}`}>{aviso.tipo}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">{aviso.status}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">{aviso.publico}</span>
                  {aviso.notificarApp && <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-black text-blue-700">APP</span>}
                </div>
                <h4 className="mt-3 font-black text-slate-900">{aviso.titulo}</h4>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">{aviso.mensagem}</p>
                <p className="mt-2 text-xs font-bold text-slate-400">{formatNoticeWindow(aviso)}</p>
              </div>
              <div className="flex items-center gap-2 lg:justify-end">
                <button onClick={() => editarAviso(aviso)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
                  <Edit3 size={16} /> Editar
                </button>
                {aviso.status !== 'ARQUIVADO' && (
                  <button onClick={() => arquivarAviso(aviso.id)} className="inline-flex items-center gap-2 rounded-xl border border-red-100 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50">
                    <Trash2 size={16} /> Arquivar
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function getNoticeTone(tipo?: string) {
  if (tipo === 'CRITICAL') return { card: 'border-red-200 bg-red-50 text-red-900', badge: 'bg-red-100 text-red-700' };
  if (tipo === 'WARNING') return { card: 'border-amber-200 bg-amber-50 text-amber-900', badge: 'bg-amber-100 text-amber-700' };
  if (tipo === 'SUCCESS') return { card: 'border-emerald-200 bg-emerald-50 text-emerald-900', badge: 'bg-emerald-100 text-emerald-700' };
  return { card: 'border-blue-200 bg-blue-50 text-blue-900', badge: 'bg-blue-100 text-blue-700' };
}

function formatNoticeWindow(aviso: AvisoGlobal) {
  const format = (value?: string) => value
    ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;
  const inicio = format(aviso.iniciaEm);
  const fim = format(aviso.terminaEm);
  if (inicio && fim) return `Exibe de ${inicio} ate ${fim}`;
  if (inicio) return `Exibe a partir de ${inicio}`;
  if (fim) return `Exibe ate ${fim}`;
  return 'Sem janela definida';
}

function AvisoPreview({ aviso }: { aviso: AvisoGlobal }) {
  const tone = getNoticeTone(aviso.tipo);
  const titulo = aviso.titulo || 'Titulo do aviso';
  const mensagem = aviso.mensagem || 'A mensagem aparecera aqui na central de notificacoes do cliente.';
  const action = aviso.linkLabel || (aviso.anexoNome ? 'Ver anexo' : 'Ver aviso');

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-800">
        <Eye size={18} className="text-blue-600" /> Previa no dashboard
      </div>
      <div className={`rounded-xl border p-4 ${tone.card}`}>
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-white/75 p-2">
            <Bell size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-black">{titulo}</h3>
            <p className="mt-1 text-xs leading-5 opacity-80">{mensagem}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-black">
              {action}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-400">{formatNoticeWindow(aviso)}</p>
      {aviso.notificarApp && <p className="mt-2 text-xs font-bold text-blue-600">Tambem entrara no sino do app.</p>}
    </div>
  );
}
