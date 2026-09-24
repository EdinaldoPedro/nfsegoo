import { SignJWT, jwtVerify } from 'jose';

// Garante que o segredo venha do ambiente em produção
const secretKey = process.env.JWT_SECRET;
if (!secretKey && process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET não definido no ambiente.');
}

const secret = new TextEncoder().encode(secretKey || 'dev_secret_fallback_do_not_use_in_prod');

export async function signJWT(payload: { sub: string; role: string; sv: number; sessionId: string }) {
  return await new SignJWT({ sub: payload.sub, role: payload.role, sv: payload.sv })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('nfsegoo')
    .setAudience('nfsegoo-web')
    .setJti(payload.sessionId)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret);
}

export async function verifyJWT(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'], issuer: 'nfsegoo', audience: 'nfsegoo-web',
    });
    return payload;
  } catch (error) {
    return null;
  }
}
if (secretKey && process.env.NODE_ENV === 'production' && Buffer.byteLength(secretKey, 'utf8') < 32) {
    throw new Error('FATAL: JWT_SECRET precisa ter ao menos 32 bytes em producao.');
}
