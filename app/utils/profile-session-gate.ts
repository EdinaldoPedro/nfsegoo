export type ProfileSessionStatus = {
  authenticated: boolean;
  mfaRequired?: boolean;
  legalAcceptanceRequired?: boolean;
};

const PROFILE_SYNC_EXEMPT_PATHS = new Set([
  '/seguranca',
  '/aceite-legal',
  '/termos-de-uso',
  '/politica-de-privacidade',
  '/politica-de-cookies',
]);

export function shouldSyncProfile(userId: string | null, pathname: string) {
  return Boolean(userId) && !PROFILE_SYNC_EXEMPT_PATHS.has(pathname);
}

export function profileAuthRedirect(status: ProfileSessionStatus) {
  if (!status.authenticated) return '/login?motivo=sessao-expirada';
  if (status.mfaRequired) return '/seguranca';
  if (status.legalAcceptanceRequired) return '/aceite-legal';
  return null;
}

export function runtimeSetupRedirect(status: ProfileSessionStatus, pathname: string) {
  if (!status.authenticated) return '/login?motivo=sessao-expirada';
  if (status.mfaRequired && pathname !== '/seguranca') return '/seguranca';
  // A pagina de seguranca controla a conclusao do onboarding. Depois de ativar
  // o MFA, ela ainda precisa exibir e confirmar os codigos de recuperacao.
  if (status.legalAcceptanceRequired && !status.mfaRequired
    && pathname !== '/seguranca' && pathname !== '/aceite-legal') return '/aceite-legal';
  return null;
}
