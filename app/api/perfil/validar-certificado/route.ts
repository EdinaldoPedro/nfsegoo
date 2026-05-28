import { NextResponse } from 'next/server';
import { validarCertificadoA1 } from '@/app/utils/certificadoA1Validation';
import { validateRequest } from '@/app/utils/api-security';

export async function POST(request: Request) {
  const { errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;

  try {
    const body = await request.json();
    const resultado = validarCertificadoA1(
      body.certificadoArquivo,
      body.certificadoSenha,
      body.documento,
    );

    return NextResponse.json({
      ok: true,
      cnpj: resultado.cnpj,
      vencimento: resultado.vencimento,
      message: 'Certificado validado com sucesso.',
    });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error.message || 'Nao foi possivel validar o certificado.',
    }, { status: 400 });
  }
}
