# Restricts the voice profile folder to your account and SYSTEM (M08 decision package A2). Metadata only: the profile files are
# never opened. Run from the Hub root:
#   powershell -ExecutionPolicy Bypass -File "v2\scripts\voice-acl.ps1" -Plan
#   powershell -ExecutionPolicy Bypass -File "v2\scripts\voice-acl.ps1" -Apply      (saves the current access list first)
#   powershell -ExecutionPolicy Bypass -File "v2\scripts\voice-acl.ps1" -Verify
#   powershell -ExecutionPolicy Bypass -File "v2\scripts\voice-acl.ps1" -Rollback   (restores the saved access list)
# -Path overrides the folder (default: %IFRIM_VOICE_ROOT%\profiles or %USERPROFILE%\IfrimHub\voice\profiles).
# What it does NOT do: it never touches ~/.codex, never adds a DENY entry (a global deny would break the voice engine or Codex),
# never changes the parent folder (IfrimHub) or the voice engine binaries — only this one folder stops inheriting.
param(
  [switch]$Plan, [switch]$Apply, [switch]$Verify, [switch]$Rollback,
  [string]$Path = ""
)
$ErrorActionPreference = "Stop"
if (-not $Path) {
  $voiceRoot = if ($env:IFRIM_VOICE_ROOT) { $env:IFRIM_VOICE_ROOT } else { Join-Path $env:USERPROFILE "IfrimHub\voice" }
  $Path = Join-Path $voiceRoot "profiles"
}
$saveDir = Split-Path -Parent $Path
$saveFile = Join-Path $saveDir "profiles.acl-backup.txt"
$wideRx = 'CodexSandboxUsers|\\Users:|^Users:|Everyone|Authenticated Users|Utilizatori|Toti|BUILTIN\\Users'

function Get-Sid { ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value }
function Read-Acl([string]$dir) {
  $raw = & icacls $dir 2>&1
  if ($LASTEXITCODE -ne 0) { throw "icacls a esuat pentru $dir" }
  $lines = $raw | Where-Object { $_ -match ':\(' } | ForEach-Object { $_.Replace($dir, "").Trim() }
  [pscustomobject]@{
    Entries   = $lines
    Inherited = @($lines | Where-Object { $_ -match '\(I\)' }).Count
    Wide      = @($lines | Where-Object { $_ -match $wideRx })
  }
}
function Show([object]$o) { $o | ConvertTo-Json -Depth 5 }

if (-not (Test-Path -LiteralPath $Path -PathType Container)) { Write-Host "Folderul $Path nu exista (profil vocal neinrolat?). Nimic de facut."; exit 2 }
$sid = Get-Sid

if ($Plan) {
  $acl = Read-Acl $Path
  Show ([ordered]@{
    path = $Path; current = $acl.Entries; inheritedEntries = $acl.Inherited; wideGroups = $acl.Wide
    willApply = @("salveaza ACL-ul curent in $saveFile", "opreste mostenirea pe acest folder (doar el)", "pastreaza doar contul tau ($sid) si SYSTEM, control total, pentru folder si fisierele lui")
    willNotDo = @("nu atinge ~/.codex", "nu adauga reguli DENY", "nu schimba folderul parinte sau motorul vocal")
    rollback = "voice-acl.ps1 -Rollback (folderul revine la mostenire = exact starea de acum; copia salvata ramane ca evidenta)"
  })
  exit 0
}

if ($Apply) {
  if (Test-Path -LiteralPath $saveFile) { throw "Exista deja o copie a ACL-ului ($saveFile). Ruleaza -Rollback sau muta copia inainte de un nou -Apply." }
  # Rollback is exact only from a fully inherited list (it returns the folder to inheritance); explicit entries are a manual case.
  $before = Read-Acl $Path
  $explicit = @($before.Entries | Where-Object { $_ -notmatch '\(I\)' })
  if ($explicit.Count -gt 0) { throw "Folderul are deja intrari explicite ($($explicit -join '; ')); nu il modific automat. Decide manual sau cere un plan separat." }
  & icacls $Path /save $saveFile /c | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Nu am putut salva ACL-ul curent; nu schimb nimic" }
  & icacls $Path /inheritance:r /grant:r "*$($sid):(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls /grant a esuat; ruleaza -Rollback" }
  # Files created before keep their explicit entries; make every child inherit from the folder again (no DENY added).
  & icacls (Join-Path $Path "*") /reset /c 2>&1 | Out-Null
  $acl = Read-Acl $Path
  if ($acl.Wide.Count -gt 0 -or $acl.Inherited -gt 0) { throw "Dupa aplicare raman intrari largi sau mostenite: $($acl.Wide -join '; '). Ruleaza -Rollback." }
  Show ([ordered]@{ applied = $true; path = $Path; entries = $acl.Entries; saved = $saveFile })
  exit 0
}

if ($Verify) {
  $acl = Read-Acl $Path
  $canRead = $true
  try { Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop | Out-Null } catch { $canRead = $false }
  $ok = ($acl.Wide.Count -eq 0) -and ($acl.Inherited -eq 0) -and $canRead
  Show ([ordered]@{ path = $Path; restricted = $ok; ownerCanList = $canRead; wideGroups = $acl.Wide; inheritedEntries = $acl.Inherited; entries = $acl.Entries })
  if ($ok) { exit 0 } else { exit 1 }
}

if ($Rollback) {
  if (-not (Test-Path -LiteralPath $saveFile)) { throw "Nu gasesc copia ACL-ului ($saveFile); -Apply nu a rulat pe acest folder" }
  # -Apply ran only on a fully inherited list, so returning to inheritance restores exactly that state (icacls /restore would
  # need the restore privilege, which a normal account does not hold). The saved copy stays as the record.
  & icacls $Path /reset /t /c | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls /reset a esuat" }
  $acl = Read-Acl $Path
  $explicit = @($acl.Entries | Where-Object { $_ -notmatch '\(I\)' })
  if ($explicit.Count -gt 0) { throw "Dupa revenire raman intrari explicite: $($explicit -join '; ')" }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Rename-Item -LiteralPath $saveFile -NewName "profiles.acl-backup.restored-$stamp.txt"
  Show ([ordered]@{ restored = $true; path = $Path; inheritedEntries = $acl.Inherited; entries = $acl.Entries })
  exit 0
}

Write-Host "Folosire: -Plan | -Apply | -Verify | -Rollback  [-Path <folder>]"
exit 2
