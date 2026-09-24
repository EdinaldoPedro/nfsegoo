import OwnershipConsole from '@/components/OwnershipConsole';

export default function AdminOwnershipPage() {
  return <div className="space-y-6"><header><p className="text-xs font-black uppercase tracking-widest text-blue-700">Governança de dados</p>
    <h1 className="text-3xl font-black">Titularidade verificada</h1><p className="mt-2 max-w-3xl text-slate-600">Transferências exigem evidência em chamado, consentimento individual e revisão final. Recuperações sem titular exigem outro MASTER.</p></header>
    <OwnershipConsole administrative />
  </div>;
}
