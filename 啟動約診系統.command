#!/bin/bash
# ── 雅言牙醫診所 約診系統 啟動器 ──

cd "$(dirname "$0")/backend"

echo "================================"
echo "  🦷 雅言牙醫診所 約診系統"
echo "================================"
echo ""

# 啟動虛擬環境
source venv/bin/activate

echo "✅ 系統啟動中..."
echo "   瀏覽器將自動開啟"
echo "   關閉此視窗即可停止系統"
echo ""

# 延遲 2 秒後開啟瀏覽器
sleep 2 && open "http://localhost:8000" &

# 啟動伺服器
uvicorn main:app --host 0.0.0.0 --port 8000
