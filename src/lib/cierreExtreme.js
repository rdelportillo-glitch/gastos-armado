// Cierre en línea (Extreme): lectura del Reporte detallado de encuestas de precierre, histórico en la tabla cierre_extreme y cálculo del cumplimiento.
//  · "Cerrado a tiempo" (dentro del NDS) = la hora fin de trabajo es ANTES de la hora límite (por defecto las 17:00, es decir, hasta las 4:59 p.m.).
//  · Un producto sin hora fin de trabajo queda "sin hora de cierre" (pendiente): no cuenta para el porcentaje.
//  · No se guardan direcciones, teléfonos, cédulas ni nombres de clientes; el usuario de Extreme del técnico solo se usa para ubicarlo en Personal.
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";

export const HORA_LIMITE = 17;
const pad2 = (n) => String(n).padStart(2, "0");
export const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
export const normUser = (s) => String(s ?? "").replace(/\s+/g, "").replace(/^0+/, "").toUpperCase();
const titulo = (s) => (s ? String(s).replace(/_/g, " ").trim().split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ") : "");

// "2026-10-24 06:27:00" | número de serie de Excel | Date → { day, hour, at } en hora local (sin zona horaria). null si no es una fecha.
export function fechaHora(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    // Número de serie de Excel (días desde 1899-12-30): representa la hora local tal cual, sin zona horaria.
    if (!isFinite(v) || v < 1) return null;
    const d = new Date(Math.round((v - 25569) * 86400000));
    const y = d.getUTCFullYear(), mo = pad2(d.getUTCMonth() + 1), da = pad2(d.getUTCDate());
    return { day: `${y}-${mo}-${da}`, hour: d.getUTCHours(), at: `${y}-${mo}-${da}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}` };
  }
  if (v instanceof Date) return isNaN(v) ? null : { day: `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`, hour: v.getHours(), at: `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}T${pad2(v.getHours())}:${pad2(v.getMinutes())}:${pad2(v.getSeconds())}` };
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return { day, hour: null, at: null };
  return { day, hour: Number(m[4]), at: `${day}T${m[4]}:${m[5]}:${m[6] || "00"}` };
}

// "ASC - DIEGO ARMANDO PEÑA PARRA - MA" → nombre tal cual lo trae Extreme (sin el código de la empresa)
const tecnicoDeConductor = (c) => String(c || "").replace(/\s+/g, " ").trim();

// Filas del Reporte detallado de encuestas de precierre (matriz de la hoja, con los 4 encabezados de arriba) → filas de cierre_extreme.
// Columnas del reporte: 1 servicio-código · 2 estado · 3 fecha creación · 4 usuario (placa) · 5 conductor · 14 HORA FIN DE TRABAJO · 16 causal.
// ctx: { archivo, userId, techs (Personal), servicios(servicio, codigo) → registro de Carga o null, coordDe(departamento) → coordinador }
export function filasDeEncuestas(rows, ctx = {}) {
  const porUser = new Map();
  (ctx.techs || []).forEach((t) => { if (t.extremeUser) porUser.set(normUser(t.extremeUser), t); });
  const cuenta = new Map(); const out = [];
  rows.slice(4).forEach((r) => {
    const clave = String(r[1] ?? "").trim();
    if (!/^\d+-\d+/.test(clave)) return;
    const est = plano(r[2]);
    const estado = est === "REALIZADO" ? "Realizado" : est === "NO REALIZADO" ? "No realizado" : "";
    if (!estado) return;
    const fin = fechaHora(r[14]), cre = fechaHora(r[3]);
    const day = (fin && fin.day) || (cre && cre.day);
    if (!day) return;
    const dash = clave.indexOf("-"); const servicio = clave.slice(0, dash), codigo = clave.slice(dash + 1);
    const unidad = (cuenta.get(clave) || 0) + 1; cuenta.set(clave, unidad);
    const t = porUser.get(normUser(r[4])) || null;
    const reg = ctx.servicios ? ctx.servicios(servicio, codigo) : null;
    const depto = plano((reg && ((reg.asig && reg.asig.depto) || reg.departamentoExterno)) || (t && t.department) || "");
    const muni = plano((reg && ((reg.asig && reg.asig.ciudad) || reg.ciudadExterna)) || "");
    out.push({
      clave, unidad, servicio, codigo, closed_day: day, closed_hour: fin && fin.hour !== null ? fin.hour : null, closed_at: fin && fin.at ? fin.at : null,
      scheduled_day: reg ? String(reg.fechaProg || reg.date || "").slice(0, 10) || null : null,
      technician_id: t ? t.id : null, tecnico: t ? t.name : tecnicoDeConductor(r[5]) || null,
      coordinador: (ctx.coordDe && depto ? ctx.coordDe(depto) : "") || null, departamento: depto || null, municipio: muni || null,
      estado, causal: String(r[16] ?? "").trim() || null, origen: "encuestas", source_file: ctx.archivo || null, loaded_by: ctx.userId || null,
    });
  });
  return out;
}

// Excel histórico del tablero de Cierre en Línea (hoja "Base"): SERVICIO, CODIGO, MUNICIPIO, DEPARTAMENTO, TÉCNICO, COORDINADOR, FECHA PROGRAMADA, Fecha Cierre, Hora Cierre, CAUSAL.
// Solo trae la HORA (sin minutos) de cierre. Devuelve { filas, desde, hasta }.
export function filasDeExcelDash(buffer, ctx = {}) {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets["Base"] || wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { defval: null });
  if (!data.length || !("SERVICIO" in data[0]) || !("Fecha Cierre" in data[0])) throw new Error("No parece el Excel de Cierre en Línea: la hoja \"Base\" debe traer SERVICIO, CODIGO y Fecha Cierre.");
  const cuenta = new Map(); const filas = [];
  data.forEach((r) => {
    if (r.SERVICIO === null || r.SERVICIO === undefined || r.SERVICIO === "") return;
    const cierre = fechaHora(r["Fecha Cierre"]);
    if (!cierre) return;
    const servicio = String(r.SERVICIO).trim(), codigo = String(r.CODIGO ?? "").trim(), clave = `${servicio}-${codigo}`;
    const unidad = (cuenta.get(clave) || 0) + 1; cuenta.set(clave, unidad);
    const prog = fechaHora(r["FECHA PROGRAMADA"]);
    filas.push({
      clave, unidad, servicio, codigo, closed_day: cierre.day, closed_hour: typeof r["Hora Cierre"] === "number" ? r["Hora Cierre"] : null, closed_at: null, scheduled_day: prog ? prog.day : null,
      technician_id: null, tecnico: titulo(r["TÉCNICO"]) || null, coordinador: titulo(r["COORDINADOR"]) || null, departamento: plano(r["DEPARTAMENTO"]) || null, municipio: plano(r["MUNICIPIO"]) || null,
      estado: "Realizado", causal: r["CAUSAL"] === null || r["CAUSAL"] === undefined ? null : String(r["CAUSAL"]), origen: "excel-dash", source_file: ctx.archivo || null, loaded_by: ctx.userId || null,
    });
  });
  const dias = filas.map((f) => f.closed_day).sort();
  return { filas, desde: dias[0] || null, hasta: dias[dias.length - 1] || null };
}

// Guarda sin duplicar (única por clave y unidad). Devuelve cuántas filas se enviaron.
// soloNuevas: no pisa lo que ya está guardado (se usa con el Excel histórico, para que nunca reemplace lo cargado desde el reporte de Extreme).
export async function guardarCierres(filas, { soloNuevas = false } = {}) {
  const unico = new Map(); filas.forEach((f) => unico.set(`${f.clave}|${f.unidad}`, f));
  const lista = [...unico.values()];
  for (let i = 0; i < lista.length; i += 500) {
    const { error } = await supabase.from("cierre_extreme").upsert(lista.slice(i, i + 500), { onConflict: "clave,unidad", ignoreDuplicates: soloNuevas });
    if (error) throw new Error(error.message);
  }
  return lista.length;
}

// Cierres de un rango de días (por el día de la hora fin de trabajo), sin límite de 1.000 filas.
export async function cargarCierres({ from, to } = {}) {
  const cols = "closed_day,closed_hour,scheduled_day,tecnico,technician_id,coordinador,departamento,municipio,estado,causal,servicio,clave,origen,loaded_at";
  const out = [];
  for (let start = 0; ; start += 1000) {
    let q = supabase.from("cierre_extreme").select(cols).order("closed_day").order("id");
    if (from) q = q.gte("closed_day", from);
    if (to) q = q.lte("closed_day", to);
    const { data, error } = await q.range(start, start + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/* ------------------------------- Cálculo ------------------------------- */

export const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0);
export const tieneHora = (r) => r.closed_hour !== null && r.closed_hour !== undefined;
export const estaDentro = (r, lim) => tieneHora(r) && r.closed_hour < lim;
export const estadoNds = (r, lim) => (!tieneHora(r) ? "pendiente" : r.closed_hour < lim ? "dentro" : "fuera");

export function statsNds(rows, lim) {
  let dentro = 0, fuera = 0, pend = 0;
  rows.forEach((r) => { if (!tieneHora(r)) pend++; else if (r.closed_hour < lim) dentro++; else fuera++; });
  const evaluados = dentro + fuera;
  return { total: rows.length, dentro, fuera, pend, evaluados, pct: pct(dentro, evaluados) };
}

export function agrupar(rows, keyFn, lim) {
  const m = new Map();
  rows.forEach((r) => { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m.entries()].map(([key, rs]) => ({ key, ...statsNds(rs, lim), rows: rs }));
}

export function semanaIso(dia) {
  const [y, m, d] = dia.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const n = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - n + 3);
  const jueves = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const sem = 1 + Math.round(((date - jueves) / 86400000 - 3 + ((jueves.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-S${pad2(sem)}`;
}
export const diaSemana = (dia) => { const [y, m, d] = dia.split("-").map(Number); return new Date(y, m - 1, d).getDay(); }; // 0 = domingo
export const sumarDias = (dia, n) => { const [y, m, d] = dia.split("-").map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`; };
export const diasEntre = (a, b) => { const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000); };

// Semáforo del cumplimiento (igual que el tablero de Cierre en Línea).
export function nivel(p) {
  if (p >= 95) return { label: "Excelente", color: "#12a166", key: "green" };
  if (p >= 90) return { label: "Aceptable", color: "#d9a400", key: "amber" };
  if (p >= 85) return { label: "Alerta", color: "#ff9540", key: "orange" };
  return { label: "Crítico", color: "#e0435c", key: "red" };
}
