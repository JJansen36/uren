// app.js — STABLE (multi time blocks + day filter table)

import { makeSupabaseClient, requireSession, getMyProfile } from "./auth.js";
import {
  startOfISOWeek, addDays, toISODate, parseISODate,
  getQueryParam, setQueryParam, formatNLDate, formatHours, sum, escapeHtml
} from "./utils.js";

/* ======================
   STATE
====================== */
const sb = makeSupabaseClient();
const el = (id)=>document.getElementById(id);
const tbody = el("tbody");

let session = null;
let profile = null;

let weekStart = null;
let selectedDate = null;

let clients = [];
let projects = [];
let activities = [];

let editingId = null;
let DAILY_NORM = 7.75;

/* ======================
   INIT
====================== */
document.addEventListener("DOMContentLoaded", init);

async function init(){
  session = await requireSession(sb);
  if (!session) return;

  profile = await getMyProfile(sb);
  if (el("meBadge")) el("meBadge").textContent = `${profile.name || "Gebruiker"} • ${profile.role}`;
  if (profile.role === "admin" && el("adminLink")) el("adminLink").style.display = "inline-flex";

  DAILY_NORM = Number(profile.daily_norm || 7.75);

  const btnLogout = el("btnLogout");
  if (btnLogout){
    btnLogout.onclick = async ()=>{
      await sb.auth.signOut();
      location.href = "index.html";
    };
  }

  // week bepalen via url (weekStart=YYYY-MM-DD), anders huidige week
  const qs = getQueryParam("weekStart");
  weekStart = qs ? startOfISOWeek(parseISODate(qs)) : startOfISOWeek(new Date());
  setQueryParam("weekStart", toISODate(weekStart));

  selectedDate = toISODate(new Date());

  wireWeekNav();
  wireModal();

  // Multi-block UI: + tijdblok knop (alleen als element bestaat)
  const btnAddBlock = el("btnAddBlock");
  if (btnAddBlock){
    btnAddBlock.onclick = ()=>{
      const blocksEl = el("blocks");
      if (!blocksEl) return; // voorkomt crash als HTML nog niet aangepast is
      blocksEl.appendChild(createBlockRow({ break_minutes: 0 }));
      recalcBlocksTotal();
    };
  }

  const btnSaveDay = el("btnSaveDay");
  if (btnSaveDay) btnSaveDay.onclick = saveWorkday;

  await loadReferenceData();

  renderWeekDays();
  await loadWeek();
  await loadWorkdayForSelectedDate();
}

/* ======================
   TIME BLOCK HELPERS
====================== */
function calcDayHours(start, end, pauseMin){
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, ((eh*60+em) - (sh*60+sm) - Number(pauseMin||0)) / 60);
}

function createBlockRow(block = { id:null, start_time:"", end_time:"", break_minutes:0 }){
  const row = document.createElement("div");
  row.className = "blockRow";
  row.dataset.id = block.id || "";

row.innerHTML = `
  <div class="field">
    <label>Aanvang</label>
    <input type="time" class="bStart" value="${block.start_time || ""}">
  </div>

  <div class="field">
    <label>Gereed</label>
    <input type="time" class="bEnd" value="${block.end_time || ""}">
  </div>

  <div class="field pause">
    <label>Pauze (min)</label>
    <input
      type="number"
      min="0"
      step="5"
      class="bPause"
      value="${Number(block.break_minutes || 0)}"
    >
  </div>

  <button type="button" class="remove" title="Verwijder tijdblok">✕</button>
`;



  row.querySelector(".remove").onclick = ()=>{
    row.remove();
    recalcBlocksTotal();
  };

  ["input","change"].forEach(ev=>{
    row.querySelector(".bStart").addEventListener(ev, recalcBlocksTotal);
    row.querySelector(".bEnd").addEventListener(ev, recalcBlocksTotal);
    row.querySelector(".bPause").addEventListener(ev, recalcBlocksTotal);
  });

  return row;
}

function getBlocksFromUI(){
  const blocksEl = el("blocks");
  if (!blocksEl) return [];
  const rows = Array.from(blocksEl.querySelectorAll(".blockRow"));

  return rows.map(r=>{
    const start = r.querySelector(".bStart")?.value || "";
    const end = r.querySelector(".bEnd")?.value || "";
    const pause = Number(r.querySelector(".bPause")?.value || 0);
    const total = calcDayHours(start, end, pause);

    return {
      id: r.dataset.id || null,
      start_time: start,
      end_time: end,
      break_minutes: pause,
      total_hours: total
    };
  }).filter(b => b.start_time && b.end_time);
}

function recalcBlocksTotal(){
  const totalEl = el("dTotal");
  if (!totalEl) return;

  const blocks = getBlocksFromUI();
  const total = blocks.reduce((t,b)=>t+Number(b.total_hours||0),0);
  totalEl.value = total.toFixed(2).replace(".", ",");
}

/* ======================
   WORKDAY (DAY CONTAINER + BLOCKS)
====================== */
async function ensureWorkday(){
  // workday ophalen/aanmaken, zodat we altijd workday_id hebben
  let { data: wd, error: wdErr } = await sb
    .from("workdays")
    .select("*")
    .eq("user_id", session.user.id)
    .eq("work_date", selectedDate)
    .maybeSingle();

  if (wdErr) throw wdErr;

  if (!wd){
    const { data: created, error: insErr } = await sb
      .from("workdays")
      .insert({ user_id: session.user.id, work_date: selectedDate, total_hours: 0 })
      .select("*")
      .single();

    if (insErr) throw insErr;
    wd = created;
  }

  return wd;
}

async function loadWorkdayForSelectedDate(){
  const statusEl = el("dayStatus");
  if (statusEl) statusEl.textContent = `Werkdag ${formatNLDate(selectedDate)}`;

  try{
    const wd = await ensureWorkday();

    // blocks ophalen
    const { data: blocks, error: bErr } = await sb
      .from("workday_blocks")
      .select("id,start_time,end_time,break_minutes,total_hours,created_at")
      .eq("workday_id", wd.id)
      .order("created_at", { ascending: true });

    if (bErr) throw bErr;

    const cont = el("blocks");
    if (cont){
      cont.innerHTML = "";
      if (!blocks || blocks.length === 0){
        cont.appendChild(createBlockRow({ break_minutes: 30 }));
      } else {
        blocks.forEach(b=> cont.appendChild(createBlockRow(b)));
      }
    }

    recalcBlocksTotal();

    // gespecificeerde uren (time_entries)
    const { data: entries, error: eErr } = await sb
      .from("time_entries")
      .select("hours")
      .eq("workday_id", wd.id);

    if (eErr) throw eErr;

    const specified = (entries||[]).reduce((t,e)=>t+Number(e.hours||0),0);
    const worked = getBlocksFromUI().reduce((t,b)=>t+Number(b.total_hours||0),0);
    const saldo = worked - DAILY_NORM;
    const sign = saldo > 0 ? "+" : "";

    if (statusEl){
      statusEl.innerHTML = `
        <b>Werkdag ${formatNLDate(selectedDate)}</b><br>
        ${worked.toFixed(2)}u gewerkt · norm ${DAILY_NORM.toFixed(2)}u<br>
        ${specified.toFixed(2)}u gespecificeerd · <b>${sign}${saldo.toFixed(2)}u saldo</b>
      `;
    }
  }catch(err){
    if (statusEl) statusEl.textContent = err?.message || String(err);
  }
}

async function saveWorkday(){
  const statusEl = el("dayStatus");
  if (statusEl) statusEl.textContent = "";

  try{
    const wd = await ensureWorkday();

    const blocks = getBlocksFromUI();
    if (blocks.length === 0){
      if (statusEl) statusEl.textContent = "Voeg minimaal 1 tijdblok toe (start + eind).";
      return;
    }

    // simpeler & robuust: delete + insert
    const { error: delErr } = await sb
      .from("workday_blocks")
      .delete()
      .eq("workday_id", wd.id);

    if (delErr) throw delErr;

    const payload = blocks.map(b=>({
      workday_id: wd.id,
      start_time: b.start_time,
      end_time: b.end_time,
      break_minutes: b.break_minutes,
      total_hours: b.total_hours
    }));

    const { error: insErr } = await sb
      .from("workday_blocks")
      .insert(payload);

    if (insErr) throw insErr;

    await loadWorkdayForSelectedDate();
    await loadWeek();
    await sb
  .from("workdays")
  .update({ total_hours: blocks.reduce((t,b)=>t+b.total_hours,0) })
  .eq("id", wd.id);

    if (statusEl) statusEl.textContent = `Werkdag opgeslagen (${formatNLDate(selectedDate)}).`;
  }catch(err){
    if (statusEl) statusEl.textContent = err?.message || String(err);
  }
}

/* ======================
   WEEK NAV & DAY BUTTONS
====================== */
function wireWeekNav(){
  const prev = el("prevWeek");
  const next = el("nextWeek");
  const thisW = el("thisWeek");

  if (prev) prev.onclick = ()=> changeWeek(-7);
  if (next) next.onclick = ()=> changeWeek(7);
  if (thisW) thisW.onclick = ()=>{
    weekStart = startOfISOWeek(new Date());
    setQueryParam("weekStart", toISODate(weekStart));
    selectedDate = toISODate(weekStart);
    refreshWeek();
  };

  const btnAdd = el("btnAdd");
  if (btnAdd) btnAdd.onclick = openModalForCreate;

  const btnExport = el("btnExport");
  if (btnExport) btnExport.onclick = ()=>{
    location.href = `report.html?weekStart=${encodeURIComponent(toISODate(weekStart))}`;
  };
}

function changeWeek(delta){
  weekStart = addDays(weekStart, delta);
  setQueryParam("weekStart", toISODate(weekStart));
  selectedDate = toISODate(weekStart);
  refreshWeek();
}

async function refreshWeek(){
  renderWeekDays();
  await loadWeek();
  await loadWorkdayForSelectedDate();
}

function renderWeekDays(){
  const cont = el("weekDays");
  if (!cont) return;

  cont.innerHTML = "";
  const labels = ["ma","di","wo","do","vr","za","zo"];

  for (let i=0; i<7; i++){
    const d = addDays(weekStart, i);
    const iso = toISODate(d);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "week-day" + (iso===selectedDate ? " active" : "");
    btn.innerHTML = `${labels[i]}<small>${String(d.getDate()).padStart(2,"0")}</small>`;

    btn.onclick = async ()=>{
      selectedDate = iso;
      renderWeekDays();
      await loadWorkdayForSelectedDate();
      await loadWeek(); // tabel = alleen selectedDate
    };

    cont.appendChild(btn);
  }
}

/* ======================
   DAY TABLE (ONLY selectedDate)
====================== */
async function loadWeek(){
  const end = addDays(weekStart, 6);
  const weekLabel = el("weekLabel");
  if (weekLabel){
    weekLabel.textContent =
      `Week (${formatNLDate(toISODate(weekStart))} – ${formatNLDate(toISODate(end))})`;
  }

  const hint = el("hint");
  if (hint) hint.textContent = "Laden…";

  const { data, error } = await sb
    .from("time_entries")
    .select(`
      id, entry_date, workday_id, hours, description, billable,
      client_id, project_id, activity_id,
      clients(name), projects(name), activities(name)
    `)
    .eq("entry_date", selectedDate)
    .order("id");

  if (error){
    if (hint) hint.textContent = error.message;
    renderTable([]);
    renderKPIs([]);
    return;
  }

renderTable(data || []);
await renderWeekKPIs();


  if (hint) hint.textContent = (data && data.length) ? "" : "Nog geen uren voor deze dag.";
}

async function loadWeekWorkedHours(){
  const end = addDays(weekStart, 6);

  // alle workdays van deze week ophalen
  const { data: workdays, error } = await sb
    .from("workdays")
    .select("id, work_date")
    .eq("user_id", session.user.id)
    .gte("work_date", toISODate(weekStart))
    .lte("work_date", toISODate(end));

  if (error || !workdays || workdays.length === 0){
    return { total: 0, billable: 0 };
  }

  const workdayIds = workdays.map(w => w.id);

  // alle blokken van deze week
  const { data: blocks, error: bErr } = await sb
    .from("workday_blocks")
    .select("total_hours")
    .in("workday_id", workdayIds);

  if (bErr || !blocks){
    return { total: 0, billable: 0 };
  }

  const totalWorked = blocks.reduce(
    (t,b)=>t+Number(b.total_hours||0),
    0
  );

  // billable komt nog steeds uit time_entries (logisch)
  const { data: entries } = await sb
    .from("time_entries")
    .select("hours, billable")
    .gte("entry_date", toISODate(weekStart))
    .lte("entry_date", toISODate(end))
    .eq("user_id", session.user.id);

  const billable = (entries||[])
    .filter(e=>e.billable)
    .reduce((t,e)=>t+Number(e.hours||0),0);

  const workdaysCount = workdays.length;

  const normTotal = workdaysCount * DAILY_NORM;

  return {
    total: totalWorked,
    billable,
    saldo: totalWorked - normTotal
  };
}

async function renderWeekKPIs(){
  const k1 = el("kpiTotal");
  const k2 = el("kpiBillable");
  const k3 = el("kpiNonBillable");
  const kSaldo = el("kpiSaldo");
  const kSaldoBox = el("kpiSaldoBox");

  const { total, billable, saldo } = await loadWeekWorkedHours();

  if (k1) k1.textContent = formatHours(total);
  if (k2) k2.textContent = formatHours(billable);
  if (k3) k3.textContent = formatHours(total - billable);

  if (kSaldo){
    const sign = saldo > 0 ? "+" : "";
    kSaldo.textContent = sign + formatHours(saldo);
  }

  if (kSaldoBox){
    kSaldoBox.classList.remove("positive","negative");
    if (saldo > 0.01) kSaldoBox.classList.add("positive");
    else if (saldo < -0.01) kSaldoBox.classList.add("negative");
  }
}



function renderTable(rows){
  if (!tbody) return;

  tbody.innerHTML = rows.map(r=>`
    <tr>
      <td>${formatNLDate(r.entry_date)}</td>
      <td>${escapeHtml(r.clients?.name||"-")}</td>
      <td>${escapeHtml(r.projects?.name||"-")}</td>
      <td>${escapeHtml(r.activities?.name||"-")}</td>
      <td>${escapeHtml(r.description||"")}</td>
      <td><b>${formatHours(r.hours)}</b></td>
      <td>${r.billable?"Ja":"Nee"}</td>
      <td><button class="small" data-edit="${r.id}">Bewerk</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll("button[data-edit]").forEach(btn=>{
    btn.onclick = ()=> openModalForEdit(btn.dataset.edit, rows);
  });
}

/* ======================
   MODAL / TIME ENTRIES
====================== */
function wireModal(){
  const btnCancel = el("btnCancel");
  if (btnCancel) btnCancel.onclick = closeModal;

  const modal = el("modal");
  if (modal){
    modal.onclick = (e)=>{ if(e.target.id==="modal") closeModal(); };
  }

  const fClient = el("fClient");
  if (fClient) fClient.onchange = ()=> fillProjectsDropdown();

  const btnSave = el("btnSave");
  if (btnSave){
    btnSave.onclick = async ()=>{
      if (el("modalStatus")) el("modalStatus").textContent = "";
      const payload = await getFormPayload();
      if (!payload) return;

      const q = editingId
        ? sb.from("time_entries").update(payload).eq("id", editingId)
        : sb.from("time_entries").insert({ ...payload, user_id: session.user.id });

      const { error } = await q;
      if (error){
        if (el("modalStatus")) el("modalStatus").textContent = error.message;
      } else {
        closeModal();
        await loadWeek();
        await loadWorkdayForSelectedDate();
      }
    };
  }

  const btnDelete = el("btnDelete");
  if (btnDelete){
    btnDelete.onclick = async ()=>{
      if (!editingId) return;
      await sb.from("time_entries").delete().eq("id", editingId);
      closeModal();
      await loadWeek();
      await loadWorkdayForSelectedDate();
    };
  }
}

function openModalForCreate(){
  editingId = null;
  if (el("modalTitle")) el("modalTitle").textContent = "Uur toevoegen";
  if (el("btnDelete")) el("btnDelete").style.display = "none";

  if (el("fDate")){
    el("fDate").value = selectedDate;
    el("fDate").disabled = true;
  }

  if (el("fHours")) el("fHours").value = "1";
  fillClientsDropdown(clients[0]?.id);
  fillProjectsDropdown();
  fillActivitiesDropdown(activities[0]?.id);
  if (el("fDesc")) el("fDesc").value = "";

  openModal();
}

function openModalForEdit(id, rows){
  const r = rows.find(x=>x.id===id);
  if (!r) return;

  editingId = id;
  if (el("modalTitle")) el("modalTitle").textContent = "Uur bewerken";
  if (el("btnDelete")) el("btnDelete").style.display = "inline-block";

  if (el("fDate")){
    el("fDate").value = r.entry_date;
    el("fDate").disabled = true;
  }

  if (el("fHours")) el("fHours").value = r.hours;
  fillClientsDropdown(r.client_id);
  fillProjectsDropdown(r.project_id);
  fillActivitiesDropdown(r.activity_id);
  if (el("fBillable")) el("fBillable").value = r.billable ? "true" : "false";
  if (el("fDesc")) el("fDesc").value = r.description || "";

  openModal();
}

async function getFormPayload(){
  const hours = Number(el("fHours")?.value || 0);
  if (!hours || hours <= 0){
    if (el("modalStatus")) el("modalStatus").textContent = "Vul geldige uren in.";
    return null;
  }

  // workday ophalen (bestaat altijd na loadWorkdayForSelectedDate, maar safe)
  const { data: wd, error: wdErr } = await sb
    .from("workdays")
    .select("id,total_hours")
    .eq("user_id", session.user.id)
    .eq("work_date", selectedDate)
    .maybeSingle();

  if (wdErr){
    if (el("modalStatus")) el("modalStatus").textContent = wdErr.message;
    return null;
  }

  if (!wd){
    if (el("modalStatus")) el("modalStatus").textContent = "Sla eerst de werkdag op.";
    return null;
  }

  // bestaande entries van die dag
  const { data: entries, error: entErr } = await sb
    .from("time_entries")
    .select("id,hours")
    .eq("workday_id", wd.id);

  if (entErr){
    if (el("modalStatus")) el("modalStatus").textContent = entErr.message;
    return null;
  }

  let used = (entries || []).reduce((t,e)=>t+Number(e.hours||0),0);

  // bij edit: huidige entry aftrekken
  if (editingId){
    const cur = (entries||[]).find(e=>e.id===editingId);
    if (cur) used -= Number(cur.hours||0);
  }

  const newTotal = used + hours;

  // alleen waarschuwing (toestaan!)
  if (newTotal > Number(wd.total_hours || 0) + 0.01){
    if (el("modalStatus")){
      el("modalStatus").textContent =
        `Let op: ${(newTotal - Number(wd.total_hours||0)).toFixed(2)}u meer gespecificeerd dan gewerkt`;
    }
  } else {
    if (el("modalStatus")) el("modalStatus").textContent = "";
  }

  return {
    entry_date: selectedDate,
    workday_id: wd.id,
    hours,
    client_id: el("fClient")?.value,
    project_id: el("fProject")?.value,
    activity_id: el("fActivity")?.value,
    description: el("fDesc")?.value || "",
    billable: (el("fBillable")?.value === "true")
  };
}

/* ======================
   LOOKUPS
====================== */
async function loadReferenceData(){
  const [c,p,a] = await Promise.all([
    sb.from("clients").select("*").eq("active",true),
    sb.from("projects").select("*").eq("active",true),
    sb.from("activities").select("*").eq("active",true)
  ]);

  clients = c.data || [];
  projects = p.data || [];
  activities = a.data || [];

  fillClientsDropdown();
  fillProjectsDropdown();
  fillActivitiesDropdown();
}

function fillClientsDropdown(id){
  const f = el("fClient");
  if (!f) return;
  f.innerHTML = clients.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if (id) f.value = id;
}

function fillProjectsDropdown(id){
  const fClient = el("fClient");
  const fProject = el("fProject");
  if (!fClient || !fProject) return;

  const cid = fClient.value;
  const list = projects.filter(p=>String(p.client_id)===String(cid));
  fProject.innerHTML = list.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if (id) fProject.value = id;
}

function fillActivitiesDropdown(id){
  const f = el("fActivity");
  if (!f) return;
  f.innerHTML = activities.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  if (id) f.value = id;
}

/* ======================
   MODAL VIS
====================== */
function openModal(){ if (el("modal")) el("modal").classList.add("open"); }
function closeModal(){ if (el("modal")) el("modal").classList.remove("open"); }
