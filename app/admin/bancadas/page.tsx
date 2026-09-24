import { redirect } from 'next/navigation';

// Endereco antigo mantido para favoritos e links existentes.
// A navegacao por bancadas foi reunida nos centros do menu administrativo.
export default function BancadasAdminPage() {
  redirect('/admin/dashboard');
}
