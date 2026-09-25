'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, CircleDollarSign, Loader2, Plus, Settings, ShieldAlert, X } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import { useDialog } from '@/app/contexts/DialogContext';
import { formatCnpj, formatCnpjInput } from '@/app/utils/cnpj';

type Company = {
  id: string;
  razaoSocial: string;
  cnpj: string;
  ambiente: string;
  cadastroCompleto: boolean;
  certificadoValidado: boolean;
  certificadoVencimento: string | null;
  isPrimary: boolean;
};

type AccountCompanies = {
  role: string;
  listaEmpresas: Company[];
  empresaPrimariaId: string | null;
  empresasUsadas: number;
  limiteEmpresasTotal: number;
  podeCadastrarEmpresa: boolean;
  planoIlimitado: boolean;
};

export default function MinhasEmpresasPage() {
  const dialog = useDialog();
  const [account, setAccount] = useState<AccountCompanies | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ documento: '', razaoSocial: '' });

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/perfil?escopo=CONTA', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar suas empresas.');
      if (result.role !== 'COMUM') {
        window.location.replace(result.role === 'CONTADOR' ? '/contador' : '/admin/dashboard');
        return;
      }
      setAccount(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha de conexão.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const canCreate = Boolean(account?.podeCadastrarEmpresa
    && (account.planoIlimitado || account.empresasUsadas < account.limiteEmpresasTotal));
  const capacity = useMemo(() => account?.planoIlimitado ? 'Ilimitado'
    : `${account?.empresasUsadas || 0} de ${account?.limiteEmpresasTotal || 0}`, [account]);

  const accessCompany = (company: Company, destination = '/cliente/dashboard') => {
    if (company.id === account?.empresaPrimariaId) localStorage.removeItem('empresaContextId');
    else localStorage.setItem('empresaContextId', company.id);
    window.location.assign(destination);
  };

  const createCompany = async (event: FormEvent) => {
    event.preventDefault(); setCreating(true);
    try {
      const response = await fetch('/api/empresas/adicional', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível cadastrar o CNPJ.');
      setShowCreate(false); setForm({ documento: '', razaoSocial: '' });
      await dialog.showAlert({ type: 'success', title: result.created ? 'Empresa cadastrada' : 'Empresa já vinculada',
        description: result.created ? 'O novo CNPJ foi criado em homologação. Complete o cadastro e o certificado antes de emitir.' : 'Este CNPJ já pertence à sua conta.' });
      await load();
    } catch (cause) {
      await dialog.showAlert({ type: 'danger', title: 'Cadastro não concluído',
        description: cause instanceof Error ? cause.message : 'Falha de conexão.' });
    } finally { setCreating(false); }
  };

  return <div className="saas-shell min-h-screen">
    <AppHeader title="Minhas empresas" eyebrow="Operação" backHref="/cliente/dashboard"
      subtitle="Escolha em qual CNPJ trabalhar ou amplie sua capacidade quando necessário." />

    <main className="saas-container max-w-6xl space-y-6">
      {loading ? <div className="saas-card flex items-center justify-center gap-2 p-10 text-slate-500"><Loader2 className="animate-spin" /> Carregando empresas…</div>
        : error ? <div role="alert" className="saas-card p-6 text-red-700"><p>{error}</p><button onClick={() => void load()} className="saas-btn-secondary mt-4">Tentar novamente</button></div>
          : account && <>
            <section className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
              <div><h2 className="text-2xl font-black text-slate-950">Sua operação por empresa</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Cada empresa possui cadastro, certificado, clientes e notas independentes. Selecionar uma empresa apenas troca o contexto de trabalho.</p></div>
              <div className="saas-card flex items-center gap-3 px-5 py-4"><Building2 className="text-blue-600" />
                <div><p className="text-xs font-black uppercase tracking-wider text-slate-400">Capacidade utilizada</p><p className="font-black text-slate-900">{capacity}</p></div></div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {account.listaEmpresas.map(company => {
                const certificateExpired = company.certificadoVencimento && new Date(company.certificadoVencimento) < new Date();
                return <article key={company.id} className="saas-card flex min-h-64 flex-col p-6">
                  <div className="flex items-start justify-between gap-3"><span className="rounded-xl bg-blue-50 p-3 text-blue-700"><Building2 size={22}/></span>
                    {company.isPrimary && <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase text-slate-600">Principal</span>}</div>
                  <h3 className="mt-4 break-words text-lg font-black text-slate-950">{company.razaoSocial}</h3>
                  <p className="mt-1 text-sm text-slate-500">{formatCnpj(company.cnpj)}</p>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
                    <span className={`rounded-full px-3 py-1 ${company.cadastroCompleto ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{company.cadastroCompleto ? 'Cadastro completo' : 'Cadastro pendente'}</span>
                    <span className={`rounded-full px-3 py-1 ${company.certificadoValidado && !certificateExpired ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{company.certificadoValidado && !certificateExpired ? 'Certificado válido' : 'Certificado pendente'}</span>
                    {company.ambiente === 'HOMOLOGACAO' && <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">Homologação</span>}
                  </div>
                  <div className="mt-auto grid grid-cols-2 gap-2 pt-5"><button type="button" onClick={() => accessCompany(company)} className="saas-btn-primary justify-center"><CheckCircle2 size={17}/> Acessar</button>
                    <button type="button" onClick={() => accessCompany(company, '/configuracoes')} className="saas-btn-secondary justify-center"><Settings size={17}/> Configurar</button></div>
                </article>;
              })}
            </section>

            <section className="saas-card flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">{canCreate ? <Plus className="mt-1 text-blue-600" /> : <CircleDollarSign className="mt-1 text-amber-600" />}
                <div><h2 className="font-black text-slate-950">{canCreate ? 'Cadastrar outro CNPJ próprio' : 'Precisa operar outra empresa?'}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{canCreate ? 'Você possui capacidade disponível. O novo cadastro começa em homologação e exige configuração fiscal e certificado.' : 'Contrate um pacote adicional de empresa. Após a liberação, o cadastro do novo CNPJ ficará disponível aqui.'}</p></div></div>
              {canCreate ? <button type="button" onClick={() => setShowCreate(true)} className="saas-btn-primary shrink-0 justify-center"><Plus size={18}/> Cadastrar outro CNPJ</button>
                : <Link href="/checkout" className="saas-btn-primary shrink-0 justify-center"><CircleDollarSign size={18}/> Contratar empresa adicional</Link>}
            </section>
          </>}
    </main>

    {showCreate && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b bg-slate-50 p-5"><div><h2 className="font-black text-slate-950">Cadastrar outro CNPJ</h2><p className="mt-1 text-xs text-slate-500">Somente empresas próprias desta conta.</p></div>
          <button type="button" onClick={() => setShowCreate(false)} aria-label="Fechar" className="rounded-lg p-2 hover:bg-slate-200"><X size={19}/></button></header>
        <form onSubmit={createCompany} className="space-y-4 p-6">
          <label className="block text-sm font-bold">CNPJ<input required maxLength={18} value={form.documento} onChange={event => setForm(previous => ({ ...previous, documento: formatCnpjInput(event.target.value) }))} className="saas-input mt-2 font-mono" placeholder="00.AAA.000/0000-00" /></label>
          <label className="block text-sm font-bold">Razão social<input required minLength={2} maxLength={200} value={form.razaoSocial} onChange={event => setForm(previous => ({ ...previous, razaoSocial: event.target.value }))} className="saas-input mt-2" /></label>
          <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><ShieldAlert size={17} className="shrink-0"/>Um CNPJ já existente no SaaS exige verificação de titularidade pelo atendimento e não será apropriado automaticamente.</p>
          <button disabled={creating} className="saas-btn-primary w-full justify-center">{creating ? <Loader2 className="animate-spin" size={18}/> : <Plus size={18}/>} {creating ? 'Cadastrando…' : 'Confirmar cadastro'}</button>
        </form>
      </div>
    </div>}
  </div>;
}
