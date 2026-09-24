'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Archive, Building2, ChevronLeft, ChevronRight, Database, Edit, Loader2, RefreshCw, RotateCcw, Search, Users } from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';
import Link from 'next/link';

const fields = [
  ['razaoSocial', 'Razão social / nome', 200], ['nomeFantasia', 'Nome fantasia', 200],
  ['inscricaoMunicipal', 'Inscrição municipal', 30], ['email', 'E-mail comercial', 254],
  ['cep', 'CEP / código postal', 11], ['logradouro', 'Logradouro', 200], ['numero', 'Número', 20],
  ['complemento', 'Complemento', 100], ['bairro', 'Bairro', 100], ['cidade', 'Cidade', 100],
  ['uf', 'UF / estado / província', 50], ['codigoIbge', 'Código IBGE (nacional)', 7],
] as const;
const publicFields = ['razaoSocial', 'nomeFantasia', 'cep', 'logradouro', 'numero', 'complemento',
  'bairro', 'cidade', 'uf', 'codigoIbge'] as const;
type Field = typeof fields[number][0];
type PublicField = typeof publicFields[number];
type Item = { id: string; origem: 'PRESTADOR'; documento: string; razaoSocial: string; updatedAt: string; archived: boolean;
  ambiente?: string; lastApiCheck?: string | null; proprietarioUser?: { nome: string; email: string } | null;
  donoUser?: { nome: string; email: string } | null } & Partial<Record<Field, string | null>>;
type PublicPreview = { data: Record<PublicField, string | null>; fonte: string; consultedAt: string;
  sourceHash: string; expectedUpdatedAt: string };

const labels = Object.fromEntries(fields.map(([field, label]) => [field, label])) as Record<Field, string>;
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 disabled:bg-slate-100';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold disabled:opacity-50';

export default function BaseEmpresas() {
  const dialog = useDialog();
  const [items, setItems] = useState<Item[]>([]); const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState<Record<string, string>>({}); const [preview, setPreview] = useState<PublicPreview | null>(null);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState('');
  const [state, setState] = useState('ATIVOS'); const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1); const [total, setTotal] = useState(0);
  const [search, setSearch] = useState(''); const [revision, setRevision] = useState(0);
  const [password, setPassword] = useState(''); const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [operationError, setOperationError] = useState(''); const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError('');
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: String(page), limit: '10', type: 'PRESTADOR', state, search });
        const response = await fetch('/api/admin/empresas?' + params, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível consultar os cadastros.');
        if (!Array.isArray(result.data) || !result.meta || !Number.isSafeInteger(result.meta.total)) throw new Error('Resposta incompleta. Recarregue a consulta.');
        if (!controller.signal.aborted) {
          setItems(result.data); setTotal(result.meta.total); setTotalPages(result.meta.totalPages);
          if (page > result.meta.totalPages) setPage(result.meta.totalPages);
        }
      } catch (error) { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Falha de conexão.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page, search, state, revision]);

  const changed = useMemo(() => editing ? Object.fromEntries(fields.flatMap(([field]) => {
    const value = form[field] ?? ''; const original = editing[field] ?? '';
    return value === original ? [] : [[field, value]];
  })) : {}, [editing, form]);
  const hasPendingChanges = Boolean(editing && (Object.keys(changed).length || preview || justification.trim() || password));

  function open(item: Item) {
    setEditing(item); setForm(Object.fromEntries(fields.map(([key]) => [key, item[key] ?? ''])));
    setPassword(''); setJustification(''); setPreview(null); setOperationError(''); setMessage('');
  }
  function focusReview(id: string) {
    window.setTimeout(() => document.getElementById('company-review-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }
  async function requestOpen(item: Item) {
    if (busyRef.current) return;
    if (editing?.id === item.id) { focusReview(item.id); return; }
    if (hasPendingChanges && editing) {
      const discard = await dialog.showConfirm({ type: 'warning', title: 'Alterações não salvas',
        description: `Existem ajustes ainda não concluídos em ${editing.razaoSocial}. Descarte-os para revisar ${item.razaoSocial}, ou volte para concluir.`,
        confirmText: 'Descartar e abrir', cancelText: 'Voltar à revisão' });
      if (!discard) { focusReview(editing.id); return; }
    }
    open(item); focusReview(item.id);
  }
  async function requestClose() {
    if (!editing || busyRef.current) return;
    if (hasPendingChanges && !await dialog.showConfirm({ type: 'warning', title: 'Descartar alterações não salvas?',
      description: 'Os campos editados, a prévia pública e a confirmação ainda não aplicada serão descartados.',
      confirmText: 'Descartar e fechar', cancelText: 'Continuar ajustando' })) return;
    setEditing(null); setPreview(null); setPassword(''); setJustification(''); setOperationError('');
  }

  async function mutate(action: 'UPDATE' | 'ARCHIVE' | 'RESTORE' | 'REFRESH') {
    if (busyRef.current || !editing) return;
    busyRef.current = true; setBusy(true); setOperationError(''); setMessage('');
    try {
      if (action === 'ARCHIVE' || action === 'RESTORE') {
        const confirmed = await dialog.showConfirm({ title: action === 'ARCHIVE' ? 'Arquivar este cadastro?' : 'Restaurar este cadastro?',
          description: action === 'ARCHIVE' ? `Cadastro: ${editing.razaoSocial}. Não haverá exclusão de documentos nem cancelamento fiscal.`
            : `Cadastro: ${editing.razaoSocial}. Os vínculos existentes serão preservados e as cotas conferidas.`,
          confirmText: action === 'ARCHIVE' ? 'Confirmar arquivamento' : 'Confirmar restauração', type: 'warning' });
        if (!confirmed) return;
      }
      const response = await fetch('/api/admin/empresas', { method: action === 'ARCHIVE' ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, origem: editing.origem,
          expectedUpdatedAt: editing.updatedAt, action, ...(action === 'UPDATE' ? { data: changed } : {}),
          ...(action === 'REFRESH' ? { sourceHash: preview?.sourceHash } : {}), adminPassword: password, justification }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Operação não concluída.');
      setEditing(null); setPreview(null); setJustification(''); setRevision(value => value + 1);
      setMessage(action === 'REFRESH' ? 'Fonte pública aplicada ao prestador e registrada na auditoria.'
        : action === 'ARCHIVE' ? 'Cadastro arquivado. Os dados foram preservados.'
          : action === 'RESTORE' ? 'Cadastro restaurado.' : 'Cadastro atualizado e operação registrada na auditoria.');
    } catch (error) { setOperationError(error instanceof Error ? error.message : 'Falha de conexão. Recarregue antes de repetir.'); }
    finally { setPassword(''); busyRef.current = false; setBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = (((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value || 'UPDATE') as 'UPDATE' | 'ARCHIVE' | 'RESTORE';
    await mutate(action);
  }
  async function consultPublicSource() {
    if (!editing || busyRef.current) return;
    busyRef.current = true; setBusy(true); setOperationError(''); setMessage(''); setPreview(null);
    try {
      const response = await fetch('/api/admin/empresas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, expectedUpdatedAt: editing.updatedAt }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível consultar a fonte pública.');
      setPreview(result); setMessage('Consulta concluída. Confira as diferenças antes de aplicar.');
    } catch (error) { setOperationError(error instanceof Error ? error.message : 'Falha de conexão.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <header><h1 className="text-2xl font-black text-slate-900">Empresas prestadoras</h1>
      <p className="mt-2 text-sm text-slate-600">Manutenção administrativa auditada dos prestadores, com atualização cadastral manual ou por fonte pública.</p></header>
    <div className="flex flex-wrap gap-3"><button className={buttonClass} aria-pressed="true" disabled><Building2 size={18} /> Prestadores</button>
      <Link className={buttonClass} href="/admin/tomadores"><Users size={18} /> Identidades de tomadores</Link></div>
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">Em cada campo prevalece a atualização mais recente. A consulta pública não altera inscrição municipal, e-mail, certificado, ambiente, numeração ou parâmetros fiscais.</div>
    <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_220px]">
      <div><label htmlFor="company-search" className="mb-1 flex items-center gap-2 text-sm font-bold"><Search size={16} /> Buscar por nome ou documento</label>
        <input id="company-search" className={inputClass} value={search} maxLength={120} disabled={busy} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      <div><label htmlFor="company-state" className="mb-1 block text-sm font-bold">Situação</label><select id="company-state" className={inputClass} value={state} disabled={busy}
        onChange={e => { setState(e.target.value); setPage(1); setEditing(null); setPreview(null); setPassword(''); }}><option value="ATIVOS">Ativos</option><option value="ARQUIVADOS">Arquivados</option></select></div>
    </div>
    {!editing && message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{message}</p>}

    {loading ? <p role="status" className="flex items-center gap-2 p-6"><Loader2 className="animate-spin" /> Consultando cadastros…</p> :
      loadError ? <div role="alert" className="rounded-xl bg-red-50 p-5 text-red-800">{loadError}<button className="ml-2 underline" onClick={() => setRevision(value => value + 1)}>Tentar novamente</button></div> : <>
        <p className="text-sm text-slate-600">{total} cadastro(s) nesta consulta.</p>
        {!items.length ? <p className="rounded-xl border border-dashed p-8 text-center">Nenhum cadastro encontrado.</p> :
          <div className="space-y-3">{items.map(item => {
            const owner = item.proprietarioUser || item.donoUser;
            return <div key={item.id} className="space-y-3"><article className={`rounded-2xl border bg-white p-5 ${editing?.id === item.id ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'}`}>
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><h2 className="break-words text-lg font-bold">{item.razaoSocial}</h2>
                <p className="mt-1 break-words text-sm text-slate-600">Documento: {item.documento} · {item.archived ? 'Arquivado' : 'Ativo'}{item.ambiente ? ` · ${item.ambiente}` : ''}</p>
                <p className="mt-2 break-words text-sm">Proprietário cadastrado: {owner ? `${owner.nome} (${owner.email})` : 'Sem proprietário identificado — requer análise'}</p></div>
                <button className={buttonClass} disabled={busy} onClick={() => void requestOpen(item)}>{editing?.id === item.id ? 'Revisão aberta' : item.archived ? 'Restaurar' : 'Revisar cadastro'}</button></div>
            </article>
            {editing?.id === item.id && <section id={'company-review-' + item.id} className="scroll-mt-6 rounded-2xl border-2 border-blue-200 bg-white p-5">
              <h2 className="text-xl font-bold">{editing.archived ? 'Restaurar cadastro' : 'Revisar prestador'} — {editing.razaoSocial}</h2>
              <p className="mt-1 text-sm text-slate-600">CNPJ: {editing.documento}{editing.lastApiCheck ? ` · última consulta pública: ${new Date(editing.lastApiCheck).toLocaleString('pt-BR')}` : ''}</p>
              <p className="mt-2 text-sm text-amber-800">CNPJ, titularidade, certificado, ambiente e numeração não são alterados nesta tela.</p>
              {message && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
              {operationError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{operationError}</p>}
              <form onSubmit={submit} className="mt-5 space-y-5">
                {!editing.archived && <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2"><legend className="sr-only">Dados cadastrais</legend>
                  {fields.map(([key, label, max]) => <div key={key}><label htmlFor={'admin-company-' + key} className="mb-1 block text-sm font-bold">{label}</label>
                    <input id={'admin-company-' + key} type={key === 'email' ? 'email' : 'text'} className={inputClass} value={form[key] ?? ''} maxLength={max}
                      required={key === 'razaoSocial'} minLength={key === 'razaoSocial' ? 2 : undefined} onChange={e => setForm(previous => ({ ...previous, [key]: e.target.value }))} /></div>)}</fieldset>}
                {preview && <section className="rounded-xl border border-blue-200 bg-blue-50 p-4"><h3 className="font-bold text-blue-950">Prévia da fonte pública — {preview.fonte}</h3>
                  <p className="mt-1 text-sm text-blue-900">Nada foi salvo. Ao aplicar, os valores abaixo serão a atualização cadastral mais recente.</p>
                  <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b border-blue-200"><th className="p-2">Campo</th><th className="p-2">Cadastro atual</th><th className="p-2">Fonte pública</th><th className="p-2">Resultado</th></tr></thead>
                    <tbody>{publicFields.map(field => { const current = editing[field] || ''; const incoming = preview.data[field] || '';
                      return <tr key={field} className="border-b border-blue-100"><td className="p-2 font-semibold">{labels[field]}</td><td className="p-2">{current || 'Não informado'}</td>
                        <td className="p-2">{incoming || 'Não informado'}</td><td className="p-2">{current === incoming ? 'Sem alteração' : 'Será atualizado'}</td></tr>; })}</tbody></table></div></section>}
                <fieldset disabled={busy} className="grid gap-4 border-t pt-4 md:grid-cols-2"><legend className="px-1 text-sm font-bold">Confirmação para salvar ou aplicar</legend>
                  <div><label htmlFor="admin-company-justification" className="mb-1 block text-sm font-bold">Justificativa (10 a 2.000 caracteres)</label><textarea id="admin-company-justification" className={inputClass} value={justification} required minLength={10} maxLength={2000} onChange={e => setJustification(e.target.value)} /></div>
                  <div><label htmlFor="admin-company-password" className="mb-1 block text-sm font-bold">Sua senha de acesso</label><input id="admin-company-password" type="password" autoComplete="current-password" className={inputClass} value={password} required onChange={e => setPassword(e.target.value)} /><p className="mt-1 text-xs text-slate-500">Não é a senha do cliente nem do certificado.</p></div>
                </fieldset>
                <div className="flex flex-wrap gap-3">{editing.archived ? <button type="submit" value="RESTORE" disabled={busy} className={buttonClass}><RotateCcw size={18} /> Restaurar cadastro</button> : <>
                  <button type="submit" value="UPDATE" disabled={busy || !Object.keys(changed).length} className={buttonClass}><Edit size={18} /> Salvar alterações</button>
                  <button type="button" disabled={busy} className={buttonClass} onClick={() => void consultPublicSource()}><RefreshCw size={18} /> Consultar fonte pública</button>
                  <button type="button" disabled={busy || !preview} className={buttonClass} onClick={() => void mutate('REFRESH')}><Database size={18} /> Aplicar atualização consultada</button>
                  <button type="submit" value="ARCHIVE" disabled={busy} className={buttonClass}><Archive size={18} /> Arquivar cadastro</button></>}
                  <button type="button" disabled={busy} className={buttonClass} onClick={() => void requestClose()}>Fechar</button>
                  {busy && <span role="status" className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={18} /> Processando…</span>}</div>
              </form>
            </section>}
          </div>; })}</div>}
        <nav aria-label="Paginação de cadastros" className="flex items-center justify-between border-t pt-4"><span className="text-sm">Página {page} de {totalPages}</span><div className="flex gap-2">
          <button className={buttonClass} aria-label="Página anterior" disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}><ChevronLeft size={18} /></button>
          <button className={buttonClass} aria-label="Próxima página" disabled={page >= totalPages || busy} onClick={() => setPage(p => p + 1)}><ChevronRight size={18} /></button></div></nav>
      </>}
  </div>;
}
