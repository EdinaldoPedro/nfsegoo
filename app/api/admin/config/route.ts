import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getAuthenticatedUser, forbidden, unauthorized } from '@/app/utils/api-middleware';
import { encrypt } from '@/app/utils/crypto'; // <--- IMPORT DA CRIPTOGRAFIA
import { createLog } from '@/app/services/logger';

const prisma = new PrismaClient();

// GET: Busca configs
export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();

  let config = await prisma.configuracaoSistema.findUnique({ where: { id: 'config' } });
  
  if (!config) {
    config = await prisma.configuracaoSistema.create({
      data: {
        id: 'config',
        modeloDpsJson: JSON.stringify({ versao: "1.00", ambiente: "homologacao", tags: [] }, null, 2)
      }
    });
  }

  // === SEGURANÇA: Mascarar a senha para não expor no frontend ===
  const configSegura = { ...config };
  if (configSegura.smtpPass) {
      configSegura.smtpPass = '********'; // O frontend só verá os asteriscos
  }

  return NextResponse.json(configSegura);
}

// PUT: Salva configs
export async function PUT(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return unauthorized();
  if (!['MASTER', 'ADMIN'].includes(user.role)) return forbidden();

  const body = await request.json();

  try {
    const configAtual = await prisma.configuracaoSistema.findUnique({ where: { id: 'config' } });
    const alterandoManutencao = typeof body.manutencaoAtiva === 'boolean'
      && body.manutencaoAtiva !== (configAtual?.manutencaoAtiva ?? false);

    if (alterandoManutencao && body.confirmarAlteracaoManutencao !== true) {
      return NextResponse.json({ error: 'Confirme explicitamente a alteração do modo de manutenção.' }, { status: 400 });
    }

    if (body.modeloDpsJson && body.modeloDpsJson.trim() !== '') {
        try {
            JSON.parse(body.modeloDpsJson);
        } catch (e) {
            return NextResponse.json({ error: 'O JSON do DPS contém erros de sintaxe.' }, { status: 400 });
        }
    }

    const dataToUpdate: any = {
        ambiente: body.ambiente,
        versaoApi: body.versaoApi,
        smtpHost: body.smtpHost,
        smtpPort: body.smtpPort ? parseInt(body.smtpPort) : 587,
        smtpUser: body.smtpUser,
        smtpSecure: body.smtpSecure === true,
        emailRemetente: body.emailRemetente
    };

    const fiscalBooleanFields = [
      'ibsCbsPilotoAtivo',
      'ibsCbsMeiAtivo',
      'ibsCbsSimplesAtivo',
      'ibsCbsLucroPresumidoAtivo',
    ] as const;

    for (const field of fiscalBooleanFields) {
      if (typeof body[field] === 'boolean') dataToUpdate[field] = body[field];
    }

    if (typeof body.manutencaoAtiva === 'boolean') dataToUpdate.manutencaoAtiva = body.manutencaoAtiva;
    if (typeof body.manutencaoTitulo === 'string') dataToUpdate.manutencaoTitulo = body.manutencaoTitulo.trim().slice(0, 120) || 'Estamos realizando uma atualização';
    if (typeof body.manutencaoMensagem === 'string') dataToUpdate.manutencaoMensagem = body.manutencaoMensagem.trim().slice(0, 1200) || null;
    if (typeof body.manutencaoPrevisao === 'string') dataToUpdate.manutencaoPrevisao = body.manutencaoPrevisao.trim().slice(0, 160) || null;
    if (alterandoManutencao) dataToUpdate.manutencaoAtualizadaEm = new Date();

    // === SEGURANÇA: Criptografar a senha antes de salvar ===
    // Só atualiza se vier uma senha nova e que NÃO seja a máscara '********'
    if (body.smtpPass && body.smtpPass.trim() !== '' && body.smtpPass !== '********') {
        dataToUpdate.smtpPass = encrypt(body.smtpPass); 
    }

    if (body.modeloDpsJson) {
        dataToUpdate.modeloDpsJson = body.modeloDpsJson;
    }
    
    const updated = await prisma.configuracaoSistema.upsert({
      where: { id: 'config' },
      update: dataToUpdate,
      create: {
        id: 'config',
        ...dataToUpdate,
      },
    });

    // Mascara novamente a resposta do PUT
    const updatedSeguro = { ...updated };
    if (updatedSeguro.smtpPass) updatedSeguro.smtpPass = '********';

    if (alterandoManutencao) {
      await createLog({
        level: body.manutencaoAtiva ? 'ALERTA' : 'INFO',
        action: body.manutencaoAtiva ? 'MODO_MANUTENCAO_ATIVADO' : 'MODO_MANUTENCAO_DESATIVADO',
        message: body.manutencaoAtiva
          ? 'Modo de manutenção ativado para clientes e contadores.'
          : 'Modo de manutenção desativado; operação liberada.',
        details: { titulo: updated.manutencaoTitulo, previsao: updated.manutencaoPrevisao },
        userId: user.id,
      });
    }

    return NextResponse.json(updatedSeguro);

  } catch (e: any) {
    console.error("Erro ao salvar config:", e);
    return NextResponse.json({ error: 'Erro interno ao salvar.' }, { status: 500 });
  }
}
