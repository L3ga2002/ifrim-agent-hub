$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expected = [IO.Path]::GetFullPath((Join-Path $root '.ifrim\private\openclaw-subscription-runtime'))
$target = (Get-Item -LiteralPath $expected -Force).FullName
if ($target -ne $expected) { throw 'Unexpected isolated state path' }
for ($current = Get-Item -LiteralPath $target -Force; $null -ne $current; $current = $current.Parent) {
    if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point in private state path' }
}
$acl = Get-Acl -LiteralPath $target
$acl.SetAccessRuleProtection($true, $false)
foreach ($existing in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($existing) }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$sids = @($identity, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')), (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')))
foreach ($sid in $sids) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
}
$directory = New-Object IO.DirectoryInfo($target)
if ($PSVersionTable.PSEdition -eq 'Core') {
    [IO.FileSystemAclExtensions]::SetAccessControl($directory, $acl)
} else {
    $directory.SetAccessControl($acl)
}
$saved = Get-Acl -LiteralPath $target
if (!$saved.AreAccessRulesProtected -or $saved.Access.Count -ne 3) { throw 'Private state ACL verification failed' }
foreach ($rule in $saved.Access) {
    if ($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $sids.Value -or
        $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
        $rule.InheritanceFlags -ne ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit) -or
        $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) { throw 'Unexpected private state ACL' }
}
$actualSids = @($saved.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } | Sort-Object -Unique)
if (@(Compare-Object @($sids.Value | Sort-Object -Unique) $actualSids).Count -ne 0) { throw 'Private state ACL identity coverage differs' }
Write-Output 'Private state ACL verified'
