'use client';

import { useRef, useState } from 'react';
import { useAdminAuthorization } from '@/app/hooks/useAdminAuthorization';
import { parseAccountantBenefit } from '@/app/utils/accountant-contract';
import { useDialog } from '@/app/contexts/DialogContext';

export default function AccountantBenefitPanel({ userId, suspended, limits, onChanged }: {
  userId: string; suspended: boolean; limits?: { origem?: string; limiteNotas?: number; notasUsadas?: number; limiteClientes?: number; clientesUsados?: number }; onChanged: () => Promise<void>;
}) {
  const authorize = useAdminAuthorization();
  const dialog = useDialog();
  const [kind, setKind] = useState('DEFAULT');
  const [cycle, setCycle] = useState('MENSAL');
  const [notes, setNotes] = useState(String(limits?.limiteNotas ?? 60));
  const [customers, setCustomers] = useState(String(limits?.limiteClientes ?? 25));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const inFlight = useRef(false);
  const operation = useRef<{ signature: string; id: string } | null>(null);
  const execute = async (action: 'GRANT' | 'INCREASE_NOW' | 'SUSPEND' | 'REACTIVATE') => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const benefit = parseAccountantBenefit({ action, kind, cycle,
        notes: notes.trim() ? Number(notes) : null, customers: customers.trim() ? Number(customers) : null });
      const description = action === 'GRANT'
        ? `Conceder ${benefit.notes} notas por ciclo mensal e ${benefit.customers} clientes, por ${cycle === 'ANUAL' ? '12 meses' : '1 mês'}? O início será após contratos vigentes/agendados. Não haverá cobrança nem renovação automática.`
        : action === 'INCREASE_NOW' ? `Aumentar agora o plano CUSTOM ativo para ${benefit.notes} notas e ${benefit.customers} clientes? O período, o aniversário do ciclo, o consumo e benefícios futuros serão preservados.`
        : action === 'SUSPEND' ? 'Suspender novas operações? Contratos, datas e histórico serão preservados.'
          : 'Reativar operações? Datas e créditos originais serão mantidos. Um contrato vencido continuará vencido.';
      if (!await dialog.showConfirm({ title: 'Confirme a operação contratual', description, type: 'warning' })) return;
      const authorization = await authorize(action === 'GRANT' ? 'conceder um benefício ao contador' : action === 'INCREASE_NOW' ? 'aumentar imediatamente os limites do contador' : 'alterar a suspensão operacional');
      if (!authorization) return;
      const signature = JSON.stringify([userId, benefit]);
      if (operation.current?.signature !== signature) operation.current = { signature, id: crypto.randomUUID() };
      const res = await fetch(`/api/admin/users/${userId}/beneficio`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...benefit, ...authorization, operationId: operation.current.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
      operation.current = null;
      await onChanged();
      const start = data.scheduledStart ? new Date(data.scheduledStart).toLocaleDateString('pt-BR') : null;
      const end = data.scheduledEnd ? new Date(data.scheduledEnd).toLocaleDateString('pt-BR') : null;
      setMessage(data.reused ? 'Operação já registrada anteriormente, sem duplicação.' : data.appliedImmediately ? `Novos limites aplicados agora. Período e consumo foram preservados.` : start ? `Benefício registrado de ${start} até ${end}. Nenhum pagamento foi lançado.` : 'Estado operacional atualizado. Contratos e consumo preservados.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha de conexão. Tente novamente com os mesmos dados.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <section aria-labelledby="accountant-benefit-title" className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-4">
    <div>
      <h4 id="accountant-benefit-title" className="font-bold text-slate-900">Concessão administrativa — sem cobrança</h4>
      <p className="text-sm text-slate-600 mt-1">A alteração de acesso não renova contratos. Novas condições são agendadas após os períodos existentes, sem alterar o consumo atual. Pagamentos devem ser conciliados em Contratações.</p>
    </div>
    <fieldset disabled={busy || suspended} className="grid gap-3 sm:grid-cols-2 disabled:opacity-60">
      <label className="text-sm font-medium">Modelo
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="block w-full border rounded-lg p-2 mt-1">
          <option value="DEFAULT">Starter: 60 notas / 25 clientes</option><option value="CUSTOM">Personalizado</option>
        </select>
      </label>
      <label className="text-sm font-medium">Prazo (sem renovação automática)
        <select value={cycle} onChange={(e) => setCycle(e.target.value)} className="block w-full border rounded-lg p-2 mt-1">
          <option value="MENSAL">1 mês</option><option value="ANUAL">12 meses</option>
        </select>
      </label>
      {kind === 'CUSTOM' && <>
        <label className="text-sm font-medium">Notas por ciclo mensal<input type="number" min="0" max="1000000" step="1" value={notes} onChange={(e) => setNotes(e.target.value)} className="block w-full border rounded-lg p-2 mt-1" /></label>
        <label className="text-sm font-medium">Clientes na carteira<input type="number" min="0" max="1000000" step="1" value={customers} onChange={(e) => setCustomers(e.target.value)} className="block w-full border rounded-lg p-2 mt-1" /></label>
      </>}
      <button type="button" onClick={() => execute('GRANT')} className="rounded-lg bg-blue-700 text-white font-semibold px-4 py-2">Conceder benefício</button>
      {kind === 'CUSTOM' && limits?.origem === 'CUSTOM' && <button type="button" onClick={() => execute('INCREASE_NOW')} className="rounded-lg bg-emerald-700 text-white font-semibold px-4 py-2">Aplicar aumento agora</button>}
    </fieldset>
    {limits?.origem === 'CUSTOM' && <p className="text-xs text-slate-700">Plano CUSTOM ativo: {limits.notasUsadas ?? 0} de {limits.limiteNotas ?? 0} notas e {limits.clientesUsados ?? 0} de {limits.limiteClientes ?? 0} clientes utilizados. O aumento imediato não altera o benefício agendado.</p>}
    <p className="text-xs text-slate-600">Zero é um limite finito. O consumo é renovado no aniversário mensal do contrato, inclusive em contratos anuais.</p>
    <button type="button" disabled={busy} onClick={() => execute(suspended ? 'REACTIVATE' : 'SUSPEND')} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50">
      {suspended ? 'Reativar acesso, preservando prazo' : 'Suspender operações, preservando contrato'}
    </button>
    <p role="status" aria-live="polite" className="text-sm text-slate-800">{busy ? 'Validando operação…' : message}</p>
  </section>;
}
