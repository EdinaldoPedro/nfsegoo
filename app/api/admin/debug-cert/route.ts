import { NextResponse } from 'next/server';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { openEmpresaCertificate } from '@/app/services/certificateVault';
import { prisma } from '@/app/utils/prisma';

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_CERT_DEBUG !== 'true') {
    return NextResponse.json({ error: 'Nao encontrado.' }, { status: 404 });
  }

  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN', 'SUPORTE_TI'].includes(user.role)) return forbidden();

  const { searchParams } = new URL(request.url);
  const empresaId = searchParams.get('id');

  if (!empresaId) {
    return NextResponse.json({ error: 'ID da empresa necessario.' }, { status: 400 });
  }

  try {
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, certificadoA1: true, senhaCertificado: true },
    });

    if (!empresa || !empresa.certificadoA1) {
      return NextResponse.json({ error: 'Sem certificado.' }, { status: 404 });
    }

    const credenciais = openEmpresaCertificate({
      empresaId: empresa.id,
      certificadoA1: empresa.certificadoA1,
      senhaCertificado: empresa.senhaCertificado,
      purpose: 'VALIDATE_CERT',
    });

    return NextResponse.json({
      status: 'OK',
      fingerprintSha256: credenciais.fingerprintSha256,
    });
  } catch {
    return NextResponse.json({ status: 'CERT_ERROR' }, { status: 400 });
  }
}
