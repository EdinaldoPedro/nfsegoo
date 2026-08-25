UPDATE "Venda" AS venda
SET
  "status" = 'HOMOLOGACAO_VALIDADA',
  "arquivadoEm" = NULL,
  "arquivadoPor" = NULL,
  "motivoArquivamento" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "EmissaoJob" AS job
  WHERE job."vendaId" = venda."id"
    AND job."status" = 'AUTORIZADA'
    AND job."resultNotaId" IS NULL
    AND job."statusMessage" LIKE '%homologacao%'
);
