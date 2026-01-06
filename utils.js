// utils.js

export function toISODate(d){
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth()+1).padStart(2,'0');
  const dd = String(x.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseISODate(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

// ISO week: week starts Monday
export function startOfISOWeek(date){
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  d.setDate(d.getDate() - day);
  d.setHours(0,0,0,0);
  return d;
}
export function endOfISOWeek(date){
  const s = startOfISOWeek(date);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  e.setHours(23,59,59,999);
  return e;
}

export function addDays(date, n){
  const d = new Date(date);
  d.setDate(d.getDate()+n);
  return d;
}

export function formatNLDate(iso){
  const d = parseISODate(iso);
  return d.toLocaleDateString('nl-NL', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric' });
}

export function formatHours(n){
  const x = Number(n || 0);
  return x.toFixed(2).replace('.', ',');
}

export function getQueryParam(name){
  return new URLSearchParams(location.search).get(name);
}

export function setQueryParam(name, value){
  const url = new URL(location.href);
  url.searchParams.set(name, value);
  history.replaceState({}, '', url.toString());
}

export function sum(arr, fn){
  return arr.reduce((a,x)=>a+(fn?fn(x):x),0);
}

export function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
