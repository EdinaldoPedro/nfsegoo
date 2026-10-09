param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,

  [Parameter(Mandatory = $true)]
  [string]$Confirm
)

$ErrorActionPreference = 'Stop'
$containerName = 'nfse-db'
$databaseName = 'nfse_db'
$databaseAdministrator = 'postgres'
$databaseOwner = 'nfse_admin'
$requiredConfirmation = 'RESTAURAR NFSE_DB'
$containerBackup = '/tmp/nfsegoo-restore.dump'

if ($Confirm -cne $requiredConfirmation) {
  throw "Confirmação inválida. Use -Confirm '$requiredConfirmation'."
}

$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
if (-not (Test-Path -LiteralPath $resolvedBackup -PathType Leaf)) {
  throw "Backup não encontrado: $resolvedBackup"
}

$databaseUrlLine = Get-Content -LiteralPath '.env' |
  Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
  Select-Object -First 1
if (-not $databaseUrlLine) {
  throw 'DATABASE_URL não encontrada no arquivo .env.'
}

$databaseUrl = ($databaseUrlLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
$configuredDatabase = ([Uri]$databaseUrl).AbsolutePath.TrimStart('/')
if ($configuredDatabase -cne $databaseName) {
  throw "Restauração recusada: o .env aponta para '$configuredDatabase', mas o único alvo permitido é '$databaseName'."
}

$runningContainer = docker ps --filter "name=^/$containerName$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0 -or $runningContainer -cne $containerName) {
  throw "O contêiner '$containerName' não está em execução."
}

Write-Host "Alvo validado: $containerName / $databaseName"
Write-Host "Backup: $resolvedBackup"
Write-Host 'Pare o servidor de desenvolvimento antes de continuar.'

try {
  docker cp $resolvedBackup "${containerName}:${containerBackup}"
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao copiar o backup para o contêiner.' }

  docker exec $containerName dropdb --username=$databaseAdministrator --if-exists --force $databaseName
  if ($LASTEXITCODE -ne 0) { throw "Falha ao remover o banco $databaseName." }

  docker exec $containerName createdb --username=$databaseAdministrator --owner=$databaseOwner --template=template0 $databaseName
  if ($LASTEXITCODE -ne 0) { throw "Falha ao recriar o banco $databaseName." }

  docker exec $containerName pg_restore --username=$databaseOwner --dbname=$databaseName --no-owner --no-privileges --exit-on-error --verbose $containerBackup
  if ($LASTEXITCODE -ne 0) { throw "Falha ao restaurar o banco $databaseName." }

  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao aplicar as migrações.' }

  npx prisma generate
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar o Prisma Client.' }

  npm run readiness:migrations
  if ($LASTEXITCODE -ne 0) { throw 'A validação das migrações falhou.' }

  Write-Host "Restauração concluída no único banco da aplicação: $databaseName"
}
finally {
  docker exec $containerName rm -f $containerBackup | Out-Null
}
