# Bundles index.html + its CSS/JS into one self-contained file you can email.
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File build-standalone.ps1
param([string]$Out = 'TaskFlow.html')

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8($rel) {
  $p = Join-Path $root $rel
  if (-not (Test-Path $p)) { throw "Missing asset: $rel" }
  [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
}

$html = Read-Utf8 'index.html'

# --- inline the stylesheet ---
$css = Read-Utf8 'assets/css/styles.css'
$html = $html.Replace(
  '<link rel="stylesheet" href="assets/css/styles.css" />',
  "<style>`n$css`n</style>")

# --- inline each script, in load order ---
foreach ($name in @('data', 'ui', 'charts', 'views', 'app')) {
  $js = Read-Utf8 "assets/js/$name.js"
  # a literal </script> inside a string would end the tag early
  $js = $js.Replace('</script', '<\/script')
  $html = $html.Replace(
    "<script src=""assets/js/$name.js""></script>",
    "<script>`n$js`n</script>")
}

if ($html -match 'assets/(css|js)/') { throw 'An asset reference survived — bundle is incomplete.' }

$target = Join-Path $root $Out
[System.IO.File]::WriteAllText($target, $html, $utf8)

$kb = [math]::Round((Get-Item $target).Length / 1KB, 1)
Write-Host "Built $Out ($kb KB) - single file, no dependencies."
