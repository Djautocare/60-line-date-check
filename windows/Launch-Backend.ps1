$ErrorActionPreference = 'Stop'
$TaskName = '60 Line Date Check Backend'
try {
    $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($Task.State -eq 'Running') { Write-Host 'DateCheck backend is already running.' }
    else { Start-ScheduledTask -TaskName $TaskName; Write-Host 'DateCheck backend launch requested. Open http://localhost:3001 after a few seconds.' }
} catch { Write-Host "Could not launch the backend: $($_.Exception.Message)"; Write-Host 'Run Install-60-Line-Date-Check-Task.cmd first.'; Read-Host 'Press Enter to close'; exit 1 }
Read-Host 'Press Enter to close'
