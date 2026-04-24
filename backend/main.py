import os
import json
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
TOKEN_FILE       = os.path.join(BASE_DIR, 'token.json')
CREDENTIALS_FILE = os.path.join(BASE_DIR, 'credentials.json')

SCOPES = ['https://www.googleapis.com/auth/calendar']

# Google 行事曆 ID
CALENDAR_MAIN = 'd9a176ceee3179840a8bd7c3835585b068e1aa3b18ddbe4cf4a70e896c89fa72@group.calendar.google.com'  # 雅言診所
CALENDAR_SU   = 'd8893eed332dce19965d2f7b525b5bced33607830c13cee746bceca26322a98e@group.calendar.google.com'   # 雅言 Dr.蘇

def get_calendar_id(doctor: str) -> str:
    return CALENDAR_SU if '蘇' in doctor else CALENDAR_MAIN

def event_summary(doctor: str, patient: str, visit_type: str, complaint: str) -> str:
    np = 'NP ' if visit_type == '初診' else ''
    if '蘇' in doctor:
        return f"{np}{patient} {complaint}"
    surname = doctor.replace('醫師', '').strip()[0]
    return f"{np}Dr.{surname} {patient} {complaint}"

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="診所約診系統")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

class AppointmentUpdate(BaseModel):
    date: str        # YYYY-MM-DD
    start_time: str  # HH:MM
    end_time: str    # HH:MM

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

# ─── Appointment Routes ───────────────────────────────────────────────────────
@app.post("/api/appointments")
def create_appointment(appt: AppointmentCreate):
    try:
        service = get_calendar_service()

        start_dt = datetime.strptime(f"{appt.date} {appt.start_time}", "%Y-%m-%d %H:%M")
        end_dt   = datetime.strptime(f"{appt.date} {appt.end_time}",   "%Y-%m-%d %H:%M")

        event = {
            'summary': event_summary(appt.doctor, appt.patient_name, appt.visit_type, appt.complaint),
            'description': (
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
            all_events.extend(result.get('items', []))

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
            all_events.extend(result.get('items', []))

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
                all_events.extend(result.get('items', []))
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
        for cal_id in [CALENDAR_MAIN, CALENDAR_SU]:
            try:
                ev = service.events().get(calendarId=cal_id, eventId=event_id).execute()
                # 記錄時間異動
                old_s = datetime.fromisoformat(ev['start']['dateTime'].replace('+08:00',''))
                old_e = datetime.fromisoformat(ev['end']['dateTime'].replace('+08:00',''))
                log_time_change(event_id, ev.get('summary',''), old_s, old_e, start_dt, end_dt)
                ev['start'] = {'dateTime': start_dt.isoformat(), 'timeZone': 'Asia/Taipei'}
                ev['end']   = {'dateTime': end_dt.isoformat(),   'timeZone': 'Asia/Taipei'}
                updated = service.events().update(calendarId=cal_id, eventId=event_id, body=ev).execute()
                return {"status": "updated", "event_id": updated.get('id')}
            except Exception:
                continue
        raise HTTPException(status_code=404, detail="找不到此約診")
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
