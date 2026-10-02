$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env.local'

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "No se encontró el archivo .env.local en $projectRoot"
}

$envValues = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^\s*([^#\s][^=]*)\s*=(.*)$') {
    $name = $Matches[1].Trim()
    $value = $Matches[2].Trim().Trim('"').Trim("'")
    $envValues[$name] = $value
  }
}

$supabaseUrl = $envValues['VITE_SUPABASE_URL']
$anonKey = $envValues['VITE_SUPABASE_ANON_KEY']

if ([string]::IsNullOrWhiteSpace($supabaseUrl)) {
  throw 'VITE_SUPABASE_URL no está configurada en .env.local'
}

if ([string]::IsNullOrWhiteSpace($anonKey)) {
  throw 'VITE_SUPABASE_ANON_KEY no está configurada en .env.local'
}

$uri = "$($supabaseUrl.TrimEnd('/'))/rest/v1/routes?select=id&limit=1"
$headers = @{
  apikey        = $anonKey
  Authorization = "Bearer $anonKey"
}

try {
  $result = @(Invoke-RestMethod -Uri $uri -Headers $headers -Method Get -TimeoutSec 20)
  Write-Output "OK: Supabase respondió correctamente. Filas recibidas: $($result.Count)"
} catch {
  $statusCode = $null
  if ($_.Exception.Response) {
    $statusCode = [int]$_.Exception.Response.StatusCode
  }

  if ($statusCode) {
    throw "Falló la consulta a Supabase (HTTP $statusCode). Revisa el proyecto, la clave y los permisos de lectura de routes."
  }

  throw "No se pudo conectar con Supabase: $($_.Exception.Message)"
}
