import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from './api-middleware';
import { checkIsStaff } from './permissions';
import { getActiveImpersonation, isSafeImpersonationMethod } from './impersonation';

export async function validateRequest(request: Request) {
    // 1. Quem é você de verdade? (Baseado no Token Seguro)
    const authenticatedUser = await getAuthenticatedUser(request);
    
    if (!authenticatedUser) {
        return { user: null, errorResponse: NextResponse.json({ error: 'Token inválido ou expirado.' }, { status: 401 }) };
    }

    // 2. Quem você diz ser? (Enviado pelo Frontend)
    const requestedUserId = request.headers.get('x-user-id');

    // O header de contexto nunca concede acesso sozinho. Staff precisa de uma
    // sessao de impersonacao HttpOnly, curta e registrada no servidor.
    const isStaff = checkIsStaff(authenticatedUser.role);
    
    if (!isStaff && requestedUserId && requestedUserId !== authenticatedUser.id) {
        return { 
            user: null, 
            errorResponse: NextResponse.json({ 
                error: 'Violação de Acesso: Você não pode acessar dados de outro usuário.' 
            }, { status: 403 }) 
        };
    }

    let impersonation = null;
    if (isStaff && requestedUserId && requestedUserId !== authenticatedUser.id) {
        impersonation = await getActiveImpersonation({
            actorUserId: authenticatedUser.id,
            targetUserId: requestedUserId,
        });

        if (!impersonation) {
            return {
                user: null,
                errorResponse: NextResponse.json({
                    error: 'Sessao de suporte ausente, revogada ou expirada.'
                }, { status: 403 })
            };
        }

        if (impersonation.mode === 'READ_ONLY' && !isSafeImpersonationMethod(request.method)) {
            return {
                user: null,
                errorResponse: NextResponse.json({
                    error: 'A impersonacao de suporte permite somente visualizacao.'
                }, { status: 403 })
            };
        }
    }

    const targetId = impersonation ? requestedUserId! : authenticatedUser.id;

    return { user: authenticatedUser, targetId, impersonation, errorResponse: null };
}
