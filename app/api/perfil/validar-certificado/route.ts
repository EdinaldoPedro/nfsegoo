import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';
import { validarCertificadoA1 } from '@/app/utils/certificadoA1Validation';
import { validateRequest } from '@/app/utils/api-security';
import { assertCertificateInput, ProfileError } from '@/app/services/profileService';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';
import { normalizeDpsEnvironment } from '@/app/utils/dps-identity';
import { resolveEmpresaContexto } from '@/app/utils/access-control';
import { Pkcs12ValidationError } from '@/app/utils/pkcs12';

export const POST = withApiGuard(async function POST(request: Request) {
  const { user, targetId, errorResponse } = await validateRequest(request);
  if (errorResponse) return errorResponse;
  if (!user || user.id !== targetId || !await resolveEmpresaContexto(user, request.headers.get('x-empresa-id'))) return NextResponse.json({ error: 'Validação disponível ao titular ou vínculo autorizado.' }, { status: 403 });
  if (!await checkRateLimit(`certificate_validation_${user.id}`, 5, 5 * 60 * 1000)) return NextResponse.json({ error: 'Muitas validações. Aguarde cinco minutos.' }, { status: 429 });

  try {
    const body = await request.json();
    assertCertificateInput(body.certificadoArquivo, body.certificadoSenha);
    const documento = normalizeCnpj(body.documento);
    if (!validarCNPJ(documento)) throw new ProfileError('CNPJ inválido.');
    const ambiente = normalizeDpsEnvironment(body.ambiente);
    const resultado = validarCertificadoA1(
      body.certificadoArquivo,
      body.certificadoSenha,
      documento,
      { requireTrustedChain: ambiente === 'PRODUCAO' },
    );

    return NextResponse.json({
      ok: true,
      cnpj: resultado.cnpj,
      vencimento: resultado.vencimento,
      fingerprintSha256: resultado.fingerprintSha256,
      chainStatus: resultado.chainStatus,
      cnpjSource: resultado.cnpjSource,
      message: 'Arquivo, senha, validade e CNPJ conferidos. A aceitação fiscal depende da validação do Portal Nacional.',
    });
  } catch (error: unknown) {
    const knownError = error instanceof ProfileError || error instanceof Pkcs12ValidationError;
    return NextResponse.json({
      ok: false,
      error: knownError ? error.message : 'Não foi possível validar o certificado. Tente novamente ou contate o suporte.',
    }, { status: knownError ? error.status : 400 });
  }
}, { maxBodyBytes: 2 * 1024 * 1024 });
