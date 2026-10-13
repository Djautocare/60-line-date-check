$ErrorActionPreference = 'Stop'
$ProjectPath = Split-Path $PSScriptRoot -Parent
$TaskName = '60 Line Date Check Backend'
$Runner = Join-Path $PSScriptRoot 'Run-Backend.ps1'
$NodePath = (Get-Command node.exe -ErrorAction Stop).Source
if (!(Test-Path (Join-Path $ProjectPath '.env'))) { throw 'Create .env from .env.example and enter your PostgreSQL and admin settings first.' }
if (!(Test-Path (Join-Path $ProjectPath 'dist\index.html'))) { throw 'Run npm install and npm run build before installing this task.' }
$UserName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`" -NodePath `"$NodePath`"" -WorkingDirectory $ProjectPath
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserName
$Principal = New-ScheduledTaskPrincipal -UserId $UserName -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description 'DateCheck username login, camera checks and PostgreSQL backend on port 3001. Starts when this Windows user signs in.' -Force | Out-Null
Write-Host "Installed: $TaskName"
Write-Host 'Double-click Launch-60-Line-Date-Check.cmd to start it now.'
Write-Host 'It will also start automatically when this Windows account signs in.'
Read-Host 'Press Enter to close'
