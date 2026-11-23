# Ifrim Agent Hub V2 - instalare curata pe un calculator Windows 11 (fara drepturi de administrator).
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Root C:\Users\<tu>\IfrimHub] [-Release 2.20.0] [-Autostart] [-NoStart] [-NoBrowser]
# Ce face: verifica Git si Node.js; alege ultima versiune PUBLICATA (tag hub-release/<x.y.z>); cloneaza Hub-ul in
# <Root>\Proiecte\ifrim-agent-hub; tine datele (baza noua, goala) in <Root>\hub-data, in afara folderului de cod; creeaza registrul
# de proiecte <Root>\Proiecte\PROJECTS.md; instaleaza dependentele (npm ci); construieste interfata; porneste Hub-ul pe
# http://localhost:8011 (doar pe acest calculator) si deschide browserul. Nu porneste niciun model, nu cere chei, nu trimite nimic.
# Datele, cheile si proiectele raman pe acest calculator. Ghidul complet: v2\GHID_INSTALARE.md din repository.
param(
  [string]$Root = (Join-Path $env:USERPROFILE "IfrimHub"),
  [string]$Repo = "https://github.com/L3ga2002/ifrim-agent-hub.git",
  [string]$Release = "",
  [switch]$Autostart,
  [switch]$NoStart,
  [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
$Root = [System.IO.Path]::GetFullPath($Root)
# Port: 8011 unless HUB_V2_PORT names another (a second instance on the same computer).
$port = 8011
if ($env:HUB_V2_PORT -match '^\d{2,5}$') { $port = [int]$env:HUB_V2_PORT }
function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "    $m" -ForegroundColor Green }
function Fail($m) { Write-Host "EROARE: $m" -ForegroundColor Red; exit 1 }

Step "Verific programele necesare"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git lipseste. Instaleaza-l cu:  winget install --id Git.Git -e   apoi deschide un PowerShell NOU si ruleaza din nou." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js lipseste. Instaleaza-l cu:  winget install --id OpenJS.NodeJS.LTS -e   apoi deschide un PowerShell NOU si ruleaza din nou." }
$nodeVersion = (& node -p "process.versions.node").Trim()
$parts = $nodeVersion.Split(".") | ForEach-Object { [int]$_ }
if ($parts[0] -lt 22 -or ($parts[0] -eq 22 -and $parts[1] -lt 16)) { Fail "Node.js $nodeVersion este prea vechi (minim 22.16, recomandat 24 LTS):  winget upgrade --id OpenJS.NodeJS.LTS -e" }
Ok "Git: $((& git --version).Trim())  |  Node.js: $nodeVersion"

$projects = Join-Path $Root "Proiecte"
$hub = Join-Path $projects "ifrim-agent-hub"
$data = Join-Path $Root "hub-data"
if (Test-Path (Join-Path $hub ".git")) { Fail "Hub-ul este deja instalat in $hub. Actualizarile se fac din Hub (bara de sus: Actualizeaza acum). Pentru o reinstalare, opreste Hub-ul si sterge folderul $hub (datele din $data raman)." }

Step "Caut ultima versiune publicata"
$lines = & git ls-remote --tags --refs $Repo "refs/tags/hub-release/*"
if ($LASTEXITCODE -ne 0) { Fail "Nu pot citi $Repo (verifica internetul)." }
$releases = @()
foreach ($line in $lines) {
  if ($line -match "refs/tags/hub-release/(\d+)\.(\d+)\.(\d+)(\S*)$") {
    $releases += [pscustomobject]@{ Tag = "hub-release/$($Matches[1]).$($Matches[2]).$($Matches[3])$($Matches[4])"; Version = "$($Matches[1]).$($Matches[2]).$($Matches[3])$($Matches[4])"; Key = [int]$Matches[1] * 100000000 + [int]$Matches[2] * 100000 + [int]$Matches[3] }
  }
}
if ($Release) { $chosen = $releases | Where-Object { $_.Version -eq $Release -or $_.Tag -eq $Release } | Select-Object -First 1 }
else { $chosen = $releases | Sort-Object Key | Select-Object -Last 1 }
if (-not $chosen) { Fail "Nu exista inca o versiune publicata (tag hub-release/*). Cere-i proprietarului repository-ului sa publice una." }
Ok "Versiunea $($chosen.Version)"

Step "Descarc Hub-ul in $hub"
New-Item -ItemType Directory -Force -Path $projects | Out-Null
& git -c core.autocrlf=false -c advice.detachedHead=false clone --quiet --branch $chosen.Tag $Repo $hub
if ($LASTEXITCODE -ne 0) { Fail "git clone a esuat." }
& git -C $hub config core.autocrlf false
Ok "Descarcat ($((& git -C $hub rev-parse --short HEAD).Trim()))"

Step "Pregatesc datele (baza noua, goala) in $data"
foreach ($d in @($data, (Join-Path $data "private"), (Join-Path $data "backups\v2"), (Join-Path $data "work"))) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
$pointer = @{ version = 1; dataRoot = $data; createdAt = (Get-Date).ToUniversalTime().ToString("o"); createdBy = "install.ps1" } | ConvertTo-Json
$ifrim = Join-Path $hub ".ifrim"
New-Item -ItemType Directory -Force -Path $ifrim | Out-Null
[System.IO.File]::WriteAllText((Join-Path $ifrim "data-location.json"), $pointer, (New-Object System.Text.UTF8Encoding($false)))
$registry = Join-Path $projects "PROJECTS.md"
if (-not (Test-Path $registry)) {
  $text = "# Proiecte`n`nRegistrul proiectelor vazute de Ifrim Agent Hub. Adauga un proiect cu:`n  node ifrim-agent-hub\v2\scripts\add-project.mjs --dir `"<folderul proiectului>`" --name `"<Nume>`"`n"
  [System.IO.File]::WriteAllText($registry, $text, (New-Object System.Text.UTF8Encoding($false)))
}
Ok "Date: $data  |  Proiecte: $projects"

Step "Instalez dependentele (cateva minute)"
Push-Location $hub
try {
  & npm ci --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { Fail "npm ci a esuat." }
  Ok "Dependente instalate"
  Step "Construiesc interfata"
  & node node_modules/vite/bin/vite.js build --config v2/web/vite.config.js | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "Construirea interfetei a esuat." }
  Ok "Interfata construita"
  if ($Autostart) {
    Step "Pornire automata la logarea in Windows"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $hub "v2\scripts\autostart.ps1") -Install
  }
  if (-not $NoStart) {
    Step "Pornesc Hub-ul"
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $hub "v2\scripts\start-detached.ps1")
    if ($LASTEXITCODE -ne 0) { Fail "Hub-ul nu a pornit; vezi $data\private\v2-hub.log" }
    if (-not $NoBrowser) { Start-Process "http://localhost:$port/" }
  }
} finally { Pop-Location }

Write-Host ""
Write-Host "Gata. Hub-ul: http://localhost:$port  (doar pe acest calculator)" -ForegroundColor Green
Write-Host "Pasii urmatori (detaliat in ghid):"
Write-Host "  1. In browser: configureaza proprietarul (Windows Hello / PIN)."
Write-Host "  2. Logheaza Codex si/sau Claude Code pe acest calculator SAU pune o cheie API in Integrari."
Write-Host "  3. Pune proiectele demo in $projects si ruleaza pentru fiecare:"
Write-Host "       node `"$hub\v2\scripts\add-project.mjs`" --dir `"$projects\<proiect>`" --name `"<Nume>`""
Write-Host "  Oprire:  node `"$hub\v2\scripts\stop.mjs`"     Pornire:  powershell -ExecutionPolicy Bypass -File `"$hub\v2\scripts\start-detached.ps1`""
