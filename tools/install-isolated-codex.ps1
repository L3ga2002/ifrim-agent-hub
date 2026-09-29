param([switch]$ApprovedHub018)
$ErrorActionPreference = 'Stop'
if (!$ApprovedHub018) { throw 'HUB-018 approval required' }
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$state = Join-Path $root '.ifrim\private\openclaw-subscription-runtime'
& (Join-Path $PSScriptRoot 'protect-subscription-state.ps1')
$node = Join-Path $env:APPDATA 'fnm\node-versions\v24.16.0\installation\node.exe'
$entry = Join-Path $env:APPDATA 'npm\node_modules\openclaw\dist\index.js'
$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = $node
$info.Arguments = '"' + $entry + '" plugins install @openclaw/codex@2026.9.6 --pin'
$info.WorkingDirectory = $state
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.EnvironmentVariables.Clear()
foreach ($name in @('SystemRoot','WINDIR','COMSPEC','USERPROFILE','USERNAME','USERDOMAIN','APPDATA','LOCALAPPDATA','TEMP','TMP','ProgramFiles','ProgramFiles(x86)','ProgramData','HOMEDRIVE','HOMEPATH')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $info.EnvironmentVariables[$name] = $value }
}
$info.EnvironmentVariables['PATH'] = (Split-Path -Parent $node) + ';' + (Join-Path $env:APPDATA 'npm') + ';' + (Join-Path $env:SystemRoot 'System32') + ';C:\Program Files\Git\cmd'
$info.EnvironmentVariables['OPENCLAW_STATE_DIR'] = $state
$info.EnvironmentVariables['OPENCLAW_CONFIG_PATH'] = Join-Path $state 'openclaw.json'
$info.EnvironmentVariables['OPENCLAW_LOAD_SHELL_ENV'] = '0'
$info.EnvironmentVariables['OPENCLAW_SKIP_CRON'] = '1'
$process = [Diagnostics.Process]::Start($info)
$stdout = $process.StandardOutput.ReadToEndAsync()
$stderr = $process.StandardError.ReadToEndAsync()
if (!$process.WaitForExit(300000)) {
    & (Join-Path $env:SystemRoot 'System32\taskkill.exe') /PID $process.Id /T /F | Out-Null
    throw 'Installer timeout: inspect isolated state before retry'
}
$out = $stdout.GetAwaiter().GetResult()
$err = $stderr.GetAwaiter().GetResult()
Write-Output $out
Write-Output $err
if ($process.ExitCode -ne 0) { throw ('Official isolated installation failed: exit ' + $process.ExitCode) }
