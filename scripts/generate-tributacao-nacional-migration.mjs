import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve('prisma/codigos_tributacao_nacional.html');
const migrationPath = path.resolve('prisma/migrations/20260825203000_add_tributacao_nacional_catalogo/migration.sql');
const sourceUrl = 'https://www.gov.br/nfse/pt-br/mei-e-demais-empresas/codigos-de-tributacao-nacional-nbs';
const buffer = fs.readFileSync(sourcePath);
const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
const html = buffer.toString('utf8');

const decodeHtml = (value) => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/\s+/g, ' ')
  .trim();
const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const formatCode = (code) => code.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1.$2.$3');

const rows = [];
const seen = new Set();
for (const match of html.matchAll(/<td[^>]*>\s*(\d{6})\s*-\s*([\s\S]*?)<\/td>/gi)) {
  const codigoNumerico = match[1];
  if (seen.has(codigoNumerico)) continue;
  seen.add(codigoNumerico);
  const descricao = decodeHtml(match[2]);
  rows.push({ codigoNumerico, codigoFormatado: formatCode(codigoNumerico), descricao, descricaoNormalizada: normalize(descricao) });
}
if (rows.length < 100) throw new Error(`Fonte oficial inesperada: somente ${rows.length} códigos encontrados.`);

const values = rows.map((row) => `(${quote(row.codigoNumerico)}, ${quote(row.codigoFormatado)}, ${quote(row.descricao)}, ${quote(row.descricaoNormalizada)}, true, ${quote(sourceUrl)}, ${quote(checksum)})`).join(',\n');
const sql = `CREATE TABLE "TributacaoNacionalCatalogo" (
  "id" TEXT NOT NULL,
  "codigoNumerico" TEXT NOT NULL,
  "codigoFormatado" TEXT NOT NULL,
  "descricao" TEXT NOT NULL,
  "descricaoNormalizada" TEXT NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "fonteUrl" TEXT NOT NULL,
  "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checksumFonte" TEXT,
  CONSTRAINT "TributacaoNacionalCatalogo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TributacaoNacionalCatalogo_codigoNumerico_key" ON "TributacaoNacionalCatalogo"("codigoNumerico");
CREATE INDEX "TributacaoNacionalCatalogo_ativo_codigoNumerico_idx" ON "TributacaoNacionalCatalogo"("ativo", "codigoNumerico");
CREATE INDEX "TributacaoNacionalCatalogo_descricaoNormalizada_idx" ON "TributacaoNacionalCatalogo"("descricaoNormalizada");

INSERT INTO "TributacaoNacionalCatalogo" ("id", "codigoNumerico", "codigoFormatado", "descricao", "descricaoNormalizada", "ativo", "fonteUrl", "checksumFonte")
SELECT md5(source."codigoNumerico" || ':CTRIBNAC'), source.* FROM (VALUES
${values}
) AS source("codigoNumerico", "codigoFormatado", "descricao", "descricaoNormalizada", "ativo", "fonteUrl", "checksumFonte");
`;

fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
fs.writeFileSync(migrationPath, sql, 'utf8');
console.log(`Migração gerada com ${rows.length} códigos nacionais.`);
