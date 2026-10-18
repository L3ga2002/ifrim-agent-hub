# Office check through the applications' own automation (COM), read-only on the source file.
# Input: a JSON file { kind: "docx"|"xlsx", path, pdfOut?, cells?: [{ sheet, ref }] }. Output: one JSON line on stdout.
# Starts its OWN invisible Word/Excel instance and quits only that instance (an instance the owner has open is never touched).
param([Parameter(Mandatory = $true)][string]$ArgsFile)
$ErrorActionPreference = "Stop"
$a = Get-Content -LiteralPath $ArgsFile -Raw -Encoding UTF8 | ConvertFrom-Json
$out = [ordered]@{ ok = $false; kind = $a.kind; app = $null; version = $null }
$app = $null; $doc = $null
function Release($o) { if ($null -ne $o) { try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($o) } catch {} } }
try {
  if ($a.kind -eq "docx") {
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false; $app.DisplayAlerts = 0
    $out.app = "Microsoft Word"; $out.version = [string]$app.Version
    $doc = $app.Documents.Open([string]$a.path, $false, $true, $false)
    $out.paragraphs = $doc.Paragraphs.Count
    $out.pages = $doc.ComputeStatistics(2)
    $out.words = $doc.ComputeStatistics(0)
    $heads = @()
    foreach ($p in $doc.Paragraphs) { if ($p.OutlineLevel -lt 10) { $heads += ,@([int]$p.OutlineLevel, ([string]$p.Range.Text).Trim()) } }
    $out.headings = $heads
    $tables = @()
    foreach ($t in $doc.Tables) { $tables += ,([ordered]@{ rows = $t.Rows.Count; cols = $t.Columns.Count; headerRepeats = [bool]$t.Rows.Item(1).HeadingFormat }) }
    $out.tables = $tables
    $bul = 0
    foreach ($p in $doc.ListParagraphs) { $bul++ }
    $out.listParagraphs = $bul
    $out.firstStyle = [string]$doc.Paragraphs.Item(1).Style.NameLocal
    if ($a.pdfOut) { $doc.ExportAsFixedFormat([string]$a.pdfOut, 17); $out.pdf = [string]$a.pdfOut }
    $doc.Close(0); Release $doc; $doc = $null
  } elseif ($a.kind -eq "xlsx") {
    $app = New-Object -ComObject Excel.Application
    $app.Visible = $false; $app.DisplayAlerts = $false; $app.ScreenUpdating = $false
    $out.app = "Microsoft Excel"; $out.version = [string]$app.Version
    $doc = $app.Workbooks.Open([string]$a.path, 0, $true)
    $app.CalculateFull()
    $sheets = @()
    foreach ($ws in $doc.Worksheets) { $sheets += ,([ordered]@{ name = [string]$ws.Name; autoFilter = [bool]$ws.AutoFilterMode; usedRange = [string]$ws.UsedRange.Address(0, 0) }) }
    $out.sheets = $sheets
    $cells = @()
    foreach ($c in @($a.cells)) {
      if ($null -eq $c) { continue }
      $r = $doc.Worksheets.Item([string]$c.sheet).Range([string]$c.ref)
      $v = $r.Value2
      $err = $null
      if ($v -is [int] -and $v -lt -2146820000) { $err = [string]$r.Text }
      $cells += ,([ordered]@{ sheet = [string]$c.sheet; ref = [string]$c.ref; hasFormula = [bool]$r.HasFormula; formula = [string]$r.Formula; value = $v; text = [string]$r.Text; error = $err })
    }
    $out.cells = $cells
    if ($a.pdfOut) { $doc.ExportAsFixedFormat(0, [string]$a.pdfOut); $out.pdf = [string]$a.pdfOut }
    $doc.Close($false); Release $doc; $doc = $null
  } else { throw "kind necunoscut: $($a.kind)" }
  $out.ok = $true
} catch {
  $out.error = $_.Exception.Message
} finally {
  if ($null -ne $doc) { try { if ($a.kind -eq "docx") { $doc.Close(0) } else { $doc.Close($false) } } catch {} ; Release $doc }
  if ($null -ne $app) { try { $app.Quit() } catch {} ; Release $app }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
($out | ConvertTo-Json -Depth 6 -Compress)
