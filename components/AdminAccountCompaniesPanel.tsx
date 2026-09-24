'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';

type Company = { id: string; documento: string; razaoSocial: string; ambiente: string; arquivadoEm: string | null };
type Listing = { data: Company[]; primary: Company | null;
  account: { id: string; nome: string; role: string; empresaId: string | null; updatedAt: string; canChangePrimary: boolean };
  meta: { page: number; total: number; totalPages: number } };
type Operation = { action: 'REGISTER_NEW' } | { action: 'SET_PRIMARY'; company: Company | null; version: string };

export default function AdminAccountCompaniesPanel({ userId, onChanged }: { userId: string; onChanged?: () => void }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [operation, setOperation] = useState<Operation | null>(null);
  const [documento, setDocumento] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [password, setPassword] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const formRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(''); setListing(null);
    const params = new URLSearchParams({ page: String(page), limit: '10', search: query });
    fetch(`/api/admin/users/${userId}/empresas?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Não foi possível consultar as empresas da conta.');
        if (!controller.signal.aborted) setListing(json);
      }).catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Falha de conexão.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, page, query, reload]);
  useEffect(() => { if (operation) formRef.current?.focus(); }, [operation]);

  const choose = (next: { action: 'REGISTER_NEW' } | { action: 'SET_PRIMARY'; company: Company | null }) => {
    if (busyRef.current || !listing) return;
    setOperation(next.action === 'SET_PRIMARY' ? { ...next, version: listing.account.updatedAt } : next);
    setPassword(''); setJustification(''); setSaveError(''); setMessage('');
  };
  const refresh = () => {
    if (busyRef.current) return;
    setOperation(null); setPassword(''); setSaveError(''); setReload(value => value + 1);
  };
  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!operation || !listing || busyRef.current) return;
    if (operation.action === 'REGISTER_NEW' && (!validarCNPJ(documento) || razaoSocial.trim().length < 2)) {
      setSaveError('Confira o CNPJ e informe a razão social.'); setPassword(''); return;
    }
    if (justification.trim().length < 10 || !password) { setSaveError('Informe justificativa e sua senha administrativa.'); setPassword(''); return; }
    busyRef.current = true; setBusy(true); setSaveError(''); setMessage('');
    try {
      const payload = operation.action === 'REGISTER_NEW' ? { action: operation.action, documento: normalizeCnpj(documento), razaoSocial: razaoSocial.trim() }
        : { action: operation.action, empresaId: operation.company?.id ?? null, expectedUserUpdatedAt: operation.version };
      const response = await fetch(`/api/admin/users/${userId}/empresas`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, adminPassword: password, justification }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'A alteração não foi confirmada.');
      setMessage(operation.action === 'REGISTER_NEW'
        ? result.created ? 'Empresa nova cadastrada em homologação. Conclua o cadastro fiscal antes de emitir. A principal não foi trocada.'
          : 'Este cadastro já pertence à conta. Nenhum dado, vínculo ou ambiente foi alterado.'
        : 'Preferência de empresa principal salva. Propriedade, histórico, faturamento e demais acessos foram preservados.');
      setOperation(null); setDocumento(''); setRazaoSocial(''); setJustification('');
      setPage(1); setSearch(''); setQuery(''); setReload(value => value + 1); onChanged?.();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Falha de conexão. Recarregue a lista para conferir se houve gravação antes de tentar novamente.');
    } finally { setPassword(''); busyRef.current = false; setBusy(false); }
  };

  const button = 'rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-blue-600';
  return <section className="space-y-3 rounded-xl border border-slate-200 p-4" aria-label="Empresas da conta">
    <h4 className="font-bold text-slate-900">Empresas da conta</h4>
    <p className="text-sm text-slate-600">Cadastro no SaaS não comprova titularidade jurídica do CNPJ. Empresa principal é uma preferência de navegação; não transfere histórico nem responsabilidade.</p>
    {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    {loadError && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800"><p>{loadError}</p><button className={button + ' mt-2'} onClick={refresh}>Tentar carregar novamente</button></div>}
    {loading && <p role="status">Carregando empresas…</p>}
    {listing && <>
      <div className="rounded-lg bg-slate-50 p-3 text-sm">
        <p className="font-semibold">Principal de {listing.account.nome}</p>
        {listing.primary ? <p>{listing.primary.razaoSocial} — {listing.primary.documento}{listing.primary.arquivadoEm ? ' (arquivada)' : ''}</p> : <p>Nenhuma empresa principal selecionada.</p>}
        {!listing.account.canChangePrimary && <p className="mt-2 text-amber-800">O vínculo principal legado precisa de revisão de titularidade antes de ser alterado. O cadastro e os acessos atuais permanecem preservados.</p>}
        {listing.primary && listing.account.canChangePrimary && <button type="button" disabled={busy} className={button + ' mt-2'} onClick={() => choose({ action: 'SET_PRIMARY', company: null })}>Limpar somente a preferência de principal</button>}
      </div>
      <button type="button" disabled={busy} className={button} onClick={() => choose({ action: 'REGISTER_NEW' })}>Cadastrar empresa nova em homologação</button>
    </>}
    {operation && listing && <form onSubmit={confirm} className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
      <h5 ref={formRef} tabIndex={-1} className="font-bold">{operation.action === 'REGISTER_NEW' ? 'Confirmar novo cadastro' : 'Confirmar preferência de principal'}</h5>
      <p className="text-sm">Conta: {listing.account.nome}. Sua senha e justificativa autorizam apenas esta operação.</p>
      {operation.action === 'REGISTER_NEW' ? <>
        <p className="text-sm text-blue-900">Somente CNPJ ainda não cadastrado. É necessário contrato vigente e capacidade disponível. Não cria vínculo contábil, certificado ou emissão e não altera a principal.</p>
        <label className="block text-sm font-semibold">CNPJ da nova empresa<input required maxLength={32} value={documento} disabled={busy} onChange={event => setDocumento(event.target.value)} className="mt-1 block w-full rounded-lg border bg-white p-2" /></label>
        <label className="block text-sm font-semibold">Razão social<input required minLength={2} maxLength={200} value={razaoSocial} disabled={busy} onChange={event => setRazaoSocial(event.target.value)} className="mt-1 block w-full rounded-lg border bg-white p-2" /></label>
      </> : <p className="text-sm text-blue-900">{operation.company ? `Nova principal: ${operation.company.razaoSocial} — ${operation.company.documento}.` : 'A conta ficará sem preferência de principal, mas continuará proprietária das mesmas empresas.'} Nenhum documento fiscal, contrato, CNPJ ou vínculo será removido.</p>}
      <label className="block text-sm font-semibold">Justificativa administrativa<textarea required minLength={10} maxLength={2000} value={justification} disabled={busy} onChange={event => setJustification(event.target.value)} rows={3} className="mt-1 block w-full rounded-lg border bg-white p-2" /></label>
      <label className="block text-sm font-semibold">Sua senha administrativa<input type="password" autoComplete="current-password" required value={password} disabled={busy} onChange={event => setPassword(event.target.value)} className="mt-1 block w-full rounded-lg border bg-white p-2" /></label>
      {saveError && <div role="alert" className="text-sm text-red-800"><p>{saveError}</p><button type="button" className={button + ' mt-2'} disabled={busy} onClick={refresh}>Recarregar e conferir os dados</button></div>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={button + ' bg-blue-700 text-white'}>{busy ? 'Validando…' : 'Confirmar operação'}</button>
        <button type="button" disabled={busy} className={button} onClick={() => { setOperation(null); setPassword(''); }}>Cancelar</button></div>
    </form>}
    <label className="block text-sm">Buscar entre empresas desta conta<input maxLength={120} value={search} disabled={busy || !!operation} onChange={event => setSearch(event.target.value)} placeholder="Razão social ou CNPJ sem pontuação" className="mt-1 block w-full rounded-lg border p-2" /></label>
    {listing && <>
      <p className="text-xs text-slate-600">{listing.meta.total} cadastro(s) com propriedade registrada nesta conta, incluindo arquivados.</p>
      {!listing.data.length && <p className="text-sm text-slate-600">Nenhuma empresa encontrada neste filtro.</p>}
      <ul className="divide-y rounded-lg border">
        {listing.data.map(company => <li key={company.id} className="space-y-2 p-3 text-sm">
          <p className="font-semibold break-words">{company.razaoSocial}</p>
          <p className="break-words">{company.documento} · {company.ambiente === 'PRODUCAO' ? 'Produção' : company.ambiente === 'HOMOLOGACAO' ? 'Homologação' : 'Ambiente não definido'}{company.arquivadoEm ? ' · Arquivada' : ''}</p>
          {company.id === listing.account.empresaId ? <span className="text-blue-800">Principal atual</span> : <button type="button" className={button} disabled={busy || !!company.arquivadoEm || !listing.account.canChangePrimary} onClick={() => choose({ action: 'SET_PRIMARY', company })}>Escolher como principal</button>}
        </li>)}
      </ul>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Paginação de empresas da conta">
        <button type="button" className={button} disabled={busy || !!operation || page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button>
        <span className="text-sm">Página {page} de {listing.meta.totalPages}</span>
        <button type="button" className={button} disabled={busy || !!operation || page >= listing.meta.totalPages} onClick={() => setPage(value => value + 1)}>Próxima</button>
      </nav>
    </>}
    <p className="text-xs text-slate-600">Cadastros de terceiros, custodiados, órfãos e pedidos de transferência exigem verificação separada pelo atendimento. Não tente recriá-los ou trocar seu CNPJ. Arquivamento reversível, quando permitido, está em <Link className="underline" href="/admin/empresas">Empresas e tomadores</Link>.</p>
  </section>;
}
