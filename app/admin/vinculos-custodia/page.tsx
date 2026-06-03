'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  Clock,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useDialog } from '@/app/contexts/DialogContext';

type VinculoCustodia = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  contador: { nome?: string; email?: string; telefone?: string };
  empresa: {
    id: string;
    razaoSocial: string;
    documento: string;
    cidade?: string;
    uf?: string;
    contadorCustodiante?: { nome?: string; email?: string; telefone?: string } | null;
  };
};

function formatDoc(doc?: string) {
  const value = (doc || '').replace(/\D/g, '');
  if (value.length !== 14) return doc || '-';
  return value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatDate(date?: string) {
  if (!date) return '-';
  return new Date(date).toLocaleString('pt-BR');
}

export default function VinculosCustodiaAdminPage() {
  const dialog = useDialog();
  const [items, setItems] = useState<VinculoCustodia[]>([]);
  const [loading, setLoading] = useState(true);
  const [processandoId, setProcessandoId] = useState<string | null>(null);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/vinculos-custodia', { cache: 'no-store' });
      const data = await res.json();
      setItems(Array.isArray(data.data) ? data.data : []);
    } catch {
      dialog.showAlert({ type: 'danger', title: 'Falha', description: 'Nao foi possivel carregar a fila de custodia.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const resumo = useMemo(() => ({
    pendentes: items.length,
    semTelefone: items.filter((item) => !item.empresa.contadorCustodiante?.telefone).length,
  }), [items]);

  const resolver = async (item: VinculoCustodia, acao: 'LIBERAR_ACESSO' | 'TRANSFERIR_CUSTODIA' | 'NEGAR') => {
    const phrase = acao === 'LIBERAR_ACESSO' ? 'ACESSO' : acao === 'TRANSFERIR_CUSTODIA' ? 'TRANSFERIR' : 'NEGAR';
    const isAcesso = acao === 'LIBERAR_ACESSO';
    const isTransferencia = acao === 'TRANSFERIR_CUSTODIA';
    const confirmacao = await dialog.showPrompt({
      type: isTransferencia ? 'warning' : isAcesso ? 'success' : 'danger',
      title: isTransferencia ? 'Transferir custodia' : isAcesso ? 'Conceder acesso' : 'Negar solicitacao',
      description: `${
        isTransferencia
          ? 'A custodia sera transferida para'
          : isAcesso
            ? 'O acesso operacional sera liberado para'
            : 'A solicitacao sera rejeitada para'
      } ${item.contador.nome || item.contador.email}. Digite ${phrase} para confirmar.`,
      validationText: phrase,
      placeholder: phrase,
    });

    if (confirmacao !== phrase) return;

    setProcessandoId(item.id);
    try {
      const res = await fetch('/api/admin/vinculos-custodia', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vinculoId: item.id,
          acao,
          observacao: `Resolvido pela bancada interna: ${acao}.`,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao resolver solicitacao.');
      }

      await dialog.showAlert({
        type: 'success',
        title: 'Resolvido',
        description: data.message || 'Solicitacao atualizada.',
      });
      setItems((atual) => atual.filter((vinculo) => vinculo.id !== item.id));
    } catch (error: any) {
      dialog.showAlert({ type: 'danger', title: 'Falha', description: error.message || 'Erro interno.' });
    } finally {
      setProcessandoId(null);
    }
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-blue-600">Bancada interna</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Vinculos de custodia</h1>
          <p className="mt-2 max-w-3xl text-slate-500">
            Resolva solicitacoes de empresas orfas que ja possuem um contador custodiante.
          </p>
        </div>
        <button
          onClick={carregar}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
        >
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Clock className="text-amber-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">{resumo.pendentes}</p>
          <p className="text-xs font-bold uppercase text-slate-400">Pendentes com custodiante</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Phone className="text-blue-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">{resumo.semTelefone}</p>
          <p className="text-xs font-bold uppercase text-slate-400">Sem telefone do custodiante</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck className="text-emerald-600" />
          <p className="mt-3 text-3xl font-black text-slate-950">Admin</p>
          <p className="text-xs font-bold uppercase text-slate-400">Resolucao interna</p>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500">
          <Loader2 className="mr-2 animate-spin" /> Carregando solicitacoes...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <CheckCircle className="mx-auto text-emerald-500" size={34} />
          <p className="mt-3 text-lg font-black text-slate-900">Nenhuma pendencia de custodia</p>
          <p className="mt-1 text-sm text-slate-500">Quando houver conflito entre contadores, ele aparecera aqui.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => {
            const custodiante = item.empresa.contadorCustodiante;
            const processando = processandoId === item.id;

            return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-200">
                        <AlertTriangle size={13} /> Pendente com contador atual
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-bold text-slate-500">
                        {formatDoc(item.empresa.documento)}
                      </span>
                    </div>

                    <h2 className="mt-3 truncate text-2xl font-black text-slate-950">{item.empresa.razaoSocial}</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {item.empresa.cidade || 'Cidade nao informada'}{item.empresa.uf ? `/${item.empresa.uf}` : ''} · solicitado em {formatDate(item.createdAt)}
                    </p>

                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                        <p className="flex items-center gap-2 text-xs font-black uppercase text-blue-700">
                          <UserCheck size={15} /> Novo contador solicitante
                        </p>
                        <p className="mt-2 text-lg font-black text-slate-950">{item.contador.nome || 'Sem nome'}</p>
                        <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Mail size={14} /> {item.contador.email || '-'}</p>
                        <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Phone size={14} /> {item.contador.telefone || '-'}</p>
                      </div>

                      <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                        <p className="flex items-center gap-2 text-xs font-black uppercase text-amber-700">
                          <ShieldCheck size={15} /> Contador custodiante atual
                        </p>
                        <p className="mt-2 text-lg font-black text-slate-950">{custodiante?.nome || 'Nao identificado'}</p>
                        <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Mail size={14} /> {custodiante?.email || '-'}</p>
                        <p className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Phone size={14} /> {custodiante?.telefone || '-'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex w-full flex-col gap-2 lg:w-56">
                    <button
                      disabled={processando}
                      onClick={() => resolver(item, 'LIBERAR_ACESSO')}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-black text-blue-700 shadow-sm transition hover:bg-blue-100 disabled:opacity-60"
                    >
                      {processando ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} Dar acesso
                    </button>
                    <button
                      disabled={processando}
                      onClick={() => resolver(item, 'TRANSFERIR_CUSTODIA')}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {processando ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} Transferir
                    </button>
                    <button
                      disabled={processando}
                      onClick={() => resolver(item, 'NEGAR')}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                    >
                      <XCircle size={16} /> Negar
                    </button>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold leading-relaxed text-slate-500">
                      Dar acesso mantem o custodiante atual. Transferir muda a custodia principal e desvincula o aprovado anterior.
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
