import { makeSupabaseClient, requireSession, getMyProfile } from "./auth.js";
import {
  startOfISOWeek, addDays, toISODate, parseISODate,
  getQueryParam, formatNLDate, formatHours, sum, escapeHtml
} from "./utils.js";

const sb = makeSupabaseClient();
const el = (id)=>document.getElementById(id);

document.addEventListener("DOMContentLoaded", init);

async function loadWeekWorkedHoursReport(sb, userId, weekStart, DAILY_NORM){
  const end = addDays(weekStart, 6);

  const { data: workdays } = await sb
    .from("workdays")
    .select("id")
    .eq("user_id", userId)
    .gte("work_date", toISODate(weekStart))
    .lte("work_date", toISODate(end));

  if (!workdays || workdays.length === 0){
    return { total: 0, billable: 0, saldo: 0 };
  }

  const workdayIds = workdays.map(w => w.id);

  const { data: blocks } = await sb
    .from("workday_blocks")
    .select("total_hours")
    .in("workday_id", workdayIds);

  const totalWorked = (blocks || []).reduce(
    (t,b)=>t+Number(b.total_hours||0), 0
  );

  const { data: entries } = await sb
    .from("time_entries")
    .select("hours,billable")
    .eq("user_id", userId)
    .gte("entry_date", toISODate(weekStart))
    .lte("entry_date", toISODate(end));

  const billable = (entries || [])
    .filter(e=>e.billable)
    .reduce((t,e)=>t+Number(e.hours||0),0);

const normDays = workdays.filter(w=>{
  const d = new Date(w.work_date);
  const day = d.getDay();
  return day !== 0 && day !== 6;
}).length;

const normTotal = normDays * DAILY_NORM;


  return {
    total: totalWorked,
    billable,
    saldo: totalWorked - normTotal
  };
}

async function loadWorkedBlocksByDate(sb, userId, weekStart){
  const end = addDays(weekStart, 6);

  const { data: workdays } = await sb
    .from("workdays")
    .select("id, work_date")
    .eq("user_id", userId)
    .gte("work_date", toISODate(weekStart))
    .lte("work_date", toISODate(end));

  if (!workdays || workdays.length === 0) return {};

  const idToDate = {};
  workdays.forEach(w => {
    idToDate[w.id] = w.work_date;
  });

  const { data: blocks } = await sb
    .from("workday_blocks")
    .select("workday_id,start_time,end_time,break_minutes,total_hours")
    .in("workday_id", Object.keys(idToDate))
    .order("start_time");

  // ✅ HIER is blocks geldig
  console.log("BLOCKS from supabase:", blocks);

  const map = {};
  Object.values(idToDate).forEach(date => {
    map[date] = { total: 0, blocks: [] };
  });

  (blocks || []).forEach(b => {
    const date = idToDate[b.workday_id];
    if (!date) return;

    map[date].blocks.push(b);
    map[date].total += Number(b.total_hours || 0);
  });

  // ✅ en hier ook
  console.log("MAP PER DATE:", map);

  return map;
}



async function init(){
  const session = await requireSession(sb);
  if (!session) return;

  const profile = await getMyProfile(sb);

  const qs = getQueryParam("weekStart");
  const ws = qs ? startOfISOWeek(parseISODate(qs)) : startOfISOWeek(new Date());
  const we = addDays(ws, 6);

  el("label").textContent = `${toISODate(ws)} – ${toISODate(we)}`;
  el("who").textContent = `Medewerker: ${profile.name || session.user.email}`;
  el("range").textContent = `Week: ${formatNLDate(toISODate(ws))} t/m ${formatNLDate(toISODate(we))}`;

  el("btnPrint").onclick = ()=> window.print();

  const d1 = toISODate(ws);
  const d2 = toISODate(we);

  el("status").textContent = "Laden…";

  const { data, error } = await sb
    .from("time_entries")
    .select(`
      id, entry_date, hours, description, billable,
      clients(name),
      projects(name),
      activities(name)
    `)
    .gte("entry_date", d1)
    .lte("entry_date", d2)
    .order("entry_date", {ascending:true});

  if (error){
    el("status").textContent = error.message;
    return;
  }

const rows = data || [];

// ⏱ gewerkte tijdblokken per dag ophalen
const workedByDate =
  await loadWorkedBlocksByDate(sb, session.user.id, ws);


// groeperen per dag
const byDate = {};
rows.forEach(r => {
  if (!byDate[r.entry_date]) byDate[r.entry_date] = [];
  byDate[r.entry_date].push(r);

  
});

let html = "";

// alle datums uit werkblokken nemen als basis
Object.keys(workedByDate).sort().forEach(date => {
  const worked = workedByDate[date] || { total: 0, blocks: [] };
  const dayRows = byDate[date] || [];

  html += `
    <tr class="day-header">
      <td colspan="7">
        <b>${formatNLDate(date)}</b>
        <span class="day-total">
          Totaal gewerkt: ${formatHours(worked.total)}
        </span>
      </td>
    </tr>
  `;

  // ⏱ alle werkblokken
  worked.blocks.forEach(b => {
    html += `
      <tr class="work-block">
        <td colspan="7">
          ⏱ ${b.start_time} – ${b.end_time}
          <span class="pause">(pauze ${b.break_minutes || 0} min)</span>
        </td>
      </tr>
    `;
  });

  // specificaties (kan leeg zijn)
  if (dayRows.length === 0){
    html += `
      <tr class="no-spec">
        <td colspan="7"><i>Geen gespecificeerde uren</i></td>
      </tr>
    `;
  }

  dayRows.forEach(r => {
    html += `
      <tr>
        <td></td>
        <td>${escapeHtml(r.clients?.name || "-")}</td>
        <td>${escapeHtml(r.projects?.name || "-")}</td>
        <td>${escapeHtml(r.activities?.name || "-")}</td>
        <td>${escapeHtml(r.description || "")}</td>
        <td><b>${formatHours(r.hours)}</b></td>
        <td>${r.billable ? "Ja" : "Nee"}</td>
      </tr>
    `;
  });
});



el("body").innerHTML = html;


const DAILY_NORM = Number(profile.daily_norm || 7.75);

const { total, billable, saldo } =
  await loadWeekWorkedHoursReport(sb, session.user.id, ws, DAILY_NORM);

el("tTotal").textContent = formatHours(total);
el("tBill").textContent = formatHours(billable);
el("tNon").textContent = formatHours(total - billable);

// saldo
const saldoEl = el("kpiSaldo");
const saldoBox = el("kpiSaldoBox");

if (saldoEl){
  const sign = saldo > 0 ? "+" : "";
  saldoEl.textContent = sign + formatHours(saldo);
}

if (saldoBox){
  saldoBox.classList.remove("positive","negative");
  if (saldo > 0.01) saldoBox.classList.add("positive");
  else if (saldo < -0.01) saldoBox.classList.add("negative");
}


  el("status").textContent = rows.length ? "" : "Geen uren in deze week.";
}
