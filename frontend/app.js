'use strict';

const API = ''; // 自動使用當前網域，Mac localhost 或 ngrok 都能運作

// ─── 台灣國定假日 ────────────────────────────────────────────────────────────
// 每年自動從 CDN 載入；以下為離線備援資料（已確認 2025/2026）

const TW_HOLIDAYS_FIXED = {
  '01-01': '元旦',       '02-28': '和平紀念日', '04-04': '兒童節',
  '05-01': '勞動節',     '09-28': '孔子誕辰紀念日', '10-10': '國慶日',
  '10-25': '臺灣光復節', '12-25': '行憲紀念日',
};

const TW_HOLIDAYS_FALLBACK = {
  // 2025
  '2025-01-27':'小年夜',      '2025-01-28':'農曆除夕', '2025-01-29':'春節',
  '2025-01-30':'春節',        '2025-01-31':'春節',     '2025-04-03':'補假',
  '2025-04-04':'兒童節及清明', '2025-05-30':'補假',    '2025-05-31':'端午節',
  '2025-09-29':'補假',        '2025-10-06':'中秋節',   '2025-10-24':'補假',
  // 2026
  '2026-02-15':'小年夜',  '2026-02-16':'農曆除夕', '2026-02-17':'春節',
  '2026-02-18':'春節',    '2026-02-19':'春節',     '2026-02-20':'補假',
  '2026-02-27':'補假',    '2026-04-03':'補假',     '2026-04-05':'清明節',
  '2026-04-06':'補假',    '2026-06-19':'端午節',   '2026-09-25':'中秋節',
  '2026-10-09':'補假',    '2026-10-26':'補假',
};

let TW_HOLIDAYS_DYNAMIC = {};  // 從 CDN 載入後填入

function getTwHoliday(dateStr) {
  return TW_HOLIDAYS_DYNAMIC[dateStr]
    || TW_HOLIDAYS_FALLBACK[dateStr]
    || TW_HOLIDAYS_FIXED[dateStr.slice(5)]
    || null;
}

async function loadHolidaysFromCDN() {
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];
  for (const yr of years) {
    const key = `tw_hol_${yr}`;
    let data = null;
    try { data = JSON.parse(localStorage.getItem(key)); } catch {}
    if (!data) {
      try {
        const res = await fetch(
          `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${yr}.json`
        );
        if (res.ok) { data = await res.json(); localStorage.setItem(key, JSON.stringify(data)); }
      } catch {}
    }
    if (Array.isArray(data)) {
      data.forEach(({ date, isHoliday, description }) => {
        if (!isHoliday || !description || !description.trim()) return;
        const ds = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
        TW_HOLIDAYS_DYNAMIC[ds] = description;
      });
    }
  }
}

let doctorsList       = [];
let complaintPresets  = [];
let bookersList       = [];
let selectedBooker    = '';
let editSelectedBooker = '';
let allPatientNames   = [];
let calYear         = new Date().getFullYear();
let calMonth        = new Date().getMonth(); // 0-indexed
let calEvents       = {};  // { 'YYYY-MM-DD': [events] }
let calSelectedDate = null;
let calView         = 'month'; // 'year' | 'month'
// 年視圖的錨點月份（決定滾動窗口的「當月」）
let calAnchorYear   = new Date().getFullYear();
let calAnchorMonth  = new Date().getMonth();

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadHolidaysFromCDN();   // 非同步，不阻擋頁面載入
  initDate();
  buildTimeSelects();
  fetchDoctors();
  fetchBookers();
  fetchPatientNames();
  fetchComplaintPresets();
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
  if (name === 'contact')  loadContactList();
}

// ─── Date ─────────────────────────────────────────────────────────────────────
let fpDate = null;

function initDate() {
  const todayStr = localDateStr(new Date());

  fpDate = flatpickr('#date', {
    locale: 'zh_tw',
    dateFormat: 'Y-m-d',
    defaultDate: todayStr,
    allowInput: false,
    onDayCreate(_dObj, _dStr, _fp, dayElem) {
      const d = dayElem.dateObj;
      const ds = localDateStr(d);
      const hl = getTwHoliday(ds);
      if (hl) {
        dayElem.classList.add('fp-holiday');
        dayElem.title = hl;
        const dot = document.createElement('span');
        dot.className = 'fp-holiday-dot';
        dayElem.appendChild(dot);
      }
    },
    onChange(_selectedDates, _dateStr) {
      updateApptCardTitle();
      loadAppointments();
    },
  });

  document.getElementById('todayDisplay').textContent =
    new Date().toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'long' });
}

function setDateValue(dateStr) {
  if (fpDate) fpDate.setDate(dateStr, true);
  else document.getElementById('date').value = dateStr;
}

function localDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

function goToday() {
  setDateValue(localDateStr(new Date()));
  updateApptCardTitle();
  loadAppointments();
}

async function calGoToday() {
  const today = new Date();
  calYear        = today.getFullYear();
  calMonth       = today.getMonth();
  calAnchorYear  = today.getFullYear();
  calAnchorMonth = today.getMonth();
  const todayStr = localDateStr(today);
  calSelectedDate = todayStr;
  await renderCalendar();
  if (calView !== 'year') {
    await loadCalendarDay(todayStr);
    document.getElementById('calDetailTitle').textContent =
      today.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'short' });
    document.getElementById('calAddBtn').style.display = 'inline-block';
    document.getElementById('calPrintBtn').style.display = 'inline-block';
  }
}

function updateApptCardTitle() {
  const date  = document.getElementById('date').value;
  const today = localDateStr(new Date());
  document.getElementById('apptCardTitle').textContent = date === today ? '今日約診' : `${date} 約診`;
}

// ─── Time Inputs ──────────────────────────────────────────────────────────────
// 顯示 08:30 – 22:00，每 15 分鐘一格
function timeSlots(fromH = 8, fromM = 30, toH = 22) {
  const slots = [];
  for (let h = fromH; h <= toH; h++) {
    const startM = (h === fromH) ? fromM : 0;
    for (let m = startM; m < 60; m += 15) {
      if (h === toH && m > 0) break;
      slots.push(`${pad(h)}:${pad(m)}`);
    }
  }
  return slots;
}

// 讓 datalist 時間欄位聚焦時顯示全部時段（不受現有值過濾），離開時自動還原
function initTimeInputShowAll(inputEl) {
  if (!inputEl) return; // 防止 null crash
  let savedVal = '';
  inputEl.addEventListener('focus', () => {
    savedVal = inputEl.value;
    inputEl.value = '';
  });
  inputEl.addEventListener('blur', () => {
    if (!inputEl.value.trim()) inputEl.value = savedVal;
    else formatTimeInput(inputEl);
  });
}

function buildTimeSelects() {
  const all = timeSlots();
  fillDatalist('startTimeList', all);
  fillDatalist('endTimeList',   all);

  const startEl = document.getElementById('startTime');
  const endEl   = document.getElementById('endTime');

  initTimeInputShowAll(startEl);
  initTimeInputShowAll(endEl);

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
          <input type="text" id="docname-${d.id}" value="${escHtml(d.name)}"
                 class="doctor-name-input" placeholder="醫師名稱" />
          <button class="btn-note-save" onclick="saveDocName('${d.id}')">儲存</button>
        </div>
        <button class="btn-danger-sm" onclick="deleteDoctor('${d.id}','${escHtml(d.name)}')">移除</button>
      </div>
      <div class="doctor-item-note">
        <span><i class="fa-solid fa-note-sticky"></i></span>
        <input type="text" id="note-${d.id}" value="${escHtml(d.note || '')}" placeholder="新增備注（如：週五午晚診）" />
        <button class="btn-note-save" onclick="saveNote('${d.id}')">儲存</button>
      </div>`;
    list.appendChild(row);
  });
}

async function saveDocName(id) {
  const input = document.getElementById(`docname-${id}`);
  const name  = input?.value.trim();
  if (!name) { showToast('名稱不能為空', true); return; }
  try {
    const res = await fetch(`${API}/api/doctors/${id}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error();
    const doc = doctorsList.find(d => d.id === id);
    if (doc) doc.name = name;
    await fetchDoctors();
    showToast(`已更新為「${name}」`, false);
  } catch { showToast('更新失敗', true); }
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
  // 若有待刪醫師先確認刪除
  if (doctorDeleteTimer) {
    clearTimeout(doctorDeleteTimer);
    doctorDeleteTimer = null;
    if (lastDeletedDoctor) {
      await fetch(`${API}/api/doctors/${lastDeletedDoctor.id}`, { method: 'DELETE' }).catch(() => {});
      lastDeletedDoctor = null;
    }
  }

  // 先從畫面移除（樂觀更新）
  lastDeletedDoctor = doctorsList.find(d => d.id === id) || null;
  doctorsList = doctorsList.filter(d => d.id !== id);
  renderDoctorsPanel();
  refreshDoctorSelect();

  // 顯示倒數 toast
  undoType = 'doctor';
  showUndoToast(`<i class="fa-solid fa-trash-can"></i> 已移除「${name}」`);

  // 倒數結束 → 真正刪除
  doctorDeleteTimer = setTimeout(async () => {
    doctorDeleteTimer = null;
    try {
      await fetch(`${API}/api/doctors/${id}`, { method: 'DELETE' });
      lastDeletedDoctor = null;
    } catch {
      showToast('移除失敗，已還原', true);
      if (lastDeletedDoctor) { doctorsList.push(lastDeletedDoctor); renderDoctorsPanel(); refreshDoctorSelect(); }
      lastDeletedDoctor = null;
    }
  }, UNDO_SECS * 1000);
}

async function undoDeleteDoctor() {
  if (!lastDeletedDoctor) return;
  clearTimeout(doctorDeleteTimer);
  doctorDeleteTimer = null;
  doctorsList.push(lastDeletedDoctor);
  doctorsList.sort((a, b) => Number(a.id) - Number(b.id));
  lastDeletedDoctor = null;
  renderDoctorsPanel();
  refreshDoctorSelect();
  hideUndoToast();
  showToast('✅ 已復原');
}

function refreshDoctorSelect() {
  const sel = document.getElementById('doctor');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">請選擇醫師</option>' +
    doctorsList.map(d => `<option value="${escHtml(d.name)}">${escHtml(d.name)}</option>`).join('');
  if (prev) sel.value = prev;
}

// ─── Complaint Presets (快捷主訴) ──────────────────────────────────────────────
async function fetchComplaintPresets() {
  try {
    const res = await fetch(`${API}/api/complaints`);
    if (res.ok) complaintPresets = await res.json();
  } catch {}
  // 無論成功或失敗都渲染（失敗時 complaintPresets 維持 []）
  renderComplaintShortcuts('complaint', 'complaintShortcuts');
}

// 渲染快捷主訴 chips（通用，可指定 textarea id 和容器 id）
function renderComplaintShortcuts(textareaId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  // 快捷標籤
  const labelEl = document.createElement('div');
  labelEl.className = 'complaint-shortcuts-label';
  labelEl.textContent = '快捷主訴：';
  container.appendChild(labelEl);

  // 快捷 chips
  const chipsRow = document.createElement('div');
  chipsRow.className = 'complaint-chips-row';

  complaintPresets.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'complaint-chip';
    chip.dataset.id = p.id;

    const label = document.createElement('span');
    label.className = 'complaint-chip-label';
    label.textContent = p.text;
    label.title = p.text;
    label.onclick = () => insertComplaint(textareaId, p.text);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'complaint-chip-edit';
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.title = '編輯';
    editBtn.onclick = (e) => { e.stopPropagation(); startEditComplaint(chip, p, textareaId, containerId); };

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'complaint-chip-del';
    delBtn.textContent = '✕';
    delBtn.title = '刪除';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      await fetch(`${API}/api/complaints/${p.id}`, { method: 'DELETE' });
      complaintPresets = complaintPresets.filter(c => c.id !== p.id);
      renderAllComplaintShortcuts();
    };

    chip.appendChild(label);
    chip.appendChild(editBtn);
    chip.appendChild(delBtn);
    chipsRow.appendChild(chip);
  });

  // 新增按鈕
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'complaint-chip-add';
  addBtn.textContent = '＋ 新增';
  addBtn.onclick = () => showAddComplaintInput(chipsRow, textareaId, containerId);
  chipsRow.appendChild(addBtn);

  container.appendChild(chipsRow);
}

// 在所有已渲染的快捷主訴容器同步更新
function renderAllComplaintShortcuts() {
  renderComplaintShortcuts('complaint', 'complaintShortcuts');
  if (document.getElementById('editComplaintShortcuts'))
    renderComplaintShortcuts('editComplaint', 'editComplaintShortcuts');
}

// 插入文字到目標 textarea
function insertComplaint(textareaId, text) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const cur = ta.value.trim();
  ta.value = cur ? cur + ' ' + text : text;
  ta.focus();
}

// 進入編輯模式
function startEditComplaint(chip, preset, textareaId, containerId) {
  const label = chip.querySelector('.complaint-chip-label');
  const input = document.createElement('input');
  input.type = 'text';
  input.value = preset.text;
  input.className = 'complaint-chip-input';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'complaint-chip-save';
  saveBtn.textContent = '✓';
  saveBtn.onclick = async () => {
    const newText = input.value.trim();
    if (!newText) return;
    await fetch(`${API}/api/complaints/${preset.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: newText }),
    });
    const c = complaintPresets.find(c => c.id === preset.id);
    if (c) c.text = newText;
    renderAllComplaintShortcuts();
  };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); } if (e.key === 'Escape') renderAllComplaintShortcuts(); };

  chip.innerHTML = '';
  chip.appendChild(input);
  chip.appendChild(saveBtn);
  input.focus();
  input.select();
}

// 顯示新增輸入框
function showAddComplaintInput(chipsRow, textareaId, containerId) {
  const existing = chipsRow.querySelector('.new-complaint-input');
  if (existing) { existing.focus(); return; }

  const wrap = document.createElement('div');
  wrap.className = 'complaint-chip complaint-chip-new';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '輸入快捷主訴…';
  input.className = 'complaint-chip-input new-complaint-input';
  input.maxLength = 40;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'complaint-chip-save';
  saveBtn.textContent = '✓';
  saveBtn.onclick = async () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const res = await fetch(`${API}/api/complaints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const newPreset = await res.json();
    complaintPresets.push(newPreset);
    renderAllComplaintShortcuts();
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'complaint-chip-del';
  cancelBtn.textContent = '✕';
  cancelBtn.onclick = () => wrap.remove();

  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); } if (e.key === 'Escape') wrap.remove(); };

  wrap.appendChild(input);
  wrap.appendChild(saveBtn);
  wrap.appendChild(cancelBtn);
  chipsRow.insertBefore(wrap, chipsRow.querySelector('.complaint-chip-add'));
  input.focus();
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
    renderAppointmentsByDoctor(events, list);
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
          <button class="btn-edit-sm" onclick="editAppointment('${ev.id}')"><i class="fa-solid fa-pen"></i> 修改</button>
          <button class="btn-danger-sm" onclick="cancelAppointment('${ev.id}','${escHtml(summary)}')">取消</button>
        </div>
      </div>`;
  }).join('');
}

function renderAppointmentsByDoctor(events, container) {
  if (!events || !events.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:28px 0;">
        <p class="placeholder-text" style="margin-bottom:14px;">此日尚無約診記錄</p>
        <button class="btn-add-appt" onclick="focusForm()">＋ 新增約診</button>
      </div>`;
    return;
  }
  events.forEach(ev => { if (ev.id) eventsCache[ev.id] = ev; });

  // 依 doctorsList 順序建立 Map，有約診才加入
  const groups = new Map();
  doctorsList.forEach(d => groups.set(d.id, { doc: d, col: getDocColor(d), appts: [] }));

  events.forEach(ev => {
    const hasTime = !!ev.start?.dateTime;
    const doc = hasTime ? getDocFromSummary(ev.summary || '', ev) : null;
    const key = (doc && hasTime) ? doc.id : '__other__';
    if (!groups.has(key)) groups.set(key, { doc: hasTime ? doc : null, col: getDocColor(hasTime ? doc : null), appts: [] });
    groups.get(key).appts.push(ev);
  });

  const sections = [...groups.values()].filter(g => g.appts.length > 0);

  container.innerHTML = `<div class="appt-by-doctor">` +
    sections.map(g => {
      const col    = g.col;
      const drName = g.doc ? g.doc.name.replace('醫師','').trim() : '其他';
      const rowsHtml = g.appts.map(ev => {
        const start = ev.start?.dateTime
          ? new Date(ev.start.dateTime).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false })
          : '--:--';
        const end = ev.end?.dateTime
          ? new Date(ev.end.dateTime).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false })
          : '';
        const sumRaw = (ev.summary || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        return `
          <div class="appt-row-item" onclick="editAppointment('${ev.id}')"
            onmouseenter="showApptTooltip(event,'${ev.id}')" onmouseleave="hideApptTooltip()">
            <span class="appt-row-time" style="color:${col.bg};">${start}${end ? '–'+end : ''}</span>
            <span class="appt-row-name">${escHtml(ev.summary||'')}</span>
            <div class="appt-row-actions">
              <button class="appt-row-edit" type="button" onclick="event.stopPropagation();editAppointment('${ev.id}')">修改</button>
              <button class="appt-row-del"  type="button" onclick="event.stopPropagation();cancelAppointment('${ev.id}','${sumRaw}')">取消</button>
            </div>
          </div>`;
      }).join('');
      return `
        <div class="appt-dr-section">
          <div class="appt-dr-header" style="background:${col.light};color:${col.bg};">
            <span class="appt-dr-dot" style="background:${col.bg};"></span>
            ${escHtml(drName)}
            <span class="appt-dr-count">${g.appts.length} 件</span>
          </div>
          <div class="appt-dr-rows">${rowsHtml}</div>
        </div>`;
    }).join('') + `</div>`;
}

// ─── Appointment Tooltip ──────────────────────────────────────────────────────
function showApptTooltip(e, evId) {
  const ev = eventsCache[evId];
  if (!ev) return;
  const start = ev.start?.dateTime
    ? new Date(ev.start.dateTime).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false })
    : '--:--';
  const end = ev.end?.dateTime
    ? new Date(ev.end.dateTime).toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit', hour12:false })
    : '';
  const descLines = (ev.description || '').split('\n').filter(l => l.trim());
  const descHtml  = descLines.map(l => `<div>${escHtml(l)}</div>`).join('');

  const tt = document.getElementById('apptTooltip');
  tt.innerHTML = `
    <div class="att-time">${start}${end ? ' – ' + end : ''}</div>
    <div class="att-title">${escHtml(ev.summary || '')}</div>
    ${descHtml ? `<div class="att-desc">${descHtml}</div>` : ''}`;
  tt.style.display = 'block';

  const rect = e.currentTarget.getBoundingClientRect();
  const TT_W = 260;
  let left = rect.right + 10;
  if (left + TT_W > window.innerWidth - 10) left = rect.left - TT_W - 10;
  if (left < 10) left = 10;
  let top = rect.top;
  const ttH = tt.offsetHeight;
  if (top + ttH > window.innerHeight - 10) top = window.innerHeight - ttH - 10;
  if (top < 10) top = 10;
  tt.style.left = left + 'px';
  tt.style.top  = top  + 'px';
}
function hideApptTooltip() {
  const tt = document.getElementById('apptTooltip');
  if (tt) tt.style.display = 'none';
}

let lastDeleted       = null; // { event, calendar_id }
let lastDeletedDoctor = null; // { id, name, data }
let doctorDeleteTimer = null;
let undoType          = 'appointment'; // 'appointment' | 'doctor'
let eventsCache       = {}; // eventId → event object

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
        undoType = 'appointment';
        await reloadAllViews();
        showUndoToast(`<i class="fa-solid fa-trash-can"></i> 約診已取消`);
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
  let cp = (desc.match(/主訴：(.+)/) || [])[1]?.trim() || '';

  // fallback 1：description 有內容但沒有結構化格式（舊事件），直接當主訴用
  if (!cp && desc && !desc.includes('患者：') && !desc.includes('電話：')) {
    cp = desc.trim();
  }

  // fallback 2：從 summary 標題解析（去掉約診者前綴、NP、Dr.X、患者姓名）
  if (!cp) {
    let s = (ev.summary || '').trim();
    // 去掉 "約診者: " 或 "約診者： " 前綴（半形 / 全形冒號皆支援）
    s = s.replace(/^[^:\uff1a]{1,8}[:\uff1a]\s*/, '');
    // 去掉 NP 前綴
    if (s.startsWith('NP ')) s = s.slice(3).trim();
    // 去掉 Dr.姓 前綴
    s = s.replace(/^Dr[.\uff0e]\S+\s*/, '').trim();
    // 去掉第一個詞（患者姓名 2~4 字），剩下的就是主訴
    const m = s.match(/^\S{2,4}\s+([\s\S]+)/);
    if (m) cp = m[1].trim();
  }

  return { visit_type: vt, complaint: cp };
}

function getPhoneFromEvent(ev) {
  const m = (ev.description || '').match(/電話：(.+)/);
  if (m && m[1].trim() !== '未提供') return m[1].trim();
  return '';
}

function getBookerFromSummary(summary) {
  if (summary && summary.includes(': ')) {
    const prefix = summary.split(': ', 1)[0].trim();
    if (prefix.length >= 1 && prefix.length <= 8) return prefix;
  }
  return '';
}

function renderEditBookerChips() {
  const container = document.getElementById('editBookerChips');
  if (!container) return;
  container.innerHTML = '';
  bookersList.forEach(b => {
    const chip = document.createElement('div');
    chip.className = 'booker-chip' + (editSelectedBooker === b.name ? ' active' : '');
    chip.textContent = b.name;
    chip.onclick = () => {
      editSelectedBooker = editSelectedBooker === b.name ? '' : b.name;
      renderEditBookerChips();
    };
    container.appendChild(chip);
  });
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

  // 現有患者姓名
  const currentPatientName = getPatientNameFromEvent(ev);

  // 現有電話
  const currentPhone = getPhoneFromEvent(ev);

  // 現有主訴 & 類型
  const meta = getEventMeta(ev);
  const currentComplaint = meta.complaint;
  const currentVisitType = meta.visit_type || '複診';

  // 現有約診者
  editSelectedBooker = getBookerFromSummary(ev.summary || '');

  // 醫師選單 options（預選當前醫師）
  const doctorOptions = doctorsList.map(d =>
    `<option value="${escHtml(d.name)}" ${d.name === currentDocName ? 'selected' : ''}>${escHtml(d.name)}</option>`
  ).join('');

  const box = document.querySelector('.modal-box');
  const all = timeSlots();
  box.innerHTML = `
    <div class="edit-box">
      <h4><i class="fa-solid fa-pen"></i> 修改約診</h4>
      <p class="edit-summary">${escHtml(ev.summary || '')}</p>
      <div class="edit-fields">
        <div class="edit-row">
          <label class="field-label">日期</label>
          <input type="date" id="editDate" value="${dateStr}" />
        </div>
        <div class="edit-row edit-row-time">
          <div style="flex:1">
            <label class="field-label">開始時間</label>
            <input type="text" id="editStart" value="${startVal}"
                   list="editStartList" maxlength="5" placeholder="09:00" autocomplete="off" />
            <datalist id="editStartList"></datalist>
          </div>
          <div class="time-arrow" style="margin-top:22px;">→</div>
          <div style="flex:1">
            <label class="field-label">結束時間</label>
            <input type="text" id="editEnd" value="${endVal}"
                   list="editEndList" maxlength="5" placeholder="09:30" autocomplete="off" />
            <datalist id="editEndList"></datalist>
          </div>
        </div>
        <div class="edit-row">
          <label class="field-label">患者姓名</label>
          <input type="text" id="editPatientName" value="${escHtml(currentPatientName)}" placeholder="患者姓名" />
        </div>
        <div class="edit-row">
          <label class="field-label">聯絡電話 <span class="optional">（選填）</span></label>
          <input type="tel" id="editPhone" value="${escHtml(currentPhone)}" placeholder="09xx-xxxxxx" />
        </div>
        <div class="edit-row">
          <label class="field-label">主治醫師</label>
          <select id="editDoctor">
            ${doctorOptions}
          </select>
        </div>
        <div class="edit-row">
          <label class="field-label">就診類型</label>
          <div class="radio-group">
            <label class="radio-label">
              <input type="radio" name="editVisitType" value="初診" ${currentVisitType === '初診' ? 'checked' : ''} />
              <span class="radio-box">初診</span>
            </label>
            <label class="radio-label">
              <input type="radio" name="editVisitType" value="複診" ${currentVisitType === '複診' ? 'checked' : ''} />
              <span class="radio-box">複診</span>
            </label>
          </div>
        </div>
        <div class="edit-row">
          <label class="field-label">約診者</label>
          <div class="booker-row" id="editBookerChips"></div>
        </div>
        <div class="edit-row">
          <label class="field-label">主訴 / 症狀</label>
          <textarea id="editComplaint" rows="3" placeholder="請描述主訴或症狀…">${escHtml(currentComplaint)}</textarea>
          <div id="editComplaintShortcuts" class="complaint-shortcuts"></div>
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
    if (!dl) return;
    all.forEach(t => { const o = document.createElement('option'); o.value = t; dl.appendChild(o); });
  });

  // 讓修改視窗的時間欄位也支援聚焦全部顯示
  initTimeInputShowAll(document.getElementById('editStart'));
  initTimeInputShowAll(document.getElementById('editEnd'));

  // 渲染約診者 chips
  renderEditBookerChips();
  renderComplaintShortcuts('editComplaint', 'editComplaintShortcuts');

  document.getElementById('successModal').classList.add('open');
}

async function saveEditedAppointment(eventId) {
  const date      = document.getElementById('editDate').value;
  const start     = document.getElementById('editStart').value.trim();
  const end       = document.getElementById('editEnd').value.trim();
  const selDoctor = document.getElementById('editDoctor')?.value || '';
  const newComplaint = document.getElementById('editComplaint')?.value.trim() ?? '';
  const [sh, sm] = parseTime(start);
  const [eh, em] = parseTime(end);
  if (!date)                { showToast('請選擇日期', true); return; }
  if (sh === null)          { showToast('請輸入正確的開始時間（例：09:00）', true); return; }
  if (eh === null)          { showToast('請輸入正確的結束時間（例：09:30）', true); return; }
  if (eh*60+em <= sh*60+sm) { showToast('結束時間必須晚於開始時間', true); return; }

  const ev   = eventsCache[eventId] || {};
  const meta = getEventMeta(ev);

  const editedPhone = document.getElementById('editPhone')?.value.trim() || '';
  const editedVisitType = document.querySelector('input[name="editVisitType"]:checked')?.value || meta.visit_type || '複診';

  const payload = {
    date,
    start_time:   `${pad(sh)}:${pad(sm)}`,
    end_time:     `${pad(eh)}:${pad(em)}`,
    // 永遠帶醫師、患者、就診類型、主訴，讓後端能正確重建 summary / description
    doctor:       selDoctor,
    patient_name: document.getElementById('editPatientName')?.value.trim() || getPatientNameFromEvent(ev),
    visit_type:   editedVisitType,
    complaint:    newComplaint,
    phone:        editedPhone || null,
    booker:       editSelectedBooker || null,
  };

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
    showToast('✅ 約診已更新', false);

    // 跨日曆搬移需等 Google Calendar 傳播後再重載
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

function showUndoToast(msg) {
  clearTimeout(undoTimer);
  const toast = document.getElementById('undoToast');
  const fill  = document.getElementById('undoBarFill');
  const msgEl = document.querySelector('#undoToast .undo-msg span');
  if (msgEl) msgEl.innerHTML = msg;
  toast.classList.add('show');
  fill.style.transition = 'none';
  fill.style.width = '100%';
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

// 統一復原入口
function undoAction() {
  if (undoType === 'doctor') undoDeleteDoctor();
  else undoDelete();
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
  finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> 確認約診並加入 Google 日曆'; }
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
      setDateValue(calSelectedDate);
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
              <button class="btn-edit-sm" onclick="editAppointment('${ev.id}')"><i class="fa-solid fa-pen"></i> 修改</button>
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
      undoType = 'appointment';
      showUndoToast(`<i class="fa-solid fa-trash-can"></i> 約診已取消`);
      doSearch(); // 重新搜尋更新結果
    } catch(e) { showToast('取消失敗：' + e.message, true); }
  });
}

// ─── 患者聯絡 ─────────────────────────────────────────────────────────────────
async function loadContactList() {
  const el   = document.getElementById('contactList');
  const rng  = document.getElementById('contactWeekRange');
  const today = new Date();
  const fromStr = localDateStr(today);
  const toDate  = new Date(today); toDate.setDate(toDate.getDate() + 6);
  const toStr   = localDateStr(toDate);

  // 顯示日期範圍
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
  rng.textContent = `（${fmt(today)} – ${fmt(toDate)}）`;

  el.innerHTML = '<p class="placeholder-text">載入中…</p>';
  try {
    const res  = await fetch(`${API}/api/appointments/week?from_date=${fromStr}`);
    if (!res.ok) throw new Error(await res.text());
    const { events } = await res.json();

    if (!events.length) {
      el.innerHTML = '<p class="placeholder-text">這週沒有約診</p>';
      return;
    }

    // 按日期分組
    const groups = {};
    for (const ev of events) {
      const dt = ev.start?.dateTime;
      if (!dt) continue;
      const day = dt.slice(0, 10);
      if (!groups[day]) groups[day] = [];
      groups[day].push(ev);
    }

    const WEEKDAY = ['日','一','二','三','四','五','六'];
    el.innerHTML = '';
    for (const day of Object.keys(groups).sort()) {
      const d       = new Date(day + 'T00:00:00');
      const wd      = WEEKDAY[d.getDay()];
      const holiday = getTwHoliday(day);
      const isToday = day === fromStr;

      const grpEl = document.createElement('div');
      grpEl.className = 'contact-day-group';

      const hdrEl = document.createElement('div');
      hdrEl.className = 'contact-day-header';
      hdrEl.innerHTML =
        `<span class="day-badge">${day.slice(5).replace('-','/')} 週${wd}${isToday ? ' 今日' : ''}</span>` +
        (holiday ? `<span class="day-holiday">${holiday}</span>` : '');
      grpEl.appendChild(hdrEl);

      for (const ev of groups[day]) {
        grpEl.appendChild(buildContactRow(ev));
      }
      el.appendChild(grpEl);
    }
  } catch(e) {
    el.innerHTML = `<p class="placeholder-text">載入失敗：${e.message}</p>`;
  }
}

function buildContactRow(ev) {
  const summary = ev.summary || '';
  const desc    = ev.description || '';

  // 判斷是否已聯絡
  const alreadyPhone = summary.startsWith('電話OK ');
  const alreadyLine  = summary.startsWith('LINE OK ');

  // 解析電話
  const phoneMatch = desc.match(/電話：([^\n]+)/);
  const phone = phoneMatch ? phoneMatch[1].trim() : '';
  const hasPhone = phone && phone !== '未提供';

  // 解析患者名稱（去掉前綴標記）
  let displaySummary = summary;
  if (alreadyPhone) displaySummary = summary.slice('電話OK '.length);
  if (alreadyLine)  displaySummary = summary.slice('LINE OK '.length);

  // 解析時間
  const startRaw = ev.start?.dateTime || '';
  const endRaw   = ev.end?.dateTime   || '';
  const toHM = s => s ? s.slice(11,16) : '';
  const timeLabel = toHM(startRaw) + (endRaw ? `–${toHM(endRaw)}` : '');

  // 醫師顏色
  const doc = getDocFromSummary(displaySummary, ev);
  const col = getDocColor(doc);

  const row = document.createElement('div');
  row.className = 'contact-row' +
    (alreadyPhone ? ' contacted-phone' : alreadyLine ? ' contacted-line' : '');
  row.dataset.eventId = ev.id;

  row.innerHTML = `
    <div class="contact-time">${escHtml(timeLabel)}</div>
    <div class="contact-patient">
      <div class="contact-patient-name">${escHtml(displaySummary)}</div>
      <div class="contact-patient-phone">
        ${hasPhone
          ? `<a class="contact-phone-link" href="tel:${escHtml(phone.replace(/-/g,''))}"><i class="fa-solid fa-phone" style="font-size:10px;"></i> ${escHtml(phone)}</a>`
          : '<span style="color:var(--text-hint);">未留電話</span>'}
      </div>
    </div>
    <span class="contact-doc-chip chip" style="background:${col.bg}22;color:${col.bg};border:1px solid ${col.bg}44;">${escHtml(doc ? getDocLabel(doc) : '?')}</span>
    ${alreadyPhone ? contactedHTML(ev.id, 'phone') :
      alreadyLine  ? contactedHTML(ev.id, 'line')  :
      `<div class="contact-actions">
        <button class="btn-contact-phone" onclick="doContact('${ev.id}','phone',this)">
          <i class="fa-solid fa-phone"></i> 電話
        </button>
        <button class="btn-contact-line" onclick="doContact('${ev.id}','line',this)">
          <i class="fa-brands fa-line"></i> LINE
        </button>
      </div>`}
  `;
  return row;
}

function contactedHTML(eventId, type) {
  const icon  = type === 'phone' ? '<i class="fa-solid fa-phone"></i>' : '<i class="fa-brands fa-line"></i>';
  const label = type === 'phone' ? '電話OK' : 'LINE OK';
  const cls   = type === 'phone' ? 'phone' : 'line';
  return `<div class="contact-done-wrap">
    <span class="contact-status-badge ${cls}">${icon} ${label}</span>
    <button class="btn-contact-cancel" onclick="doContact('${eventId}','cancel',this)" title="取消標記">✕</button>
  </div>`;
}

async function doContact(eventId, type, btnEl) {
  const row     = btnEl.closest('.contact-row');
  const wrapper = btnEl.closest('.contact-actions, .contact-done-wrap');
  const prev    = wrapper.outerHTML;
  wrapper.innerHTML = '<span style="font-size:12px;color:var(--text-sub);">更新中…</span>';

  try {
    const res = await fetch(`${API}/api/appointments/${eventId}/contact`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contact_type: type }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || '更新失敗');

    row.classList.remove('contacted-phone', 'contacted-line');

    if (type === 'cancel') {
      // 恢復成兩個按鈕
      wrapper.outerHTML = `<div class="contact-actions">
        <button class="btn-contact-phone" onclick="doContact('${eventId}','phone',this)"><i class="fa-solid fa-phone"></i> 電話</button>
        <button class="btn-contact-line"  onclick="doContact('${eventId}','line',this)"><i class="fa-brands fa-line"></i> LINE</button>
      </div>`;
      showToast('✅ 標記已取消');
    } else {
      wrapper.outerHTML = contactedHTML(eventId, type);
      row.classList.add(type === 'phone' ? 'contacted-phone' : 'contacted-line');
      showToast(type === 'phone' ? '✅ 電話OK 已標記' : '✅ LINE OK 已標記');
    }
  } catch(e) {
    wrapper.outerHTML = prev;
    showToast('操作失敗：' + e.message, true);
  }
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
  const today   = localDateStr(new Date());
  const todayD  = new Date();

  // 「剩Xh」只顯示在今天前1個月~後5個月之間
  const winStart = new Date(todayD.getFullYear(), todayD.getMonth() - 1, 1);
  const winEnd   = new Date(todayD.getFullYear(), todayD.getMonth() + 6, 0); // +5個月的最後一天

  for (let m = 0; m < 12; m++) {
    const miniEl = document.createElement('div');
    miniEl.className = 'mini-month';

    // 判斷此月是否在顯示「剩Xh」的窗口內
    const monthStart = new Date(calYear, m, 1);
    const monthEnd   = new Date(calYear, m + 1, 0);
    const inWindow   = monthStart <= winEnd && monthEnd >= winStart;

    // 月份標題 → 點擊切換到月視圖
    const titleEl = document.createElement('div');
    titleEl.className = 'mini-month-title';
    titleEl.textContent = MONTHS[m];
    if (inWindow) titleEl.classList.add('is-anchor');
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

      if (evs.length > 0) {
        // 彩色小點（全年皆顯示）
        const dotsEl = document.createElement('div');
        dotsEl.className = 'mini-dots';
        evs.slice(0, 3).forEach(ev => {
          const dot = document.createElement('div');
          dot.className = 'dot';
          dot.style.background = getDocColor(getDocFromSummary(ev.summary || '', ev)).bg;
          dotsEl.appendChild(dot);
        });
        cell.appendChild(dotsEl);

        // 剩餘時間（只在7個月窗口內顯示）
        if (inWindow) {
          const { text, cls } = freeMiniLabel(evs);
          const miniF = document.createElement('div');
          miniF.className = `mini-free ${cls}`;
          miniF.textContent = text;
          cell.appendChild(miniF);
        }
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

    const holiday = getTwHoliday(dateStr);
    if (holiday) cell.classList.add('holiday');

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
    if (holiday) {
      const hlEl = document.createElement('div');
      hlEl.className = 'cal-holiday-label';
      hlEl.textContent = holiday;
      cell.appendChild(hlEl);
    }
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
  document.getElementById('calPrintBtn').style.display = 'inline-block';
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
  document.getElementById('calPrintBtn').style.display = 'none';
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

// ─── 列印患者清單 ─────────────────────────────────────────────────────────────
function buildPrintHtml(date, events, selectedDoctors) {
  // 篩選醫師（null = 全部）
  let filtered = [...events].filter(ev => ev.start?.dateTime);
  if (selectedDoctors && selectedDoctors.length) {
    filtered = filtered.filter(ev => {
      const doc = getDocFromSummary(ev.summary || '', ev);
      return selectedDoctors.includes(doc?.name || '');
    });
  }
  const sorted = filtered.sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));
  if (!sorted.length) { showToast('所選醫師當日沒有約診', true); return null; }

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('zh-TW',
    { year:'numeric', month:'long', day:'numeric', weekday:'long' });
  const docLabel = selectedDoctors?.length ? selectedDoctors.join('、') : '全體醫師';

  const rows = sorted.map((ev, i) => {
    const s  = new Date(ev.start.dateTime);
    const e  = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
    const t  = `${pad(s.getHours())}:${pad(s.getMinutes())}` +
               (e ? `–${pad(e.getHours())}:${pad(e.getMinutes())}` : '');
    const doc     = getDocFromSummary(ev.summary || '', ev);
    const col     = getDocColor(doc);
    const patient = getPatientNameFromEvent(ev);
    const meta    = getEventMeta(ev);
    const isNP    = meta.visit_type === '初診';
    const bgRow   = i % 2 === 0 ? '#fff' : '#f7faf9';
    return `<tr style="background:${bgRow}">
      <td style="color:#555;font-size:10pt;white-space:nowrap;">${t}</td>
      <td style="color:${col.bg};font-weight:700;">${escHtml(doc?.name || '')}</td>
      <td style="font-weight:700;">${escHtml(patient)}${isNP ? ' <span style="font-size:8pt;background:#e74c3c;color:#fff;border-radius:3px;padding:1px 4px;vertical-align:middle;">NP</span>' : ''}</td>
      <td style="color:#444;">${escHtml(meta.complaint || '')}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="zh-TW"><head>
<meta charset="UTF-8">
<title>雅言牙醫診所 ${dateLabel}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'PingFang TC','Microsoft JhengHei',sans-serif;padding:16mm 18mm;color:#222;font-size:11pt}
  .hd{text-align:center;border-bottom:2.5px solid #4a9b8e;padding-bottom:12px;margin-bottom:16px}
  .clinic{font-size:17pt;font-weight:800;color:#2d5a54;letter-spacing:2px}
  .date{font-size:12pt;color:#444;margin-top:5px}
  .sub{font-size:10pt;color:#666;margin-top:3px}
  .count{font-size:9.5pt;color:#888;margin-top:3px}
  table{width:100%;border-collapse:collapse;margin-top:4px}
  th{background:#4a9b8e;color:#fff;padding:8px 10px;font-size:10pt;text-align:left;font-weight:700}
  td{padding:7px 10px;border-bottom:1px solid #e5eeec;vertical-align:top}
  .print-btn{margin-bottom:14px;padding:7px 22px;background:#4a9b8e;color:#fff;border:none;border-radius:8px;font-size:11pt;cursor:pointer;font-family:inherit}
  .footer{margin-top:18px;text-align:right;font-size:8.5pt;color:#bbb}
  @media print{.print-btn{display:none}tr{page-break-inside:avoid}}
</style></head><body>
<div class="hd">
  <div class="clinic">雅言牙醫診所</div>
  <div class="date">${dateLabel}</div>
  <div class="sub">${escHtml(docLabel)}</div>
  <div class="count">共 ${sorted.length} 位患者</div>
</div>
<button class="print-btn" onclick="window.print()">列印</button>
<table>
  <thead><tr>
    <th style="width:110px">時間</th>
    <th style="width:110px">醫師</th>
    <th style="width:90px">患者</th>
    <th>主訴</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">列印時間：${new Date().toLocaleString('zh-TW')}</div>
</body></html>`;
}

// 顯示醫師選擇對話框，選好後列印
function showPrintDialog(date, events) {
  const allEvents = [...events].filter(ev => ev.start?.dateTime);
  if (!allEvents.length) { showToast('此日沒有約診資料', true); return; }

  // 找出當天出現的醫師（依順序去重）
  const docMap = new Map();
  allEvents.forEach(ev => {
    const doc = getDocFromSummary(ev.summary || '', ev);
    const name = doc?.name || '未知';
    if (!docMap.has(name)) docMap.set(name, getDocColor(doc));
  });
  const docEntries = [...docMap.entries()]; // [[name, col], ...]

  const checkboxes = docEntries.map(([name, col]) => `
    <label class="print-doc-chip" style="--doc-color:${col.bg};--doc-light:${col.light}">
      <input type="checkbox" name="printDoc" value="${escHtml(name)}" checked />
      <span>${escHtml(name)}</span>
    </label>`).join('');

  const box = document.querySelector('.modal-box');
  box.innerHTML = `
    <div class="edit-box">
      <h4><i class="fa-solid fa-print"></i> 選擇列印範圍</h4>
      <p style="font-size:12px;color:var(--text-sub);margin:6px 0 14px;">可多選，勾選的醫師才會印出</p>
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <button class="btn-note-save" onclick="toggleAllPrintDocs(true)">全選</button>
        <button class="btn-note-save" style="margin-left:6px;" onclick="toggleAllPrintDocs(false)">全消</button>
      </div>
      <div class="print-doc-list">${checkboxes}</div>
      <div class="confirm-actions" style="margin-top:20px;">
        <button class="btn-cancel-no" onclick="closeModal()">取消</button>
        <button class="btn-primary" style="padding:9px 28px;font-size:13px;"
          onclick="doPrint('${date}')"><i class="fa-solid fa-print"></i> 列印</button>
      </div>
    </div>`;

  // 暫存事件資料供 doPrint 使用
  window._printEvents = events;
  document.getElementById('successModal').classList.add('open');
}

function toggleAllPrintDocs(checked) {
  document.querySelectorAll('input[name="printDoc"]').forEach(cb => cb.checked = checked);
}

function doPrint(date) {
  const selected = [...document.querySelectorAll('input[name="printDoc"]:checked')]
    .map(cb => cb.value);
  if (!selected.length) { showToast('請至少選擇一位醫師', true); return; }
  // 若全選則傳 null（不篩選）
  const allNames = [...document.querySelectorAll('input[name="printDoc"]')].map(cb => cb.value);
  const filterDocs = selected.length === allNames.length ? null : selected;
  const html = buildPrintHtml(date, window._printEvents || [], filterDocs);
  if (!html) return;
  closeModal();
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// 新增約診頁面的列印按鈕
async function printDayList() {
  const date = document.getElementById('date').value;
  if (!date) { showToast('請先選擇日期', true); return; }
  try {
    const res = await fetch(`${API}/api/appointments?date=${date}`);
    const evs = await res.json();
    showPrintDialog(date, evs);
  } catch { showToast('載入失敗', true); }
}

// 月曆頁面的列印按鈕
async function printCalDay() {
  if (!calSelectedDate) { showToast('請先點選日期', true); return; }
  try {
    const res = await fetch(`${API}/api/appointments?date=${calSelectedDate}`);
    const evs = await res.json();
    showPrintDialog(calSelectedDate, evs);
  } catch { showToast('載入失敗', true); }
}
