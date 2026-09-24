import { NextResponse } from 'next/server';
import { withApiGuard } from '@/app/utils/api-route';
import { prisma } from '@/app/utils/prisma';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { noticeAudiences } from '@/app/services/globalNoticeService';

export const GET = withApiGuard(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  const { id } = await params;
  if (!/^[a-z0-9-]{1,100}$/i.test(id)) return forbidden();
  if (!await checkRateLimit(`notice_attachment_${user.id}`, 20, 60_000)) return NextResponse.json({ error: 'Aguarde antes de baixar mais anexos.' }, { status: 429 });
  const now = new Date();
  const notice = await prisma.globalNotice.findFirst({ where: { id, status: 'ATIVO', publico: { in: noticeAudiences(user.role) },
    OR: [{ iniciaEm: null }, { iniciaEm: { lte: now } }], AND: [{ OR: [{ terminaEm: null }, { terminaEm: { gte: now } }] }] },
    select: { anexoNome: true, anexoBase64: true } });
  if (!notice?.anexoNome || !notice.anexoBase64) return forbidden();
  const match = notice.anexoBase64.match(/^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match || match[2].length > 2_800_000) return NextResponse.json({ error: 'Anexo indisponível.' }, { status: 409 });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
    return NextResponse.json({ error: 'Anexo indisponível.' }, { status: 409 });
  }
  const fileName = notice.anexoNome.replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 140) || 'anexo';
  const asciiName = fileName.normalize('NFKD').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'anexo';
  const encodedName = encodeURIComponent(fileName).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(bytes, { status: 200, headers: { 'Content-Type': match[1].toLowerCase(),
    'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`, 'Content-Length': String(bytes.length),
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});
