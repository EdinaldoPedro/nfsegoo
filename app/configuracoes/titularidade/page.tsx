import AppHeader from '@/components/AppHeader';
import OwnershipConsole from '@/components/OwnershipConsole';

export default function OwnershipPage() {
  return <div className="min-h-screen bg-slate-50"><AppHeader title="Transferência de empresa" backHref="/configuracoes/minha-conta" />
    <main className="mx-auto max-w-4xl space-y-6 p-[var(--saas-gutter)]"><header><h1 className="text-2xl font-black">Consentimentos de transferência</h1>
      <p className="mt-2 text-slate-600">Aceite somente se reconhece a empresa, a conta de destino e todas as consequências exibidas.</p></header><OwnershipConsole /></main>
  </div>;
}
