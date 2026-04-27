'use strict';

const API = ''; // 自動使用當前網域，Mac localhost 或 ngrok 都能運作

let doctorsList     = [];
let bookersList     = [];
let selectedBooker  = '';
let allPatientNames = [];
let calYear         = new Date().getFullYear();
let calMonth        = new Date().getMonth(); // 0-indexed
let calEvents       = {};  // { 'YYYY-MM-DD': [events] }
let calSelectedDate = null;
let calView         = 'year'; // 'year' | 'month'

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDate();
  buildTimeSelects();
  fetchDoctors();
  fetchBookers();
  fetchPatientNames();
  initPatientAutocomplete();
  loadAppointments();

  document.getElementById('appointmentForm').addEventListener('submit', handleSubmit);
  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });
  document.getElementById('newDoctorName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addDoctor(); }
  });
  document.getElementById('newBookerName').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addBooker(); }
  });
  document.getElementById('startTime').addEventListener('change', updateEndOptions);
  document.getElementById('endTime').addEventListener('change', updateDurationBadge);

  // 患者姓名自動提示上次醫師
  let patientLookupTimer = null;
  document.getElementById('patientName').addEventListener('input', () => {
    clearTimeout(patientLookupTimer);
    const name = document.getElementById('patientName').value.trim();
    if (name.length < 2) { hidePatientHint(); return; }
    patientLookupTimer = setTimeout(() => lookupPatientDoctor(name), 500);
  });
  document.getElementById('patientName').addEventListener('blur', () => {
    const name = document.getElementById('patientName').value.trim();
    if (name.length >= 2) lookupPatientDoctor(name);
  });
});

// ─── Tab ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.remove('hidden');
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'calendar') renderCalendar();
}

// ─── Date ─────────────────────────────────────────────────────────────────────
function initDate() {
  const input = document.getElementById('date');
  input.value = localDateStr(new Date());
  input.addEventListener('change', () => { updateApptCardTitle(); loadAppointments(); });

  document.getElementById('todayDisplay').textContent =
    new Date().toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'long' });
}

function localDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

function updateApptCardTitle() {
  const date  = document.getElementById('date').value;
  const today = localDateStr(new Date());
  document.getElementById('apptCardTitle').textContent = date === today ? '今日約診' : `${date} 約診`;
}

// ─── Time Inputs ──────────────────────────────────────────────────────────────
// 顯示 09:00 – 22:00，每 15 分鐘一格
function timeSlots(fromH = 9, toH = 22) {
  const slots = [];
  for (let h = fromH; h <= toH; h++)
    for (let m = 0; m < 60; m += 15) {
      if (h === toH && m > 0) break;
      slots.push(`${pad(h)}:${pad(m)}`);
    }
  return slots;
}

function buildTimeSelects() {
  const all = timeSlots();
  fillDatalist('startTimeList', all);
  fillDatalist('endTimeList',   all);

  const startEl = document.getElementById('startTime');
  const endEl   = document.getElementById('endTime');

  startEl.addEventListener('input',  updateDurationBadge);
  startEl.addEventListener('change', () => { formatTimeInput(startEl); updateEndOptions(); updateDurationBadge(); });
  endEl.addEventListener('input',    updateDurationBadge);
  endEl.addEventListener('change',   () => { formatTimeInput(endEl);   updateDurationBadge(); });
}

function updateEndOptions() {
  const startRaw = document.getElementById('startTime').value.trim();
  const [sh, sm] = parseTime(startRaw);
  const all = timeSlots();
  if (sh === null) {
    fillDatalist('endTimeList', all);
    return;
  }
  const startMins = sh * 60 + sm;
  const filtered  = all.filter(t => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m > startMins;
  });
  fillDatalist('endTimeList', filtered.length ? filtered : all);
}

function fillDatalist(id, slots) {
  const dl = document.getElementById(id);
  dl.innerHTML = '';
  slots.forEach(t => {
    const o = document.createElement('option');
    o.value = t;
    dl.appendChild(o);
  });
}

// 自動補齊格式：輸入 "930" → "09:30"，"9" → "09:00"
function formatTimeInput(el) {
  const raw = el.value.trim().replace('：', ':');
  const [h, m] = parseTime(raw);
  if (h !== null) el.value = `${pad(h)}:${pad(m)}`;
}

function parseTime(str) {
  if (!str) return [null, null];
  const clean = str.replace(/[：\s]/g, ':');
  const m1 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (m1) return [parseInt(m1[1]), parseInt(m1[2])];
  const m2 = clean.match(/^(\d{3,4})$/);
  if (m2) {
    const s = m2[1].padStart(4, '0');
    return [parseInt(s.slice(0,2)), parseInt(s.slice(2))];
  }
  const m3 = clean.match(/^(\d{1,2})$/);
  if (m3) return [parseInt(m3[1]), 0];
  return [null, null];
}

function updateDurationBadge() {
  const start = document.getElementById('startTime').value.trim();
  const end   = document.getElementById('endTime').value.trim();
  const badge = document.getElementById('durationBadge');
  const [sh, sm] = parseTime(start);
  const [eh, em] = parseTime(end);
  if (sh === null || eh === null) { badge.style.display = 'none'; return; }
  const mins = (eh*60+em) - (sh*60+sm);
  if (mins <= 0) { badge.style.display = 'none'; return; }
  const h = Math.floor(mins/60), m = mins%60;
  badge.textContent = `⏱ 看診時長：${h > 0 ? (m > 0 ? `${h} 小時 ${m} 分鐘` : `${h} 小時`) : `${m} 分鐘`}`;
  badge.style.display = 'inline-block';
}

// ─── Doctors ──────────────────────────────────────────────────────────────────
async function fetchDoctors() {
  try {
    const res = await fetch(`${API}/api/doctors`);
    doctorsList = await res.json();
    renderDoctorSelect();
    renderDoctorsPanel();
    buildCalLegend();
  } catch { showToast('無法連接伺服器，請確認後端已啟動', true); }
}

// 動態產生日曆圖例（跟著 doctorsList 走）
function buildCalLegend() {
  const legend = document.querySelector('.cal-legend');
  if (!legend) return;
  legend.innerHTML = '';
  doctorsList.forEach(doc => {
    const surname = doc.name.replace('醫師','').trim()[0];
    const col = getDocColor(doc);
    const span = document.createElement('span');
    span.className = 'chip';
    span.style.background = col.bg;
    span.style.color = '#fff';
    span.textContent = `Dr.${surname}`;
    legend.appendChild(span);
  });
  const np = document.createElement('span');
  np.className = 'chip chip-np';
  np.style.marginLeft = '8px';
  np.textContent = 'NP 初診';
  legend.appendChild(np);
}

function renderDoctorSelect() {
  const sel = document.getElementById('doctor');
  sel.innerHTML = '<option value="">請選擇醫師</option>';
  doctorsList.forEach(d => {
    const o = document.createElement('option');
    o.value = d.name; o.textContent = d.name;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    const found = doctorsList.find(d => d.name === sel.value);
    const badge = document.getElementById('doctorNote');
    const text  = document.getElementById('doctorNoteText');
    if (found && found.note) {
      text.textContent = found.note;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  };
}

function renderDoctorsPanel() {
  const list = document.getElementById('doctorsList');
  list.innerHTML = '';
  if (!doctorsList.length) { list.innerHTML = '<p class="placeholder-text">尚無醫師資料</p>'; return; }
  doctorsList.forEach(d => {
    const row = document.createElement('div');
    row.className = 'doctor-item';
    row.innerHTML = `
      <div class="doctor-item-top">
        <div class="doctor-name-row">
          <div class="doctor-dot" style="background:${getDocColor(d).bg};"></div>
          <span>${escHtml(d.name)}</span>
        </div>
        <button class="btn-danger-sm" onclick="deleteDoctor('${d.id}','${escHtml(d.name)}')">移除</button>
      </div>
      <div class="doctor-item-note">
        <span>📋</span>
        <input type="text" id="note-${d.id}" value="${escHtml(d.note || '')}" placeholder="新增備注（如：週五午晚診）" />
        <button class="btn-note-save" onclick="saveNote('${d.id}')">儲存</button>
      </div>`;
    list.appendChild(row);
  });
}

async function saveNote(id) {
  const note = document.getElementById(`note-${id}`).value.trim();
  try {
    await fetch(`${API}/api/doctors/${id}/note`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    const doc = doctorsList.find(d => d.id === id);
    if (doc) doc.note = note;
    // 更新選單備注
    const sel = document.getElementById('doctor');
    if (sel.value === doc?.name) {
      const badge = document.getElementById('doctorNote');
      const text  = document.getElementById('doctorNoteText');
      if (note) { text.textContent = note; badge.style.display = 'flex'; }
      else badge.style.display = 'none';
    }
    showToast('備注已儲存', false);
  } catch { showToast('儲存失敗', true); }
}

async function addDoctor() {
  const input = document.getElementById('newDoctorName');
  const name  = input.value.trim();
  if (!name) return;
  try {
    const res = await fetch(`${API}/api/doctors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error();
    input.value = '';
    await fetchDoctors();
    showToast(`已新增 ${name}`, false);
  } catch { showToast('新增失敗', true); }
}

async function deleteDoctor(id, name) {
  if (!confirm(`確定要移除「${name}」？`)) return;
  try {
    await fetch(`${API}/api/doctors/${id}`, { method: 'DELETE' });
    await fetchDoctors();
  } catch { showToast('移除失敗', true); }
}

// ─── Patient Autocomplete ─────────────────────────────────────────────────────
async function fetchPatientNames() {
  try {
    const res = await fetch(`${API}/api/patients`);
    allPatientNames = await res.json();
  } catch {}
}

function initPatientAutocomplete() {
  const input = document.getElementById('patientName');
  if (!input) return;

  // 建立下拉容器
  const wrap = input.parentNode;
  wrap.style.position = 'relative';
  const dropdown = document.createElement('div');
  dropdown.id = 'patientAutocomplete';
  dropdown.className = 'autocomplete-dropdown';
  wrap.appendChild(dropdown);

  let suggestTimer    = null;
  let suggestCtrl     = null;   // AbortController

  async function showSuggestions(q) {
    if (!q) { dropdown.style.display = 'none'; return; }

    // 取消上一個尚未完成的請求
    if (suggestCtrl) suggestCtrl.abort();
    suggestCtrl = new AbortController();

    try {
      const res   = await fetch(
        `${API}/api/patients/suggest?q=${encodeURIComponent(q)}`,
        { signal: suggestCtrl.signal }
      );
      const names = await res.json();
      if (!names.length) { dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = names.map(name => {
        const escaped = escHtml(name);
        // 高亮匹配字元
        const hi = escaped.replace(escHtml(q), `<mark>${escHtml(q)}</mark>`);
        return `<div class="autocomplete-item" onmousedown="selectPatientName('${escaped}')">${hi}</div>`;
      }).join('');
      dropdown.style.display = 'block';
    } catch (err) {
      if (err.name !== 'AbortError') dropdown.style.display = 'none';
    }
  }

  // 輸入時：debounce 300ms 後送出查詢
  input.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const q = input.value.trim();
    if (!q) { dropdown.style.display = 'none'; return; }
    suggestTimer = setTimeout(() => showSuggestions(q), 300);
  });

  // 重新 focus 時：若有輸入立即顯示
  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q) showSuggestions(q);
  });

  // 失焦時延遲隱藏（讓 mousedown 先觸發）
  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 200);
  });

  // 鍵盤上下選擇
  input.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    if (!items.length) return;
    const active = dropdown.querySelector('.autocomplete-item.active');
    let idx = Array.from(items).indexOf(active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      items[(idx + 1) % items.length].classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) active.classList.remove('active');
      items[(idx - 1 + items.length) % items.length].classList.add('active');
    } else if (e.key === 'Enter') {
      if (active) { e.preventDefault(); active.dispatchEvent(new Event('mousedown')); }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });
}

function selectPatientName(name) {
  const input = document.getElementById('patientName');
  if (input) input.value = name;
  const dropdown = document.getElementById('patientAutocomplete');
  if (dropdown) dropdown.style.display = 'none';
  lookupPatientDoctor(name);
}

// ─── Patient Doctor Hint ──────────────────────────────────────────────────────
async function lookupPatientDoctor(name) {
  try {
    const res  = await fetch(`${API}/api/patients/lookup?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (data.doctor) {
      showPatientHint(data.doctor, data.matched_name);
    } else {
      hidePatientHint();
    }
  } catch { hidePatientHint(); }
}

function showPatientHint(doctor, matchedName) {
  let hint = document.getElementById('patientDoctorHint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'patientDoctorHint';
    hint.className = 'patient-hint';
    document.getElementById('patientName').parentNode.appendChild(hint);
  }
  const label = matchedName ? `（${matchedName}）` : '';
  hint.innerHTML = `
    <span>📌 上次看診醫師${label}：<strong>${escHtml(doctor)}</strong></span>
    <button type="button" onclick="applyPatientDoctor('${escHtml(doctor)}')">套用</button>`;
  hint.style.display = 'flex';
}

function hidePatientHint() {
  const hint = document.getElementById('patientDoctorHint');
  if (hint) hint.style.display = 'none';
}

function applyPatientDoctor(doctorName) {
  const sel = document.getElementById('doctor');
  if (sel) {
    sel.value = doctorName;
    sel.dispatchEvent(new Event('change'));
  }
  hidePatientHint();
}

// ─── Bookers ──────────────────────────────────────────────────────────────────
async function fetchBookers() {
  try {
    const res = await fetch(`${API}/api/bookers`);
    bookersList = await res.json();
    renderBookerChips();
  } catch {}
}

function renderBookerChips() {
  const container = document.getElementById('bookerChips');
  if (!container) return;
  container.innerHTML = '';
  bookersList.forEach(b => {
    const chip = document.createElement('div');
    chip.className = 'booker-chip' + (selectedBooker === b.name ? ' active' : '');

    const label = document.createElement('span');
    label.textContent = b.name;
    label.onclick = () => {
      selectedBooker = selectedBooker === b.name ? '' : b.name;
      renderBookerChips();
    };

    const x = document.createElement('span');
    x.className = 'booker-chip-x';
    x.textContent = '✕';
    x.title = '移除';
    x.onclick = e => { e.stopPropagation(); deleteBooker(b.id, b.name); };

    chip.appendChild(label);
    chip.appendChild(x);
    container.appendChild(chip);
  });
}

async function addBooker() {
  const input = document.getElementById('newBookerName');
  const name  = input.value.trim();
  if (!name) return;
  try {
    const res = await fetch(`${API}/api/bookers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error();
    input.value = '';
    await fetchBookers();
  } catch { showToast('新增失敗', true); }
}

async function deleteBooker(id, name) {
  if (!confirm(`確定要移除「${name}」？`)) return;
  try {
    await fetch(`${API}/api/bookers/${id}`, { method: 'DELETE' });
    if (selectedBooker === name) selectedBooker = '';
    await fetchBookers();
  } catch { showToast('移除失敗', true); }
}

// ─── Appointments (日列表) ─────────────────────────────────────────────────────
async function loadAppointments() {
  const date = document.getElementById('date').value;
  const list = document.getElementById('appointmentsList');
  list.innerHTML = '<p class="placeholder-text">載入中…</p>';
  updateApptCardTitle();
  try {
    const res    = await fetch(`${API}/api/appointments?date=${date}`);
    const events = await res.json();
    renderAppointments(events, list);
  } catch {
    list.innerHTML = '<p class="placeholder-text">（請確認後端已啟動並完成 Google 授權）</p>';
  }
}

function renderAppointments(events, container) {
  if (!events || !events.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:28px 0;">
        <p class="placeholder-text" style="margin-bottom:14px;">此日尚無約診記錄</p>
        <button class="btn-add-appt" onclick="focusForm()">＋ 新增約診</button>
      </div>`;
    return;
  }
  // 快取事件資料供修改/刪除查詢
  events.forEach(ev => { if (ev.id) eventsCache[ev.id] = ev; });

  container.innerHTML = events.map(ev => {
    const start = ev.start?.dateTime
      ? new Date(ev.start.dateTime).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false })
      : '--:--';
    const end = ev.end?.dateTime
      ? new Date(ev.end.dateTime).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false })
      : '';
    const timeLabel = end ? `${start} – ${end}` : start;
    const desc      = (ev.description || '').replace(/\n/g, '  ·  ');
    const summary  = ev.summary || '';
    const doc      = getDocFromSummary(summary, ev);
    const col      = getDocColor(doc);
    const drLabel  = getDocLabel(doc);
    return `
      <div class="appt-item" style="border-left-color:${col.bg};background:${col.light};">
        <div class="appt-time-col">
          <div class="appt-time" style="color:${col.bg};">${timeLabel}</div>
          <span class="appt-dr-tag" style="background:${col.bg};">${drLabel}</span>
        </div>
        <div class="appt-body">
          <div class="appt-title">${escHtml(summary)}</div>
          <div class="appt-meta">${escHtml(desc)}</div>
        </div>
        <div class="appt-actions">
          <button class="btn-edit-sm" onclick="editAppointment('${ev.id}')">✏️ 修改</button>
          <button class="btn-danger-sm" onclick="cancelAppointment('${ev.id}','${escHtml(summary)}')">取消</button>
        </div>
      </div>`;
  }).join('');
}

let lastDeleted  = null; // { event, calendar_id }
let eventsCache  = {}; // eventId → event object

// ─── 動態醫師調色盤（無限擴充）─────────────────────────────────────────────
const DOCTOR_PALETTE = [
  { bg:'#1a6b8a', light:'#eef6fb' }, // 0 藍
  { bg:'#a03368', light:'#fcedf5' }, // 1 粉紅
  { bg:'#2d7a4a', light:'#edf7f0' }, // 2 綠
  { bg:'#c07020', light:'#fdf3e6' }, // 3 橘
  { bg:'#6a3d9a', light:'#f3eef9' }, // 4 紫
  { bg:'#c03030', light:'#fdf0f0' }, // 5 紅
  { bg:'#1a7a6e', light:'#edf8f6' }, // 6 青
  { bg:'#8a7010', light:'#f8f6e8' }, // 7 黃
  { bg:'#3a3a8a', light:'#eeedf8' }, // 8 靛
  { bg:'#8a2050', light:'#f9edf3' }, // 9 莓
  { bg:'#3a6a1a', light:'#edf6ea' }, // 10 深綠
  { bg:'#8a5020', light:'#f8f2e8' }, // 11 棕
];

// 由事件摘要找到對應醫師物件（動態比對 doctorsList 中所有醫師姓氏）
// ev 為完整事件物件（可選），用於讀取 _isSuCalendar 旗標
function getDocFromSummary(summary, ev) {
  // 若是蘇醫師日曆的活動，直接返回包含「蘇」的醫師
  if (ev?._isSuCalendar) {
    return doctorsList.find(d => d.name.includes('蘇')) || null;
  }
  // 依 Dr.姓 格式比對
  for (const doc of doctorsList) {
    const surname = doc.name.replace('醫師','').trim()[0];
    if (new RegExp(`dr[.．]?${surname}`, 'i').test(summary) ||
        summary.includes(doc.name.replace('醫師','').trim())) {
      return doc;
    }
  }
  // CALENDAR_MAIN 無法比對到醫師 → 不亂猜，回傳 null（顯示中性灰色）
  return null;
}

const DOC_UNKNOWN_COLOR = { bg: '#9a9a9a', light: '#f4f4f4' }; // 灰色：找不到醫師時用

function getDocColor(doc) {
  if (!doc) return DOC_UNKNOWN_COLOR;
  const idx = (doc?.colorIndex ?? 0);
  return DOCTOR_PALETTE[idx % DOCTOR_PALETTE.length];
}
function getDocLabel(doc) {
  if (!doc) return '?';
  const surname = doc.name.replace('醫師','').trim()[0];
  return `Dr.${surname}`;
}
let undoTimer   = null;
const UNDO_SECS = 8;

function cancelAppointment(eventId, summary) {
  showConfirm(
    '確定要取消此約診？',
    summary,
    async () => {
      try {
        const res    = await fetch(`${API}/api/appointments/${eventId}`, { method: 'DELETE' });
        const result = await res.json();
        if (!res.ok) throw new Error(result.detail);
        lastDeleted = { event: result.event, calendar_id: result.calendar_id };
        await reloadAllViews();
        showUndoToast(summary);
      } catch (e) { showToast('取消失敗：' + e.message, true); }
    }
  );
}

async function undoDelete() {
  if (!lastDeleted) return;
  hideUndoToast();
  try {
    const res = await fetch(`${API}/api/appointments/restore`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(lastDeleted),
    });
    if (!res.ok) throw new Error();
    lastDeleted = null;
    await reloadAllViews();
    showToast('✅ 已成功復原', false);
  } catch { showToast('復原失敗，請重新新增', true); }
}

// ─── Edit Appointment ─────────────────────────────────────────────────────────
function getPatientNameFromEvent(ev) {
  // 先從 description 的「患者：」行取
  const desc = ev.description || '';
  const m = desc.match(/患者：(.+)/);
  if (m) return m[1].trim();
  // 退路：從 summary 解析
  let s = ev.summary || '';
  if (s.includes(': ')) s = s.split(': ').slice(1).join(': ');
  if (s.startsWith('NP ')) s = s.slice(3);
  s = s.replace(/^Dr\.\S+\s+/, '');
  return s.split(' ')[0] || '';
}

function getEventMeta(ev) {
  const desc = ev.description || '';
  const vt = (desc.match(/類型：(.+)/) || [])[1]?.trim() || '複診';
  const cp = (desc.match(/主訴：(.+)/) || [])[1]?.trim() || '';
  return { visit_type: vt, complaint: cp };
}

function editAppointment(eventId) {
  const ev = eventsCache[eventId];
  if (!ev) { showToast('找不到約診資料', true); return; }
  const dateStr  = ev.start?.dateTime ? ev.start.dateTime.slice(0, 10) : localDateStr(new Date());
  const startDT  = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
  const endDT    = ev.end?.dateTime   ? new Date(ev.end.dateTime)   : null;
  const startVal = startDT ? `${pad(startDT.getHours())}:${pad(startDT.getMinutes())}` : '';
  const endVal   = endDT   ? `${pad(endDT.getHours())}:${pad(endDT.getMinutes())}`   : '';

  // 判斷當前醫師
  const currentDoc = getDocFromSummary(ev.summary || '', ev);
  const currentDocName = currentDoc?.name || '';

  // 醫師選單 options
  const doctorOptions = doctorsList.map(d =>
    `<option value="${escHtml(d.name)}" ${d.name === currentDocName ? 'selected' : ''}>${escHtml(d.name)}</option>`
  ).join('');

  const box = document.querySelector('.modal-box');
  const all = timeSlots();
  box.innerHTML = `
    <div class="edit-box">
      <h4>✏️ 修改約診</h4>
      <p class="edit-summary">${escHtml(ev.summary || '')}</p>
      <div class="edit-fields">
        <div class="edit-row">
          <label class="field-label">日期</label>
          <input type="date" id="editDate" value="${dateStr}" />
        </div>
        <div class="edit-row">
          <label class="field-label">開始時間</label>
          <input type="text" id="editStart" value="${startVal}"
                 list="editStartList" maxlength="5" placeholder="09:00" autocomplete="off" />
          <datalist id="editStartList"></datalist>
        </div>
        <div class="edit-row">
          <label class="field-label">結束時間</label>
          <input type="text" id="editEnd" value="${endVal}"
                 list="editEndList" maxlength="5" placeholder="09:30" autocomplete="off" />
          <datalist id="editEndList"></datalist>
        </div>
        <div class="edit-row">
          <label class="field-label">主治醫師</label>
          <select id="editDoctor">
            <option value="">（不變更）</option>
            ${doctorOptions}
          </select>
        </div>
      </div>
      <div class="confirm-actions">
        <button class="btn-cancel-no" onclick="closeModal()">取消</button>
        <button class="btn-primary" id="editSaveBtn"
                style="padding:9px 28px;font-size:13px;"
                onclick="saveEditedAppointment('${eventId}')">儲存</button>
      </div>
    </div>`;

  // 填入時間選項
  ['editStartList','editEndList'].forEach(id => {
    const dl = document.getElementById(id);
    all.forEach(t => { const o = document.createElement('option'); o.value = t; dl.appendChild(o); });
  });
  document.getElementById('successModal').classList.add('open');
}

async function saveEditedAppointment(eventId) {
  const date   = document.getElementById('editDate').value;
  const start  = document.getElementById('editStart').value.trim();
  const end    = document.getElementById('editEnd').value.trim();
  const newDoc = document.getElementById('editDoctor')?.value || '';
  const [sh, sm] = parseTime(start);
  const [eh, em] = parseTime(end);
  if (!date)                { showToast('請選擇日期', true); return; }
  if (sh === null)          { showToast('請輸入正確的開始時間（例：09:00）', true); return; }
  if (eh === null)          { showToast('請輸入正確的結束時間（例：09:30）', true); return; }
  if (eh*60+em <= sh*60+sm) { showToast('結束時間必須晚於開始時間', true); return; }

  const ev = eventsCache[eventId] || {};
  const payload = {
    date,
    start_time: `${pad(sh)}:${pad(sm)}`,
    end_time:   `${pad(eh)}:${pad(em)}`,
  };

  // 若有變更醫師，加入重建 summary 需要的資訊
  if (newDoc) {
    const meta = getEventMeta(ev);
    payload.doctor       = newDoc;
    payload.patient_name = getPatientNameFromEvent(ev);
    payload.visit_type   = meta.visit_type;
    payload.complaint    = meta.complaint;
  }

  const btn = document.getElementById('editSaveBtn');
  btn.disabled = true; btn.textContent = '儲存中…';
  try {
    const res = await fetch(`${API}/api/appointments/${eventId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) { const r = await res.json(); throw new Error(r.detail); }
    const result = await res.json();

    closeModal();
    showToast(newDoc ? `✅ 已更新（醫師改為 ${newDoc}）` : '✅ 時間已更新', false);

    // 跨日曆搬移需等 Google Calendar 傳播後再重載，同日曆直接重載
    if (result.moved) {
      btn.textContent = '更新中…';
      await new Promise(r => setTimeout(r, 2000));
    }

    await reloadAllViews();
  } catch(e) {
    showToast('更新失敗：' + e.message, true);
    btn.disabled = false; btn.textContent = '儲存';
  }
}

function showUndoToast(summary) {
  clearTimeout(undoTimer);
  const toast = document.getElementById('undoToast');
  const fill  = document.getElementById('undoBarFill');
  toast.classList.add('show');
  fill.style.transition = 'none';
  fill.style.width = '100%';
  // 觸發 reflow 讓 transition 重置
  fill.offsetWidth;
  fill.style.transition = `width ${UNDO_SECS}s linear`;
  fill.style.width = '0%';
  undoTimer = setTimeout(() => {
    hideUndoToast();
    lastDeleted = null;
  }, UNDO_SECS * 1000);
}

function hideUndoToast() {
  clearTimeout(undoTimer);
  document.getElementById('undoToast').classList.remove('show');
}

// ─── Form ─────────────────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const startRaw = document.getElementById('startTime').value.trim();
  const endRaw   = document.getElementById('endTime').value.trim();
  const doctor   = document.getElementById('doctor').value;
  const [sh, sm] = parseTime(startRaw);
  const [eh, em] = parseTime(endRaw);
  if (sh === null)           { showToast('請輸入正確的開始時間（例：09:00）', true); return; }
  if (eh === null)           { showToast('請輸入正確的結束時間（例：09:30）', true); return; }
  if (eh*60+em <= sh*60+sm) { showToast('結束時間必須晚於開始時間', true); return; }
  if (!doctor)               { showToast('請選擇醫師', true); return; }
  const start = `${pad(sh)}:${pad(sm)}`;
  const end   = `${pad(eh)}:${pad(em)}`;

  const visitType = document.querySelector('input[name="visitType"]:checked').value;
  const payload   = {
    patient_name: document.getElementById('patientName').value.trim(),
    phone:        document.getElementById('phone').value.trim() || null,
    doctor, date: document.getElementById('date').value,
    start_time: start, end_time: end,
    complaint:  document.getElementById('complaint').value.trim(),
    visit_type: visitType,
    booker:     selectedBooker || null,
  };

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = '處理中…';
  try {
    const res    = await fetch(`${API}/api/appointments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok) { showToast('錯誤：' + (result.detail || '約診失敗'), true); return; }
    showSuccess(payload);
    resetForm();
    await loadAppointments();
    fetchPatientNames(); // 更新患者自動完成名單
  } catch { showToast('無法連接伺服器', true); }
  finally { btn.disabled = false; btn.textContent = '📅 確認約診並加入 Google 日曆'; }
}

function resetForm() {
  ['patientName','phone','complaint','startTime','endTime'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('durationBadge').style.display = 'none';
  fillDatalist('endTimeList', timeSlots());
  document.getElementById('doctor').value = '';
  document.querySelector('input[name="visitType"][value="初診"]').checked = true;
  selectedBooker = '';
  renderBookerChips();
  hidePatientHint();
}

function focusForm() {
  switchTab('form');
  const panel = document.querySelector('.form-panel');
  setTimeout(() => {
    panel.scrollIntoView({ behavior:'smooth', block:'start' });
    panel.classList.add('highlight');
    setTimeout(() => panel.classList.remove('highlight'), 1500);
    setTimeout(() => document.getElementById('patientName').focus(), 400);
  }, 100);
}

function goAddForDate() {
  switchTab('form');
  if (calSelectedDate) {
    setTimeout(() => {
      document.getElementById('date').value = calSelectedDate;
      updateApptCardTitle();
      loadAppointments();
      document.querySelector('.form-panel').scrollIntoView({ behavior:'smooth' });
      document.getElementById('patientName').focus();
    }, 100);
  }
}

// ─── Reload All Views ─────────────────────────────────────────────────────────
async function reloadAllViews() {
  // 重載今日約診列表
  await loadAppointments();
  // 重載月曆選取日期的詳情 + 更新月曆格子
  if (calSelectedDate) await loadCalendarDay(calSelectedDate);
  // 若月曆 tab 開著但沒有選取日期，也重新渲染整個月曆
  const calTab = document.getElementById('view-calendar');
  if (calTab && !calTab.classList.contains('hidden') && !calSelectedDate) {
    await renderCalendar();
  }
}

// ─── Search ───────────────────────────────────────────────────────────────────
let searchTimer = null;

async function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  const results = document.getElementById('searchResults');
  if (!q) { results.innerHTML = '<p class="placeholder-text">請輸入搜尋關鍵字</p>'; return; }

  results.innerHTML = '<p class="placeholder-text">搜尋中…</p>';
  try {
    const res  = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    const events  = data.events  || [];
    const history = data.history || [];

    if (!events.length && !history.length) {
      results.innerHTML = `<p class="placeholder-text">找不到「${escHtml(q)}」的相關約診</p>`;
      return;
    }
    events.forEach(ev => { if (ev.id) eventsCache[ev.id] = ev; });

    // 建立 event_id → history 的對應
    const histMap = {};
    history.forEach(h => {
      if (!histMap[h.event_id]) histMap[h.event_id] = [];
      histMap[h.event_id].push(h);
    });

    const apptHtml = events.map(ev => {
      const dt        = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
      const dateLabel = dt ? dt.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'short' }) : '–';
      const start     = dt ? dt.toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false }) : '';
      const endDt     = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
      const end       = endDt ? endDt.toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false }) : '';
      const timeLabel = start && end ? `${start} – ${end}` : start;
      const summary   = ev.summary || '';
      const desc      = (ev.description || '').replace(/\n/g, '  ·  ');
      const doc       = getDocFromSummary(summary, ev);
      const col       = getDocColor(doc);
      const drLabel   = getDocLabel(doc);

      // 異動紀錄區塊
      const logs = histMap[ev.id] || [];
      const histHtml = logs.length ? `
        <div class="history-block">
          <div class="history-title">📝 時間異動紀錄（共 ${logs.length} 次）</div>
          ${logs.map(h => `
            <div class="history-row">
              <span class="history-time">${h.changed_at}</span>
              <span class="history-arrow">
                ${h.old_date} ${h.old_start}–${h.old_end}
                <span class="arr">→</span>
                ${h.new_date} ${h.new_start}–${h.new_end}
              </span>
            </div>`).join('')}
        </div>` : '';

      return `
        <div class="search-appt-block">
          <div class="appt-item" style="border-left-color:${col.bg};background:${col.light};">
            <div class="appt-time-col">
              <div class="search-date">${dateLabel}</div>
              <div class="appt-time" style="color:${col.bg};">${timeLabel}</div>
              <span class="appt-dr-tag" style="background:${col.bg};">${drLabel}</span>
            </div>
            <div class="appt-body">
              <div class="appt-title">${escHtml(summary)}</div>
              <div class="appt-meta">${escHtml(desc)}</div>
            </div>
            <div class="appt-actions">
              <button class="btn-edit-sm" onclick="editAppointment('${ev.id}')">✏️ 修改</button>
              <button class="btn-danger-sm" onclick="cancelAppointmentFromSearch('${ev.id}','${escHtml(summary)}')">取消</button>
            </div>
          </div>
          ${histHtml}
        </div>`;
    }).join('');

    results.innerHTML = `
      <div class="search-count">共找到 ${events.length} 筆約診${history.length ? `，${history.length} 筆異動紀錄` : ''}</div>
      ${apptHtml}`;
  } catch(e) { results.innerHTML = '<p class="placeholder-text">搜尋失敗，請確認後端已啟動</p>'; }
}

function cancelAppointmentFromSearch(eventId, summary) {
  showConfirm('確定要取消此約診？', summary, async () => {
    try {
      const res    = await fetch(`/api/appointments/${eventId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail);
      lastDeleted = { event: result.event, calendar_id: result.calendar_id };
      showUndoToast(summary);
      doSearch(); // 重新搜尋更新結果
    } catch(e) { showToast('取消失敗：' + e.message, true); }
  });
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function setCalView(view) {
  calView = view;
  document.getElementById('btn-year').classList.toggle('active',  view === 'year');
  document.getElementById('btn-month').classList.toggle('active', view === 'month');
  document.getElementById('calMonthView').classList.toggle('hidden', view === 'year');
  document.getElementById('calYearView').classList.toggle('hidden',  view === 'month');
  renderCalendar();
}

function calNavPrev() {
  if (calView === 'year') { calYear--; renderCalendar(); }
  else changeMonth(-1);
}
function calNavNext() {
  if (calView === 'year') { calYear++; renderCalendar(); }
  else changeMonth(1);
}

async function renderCalendar() {
  if (calView === 'year') {
    document.getElementById('calMonthTitle').textContent = `${calYear} 年`;
    await renderYearCalendar();
  } else {
    document.getElementById('calMonthTitle').textContent = `${calYear} 年 ${calMonth + 1} 月`;
    await renderMonthCalendar();
  }
}

// ── 年視圖 ────────────────────────────────────────────────────────────────────
async function renderYearCalendar() {
  const yearGrid = document.getElementById('yearGrid');
  yearGrid.innerHTML = '<p class="placeholder-text" style="grid-column:1/-1">載入中…</p>';

  // 抓全年資料
  try {
    const res    = await fetch(`${API}/api/appointments/range?start=${calYear}-01-01&end=${calYear}-12-31`);
    const events = await res.json();
    calEvents = groupByDate(events);
  } catch { calEvents = {}; }

  yearGrid.innerHTML = '';
  const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  for (let m = 0; m < 12; m++) {
    const miniEl = document.createElement('div');
    miniEl.className = 'mini-month';

    // 月份標題 → 點擊切換到月視圖
    const titleEl = document.createElement('div');
    titleEl.className = 'mini-month-title';
    titleEl.textContent = MONTHS[m];
    titleEl.addEventListener('click', () => {
      calMonth = m;
      setCalView('month');
    });

    // 星期標題
    const wdEl = document.createElement('div');
    wdEl.className = 'mini-weekdays';
    ['日','一','二','三','四','五','六'].forEach(w => {
      const s = document.createElement('span'); s.textContent = w;
      wdEl.appendChild(s);
    });

    // 日期格
    const gridEl  = document.createElement('div');
    gridEl.className = 'mini-grid';
    const firstDay = new Date(calYear, m, 1);
    const lastDay  = new Date(calYear, m + 1, 0);
    const today    = localDateStr(new Date());
    const dow0     = firstDay.getDay();

    for (let i = 0; i < dow0; i++) {
      const b = document.createElement('div');
      b.className = 'mini-day other-month';
      gridEl.appendChild(b);
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${calYear}-${pad(m+1)}-${pad(d)}`;
      const dow     = new Date(calYear, m, d).getDay();
      const evs     = calEvents[dateStr] || [];

      const cell = document.createElement('div');
      cell.className = 'mini-day';
      if (dateStr === today)           cell.classList.add('today');
      if (dateStr === calSelectedDate) cell.classList.add('selected');
      if (dow === 0)  cell.classList.add('sunday');
      if (dow === 6)  cell.classList.add('saturday');

      const numEl = document.createElement('div');
      numEl.className   = 'mini-day-num';
      numEl.textContent = d;
      cell.appendChild(numEl);

      // 彩色小點 + 剩餘時間
      if (evs.length > 0) {
        const dotsEl = document.createElement('div');
        dotsEl.className = 'mini-dots';
        const maxDots = 3;
        evs.slice(0, maxDots).forEach(ev => {
          const dot = document.createElement('div');
          dot.className = 'dot';
          dot.style.background = getDocColor(getDocFromSummary(ev.summary || '', ev)).bg;
          dotsEl.appendChild(dot);
        });
        cell.appendChild(dotsEl);
      }
      // 年視圖：簡短剩餘時間
      if (evs.length > 0) {
        const { text, cls } = freeMiniLabel(evs);
        const miniF = document.createElement('div');
        miniF.className = `mini-free ${cls}`;
        miniF.textContent = text;
        cell.appendChild(miniF);
      }

      cell.addEventListener('click', () => selectCalDay(dateStr, evs));
      gridEl.appendChild(cell);
    }

    miniEl.appendChild(titleEl);
    miniEl.appendChild(wdEl);
    miniEl.appendChild(gridEl);
    yearGrid.appendChild(miniEl);
  }
}

// ── 月視圖 ────────────────────────────────────────────────────────────────────
async function renderMonthCalendar() {
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth + 1, 0);

  buildCalGrid(firstDay, lastDay, calEvents); // 先用快取

  try {
    const res    = await fetch(`${API}/api/appointments/range?start=${localDateStr(firstDay)}&end=${localDateStr(lastDay)}`);
    const events = await res.json();
    const monthEvs = groupByDate(events);
    // 合併進 calEvents
    Object.assign(calEvents, monthEvs);
    buildCalGrid(firstDay, lastDay, calEvents);
  } catch {}
}

function groupByDate(events) {
  const map = {};
  events.forEach(ev => {
    const dt  = ev.start?.dateTime || ev.start?.date || '';
    const day = dt.slice(0, 10);
    if (!map[day]) map[day] = [];
    map[day].push(ev);
  });
  return map;
}

function buildCalGrid(firstDay, lastDay, eventsMap) {
  const grid   = document.getElementById('calGrid');
  const today  = localDateStr(new Date());
  const yr     = firstDay.getFullYear();
  const mo     = firstDay.getMonth();
  grid.innerHTML = '';

  const startDow = firstDay.getDay();
  for (let i = 0; i < startDow; i++) {
    const b = document.createElement('div');
    b.className = 'cal-day other-month';
    grid.appendChild(b);
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${yr}-${pad(mo+1)}-${pad(d)}`;
    const dow     = new Date(yr, mo, d).getDay();
    const evs     = eventsMap[dateStr] || [];

    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (dateStr === today)           cell.classList.add('today');
    if (dateStr === calSelectedDate) cell.classList.add('selected');
    if (dow === 0) cell.classList.add('sunday');
    if (dow === 6) cell.classList.add('saturday');

    const numEl = document.createElement('div');
    numEl.className = 'cal-day-num';
    numEl.textContent = d;

    const chipsEl = document.createElement('div');
    chipsEl.className = 'cal-chips';
    const maxShow = 2;
    evs.slice(0, maxShow).forEach(ev => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const _col = getDocColor(getDocFromSummary(ev.summary || '', ev));
      chip.style.background = _col.bg;
      chip.style.color = '#fff';
      chip.textContent = chipLabel(ev);
      chip.title = ev.summary || '';
      chipsEl.appendChild(chip);
    });
    if (evs.length > maxShow) {
      const more = document.createElement('span');
      more.className = 'chip chip-more';
      more.textContent = `＋ ${evs.length - maxShow} 筆`;
      chipsEl.appendChild(more);
    }

    // 剩餘可約時段
    const { lines, cls } = freeInfo(evs);
    const freeEl = document.createElement('div');
    freeEl.className = `cal-free-block ${cls}`;
    lines.forEach(line => {
      const row = document.createElement('div');
      row.textContent = line;
      freeEl.appendChild(row);
    });

    cell.appendChild(numEl);
    cell.appendChild(chipsEl);
    cell.appendChild(freeEl);
    cell.addEventListener('click', () => selectCalDay(dateStr, evs));
    grid.appendChild(cell);
  }

  const totalCells = startDow + lastDay.getDate();
  const rem = totalCells % 7;
  if (rem !== 0) {
    for (let i = 0; i < 7 - rem; i++) {
      const b = document.createElement('div');
      b.className = 'cal-day other-month';
      grid.appendChild(b);
    }
  }
}

function selectCalDay(dateStr, evs) {
  calSelectedDate = dateStr;

  document.querySelectorAll('.cal-day.selected, .mini-day.selected')
    .forEach(el => el.classList.remove('selected'));

  // 找到並標記選取的格子
  const allCells = (calView === 'month')
    ? document.querySelectorAll('.cal-day')
    : document.querySelectorAll('.mini-day');
  allCells.forEach(el => {
    if (el.querySelector('.cal-day-num, .mini-day-num')?.textContent === String(parseInt(dateStr.slice(8)))) {
      // 避免誤選不同月份同日期：只標記有 click listener 的
    }
  });

  // 右側詳細
  const d = new Date(dateStr + 'T00:00:00');
  document.getElementById('calDetailTitle').textContent =
    d.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'short' });
  document.getElementById('calAddBtn').style.display = 'inline-block';
  renderAppointments(evs, document.getElementById('calDetailList'));
}

async function loadCalendarDay(dateStr) {
  try {
    const res = await fetch(`${API}/api/appointments?date=${dateStr}`);
    const evs = await res.json();
    calEvents[dateStr] = evs;
    if (calSelectedDate === dateStr)
      renderAppointments(evs, document.getElementById('calDetailList'));
    if (calView === 'month')
      buildCalGrid(new Date(calYear, calMonth, 1), new Date(calYear, calMonth+1, 0), calEvents);
    else
      renderYearCalendar();
  } catch {}
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  calSelectedDate = null;
  document.getElementById('calDetailTitle').textContent = '點選日期查看約診';
  document.getElementById('calDetailList').innerHTML = '<p class="placeholder-text">請點選左方日曆的日期</p>';
  document.getElementById('calAddBtn').style.display = 'none';
  renderCalendar();
}

// ─── Remaining Time Slots ─────────────────────────────────────────────────────
const CLINIC_SESSIONS = [
  { start: 9*60,  end: 12*60 },   // 09:00-12:00
  { start: 14*60, end: 17*60 },   // 14:00-17:00
  { start: 18*60, end: 21*60 },   // 18:00-21:00
];

// 計算診間內的空閒時段（區間相減）
function calcFreeSlots(events) {
  let free = CLINIC_SESSIONS.map(s => ({ start: s.start, end: s.end }));

  const booked = events
    .filter(ev => ev.start?.dateTime && ev.end?.dateTime)
    .map(ev => {
      const s = new Date(ev.start.dateTime);
      const e = new Date(ev.end.dateTime);
      return { start: s.getHours()*60+s.getMinutes(), end: e.getHours()*60+e.getMinutes() };
    })
    .sort((a, b) => a.start - b.start);

  booked.forEach(b => {
    const next = [];
    free.forEach(f => {
      const os = Math.max(b.start, f.start);
      const oe = Math.min(b.end,   f.end);
      if (oe > os) {
        if (f.start < b.start) next.push({ start: f.start, end: b.start });
        if (b.end   < f.end)   next.push({ start: b.end,   end: f.end });
      } else {
        next.push(f);
      }
    });
    free = next;
  });

  return free; // [{ start: mins, end: mins }, ...]
}

// 分鐘 → "9." (整點) 或 "9:30" (非整點)
function minsToCompact(m) {
  const h = Math.floor(m/60), min = m%60;
  return min === 0 ? `${h}.` : `${h}:${pad(min)}`;
}

// 空閒時段 → 顯示文字陣列
function freeSlotsLabels(slots) {
  return slots.map(s => `${minsToCompact(s.start)}-${minsToCompact(s.end)}`);
}

// 給月曆日格用：傳回 { lines: string[], cls }
function freeInfo(events) {
  const slots = calcFreeSlots(events);
  if (!slots.length) return { lines: ['診滿'], cls: 'free-full' };

  const totalFree = slots.reduce((s, c) => s + c.end - c.start, 0);
  const cls = totalFree >= 300 ? 'free-high' : totalFree >= 60 ? 'free-mid' : 'free-low';
  const labels = freeSlotsLabels(slots);
  // 每行最多放 2 個時段，避免格子太擠
  const lines = [];
  for (let i = 0; i < labels.length; i += 2)
    lines.push(labels.slice(i, i+2).join(' '));
  return { lines, cls };
}

// 年視圖用（簡短）
function freeMiniLabel(events) {
  const slots = calcFreeSlots(events);
  if (!slots.length) return { text: '診滿', cls: 'free-full' };
  const totalFree = slots.reduce((s, c) => s + c.end - c.start, 0);
  const h = Math.floor(totalFree/60), m = totalFree%60;
  const text = h > 0 ? `剩${h}h` : `剩${m}m`;
  return { text, cls: totalFree >= 300 ? 'free-high' : totalFree >= 60 ? 'free-mid' : 'free-low' };
}

// ─── Doctor chip / dot helpers ────────────────────────────────────────────────
function chipLabel(ev) {
  const summary = ev.summary || '';
  const time    = ev.start?.dateTime
    ? new Date(ev.start.dateTime).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false })
    : '';
  return time ? `${time} ${summary}` : summary;
}

// ─── Modal & Confirm ──────────────────────────────────────────────────────────
function showSuccess(data) {
  const box = document.querySelector('.modal-box');
  box.innerHTML = `
    <div class="modal-icon">✅</div>
    <h3>約診成功！</h3>
    <p>${escHtml(data.date)}　${escHtml(data.start_time)} – ${escHtml(data.end_time)}
醫師：${escHtml(data.doctor)}
病患：${escHtml(data.patient_name)}（${escHtml(data.visit_type)}）

已成功加入 Google 日曆 ✓</p>
    <button class="btn-primary" onclick="closeModal()">確定</button>`;
  document.getElementById('successModal').classList.add('open');
}

function closeModal() {
  document.getElementById('successModal').classList.remove('open');
}

function showConfirm(title, message, onConfirm) {
  const box = document.querySelector('.modal-box');
  box.innerHTML = `
    <div class="confirm-box">
      <h4>${escHtml(title)}</h4>
      <p>${escHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn-cancel-no"  id="confirmNo">取消</button>
        <button class="btn-cancel-yes" id="confirmYes">確定刪除</button>
      </div>
    </div>`;
  document.getElementById('successModal').classList.add('open');
  document.getElementById('confirmNo').onclick  = closeModal;
  document.getElementById('confirmYes').onclick = () => { closeModal(); onConfirm(); };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

let toastTimer = null;
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast show${isError ? ' error' : ' ok'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3500);
}
