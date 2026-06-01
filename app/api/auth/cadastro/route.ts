import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { validarCPF } from '@/app/utils/cpf';
import { EmailService } from '@/app/services/EmailService';
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
    const { nome, email, documento: documentoBody, cpf, telefone, senha } = body;
    const documento = documentoBody || cpf;
    const emailNormalizado = String(email || '').trim().toLowerCase();
    const documentoLimpo = String(documento || '').replace(/\D/g, '');

    if (!nome || !email || !documento || !senha) {
      return NextResponse.json({ error: 'Todos os campos sao obrigatorios' }, { status: 400 });
    }

    const nomeRegex = /^[A-Za-zÀ-ÿ\s^~]+$/;
    const ip = request.headers.get('x-forwarded-for') || '127.0.0.1';
    const ipAllowed = await checkRateLimit(`cadastro_ip_${ip}`, 10, 60 * 60 * 1000);
    const docAllowed = await checkRateLimit(`cadastro_doc_${documentoLimpo}`, 3, 60 * 60 * 1000);

    if (!ipAllowed || !docAllowed) {
      return NextResponse.json({ error: 'Muitas tentativas de cadastro. Aguarde e tente novamente.' }, { status: 429 });
    }

    if (!nomeRegex.test(nome)) {
      return NextResponse.json({ error: 'O nome contem caracteres invalidos. Use apenas letras e acentos.' }, { status: 400 });
    }

    const isSenhaForte = senha.length >= 8 && /[A-Z]/.test(senha) && /[0-9]/.test(senha) && /[^A-Za-z0-9]/.test(senha);
    if (!isSenhaForte) {
      return NextResponse.json({
        error: 'Sua senha e muito fraca. Use pelo menos 8 caracteres, 1 letra maiuscula, 1 numero e 1 caractere especial.',
      }, { status: 400 });
    }

    if (!validarCPF(documento)) {
      return NextResponse.json({ error: 'CPF invalido.' }, { status: 400 });
    }

    const usuarioExistente = await prisma.user.findFirst({
      where: { OR: [{ email: emailNormalizado }, { cpf: documentoLimpo }] },
      select: { id: true },
    });

    if (usuarioExistente) {
      return NextResponse.json({ error: 'Nao foi possivel concluir o cadastro com os dados informados.' }, { status: 409 });
    }

    const pendingConflict = await prisma.pendingRegistration.findFirst({
      where: { OR: [{ email: emailNormalizado }, { cpf: documentoLimpo }] },
    });

    if (pendingConflict && (pendingConflict.email !== emailNormalizado || pendingConflict.cpf !== documentoLimpo)) {
      return NextResponse.json({ error: 'Nao foi possivel concluir o cadastro com os dados informados.' }, { status: 409 });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const verificationCode = crypto.randomInt(100000, 999999).toString();
    const verificationExpires = new Date(Date.now() + 15 * 60 * 1000);

    const totalUsers = await prisma.user.count();
    const bootstrapAdminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const role = totalUsers === 0 && bootstrapAdminEmail === emailNormalizado ? 'ADMIN' : 'COMUM';

    await prisma.pendingRegistration.upsert({
      where: { email: emailNormalizado },
      create: {
        nome,
        email: emailNormalizado,
        senhaHash,
        cpf: documentoLimpo,
        telefone,
        role,
        verificationCode,
        verificationExpires,
      },
      update: {
        nome,
        senhaHash,
        cpf: documentoLimpo,
        telefone,
        role,
        verificationCode,
        verificationExpires,
      },
    });

    const emailService = new EmailService();
    const html = emailService.getTemplateVerificacaoEmail(nome, verificationCode);
    const emailResult = await emailService.sendEmail(emailNormalizado, 'Confirme seu cadastro', html);

    if (!emailResult.success) {
      await prisma.pendingRegistration.deleteMany({ where: { email: emailNormalizado } });
      return NextResponse.json({ error: 'Nao foi possivel enviar o codigo de confirmacao. Tente novamente mais tarde.' }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: 'Codigo enviado.' }, { status: 201 });
  } catch (error: any) {
    console.error('Erro Cadastro:', error);
    return NextResponse.json({ error: 'Erro interno ao iniciar cadastro.' }, { status: 500 });
  }
}
