'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Edit3,
  Eye,
  Loader2,
  Mail,
  Paperclip,
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
};

const MAX_AVISO_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export default function AdminConfig() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'EMAIL' | 'AVISOS'>('EMAIL');
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

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok) showMessage('Configuracoes salvas com sucesso.', 'sucesso');
      else showMessage(`Erro ao salvar: ${data.error || 'Desconhecido'}`, 'erro');
    } catch {
      showMessage('Erro de conexao com o servidor.', 'erro');
    } finally {
      setSaving(false);
    }
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
    <div className="p-6 md:p-10 max-w-6xl mx-auto min-h-screen bg-slate-50">
      <div className="flex items-center gap-4 mb-8">
        <div className="p-3 bg-purple-600 text-white rounded-lg shadow-md">
          <Settings size={32} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Configuracoes do SaaS</h1>
          <p className="text-slate-500">Definicoes globais que afetam envio de e-mails, comunicados e operacao do sistema.</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200 mb-6 overflow-x-auto">
        <button onClick={() => setActiveTab('EMAIL')} className={`pb-3 px-6 font-bold text-sm flex items-center gap-2 transition border-b-2 whitespace-nowrap ${activeTab === 'EMAIL' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
          <Mail size={18} /> Servidor de E-mail (SMTP)
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
    </div>
  );
}
