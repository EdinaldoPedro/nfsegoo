'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CommercialQuote } from '@/app/utils/commercial-pricing';

type Order = { id: string; status: string; statusLabel: string; valorTotal: number; expiresAt: string | null; cotacaoLegada: boolean;
  user: { nome: string; email: string }; cotacao: CommercialQuote | null; detalhes: { inicioAssinatura?: string };
  anexos: { id: string; nomeArquivo: string; downloadUrl: string }[] };
const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900';
const currency = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ContractsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showFinal, setShowFinal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState('');
  const [justification, setJustification] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [received, setReceived] = useState('');
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/admin/pedidos?page=${page}&finalizados=${showFinal ? '1' : '0'}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) throw new Error(data.error || 'Não foi possível carregar as contratações.');
      setOrders(data); setTotal(Number(response.headers.get('X-Total-Count')) || data.length);
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoading(false); }
  }, [page, showFinal]);
  useEffect(() => { void load(); }, [load]);

  function select(order: Order) {
    setSelected(order); setPassword(''); setJustification(''); setReason(''); setReference(''); setReceived(''); setChecked(false); setNotice('');
  }

  async function process(status: string) {
    if (!selected) return;
    if (!password || justification.trim().length < 10) { setError('Informe sua senha e uma justificativa com pelo menos dez caracteres.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/pedidos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        id: selected.id, status, adminPassword: password, justification: justification.trim(), motivo: reason.trim(),
        referenciaPagamento: reference.trim(), valorRecebido: received, pagamentoConferido: checked,
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Operação não concluída.');
      setSelected(null); await load();
      setNotice(status === 'ATIVADO_MANUALMENTE' ? `Pagamento conciliado e benefícios registrados. ${data.pedido.detalhes?.inicioAssinatura ? `Início da assinatura: ${new Date(data.pedido.detalhes.inicioAssinatura).toLocaleString('pt-BR')}.` : ''}` : 'Status atualizado e auditado.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); setPassword(''); }
  }

  async function download(proof: Order['anexos'][number]) {
    try {
      const response = await fetch(proof.downloadUrl);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Arquivo indisponível.');
      const link = document.createElement('a'); link.href = data.conteudoBase64; link.download = data.nomeArquivo; link.click();
    } catch (cause) { setError((cause as Error).message); }
  }

  return <div className="space-y-6 text-slate-900">
    <header><h1 className="text-3xl font-bold">Contratações e pagamentos</h1><p className="mt-2 text-slate-600">Conferência manual de pagamentos. O comprovante isolado não substitui a conciliação no banco.</p></header>
    {error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4">{notice}</p>}
    <div className="flex flex-wrap gap-4"><label className="flex items-center gap-2"><input type="checkbox" checked={showFinal} onChange={(e) => { setShowFinal(e.target.checked); setPage(1); }} /> Incluir encerrados</label><button className="rounded-lg border bg-white p-3" onClick={() => void load()} disabled={loading}>Atualizar</button><p className="self-center">{total} solicitações</p></div>
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="space-y-3" aria-label="Solicitações">
        {loading && <p role="status">Carregando…</p>}
        {!loading && orders.length === 0 && <p>Nenhuma solicitação encontrada.</p>}
        {orders.map((order) => <button key={order.id} type="button" onClick={() => select(order)} className={`w-full rounded-xl border bg-white p-4 text-left ${selected?.id === order.id ? 'ring-2 ring-blue-600' : ''}`}>
          <span className="block font-bold">{order.user.nome} · {currency(order.valorTotal)}</span><span className="block break-all text-sm text-slate-600">{order.user.email}</span>
          <span className="mt-2 block">{order.statusLabel} · {order.anexos.length} comprovante(s)</span>
          {order.expiresAt && <span className="block text-sm">Prazo: {new Date(order.expiresAt).toLocaleString('pt-BR')}</span>}
        </button>)}
        <div className="flex items-center justify-between"><button disabled={page <= 1 || loading} className="rounded-lg border p-3 disabled:opacity-40" onClick={() => setPage((p) => p - 1)}>Anterior</button><span>Página {page}</span><button disabled={page * 50 >= total || loading} className="rounded-lg border p-3 disabled:opacity-40" onClick={() => setPage((p) => p + 1)}>Próxima</button></div>
      </section>
      {selected && <section className="h-fit space-y-4 rounded-xl border bg-white p-6" aria-label="Conferência da solicitação">
        <h2 className="text-xl font-bold">Conferência — {selected.user.nome}</h2><p className="break-all text-xs">Pedido {selected.id}</p>
        <p className="text-2xl font-bold">{currency(selected.valorTotal)}</p>
        {selected.cotacao?.lines.map((line) => <p key={line.planId}>{line.quantidade}× {line.nome}: {currency(line.totalCents / 100)}</p>)}
        {selected.cotacao && <p>Desconto: {currency(selected.cotacao.descontoCents / 100)}</p>}
        {selected.cotacaoLegada && <p role="alert" className="text-red-700">Pedido legado sem cotação verificável. Recuse com orientação para recriação. Não altere planos para contornar esta verificação.</p>}
        {selected.anexos.map((proof) => <button className="block text-blue-700 underline" key={proof.id} onClick={() => void download(proof)}>Baixar {proof.nomeArquivo}</button>)}
        {['AGUARDANDO_COMPROVANTE', 'COMPROVANTE_ENVIADO', 'EM_ANALISE'].includes(selected.status) ? <fieldset disabled={busy} className="space-y-4">
          <legend className="font-semibold">Operação auditada</legend>
          <label className="block">Justificativa interna<input className={inputClass} minLength={10} maxLength={2000} value={justification} onChange={(e) => setJustification(e.target.value)} /></label>
          <label className="block">Sua senha<input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {selected.status !== 'EM_ANALISE' && <button className="rounded-lg bg-blue-700 p-3 text-white" onClick={() => void process('EM_ANALISE')}>Iniciar análise</button>}
          {selected.status === 'EM_ANALISE' && !selected.cotacaoLegada && <>
            <label className="block">Referência bancária única<input className={inputClass} maxLength={160} placeholder="BANCO:ID-DA-TRANSFERENCIA" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            <label className="block">Valor efetivamente recebido (R$)<input className={inputClass} type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} /></label>
            <label className="flex gap-2"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /><span>Conferi a entrada no banco, o pagador, o valor e a referência; esta transferência não foi usada em outro pedido. Para total zero, conferi a concessão integral do desconto.</span></label>
            <button className="w-full rounded-lg bg-green-700 p-4 font-bold text-white disabled:opacity-40" disabled={!checked} onClick={() => void process('ATIVADO_MANUALMENTE')}>Conciliar pagamento e registrar benefícios</button>
          </>}
          <label className="block">Motivo público da recusa<textarea className={inputClass} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button className="rounded-lg border border-red-300 p-3 text-red-800" onClick={() => void process('RECUSADO')}>Recusar solicitação</button>
        </fieldset> : <p>Solicitação encerrada. Repetir a aprovação não concede benefícios adicionais.</p>}
      </section>}
    </div>
  </div>;
}
