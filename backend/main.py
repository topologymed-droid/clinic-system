import os
import re
import json
import base64
import threading
import urllib.request
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR    = os.path.join(BASE_DIR, '..', 'frontend')
DOCTORS_FILE     = os.path.join(BASE_DIR, 'doctors.json')
HISTORY_FILE     = os.path.join(BASE_DIR, 'history.json')
BOOKERS_FILE     = os.path.join(BASE_DIR, 'bookers.json')
PATIENTS_FILE    = os.path.join(BASE_DIR, 'patients.json')
TOKEN_FILE       = os.path.join(BASE_DIR, 'token.json')
CREDENTIALS_FILE = os.path.join(BASE_DIR, 'credentials.json')

SCOPES = ['https://www.googleapis.com/auth/calendar']

# ─── GitHub 自動同步 ───────────────────────────────────────────────────────────
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')
GITHUB_REPO  = 'topologymed-droid/clinic-system'

# 需要自動同步到 GitHub 的檔案（Railway 重新部署時不會遺失）
SYNC_FILES = {
    DOCTORS_FILE:  'backend/doctors.json',
    BOOKERS_FILE:  'backend/bookers.json',
    PATIENTS_FILE: 'backend/patients.json',
}

def _push_to_github(local_path: str, repo_path: str):
    """把本地 JSON 檔同步推送到 GitHub（背景執行，不阻塞 API 回應）"""
    if not GITHUB_TOKEN:
        return
    try:
        api_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{repo_path}"
        headers = {
            'Authorization': f'token {GITHUB_TOKEN}',
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
        }
        # 取得目前檔案的 SHA（更新時必須提供）
        sha = ''
        try:
            req = urllib.request.Request(api_url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as r:
                sha = json.loads(r.read()).get('sha', '')
        except Exception:
            pass  # 新檔案時 SHA 為空也沒關係

        with open(local_path, 'r', encoding='utf-8') as f:
            content = f.read()

        body = json.dumps({
            'message': f'auto-sync: {repo_path}',
            'content': base64.b64encode(content.encode()).decode(),
            **({'sha': sha} if sha else {}),
        }).encode()

        put_req = urllib.request.Request(api_url, data=body, method='PUT', headers=headers)
        urllib.request.urlopen(put_req, timeout=10)
        print(f"[GitHub sync] {repo_path} ✓")
    except Exception as e:
        print(f"[GitHub sync] {repo_path} 失敗: {e}")

def sync_to_github(local_path: str):
    """背景非同步推送到 GitHub"""
    repo_path = SYNC_FILES.get(local_path)
    if not repo_path:
        return
    t = threading.Thread(target=_push_to_github, args=(local_path, repo_path), daemon=True)
    t.start()

# Google 行事曆 ID
CALENDAR_MAIN = 'd9a176ceee3179840a8bd7c3835585b068e1aa3b18ddbe4cf4a70e896c89fa72@group.calendar.google.com'  # 雅言診所
CALENDAR_SU   = 'd8893eed332dce19965d2f7b525b5bced33607830c13cee746bceca26322a98e@group.calendar.google.com'   # 雅言 Dr.蘇

def get_calendar_id(doctor: str) -> str:
    return CALENDAR_SU if '蘇' in doctor else CALENDAR_MAIN

def event_summary(doctor: str, patient: str, visit_type: str, complaint: str, booker: str = '') -> str:
    np = 'NP ' if visit_type == '初診' else ''
    if '蘇' in doctor:
        base = f"{np}{patient} {complaint}"
    else:
        surname = doctor.replace('醫師', '').strip()[0]
        base = f"{np}Dr.{surname} {patient} {complaint}"
    return f"{booker}: {base}" if booker else base

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="診所約診系統")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Default Bookers ──────────────────────────────────────────────────────────
DEFAULT_BOOKERS = [
    {"id": "1", "name": "哲毅"},
    {"id": "2", "name": "姎姎"},
    {"id": "3", "name": "晨晉"},
]

def load_bookers():
    if not os.path.exists(BOOKERS_FILE):
        save_bookers(DEFAULT_BOOKERS)
        return DEFAULT_BOOKERS
    with open(BOOKERS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_bookers(bookers):
    with open(BOOKERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(bookers, f, ensure_ascii=False, indent=2)
    sync_to_github(BOOKERS_FILE)

# ─── Patients Helpers ─────────────────────────────────────────────────────────
def load_patients():
    if not os.path.exists(PATIENTS_FILE):
        return {}
    with open(PATIENTS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_patients(patients):
    with open(PATIENTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(patients, f, ensure_ascii=False, indent=2)
    sync_to_github(PATIENTS_FILE)

def update_patient_doctor(patient_name: str, doctor: str):
    """記憶患者對應醫師"""
    if not patient_name or not doctor:
        return
    patients = load_patients()
    patients[patient_name.strip()] = doctor.strip()
    save_patients(patients)

# ─── Default Doctors ──────────────────────────────────────────────────────────
DEFAULT_DOCTORS = [
    {"id": "1", "name": "張哲維醫師"},
    {"id": "2", "name": "胡窈玲醫師"},
    {"id": "3", "name": "蘇棋弘醫師"},
    {"id": "4", "name": "鄧育達醫師"},
]

# ─── History Helpers ──────────────────────────────────────────────────────────
def load_history():
    if not os.path.exists(HISTORY_FILE):
        return []
    with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_history(history):
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

def log_time_change(event_id, summary, old_s, old_e, new_s, new_e):
    history = load_history()
    history.append({
        "event_id":   event_id,
        "summary":    summary,
        "changed_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "old_date":   old_s.strftime("%Y-%m-%d"),
        "old_start":  old_s.strftime("%H:%M"),
        "old_end":    old_e.strftime("%H:%M"),
        "new_date":   new_s.strftime("%Y-%m-%d"),
        "new_start":  new_s.strftime("%H:%M"),
        "new_end":    new_e.strftime("%H:%M"),
    })
    save_history(history)

# ─── Doctors Helpers ──────────────────────────────────────────────────────────
def load_doctors():
    if not os.path.exists(DOCTORS_FILE):
        save_doctors(DEFAULT_DOCTORS)
        return DEFAULT_DOCTORS
    with open(DOCTORS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_doctors(doctors):
    with open(DOCTORS_FILE, 'w', encoding='utf-8') as f:
        json.dump(doctors, f, ensure_ascii=False, indent=2)
    sync_to_github(DOCTORS_FILE)

# ─── Google Calendar Helper ───────────────────────────────────────────────────
def get_calendar_service():
    creds = None

    # 先嘗試讀取 token.json 檔案
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    # 若無檔案，從環境變數讀取（Railway 雲端部署用）
    elif os.environ.get('GOOGLE_TOKEN'):
        creds = Credentials.from_authorized_user_info(
            json.loads(os.environ['GOOGLE_TOKEN']), SCOPES
        )

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
            # 更新後存檔（本地環境用）
            try:
                with open(TOKEN_FILE, 'w') as f:
                    f.write(creds.to_json())
            except Exception:
                pass
        else:
            # 若無 credentials.json，從環境變數寫入暫存
            if not os.path.exists(CREDENTIALS_FILE):
                creds_env = os.environ.get('GOOGLE_CREDENTIALS')
                if creds_env:
                    with open(CREDENTIALS_FILE, 'w') as f:
                        f.write(creds_env)
                else:
                    raise HTTPException(
                        status_code=500,
                        detail="找不到 credentials.json，請先依照說明完成 Google API 設定"
                    )
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0, open_browser=True)
            with open(TOKEN_FILE, 'w') as f:
                f.write(creds.to_json())

    return build('calendar', 'v3', credentials=creds)

# ─── Models ───────────────────────────────────────────────────────────────────
class AppointmentCreate(BaseModel):
    patient_name: str
    phone: Optional[str] = None
    doctor: str
    date: str        # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str    # HH:MM
    complaint: str
    visit_type: str  # 初診 | 複診
    booker: Optional[str] = None  # 約診者（例：哲毅）

class AppointmentUpdate(BaseModel):
    date: str        # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str    # HH:MM
    doctor: Optional[str] = None        # 若提供，更新醫師（含日曆轉移）
    patient_name: Optional[str] = None  # 重建 summary 用
    visit_type: Optional[str] = None
    complaint: Optional[str] = None
    booker: Optional[str] = None

class DoctorCreate(BaseModel):
    name: str
    note: Optional[str] = None

class DoctorNoteUpdate(BaseModel):
    note: str

# ─── Doctor Routes ────────────────────────────────────────────────────────────
@app.get("/api/doctors")
def get_doctors():
    return load_doctors()

@app.post("/api/doctors")
def add_doctor(doctor: DoctorCreate):
    doctors = load_doctors()
    existing_ids = [int(d['id']) for d in doctors if d['id'].isdigit()]
    new_id = str(max(existing_ids, default=0) + 1)
    used_indices = {d.get('colorIndex', -1) for d in doctors}
    color_index  = next((i for i in range(20) if i not in used_indices), len(doctors))
    new_doc = {
        "id": new_id,
        "name": doctor.name.strip(),
        "note": doctor.note or "",
        "colorIndex": color_index,
    }
    doctors.append(new_doc)
    save_doctors(doctors)
    return new_doc

@app.patch("/api/doctors/{doctor_id}/name")
def update_doctor_name(doctor_id: str, body: dict):
    name = (body.get('name') or '').strip()
    if not name:
        raise HTTPException(status_code=400, detail="名稱不能為空")
    doctors = load_doctors()
    for d in doctors:
        if d['id'] == doctor_id:
            d['name'] = name
            break
    save_doctors(doctors)
    return {"status": "ok"}

@app.patch("/api/doctors/{doctor_id}/note")
def update_doctor_note(doctor_id: str, body: DoctorNoteUpdate):
    doctors = load_doctors()
    for d in doctors:
        if d['id'] == doctor_id:
            d['note'] = body.note
            break
    save_doctors(doctors)
    return {"status": "ok"}

@app.delete("/api/doctors/{doctor_id}")
def delete_doctor(doctor_id: str):
    doctors = load_doctors()
    doctors = [d for d in doctors if d['id'] != doctor_id]
    save_doctors(doctors)
    return {"status": "ok"}

# ─── Booker Routes ────────────────────────────────────────────────────────────
@app.get("/api/bookers")
def get_bookers():
    return load_bookers()

@app.post("/api/bookers")
def add_booker(body: dict):
    name = body.get('name', '').strip()
    if not name:
        raise HTTPException(status_code=400, detail="名稱不能為空")
    bookers = load_bookers()
    existing_ids = [int(b['id']) for b in bookers if b['id'].isdigit()]
    new_id = str(max(existing_ids, default=0) + 1)
    new_booker = {"id": new_id, "name": name}
    bookers.append(new_booker)
    save_bookers(bookers)
    return new_booker

@app.delete("/api/bookers/{booker_id}")
def delete_booker(booker_id: str):
    bookers = load_bookers()
    bookers = [b for b in bookers if b['id'] != booker_id]
    save_bookers(bookers)
    return {"status": "ok"}

# ─── Patient Routes ───────────────────────────────────────────────────────────
def extract_patient_name(ev: dict) -> str:
    """從事件中解析患者姓名"""
    # 優先從 description 的「患者：」欄取
    desc = ev.get('description', '') or ''
    m = re.search(r'患者：([^\n]+)', desc)
    if m:
        return m.group(1).strip()
    # 從 summary 解析
    s = (ev.get('summary', '') or '').strip()
    # 去除約診者前綴（ex. "哲毅: "）
    if ': ' in s[:15]:
        s = s.split(': ', 1)[1].strip()
    # 去除 NP
    if s.upper().startswith('NP '):
        s = s[3:].strip()
    # 去除 Dr.X
    s = re.sub(r'^(?:Dr|dr)[.．]?\S+\s*', '', s).strip()
    # 取第一個 token
    parts = s.split()
    if parts and len(parts[0]) >= 2:
        return parts[0]
    return ''

@app.get("/api/patients")
def get_all_patients():
    """回傳所有已記憶的患者姓名清單"""
    patients = load_patients()
    return sorted(patients.keys())

@app.get("/api/patients/suggest")
def suggest_patients(q: str):
    """從 patients.json + Google Calendar 搜尋符合的患者姓名"""
    if not q:
        return []
    names: set = set()
    # patients.json（快速本地）
    for name in load_patients().keys():
        if q in name:
            names.add(name)
    # Google Calendar 歷史搜尋
    try:
        service  = get_calendar_service()
        time_min = "2020-01-01T00:00:00+08:00"
        time_max = "2099-12-31T23:59:59+08:00"
        for cal_id in [CALENDAR_MAIN, CALENDAR_SU]:
            try:
                result = service.events().list(
                    calendarId=cal_id,
                    timeMin=time_min, timeMax=time_max,
                    singleEvents=True, q=q, maxResults=50,
                ).execute()
                for ev in result.get('items', []):
                    name = extract_patient_name(ev)
                    if name and q in name and len(name) >= 2:
                        names.add(name)
            except Exception:
                continue
    except Exception:
        pass
    return sorted(names)

@app.get("/api/patients/lookup")
def lookup_patient(name: str):
    patients = load_patients()
    name = name.strip()
    # 完全符合
    if name in patients:
        return {"doctor": patients[name]}
    # 部分符合
    for pname, doctor in patients.items():
        if name in pname or pname in name:
            return {"doctor": doctor, "matched_name": pname}
    return {"doctor": None}

# ─── Appointment Routes ───────────────────────────────────────────────────────
@app.post("/api/appointments")
def create_appointment(appt: AppointmentCreate):
    try:
        service = get_calendar_service()

        start_dt = datetime.strptime(f"{appt.date} {appt.start_time}", "%Y-%m-%d %H:%M")
        end_dt   = datetime.strptime(f"{appt.date} {appt.end_time}",   "%Y-%m-%d %H:%M")

        update_patient_doctor(appt.patient_name, appt.doctor)
        event = {
            'summary': event_summary(appt.doctor, appt.patient_name, appt.visit_type, appt.complaint, appt.booker or ''),
            'description': (
                f"患者：{appt.patient_name}\n"
                f"電話：{appt.phone or '未提供'}\n"
                f"主訴：{appt.complaint}\n"
                f"類型：{appt.visit_type}"
            ),
            'start': {'dateTime': start_dt.isoformat(), 'timeZone': 'Asia/Taipei'},
            'end':   {'dateTime': end_dt.isoformat(),   'timeZone': 'Asia/Taipei'},
        }

        cal_id  = get_calendar_id(appt.doctor)
        created = service.events().insert(calendarId=cal_id, body=event).execute()
        return {
            "status": "success",
            "event_id": created.get('id'),
            "event_link": created.get('htmlLink'),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/appointments")
def get_appointments(date: str):
    try:
        service = get_calendar_service()

        day_start = datetime.strptime(date, "%Y-%m-%d")
        day_end   = day_start + timedelta(days=1)
        time_min  = day_start.isoformat() + '+08:00'
        time_max  = day_end.isoformat()   + '+08:00'

        all_events = []
        for cal_id in [CALENDAR_MAIN, CALENDAR_SU]:
            result = service.events().list(
                calendarId=cal_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy='startTime',
            ).execute()
            for ev in result.get('items', []):
                ev['_isSuCalendar'] = (cal_id == CALENDAR_SU)
                all_events.append(ev)

        # 依開始時間排序
        all_events.sort(key=lambda e: e.get('start', {}).get('dateTime', e.get('start', {}).get('date', '')))
        return all_events
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/appointments/range")
def get_appointments_range(start: str, end: str):
    try:
        service  = get_calendar_service()
        start_dt = datetime.strptime(start, "%Y-%m-%d")
        end_dt   = datetime.strptime(end,   "%Y-%m-%d") + timedelta(days=1)
        time_min = start_dt.isoformat() + '+08:00'
        time_max = end_dt.isoformat()   + '+08:00'

        all_events = []
        for cal_id in [CALENDAR_MAIN, CALENDAR_SU]:
            result = service.events().list(
                calendarId=cal_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy='startTime',
            ).execute()
            for ev in result.get('items', []):
                ev['_isSuCalendar'] = (cal_id == CALENDAR_SU)
                all_events.append(ev)

        all_events.sort(key=lambda e: e.get('start', {}).get('dateTime', e.get('start', {}).get('date', '')))
        return all_events
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search")
def search_appointments(q: str):
    try:
        service  = get_calendar_service()
        # 全部時間：從 2000 年到 2099 年
        time_min = "2000-01-01T00:00:00+08:00"
        time_max = "2099-12-31T23:59:59+08:00"

        all_events = []
        for cal_id in [CALENDAR_MAIN, CALENDAR_SU]:
            # Google Calendar API 分頁抓取
            page_token = None
            while True:
                result = service.events().list(
                    calendarId=cal_id,
                    timeMin=time_min,
                    timeMax=time_max,
                    singleEvents=True,
                    orderBy='startTime',
                    q=q,
                    pageToken=page_token,
                    maxResults=500,
                ).execute()
                for ev in result.get('items', []):
                    ev['_isSuCalendar'] = (cal_id == CALENDAR_SU)
                    all_events.append(ev)
                page_token = result.get('nextPageToken')
                if not page_token:
                    break

        all_events.sort(key=lambda e: e.get('start', {}).get('dateTime', e.get('start', {}).get('date', '')))
        # 同時回傳該關鍵字的異動紀錄
        history = load_history()
        matched_history = [h for h in history if q in h.get('summary', '')]
        return {"events": all_events, "history": matched_history}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.patch("/api/appointments/{event_id}")
def update_appointment(event_id: str, update: AppointmentUpdate):
    try:
        service  = get_calendar_service()
        start_dt = datetime.strptime(f"{update.date} {update.start_time}", "%Y-%m-%d %H:%M")
        end_dt   = datetime.strptime(f"{update.date} {update.end_time}",   "%Y-%m-%d %H:%M")

        # 找到活動在哪個日曆
        found_cal_id = None
        ev = None
        for cal_id in [CALENDAR_MAIN, CALENDAR_SU]:
            try:
                ev = service.events().get(calendarId=cal_id, eventId=event_id).execute()
                found_cal_id = cal_id
                break
            except Exception:
                continue
        if not ev:
            raise HTTPException(status_code=404, detail="找不到此約診")

        # 記錄時間異動
        old_s = datetime.fromisoformat(ev['start']['dateTime'].replace('+08:00',''))
        old_e = datetime.fromisoformat(ev['end']['dateTime'].replace('+08:00',''))
        log_time_change(event_id, ev.get('summary',''), old_s, old_e, start_dt, end_dt)

        # 只更新需要改的欄位（用 patch 而非 update/PUT，避免覆蓋其他內容）
        patch_body = {
            'start': {'dateTime': start_dt.isoformat(), 'timeZone': 'Asia/Taipei'},
            'end':   {'dateTime': end_dt.isoformat(),   'timeZone': 'Asia/Taipei'},
        }

        # 若有提供醫師或主訴，重建 summary，並更新 description 的主訴那行
        if update.doctor or update.complaint is not None:
            doctor    = update.doctor or ''
            new_cal_id = get_calendar_id(doctor) if doctor else found_cal_id

            if update.patient_name:
                # 保留原本 summary 中的約診者前綴（例：哲毅:）
                existing_booker = update.booker or ''
                if not existing_booker:
                    existing_summary = ev.get('summary', '')
                    if ': ' in existing_summary[:15]:
                        existing_booker = existing_summary.split(': ', 1)[0]

                # 主訴：前端傳來的優先，否則從 description 取
                complaint = update.complaint if update.complaint is not None else ''
                if not complaint:
                    desc_old = ev.get('description', '') or ''
                    m = re.search(r'主訴：([^\n]+)', desc_old)
                    if m:
                        complaint = m.group(1).strip()

                patch_body['summary'] = event_summary(
                    doctor or '未知醫師',
                    update.patient_name,
                    update.visit_type or '複診',
                    complaint,
                    existing_booker
                )

                # 同步更新 description 的 患者／主訴 行，其餘（電話、類型）不動
                existing_desc = ev.get('description', '') or ''
                new_desc = existing_desc
                if '患者：' in new_desc:
                    new_desc = re.sub(r'患者：[^\n]*', f'患者：{update.patient_name}', new_desc)
                if '主訴：' in new_desc:
                    new_desc = re.sub(r'主訴：[^\n]*', f'主訴：{complaint}', new_desc)
                elif complaint:
                    new_desc += (f'\n主訴：{complaint}' if new_desc else f'主訴：{complaint}')
                patch_body['description'] = new_desc

                if doctor:
                    update_patient_doctor(update.patient_name, doctor)

            if doctor and new_cal_id != found_cal_id:
                # 跨日曆：用完整 ev + patch_body 的欄位建立新事件
                full_ev = dict(ev)
                full_ev.update(patch_body)
                clean_ev = {k: v for k, v in full_ev.items()
                            if k not in ["id","etag","iCalUID","sequence","created","updated","htmlLink","organizer","creator"]}
                created = service.events().insert(calendarId=new_cal_id, body=clean_ev).execute()
                service.events().delete(calendarId=found_cal_id, eventId=event_id).execute()
                return {"status": "updated", "event_id": created.get('id'), "moved": True}

        # 同日曆：patch() 只改有在 patch_body 的欄位
        updated = service.events().patch(calendarId=found_cal_id, eventId=event_id, body=patch_body).execute()
        return {"status": "updated", "event_id": updated.get('id')}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/appointments/{event_id}")
def delete_appointment(event_id: str):
    try:
        service = get_calendar_service()
        for cal_id in [CALENDAR_MAIN, CALENDAR_SU]:
            try:
                # 先取得事件資料再刪除（供復原用）
                ev = service.events().get(calendarId=cal_id, eventId=event_id).execute()
                service.events().delete(calendarId=cal_id, eventId=event_id).execute()
                return {"status": "deleted", "event": ev, "calendar_id": cal_id}
            except Exception:
                continue
        raise HTTPException(status_code=404, detail="找不到此約診")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/appointments/restore")
def restore_appointment(body: dict):
    try:
        service = get_calendar_service()
        cal_id  = body.get("calendar_id", CALENDAR_MAIN)
        event   = body.get("event", {})
        # 移除唯讀欄位避免衝突
        for key in ["id", "etag", "iCalUID", "sequence", "created", "updated", "htmlLink", "organizer", "creator"]:
            event.pop(key, None)
        created = service.events().insert(calendarId=cal_id, body=event).execute()
        return {"status": "restored", "event_id": created.get("id")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Serve Frontend ───────────────────────────────────────────────────────────
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")
