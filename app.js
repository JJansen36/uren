// app.js — FIXED & STABLE VERSION

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

/* ======================
   INIT
====================== */
document.addEventListener("DOMContentLoaded", init);

async function init(){
  session = await requireSession(sb);
  if (!session) return;

  profile = await getMyProfile(sb);
  el("meBadge").textContent = `${profile.name || 'Gebruiker'} • ${profile.role}`;
  if (profile.role === "admin") el("adminLink").style.display = "inline-flex";

  el("btnLogout").onclick = async ()=>{
    await sb.auth.signOut();
    location.href = "index.html";
  };

  const qs = getQueryParam("weekStart");
  weekStart = qs ? startOfISOWeek(parseISODate(qs)) : startOfISOWeek(new Date());
  setQueryParam("weekStart", toISODate(weekStart));

  selectedDate = toISODate(new Date());

  renderWeekDays();


  el("btnSaveDay").onclick = saveWorkday;

  wireWeekNav();
  wireModal();

  ["dStart","dEnd","dPause"].forEach(id=>{
    el(id).addEventListener("input", recalcDayTotal);
  });

  await loadReferenceData();
  await loadWeek();
  await loadWorkdayForSelectedDate();
}

/* ======================
   HELPERS
====================== */
function calcDayHours(start, end, pauseMin){
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return Math.max(0, ((eh*60+em) - (sh*60+sm) - Number(pauseMin||0)) / 60);
}

function recalcDayTotal(){
  const h = calcDayHours(
    el("dStart").value,
    el("dEnd").value,
    el("dPause").value
  );
  el("dTotal").value = h.toFixed(2).replace(".", ",");
}

/* ======================
   WORKDAY
====================== */
async function loadWorkdayForSelectedDate(){
  el("dayStatus").textContent = `Werkdag: ${formatNLDate(selectedDate)}`;

  const { data, error } = await sb
    .from("workdays")
    .select("*")
    .eq("user_id", session.user.id)
    .eq("work_date", selectedDate)
    .maybeSingle();

  if (error){
    el("dayStatus").textContent =
  `Werkdag ${formatNLDate(selectedDate)} — ${used.toFixed(2)}u gespecificeerd / ${remaining.toFixed(2)}u resterend`;
    return;
  }

  if (!data){
    el("dStart").value = "";
    el("dEnd").value = "";
    el("dPause").value = 30;
    el("dTotal").value = "";
    return;
  }

  el("dStart").value = data.start_time;
  el("dEnd").value = data.end_time;
  el("dPause").value = data.break_minutes;
  el("dTotal").value = data.total_hours.toFixed(2).replace(".", ",");
  // bereken gespecificeerde uren
const { data: entries } = await sb
  .from("time_entries")
  .select("hours")
  .eq("workday_id", data?.id || null);

const used = (entries || []).reduce(
  (t, e) => t + Number(e.hours || 0),
  0
);

const remaining = Math.max(0, (data?.total_hours || 0) - used);

el("dayStatus").textContent =
  `Werkdag ${formatNLDate(selectedDate)} — ` +
  `${used.toFixed(2)}u gespecificeerd / ` +
  `${remaining.toFixed(2)}u resterend`;

}

async function saveWorkday(){
  el("dayStatus").textContent = "";

  const start = el("dStart").value;
  const end   = el("dEnd").value;
  const pause = Number(el("dPause").value||0);

  if (!start || !end){
    el("dayStatus").textContent = "Vul aanvang en gereed in.";
    return;
  }

  const total = calcDayHours(start, end, pause);

  const { error } = await sb.from("workdays").upsert({
    user_id: session.user.id,
    work_date: selectedDate,
    start_time: start,
    end_time: end,
    break_minutes: pause,
    total_hours: total
  }, { onConflict: "user_id,work_date" });

  el("dayStatus").textContent = error ? error.message : "Werkdag opgeslagen.";
}

/* ======================
   WEEK OVERVIEW
====================== */
function wireWeekNav(){
  el("prevWeek").onclick = ()=>{ weekStart = addDays(weekStart,-7); setQueryParam("weekStart", toISODate(weekStart)); loadWeek(); };
  el("nextWeek").onclick = ()=>{ weekStart = addDays(weekStart, 7); setQueryParam("weekStart", toISODate(weekStart)); loadWeek(); };
  el("thisWeek").onclick = ()=>{ weekStart = startOfISOWeek(new Date()); setQueryParam("weekStart", toISODate(weekStart)); loadWeek(); };

  el("btnAdd").onclick = openModalForCreate;
  el("btnExport").onclick = ()=>{
    location.href = `report.html?weekStart=${encodeURIComponent(toISODate(weekStart))}`;
  };
  el("prevWeek").onclick = async ()=>{
  weekStart = addDays(weekStart,-7);
  setQueryParam("weekStart", toISODate(weekStart));
  selectedDate = toISODate(weekStart);
  renderWeekDays();
  await loadWeek();
  await loadWorkdayForSelectedDate();
};

}

async function loadWeek(){
  const end = addDays(weekStart, 6);
  el("weekLabel").textContent =
    `Week (${formatNLDate(toISODate(weekStart))} – ${formatNLDate(toISODate(end))})`;

const { data, error } = await sb
  .from("time_entries")
  .select(`
    id,
    entry_date,
    workday_id,
    hours,
    description,
    billable,
    client_id,
    project_id,
    activity_id,
    clients(name),
    projects(name),
    activities(name)
  `)
  .gte("entry_date", toISODate(weekStart))
  .lte("entry_date", toISODate(end))
  .order("entry_date", { ascending: true });


  if (error){
    el("hint").textContent = error.message;
    return;
  }

  renderTable(data||[]);
  renderKPIs(data||[]);
  el("hint").textContent = data?.length ? "" : "Nog geen uren deze week.";
}

function renderTable(rows){
  tbody.innerHTML = rows.map(r=>`
    <tr>
      <td>
        <button class="link-day" data-day="${r.entry_date}">
          ${formatNLDate(r.entry_date)}
        </button>
      </td>
      <td>${escapeHtml(r.clients?.name||"-")}</td>
      <td>${escapeHtml(r.projects?.name||"-")}</td>
      <td>${escapeHtml(r.activities?.name||"-")}</td>
      <td>${escapeHtml(r.description||"")}</td>
      <td><b>${formatHours(r.hours)}</b></td>
      <td>${r.billable?"Ja":"Nee"}</td>
      <td><button class="small" data-edit="${r.id}">Bewerk</button></td>
    </tr>
  `).join("");

  tbody.querySelectorAll("button.link-day").forEach(btn=>{
    btn.onclick = async ()=>{
      selectedDate = btn.dataset.day;
      await loadWorkdayForSelectedDate();
    };
  });

  tbody.querySelectorAll("button[data-edit]").forEach(btn=>{
    btn.onclick = ()=> openModalForEdit(btn.dataset.edit, rows);
  });
}

function renderKPIs(rows){
  const total = sum(rows, r=>Number(r.hours||0));
  const bill = sum(rows.filter(r=>r.billable), r=>Number(r.hours||0));
  el("kpiTotal").textContent = formatHours(total);
  el("kpiBillable").textContent = formatHours(bill);
  el("kpiNonBillable").textContent = formatHours(total-bill);
}

function renderWeekDays(){
  const cont = el("weekDays");
  cont.innerHTML = "";

  const labels = ["ma","di","wo","do","vr","za","zo"];

  for (let i = 0; i < 7; i++){
    const d = addDays(weekStart, i);
    const iso = toISODate(d);

    const btn = document.createElement("div");
    btn.className = "week-day" + (iso === selectedDate ? " active" : "");
    btn.innerHTML = `
      ${labels[i]}
      <small>${String(d.getDate()).padStart(2,"0")}</small>
    `;

    btn.onclick = async ()=>{
      selectedDate = iso;
      renderWeekDays();
      await loadWorkdayForSelectedDate();
    };

    cont.appendChild(btn);
  }
}


/* ======================
   MODAL / TIME ENTRIES
====================== */
function wireModal(){
  el("btnCancel").onclick = closeModal;
  el("modal").onclick = e=>{ if(e.target.id==="modal") closeModal(); };
  el("fClient").onchange = ()=> fillProjectsDropdown();

  el("btnSave").onclick = async ()=>{
    el("modalStatus").textContent="";
    const payload = await getFormPayload();
    if (!payload) return;

    const q = editingId
      ? sb.from("time_entries").update(payload).eq("id", editingId)
      : sb.from("time_entries").insert({ ...payload, user_id: session.user.id });

    const { error } = await q;
    if (error) el("modalStatus").textContent = error.message;
    else{
  closeModal();
  await loadWeek();                  // ⬅️ DIT WAS NODIG
  await loadWorkdayForSelectedDate(); // ⬅️ status bijwerken
}

  };

  el("btnDelete").onclick = async ()=>{
    if (!editingId) return;
    await sb.from("time_entries").delete().eq("id", editingId);
    closeModal();
    loadWeek();
  };
}

function openModalForCreate(){
  editingId = null;
  el("modalTitle").textContent = "Uur toevoegen";
  el("btnDelete").style.display = "none";
  el("fDate").value = selectedDate;
  el("fDate").disabled = true;
  el("fHours").value = "1";
  fillClientsDropdown(clients[0]?.id);
  fillProjectsDropdown();
  fillActivitiesDropdown(activities[0]?.id);
  el("fDesc").value="";
  openModal();

  // automatisch resterende uren invullen
(async ()=>{
  const { data: wd } = await sb
    .from("workdays")
    .select("id,total_hours")
    .eq("user_id", session.user.id)
    .eq("work_date", selectedDate)
    .maybeSingle();

  if (!wd) return;

  const { data: entries } = await sb
    .from("time_entries")
    .select("hours")
    .eq("workday_id", wd.id);

  const used = (entries||[]).reduce((t,e)=>t+Number(e.hours||0),0);
  const remaining = Math.max(0, wd.total_hours - used);

  el("fHours").value = remaining.toFixed(2);
})();

}

function openModalForEdit(id, rows){
  const r = rows.find(x=>x.id===id);
  if (!r) return;
  editingId = id;
  el("modalTitle").textContent = "Uur bewerken";
  el("btnDelete").style.display = "inline-block";
  el("fDate").value = r.entry_date;
  el("fHours").value = r.hours;
  fillClientsDropdown(r.client_id);
  fillProjectsDropdown(r.project_id);
  fillActivitiesDropdown(r.activity_id);
  el("fBillable").value = r.billable?"true":"false";
  el("fDesc").value = r.description||"";
  openModal();
}

async function getFormPayload(){
  const hours = Number(el("fHours").value);
  if (!hours || hours<=0){ el("modalStatus").textContent="Vul geldige uren in."; return null; }

  const { data: wd } = await sb
    .from("workdays")
    .select("id,total_hours")
    .eq("user_id", session.user.id)
    .eq("work_date", selectedDate)
    .maybeSingle();

  if (!wd){ el("modalStatus").textContent="Sla eerst de werkdag op."; return null; }

  const { data: dayEntries } = await sb
    .from("time_entries")
    .select("id,hours")
    .eq("workday_id", wd.id);

  let used = (dayEntries||[]).reduce((t,e)=>t+Number(e.hours||0),0);
  if (editingId){
    const cur = dayEntries.find(e=>e.id===editingId);
    if (cur) used -= Number(cur.hours||0);
  }

const newTotal = used + hours;

// ❌ alleen blokkeren als je OVER het dagtotaal gaat
if (newTotal > wd.total_hours + 0.01){
  el("modalStatus").textContent =
    `Te veel uren (${newTotal.toFixed(2)}) – dagtotaal is ${wd.total_hours.toFixed(2)}`;
  return null;
}


  return {
    entry_date: selectedDate,
    workday_id: wd.id,
    hours,
    client_id: el("fClient").value,
    project_id: el("fProject").value,
    activity_id: el("fActivity").value,
    description: el("fDesc").value||"",
    billable: el("fBillable").value==="true"
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
  clients=c.data||[]; projects=p.data||[]; activities=a.data||[];
  fillClientsDropdown(); fillProjectsDropdown(); fillActivitiesDropdown();
}

function fillClientsDropdown(id){
  el("fClient").innerHTML = clients.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if(id) el("fClient").value=id;
}
function fillProjectsDropdown(id){
  const cid=el("fClient").value;
  const list=projects.filter(p=>p.client_id===cid);
  el("fProject").innerHTML=list.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if(id) el("fProject").value=id;
}
function fillActivitiesDropdown(id){
  el("fActivity").innerHTML=activities.map(a=>`<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("");
  if(id) el("fActivity").value=id;
}

/* ======================
   MODAL VIS
====================== */
function openModal(){ el("modal").classList.add("open"); }
function closeModal(){ el("modal").classList.remove("open"); }
