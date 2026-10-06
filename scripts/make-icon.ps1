# 生成 256x256 应用图标 PNG（紫渐变圆角底 + NAI 字样）
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56
$path.AddArc(0, 0, $r, $r, 180, 90)
$path.AddArc($size - $r, 0, $r, $r, 270, 90)
$path.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
$path.AddArc(0, $size - $r, $r, $r, 90, 90)
$path.CloseFigure()

$rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
$c1 = [System.Drawing.Color]::FromArgb(255, 109, 40, 217)
$c2 = [System.Drawing.Color]::FromArgb(255, 167, 108, 250)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 55)
$g.FillPath($brush, $path)

# 高光弧线装饰
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 255, 255, 255), 6)
$g.DrawArc($pen, 26, 26, 204, 204, 200, 110)
$pen.Dispose()

$font = New-Object System.Drawing.Font('Segoe UI', 72, [System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'
$fmt.LineAlignment = 'Center'
$textRect = New-Object System.Drawing.RectangleF(0, 6, $size, $size)
$g.DrawString('NAI', $font, [System.Drawing.Brushes]::White, $textRect, $fmt)
$g.Dispose()

New-Item -ItemType Directory -Force -Path build | Out-Null
$bmp.Save('build\icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host 'icon.png created'
