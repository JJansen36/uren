import { makeSupabaseClient, requireSession, getMyProfile } from "./auth.js";
import { escapeHtml } from "./utils.js";

const sb = makeSupabaseClient();
const el = (id)=>document.getElementById(id);

let session=null, profile=null;

document.addEventListener("DOMContentLoaded", init);

async function init(){
  session = await requireSession(sb);
  if (!session) return;

  profile = await getMyProfile(sb);
  el("meBadge").textContent = `${profile.name || 'Admin'} • ${profile.role}`;
  el("btnLogout").onclick = async ()=>{ await sb.auth.signOut(); location.href="index.html"; };

  if (profile.role !== "admin"){
    document.body.innerHTML = `<div class="container"><div class="card"><h2>Geen toegang</h2><p class="help">Je bent geen admin.</p><a href="app.html">Terug</a></div></div>`;
    return;
  }

  wireActions();
  await reloadAll();
}

function wireActions(){
  el("btnAddClient").onclick = addClient;
  el("btnAddProject").onclick = addProject;
  el("btnAddActivity").onclick = addActivity;
}

async function reloadAll(){
  await Promise.all([loadClients(), loadProjects(), loadActivities(), loadProfiles()]);
}

async function loadClients(){
  const { data, error } = await sb.from("clients").select("id,name,active").order("name");
  if (error) throw error;

  // dropdown voor projecten
  el("projClient").innerHTML = data.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  el("clientsBody").innerHTML = data.map(c=>`
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${c.active ? "Ja" : "Nee"}</td>
      <td>
        <button class="small" data-toggle-client="${c.id}" data-active="${c.active}">Activeer/Deactiveer</button>
      </td>
    </tr>
  `).join("");

  el("clientsBody").querySelectorAll("button[data-toggle-client]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-toggle-client");
      const active = btn.getAttribute("data-active")==="true";
      await sb.from("clients").update({ active: !active }).eq("id", id);
      await loadClients();
      await loadProjects();
    };
  });
}

async function addClient(){
  const name = el("newClient").value.trim();
  if (!name) return;
  const { error } = await sb.from("clients").insert({ name, active:true });
  if (error) alert(error.message);
  el("newClient").value="";
  await loadClients();
}

async function loadProjects(){
  const { data, error } = await sb
    .from("projects")
    .select("id,name,client_id,active, clients(name)")
    .order("name");
  if (error) throw error;

  el("projectsBody").innerHTML = data.map(p=>`
    <tr>
      <td>${escapeHtml(p.clients?.name || "-")}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.active ? "Ja" : "Nee"}</td>
      <td>
        <button class="small" data-toggle-project="${p.id}" data-active="${p.active}">Activeer/Deactiveer</button>
      </td>
    </tr>
  `).join("");

  el("projectsBody").querySelectorAll("button[data-toggle-project]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-toggle-project");
      const active = btn.getAttribute("data-active")==="true";
      await sb.from("projects").update({ active: !active }).eq("id", id);
      await loadProjects();
    };
  });
}

async function addProject(){
  const client_id = el("projClient").value;
  const name = el("newProject").value.trim();
  if (!client_id || !name) return;
  const { error } = await sb.from("projects").insert({ client_id, name, active:true });
  if (error) alert(error.message);
  el("newProject").value="";
  await loadProjects();
}

async function loadActivities(){
  const { data, error } = await sb.from("activities").select("id,name,billable_default,active").order("name");
  if (error) throw error;

  el("activitiesBody").innerHTML = data.map(a=>`
    <tr>
      <td>${escapeHtml(a.name)}</td>
      <td>${a.billable_default ? "Ja" : "Nee"}</td>
      <td>${a.active ? "Ja" : "Nee"}</td>
      <td>
        <button class="small" data-toggle-activity="${a.id}" data-active="${a.active}">Activeer/Deactiveer</button>
      </td>
    </tr>
  `).join("");

  el("activitiesBody").querySelectorAll("button[data-toggle-activity]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-toggle-activity");
      const active = btn.getAttribute("data-active")==="true";
      await sb.from("activities").update({ active: !active }).eq("id", id);
      await loadActivities();
    };
  });
}

async function addActivity(){
  const name = el("newActivity").value.trim();
  const billable_default = el("newActivityBillable").value === "true";
  if (!name) return;
  const { error } = await sb.from("activities").insert({ name, billable_default, active:true });
  if (error) alert(error.message);
  el("newActivity").value="";
  await loadActivities();
}

async function loadProfiles(){
  const { data, error } = await sb.from("profiles").select("id,user_id,name,role,created_at").order("created_at", {ascending:false});
  if (error) throw error;

  el("profilesBody").innerHTML = data.map(p=>`
    <tr>
      <td><input data-name="${p.id}" value="${escapeHtml(p.name)}" /></td>
      <td><code>${p.user_id}</code></td>
      <td>
        <select data-role="${p.id}">
          <option value="user" ${p.role==="user"?"selected":""}>user</option>
          <option value="admin" ${p.role==="admin"?"selected":""}>admin</option>
        </select>
      </td>
      <td>
        <button class="small" data-save-profile="${p.id}">Opslaan</button>
      </td>
    </tr>
  `).join("");

  el("profilesBody").querySelectorAll("button[data-save-profile]").forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-save-profile");
      const name = el("profilesBody").querySelector(`input[data-name="${id}"]`).value.trim();
      const role = el("profilesBody").querySelector(`select[data-role="${id}"]`).value;
      const { error } = await sb.from("profiles").update({ name, role }).eq("id", id);
      el("status").textContent = error ? error.message : "Profiel opgeslagen.";
      await loadProfiles();
    };
  });
}
