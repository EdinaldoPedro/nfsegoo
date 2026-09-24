import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthenticatedUser } from '@/app/utils/api-middleware';
import { IMPERSONATION_COOKIE, revokeCurrentImpersonation } from '@/app/utils/impersonation';
import { revokeCurrentAuthSession } from '@/app/utils/auth-session';
import { validateSameOrigin } from '@/app/utils/request-guards';

export const POST = withApiGuard(async function POST(request: Request) {
    const originError = validateSameOrigin(request);
    if (originError) return originError;
    const actor = await getAuthenticatedUser(request);
    if (actor) {
        await revokeCurrentImpersonation(actor.id);
        await revokeCurrentAuthSession(actor.id);
    }
    // Apaga o cookie de autenticação definindo a expiração para o passado
    (await cookies()).set({
        name: 'auth_token',
        value: '',
        httpOnly: true,
        path: '/',
        maxAge: 0 // <--- Isto faz o navegador apagar o cookie imediatamente
    });
    (await cookies()).set({
        name: IMPERSONATION_COOKIE,
        value: '',
        httpOnly: true,
        path: '/',
        maxAge: 0,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
    });

    return NextResponse.json({ success: true, message: 'Sessão terminada' });
});
