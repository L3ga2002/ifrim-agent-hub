[CmdletBinding()]
param(
    [ValidateSet("quick", "security", "architect", "opus", "fable")]
    [string]$Profile = "quick",

    [string]$Task = "Review the current Ifrim Agent Hub project and report the most important actionable issues.",

    [switch]$NoReport
)

$ErrorActionPreference = "Stop"
throw "Claude is disabled for Ifrim Agent Hub by the OpenAI-only policy. Use the OpenAI reviewer route."
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

$profiles = @{
    quick = @{ Agent = "ifrim-claude-code-reviewer"; Model = "sonnet"; Effort = "medium"; Label = "claude-quick-review" }
    security = @{ Agent = "ifrim-claude-code-reviewer"; Model = "opus"; Effort = "high"; Label = "claude-security-review" }
    architect = @{ Agent = "ifrim-claude-code-reviewer"; Model = "opus"; Effort = "high"; Label = "claude-architecture-review" }
    opus = @{ Agent = "ifrim-claude-code-reviewer"; Model = "opus"; Effort = "high"; Label = "claude-opus-review" }
    fable = @{ Agent = "ifrim-claude-code-reviewer"; Model = "fable"; Effort = "high"; Label = "claude-fable-review" }
}

$selected = $profiles[$Profile]
$prompt = "You are being invoked by Codex for IfrimDigital Ifrim Agent Hub. Task: $Task. Do not edit files. Do not read secrets. Return findings with severity, file/line, evidence, impact, fix recipe, and verification command."

$rawOutput = & claude --agent $selected.Agent --model $selected.Model --effort $selected.Effort -p $prompt --output-format json
if ($LASTEXITCODE -ne 0) { throw "Claude Code exited with status $LASTEXITCODE" }

$resultText = $rawOutput
try {
    $parsed = $rawOutput | ConvertFrom-Json
    if ($parsed.result) { $resultText = $parsed.result }
}
catch {
    $resultText = $rawOutput
}

if (-not $NoReport) {
    $reportDir = Join-Path $projectRoot ".ifrim\AGENT_REPORTS"
    New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
    $timestamp = Get-Date -Format "yyyy-MM-dd-HHmmss"
    $reportPath = Join-Path $reportDir "$timestamp-$($selected.Label).md"
    Set-Content -Path $reportPath -Value $resultText -Encoding UTF8
    Write-Output "Report saved: $reportPath"
}

Write-Output $resultText
