import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSameOrigin } from '@/app/utils/request-guards';
import { roleRequiresMfa } from '@/app/utils/mfa-policy';
import { findActiveAuthSession } from '@/app/utils/auth-session';

export async function getAuthenticatedUser(request: Request) {
  const originError = validateSameOrigin(request);
  if (originError) {
    return null;
  }

  // 1. Busca o token no Cookie HttpOnly
  const cookieStore = (await cookies());
  const token = cookieStore.get('auth_token')?.value;

  // 2. Se não tiver token, já retorna nulo (Bloqueia acesso)
  if (!token) {
    return null;
  }

  // 3. Valida o Token
  try {
    const session = await findActiveAuthSession(token);
    if (session) {
        const pathname = new URL(request.url).pathname;
        const securitySetupPath = ['/api/auth/mfa', '/api/auth/sessions', '/api/auth/trusted-devices', '/api/auth/logout', '/api/system/status'].includes(pathname);
        const legalSetupPath = securitySetupPath || pathname === '/api/legal/acceptance';
        const mfaPending = (roleRequiresMfa(session.user.role) && !session.user.mfaEnabledAt)
          || (Boolean(session.user.mfaEnabledAt) && !session.mfaVerifiedAt);
        if (mfaPending && !securitySetupPath) return null;
        if (session.user.legalAcceptances.length === 0 && !legalSetupPath) return null;
        return session.user;
    }
    return null;

  } catch (error) {
    return null;
  }
}

// Helpers de resposta (Mantenha-os no final do arquivo)
export function unauthorized() {
  return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: 'Acesso proibido' }, { status: 403 });
}
