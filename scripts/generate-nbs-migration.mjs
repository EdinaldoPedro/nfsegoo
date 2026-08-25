import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve('prisma/nbs_2_0.csv');
const migrationPath = path.resolve('prisma/migrations/20260825190000_add_nbs_catalogo/migration.sql');
const sourceUrl = 'https://www.gov.br/mdic/pt-br/images/REPOSITORIO/scs/decos/NBS/NBSa_2-0.csv';
const buffer = fs.readFileSync(sourcePath);
const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
const text = new TextDecoder('windows-1252').decode(buffer).replace(/^\uFEFF/, '');

const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = text.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
  const separator = line.indexOf(';');
  const codigoFormatado = line.slice(0, separator).trim();
  const descricao = line.slice(separator + 1).trim();
  const codigoNumerico = codigoFormatado.replace(/\D/g, '');
  const selecionavel = /^\d\.\d{4}\.\d{2}\.\d{2}$/.test(codigoFormatado) && codigoNumerico.length === 9;
  const parts = codigoFormatado.split('.');
  const codigoPai = parts.length > 2 ? parts.slice(0, -1).join('.') : null;
  return { codigoFormatado, codigoNumerico: selecionavel ? codigoNumerico : null, descricao, descricaoNormalizada: normalize(descricao), nivel: parts.length, codigoPai, selecionavel };
});

const values = rows.map((row) => `(${quote(row.codigoFormatado)}, ${row.codigoNumerico ? quote(row.codigoNumerico) : 'NULL'}, ${quote(row.descricao)}, ${quote(row.descricaoNormalizada)}, ${row.nivel}, ${row.codigoPai ? quote(row.codigoPai) : 'NULL'}, ${row.selecionavel}, true, '2.0', ${quote(sourceUrl)}, ${quote(checksum)})`).join(',\n');
const sql = `CREATE TABLE "NbsCatalogo" (
  "id" TEXT NOT NULL,
  "codigoFormatado" TEXT NOT NULL,
  "codigoNumerico" TEXT,
  "descricao" TEXT NOT NULL,
  "descricaoNormalizada" TEXT NOT NULL,
  "nivel" INTEGER NOT NULL,
  "codigoPai" TEXT,
  "selecionavel" BOOLEAN NOT NULL DEFAULT false,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "versao" TEXT NOT NULL DEFAULT '2.0',
  "fonteUrl" TEXT NOT NULL,
  "importadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checksumFonte" TEXT,
  CONSTRAINT "NbsCatalogo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NbsCatalogo_codigoFormatado_key" ON "NbsCatalogo"("codigoFormatado");
CREATE UNIQUE INDEX "NbsCatalogo_codigoNumerico_key" ON "NbsCatalogo"("codigoNumerico");
CREATE INDEX "NbsCatalogo_selecionavel_ativo_idx" ON "NbsCatalogo"("selecionavel", "ativo");
CREATE INDEX "NbsCatalogo_codigoPai_idx" ON "NbsCatalogo"("codigoPai");
CREATE INDEX "NbsCatalogo_descricaoNormalizada_idx" ON "NbsCatalogo"("descricaoNormalizada");

INSERT INTO "NbsCatalogo" ("id", "codigoFormatado", "codigoNumerico", "descricao", "descricaoNormalizada", "nivel", "codigoPai", "selecionavel", "ativo", "versao", "fonteUrl", "checksumFonte")
SELECT md5(source."codigoFormatado" || ':NBS2'), source.* FROM (VALUES
${values}
) AS source("codigoFormatado", "codigoNumerico", "descricao", "descricaoNormalizada", "nivel", "codigoPai", "selecionavel", "ativo", "versao", "fonteUrl", "checksumFonte");
`;

fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
fs.writeFileSync(migrationPath, sql, 'utf8');
console.log(`Migração gerada com ${rows.length} registros (${rows.filter((row) => row.selecionavel).length} selecionáveis).`);
