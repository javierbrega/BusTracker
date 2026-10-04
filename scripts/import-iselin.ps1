$projectRoot = Split-Path -Parent $PSScriptRoot
$secureKey = Read-Host 'Clave service_role de Supabase' -AsSecureString
$keyPointer = [IntPtr]::Zero
$plainKey = $null

Push-Location $projectRoot
try {
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer).
    Trim().Trim('"', "'") -replace '[\s\p{Cf}]', ''
  if ($plainKey -notmatch '^[\x21-\x7E]+$') {
    throw 'El texto pegado incluye caracteres que no pertenecen a una clave API. En Supabase, usa el botón de copiar de la clave completa, no selecciones el valor enmascarado.'
  }
  if (-not ($plainKey.StartsWith('sb_secret_') -or $plainKey.StartsWith('eyJ'))) {
    throw 'El valor no parece una clave secreta nueva (sb_secret_) ni una service_role heredada (JWT). Usa la clave completa de Supabase.'
  }
  $env:SUPABASE_SERVICE_ROLE_KEY = $plainKey

  & npm run import:iselin
  if ($LASTEXITCODE -ne 0) {
    throw 'La importación de Iselín no terminó correctamente.'
  }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }
  $plainKey = $null
  $secureKey.Dispose()
  Pop-Location
}
