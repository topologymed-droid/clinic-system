#!/bin/bash
# 等網路連線穩定
sleep 10

# 關掉已存在的舊程序
pkill -f "uvicorn main:app" 2>/dev/null
pkill -f "ngrok http" 2>/dev/null
sleep 2

# 啟動後端
cd "/Users/yayanyayizhensuo/雅言/clinic-system/backend"
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 &

# 等後端啟動
sleep 5

# 啟動 ngrok
/Users/yayanyayizhensuo/Applications/ngrok http 8000 --domain=deniable-fraying-slick.ngrok-free.dev &
