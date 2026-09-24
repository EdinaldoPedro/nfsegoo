'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Database, Loader2, RefreshCw, RotateCcw, Save, Search } from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';

const fieldDefinitions = [
  ['razaoSocial', 'Razão social', 200], ['nomeFantasia', 'Nome fantasia', 200],
  ['situacaoCadastral', 'Situação cadastral', 100], ['cep', 'CEP', 11],
  ['logradouro', 'Logradouro', 200], ['numero', 'Número', 20], ['complemento', 'Complemento', 100],
  ['bairro', 'Bairro', 100], ['cidade', 'Cidade', 100], ['uf', 'UF', 2],
  ['pais', 'País', 100], ['codigoIbge', 'Código IBGE', 7],
] as const;
type Field = typeof fieldDefinitions[number][0];
type Item = { id: string; documento: string; version: number; fonte: string; fonteConsultadaEm: string | null;
  updatedAt: string; relacionamentos: number; camposCorrigidos: string[] } & Record<Field, string | null>;
type PublicPreview = { data: Record<Field, string | null>; fonte: string; consultedAt: string; sourceHash: string;
  expectedVersion: number; atividades: Array<{ codigo: string; descricao: string | null; principal: boolean }> };

const inputClass = 'w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 disabled:bg-slate-100';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold disabled:opacity-50';

export default function IdentidadesFiscaisTomadores() {
  const dialog = useDialog();
  const [items, setItems] = useState<Item[]>([]); const [selected, setSelected] = useState<Item | null>(null);
  const [form, setForm] = useState<Record<string, string>>({}); const [search, setSearch] = useState('');
  const [page, setPage] = useState(1); const [totalPages, setTotalPages] = useState(1); const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [revision, setRevision] = useState(0);
  const [password, setPassword] = useState(''); const [justification, setJustification] = useState('');
  const [preview, setPreview] = useState<PublicPreview | null>(null);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/admin/tomadores?' + new URLSearchParams({ search, page: String(page), limit: '20' }), { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Não foi possível consultar as identidades fiscais.');
        if (!controller.signal.aborted) { setItems(result.data); setTotal(result.meta.total); setTotalPages(result.meta.totalPages); }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Falha de conexão.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, page, revision]);

  const changed = useMemo(() => selected ? Object.fromEntries(fieldDefinitions.flatMap(([field]) => {
    const value = form[field] ?? ''; const original = selected[field] ?? '';
    return value === original ? [] : [[field, value || null]];
  })) : {}, [form, selected]);
  const hasPendingChanges = Boolean(selected && (Object.keys(changed).length || preview || justification.trim() || password));

  function open(item: Item) {
    setSelected(item); setForm(Object.fromEntries(fieldDefinitions.map(([field]) => [field, item[field] ?? ''])));
    setPassword(''); setJustification(''); setPreview(null); setError(''); setMessage('');
  }

  function focusReview(id: string) {
    window.setTimeout(() => document.getElementById('fiscal-review-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function requestOpen(item: Item) {
    if (busy) return;
    if (selected?.id === item.id) { focusReview(item.id); return; }
    if (hasPendingChanges && selected) {
      const discard = await dialog.showConfirm({ type: 'warning', title: 'Alterações não salvas',
        description: `Existem ajustes ainda não salvos em ${selected.razaoSocial}. Você pode voltar para concluir ou descartar tudo e revisar ${item.razaoSocial}.`,
        confirmText: 'Descartar e abrir', cancelText: 'Voltar à revisão' });
      if (!discard) { focusReview(selected.id); return; }
    }
    open(item); focusReview(item.id);
  }

  async function requestClose() {
    if (!selected || busy) return;
    if (hasPendingChanges && !await dialog.showConfirm({ type: 'warning', title: 'Descartar alterações não salvas?',
      description: 'Os campos editados, a prévia consultada e a confirmação ainda não aplicada serão descartados.',
      confirmText: 'Descartar e fechar', cancelText: 'Continuar ajustando' })) return;
    setSelected(null); setPreview(null); setPassword(''); setJustification(''); setError('');
  }

  async function mutate(action: 'CORRECT' | 'RESET' | 'REFRESH') {
    if (!selected || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/admin/tomadores', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, expectedVersion: selected.version, action,
          ...(action === 'CORRECT' ? { data: changed } : {}),
          ...(action === 'RESET' ? { fields: selected.camposCorrigidos } : {}),
          ...(action === 'REFRESH' ? { sourceHash: preview?.sourceHash } : {}),
          adminPassword: password, justification }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Operação não concluída.');
      setSelected(null); setPassword(''); setJustification(''); setRevision(value => value + 1);
      setMessage(action === 'REFRESH' ? 'Fonte pública consultada e identidade atualizada.' : action === 'RESET'
        ? 'Correções administrativas removidas; os valores da fonte cadastral voltaram a prevalecer.'
        : 'Correções globais salvas e registradas na auditoria.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha de conexão.'); }
    finally { setPassword(''); setBusy(false); }
  }

  async function consultPublicSource() {
    if (!selected || busy) return;
    setBusy(true); setError(''); setMessage(''); setPreview(null);
    try {
      const response = await fetch('/api/admin/tomadores', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, expectedVersion: selected.version }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível consultar a fonte pública.');
      setPreview(result);
      setMessage('Consulta concluída. Confira as diferenças antes de aplicar qualquer atualização.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha de conexão.'); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) { event.preventDefault(); await mutate('CORRECT'); }

  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
    <header><div className="flex items-center gap-3"><Database className="text-blue-700" /><h1 className="text-2xl font-black text-slate-900">Identidades fiscais de tomadores</h1></div>
      <p className="mt-2 max-w-4xl text-sm text-slate-600">Um cadastro público por CNPJ, compartilhado por todas as carteiras. Esta tela não exibe nem altera e-mail de emissão, telefone ou I.M. particulares de cada relação prestador–tomador.</p>
    </header>
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">A consulta atual usa a BrasilAPI como agregador público e registra a procedência. Em cada campo prevalece a atualização mais recente, seja ela feita pela equipe, pela consulta pública ou por um novo cadastro; o CNPJ nunca é trocado.</div>
    <div><label htmlFor="fiscal-entity-search" className="mb-1 flex items-center gap-2 text-sm font-bold"><Search size={16} /> Buscar por razão social, fantasia ou CNPJ</label>
      <input id="fiscal-entity-search" className={inputClass} value={search} maxLength={120} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
    {!selected && message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{message}</p>}
    {!selected && error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}

    {loading ? <p role="status" className="flex items-center gap-2 p-6"><Loader2 className="animate-spin" /> Consultando…</p> : <>
      <p className="text-sm text-slate-600">{total} identidade(s) fiscal(is).</p>
      <div className="space-y-3">{items.map(item => <div key={item.id} className="space-y-3">
        <article className={`rounded-2xl border bg-white p-5 ${selected?.id === item.id ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'}`}>
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><h2 className="text-lg font-bold">{item.razaoSocial}</h2>
            <p className="mt-1 text-sm text-slate-600">{item.documento} · {item.cidade || 'Cidade não informada'}/{item.uf || '--'} · {item.relacionamentos} carteira(s)</p>
            <p className="mt-1 text-xs text-slate-500">Fonte: {item.fonte}{item.camposCorrigidos.length ? ` · correções ativas: ${item.camposCorrigidos.join(', ')}` : ''}</p></div>
            <button className={buttonClass} disabled={busy} onClick={() => void requestOpen(item)}>{selected?.id === item.id ? 'Revisão aberta' : 'Revisar dados públicos'}</button></div>
        </article>
        {selected?.id === item.id && <section id={'fiscal-review-' + item.id} className="scroll-mt-6 rounded-2xl border-2 border-blue-200 bg-white p-5">
          <h2 className="text-xl font-bold">Corrigir identidade — {selected.razaoSocial}</h2>
          <p className="mt-1 text-sm text-slate-600">CNPJ: {selected.documento} · versão {selected.version} · fonte {selected.fonte}</p>
          {message && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
          {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
          <form className="mt-5 space-y-5" onSubmit={submit}>
            <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2"><legend className="sr-only">Dados públicos</legend>
              {fieldDefinitions.map(([field, label, max]) => <div key={field}><label className="mb-1 block text-sm font-bold" htmlFor={'entity-' + field}>{label}{selected.camposCorrigidos.includes(field) ? ' — correção ativa' : ''}</label>
                <input id={'entity-' + field} className={inputClass} maxLength={max} value={form[field] ?? ''} required={field === 'razaoSocial'} onChange={event => setForm(previous => ({ ...previous, [field]: event.target.value }))} /></div>)}
            </fieldset>
            {preview && <section className="rounded-xl border border-blue-200 bg-blue-50 p-4" aria-labelledby="public-preview-title">
              <h3 id="public-preview-title" className="font-bold text-blue-950">Prévia da fonte pública — {preview.fonte}</h3>
              <p className="mt-1 text-sm text-blue-900">Nada foi salvo. Ao aplicar, os dados consultados passam a ser a atualização mais recente e substituem correções anteriores dos mesmos campos.</p>
              <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b border-blue-200">
                <th className="p-2">Campo</th><th className="p-2">Cadastro atual</th><th className="p-2">Fonte pública</th><th className="p-2">Resultado</th>
              </tr></thead><tbody>{fieldDefinitions.map(([field, label]) => {
                const current = selected[field] || ''; const incoming = preview.data[field] || ''; const changedBySource = current !== incoming;
                return <tr key={field} className="border-b border-blue-100"><td className="p-2 font-semibold">{label}</td>
                  <td className="p-2">{current || 'Não informado'}</td><td className="p-2">{incoming || 'Não informado'}</td>
                  <td className="p-2">{selected.camposCorrigidos.includes(field) ? 'Correção anterior será substituída' : changedBySource ? 'Será atualizado' : 'Sem alteração'}</td></tr>;
              })}</tbody></table></div>
              <p className="mt-3 text-xs text-blue-800">{preview.atividades.length} atividade(s) econômica(s) retornada(s). A aplicação também atualizará essa base pública de atividades.</p>
            </section>}
            <fieldset disabled={busy} className="grid gap-4 border-t pt-4 md:grid-cols-2"><legend className="px-1 text-sm font-bold">Confirmação para salvar ou aplicar</legend>
              <div><label className="mb-1 block text-sm font-bold" htmlFor="entity-justification">Justificativa (mínimo 10 caracteres)</label><textarea id="entity-justification" className={inputClass} minLength={10} maxLength={2000} required value={justification} onChange={event => setJustification(event.target.value)} /></div>
              <div><label className="mb-1 block text-sm font-bold" htmlFor="entity-password">Sua senha atual</label><input id="entity-password" type="password" autoComplete="current-password" required className={inputClass} value={password} onChange={event => setPassword(event.target.value)} /></div>
            </fieldset>
            <div className="flex flex-wrap gap-3">
              <button className={buttonClass} type="submit" disabled={busy || !Object.keys(changed).length}><Save size={17} /> Salvar correções</button>
              <button className={buttonClass} type="button" disabled={busy} onClick={() => void consultPublicSource()}><RefreshCw size={17} /> Consultar fonte pública</button>
              <button className={buttonClass} type="button" disabled={busy || !preview} onClick={() => void mutate('REFRESH')}><Database size={17} /> Aplicar atualização consultada</button>
              <button className={buttonClass} type="button" disabled={busy || !selected.camposCorrigidos.length} onClick={() => void mutate('RESET')}><RotateCcw size={17} /> Remover todas as correções</button>
              <button className={buttonClass} type="button" disabled={busy} onClick={() => void requestClose()}>Fechar</button>
              {busy && <span role="status" className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={17} /> Processando…</span>}
            </div>
          </form>
        </section>}
      </div>)}</div>
      {!items.length && <p className="rounded-xl border border-dashed p-8 text-center">Nenhuma identidade fiscal encontrada.</p>}
      <nav aria-label="Paginação" className="flex items-center justify-between border-t pt-4"><span className="text-sm">Página {page} de {totalPages}</span><div className="flex gap-2">
        <button aria-label="Página anterior" className={buttonClass} disabled={page <= 1 || busy} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} /></button>
        <button aria-label="Próxima página" className={buttonClass} disabled={page >= totalPages || busy} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} /></button>
      </div></nav>
    </>}
  </div>;
}
