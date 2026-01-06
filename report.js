import { makeSupabaseClient, requireSession, getMyProfile } from "./auth.js";
import {
  startOfISOWeek, addDays, toISODate, parseISODate,
  getQueryParam, formatNLDate, formatHours, sum, escapeHtml
} from "./utils.js";

const sb = makeSupabaseClient();
const el = (id)=>document.getElementById(id);

document.addEventListener("DOMContentLoaded", init);

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
  el("body").innerHTML = rows.map(r=>`
    <tr>
      <td>${formatNLDate(r.entry_date)}</td>
      <td>${escapeHtml(r.clients?.name || "-")}</td>
      <td>${escapeHtml(r.projects?.name || "-")}</td>
      <td>${escapeHtml(r.activities?.name || "-")}</td>
      <td>${escapeHtml(r.description || "")}</td>
      <td><b>${formatHours(r.hours)}</b></td>
      <td>${r.billable ? "Ja" : "Nee"}</td>
    </tr>
  `).join("");

  const total = sum(rows, r=>Number(r.hours||0));
  const bill = sum(rows.filter(r=>r.billable), r=>Number(r.hours||0));
  const non = total - bill;

  el("tTotal").textContent = formatHours(total);
  el("tBill").textContent = formatHours(bill);
  el("tNon").textContent = formatHours(non);

  el("status").textContent = rows.length ? "" : "Geen uren in deze week.";
}
