const STORAGE_KEY = "mi_entreno_iphone_final_v2";

const $daysList = document.getElementById("daysList");
const $dayView  = document.getElementById("dayView");

const $btnAddDay = document.getElementById("btnAddDay");
const $btnReset  = document.getElementById("btnReset");
const $btnExport = document.getElementById("btnExport");
const $btnImport = document.getElementById("btnImport");

const $modal = document.getElementById("modal");
const $modalTitle = document.getElementById("modalTitle");
const $modalLabel = document.getElementById("modalLabel");
const $modalInput = document.getElementById("modalInput");
const $fileInput  = document.getElementById("fileInput");
const $globalTimer = document.getElementById("globalTimer");
const $timerMode = document.getElementById("timerMode");
const $timerModeLabel = document.getElementById("timerModeLabel");
const $timerReset = document.getElementById("timerReset");

/* Bulk paste modal */
const $bulkModal = document.getElementById("bulkModal");
const $bulkText  = document.getElementById("bulkText");

/* ✅ modo vista */
let viewMode = "workout"; // "workout" | "weight"
let habitCalSelectedDate = null;
let progressView = "charts"; // "charts" | "history"
let progressHistoryType = null; // "weight" | "sleep" | "eat"
let progressHistoryFrom = "";
let progressHistoryTo = "";

const REST_MODE_KEY = "mi_entreno_rest_mode";
let restModeMinutes = Number(localStorage.getItem(REST_MODE_KEY)) === 3 ? 3 : 1.5;

let state = loadState();
let selectedDayId = state.days[0]?.id ?? null;

/* ===== Calendario (mes visible) ===== */
let calView = { y: new Date().getFullYear(), m: new Date().getMonth() };

/* ===== Descanso (global) ===== */
let restTicker = null;
let globalTimerEndAt = null;

/* ================= UTIL ================= */

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return { days: [], history: [], weights: [], habits: [], habitLogs: [] };

    const parsed = JSON.parse(raw);
    if(!parsed?.days) parsed.days = [];
    if(!Array.isArray(parsed.history)) parsed.history = [];
    if(!Array.isArray(parsed.weights)) parsed.weights = [];
    if(!Array.isArray(parsed.habits)) parsed.habits = [];
    if(!Array.isArray(parsed.habitLogs)) parsed.habitLogs = [];
    return parsed;
  }catch{
    return { days: [], history: [], weights: [], habits: [], habitLogs: [] };
  }
}

function findDay(id){
  return state.days.find(d => d.id === id) ?? null;
}

function blankSet(){
  return { series:"", reps:"", kg:"", rir:"" };
}

function normalizeExerciseConfig(ex){
  let changed = false;
  if(typeof ex.seriesCount !== "number"){
    ex.seriesCount = 0;
    changed = true;
  }
  const rm = Number(ex.restMinutes);
  if(rm !== 1.5 && rm !== 3){
    ex.restMinutes = 1.5;
    changed = true;
  }
  return changed;
}

function normalizeStateExercises(){
  let changed = false;
  for(const day of state.days || []){
    for(const ex of day.exercises || []){
      if(normalizeExerciseConfig(ex)) changed = true;
    }
  }
  if(changed) saveState();
}

function normalizeHabits(){
  if(!Array.isArray(state.habits)) state.habits = [];
  if(!Array.isArray(state.habitLogs)) state.habitLogs = [];
  syncHabitLogs();
}

function esc(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;");
}

function openPrompt({ title, label, placeholder="", value="" }){
  $modalTitle.textContent = title;
  $modalLabel.textContent = label;
  $modalInput.placeholder = placeholder;
  $modalInput.value = value;

  $modal.showModal();
  $modalInput.focus();

  return new Promise(resolve=>{
    $modal.addEventListener("close", ()=>{
      if($modal.returnValue === "cancel") return resolve(null);
      const v = $modalInput.value.trim();
      resolve(v || null);
    }, { once:true });
  });
}

function nowISO(){
  return new Date().toISOString();
}

function fmtDateTime(iso){
  const d = new Date(iso);
  const yy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  const hh = String(d.getHours()).padStart(2,"0");
  const mi = String(d.getMinutes()).padStart(2,"0");
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

function cloneWorkoutDay(day){
  return {
    name: day.name,
    exercises: (day.exercises || []).map(ex => ({
      name: ex.name,
      restMinutes: ex.restMinutes,
      seriesCount: ex.seriesCount,
      note: ex.note || "",
      sets: (ex.sets || []).map(s => ({
        series: s.series ?? "",
        reps:   s.reps ?? "",
        kg:     s.kg ?? "",
        rir:    s.rir ?? ""
      }))
    }))
  };
}

function resetExerciseSeriesCounts(day){
  let changed = false;
  for(const ex of day?.exercises || []){
    if(typeof ex.seriesCount === "number" && ex.seriesCount !== 0){
      ex.seriesCount = 0;
      changed = true;
    }
  }
  return changed;
}

function formatTimer(ms){
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function updateTimerModeUI(){
  if(!$timerMode || !$timerModeLabel) return;
  const isThree = restModeMinutes === 3;
  $timerMode.setAttribute("aria-pressed", isThree ? "true" : "false");
  $timerModeLabel.textContent = isThree ? "3" : "1.5";
}

function updateRestTimers(){
  const now = Date.now();
  if(!$globalTimer) return;

  if(!globalTimerEndAt){
    $globalTimer.textContent = "--:--";
    $globalTimer.classList.remove("globalTimer--active");
    if(restTicker){
      clearInterval(restTicker);
      restTicker = null;
    }
    return;
  }

  const ms = globalTimerEndAt - now;
  if(ms <= 0){
    globalTimerEndAt = null;
    $globalTimer.textContent = "Listo";
    $globalTimer.classList.remove("globalTimer--active");
    if(restTicker){
      clearInterval(restTicker);
      restTicker = null;
    }
    return;
  }

  $globalTimer.textContent = formatTimer(ms);
  $globalTimer.classList.add("globalTimer--active");
}

function startRestTimer(exId, minutes){
  globalTimerEndAt = Date.now() + (minutes * 60 * 1000);
  if(!restTicker) restTicker = setInterval(updateRestTimers, 1000);
  updateRestTimers();
}

function linePoints(values, w, h, padding){
  const nums = values.filter(v=> typeof v === "number" && isFinite(v));
  if(nums.length === 0) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = (max - min) || 1;
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;
  return values.map((v, i)=>{
    if(typeof v !== "number" || !isFinite(v)) return null;
    const x = padding + (innerW * (i / Math.max(1, values.length - 1)));
    const y = padding + innerH - ((v - min) / span) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(" ");
}

function lineChartHTML(values, label, key){
  const w = 320;
  const h = 120;
  const padding = 10;
  const pts = linePoints(values, w, h, padding);
  const last = values.slice().reverse().find(v=> typeof v === "number" && isFinite(v));
  const nums = values.filter(v=> typeof v === "number" && isFinite(v));
  const min = nums.length ? Math.min(...nums) : null;
  const max = nums.length ? Math.max(...nums) : null;
  const fmt = (n)=>{
    if(typeof n !== "number" || !isFinite(n)) return "-";
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };
  const k = (key ?? "").toString();
  return `
    <div class="lineChart" data-chart="${esc(k)}" role="button" tabindex="0">
      <div class="lineChart__head">
        <div class="lineChart__label">${esc(label)}</div>
        <div class="lineChart__value">${last ?? "-"}</div>
      </div>
      <div class="lineChart__stats">
        <span>Min: <b>${esc(fmt(min))}</b></span>
        <span>Máx: <b>${esc(fmt(max))}</b></span>
        <span>Actual: <b>${esc(fmt(last))}</b></span>
      </div>
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="lineChart__svg">
        <rect x="0" y="0" width="${w}" height="${h}" rx="10" ry="10" class="lineChart__bg"></rect>
        ${pts ? `<polyline points="${pts}" class="lineChart__line"></polyline>` : ""}
      </svg>
    </div>
  `;
}

/* ===== Calendario helpers ===== */
function ymdLocal(dateObj){
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth()+1).padStart(2,"0");
  const d = String(dateObj.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function ymdFromISO(iso){
  return ymdLocal(new Date(iso));
}
function monthLabel(y,m){
  const names = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return `${names[m]} ${y}`;
}

function latestHistoryEntryForDate(key){
  const list = (state.history || []).filter(e => ymdFromISO(e.at) === key);
  if(!list.length) return null;
  return list.slice().sort((a,b)=> new Date(b.at) - new Date(a.at))[0];
}

function getHabitLog(key){
  return (state.habitLogs || []).find(h => h.date === key) ?? null;
}

function syncHabitLogs(){
  if(!Array.isArray(state.habitLogs)) state.habitLogs = [];
  if(!Array.isArray(state.habits)) state.habits = [];

  const habitIds = new Set(state.habits.map(h=> h.id));

  state.habitLogs = state.habitLogs.map(log=>{
    const map = new Map((log.habits || []).map(h=> [h.id, h.done]));
    const habits = state.habits.map(h=> ({
      id: h.id,
      name: h.name,
      done: !!map.get(h.id)
    }));
    return { date: log.date, habits };
  }).filter(log => log.habits.some(h=> habitIds.has(h.id)));
}

function ensureHabitLog(key){
  let log = getHabitLog(key);
  if(log) return log;

  const base = latestHistoryEntryForDate(key)?.habits || [];
  const baseMap = new Map(base.map(h=> [h.id, !!h.done]));

  const habits = (state.habits || []).map(h=> ({
    id: h.id,
    name: h.name,
    done: !!baseMap.get(h.id)
  }));

  log = { date: key, habits };
  state.habitLogs.push(log);
  return log;
}

/* detalle en página */
function workoutText(item){
  const sleep = (typeof item.sleepScore === "number") ? `${item.sleepScore}/10` : "-";
  const eat   = (typeof item.eatScore === "number") ? `${item.eatScore}/10` : "-";

  const lines = [];
  lines.push(`${item.dayName} - ${fmtDateTime(item.at)}`);
  lines.push(`Dormí: ${sleep} · Comí: ${eat}`);

  const w = item.workout || { exercises: [] };
  for(const ex of (w.exercises || [])){
    lines.push("");
    lines.push(String(ex.name || "Ejercicio"));
    for(const s of (ex.sets || [])){
      const parts = [];
      if(s.series) parts.push(`${s.series}x`);
      if(s.reps) parts.push(`${s.reps}`);
      if(s.kg) parts.push(`@${s.kg}kg`);
      if(s.rir) parts.push(`RIR${s.rir}`);
      const line = parts.join(" ").trim();
      if(line) lines.push(`- ${line}`);
    }
    const note = (ex.note || "").trim();
    if(note) lines.push(`Nota: ${note}`);
  }

  return lines.join("\n").trim();
}

async function copyText(text){
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch{}

  try{
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }catch{
    return false;
  }
}

function workoutDetailsHTML(item){
  const sleep = (typeof item.sleepScore === "number") ? `${item.sleepScore}/10` : "-";
  const eat   = (typeof item.eatScore === "number") ? `${item.eatScore}/10` : "-";

  const w = item.workout || { exercises: [] };
  const exHTML = (w.exercises || []).map(ex=>{
    const setsHTML = (ex.sets || []).map(s=>{
      const series = esc(s.series ?? "");
      const reps   = esc(s.reps ?? "");
      const kg     = esc(s.kg ?? "");
      const rir    = esc(s.rir ?? "");

      const left = series ? `${series}x` : "";
      const mid  = reps ? `${reps}` : "";
      const right= kg ? `@${kg}kg` : "";
      const tail = rir ? ` RIR${rir}` : "";

      return `<div class="dayItem__small">• ${esc(`${left}${mid} ${right}${tail}`.trim())}</div>`;
    }).join("");

    const note = (ex.note || "").trim();
    const noteHTML = note ? `<div class="dayItem__small">Nota: ${esc(note)}</div>` : "";

    return `
      <div class="card" style="padding:10px;">
        <div style="font-weight:900; font-size:14px;">${esc(ex.name)}</div>
        <div style="margin-top:6px; display:flex; flex-direction:column; gap:4px;">
          ${setsHTML || `<div class="dayItem__small">Sin líneas</div>`}
          ${noteHTML}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="card" style="padding:12px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
        <div>
          <div style="font-weight:900; font-size:16px;">${esc(item.dayName)}</div>
          <div class="muted">${esc(fmtDateTime(item.at))}</div>
          <div class="muted">Dormí: ${esc(sleep)} · Comí: ${esc(eat)}</div>
        </div>
        <button class="btn btn--danger" data-close-detail>✕</button>
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${exHTML || `<div class="empty">Sin ejercicios guardados.</div>`}
    </div>
  `;
}

function renderCalendarForDay(day, hostEl){
  const y = calView.y;
  const m = calView.m;

  const first = new Date(y, m, 1);
  const last  = new Date(y, m+1, 0);

  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = last.getDate();

  const entries = (state.history || []).filter(h => h.dayId === day.id);
  const map = new Map();
  for(const e of entries){
    const key = ymdFromISO(e.at);
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }

  hostEl.innerHTML = `
    <div class="cal">
      <div class="calHead">
        <button id="calPrev" class="btn">◀</button>
        <div class="calTitle">${monthLabel(y,m)}</div>
        <button id="calNext" class="btn">▶</button>
      </div>

      <div class="calGrid">
        <div class="calDow">L</div><div class="calDow">M</div><div class="calDow">X</div><div class="calDow">J</div><div class="calDow">V</div><div class="calDow">S</div><div class="calDow">D</div>
      </div>

      <div id="calCells" class="calGrid" style="margin-top:8px;"></div>
      <div id="calDetailList" class="calList"></div>
      <div id="calDetailView" style="margin-top:10px; display:none;"></div>
    </div>
  `;

  const $cells     = hostEl.querySelector("#calCells");
  const $detailLst = hostEl.querySelector("#calDetailList");
  const $detailVw  = hostEl.querySelector("#calDetailView");

  function showDetail(item){
    $detailVw.style.display = "";
    $detailVw.innerHTML = workoutDetailsHTML(item);

    $detailVw.querySelector("[data-close-detail]").onclick = () => {
      $detailVw.style.display = "none";
      $detailVw.innerHTML = "";
    };
  }

  function renderDayEntriesList(key, list){
    if(!list.length){
      $detailLst.innerHTML = `<div class="pill">Sin registros el ${esc(key)}</div>`;
      $detailVw.style.display = "none";
      $detailVw.innerHTML = "";
      return;
    }

    $detailLst.innerHTML = list.map(e => {
      const sleep = (typeof e.sleepScore === "number") ? `${e.sleepScore}/10` : "-";
      const eat   = (typeof e.eatScore === "number") ? `${e.eatScore}/10` : "-";
      return `
        <div class="calItem">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <div><b>${esc(fmtDateTime(e.at))}</b></div>
              <div class="calItemSmall">Dormí: ${esc(sleep)} · Comí: ${esc(eat)}</div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
              <button class="btn" data-view="${esc(e.id)}">Ver</button>
              <button class="btn" data-copy="${esc(e.id)}">Copiar</button>
              <button class="btn btn--danger" data-del="${esc(e.id)}">✕</button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    $detailLst.querySelectorAll("[data-view]").forEach(btn=>{
      btn.onclick = () => {
        const id = btn.getAttribute("data-view");
        const item = (state.history || []).find(h => h.id === id);
        if(!item) return;
        showDetail(item);
        $detailVw.scrollIntoView({ behavior:"smooth", block:"start" });
      };
    });

    $detailLst.querySelectorAll("[data-del]").forEach(btn=>{
      btn.onclick = () => {
        const id = btn.getAttribute("data-del");
        if(!confirm("¿Borrar este registro?")) return;
        state.history = (state.history || []).filter(h => h.id !== id);
        saveState();
        render();
      };
    });

    $detailLst.querySelectorAll("[data-copy]").forEach(btn=>{
      btn.onclick = async () => {
        const id = btn.getAttribute("data-copy");
        const item = (state.history || []).find(h => h.id === id);
        if(!item) return;
        const ok = await copyText(workoutText(item));
        if(!ok) alert("No se pudo copiar.");
      };
    });
  }

  for(let i=0;i<startDow;i++){
    const c = document.createElement("div");
    c.className = "calCell calCell--off";
    $cells.appendChild(c);
  }

  for(let d=1; d<=daysInMonth; d++){
    const dt = new Date(y, m, d);
    const key = ymdLocal(dt);
    const list = map.get(key) || [];

    const cell = document.createElement("div");
    cell.className = "calCell";
    cell.innerHTML = `
      <button data-key="${key}">
        <div class="calDayRow">
          <div class="calDayNum">${d}</div>
          ${list.length ? `<div class="calBadge">${list.length}</div>` : ``}
        </div>
      </button>
    `;

    cell.querySelector("button").onclick = () => {
      renderDayEntriesList(key, list);
      $detailLst.scrollIntoView({ behavior:"smooth", block:"start" });
    };

    $cells.appendChild(cell);
  }

  hostEl.querySelector("#calPrev").onclick = () => {
    calView.m--;
    if(calView.m < 0){ calView.m = 11; calView.y--; }
    render();
  };

  hostEl.querySelector("#calNext").onclick = () => {
    calView.m++;
    if(calView.m > 11){ calView.m = 0; calView.y++; }
    render();
  };

  $detailLst.innerHTML = `<div class="pill">Tocá un día para ver registros</div>`;
}

function renderHabitsCalendar(hostEl){
  const y = calView.y;
  const m = calView.m;
  const first = new Date(y, m, 1);
  const last  = new Date(y, m+1, 0);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = last.getDate();

  const entries = (state.history || []);
  const map = new Map();
  for(const e of entries){
    const key = ymdFromISO(e.at);
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }

  hostEl.innerHTML = `
    <div class="cal">
      <div class="calHead">
        <button id="habCalPrev" class="btn">◀</button>
        <div class="calTitle">${monthLabel(y,m)}</div>
        <button id="habCalNext" class="btn">▶</button>
      </div>

      <div class="calGrid">
        <div class="calDow">L</div><div class="calDow">M</div><div class="calDow">X</div><div class="calDow">J</div><div class="calDow">V</div><div class="calDow">S</div><div class="calDow">D</div>
      </div>

      <div id="habCalCells" class="calGrid" style="margin-top:8px;"></div>
      <div id="habCalDetail" class="calList"></div>
    </div>
  `;

  const $cells = hostEl.querySelector("#habCalCells");
  const $detail = hostEl.querySelector("#habCalDetail");

  function latestEntryForDate(key){
    const list = map.get(key) || [];
    if(!list.length) return null;
    return list.slice().sort((a,b)=> new Date(b.at) - new Date(a.at))[0];
  }

  function habitsForDate(key){
    const log = getHabitLog(key);
    if(log && Array.isArray(log.habits)) return log.habits;

    const entry = latestEntryForDate(key);
    if(entry && Array.isArray(entry.habits)) return entry.habits;

    return [];
  }

  function renderDetail(key){
    habitCalSelectedDate = key;

    if(!state.habits.length){
      $detail.innerHTML = `<div class="pill">No hay hábitos creados.</div>`;
      return;
    }

    const log = ensureHabitLog(key);
    const rows = (log.habits || []).map(h=>{
      return `
        <div class="calItem">
          <div class="habitRow">
            <span class="habitName">${esc(h.name || "")}</span>
            <button class="habitCheck ${h.done ? "habitCheck--on" : ""}" data-habit-date="${esc(key)}" data-habit-id="${esc(h.id)}" aria-pressed="${h.done ? "true" : "false"}"></button>
          </div>
        </div>
      `;
    }).join("");
    $detail.innerHTML = rows;

    $detail.querySelectorAll("[data-habit-date][data-habit-id]").forEach(btn=>{
      btn.onclick = ()=>{
        const date = btn.getAttribute("data-habit-date");
        const id = btn.getAttribute("data-habit-id");
        const log = ensureHabitLog(date);
        const target = (log.habits || []).find(x=> x.id === id);
        if(!target) return;
        target.done = !target.done;
        saveState();
        render();
      };
    });
  }

  for(let i=0;i<startDow;i++){
    const c = document.createElement("div");
    c.className = "calCell calCell--off";
    $cells.appendChild(c);
  }

  for(let d=1; d<=daysInMonth; d++){
    const dt = new Date(y, m, d);
    const key = ymdLocal(dt);
    const habits = habitsForDate(key);
    const total = habits.length;
    const done = habits.filter(h=> h.done).length;

    const cell = document.createElement("div");
    cell.className = "calCell";
    cell.innerHTML = `
      <button data-key="${key}">
        <div class="calDayRow">
          <div class="calDayNum">${d}</div>
          ${total ? `<div class="calBadge">${done}/${total}</div>` : ``}
        </div>
      </button>
    `;
    cell.querySelector("button").onclick = ()=> renderDetail(key);
    $cells.appendChild(cell);
  }

  hostEl.querySelector("#habCalPrev").onclick = () => {
    calView.m--;
    if(calView.m < 0){ calView.m = 11; calView.y--; }
    render();
  };

  hostEl.querySelector("#habCalNext").onclick = () => {
    calView.m++;
    if(calView.m > 11){ calView.m = 0; calView.y++; }
    render();
  };

  if(habitCalSelectedDate){
    renderDetail(habitCalSelectedDate);
  }else{
    $detail.innerHTML = `<div class="pill">Tocá un día para ver hábitos</div>`;
  }
}

/* ============ BULK IMPORT HELPERS ============ */

function normalizeSet(s){
  const series = (s?.series ?? "").toString();
  const reps   = (s?.reps ?? "").toString();
  const kg     = (s?.kg ?? "").toString();
  const rir    = (s?.rir ?? "").toString();
  return { series, reps, kg, rir };
}

function normalizeExercise(ex){
  const name = (ex?.name ?? "").toString().trim();
  if(!name) return null;

  const note = (ex?.note ?? "").toString();
  const setsIn = Array.isArray(ex?.sets) ? ex.sets : [];
  const sets = setsIn.length ? setsIn.map(normalizeSet) : [blankSet()];

  const restMinutes = Number(ex?.restMinutes) === 3 ? 3 : 1.5;
  const seriesCount = typeof ex?.seriesCount === "number" ? ex.seriesCount : 0;

  return { id: uid(), name, note, sets, restMinutes, seriesCount };
}

function parseBulk(text){
  const cleaned = text.trim();
  const parsed = JSON.parse(cleaned);

  if(Array.isArray(parsed)) return parsed.map(normalizeExercise).filter(Boolean);
  if(parsed && Array.isArray(parsed.exercises)) return parsed.exercises.map(normalizeExercise).filter(Boolean);
  if(parsed && Array.isArray(parsed.days) && parsed.days[0]?.exercises) return parsed.days[0].exercises.map(normalizeExercise).filter(Boolean);

  throw new Error("Formato no reconocido. Pegá un array de ejercicios o {exercises:[...]}");
}

/* ================= PANTALLAS (tabs) ================= */

function showDays(){
  const tabDays = document.getElementById("tabDays");
  const tabRoutine = document.getElementById("tabRoutine");
  const screenDays = document.getElementById("screenDays");
  const screenRoutine = document.getElementById("screenRoutine");
  if(!tabDays || !tabRoutine || !screenDays || !screenRoutine) return;

  tabDays.classList.add("tab--active");
  tabRoutine.classList.remove("tab--active");
  screenDays.hidden = false;
  screenRoutine.hidden = true;
}

function showRoutine(){
  const tabDays = document.getElementById("tabDays");
  const tabRoutine = document.getElementById("tabRoutine");
  const screenDays = document.getElementById("screenDays");
  const screenRoutine = document.getElementById("screenRoutine");
  if(!tabDays || !tabRoutine || !screenDays || !screenRoutine) return;

  tabRoutine.classList.add("tab--active");
  tabDays.classList.remove("tab--active");
  screenDays.hidden = true;
  screenRoutine.hidden = false;
}

function goToRoutineScreen(){
  showRoutine();
}

/* ================= PESO VIEW ================= */

function toKgNumber(input){
  const raw = (input ?? "").toString().trim().replace(",", ".");
  const n = Number(raw);
  if(!isFinite(n)) return null;
  return n;
}

function renderWeightView(){
  const items = Array.isArray(state.weights) ? state.weights.slice() : [];
  items.sort((a,b)=> new Date(b.at) - new Date(a.at));
  normalizeHabits();

  const last = items[0]?.kg;
  const prev = items[1]?.kg;
  const delta = (typeof last === "number" && typeof prev === "number") ? (last - prev) : null;

  const weightSeries = items.slice(0, 12).reverse().map(x=> typeof x.kg === "number" ? Number(x.kg.toFixed(1)) : null);
  const sleepSeries = (state.history || []).slice(0, 12).reverse().map(x=> typeof x.sleepScore === "number" ? x.sleepScore : null);
  const eatSeries = (state.history || []).slice(0, 12).reverse().map(x=> typeof x.eatScore === "number" ? x.eatScore : null);

  $dayView.className = "";
  let progressInner = `
    ${lineChartHTML(weightSeries, "Peso", "weight")}
    ${lineChartHTML(sleepSeries, "Sueño", "sleep")}
    ${lineChartHTML(eatSeries, "Comida", "eat")}
    <div class="muted" style="margin-top:8px;">Tocá un gráfico para ver el historial.</div>
  `;

  if(progressView === "history" && progressHistoryType){
    const title = progressHistoryType === "weight" ? "Historial de peso"
                : progressHistoryType === "sleep" ? "Historial de sueño"
                : "Historial de comida";

    progressInner = `
      <div class="progressHistory">
        <div class="progressHistory__head">
          <div class="progressHistory__title">${esc(title)}</div>
          <button id="progressBack" class="btn">Volver a gráficos</button>
        </div>
        <div class="progressHistory__filters">
          <input id="progressFrom" class="input input--date" type="date" value="${esc(progressHistoryFrom)}">
          <input id="progressTo" class="input input--date" type="date" value="${esc(progressHistoryTo)}">
        </div>
        <div id="progressHistoryList"></div>
      </div>
    `;
  }

  $dayView.innerHTML = `
    <div class="dayHeader">
      <div class="dayTitle">
        <div class="dayTitle__label">Sección</div>
        <div class="dayTitle__name">Progrs</div>
      </div>

      <div class="row">
        <button id="backToWorkout" class="btn">Volver</button>
        <button id="addWeightEntry" class="btn btn--primary">+ Registrar kg</button>
      </div>
    </div>

    <div class="card" style="padding:12px;">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div>
          <div class="muted">Último</div>
          <div style="font-weight:900; font-size:20px;">${typeof last === "number" ? esc(last.toFixed(1)) + " kg" : "-"}</div>
        </div>
        <div>
          <div class="muted">Cambio vs anterior</div>
          <div style="font-weight:900; font-size:16px;">${delta === null ? "-" : esc((delta>=0?"+":"") + delta.toFixed(1)) + " kg"}</div>
        </div>
        <div>
          <div class="muted">Registros</div>
          <div style="font-weight:900; font-size:16px;">${items.length}</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:12px;">
      <div style="font-weight:900; margin-bottom:10px;">Evolución (lineal)</div>
      ${progressInner}
    </div>

    <div class="card" style="padding:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div style="font-weight:900;">Hábitos</div>
        <button id="addHabit" class="btn btn--primary">+ Hábito</button>
      </div>
      <div id="habitList" style="margin-top:10px;"></div>
      <div class="muted" style="margin-top:6px;">Marcá hábitos en el último entrenamiento guardado.</div>
    </div>

    <div class="card" style="padding:12px;">
      <div style="font-weight:900; margin-bottom:10px;">Calendario de hábitos</div>
      <div id="habitCalendar"></div>
    </div>
  `;

  document.getElementById("backToWorkout").onclick = ()=>{
    viewMode = "workout";
    render();
  };

  if(progressView === "charts"){
    document.querySelectorAll(".lineChart[data-chart]").forEach(el=>{
      const key = el.getAttribute("data-chart");
      if(!key) return;
      el.onclick = ()=> {
        progressView = "history";
        progressHistoryType = key;
        render();
      };
      el.onkeydown = (e)=>{
        if(e.key === "Enter" || e.key === " "){
          e.preventDefault();
          progressView = "history";
          progressHistoryType = key;
          render();
        }
      };
    });
  }else{
    const backBtn = document.getElementById("progressBack");
    if(backBtn){
      backBtn.onclick = ()=>{
        progressView = "charts";
        progressHistoryType = null;
        render();
      };
    }

    const fromInput = document.getElementById("progressFrom");
    const toInput = document.getElementById("progressTo");
    if(fromInput){
      fromInput.oninput = ()=>{
        progressHistoryFrom = fromInput.value;
        render();
      };
    }
    if(toInput){
      toInput.oninput = ()=>{
        progressHistoryTo = toInput.value;
        render();
      };
    }

    const list = document.getElementById("progressHistoryList");
    if(list && progressHistoryType){
      const from = progressHistoryFrom || "";
      const to = progressHistoryTo || "";
      const inRange = (iso)=>{
        const d = ymdFromISO(iso);
        if(from && d < from) return false;
        if(to && d > to) return false;
        return true;
      };

      if(progressHistoryType === "weight"){
        const items = (state.weights || []).filter(x=> x?.at && inRange(x.at));
        if(!items.length){
          list.innerHTML = `<div class="empty">No hay registros en ese rango.</div>`;
        }else{
          list.innerHTML = items.map(it=>`
            <div class="calItem">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <div>
                  <div><b>${esc(String(it.kg ?? "-"))} kg</b></div>
                  <div class="calItemSmall">${esc(fmtDateTime(it.at))}</div>
                </div>
                <button class="btn btn--danger" type="button" data-wdel="${esc(it.id)}">✕</button>
              </div>
            </div>
          `).join("");

          list.querySelectorAll("[data-wdel]").forEach(btn=>{
            btn.onclick = () => {
              const id = btn.getAttribute("data-wdel");
              if(!confirm("¿Borrar este peso?")) return;
              state.weights = (state.weights || []).filter(x => x.id !== id);
              saveState();
              render();
            };
          });
        }
      }else if(progressHistoryType === "sleep"){
        const items = (state.history || []).filter(h => typeof h.sleepScore === "number" && h?.at && inRange(h.at));
        if(!items.length){
          list.innerHTML = `<div class="empty">No hay registros en ese rango.</div>`;
        }else{
          list.innerHTML = items.map(it=>`
            <div class="calItem">
              <div>
                <div><b>${esc(String(it.sleepScore ?? "-"))}/10</b></div>
                <div class="calItemSmall">${esc(fmtDateTime(it.at))}</div>
              </div>
            </div>
          `).join("");
        }
      }else if(progressHistoryType === "eat"){
        const items = (state.history || []).filter(h => typeof h.eatScore === "number" && h?.at && inRange(h.at));
        if(!items.length){
          list.innerHTML = `<div class="empty">No hay registros en ese rango.</div>`;
        }else{
          list.innerHTML = items.map(it=>`
            <div class="calItem">
              <div>
                <div><b>${esc(String(it.eatScore ?? "-"))}/10</b></div>
                <div class="calItemSmall">${esc(fmtDateTime(it.at))}</div>
              </div>
            </div>
          `).join("");
        }
      }
    }
  }

  document.getElementById("addWeightEntry").onclick = async () => {
    const raw = await openPrompt({
      title:"Registrar peso corporal",
      label:"Kg (ej: 65.4)",
      placeholder:"Ej: 65.4"
    });
    if(!raw) return;

    const kg = toKgNumber(raw);
    if(kg === null || kg <= 0 || kg > 400){
      alert("Ingresá un número válido de kg.");
      return;
    }

    state.weights.unshift({ id: uid(), at: nowISO(), kg });
    saveState();
    render();
  };

  const $habitList = document.getElementById("habitList");
  const latestEntry = (state.history || [])[0] || null;
  const latestHabits = latestEntry?.habits || [];

  if(!state.habits.length){
    $habitList.innerHTML = `<div class="empty" style="min-height:80px;">No hay hábitos todavía.</div>`;
  }else{
    $habitList.innerHTML = state.habits.map(h=>{
      return `
        <div class="calItem">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div><b>${esc(h.name)}</b></div>
            <div class="row">
              <button class="btn btn--danger" data-habit-del="${esc(h.id)}">✕</button>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  document.getElementById("addHabit").onclick = async ()=>{
    const name = await openPrompt({
      title:"Nuevo hábito",
      label:"Nombre",
      placeholder:"Ej: 10k pasos"
    });
    if(!name) return;
    state.habits.push({ id: uid(), name });
    syncHabitLogs();
    saveState();
    render();
  };

  $habitList.querySelectorAll("[data-habit-del]").forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.getAttribute("data-habit-del");
      if(!confirm("¿Borrar hábito?")) return;
      state.habits = (state.habits || []).filter(h=> h.id !== id);
      syncHabitLogs();
      saveState();
      render();
    };
  });

  const habitCalendar = document.getElementById("habitCalendar");
  if(habitCalendar) renderHabitsCalendar(habitCalendar);
}

/* ================= WORKOUT VIEW ================= */

function renderWorkoutView(){
  const day = selectedDayId ? findDay(selectedDayId) : null;

  if(!day){
    $dayView.className = "empty";
    $dayView.textContent = "Elegí un día.";
    return;
  }

  $dayView.className = "";
  $dayView.innerHTML = `
    <div class="dayHeader">
      <div class="dayTitle">
        <div class="dayTitle__label">Día</div>
        <div class="dayTitle__name">${esc(day.name)}</div>
      </div>

      <div class="row">
        <button id="bulkLoad" class="btn">Cargar ejercicios</button>
        <button id="addExercise" class="btn btn--primary">+ Ejercicio</button>
      </div>
    </div>

    <div id="exercises"></div>

    <div style="margin-top:14px; display:flex; flex-direction:column; gap:10px;">
      <button id="saveWorkout" class="btn btn--primary">Guardar entrenamiento</button>
      <div id="calendarBox"></div>
    </div>
  `;

  document.getElementById("bulkLoad").onclick = () => {
    $bulkText.value = "";
    $bulkModal.showModal();
    $bulkText.focus();

    $bulkModal.addEventListener("close", () => {
      if($bulkModal.returnValue === "cancel") return;

      const text = ($bulkText.value || "").trim();
      if(!text) return;

      try{
        const exercises = parseBulk(text);
        if(!exercises.length){
          alert("No se encontraron ejercicios en el texto.");
          return;
        }

        day.exercises = exercises;
        saveState();
        render();
      }catch(err){
        alert(err?.message || "No pude leer ese JSON.");
      }
    }, { once:true });
  };

  document.getElementById("addExercise").onclick = async ()=>{
    const name = await openPrompt({
      title:"Nuevo ejercicio",
      label:"Nombre",
      placeholder:"Ej: Press banca"
    });
    if(!name) return;

    day.exercises.push({
      id: uid(),
      name,
      note:"",
      sets:[ blankSet() ],
      restMinutes: 1.5,
      seriesCount: 0
    });
    saveState();
    render();
  };

  document.getElementById("saveWorkout").onclick = () => {
    if(!day.exercises.length){
      alert("No hay ejercicios para guardar.");
      return;
    }

    let sleepScore = prompt("¿Qué tan bien dormiste? (1 a 10)");
    if(sleepScore === null) return;
    sleepScore = Number(sleepScore);
    if(isNaN(sleepScore) || sleepScore < 1 || sleepScore > 10){
      alert("Dormir: ingresá un número del 1 al 10");
      return;
    }

    let eatScore = prompt("¿Qué tan bien comiste? (1 a 10)");
    if(eatScore === null) return;
    eatScore = Number(eatScore);
    if(isNaN(eatScore) || eatScore < 1 || eatScore > 10){
      alert("Comida: ingresá un número del 1 al 10");
      return;
    }

    const habits = (state.habits || []).map(h=>{
      const done = confirm(`¿Cumpliste el hábito: ${h.name}?`);
      return { id: h.id, name: h.name, done };
    });

    const entry = {
      id: uid(),
      dayId: day.id,
      dayName: day.name,
      at: nowISO(),
      sleepScore,
      eatScore,
      workout: cloneWorkoutDay(day),
      habits
    };

    state.history.unshift(entry);
    if(resetExerciseSeriesCounts(day)){
      saveState();
    }
    saveState();
    render();
  };

  const host = document.getElementById("exercises");

  if(!day.exercises.length){
    host.innerHTML = `<div class="empty">Sin ejercicios.</div>`;
  } else {
    day.exercises.forEach(ex=>{
      normalizeExerciseConfig(ex);
      const card = document.createElement("div");
      card.className = "exercise";
      card.innerHTML = `
        <div class="exerciseTop">
          <div class="exerciseName">${esc(ex.name)}</div>
          <div class="row">
            <button class="btn" data-r>Renombrar</button>
            <button class="btn btn--danger" data-d>Borrar</button>
          </div>
        </div>

        <div class="setTable"></div>

        <div class="row" style="margin-top:10px">
          <button class="btn btn--primary" data-add>+ Línea</button>
        </div>

        <div class="noteBlock">
          <div class="smallLabel">Notas del ejercicio</div>
          <input class="input" data-note placeholder="Opcional" value="${esc(ex.note || "")}">
        </div>

        <div class="exerciseSeriesRow">
          <div class="seriesCountLabel" data-series-label>Series: ${esc(String(ex.seriesCount ?? 0))}</div>
          <div class="seriesCenter">
            <button class="seriesBtnRound" data-series>+1</button>
          </div>
          <div class="seriesRight">
            <button class="miniReset" data-series-reset type="button" title="Reset series">⟲</button>
            <span class="seriesCheck" data-series-check>✓</span>
            <span class="seriesDoneLabel" data-series-done>Completado</span>
          </div>
        </div>
      `;

      card.querySelector("[data-r]").onclick = async ()=>{
        const n = await openPrompt({
          title:"Renombrar ejercicio",
          label:"Nombre",
          value:ex.name
        });
        if(!n) return;
        ex.name = n;
        saveState();
        render();
      };

      card.querySelector("[data-d]").onclick = ()=>{
        if(!confirm("¿Borrar ejercicio?")) return;
        day.exercises = day.exercises.filter(x=>x.id!==ex.id);
        saveState();
        render();
      };

      const seriesBtn = card.querySelector("[data-series]");
      const seriesLabel = card.querySelector("[data-series-label]");
      const seriesReset = card.querySelector("[data-series-reset]");
      const seriesCheck = card.querySelector("[data-series-check]");
      const seriesDone = card.querySelector("[data-series-done]");

      const maxSeriesForExercise = ()=>{
        return (ex.sets || []).reduce((sum, s)=>{
          const n = Number(String(s.series ?? "").replace(",", "."));
          return sum + (isFinite(n) && n > 0 ? n : 0);
        }, 0);
      };

      const updateSeriesUI = ()=>{
        const count = typeof ex.seriesCount === "number" ? ex.seriesCount : 0;
        if(seriesLabel) seriesLabel.textContent = `Series: ${count}`;
        const maxSeries = maxSeriesForExercise();
        const done = maxSeries > 0 && count >= maxSeries;
        seriesBtn.disabled = done;
        seriesBtn.classList.toggle("seriesBtnRound--done", done);
        card.classList.toggle("exercise--done", done);
        if(seriesCheck) seriesCheck.classList.toggle("seriesCheck--show", done);
        if(seriesDone) seriesDone.classList.toggle("seriesDoneLabel--show", done);
      };

      updateSeriesUI();

      seriesBtn.onclick = ()=>{
        const count = typeof ex.seriesCount === "number" ? ex.seriesCount : 0;
        const maxSeries = maxSeriesForExercise();
        if(maxSeries > 0 && count >= maxSeries) return;
        ex.seriesCount = count + 1;
        saveState();
        updateSeriesUI();
        startRestTimer(ex.id, restModeMinutes);
      };

      if(seriesReset){
        seriesReset.onclick = ()=>{
          ex.seriesCount = 0;
          saveState();
          updateSeriesUI();
        };
      }

      const noteInput = card.querySelector("[data-note]");
      noteInput.oninput = ()=>{
        ex.note = noteInput.value;
        saveState();
      };

      const table = card.querySelector(".setTable");

      ex.sets.forEach((s,i)=>{
        const row = document.createElement("div");
        row.className = "setRow";
        row.innerHTML = `
          <input class="input" inputmode="numeric" placeholder="Series" value="${esc(s.series ?? "")}">
          <input class="input" inputmode="numeric" placeholder="Reps" value="${esc(s.reps ?? "")}">
          <input class="input" inputmode="numeric" placeholder="Kg" value="${esc(s.kg ?? "")}">
          <input class="input" inputmode="numeric" placeholder="RIR" value="${esc(s.rir ?? "")}">
          <button class="btn btn--danger del">✕</button>
        `;

        const [seriesI, repsI, kgI, rirI] = row.querySelectorAll("input");

        const commit = ()=>{
          s.series = seriesI.value;
          s.reps   = repsI.value;
          s.kg     = kgI.value;
          s.rir    = rirI.value;
          saveState();
        };

        seriesI.oninput = commit;
        repsI.oninput   = commit;
        kgI.oninput     = commit;
        rirI.oninput    = commit;

        row.querySelector("button").onclick = () => {
          if (ex.sets.length === 1) ex.sets[0] = blankSet();
          else ex.sets.splice(i, 1);
          saveState();
          render();
        };

        table.appendChild(row);
      });

      card.querySelector("[data-add]").onclick = ()=>{
        ex.sets.push(blankSet());
        saveState();
        render();
      };

      host.appendChild(card);
    });
  }

  const calendarBox = document.getElementById("calendarBox");
  renderCalendarForDay(day, calendarBox);
}

/* ================= RENDER ================= */

function render(){
  renderDays();
  if(viewMode === "weight") renderWeightView();
  else renderWorkoutView();

  // ✅ re-enganchar el botón Peso y tabs si hace falta
  bindWeightButton();
  updateRestTimers();
}

/* ================= BINDINGS ================= */

function bindWeightButton(){
  const btn = document.getElementById("btnWeight");
  if(!btn) return;

  btn.onclick = ()=>{
    viewMode = "weight";
    goToRoutineScreen(); // ✅ CLAVE: mostrar la pantalla Rutina
    render();
  };
}

function bindTimerMode(){
  if(!$timerMode) return;
  updateTimerModeUI();
  $timerMode.onclick = ()=>{
    restModeMinutes = restModeMinutes === 3 ? 1.5 : 3;
    localStorage.setItem(REST_MODE_KEY, String(restModeMinutes));
    updateTimerModeUI();
  };
}

function bindTimerReset(){
  if(!$timerReset) return;
  $timerReset.onclick = ()=>{
    globalTimerEndAt = null;
    updateRestTimers();
  };
}

/* ---------- DÍAS ---------- */

function renderDays(){
  $daysList.innerHTML = "";

  if(!state.days.length){
    $daysList.innerHTML = `<div class="empty">No hay días creados.</div>`;
    return;
  }

  state.days.forEach(day=>{
    const el = document.createElement("div");
    el.className = "dayItem";
    el.innerHTML = `
      <div class="dayItem__meta">
        <div class="dayItem__name">${esc(day.name)}</div>
        <div class="dayItem__small">${day.exercises.length} ejercicios</div>
      </div>
      <div class="dayItem__actions">
        <button class="btn" data-r>Renombrar</button>
        <button class="btn btn--danger" data-d>Borrar</button>
      </div>
    `;

    el.onclick = e=>{
      if(e.target.tagName === "BUTTON") return;
      selectedDayId = day.id;
      viewMode = "workout";
      calView = { y: new Date().getFullYear(), m: new Date().getMonth() };
      render();
      goToRoutineScreen(); // ✅ al elegir día, ir a Rutina
    };

    el.querySelector("[data-r]").onclick = async e=>{
      e.stopPropagation();
      const name = await openPrompt({
        title:"Renombrar día",
        label:"Nombre",
        value:day.name
      });
      if(!name) return;
      day.name = name;
      saveState();
      render();
    };

    el.querySelector("[data-d]").onclick = e=>{
      e.stopPropagation();
      if(!confirm("¿Borrar día?")) return;
      state.days = state.days.filter(d=>d.id!==day.id);
      selectedDayId = state.days[0]?.id ?? null;
      saveState();
      render();
    };

    $daysList.appendChild(el);
  });
}

/* ================= TOP ACTIONS ================= */

$btnAddDay.onclick = async ()=>{
  const name = await openPrompt({
    title:"Nuevo día",
    label:"Nombre",
    placeholder:"Ej: Pecho"
  });
  if(!name) return;

  state.days.unshift({ id: uid(), name, exercises:[] });
  selectedDayId = state.days[0].id;
  viewMode = "workout";
  calView = { y: new Date().getFullYear(), m: new Date().getMonth() };
  saveState();
  render();
  goToRoutineScreen();
};

$btnReset.onclick = ()=>{
  const wantSave = confirm("¿Querés guardar una copia antes de resetear?");
  if(wantSave){
    const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mi-entreno-backup.json";
    a.click();
  }
  if(!confirm("¿Borrar todo?")) return;
  state = { days: [], history: [], weights: [], habits: [], habitLogs: [] };
  selectedDayId = null;
  viewMode = "workout";
  saveState();
  render();
  showDays();
};

$btnExport.onclick = ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mi-entreno-backup.json";
  a.click();
};

$btnImport.onclick = ()=>{
  $fileInput.value = "";
  $fileInput.click();
};

$fileInput.onchange = async ()=>{
  const f = $fileInput.files[0];
  if(!f) return;

  try{
    const txt = await f.text();
    const data = JSON.parse(txt);
    if(!data?.days) return alert("Archivo inválido");

    if(!Array.isArray(data.history)) data.history = [];
    if(!Array.isArray(data.weights)) data.weights = [];
    if(!Array.isArray(data.habits)) data.habits = [];
    if(!Array.isArray(data.habitLogs)) data.habitLogs = [];
    state = data;
    normalizeStateExercises();
    normalizeHabits();

    selectedDayId = state.days[0]?.id ?? null;
    saveState();
    render();
  }catch{
    alert("No se pudo importar.");
  }
};

/* ================= INIT ================= */

// enganchar tabs (por si querés mover todo al JS y no depender del script inline)
(function bindTabs(){
  const tabDays = document.getElementById("tabDays");
  const tabRoutine = document.getElementById("tabRoutine");
  if(tabDays) tabDays.addEventListener("click", showDays);
  if(tabRoutine) tabRoutine.addEventListener("click", showRoutine);
})();

bindWeightButton();
bindTimerMode();
bindTimerReset();
normalizeStateExercises();
normalizeHabits();
render();
