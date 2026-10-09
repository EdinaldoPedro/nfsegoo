INSERT INTO "GlobalCnae" (
  "id", "codigo", "descricao", "itemLc", "codigoTributacaoNacional", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  normalized.codigo,
  normalized.descricao,
  '',
  '',
  clock_timestamp(),
  clock_timestamp()
FROM (
  SELECT DISTINCT ON (regexp_replace(c."codigo", '[^0-9]', '', 'g'))
    regexp_replace(c."codigo", '[^0-9]', '', 'g') AS codigo,
    COALESCE(NULLIF(trim(c."descricao"), ''), 'CNAE cadastral') AS descricao
  FROM "Cnae" c
  WHERE regexp_replace(c."codigo", '[^0-9]', '', 'g') ~ '^[0-9]{7}$'
  ORDER BY regexp_replace(c."codigo", '[^0-9]', '', 'g'), c."principal" DESC, c."id"
) normalized
WHERE NOT EXISTS (
  SELECT 1 FROM "GlobalCnae" global_rule WHERE global_rule."codigo" = normalized.codigo
)
ON CONFLICT ("codigo") DO NOTHING;

INSERT INTO "TributacaoMunicipal" (
  "id", "cnae", "codigoIbge", "codigoTributacaoMunicipal",
  "descricaoServicoMunicipal", "exigeCodigoTributacaoMunicipal", "ativo",
  "observacoesFiscal", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  source.cnae,
  source.codigo_ibge,
  'A_DEFINIR',
  source.descricao,
  true,
  false,
  'Placeholder criado automaticamente a partir de CNAE cadastral; requer revisão e fonte normativa antes da ativação.',
  clock_timestamp(),
  clock_timestamp()
FROM (
  SELECT DISTINCT ON (
    regexp_replace(c."codigo", '[^0-9]', '', 'g'),
    regexp_replace(e."codigoIbge", '[^0-9]', '', 'g')
  )
    regexp_replace(c."codigo", '[^0-9]', '', 'g') AS cnae,
    regexp_replace(e."codigoIbge", '[^0-9]', '', 'g') AS codigo_ibge,
    COALESCE(NULLIF(trim(c."descricao"), ''), 'CNAE cadastral') AS descricao
  FROM "Cnae" c
  INNER JOIN "Empresa" e ON e."id" = c."empresaId"
  WHERE e."arquivadoEm" IS NULL
    AND regexp_replace(c."codigo", '[^0-9]', '', 'g') ~ '^[0-9]{7}$'
    AND regexp_replace(e."codigoIbge", '[^0-9]', '', 'g') ~ '^[0-9]{7}$'
  ORDER BY
    regexp_replace(c."codigo", '[^0-9]', '', 'g'),
    regexp_replace(e."codigoIbge", '[^0-9]', '', 'g'),
    c."principal" DESC,
    c."id"
) source
WHERE NOT EXISTS (
  SELECT 1
  FROM "TributacaoMunicipal" municipal_rule
  WHERE regexp_replace(municipal_rule."cnae", '[^0-9]', '', 'g') = source.cnae
    AND regexp_replace(municipal_rule."codigoIbge", '[^0-9]', '', 'g') = source.codigo_ibge
)
ON CONFLICT DO NOTHING;
