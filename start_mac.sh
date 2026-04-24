#!/bin/bash
cd "$(dirname "$0")/backend"

# 建立虛擬環境（若尚未建立）
if [ ! -d "venv" ]; then
  echo "🔧 建立虛擬環境..."
  python3 -m venv venv
fi

# 啟動虛擬環境
source venv/bin/activate

# 安裝套件（若尚未安裝）
pip install -q -r requirements.txt

echo ""
echo "✅ 啟動診所約診系統..."
echo "   → 請在瀏覽器開啟：http://localhost:8000"
echo "   → 首次使用會自動開啟 Google 授權視窗"
echo "   → 按 Ctrl+C 停止伺服器"
echo ""

# 自動開啟瀏覽器（稍作延遲）
sleep 2 && open "http://localhost:8000" &

uvicorn main:app --host 0.0.0.0 --port 8000
