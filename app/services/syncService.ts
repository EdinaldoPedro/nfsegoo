import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';

interface CnaeInput {
  codigo: string;
  descricao: string;
  principal?: boolean;
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Every company CNAE must be visible in the fiscal catalog. Municipal
 * placeholders remain inactive because a company registration is not
 * normative evidence that a local tax rule is valid. */
export async function syncCnaesGlobalmente(cnaes: CnaeInput[], codigoIbge?: string | null, db: Db = prisma) {
  const cnaesByCode = new Map<string, { codigo: string; descricao: string }>();
  for (const item of cnaes || []) {
    const codigo = String(item.codigo || '').replace(/\D/g, '');
    if (!/^\d{7}$/.test(codigo) || cnaesByCode.has(codigo)) continue;
    cnaesByCode.set(codigo, {
      codigo,
      descricao: String(item.descricao || 'CNAE cadastral').trim() || 'CNAE cadastral',
    });
  }
  const normalized = [...cnaesByCode.values()];
  if (!normalized.length) return { globalCount: 0, municipalCount: 0 };

  const existingGlobal = await db.globalCnae.findMany({ where: { codigo: { in: normalized.map((item) => item.codigo) } }, select: { codigo: true } });
  const knownGlobal = new Set(existingGlobal.map((item) => item.codigo));
  const missingGlobal = normalized.filter((item) => !knownGlobal.has(item.codigo));
  if (missingGlobal.length) {
    await db.globalCnae.createMany({ skipDuplicates: true, data: missingGlobal.map((item) => ({
      codigo: item.codigo, descricao: item.descricao, itemLc: '', codigoTributacaoNacional: '',
    })) });
  }

  const ibge = String(codigoIbge || '').replace(/\D/g, '');
  if (!/^\d{7}$/.test(ibge)) return { globalCount: missingGlobal.length, municipalCount: 0 };
  const existingMunicipal = await db.tributacaoMunicipal.findMany({
    where: { codigoIbge: ibge, cnae: { in: normalized.map((item) => item.codigo) } }, select: { cnae: true },
  });
  const knownMunicipal = new Set(existingMunicipal.map((item) => item.cnae.replace(/\D/g, '')));
  const missingMunicipal = normalized.filter((item) => !knownMunicipal.has(item.codigo));
  if (missingMunicipal.length) {
    await db.tributacaoMunicipal.createMany({ skipDuplicates: true, data: missingMunicipal.map((item) => ({
      cnae: item.codigo, codigoIbge: ibge, codigoTributacaoMunicipal: 'A_DEFINIR',
      descricaoServicoMunicipal: item.descricao, exigeCodigoTributacaoMunicipal: true, ativo: false,
      observacoesFiscal: 'Placeholder criado automaticamente a partir de CNAE cadastral; requer revisão e fonte normativa antes da ativação.',
    })) });
  }
  return { globalCount: missingGlobal.length, municipalCount: missingMunicipal.length };
}
