'use client';

const SESSION_KEYS = [
  'userId',
  'userRole',
  'empresaContextId',
  'isSupportMode',
  'adminBackUpId',
];

export function clearClientSession() {
  if (typeof window === 'undefined') return;
  SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
  sessionStorage.clear();
}

export function redirectToLogin(reason?: 'expired' | 'logout') {
  if (typeof window === 'undefined') return;
  clearClientSession();
  const query = reason === 'expired' ? '?motivo=sessao-expirada' : '';
  window.location.replace(`/login${query}`);
}

export async function logoutAndRedirect() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    redirectToLogin('logout');
  }
}
