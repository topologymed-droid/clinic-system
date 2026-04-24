@echo off
chcp 65001 >nul
cd /d "%~dp0backend"

echo ================================
echo   雅言牙醫診所 約診系統
echo ================================
echo.

:: 檢查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo 找不到 Python！請先安裝 Python 3.9 以上版本
    echo 下載網址：https://www.python.org/downloads/
    echo.
    pause
    exit /b
)

:: 建立虛擬環境（首次使用）
if not exist venv (
    echo 首次使用，安裝中請稍候...
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -q -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

echo 系統啟動中...
echo 瀏覽器將自動開啟
echo 關閉此視窗即可停止系統
echo.

:: 延遲開啟瀏覽器
start "" timeout /t 2 >nul && start "" "http://localhost:8000"

:: 啟動伺服器
uvicorn main:app --host 0.0.0.0 --port 8000
pause
