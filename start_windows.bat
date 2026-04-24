@echo off
cd /d "%~dp0backend"

if not exist venv (
    echo 建立虛擬環境...
    python -m venv venv
)

call venv\Scripts\activate.bat

pip install -q -r requirements.txt

echo.
echo 啟動診所約診系統...
echo   開啟瀏覽器：http://localhost:8000
echo   首次使用會自動開啟 Google 授權視窗
echo   按 Ctrl+C 停止伺服器
echo.

start "" "http://localhost:8000"

uvicorn main:app --host 0.0.0.0 --port 8000
pause
