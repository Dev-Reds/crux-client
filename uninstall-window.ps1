param([string]$Mode = 'window')
$ErrorActionPreference = 'SilentlyContinue'
$ProgressFile = Join-Path $env:TEMP 'crux-update-progress.json'

Add-Type -AssemblyName PresentationFramework
$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Crux Client Update" Width="580" Height="360"
        WindowStartupLocation="CenterScreen" Topmost="True"
        ResizeMode="NoResize" WindowStyle="ToolWindow" Background="#0A0A0A">
  <Border CornerRadius="10" Background="#0A0A0A" BorderBrush="#2A2A2A" BorderThickness="1">
  <StackPanel Margin="34,24">
    <TextBlock x:Name="Head" Text="Crux Client Update" FontSize="19" FontWeight="Bold" Foreground="#FFFFFF" HorizontalAlignment="Center"/>
    <TextBlock x:Name="Status" Text="Deinstallation laeuft..." FontSize="26" FontWeight="Bold" Foreground="#0088FF" HorizontalAlignment="Center" Margin="0,26,0,0"/>
    <TextBlock x:Name="Sub" Text="Die alte Version wird deinstalliert, danach wird die neue Version installiert. Bitte warten - nicht schliessen." FontSize="13" Foreground="#888888" TextWrapping="Wrap" HorizontalAlignment="Center" Margin="12,10,12,0"/>
    <Border CornerRadius="8" Background="#222228" Height="14" Margin="0,28,0,0">
      <ProgressBar x:Name="Bar" Height="14" Maximum="100" Value="0" Foreground="#0088FF" Background="Transparent" BorderThickness="0" Padding="2"/>
    </Border>
    <TextBlock x:Name="Pct" Text="0%" FontSize="40" FontWeight="Bold" Foreground="#FFFFFF" HorizontalAlignment="Center" Margin="0,12,0,0"/>
    <TextBlock Text="Deinstallieren + Installieren + Starten" FontSize="10" Foreground="#666666" HorizontalAlignment="Center" Margin="0,10,0,0"/>
  </StackPanel>
  </Border>
</Window>
'@
$sr = New-Object System.IO.StringReader($xaml)
$xr = New-Object System.Xml.XmlTextReader($sr)
$win = [System.Windows.Markup.XamlReader]::Load($xr)
$statusEl = $win.FindName('Status')
$subEl = $win.FindName('Sub')
$barEl = $win.FindName('Bar')
$pctEl = $win.FindName('Pct')

$phase = 'uninstall'
$cur = 0.0
$startPct = 0.0
$targetPct = 90.0
$animStart = [DateTime]::UtcNow
$animDur = 40.0
$startedUtc = [DateTime]::UtcNow
$closing = $false

function Read-Prog {
  try {
    $j = [System.IO.File]::ReadAllText($ProgressFile) | ConvertFrom-Json
    return ,$j
  } catch { return $null }
}

function Set-State([string]$p) {
  if ($p -eq 'uninstall') { $statusEl.Text = 'Deinstallation laeuft...'; $subEl.Text = 'Die alte Version wird deinstalliert, danach wird die neue Version installiert. Bitte warten - nicht schliessen.' }
  elseif ($p -eq 'launch') { $statusEl.Text = 'Fast fertig!'; $subEl.Text = 'Crux Client wird jetzt gestartet...' }
  elseif ($p -eq 'done') { $statusEl.Text = 'Fertig!'; $subEl.Text = 'Crux Client wurde erfolgreich aktualisiert.' }
  elseif ($p -eq 'cancel') { $statusEl.Text = 'Update fehlgeschlagen'; $subEl.Text = 'Bitte starte den Launcher neu und versuche es erneut.' }
}

function Update-UI {
  $pp = [Math]::Floor($cur)
  if ($pp -lt 0) { $pp = 0 }
  if ($pp -gt 100) { $pp = 100 }
  $pctEl.Text = "$pp%"
  $barEl.Value = $pp
  Set-State $phase
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(150)
$timer.Add_Tick({
  if (-not $closing) {
    $d = Read-Prog
    if ($d -ne $null) {
      $np = [string]$d.phase
      if ($np -eq 'uninstall' -or $np -eq 'launch' -or $np -eq 'done' -or $np -eq 'cancel') {
        if ($np -ne $phase) {
          $phase = $np
          $startPct = $cur
          $animStart = [DateTime]::UtcNow
          if ($np -eq 'uninstall') { $targetPct = 90.0; $animDur = 40.0 }
          elseif ($np -eq 'launch') { $targetPct = 99.0; $animDur = 12.0 }
          elseif ($np -eq 'done') { $targetPct = 100.0; $animDur = 1.0 }
          elseif ($np -eq 'cancel') { $targetPct = $cur; $animDur = 0.001 }
        }
      }
    }
    if ($phase -eq 'uninstall' -or $phase -eq 'launch') {
      $el = ([DateTime]::UtcNow - $animStart).TotalSeconds
      $t = 1
      if ($animDur -gt 0) { $t = $el / $animDur }
      if ($t -gt 1) { $t = 1 }
      $cur = $startPct + ($targetPct - $startPct) * $t
    }
    Update-UI
    $now = [DateTime]::UtcNow
    if (($phase -eq 'done' -and ($now - $animStart).TotalSeconds -ge 2.5) -or
        ($phase -eq 'cancel' -and ($now - $animStart).TotalSeconds -ge 6) -or
        ($now - $startedUtc).TotalSeconds -ge 300) {
      $closing = $true
      $timer.Stop()
      try { $win.Close() } catch {}
    }
  }
})
$timer.Start()
try { $win.ShowDialog() | Out-Null } catch {}
try { $timer.Stop() } catch {}
