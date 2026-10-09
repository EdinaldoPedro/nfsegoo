import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/utils/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

export async function shouldSendPrestadorMunicipalRegistration(empresaId: string, db: Db = prisma) {
  const rows = await db.$queryRaw<Array<{ enviar: boolean }>>`
    SELECT "enviarInscricaoMunicipalDps" AS enviar
    FROM "Empresa"
    WHERE "id" = ${empresaId} AND "arquivadoEm" IS NULL
    LIMIT 1
  `;
  return rows[0]?.enviar !== false;
}
