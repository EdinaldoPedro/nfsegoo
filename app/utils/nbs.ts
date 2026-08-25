import { prisma } from '@/app/utils/prisma';

export const normalizeNbsSearch = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export const cleanNbsCode = (value: unknown) => String(value || '').replace(/\D/g, '');

export async function validateSelectableNbs(value: unknown) {
  if (value === null || value === undefined || value === '') return { code: null, error: null };
  const code = cleanNbsCode(value);
  if (code.length !== 9) return { code: null, error: 'Selecione um código NBS final válido.' };
  const exists = await prisma.nbsCatalogo.findFirst({
    where: { codigoNumerico: code, selecionavel: true, ativo: true },
    select: { codigoNumerico: true },
  });
  return exists
    ? { code, error: null }
    : { code: null, error: 'O NBS informado não existe ou não está ativo no catálogo oficial NBS 2.0.' };
}
