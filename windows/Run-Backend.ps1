param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$ProjectPath = Split-Path $PSScriptRoot -Parent
$RuntimePath = Join-Path $ProjectPath 'runtime'
$LogPath = Join-Path $ProjectPath 'logs'
$PidPath = Join-Path $RuntimePath 'backend.pid'
$ServerPath = Join-Path $ProjectPath 'server\index.mjs'
if (!$NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
New-Item -ItemType Directory -Path $RuntimePath, $LogPath -Force | Out-Null
if (Test-Path $PidPath) {
    $SavedId = 0
    if ([int]::TryParse((Get-Content $PidPath -Raw).Trim(), [ref]$SavedId)) {
        $Existing = Get-CimInstance Win32_Process -Filter "ProcessId = $SavedId" -ErrorAction SilentlyContinue
        if ($Existing -and $Existing.Name -eq 'node.exe' -and $Existing.CommandLine.Contains($ServerPath)) { exit 0 }
    }
}
$EnvPath = Join-Path $ProjectPath '.env'
$Arguments = @("--env-file-if-exists=`"$EnvPath`"", "`"$ServerPath`"")
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Process = Start-Process -FilePath $NodePath -ArgumentList $Arguments -WorkingDirectory $ProjectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogPath "backend-$Stamp.log") -RedirectStandardError (Join-Path $LogPath "backend-$Stamp-error.log")
Set-Content -Path $PidPath -Value $Process.Id -NoNewline
$Process.WaitForExit()
if (Test-Path $PidPath) { if ((Get-Content $PidPath -Raw).Trim() -eq [string]$Process.Id) { Remove-Item $PidPath -ErrorAction SilentlyContinue } }
exit $Process.ExitCode
