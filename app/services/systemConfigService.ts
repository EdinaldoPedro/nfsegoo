import type { ConfiguracaoSistema, Prisma, Role } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { encrypt } from '@/app/utils/crypto';
import { CommercialError } from '@/app/utils/commercial-pricing';
import { assertSmtpHostAllowed, normalizeSmtpHost } from '@/app/utils/smtp-security';

const editable = ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpSecure', 'emailRemetente',
  'ibsCbsPilotoAtivo', 'ibsCbsMeiAtivo', 'ibsCbsSimplesAtivo', 'ibsCbsLucroPresumidoAtivo',
  'manutencaoAtiva', 'manutencaoTitulo', 'manutencaoMensagem', 'manutencaoPrevisao'] as const;
const fiscalFields = ['ibsCbsPilotoAtivo', 'ibsCbsMeiAtivo', 'ibsCbsSimplesAtivo', 'ibsCbsLucroPresumidoAtivo'] as const;

function text(value: unknown, label: string, max: number, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string') throw new CommercialError(`${label} inválido.`);
  const normalized = value.trim();
  if (normalized.length > max || Array.from(normalized).some(character => character.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(character))) {
    throw new CommercialError(`${label} inválido.`);
  }
  return nullable && !normalized ? null : normalized;
}

export function parseSystemConfigMutation(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommercialError('Envie uma configuração válida.');
  const body = input as Record<string, unknown>;
  const allowed = new Set([...editable, 'expectedVersion', 'adminPassword', 'justification', 'confirmarAlteracaoManutencao']);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new CommercialError('Campos não permitidos na configuração.');
  if (body.expectedVersion !== null && (!Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0)) {
    throw new CommercialError('Versão da configuração ausente. Recarregue a tela.', 409);
  }
  const data: Record<string, unknown> = {};
  for (const field of [...fiscalFields, 'smtpSecure', 'manutencaoAtiva'] as const) {
    if (field in body) {
      if (typeof body[field] !== 'boolean') throw new CommercialError(`${field} deve ser verdadeiro ou falso.`);
      data[field] = body[field];
    }
  }
  if ('smtpHost' in body) data.smtpHost = body.smtpHost === '' || body.smtpHost === null ? null : normalizeSmtpHost(body.smtpHost);
  if ('smtpPort' in body) {
    if (!Number.isSafeInteger(body.smtpPort) || Number(body.smtpPort) < 1 || Number(body.smtpPort) > 65535) throw new CommercialError('Porta SMTP inválida.');
    data.smtpPort = Number(body.smtpPort);
  }
  if ('smtpUser' in body) data.smtpUser = text(body.smtpUser, 'Usuário SMTP', 254, true);
  if ('emailRemetente' in body) {
    const sender = text(body.emailRemetente, 'Remetente', 254, true);
    if (sender && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) throw new CommercialError('Remetente SMTP inválido.');
    data.emailRemetente = sender;
  }
  if ('smtpPass' in body && body.smtpPass !== '' && body.smtpPass !== '********') {
    if (typeof body.smtpPass !== 'string' || Buffer.byteLength(body.smtpPass, 'utf8') > 1024) throw new CommercialError('Senha SMTP inválida.');
    data.smtpPass = body.smtpPass;
  }
  if ('manutencaoTitulo' in body) data.manutencaoTitulo = text(body.manutencaoTitulo, 'Título da manutenção', 120, true);
  if ('manutencaoMensagem' in body) data.manutencaoMensagem = text(body.manutencaoMensagem, 'Mensagem da manutenção', 1200, true);
  if ('manutencaoPrevisao' in body) data.manutencaoPrevisao = text(body.manutencaoPrevisao, 'Previsão da manutenção', 160, true);
  return { expectedVersion: body.expectedVersion as number | null, data, adminPassword: body.adminPassword,
    justification: body.justification, maintenanceConfirmed: body.confirmarAlteracaoManutencao === true };
}

const defaults = {
  smtpHost: null, smtpPort: 587, smtpUser: null, smtpSecure: false, emailRemetente: null,
  ibsCbsPilotoAtivo: true, ibsCbsMeiAtivo: false, ibsCbsSimplesAtivo: false, ibsCbsLucroPresumidoAtivo: true,
  manutencaoAtiva: false, manutencaoTitulo: 'Estamos realizando uma atualização', manutencaoMensagem: null,
  manutencaoPrevisao: null, manutencaoAtualizadaEm: null,
};

export function publicSystemConfig(row: ConfiguracaoSistema | null) {
  const source = row || defaults;
  return { smtpHost: source.smtpHost, smtpPort: source.smtpPort ?? 587, smtpUser: source.smtpUser,
    smtpPass: row?.smtpPass ? '********' : '', smtpSecure: source.smtpSecure, emailRemetente: source.emailRemetente,
    ibsCbsPilotoAtivo: source.ibsCbsPilotoAtivo, ibsCbsMeiAtivo: source.ibsCbsMeiAtivo,
    ibsCbsSimplesAtivo: source.ibsCbsSimplesAtivo, ibsCbsLucroPresumidoAtivo: source.ibsCbsLucroPresumidoAtivo,
    manutencaoAtiva: source.manutencaoAtiva, manutencaoTitulo: source.manutencaoTitulo,
    manutencaoMensagem: source.manutencaoMensagem, manutencaoPrevisao: source.manutencaoPrevisao,
    manutencaoAtualizadaEm: source.manutencaoAtualizadaEm, version: row?.version ?? null };
}

function same(left: unknown, right: unknown) {
  if (left instanceof Date) return right instanceof Date && left.getTime() === right.getTime();
  return left === right;
}

export async function updateSystemConfig(actor: { id: string; role: Role }, mutation: ReturnType<typeof parseSystemConfigMutation>) {
  const targetHost = mutation.data.smtpHost;
  if (typeof targetHost === 'string') {
    const preview = await prisma.configuracaoSistema.findUnique({ where: { id: 'config' }, select: { smtpHost: true } });
    if (preview?.smtpHost !== targetHost) await assertSmtpHostAllowed(targetHost);
  }
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ConfiguracaoSistema" WHERE "id" = 'config' FOR UPDATE`;
    const current = await tx.configuracaoSistema.findUnique({ where: { id: 'config' } });
    if ((current?.version ?? null) !== mutation.expectedVersion) throw new CommercialError('A configuração mudou em outra tela. Recarregue antes de salvar.', 409);
    const changed = Object.entries(mutation.data).filter(([key, value]) => key === 'smtpPass' || !same(current?.[key as keyof ConfiguracaoSistema] ?? (defaults as Record<string, unknown>)[key], value)).map(([key]) => key);
    if (!changed.length) return publicSystemConfig(current);
    if (actor.role !== 'MASTER' && changed.some(field => fiscalFields.includes(field as typeof fiscalFields[number]))) {
      throw new CommercialError('Somente MASTER pode alterar chaves fiscais globais.', 403);
    }
    if (changed.includes('manutencaoAtiva') && !mutation.maintenanceConfirmed) throw new CommercialError('Confirme explicitamente a mudança do modo de manutenção.');

    const nextHost = 'smtpHost' in mutation.data ? mutation.data.smtpHost : current?.smtpHost;
    const nextUser = 'smtpUser' in mutation.data ? mutation.data.smtpUser : current?.smtpUser;
    const smtpEndpointChanged = nextHost !== current?.smtpHost || nextUser !== current?.smtpUser;
    if (nextHost && (!nextUser || !('emailRemetente' in mutation.data ? mutation.data.emailRemetente : current?.emailRemetente))) {
      throw new CommercialError('Host, usuário e remetente SMTP são obrigatórios.');
    }
    if (smtpEndpointChanged && nextHost && !('smtpPass' in mutation.data)) {
      throw new CommercialError('Informe novamente a senha ao trocar o host ou usuário SMTP.', 409);
    }

    const data: Record<string, unknown> = { ...mutation.data };
    if ('smtpPass' in mutation.data) {
      const encrypted = encrypt(mutation.data.smtpPass as string);
      if (!encrypted) throw new Error('SMTP_SECRET_ENCRYPTION_FAILED');
      data.smtpPass = encrypted;
    }
    if (mutation.data.smtpHost === null) Object.assign(data, { smtpUser: null, smtpPass: null, emailRemetente: null });
    if (changed.includes('manutencaoAtiva')) data.manutencaoAtualizadaEm = new Date();
    data.version = current ? current.version + 1 : 0;
    const saved = current ? await tx.configuracaoSistema.update({ where: { id: 'config' }, data: data as Prisma.ConfiguracaoSistemaUncheckedUpdateInput })
      : await tx.configuracaoSistema.create({ data: { id: 'config', ...data } as Prisma.ConfiguracaoSistemaUncheckedCreateInput });
    await tx.systemLog.create({ data: { level: changed.some(field => fiscalFields.includes(field as typeof fiscalFields[number])) ? 'ALERTA' : 'INFO',
      action: 'SYSTEM_CONFIGURATION_CHANGED', module: 'CONFIGURACAO', userId: actor.id,
      message: 'Configuração global alterada após reautenticação.',
      details: JSON.stringify({ fields: changed.filter(field => field !== 'smtpPass'), smtpSecretChanged: changed.includes('smtpPass'),
        justification: String(mutation.justification || '').trim() }) } });
    return publicSystemConfig(saved);
  });
}
