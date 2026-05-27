import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { upsertEmpresaAndLinkUser } from '@/app/services/empresaService';
import { stripEmpresaSecrets } from '@/app/utils/safe-data';

const prisma = new PrismaClient();

// GET
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');

  try {
    if (mode === 'contador') {
        if (!['CONTADOR', 'MASTER', 'ADMIN'].includes(user.role)) return forbidden();
        const vinculos = await prisma.contadorVinculo.findMany({
            where: { contadorId: user.id },
            include: { empresa: true },
            orderBy: { updatedAt: 'desc' }
        });
        return NextResponse.json(vinculos.map((vinculo) => ({
            ...vinculo,
            empresa: stripEmpresaSecrets(vinculo.empresa)
        })));
    }
    if (mode === 'cliente') {
        if (!user.empresaId) return NextResponse.json([]);
        const solicitacoes = await prisma.contadorVinculo.findMany({
            where: { empresaId: user.empresaId, status: 'PENDENTE' },
            include: { contador: { select: { nome: true, email: true } } }
        });
        return NextResponse.json(solicitacoes);
    }
    return NextResponse.json([]);
  } catch (e) { return NextResponse.json({ error: 'Erro ao buscar dados.' }, { status: 500 }); }
}

// POST
export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  
  if (user.role !== 'CONTADOR' && !['MASTER','ADMIN'].includes(user.role)) {
      return NextResponse.json({ error: 'Apenas contadores.' }, { status: 403 });
  }

  try {
    const { cnpj } = await request.json();
    if (!cnpj) return NextResponse.json({ error: 'CNPJ obrigatório.' }, { status: 400 });
    const cnpjLimpo = cnpj.replace(/\D/g, '');

    const dadosContador = await prisma.user.findUnique({ where: { id: user.id }, include: { empresasContabeis: true } });
    if (dadosContador) {
        const limite = dadosContador.limiteEmpresas || 100;
        if (dadosContador.empresasContabeis.length >= limite) return NextResponse.json({ error: `Limite atingido.` }, { status: 403 });
    }

    // Chama Service
    const resultado: any = await upsertEmpresaAndLinkUser(cnpjLimpo, user.id, null, 'CONTADOR');
    
    // Verifica se ficou PENDENTE ou APROVADO
    const isPendente = resultado._statusVinculo === 'PENDENTE';

    return NextResponse.json({ 
        success: true, 
        message: isPendente ? 'Solicitação enviada ao dono da empresa.' : 'Empresa vinculada com sucesso!', 
        status: resultado._statusVinculo 
    });

  } catch (e: any) { 
      console.error("[CONTADOR] Erro:", e);
      if (e.message && e.message.includes("Empresa já vinculada")) {
          return NextResponse.json({ error: "Esta empresa já está na sua lista (ou aguardando aprovação)." }, { status: 409 });
      }
      return NextResponse.json({ error: 'Erro: ' + e.message }, { status: 500 }); 
  }
}

// PUT
export async function PUT(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    try {
        const { vinculoId, acao } = await request.json();
        const vinculo = await prisma.contadorVinculo.findUnique({ where: { id: vinculoId } });
        if (!vinculo || vinculo.empresaId !== user.empresaId) return forbidden();
        
        if (acao === 'REJEITAR') {
            await prisma.contadorVinculo.delete({ where: { id: vinculoId } });
            return NextResponse.json({ success: true, message: 'Recusado.' });
        }
        await prisma.contadorVinculo.update({ where: { id: vinculoId }, data: { status: 'APROVADO' } });
        return NextResponse.json({ success: true, message: 'Aprovado!' });
    } catch (e) { return NextResponse.json({ error: 'Erro interno.' }, { status: 500 }); }
}

// DELETE
export async function DELETE(request: Request) {
    const user = await getAuthenticatedUser(request);
    if (!user) return unauthorized();
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'ID necessário' }, { status: 400 });
        const vinculo = await prisma.contadorVinculo.findUnique({ where: { id } });
        if (!vinculo) return NextResponse.json({ error: 'Vínculo não encontrado' }, { status: 404 });
        if (vinculo.contadorId !== user.id && !['MASTER', 'ADMIN'].includes(user.role)) return forbidden();
        await prisma.contadorVinculo.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (e) { return NextResponse.json({ error: 'Erro ao desvincular.' }, { status: 500 }); }
}
