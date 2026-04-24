# 診所約診系統 — 安裝與設定說明

## 系統需求
- Python 3.9 以上
- 瀏覽器（Chrome / Edge 建議）

---

## 第一步：Google Calendar API 設定（只需做一次）

### 1. 建立 Google Cloud 專案
1. 前往 https://console.cloud.google.com/
2. 點右上角「建立專案」→ 輸入名稱（例：診所約診系統）→ 建立

### 2. 啟用 Google Calendar API
1. 左側選單 → API 和服務 → 程式庫
2. 搜尋「Google Calendar API」→ 點進去 → 啟用

### 3. 建立 OAuth 憑證
1. 左側選單 → API 和服務 → 憑證
2. 點「建立憑證」→ 選「OAuth 用戶端 ID」
3. 應用程式類型選「**桌面應用程式**」
4. 名稱隨意填 → 建立
5. 點「下載 JSON」→ 將檔案**重新命名為 `credentials.json`**
6. 將 `credentials.json` 放入 `clinic-system/backend/` 資料夾

### 4. 設定同意畫面（如果被要求）
1. 左側選單 → OAuth 同意畫面
2. 使用者類型選「外部」→ 建立
3. 填入應用程式名稱（例：診所約診系統）和你的 Email
4. 在「測試使用者」中加入你的 Gmail 帳號
5. 儲存

---

## 第二步：啟動系統

### Mac 電腦
```bash
bash start_mac.sh
```

### Windows 電腦
直接雙擊 `start_windows.bat`

---

## 第三步：首次 Google 授權
1. 系統啟動後瀏覽器會自動開啟一個 Google 登入視窗
2. 選擇你的 Gmail 帳號 → 允許存取行事曆
3. 授權完成後頁面會顯示「成功」→ 回到系統即可使用
4. 之後啟動不需要再授權（token 會自動儲存在 `backend/token.json`）

---

## 日常使用
每次開診前執行啟動腳本，瀏覽器開啟 http://localhost:8000 即可。

---

## 檔案結構
```
clinic-system/
├── backend/
│   ├── main.py              # 後端伺服器
│   ├── requirements.txt     # Python 套件
│   ├── credentials.json     # ← 你需要放入此檔案
│   ├── token.json           # 授權後自動產生
│   └── doctors.json         # 醫師資料（自動產生）
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── start_mac.sh
├── start_windows.bat
└── README.md
```
