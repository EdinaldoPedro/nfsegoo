export type ProfileSessionStatus = {
  authenticated: boolean;
  mfaRequired?: boolean;
  legalAcceptanceRequired?: boolean;
};

export function shouldSyncProfile(userId: string | null, pathname: string) {
  return Boolean(userId) && pathname !== '/seguranca' && pathname !== '/aceite-legal';
}

export function profileAuthRedirect(status: ProfileSessionStatus) {
  if (!status.authenticated) return '/login?motivo=sessao-expirada';
  if (status.mfaRequired) return '/seguranca';
  if (status.legalAcceptanceRequired) return '/aceite-legal';
  return null;
}
