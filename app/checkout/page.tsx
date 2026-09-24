'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useDialog } from '@/app/contexts/DialogContext';
import type { CommercialQuote } from '@/app/utils/commercial-pricing';

type Product = { id: string; name: string; slug: string; tipo: string; priceMonthly: string | number;
  priceYearly: string | number; diasTeste: number; description?: string };
type Proof = { id: string; nomeArquivo: string; downloadUrl: string };
type Order = { id: string; status: string; statusLabel: string; valorTotal: number; expiresAt: string | null;
  createdAt: string; cotacao: CommercialQuote | null; detalhes: { ticketId?: string; inicioAssinatura?: string }; anexos: Proof[] };
const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900';
const pendingStatuses = ['AGUARDANDO_COMPROVANTE', 'COMPROVANTE_ENVIADO', 'EM_ANALISE'];

function CheckoutContent() {
  const params = useSearchParams();
  const dialog = useDialog();
  const [products, setProducts] = useState<Product[]>([]);
  const [planSlug, setPlanSlug] = useState(params.get('plan') || '');
  const [cycle, setCycle] = useState<'MENSAL' | 'ANUAL'>(params.get('cycle') === 'ANUAL' ? 'ANUAL' : 'MENSAL');
  const [cycles, setCycles] = useState(1);
  const [addons, setAddons] = useState<Record<string, number>>({});
  const [coupon, setCoupon] = useState('');
  const [couponInput, setCouponInput] = useState('');
  const [quote, setQuote] = useState<{ cotacao: CommercialQuote; cotacaoHash: string; cartKey: string } | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [history, setHistory] = useState<Order[]>([]);
  const keyRef = useRef<{ cartKey: string; id: string } | null>(null);

  const loadOrders = useCallback(async () => {
    const response = await fetch('/api/checkout', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 401 ? 'Entre na sua conta para contratar.' : data.error || 'Não foi possível carregar suas solicitações.');
    setOrder(data.pedido);
    setHistory(data.historico || []);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/plans');
        const data = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error('Catálogo indisponível. Tente novamente.');
        if (!active) return;
        setProducts(data.filter((p: Product) => p.diasTeste === 0 && ['PLANO', 'PACOTE_NOTAS', 'PACOTE_CLIENTES', 'PACOTE_PJ'].includes(p.tipo)));
        await loadOrders();
      } catch (cause) { if (active) setError((cause as Error).message); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [loadOrders]);

  const cart = useMemo(() => ({ planSlug: planSlug || null, ciclo: planSlug ? cycle : 'MENSAL', qtdCiclos: planSlug ? cycles : 1,
    pacotes: Object.entries(addons).filter(([, qtd]) => qtd > 0).map(([planId, qtd]) => ({ planId, qtd })), cupom: coupon || null }), [planSlug, cycle, cycles, addons, coupon]);
  const cartKey = JSON.stringify(cart);
  useEffect(() => {
    if (loading || order || (!cart.planSlug && !cart.pacotes.length)) { setQuote(null); setQuoting(false); setQuoteError(''); return; }
    const controller = new AbortController();
    setQuoting(true); setQuoteError(''); setQuote(null);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/checkout/cotacao', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: cartKey, signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Cotação indisponível.');
        if (!controller.signal.aborted) setQuote({ ...data, cartKey });
      } catch (cause) { if (!controller.signal.aborted) setQuoteError((cause as Error).message); }
      finally { if (!controller.signal.aborted) setQuoting(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cart, cartKey, loading, order, quoteRevision]);

  async function submit() {
    if (!quote || quote.cartKey !== cartKey) return;
    setBusy(true); setError('');
    if (!keyRef.current || keyRef.current.cartKey !== cartKey) keyRef.current = { cartKey, id: crypto.randomUUID() };
    try {
      const response = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyRef.current.id },
        body: JSON.stringify({ ...cart, cotacaoHash: quote.cotacaoHash }) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) { setQuote(null); setQuoteRevision((value) => value + 1); await loadOrders(); }
        throw new Error(data.error || 'Solicitação não registrada.');
      }
      setOrder(data.pedido); await loadOrders();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!order || !await dialog.showConfirm({ title: 'Cancelar solicitação?', description: 'Isso não devolve uma transferência já realizada. Se você pagou, solicite a conciliação pelo suporte.', confirmText: 'Cancelar solicitação', cancelText: 'Voltar' })) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/checkout', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: order.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Cancelamento não concluído.');
      keyRef.current = null; await loadOrders();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function upload(file?: File) {
    if (!file || !order) return;
    if (!file.size || file.size > 5 * 1024 * 1024 || !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Envie PDF, PNG, JPG ou WEBP com até 5 MB.'); return;
    }
    setBusy(true); setError('');
    try {
      const conteudoBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.')); reader.readAsDataURL(file); });
      const response = await fetch('/api/checkout/comprovante', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: order.id, nomeArquivo: file.name, mimeType: file.type, tamanho: file.size, conteudoBase64 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Envio não concluído.');
      await loadOrders();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function download(proof: Proof) {
    try {
      const response = await fetch(proof.downloadUrl);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Arquivo indisponível.');
      const link = document.createElement('a'); link.href = data.conteudoBase64; link.download = data.nomeArquivo; link.click();
    } catch (cause) { setError((cause as Error).message); }
  }

  const base = products.filter((p) => p.tipo === 'PLANO');
  const selected = base.find((p) => p.slug === planSlug);
  const expired = !!order?.expiresAt && new Date(order.expiresAt) <= new Date();
  return <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-4 text-slate-900 sm:p-8">
    <Link href="/cliente/dashboard" className="text-blue-700 underline">Voltar à minha conta</Link>
    <header><h1 className="text-3xl font-bold">Contratação</h1><p className="mt-2 text-slate-600">Cobrança e ativação manuais. Nenhum débito automático será realizado.</p></header>
    {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4">{error} <Link className="underline" href="/login">Acessar conta</Link></div>}
    {loading ? <p role="status">Carregando catálogo e solicitações…</p> : order ? <section className="space-y-4 rounded-2xl border bg-white p-6">
      <h2 className="text-xl font-bold">{order.statusLabel}</h2><p className="break-all text-sm">Pedido: {order.id}</p>
      <p>Total confirmado: <strong>{money(Math.round(order.valorTotal * 100))}</strong></p>
      {order.expiresAt && <p>Prazo para conferência: {new Date(order.expiresAt).toLocaleString('pt-BR')}.</p>}
      {expired && <p role="alert" className="text-red-700">Prazo expirado. Não transfira valores para este pedido; cancele e solicite uma nova cotação.</p>}
      {!order.cotacao && <p role="alert">Pedido antigo sem condições verificáveis. Cancele e recrie a solicitação.</p>}
      <p>Confirme os dados de pagamento diretamente no atendimento. O envio do comprovante não confirma a quitação.</p>
      {order.detalhes.ticketId && <Link className="inline-block font-semibold text-blue-700 underline" href={`/cliente/suporte/${order.detalhes.ticketId}`}>Abrir atendimento da contratação</Link>}
      {order.cotacao && !expired && <label className="block">Enviar comprovante (até cinco arquivos, 5 MB cada)
        <input className={inputClass} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" disabled={busy || order.anexos.length >= 5} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
      </label>}
      <ul className="space-y-2">{order.anexos.map((proof) => <li key={proof.id}><button className="text-blue-700 underline" onClick={() => void download(proof)}>{proof.nomeArquivo}</button></li>)}</ul>
      <button type="button" className="rounded-lg border border-red-300 p-3 text-red-800 disabled:opacity-50" disabled={busy} onClick={() => void cancel()}>Cancelar solicitação</button>
    </section> : <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-4 rounded-2xl border bg-white p-6">
        <h2 className="text-xl font-bold">Itens da contratação</h2>
        <label className="block">Assinatura<select className={inputClass} value={planSlug} onChange={(event) => { const slug = event.target.value; setPlanSlug(slug); setCycles(1); const product = base.find((p) => p.slug === slug); setCycle(product && Number(product.priceMonthly) === 0 ? 'ANUAL' : 'MENSAL'); }}>
          <option value="">Somente pacotes (exige plano vigente)</option>{base.map((p) => <option value={p.slug} key={p.id}>{p.name}</option>)}
        </select></label>
        {planSlug && !selected && <p role="alert">Plano não disponível no catálogo público. Selecione outro ou fale com o atendimento.</p>}
        {selected && <><p className="text-sm text-slate-600">{selected.description}</p>
          <label className="block">Ciclo<select className={inputClass} value={cycle} onChange={(event) => { setCycle(event.target.value as 'MENSAL' | 'ANUAL'); setCycles(1); }}>
            <option value="MENSAL" disabled={Number(selected.priceMonthly) <= 0}>Mensal</option><option value="ANUAL" disabled={Number(selected.priceYearly) <= 0}>Anual</option>
          </select></label>
          <label className="block">Quantidade de {cycle === 'ANUAL' ? 'anos' : 'meses'}<input className={inputClass} type="number" min={1} max={cycle === 'ANUAL' ? 1 : 12} value={cycles} onChange={(event) => setCycles(Math.max(1, Math.min(cycle === 'ANUAL' ? 1 : 12, Math.trunc(Number(event.target.value) || 1))))} /></label>
        </>}
        <fieldset className="space-y-3"><legend className="font-semibold">Pacotes adicionais</legend>{products.filter((p) => p.tipo !== 'PLANO').map((p) => <label key={p.id} className="block">{p.name} — {money(Math.round(Number(p.priceMonthly) * 100))} por pacote
          <input className={inputClass} type="number" min={0} max={100} value={addons[p.id] || 0} onChange={(event) => setAddons((current) => ({ ...current, [p.id]: Math.max(0, Math.min(100, Math.trunc(Number(event.target.value) || 0))) }))} />
        </label>)}</fieldset>
        <p className="text-sm text-slate-600">Notas avulsas não se renovam mensalmente. Uma renovação antecipada começa após o período já contratado, sem encurtá-lo.</p>
        <label className="block">Cupom<input className={inputClass} maxLength={40} value={couponInput} onChange={(event) => setCouponInput(event.target.value.toUpperCase())} /></label>
        <button className="rounded-lg border p-3" onClick={() => setCoupon(couponInput.trim())}>Consultar cupom</button>
        {coupon && <p>{coupon} <button className="text-blue-700 underline" onClick={() => { setCoupon(''); setCouponInput(''); }}>Remover</button></p>}
      </section>
      <section className="h-fit space-y-4 rounded-2xl border bg-white p-6" aria-live="polite">
        <h2 className="text-xl font-bold">Cotação do servidor</h2>
        {quoting && <p role="status">Conferindo preços e elegibilidade…</p>}
        {quoteError && <p role="alert" className="text-red-700">{quoteError}</p>}
        {quote && quote.cartKey === cartKey ? <>
          <ul className="space-y-2">{quote.cotacao.lines.map((line) => <li key={line.planId}>{line.quantidade}× {line.nome}: {money(line.totalCents)}</li>)}</ul>
          <p>Desconto: {money(quote.cotacao.descontoCents)}</p><p className="text-2xl font-bold">Total: {money(quote.cotacao.totalCents)}</p>
          <p className="text-sm">Ao solicitar, estas condições ficam registradas para conferência. O prazo de validade será exibido no pedido.</p>
        </> : <p>Selecione os itens para receber uma cotação válida. Se o preço mudar, será necessária nova confirmação.</p>}
        <button className="w-full rounded-lg bg-blue-700 p-4 font-semibold text-white disabled:opacity-40" disabled={busy || quoting || !quote || quote.cartKey !== cartKey} onClick={() => void submit()}>{busy ? 'Registrando…' : 'Confirmar cotação e solicitar'}</button>
        <Link className="block text-blue-700 underline" href="/cliente/suporte">Condições para contadores e dúvidas comerciais</Link>
      </section>
    </div>}
    {history.length > 0 && <section className="space-y-3"><h2 className="text-xl font-bold">Últimas solicitações</h2>{history.map((item) => <article className="rounded-xl border bg-white p-4" key={item.id}>
      <p>{new Date(item.createdAt).toLocaleDateString('pt-BR')} · {item.statusLabel} · {money(Math.round(item.valorTotal * 100))}</p>
      {item.detalhes.inicioAssinatura && <p>Início da assinatura: {new Date(item.detalhes.inicioAssinatura).toLocaleDateString('pt-BR')}</p>}
      {!pendingStatuses.includes(item.status) && item.detalhes.ticketId && <Link className="text-blue-700 underline" href={`/cliente/suporte/${item.detalhes.ticketId}`}>Ver atendimento</Link>}
    </article>)}</section>}
  </main>;
}

export default function CheckoutPage() {
  return <Suspense fallback={<p className="p-8">Carregando contratação…</p>}><CheckoutContent /></Suspense>;
}
