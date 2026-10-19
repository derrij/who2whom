# PWA icons for "Kto komu"
# Run:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $root 'icons'
New-Item -ItemType Directory -Path $out -Force | Out-Null

function New-Icon {
  param(
    [int]$Size,
    [string]$Path,
    [bool]$Maskable
  )

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $grad1 = [System.Drawing.Color]::FromArgb(255, 29, 78, 216)
  $grad2 = [System.Drawing.Color]::FromArgb(255, 14, 165, 233)
  $green = [System.Drawing.Color]::FromArgb(255, 74, 222, 128)
  $rose  = [System.Drawing.Color]::FromArgb(255, 251, 113, 133)

  $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)

  if ($Maskable) {
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      $rect, $grad1, $grad2, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
    $inset = 0.30
  } else {
    $radius = [int]($Size * 0.22)
    $d = $radius * 2
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddArc(0, 0, $d, $d, 180, 90)
    $gp.AddArc($Size - $d, 0, $d, $d, 270, 90)
    $gp.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
    $gp.AddArc(0, $Size - $d, $d, $d, 90, 90)
    $gp.CloseFigure()
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      $rect, $grad1, $grad2, [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
    $g.FillPath($brush, $gp)
    $brush.Dispose()
    $gp.Dispose()
    $inset = 0.24
  }

  $left  = $Size * $inset
  $right = $Size * (1 - $inset)
  $bar   = [int]($Size * 0.075)
  $head  = [int]($Size * 0.135)
  $cy1   = $Size * 0.385
  $cy2   = $Size * 0.615

  $bGreen = New-Object System.Drawing.SolidBrush($green)
  $bRose  = New-Object System.Drawing.SolidBrush($rose)
  $white  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

  # top arrow: left -> right (green)
  $g.FillRectangle($bGreen, [int]$left, [int]($cy1 - $bar / 2), [int]($right - $left - $head + 2), $bar)
  $triTop = @(
    (New-Object System.Drawing.PointF([float]$right, [float]$cy1)),
    (New-Object System.Drawing.PointF([float]($right - $head), [float]($cy1 - $head * 0.62))),
    (New-Object System.Drawing.PointF([float]($right - $head), [float]($cy1 + $head * 0.62)))
  )
  $g.FillPolygon($bGreen, $triTop)

  # bottom arrow: right -> left (rose)
  $g.FillRectangle($bRose, [int]($left + $head - 2), [int]($cy2 - $bar / 2), [int]($right - $left - $head + 2), $bar)
  $triBot = @(
    (New-Object System.Drawing.PointF([float]$left, [float]$cy2)),
    (New-Object System.Drawing.PointF([float]($left + $head), [float]($cy2 - $head * 0.62))),
    (New-Object System.Drawing.PointF([float]($left + $head), [float]($cy2 + $head * 0.62)))
  )
  $g.FillPolygon($bRose, $triBot)

  $bGreen.Dispose(); $bRose.Dispose(); $white.Dispose(); $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("ok: " + $Path)
}

New-Icon -Size 192 -Path (Join-Path $out 'icon-192.png')     -Maskable $false
New-Icon -Size 512 -Path (Join-Path $out 'icon-512.png')     -Maskable $false
New-Icon -Size 192 -Path (Join-Path $out 'maskable-192.png') -Maskable $true
New-Icon -Size 512 -Path (Join-Path $out 'maskable-512.png') -Maskable $true

Write-Host ("done: " + $out)
