param(
  [ValidateSet('fluent-bit', 'vector')]
  [string]$LogShipper = 'fluent-bit'
)

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot\..\..")

$prodEnv = "backend/.env.production"
$prodEnvExample = "backend/.env.production.example"

if (-not (Test-Path $prodEnv)) {
  Copy-Item $prodEnvExample $prodEnv -Force
  Write-Host "Created $prodEnv from template. Fill secrets before first real deployment." -ForegroundColor Yellow
}

Write-Host "Running migrations..." -ForegroundColor Cyan
npm run backend:db:migrate

Write-Host "Running seed..." -ForegroundColor Cyan
npm run backend:db:seed

Write-Host "Rotating seeded passwords..." -ForegroundColor Cyan
npm run backend:rotate-seed-passwords

if (Get-Command docker -ErrorAction SilentlyContinue) {
  Write-Host "Starting monitoring stack..." -ForegroundColor Cyan
  docker compose -f ops/monitoring/docker-compose.yml up -d

  Write-Host "Starting log shipper profile '$LogShipper'..." -ForegroundColor Cyan
  docker compose -f ops/logging/docker-compose.logging.yml --profile $LogShipper up -d
} else {
  Write-Host "Docker not found. Skipping monitoring/log-shipping container startup." -ForegroundColor Yellow
}

Write-Host "Production bootstrap sequence completed." -ForegroundColor Green
