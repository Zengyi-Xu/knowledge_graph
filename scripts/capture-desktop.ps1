# 截取「知识图谱」主窗口到 PNG（用于验证桌面端加载状态）
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Cap {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$mainPid = (Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*v0.3.2*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1).ProcessId
$proc = Get-Process -Id $mainPid
if (-not $proc) { Write-Output 'NO_WINDOW'; exit 1 }
[Win32Cap]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
[Win32Cap]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 600
$rect = New-Object Win32Cap+RECT
[Win32Cap]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$out = Join-Path (Get-Location) '.tmp-vault-test/desktop-shot.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("SAVED {0}x{1} -> {2}" -f $w, $h, $out)
