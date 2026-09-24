'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, FileSearch, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';

type PrivacyRequest = {
  id: string;
  type: string;
  status: string;
  description: string | null;
  dueAt: string;
  resolutionSummary: string | null;
  legalBasis: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

type Overview = {
  controllerContact: string;
  treatmentExists: boolean;
  currentPolicyVersion: string;
  account: { nome: string; email: string; cpf: string | null; telefone: string | null; createdAt: string };
  counts: { activeSessions: number; companies: number; plans: number; orders: number; invoices: number; tickets: number };
  requests: PrivacyRequest[];
};

const requestTypes = [
  ['ACESSO', 'Acesso e confirmação', 'Receber confirmação e informações completas sobre o tratamento.'],
  ['CORRECAO', 'Correção', 'Corrigir dado pessoal incompleto, inexato ou desatualizado.'],
  ['ELIMINACAO', 'Eliminação ou anonimização', 'Solicitar eliminação quando não houver obrigação legítima de retenção.'],
  ['PORTABILIDADE', 'Portabilidade', 'Solicitar os dados em formato estruturado, quando aplicável.'],
  ['REVOGACAO_CONSENTIMENTO', 'Revogação de consentimento', 'Revogar um consentimento específico, sem afetar tratamentos com outra base legal.'],
  ['OPOSICAO', 'Oposição', 'Questionar tratamento que considere irregular.'],
  ['REVISAO_AUTOMATIZADA', 'Revisão de decisão automatizada', 'Pedir explicações ou revisão de decisão exclusivamente automatizada.'],
  ['INFORMACAO_COMPARTILHAMENTO', 'Compartilhamento', 'Saber com quais entidades seus dados são compartilhados.'],
] as const;

const statusLabels: Record<string, string> = {
  PENDENTE: 'Recebida', EM_ANALISE: 'Em análise', AGUARDANDO_TITULAR: 'Aguardando você',
  CONCLUIDA: 'Concluída', RECUSADA: 'Não atendida',
};

async function responseMessage(response: Response, fallback: string) {
  try { const data = await response.json(); return data.error || data.message || fallback; } catch { return fallback; }
}

export default function PrivacidadePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [type, setType] = useState('ACESSO');
  const [description, setDescription] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await fetch('/api/privacidade/solicitacoes', { cache: 'no-store' });
    if (!response.ok) throw new Error(await responseMessage(response, 'Não foi possível carregar sua central de privacidade.'));
    setOverview(await response.json());
  };

  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : 'Falha de conexão.')); }, []);

  const selected = useMemo(() => requestTypes.find(item => item[0] === type), [type]);

  const submit = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/privacidade/solicitacoes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, description: description.trim() || null, password }) });
      if (!response.ok) throw new Error(await responseMessage(response, 'Não foi possível registrar a solicitação.'));
      const result = await response.json();
      setPassword(''); setDescription(''); setMessage(`${result.message} Protocolo: ${result.request.id}`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha de conexão.'); }
    finally { setBusy(false); }
  };

  const download = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/privacidade/exportar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!response.ok) throw new Error(await responseMessage(response, 'Não foi possível gerar a cópia.'));
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'meus-dados.json';
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      setPassword(''); setMessage('Cópia dos seus dados gerada neste dispositivo. Guarde o arquivo em local seguro.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Falha de conexão.'); }
    finally { setBusy(false); }
  };

  const inputClass = 'mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-black text-blue-700">NFSe Goo · LGPD</p><h1 className="mt-1 flex items-center gap-2 text-3xl font-black"><ShieldCheck /> Seus dados e sua privacidade</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Consulte o que mantemos sobre sua conta, obtenha uma cópia imediata ou protocole gratuitamente um direito do titular. A solicitação fica registrada e acompanhável nesta página.</p></div>
        <Link href="/cliente/dashboard" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-blue-700">Voltar ao painel</Link>
      </header>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">{message}</p>}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
          <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">Resumo da conta</h2><button type="button" onClick={() => void load().catch(cause => setError(cause.message))} className="flex items-center gap-1 text-sm font-bold text-blue-700"><RefreshCw size={16} /> Atualizar</button></div>
          {!overview ? <p className="mt-4 text-sm text-slate-500">Carregando informações…</p> : <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <p><span className="font-bold">Titular:</span> {overview.account.nome}</p><p><span className="font-bold">E-mail:</span> {overview.account.email}</p>
            <p><span className="font-bold">Empresas sob responsabilidade:</span> {overview.counts.companies}</p><p><span className="font-bold">Sessões ativas:</span> {overview.counts.activeSessions}</p>
            <p><span className="font-bold">Históricos de plano:</span> {overview.counts.plans}</p><p><span className="font-bold">Pedidos e faturas:</span> {overview.counts.orders + overview.counts.invoices}</p>
          </div>}
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><LockKeyhole className="text-blue-700" /><h2 className="mt-3 font-black">Confirmação de identidade</h2><p className="mt-2 text-sm leading-6 text-blue-950">Sua senha atual é exigida para exportar ou abrir um protocolo. Ela é conferida e nunca incluída no arquivo.</p>
          <a href={`mailto:${overview?.controllerContact || 'privacidade@nfsegoo.com.br'}`} className="mt-3 block break-all text-sm font-black text-blue-800">{overview?.controllerContact || 'privacidade@nfsegoo.com.br'}</a></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="flex items-center gap-2 text-xl font-black"><Download size={21} /> Cópia imediata dos dados</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Baixe um JSON com cadastro, aceites, sessões, histórico comercial, suporte e vínculos diretamente associados. Para grande volume ou informação adicional, protocole “Acesso” ou “Portabilidade”.</p>
        <label htmlFor="privacy-password" className="mt-4 block max-w-md text-sm font-bold">Senha atual<input id="privacy-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className={inputClass} /></label>
        <button type="button" disabled={busy || !password} onClick={() => void download()} className="mt-4 rounded-xl bg-blue-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50">Baixar meus dados</button>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 className="flex items-center gap-2 text-xl font-black"><FileSearch size={21} /> Exercer um direito</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <label htmlFor="privacy-type" className="text-sm font-bold">Tipo de solicitação<select id="privacy-type" value={type} onChange={event => setType(event.target.value)} className={inputClass}>{requestTypes.map(item => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select><span className="mt-2 block font-normal leading-5 text-slate-500">{selected?.[2]}</span></label>
          <label htmlFor="privacy-request-password" className="text-sm font-bold">Confirme sua senha<input id="privacy-request-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className={inputClass} /></label>
        </div>
        <label htmlFor="privacy-description" className="mt-5 block text-sm font-bold">Detalhes (opcional)<textarea id="privacy-description" rows={4} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} className={inputClass} placeholder="Explique quais dados, tratamento ou correção deseja tratar." /></label>
        <div className="mt-4 flex flex-wrap items-center gap-4"><button type="button" disabled={busy || !password} onClick={() => void submit()} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white disabled:opacity-50">Registrar solicitação</button><p className="text-xs leading-5 text-slate-500">Prazo padrão de resposta completa: até 15 dias, salvo prazo legal específico. Retenções legais e fiscais podem limitar a eliminação.</p></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><h2 className="text-xl font-black">Meus protocolos</h2>
        {!overview?.requests.length ? <p className="mt-4 text-sm text-slate-500">Nenhuma solicitação registrada.</p> : <ul className="mt-4 space-y-3">{overview.requests.map(item => <li key={item.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black">{requestTypes.find(typeItem => typeItem[0] === item.type)?.[1] || item.type}</p><p className="mt-1 break-all font-mono text-xs text-slate-500">{item.id}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black">{statusLabels[item.status] || item.status}</span></div>
          <p className="mt-3 text-xs text-slate-500">Registrada em {new Date(item.createdAt).toLocaleString('pt-BR')} · prazo indicado {new Date(item.dueAt).toLocaleDateString('pt-BR')}</p>
          {item.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>}
          {item.resolutionSummary && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-950"><span className="font-black">Resposta:</span> {item.resolutionSummary}{item.legalBasis && <p className="mt-2"><span className="font-black">Fundamento:</span> {item.legalBasis}</p>}</div>}
        </li>)}</ul>}
      </section>

      <p className="text-center text-xs text-slate-500">Leia também a <Link href="/politica-de-privacidade" className="font-bold text-blue-700 underline">Política de Privacidade</Link>.</p>
    </div>
  </main>;
}
