import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { validarCPF } from '@/app/utils/cpf';
import { EmailService } from '@/app/services/EmailService';
import { registrarEventoCrm } from '@/app/services/crmService';
import { prisma } from '@/app/utils/prisma';
import { checkRateLimit } from '@/app/utils/rate-limit';
import { validateJsonContentLength, validateSameOrigin } from '@/app/utils/request-guards';

export async function POST(request: Request) {
    try {
        const originError = validateSameOrigin(request);
        if (originError) return originError;

        const sizeError = validateJsonContentLength(request);
        if (sizeError) return sizeError;

        const body = await request.json();
        const { nome, email, documento, telefone, senha } = body;
        const emailNormalizado = String(email || '').trim().toLowerCase();
        const documentoLimpo = String(documento || '').replace(/\D/g, '');

        if (!nome || !email || !documento || !senha) {
            return NextResponse.json({ error: 'Todos os campos são obrigatórios' }, { status: 400 });
        }

        // 1. Validação do Nome
        const nomeRegex = /^[A-Za-záàâãéèêíïóôõöúçñÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ ]+$/;
        const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
        const ipAllowed = await checkRateLimit(`cadastro_ip_${ip}`, 10, 60 * 60 * 1000);
        const docAllowed = await checkRateLimit(`cadastro_doc_${documentoLimpo}`, 3, 60 * 60 * 1000);

        if (!ipAllowed || !docAllowed) {
            return NextResponse.json({ error: 'Muitas tentativas de cadastro. Aguarde e tente novamente.' }, { status: 429 });
        }

        if (!nomeRegex.test(nome)) {
            return NextResponse.json({ error: 'O nome contém caracteres inválidos. Use apenas letras e acentos.' }, { status: 400 });
        }

        // === NOVA TRAVA: REGRA DE SENHA FORTE ===
        const isSenhaForte = senha.length >= 8 && /[A-Z]/.test(senha) && /[0-9]/.test(senha) && /[^A-Za-z0-9]/.test(senha);
        
        if (!isSenhaForte) {
            return NextResponse.json({ 
                error: 'Sua senha é muito fraca. Use pelo menos 8 caracteres, 1 letra maiúscula, 1 número e 1 caractere especial (Ex: @, !, #).' 
            }, { status: 400 });
        }

        // 3. Validação de CPF (o frontend manda como 'documento')
        const cpf = documento;
        if (!validarCPF(cpf)) {
            return NextResponse.json({ error: 'CPF inválido.' }, { status: 400 });
        }
        const cpfLimpo = documentoLimpo;

        // 4. Verificação de Duplicidade (Check Final)
        const usuarioExistente = await prisma.user.findFirst({
            where: { OR: [{ email: emailNormalizado }, { cpf: cpfLimpo }] }
        });

        if (usuarioExistente) {
            return NextResponse.json({ error: 'Nao foi possivel concluir o cadastro com os dados informados.' }, { status: 409 });
        }

        // 5. Preparação dos Dados
        const senhaHash = await bcrypt.hash(senha, 10);
        const verificationCode = crypto.randomInt(100000, 999999).toString();
        const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

        // Define o cargo (Primeiro usuário vira ADMIN, resto COMUM)
        const totalUsers = await prisma.user.count();
        const bootstrapAdminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
        const role = totalUsers === 0 && bootstrapAdminEmail === emailNormalizado ? 'ADMIN' : 'COMUM';

        // 6. Criação do Usuário
        const newUser = await prisma.user.create({
            data: {
                nome,
                email: emailNormalizado,
                senha: senhaHash,
                cpf: cpfLimpo,
                telefone,
                role,
                verificationCode,
                verificationExpires,
                tutorialStep: 0,
                // Cria plano TRIAL automaticamente
                historicoPlanos: {
                    create: {
                        plan: { connect: { slug: 'TRIAL' } }, 
                        status: 'ATIVO',
                        dataFim: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dias
                        notasEmitidas: 0
                    }
                }
            }
        });

        // === GATILHO PARA O CRM ===
        await registrarEventoCrm(
            newUser.id, 
            'SISTEMA', 
            'Conta Criada', 
            'O cliente realizou o registo através do site e o plano TRIAL de 7 dias foi ativado.'
        );

        // 7. Envio do E-mail
        const emailService = new EmailService();
        const html = emailService.getTemplateVerificacaoEmail(nome, verificationCode);
        await emailService.sendEmail(emailNormalizado, 'Confirme seu cadastro', html);

        return NextResponse.json({ success: true, message: 'Código enviado.' }, { status: 201 });

    } catch (error: any) {
        console.error("Erro Cadastro:", error);
        if (error?.code === 'P2025') {
            return NextResponse.json({ error: 'Erro de configuração do sistema (Plano Base não encontrado no banco).' }, { status: 500 });
        }
        return NextResponse.json({ error: 'Erro interno ao criar conta.' }, { status: 500 });
    }
}
