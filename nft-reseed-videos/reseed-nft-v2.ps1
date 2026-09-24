# ZODD - reseed de la coleccion zodd-genesis con los 9 videos loop por tier.
# Corre esto DESDE esta misma carpeta (o simplemente doble-click / .\reseed-nft.ps1
# desde una PowerShell abierta aca). Usa un token temporal (NFT_SEED_TOKEN) que
# Claude genero solo para esta operacion, no el ADMIN_TOKEN real.

$ErrorActionPreference = "Stop"
$videoDir = $PSScriptRoot
$backendUrl = "https://backend-production-e195.up.railway.app/api/admin/nft-reseed-tiered-variants"
$seedToken = "443d5016d8812a6af8b223f4a9c146f5cda663cc463c4af188f989b3753d0567"

# papirus_tier_1.mp4 llegó corrupto (5875 bytes de más) en la transferencia
# binaria original -- si hay un .b64 al lado, lo usamos para reconstruir el
# .mp4 correcto antes de seguir (base64 como texto viaja sin problema).
$papiroB64 = Join-Path $videoDir "papirus_tier_1.mp4.b64"
if (Test-Path $papiroB64) {
  Write-Host "Reconstruyendo papirus_tier_1.mp4 desde el .b64 (el binario original llego corrupto)..."
  $b64text = Get-Content -Raw -Path $papiroB64
  $bytes = [System.Convert]::FromBase64String($b64text.Trim())
  [System.IO.File]::WriteAllBytes((Join-Path $videoDir "papirus_tier_1.mp4"), $bytes)
  Write-Host ("  reconstruido: {0} bytes" -f $bytes.Length)
}

$files = @(
  "papirus_tier_1.mp4","fragment_tier_2_-_1.mp4","fragment_tier_2_-_2.mp4","fragment_tier_2_-_3.mp4",
  "Relics_tier_3_-_1.mp4","Relics_tier_3_-_2.mp4","Relics_tier_3_-_3.mp4","Relics_tier_3_-_4.mp4","Relics_tier_3_-_5.mp4"
)
foreach ($f in $files) {
  if (-not (Test-Path (Join-Path $videoDir $f))) {
    Write-Host "FALTA EL ARCHIVO: $f"
    exit 1
  }
}

function Get-VariantJson($filename, $name) {
    $path = Join-Path $videoDir $filename
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $b64 = [System.Convert]::ToBase64String($bytes)
    $dataUrl = "data:video/mp4;base64,$b64"
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $hashBytes = $md5.ComputeHash([System.Text.Encoding]::ASCII.GetBytes($dataUrl))
    $md5Hex = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
    Write-Host ("  {0} ({1}): {2} MB, md5={3}" -f $name, $filename, [Math]::Round($bytes.Length/1MB,2), $md5Hex)
    return '{"name":"' + $name + '","videoDataUrl":"' + $dataUrl + '","expectedMd5":"' + $md5Hex + '"}'
}

Write-Host "Armando variantes PAPIRO..."
$papiro = @(
  (Get-VariantJson "papirus_tier_1.mp4" "Papiro del Genesis")
)

Write-Host "Armando variantes FRAGMENTO..."
$fragmento = @(
  (Get-VariantJson "fragment_tier_2_-_1.mp4" "Fragmento del Velo"),
  (Get-VariantJson "fragment_tier_2_-_2.mp4" "Fragmento de la Marea"),
  (Get-VariantJson "fragment_tier_2_-_3.mp4" "Fragmento del Eco Oculto")
)

Write-Host "Armando variantes RELIQUIA..."
$reliquia = @(
  (Get-VariantJson "Relics_tier_3_-_1.mp4" "Reliquia del Guardian Sombrio"),
  (Get-VariantJson "Relics_tier_3_-_2.mp4" "Reliquia de la Corona Sellada"),
  (Get-VariantJson "Relics_tier_3_-_3.mp4" "Reliquia del Ultimo Bloque"),
  (Get-VariantJson "Relics_tier_3_-_4.mp4" "Reliquia de la Llama Eterna"),
  (Get-VariantJson "Relics_tier_3_-_5.mp4" "Reliquia del Manto Invisible")
)

$json = '{'
$json += '"slug":"zodd-genesis",'
$json += '"name":"ZODD Genesis",'
$json += '"currency":"ZEC",'
$json += '"mintPriceZec":0.0025,'
$json += '"papiroVariants":[' + ($papiro -join ',') + '],'
$json += '"fragmentoVariants":[' + ($fragmento -join ',') + '],'
$json += '"reliquiaVariants":[' + ($reliquia -join ',') + '],'
$json += '"tier1Count":3333,'
$json += '"tier2Count":1944,'
$json += '"tier3Count":278,'
$json += '"wipeExisting":true'
$json += '}'

Write-Host ""
Write-Host ("Tamano total del payload: {0} MB" -f [Math]::Round($json.Length/1MB,2))
Write-Host "Enviando al backend (puede tardar un minuto)..."

$headers = @{ "x-admin-token" = $seedToken }

try {
    $response = Invoke-RestMethod -Uri $backendUrl -Method Post -ContentType "application/json; charset=utf-8" -Headers $headers -Body $json -TimeoutSec 300
} catch {
    Write-Host ""
    Write-Host "ERROR llamando al backend:"
    Write-Host $_.Exception.Message
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host $reader.ReadToEnd()
    }
    exit 1
}

$response | ConvertTo-Json -Depth 10 | Out-File -FilePath (Join-Path $videoDir "reseed-result.json") -Encoding utf8

Write-Host ""
Write-Host "===== LISTO ====="
Write-Host "Resultado guardado en reseed-result.json"
Write-Host ($response | ConvertTo-Json -Depth 6)
