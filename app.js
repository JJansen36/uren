import { makeSupabaseClient, requireSession, getMyProfile } from "./auth.js";
import {
  startOfISOWeek, addDays, toISODate, parseISODate,
  getQueryParam, setQueryParam, formatNLDate, formatHours, sum, escapeHtml
} from "./utils.js";

const sb = makeSupabaseClient();

const el = (id)=>document.getElementById(id);
const tbody = el("tbody");

let session = null;
let profile = null;

let weekStart = null; // Date
let clients = [];
let projects = [];
let activities = [];

let editingId = null;

document.addEventListener("DOMContentLoaded", init);

async function init(){
  session = await requireSession(sb);
  if (!session) return;

  profile = await getMyProfile(sb);
  el("meBadge").textContent = `${profile.name || 'Gebruiker'} • ${profile.role}`;
  if (profile.role === "admin") el("adminLink").style.display = "inline-flex";

  el("btnLogout").onclick = async ()=>{ await sb.auth.signOut(); location.href="index.html"; };

  // week bepalen via url (weekStart=YYYY-MM-DD), anders huidige week
  const qs = getQueryParam("weekStart");
  weekStart = qs ? startOfISOWeek(parseISODate(qs)) : startOfISOWeek(new Date());
  setQueryParam("weekStart", toISODate(weekStart));

  wireWeekNav();
  wireModal();

  await loadReferenceData();
  await loadWeek();
}

function wireWeekNav(){
  el("prevWeek").onclick = ()=>{ weekStart = addDays(weekStart,-7); setQueryParam("weekStart", toISODate(weekStart)); loadWeek(); };
  el("nextWeek").onclick = ()=>{ weekStart = addDays(weekStart, 7); setQueryParam("weekStart", toISODate(weekStart)); loadWeek(); };
  el("thisWeek").onclick = ()=>{ weekStart = startOfISOWeek(new Date()); setQueryParam("weekStart", toISODate(weekStart)); loadWeek(); };

  el("btnAdd").onclick = ()=> openModalForCreate();
  el("btnExport").onclick = ()=> {
    const ws = toISODate(weekStart);
    location.href = `report.html?weekStart=${encodeURIComponent(ws)}`;
  };
}

function wireModal(){
  el("btnCancel").onclick = closeModal;
  el("modal").addEventListener("click", (e)=>{ if(e.target.id==="modal") closeModal(); });

  el("fClient").onchange = ()=> fillProjectsDropdown();

  el("btnSave").onclick = async ()=> {
    el("modalStatus").textContent = "";
    try{
      const payload = getFormPayload();
      if (!payload) return;

      if (editingId){
        const { error } = await sb.from("time_entries").update(payload).eq("id", editingId);
        if (error) throw error;
      }else{
        const { error } = await sb.from("time_entries").insert({ ...payload, user_id: session.user.id });
        if (error) throw error;
      }

      closeModal();
      await loadWeek();
    }catch(e){
      el("modalStatus").textContent = e.message || String(e);
    }
  };

  el("btnDelete").onclick = async ()=>{
    el("modalStatus").textContent = "";
    try{
      if (!editingId) return;
      const { error } = await sb.from("time_entries").delete().eq("id", editingId);
      if (error) throw error;
      closeModal();
      await loadWeek();
    }catch(e){
      el("modalStatus").textContent = e.message || String(e);
    }
  };
}

async function loadReferenceData(){
  const [cRes, pRes, aRes] = await Promise.all([
    sb.from("clients").select("id,name,active").eq("active", true).order("name"),
    sb.from("projects").select("id,name,client_id,active").eq("active", true).order("name"),
    sb.from("activities").select("id,name,billable_default,active").eq("active", true).order("name"),
  ]);

  if (cRes.error) throw cRes.error;
  if (pRes.error) throw pRes.error;
  if (aRes.error) throw aRes.error;

  clients = cRes.data || [];
  projects = pRes.data || [];
  activities = aRes.data || [];

  fillClientsDropdown();
  fillActivitiesDropdown();
  fillProjectsDropdown();
}

function fillClientsDropdown(selectedId){
  el("fClient").innerHTML = clients.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  if (selectedId) el("fClient").value = selectedId;
}

function fillProjectsDropdown(selectedId){
  fillProjectsDropdown(selectedId);
}

function fillProjectsDropdown(selectedId){
  const clientId = el("fClient").value || (clients[0]?.id);
  const filtered = projects.filter(p=>p.client_id===clientId);
  el("fProject").innerHTML = filtered.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if (selectedId && filtered.some(p=>p.id===selectedId)) el("fProject").value = selectedId;
}

function fillActivitiesDropdown(selectedId){
  el("fActivity").innerHTML = activities.map(a=>`<option value="${a.id}" data-billable="${a.billable_default}">${escapeHtml(a.name)}</option>`).join("");
  if (selectedId) el("fActivity").value = selectedId;

  // Als activiteit wisselt: zet default billable
  el("fActivity").onchange = ()=>{
    const opt = el("fActivity").selectedOptions[0];
    const def = opt?.getAttribute("data-billable");
    if (def === "false") el("fBillable").value = "false";
    if (def === "true") el("fBillable").value = "true";
  };
}

async function loadWeek(){
  // label
  const end = addDays(weekStart, 6);
  el("weekLabel").textContent = `Week (${formatNLDate(toISODate(weekStart))} – ${formatNLDate(toISODate(end))})`;

  const d1 = toISODate(weekStart);
  const d2 = toISODate(end);

  el("hint").textContent = "Laden…";

  // haal entries voor deze week
  let q = sb
    .from("time_entries")
    .select(`
      id, entry_date, hours, description, billable,
      client_id, project_id, activity_id,
      clients(name),
      projects(name, client_id),
      activities(name, billable_default)
    `)
    .gte("entry_date", d1)
    .lte("entry_date", d2)
    .order("entry_date", { ascending: true });

  // user ziet door RLS alleen eigen entries; admin ziet alles.
  // Als admin: toon standaard alleen eigen? (kan later filter uitbreiden)
  // Voor nu: admin ziet alles = handig.
  const { data, error } = await q;
  if (error) {
    el("hint").textContent = error.message;
    return;
  }

  renderTable(data || []);
  renderKPIs(data || []);

  el("hint").textContent = data?.length ? "" : "Nog geen uren deze week. Klik op “Uur toevoegen”.";
}

function renderKPIs(rows){
  const total = sum(rows, r=>Number(r.hours||0));
  const bill = sum(rows.filter(r=>r.billable), r=>Number(r.hours||0));
  const non = total - bill;

  el("kpiTotal").textContent = formatHours(total);
  el("kpiBillable").textContent = formatHours(bill);
  el("kpiNonBillable").textContent = formatHours(non);
}

function renderTable(rows){
  tbody.innerHTML = rows.map(r=>{
    const clientName = r.clients?.name || "-";
    const projectName = r.projects?.name || "-";
    const activityName = r.activities?.name || "-";
    const desc = escapeHtml(r.description || "");
    const bill = r.billable ? "Ja" : "Nee";

    return `
      <tr>
        <td>${formatNLDate(r.entry_date)}</td>
        <td>${escapeHtml(clientName)}</td>
        <td>${escapeHtml(projectName)}</td>
        <td>${escapeHtml(activityName)}</td>
        <td>${desc}</td>
        <td><b>${formatHours(r.hours)}</b></td>
        <td>${bill}</td>
        <td>
          <button class="small" data-edit="${r.id}">Bewerk</button>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("button[data-edit]").forEach(btn=>{
    btn.onclick = ()=> openModalForEdit(btn.getAttribute("data-edit"), rows);
  });
}

function openModalForCreate(){
  editingId = null;
  el("modalTitle").textContent = "Uur toevoegen";
  el("btnDelete").style.display = "none";
  el("modalStatus").textContent = "";

  // defaults
  el("fDate").value = toISODate(new Date());
  el("fHours").value = "8";
  fillClientsDropdown(clients[0]?.id);
  fillProjectsDropdown();
  fillActivitiesDropdown(activities[0]?.id);

  // set billable default from activity
  const opt = el("fActivity").selectedOptions[0];
  const def = opt?.getAttribute("data-billable");
  el("fBillable").value = (def === "false") ? "false" : "true";

  el("fDesc").value = "";

  openModal();
}

function openModalForEdit(id, rows){
  const r = rows.find(x=>x.id===id);
  if (!r) return;

  editingId = id;
  el("modalTitle").textContent = "Uur bewerken";
  el("btnDelete").style.display = "inline-block";
  el("modalStatus").textContent = "";

  el("fDate").value = r.entry_date;
  el("fHours").value = String(r.hours ?? "");
  fillClientsDropdown(r.client_id);
  fillProjectsDropdown(r.project_id);
  fillActivitiesDropdown(r.activity_id);
  el("fBillable").value = r.billable ? "true" : "false";
  el("fDesc").value = r.description || "";

  openModal();
}

function getFormPayload(){
  const entry_date = el("fDate").value;
  const hours = Number(el("fHours").value);
  const client_id = el("fClient").value;
  const project_id = el("fProject").value;
  const activity_id = el("fActivity").value;
  const description = el("fDesc").value || "";
  const billable = el("fBillable").value === "true";

  if (!entry_date) { el("modalStatus").textContent = "Kies een datum."; return null; }
  if (!hours || hours <= 0) { el("modalStatus").textContent = "Vul geldige uren in."; return null; }
  if (!client_id || !project_id || !activity_id) { el("modalStatus").textContent = "Kies klant/project/activiteit."; return null; }

  return { entry_date, hours, client_id, project_id, activity_id, description, billable };
}

function openModal(){
  el("modal").classList.add("open");
}
function closeModal(){
  el("modal").classList.remove("open");
}
