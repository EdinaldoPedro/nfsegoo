'use client';

import AppHeader from '@/components/AppHeader';
import ListaVendas from '@/components/ListaVendas';

export default function PaginaNotas() {
  return (
    <div className="saas-shell">
      <AppHeader
        title="Notas emitidas"
        subtitle="Visualize notas autorizadas, baixe XML/PDF e realize cancelamentos."
        eyebrow="Gerenciamento fiscal"
        backHref="/cliente/dashboard"
      />

      <div className="saas-container max-w-6xl">
        <ListaVendas onlyValid={true} />
      </div>
    </div>
  );
}
