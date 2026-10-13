$ErrorActionPreference = 'Stop'
$ProjectPath = Split-Path $PSScriptRoot -Parent
$ServerPath = Join-Path $ProjectPath 'server\index.mjs'
$PidPath = Join-Path $ProjectPath 'runtime\backend.pid'
try {
    $Task = Get-ScheduledTask -TaskName '60 Line Date Check Backend' -ErrorAction SilentlyContinue
    if ($Task -and $Task.State -eq 'Running') { Stop-ScheduledTask -TaskName '60 Line Date Check Backend' }
    if (Test-Path $PidPath) {
        $SavedId = 0
        if ([int]::TryParse((Get-Content $PidPath -Raw).Trim(), [ref]$SavedId)) {
            $Process = Get-CimInstance Win32_Process -Filter "ProcessId = $SavedId" -ErrorAction SilentlyContinue
            if ($Process -and $Process.Name -eq 'node.exe' -and $Process.CommandLine.Contains($ServerPath)) { Stop-Process -Id $SavedId -Force }
        }
        Remove-Item $PidPath -ErrorAction SilentlyContinue
    }
    Write-Host 'DateCheck backend stopped. The scheduled task remains installed and can be launched again.'
} catch { Write-Host "Could not stop the backend: $($_.Exception.Message)"; Read-Host 'Press Enter to close'; exit 1 }
Read-Host 'Press Enter to close'
