import { withApiGuard } from '@/app/utils/api-route';
import { NextResponse } from 'next/server';

export const POST = withApiGuard(async function POST(request: Request) {
  try {
    const { cep } = await request.json();
    const cepLimpo = cep.replace(/\D/g, '');

    if (cepLimpo.length !== 8) {
      return NextResponse.json({ error: 'CEP inválido.' }, { status: 400 });
    }

    // Usamos o ViaCEP que é gratuito e confiável
    const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
    const data = await res.json();

    if (data.erro) {
      return NextResponse.json({ error: 'CEP não encontrado.' }, { status: 404 });
    }

    return NextResponse.json({
      logradouro: data.logradouro,
      bairro: data.bairro,
      cidade: data.localidade,
      uf: data.uf,
      codigoIbge: data.ibge // <--- OBRIGATÓRIO PARA A NFSE
    });

  } catch (error) {
    return NextResponse.json({ error: 'Erro ao consultar CEP.' }, { status: 500 });
  }
});