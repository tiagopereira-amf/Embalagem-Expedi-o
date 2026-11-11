$ErrorActionPreference = 'Stop'
$path = $env:EMBEXP_BD_PATH
if ([string]::IsNullOrWhiteSpace($path)) { throw 'Caminho do ficheiro BD em falta.' }
if (-not (Test-Path -LiteralPath $path)) { throw 'O ficheiro BD não está neste caminho.' }

$excel = $null
$wb = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.ScreenUpdating = $false
  $excel.EnableEvents = $false
  # 3 = atualizar ligações sem perguntar; o terceiro argumento é ReadOnly = false
  $wb = $excel.Workbooks.Open($path, 3, $false)
  $wb.RefreshAll() | Out-Null
  try { $excel.CalculateUntilAsyncQueriesDone() } catch { }
  $deadline = (Get-Date).AddMinutes(2)
  while ($excel.CalculationState -ne 0 -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }
  if ($excel.CalculationState -ne 0) { throw 'O Excel não terminou a atualização a tempo.' }
  $wb.Save()
  $wb.Close($true) | Out-Null
  $wb = $null
  $excel.Quit() | Out-Null
  $excel = $null
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $wb) { try { $wb.Close($false) | Out-Null } catch { } }
  if ($null -ne $excel) { try { $excel.Quit() | Out-Null } catch { } }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
