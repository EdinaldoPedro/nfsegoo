'use client';

import AppHeader from '@/components/AppHeader';
import ListaVendas from '@/components/ListaVendas';

export default function PaginaNotas() {
  return (
    <div className="saas-shell">
      <AppHeader
        title="Notas emitidas"
        subtitle="Notas de produção: consulte autorizadas e canceladas, baixe XML/PDF e solicite cancelamentos."
        eyebrow="Gerenciamento fiscal"
        backHref="/cliente/dashboard"
      />

      <div className="saas-container max-w-6xl">
        <ListaVendas onlyValid={true} />
      </div>
    </div>
  );
}
