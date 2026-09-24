import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';
import { hasCustomerCompanyAccess, isCustomerRole } from '@/app/utils/access-control';
import { normalizeCnpj, validarCNPJ } from '@/app/utils/cnpj';
import { normalizeDpsEnvironment, normalizeDpsNumber, normalizeDpsSeries } from '@/app/utils/dps-identity';
import { normalizarRegimeTributario } from '@/app/utils/regime-tributario';
import { validarCertificadoA1 } from '@/app/utils/certificadoA1Validation';
import { Pkcs12ValidationError } from '@/app/utils/pkcs12';
import { encrypt } from '@/app/utils/crypto';
import { commercialTransaction } from './commercialService';
import { getEffectivePlanLimits } from './planService';
import { setUserDpsSequenceInTransaction } from './dpsSequenceStore';

export class ProfileError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProfileError('Dados de cadastro inválidos.');
  return input as Record<string, unknown>;
}
function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new ProfileError('Há campos que não podem ser alterados nesta operação. Atualize a tela.');
}
function text(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== 'string' || value.length > max || value.trim().length < min || Array.from(value).some(c => c.charCodeAt(0) < 32)) {
    throw new ProfileError(`${label}: informe um texto entre ${min} e ${max} caracteres, sem controles.`);
  }
  return value.trim();
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ProfileError(`${label}: valor inválido.`);
  return value;
}
function email(value: unknown): string {
  const result = text(value, 'E-mail comercial', 254).toLowerCase();
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new ProfileError('E-mail comercial inválido.');
  return result;
}

export function parseAccountProfile(input: unknown): Prisma.UserUpdateInput {
  const body = object(input);
  only(body, ['escopo', 'nome', 'telefone', 'cargo', 'configuracoes']);
  const data: Prisma.UserUpdateInput = {};
  if (body.nome !== undefined) data.nome = text(body.nome, 'Nome', 160, 2);
  if (body.telefone !== undefined) data.telefone = text(body.telefone, 'Telefone', 30);
  if (body.cargo !== undefined) data.cargo = text(body.cargo, 'Cargo', 100);
  if (body.configuracoes !== undefined) {
    const options = object(body.configuracoes);
    only(options, ['darkMode', 'idioma', 'notificacoesEmail']);
    if (options.darkMode !== undefined) data.darkMode = bool(options.darkMode, 'Tema');
    if (options.notificacoesEmail !== undefined) data.notificacoesEmail = bool(options.notificacoesEmail, 'Notificações');
    if (options.idioma !== undefined) {
      if (!['pt-BR', 'en-US', 'es-ES'].includes(String(options.idioma))) throw new ProfileError('Idioma não suportado.');
      data.idioma = options.idioma as string;
    }
  }
  return data;
}

export function assertCertificateInput(file: unknown, password: unknown) {
  if (typeof file !== 'string' || !file || file.length > 1_398_104 || file.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file)) {
    throw new ProfileError('Certificado inválido. Envie um arquivo PFX/P12 de até 1 MiB, em base64.');
  }
  const bytes = Buffer.from(file, 'base64');
  if (bytes.length > 1024 * 1024 || bytes.toString('base64') !== file) throw new ProfileError('Certificado maior que 1 MiB ou base64 inválido.');
  if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 256 || password.includes('\u0000')) throw new ProfileError('Informe a senha do certificado, com até 256 bytes.');
}

export function parseCompanyProfile(input: unknown) {
  const body = object(input);
  only(body, ['escopo', 'empresaConfirmadaId', 'empresaAtualizadaEm', 'documento', 'razaoSocial', 'nomeFantasia', 'inscricaoMunicipal',
    'regimeTributario', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'codigoIbge', 'emailComercial',
    'ambiente', 'serieDPS', 'ultimoDPS', 'cnaes', 'certificadoArquivo', 'certificadoSenha', 'deletarCertificado', 'accountPassword']);
  const documento = normalizeCnpj(body.documento);
  if (!validarCNPJ(documento)) throw new ProfileError('CNPJ inválido. Confira o formato e os dígitos verificadores.');
  if (body.empresaConfirmadaId !== null && (typeof body.empresaConfirmadaId !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(body.empresaConfirmadaId))) {
    throw new ProfileError('Atualize a tela para confirmar qual empresa será alterada.');
  }
  const companyId = body.empresaConfirmadaId as string | null;
  if (companyId && (typeof body.empresaAtualizadaEm !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(body.empresaAtualizadaEm))) {
    throw new ProfileError('Versão do cadastro ausente. Atualize a tela antes de salvar.');
  }
  const data: Prisma.EmpresaUncheckedUpdateInput = {};
  for (const [field, max] of Object.entries({ razaoSocial: 200, nomeFantasia: 200, inscricaoMunicipal: 30,
    logradouro: 200, numero: 20, complemento: 100, bairro: 100, cidade: 100 })) {
    if (body[field] !== undefined) (data as Record<string, unknown>)[field] = text(body[field], field, max, field === 'razaoSocial' ? 2 : 0);
  }
  if (body.cep !== undefined) {
    const value = text(body.cep, 'CEP', 9).replace('-', '');
    if (value && !/^\d{8}$/.test(value)) throw new ProfileError('CEP inválido.');
    data.cep = value;
  }
  if (body.codigoIbge !== undefined) {
    const value = text(body.codigoIbge, 'Código IBGE', 7);
    if (value && !/^\d{7}$/.test(value)) throw new ProfileError('Código IBGE inválido.');
    data.codigoIbge = value;
  }
  if (body.uf !== undefined) {
    const value = text(body.uf, 'UF', 2).toUpperCase();
    if (value && !'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(value)) throw new ProfileError('UF inválida.');
    data.uf = value;
  }
  if (body.emailComercial !== undefined) data.email = email(body.emailComercial);
  if (body.regimeTributario !== undefined) {
    const regime = normalizarRegimeTributario(body.regimeTributario);
    if (!regime) throw new ProfileError('Selecione um regime tributário atendido.');
    data.regimeTributario = regime;
  }
  if (body.ambiente !== undefined) data.ambiente = normalizeDpsEnvironment(body.ambiente);
  if (body.serieDPS !== undefined) data.serieDPS = normalizeDpsSeries(body.serieDPS);
  const ultimoDPS = body.ultimoDPS === undefined ? undefined : normalizeDpsNumber(body.ultimoDPS, true);
  let cnaes: Array<{ codigo: string; descricao: string; principal: boolean }> | undefined;
  if (body.cnaes !== undefined) {
    if (!Array.isArray(body.cnaes) || body.cnaes.length < 1 || body.cnaes.length > 100) throw new ProfileError('Informe de 1 a 100 atividades, com uma principal.');
    cnaes = body.cnaes.map(raw => {
      const item = object(raw); only(item, ['codigo', 'descricao', 'principal']);
      const codigo = text(item.codigo, 'CNAE', 10).replace(/[./-]/g, '');
      if (!/^\d{7}$/.test(codigo)) throw new ProfileError('CNAE deve ter sete dígitos.');
      return { codigo, descricao: text(item.descricao, 'Descrição do CNAE', 500, 2), principal: bool(item.principal, 'Atividade principal') };
    });
    if (new Set(cnaes.map(item => item.codigo)).size !== cnaes.length || cnaes.filter(item => item.principal).length !== 1) throw new ProfileError('CNAEs duplicados ou atividade principal inválida.');
  }
  const removeCertificate = body.deletarCertificado === undefined ? false : bool(body.deletarCertificado, 'Remover certificado');
  const hasFile = body.certificadoArquivo !== undefined && body.certificadoArquivo !== null && body.certificadoArquivo !== '';
  const hasPassword = body.certificadoSenha !== undefined && body.certificadoSenha !== null && body.certificadoSenha !== '';
  if (removeCertificate && (hasFile || hasPassword)) throw new ProfileError('Escolha remover ou substituir o certificado, não ambos.');
  if (hasFile || hasPassword) assertCertificateInput(body.certificadoArquivo, body.certificadoSenha);
  return { body, data, documento, companyId, expectedVersion: body.empresaAtualizadaEm, ultimoDPS, cnaes, removeCertificate, hasFile };
}

/** Separate account/company scopes; no mass assignment, orphan adoption or global
 * tax-rule publication. Access, version, fiscal settings and audit commit together. */
export async function updateProfile(actorId: string, contextId: string | null, input: unknown) {
  const body = object(input);
  if (body.escopo === 'CONTA') {
    const data = parseAccountProfile(body);
    return commercialTransaction(actorId, async tx => {
      await tx.user.update({ where: { id: actorId }, data });
      await tx.systemLog.create({ data: { level: 'INFO', action: 'SELF_PROFILE_UPDATED', module: 'PERFIL', userId: actorId,
        message: 'Dados pessoais/preferências atualizados sem alterar empresa ou acesso.', details: JSON.stringify({ fields: Object.keys(data) }) } });
      return { success: true };
    });
  }
  if (body.escopo !== 'EMPRESA') throw new ProfileError('Escolha o escopo CONTA ou EMPRESA. Atualize a tela.');
  const inputCompany = parseCompanyProfile(body);
  const actorBefore = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, empresaId: true } });
  if (!actorBefore) throw new ProfileError('Conta não encontrada.', 403);
  if (!inputCompany.companyId && !isCustomerRole(actorBefore.role)) {
    throw new ProfileError('Cadastre novas empresas pelo fluxo administrativo. Nesta área você pode operar somente sua própria empresa.', 403);
  }
  if (inputCompany.companyId && !await hasCustomerCompanyAccess(actorBefore, inputCompany.companyId)) {
    throw new ProfileError('Use a conta titular ou um vínculo autorizado para alterar este cadastro fiscal.', 403);
  }
  let certificate: { file: string; password: string; expires: Date; cnpj: string; fingerprintSha256: string; chainStatus: string; cnpjSource: string; validatedAt: Date } | undefined;
  if (inputCompany.hasFile) {
    const file = body.certificadoArquivo as string; const password = body.certificadoSenha as string;
    let result: ReturnType<typeof validarCertificadoA1>;
    try {
      result = validarCertificadoA1(file, password, inputCompany.documento, {
        // Omission is treated conservatively for rotations of an existing production certificate.
        requireTrustedChain: body.ambiente !== 'HOMOLOGACAO',
      });
    } catch (error) {
      if (error instanceof Pkcs12ValidationError) throw new ProfileError(error.message);
      throw new ProfileError('Não foi possível validar o certificado. Tente novamente ou contate o suporte.');
    }
    const encryptedFile = encrypt(file); const encryptedPassword = encrypt(password);
    if (!encryptedFile || !encryptedPassword) throw new Error('Certificate encryption unavailable');
    certificate = { file: encryptedFile, password: encryptedPassword, expires: result.vencimento,
      cnpj: result.cnpj, fingerprintSha256: result.fingerprintSha256, chainStatus: result.chainStatus,
      cnpjSource: result.cnpjSource, validatedAt: new Date() };
  }
  return commercialTransaction(actorId, async tx => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, empresaId: true, senha: true } });
    const selectedId = contextId && contextId !== 'null' && contextId !== 'undefined'
      ? contextId
      : actor.empresaId || inputCompany.companyId;
    if (selectedId !== inputCompany.companyId) throw new ProfileError('A empresa selecionada mudou. Atualize a tela.', 409);
    if (selectedId) await tx.$queryRaw`SELECT "id" FROM "Empresa" WHERE "id" = ${selectedId} FOR UPDATE`;
    const current = selectedId ? await tx.empresa.findUnique({ where: { id: selectedId }, include: { atividades: true } }) : null;
    if (selectedId && (!current || !await hasCustomerCompanyAccess(actor, selectedId, tx))) throw new ProfileError('Vínculo revogado ou empresa indisponível.', 403);
    if (!selectedId && !isCustomerRole(actor.role)) throw new ProfileError('Papel alterado. Entre novamente.', 403);
    if (current && current.updatedAt.toISOString() !== inputCompany.expectedVersion) throw new ProfileError('Este cadastro foi alterado em outra operação. Atualize a página e confira os dados antes de salvar.', 409);
    if (current && current.documento !== inputCompany.documento) throw new ProfileError('O CNPJ de uma empresa existente não pode ser substituído. Cadastre outra empresa ou solicite análise ao atendimento.', 409);
    if (!current) {
      const existing = await tx.empresa.findUnique({ where: { documento: inputCompany.documento }, select: { id: true } });
      if (existing) throw new ProfileError('Este cadastro precisa de verificação de titularidade pelo atendimento. Nenhum vínculo foi criado.', 409);
      const limits = await getEffectivePlanLimits(actorId, tx);
      const pending = await tx.contadorVinculo.count({ where: { contadorId: actorId, arquivadoEm: null, status: { in: ['PENDENTE', 'PENDENTE_DONO', 'PENDENTE_CUSTODIANTE'] }, empresa: { arquivadoEm: null } } });
      if (!limits.allowedBase || (!limits.unlimited && limits.empresasUsadas + pending >= limits.limiteEmpresas)) throw new ProfileError(limits.reason || 'Limite de empresas atingido. Consulte seu plano.', 403);
    }
    const nextEnvironment = String(inputCompany.data.ambiente ?? current?.ambiente ?? 'HOMOLOGACAO');
    if (certificate || inputCompany.removeCertificate || (nextEnvironment === 'PRODUCAO' && current?.ambiente !== 'PRODUCAO')) {
      if (typeof body.accountPassword !== 'string' || !body.accountPassword || Buffer.byteLength(body.accountPassword, 'utf8') > 72 ||
          !await bcrypt.compare(body.accountPassword, actor.senha)) throw new ProfileError('Confirme sua senha de acesso para alterar o certificado ou ativar produção.', 403);
    }
    const activities = inputCompany.cnaes ?? current?.atividades ?? [];
    const merged = { ...current, ...inputCompany.data };
    if (!merged.razaoSocial || !merged.regimeTributario || !activities.length) throw new ProfileError('Preencha razão social, regime e atividades antes de salvar.');
    const complete = ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'codigoIbge'].every(key => !!(merged as Record<string, unknown>)[key]);
    const data = { ...inputCompany.data, ambiente: nextEnvironment, cadastroCompleto: complete,
      updatedAt: new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1)),
      ...(inputCompany.removeCertificate ? { certificadoA1: null, senhaCertificado: null, certificadoVencimento: null,
        certificadoCnpj: null, certificadoFingerprintSha256: null, certificadoValidadoEm: null, certificadoChainStatus: null, certificadoCnpjSource: null } :
        certificate ? { certificadoA1: certificate.file, senhaCertificado: certificate.password, certificadoVencimento: certificate.expires,
          certificadoCnpj: certificate.cnpj, certificadoFingerprintSha256: certificate.fingerprintSha256,
          certificadoValidadoEm: certificate.validatedAt, certificadoChainStatus: certificate.chainStatus,
          certificadoCnpjSource: certificate.cnpjSource } : {}) };
    const saved = current ? await tx.empresa.update({ where: { id: current.id }, data }) : await tx.empresa.create({ data: {
      ...data, documento: inputCompany.documento, razaoSocial: String(merged.razaoSocial), proprietarioUserId: actorId,
      donoFaturamentoId: actorId, statusPropriedade: 'PROPRIETARIA',
    } as Prisma.EmpresaUncheckedCreateInput });
    if (!current) await tx.user.update({ where: { id: actorId }, data: { empresaId: saved.id } });
    if (inputCompany.cnaes) {
      // Preserve local legacy metadata for unchanged codes; tenant input cannot
      // invent shared fiscal rules or overwrite retention/NBS configuration.
      const old = new Map((current?.atividades ?? []).map(item => [item.codigo.replace(/[./-]/g, ''), item]));
      await tx.cnae.deleteMany({ where: { empresaId: saved.id } });
      await tx.cnae.createMany({ data: inputCompany.cnaes.map(item => ({ ...item, empresaId: saved.id,
        codigoNbs: old.get(item.codigo)?.codigoNbs ?? null, temRetencaoInss: old.get(item.codigo)?.temRetencaoInss ?? false })) });
    }
    if (inputCompany.data.serieDPS !== undefined || inputCompany.ultimoDPS !== undefined) {
      const sequence = await setUserDpsSequenceInTransaction(tx, { empresaId: saved.id, ambiente: saved.ambiente, serie: saved.serieDPS,
        ultimoConfirmado: inputCompany.ultimoDPS ?? 0, userId: actorId });
      if (saved.ambiente === 'PRODUCAO') await tx.$executeRaw`UPDATE "Empresa" SET "ultimoDPS" = GREATEST(COALESCE("ultimoDPS", 0), ${sequence.ultimoConfirmado}) WHERE "id" = ${saved.id}`;
    }
    await tx.systemLog.create({ data: { level: 'INFO', action: current ? 'COMPANY_PROFILE_UPDATED' : 'PRIMARY_COMPANY_REGISTERED',
      module: 'EMPRESAS', userId: actorId, empresaId: saved.id, message: 'Cadastro fiscal salvo atomicamente com acesso e versão conferidos.',
      details: JSON.stringify({ fields: Object.keys(inputCompany.data), cnaesChanged: !!inputCompany.cnaes,
        certificateAction: inputCompany.removeCertificate ? 'REMOVED' : certificate ? 'REPLACED' : 'UNCHANGED',
        previousEnvironment: current?.ambiente ?? null, environment: saved.ambiente }) } });
    return { success: true, empresaId: saved.id, empresaAtualizadaEm: saved.updatedAt.toISOString(), cadastroCompleto: saved.cadastroCompleto,
      primeiroCertificadoCadastrado: !!certificate && !current?.certificadoA1 };
  });
}
