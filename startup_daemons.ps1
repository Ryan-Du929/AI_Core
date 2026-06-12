# startup_daemons.ps1 — Lucas 團隊服務啟動腳本（PowerShell 版）
# 使用方式：在 PowerShell 中執行  .\startup_daemons.ps1

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🚀 Lucas 團隊服務啟動腳本 (PowerShell)" -ForegroundColor Cyan
Write-Host "時間: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$WORKSPACE = "C:\Users\Du929\openclaw-workspace"  # ← 改成你的實際路徑

# ── 1. Yakumo 八雲 ──
$p = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "yakumo_discord" }
if (-not $p) {
    Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "agents/eve/yakumo_discord.js" -WorkingDirectory $WORKSPACE
    Write-Host "🟢 八雲 已啟動"
} else {
    Write-Host "⏭️  八雲 已在執行中 (PID $($p.Id))"
}

# ── 2. Lucas ──
$p = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "lucas_discord" }
if (-not $p) {
    Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "agents/eve/lucas_discord.js" -WorkingDirectory $WORKSPACE
    Write-Host "🟢 Lucas 已啟動"
} else {
    Write-Host "⏭️  Lucas 已在執行中 (PID $($p.Id))"
}

# ── 3. 自動備份 ──
$p = Get-Process -Name "python3" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "auto_backup" }
if (-not $p) {
    Start-Process -WindowStyle Hidden -FilePath "python3" -ArgumentList "-u auto_backup.py --daemon --interval 2" -WorkingDirectory $WORKSPACE
    Write-Host "🟢 自動備份 已啟動"
} else {
    Write-Host "⏭️  自動備份 已在執行中 (PID $($p.Id))"
}

# ── 4. 記憶蒸餾 ──
$p = Get-Process -Name "python3" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "memory_distill" }
if (-not $p) {
    Start-Process -WindowStyle Hidden -FilePath "python3" -ArgumentList "-u memory_distill.py --daemon --interval 600" -WorkingDirectory $WORKSPACE
    Write-Host "🟢 記憶蒸餾 已啟動"
} else {
    Write-Host "⏭️  記憶蒸餾 已在執行中 (PID $($p.Id))"
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "✅ 啟動完成" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
pause