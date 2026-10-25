param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = Get-Content -LiteralPath $RequestFile -Raw -Encoding utf8 | ConvertFrom-Json
$testRoot = [IO.Path]::GetFullPath($request.root)
$exePath = [IO.Path]::GetFullPath($request.exe)
if (-not $exePath.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Native UI test executable outside fixture.' }
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ArcwellTestDialogs {
  public delegate bool WindowCallback(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, WindowCallback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hwnd, int id);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
}
'@
$lockHandle = $null
$child = $null
try {
  if ($request.lockedFile) { $lockHandle = [IO.File]::Open($request.lockedFile, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
  $env:ARCWELL_UNINSTALL_TEST_ROOT = $testRoot
  $child = Start-Process -FilePath $exePath -ArgumentList $request.arguments -PassThru -WindowStyle Hidden
  $answers = [Collections.Generic.Queue[int]]::new()
  foreach ($answer in $request.answers) { $answers.Enqueue([int]$answer) }
  $texts = [Collections.Generic.List[string]]::new()
  $seen = [Collections.Generic.HashSet[string]]::new()
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  while (-not $child.HasExited) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Isolated native uninstall test timed out.' }
    [ArcwellTestDialogs]::EnumWindows({ param($window, $unused)
      $ownerId = [uint32]0
      [void][ArcwellTestDialogs]::GetWindowThreadProcessId($window, [ref]$ownerId)
      if ($ownerId -eq $child.Id -and $answers.Count -gt 0) {
        $button = [ArcwellTestDialogs]::GetDlgItem($window, $answers.Peek())
        if ($button -ne [IntPtr]::Zero) {
          $dialogText = [Text.StringBuilder]::new()
          [ArcwellTestDialogs]::EnumChildWindows($window, { param($control, $unused2)
            $text = [Text.StringBuilder]::new(4096)
            [void][ArcwellTestDialogs]::GetWindowText($control, $text, $text.Capacity)
            [void]$dialogText.AppendLine($text.ToString())
            return $true
          }, [IntPtr]::Zero) | Out-Null
          # Windows may reuse the same HWND for the next confirmation.
          $identity = $window.ToInt64().ToString() + ':' + $dialogText.ToString()
          if ($seen.Add($identity)) {
            $texts.Add($dialogText.ToString())
            [void]$answers.Dequeue()
            [void][ArcwellTestDialogs]::PostMessage($button, 0xF5, [IntPtr]::Zero, [IntPtr]::Zero)
          }
        }
      }
      return $true
    }, [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds 50
    $child.Refresh()
  }
  $child.WaitForExit()
  if ($answers.Count -ne 0) { throw ('Expected native confirmation was not displayed. Exit=' + $child.ExitCode + '; dialogs=' + $texts.Count + '; remaining=' + $answers.Count) }
  $recycledPaths = @()
  foreach ($expected in $request.expectRecycled) {
    $volume = [IO.Path]::GetPathRoot($expected)
    $sidValue = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $metadataDirectory = Join-Path $volume ('$Recycle.Bin\' + $sidValue)
    $found = $false
    Get-ChildItem -LiteralPath $metadataDirectory -Force -File -Filter '$I*' -ErrorAction Stop | ForEach-Object {
      $bytes = [IO.File]::ReadAllBytes($_.FullName)
      $format = [BitConverter]::ToInt64($bytes, 0)
      $offset = if ($format -eq 1) { 24 } else { 28 }
      if ($bytes.Length -gt $offset) {
        $original = [Text.Encoding]::Unicode.GetString($bytes, $offset, $bytes.Length - $offset).TrimEnd([char]0)
        if ($original -eq $expected) {
          $content = Join-Path $metadataDirectory ('$R' + $_.Name.Substring(2))
          if (-not (Test-Path -LiteralPath $content)) { throw 'Recycle metadata exists without recoverable content.' }
          $found = $true
        }
      }
    }
    if (-not $found) { throw 'Native cleanup did not produce a recoverable Recycle Bin entry.' }
    $recycledPaths += $expected
  }
  @{ exitCode = $child.ExitCode; dialogs = @($texts.ToArray()); recycledPaths = $recycledPaths } | ConvertTo-Json -Depth 4 -Compress
} finally {
  if ($lockHandle) { $lockHandle.Dispose() }
  if ($child -and -not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
}
