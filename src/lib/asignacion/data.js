// Datos y reglas de negocio del módulo de Asignación (sin pantallas): maestros, técnicos del día,
// lectura de las bases, y conversión entre las filas del motor y los registros de "services".
import * as XLSX from "xlsx";
import { supabase } from "../supabaseClient";
import { fetchAll } from "../maestrosApi";
import * as E from "./engine.js";
import { buildMasters } from "./masters.js";

export const U = E.U;

/* ------------------------------ Maestros ------------------------------ */

let mastersPromise = null;
export function invalidateMasters() { mastersPromise = null; }

// Zonas, barrios, productos y complejidad desde Supabase, ya en el formato del motor.
// Se cachea en memoria: son ~13.000 filas y no cambian durante la sesión.
export function loadMasters() {
  if (!mastersPromise) {
    mastersPromise = (async () => {
      const [abbreviations, zones, nbh, products, complexity] = await Promise.all([
        fetchAll("geo_abbreviations", "*", "abbr"),
        fetchAll("geo_zones", "id,name,latitude,longitude,zone_id,cluster,region,compatibility,zone_type,dept_abbr,distance_km,travel_time,active", "id"),
        fetchAll("geo_neighborhoods", "city,neighborhood,region,zone_type,zone_id,active", "id"),
        fetchAll("assembly_products", "code,name,minutes,persons,active", "id"),
        fetchAll("assembly_complexity", "line,subline,complexity,embeddable", "id"),
      ]);
      const nameById = new Map(zones.map((z) => [z.id, z.name]));
      const neighborhoods = nbh.map((n) => ({ ...n, zoneName: nameById.get(n.zone_id) })).filter((n) => n.zoneName);
      const M = buildMasters({ abbreviations, zones, neighborhoods, products, complexity });
      return { M, idx: E.buildIndex(M), abbreviations, counts: { zonas: zones.length, barrios: nbh.length, productos: products.length, complejidad: complexity.length } };
    })().catch((e) => { mastersPromise = null; throw e; });
  }
  return mastersPromise;
}

/* ------------------------------ Criterios ------------------------------ */

export const DEFAULT_RULES = E.DEFAULT_RULES;

export async function loadRules() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", "rules").maybeSingle();
  if (error) throw new Error(error.message);
  return { ...DEFAULT_RULES, ...((data && data.value) || {}) };
}

export async function saveRules(rules, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: "rules", value: rules, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------- Disponibilidad --------------------------- */

// Motivos del Excel de Tablas de Datos (hoja Motivos), más "Sede".
export const ESTADOS_DIA = [
  "Disponible", "Sede", "Descanso", "Vacaciones", "Permiso", "Incapacidad", "Licencia", "Capacitación",
  "Reunión", "Movido", "Banca", "Accidente", "Avería moto", "Retiro",
];
// Estados que pueden ser parciales: con minutos de novedad menores a la capacidad, el técnico sigue
// disponible por el resto del día. En cualquier otro estado no sale a ruta ese día.
const ESTADOS_PARCIALES = ["Permiso", "Incapacidad", "Licencia", "Capacitación", "Reunión", "Accidente", "Avería moto"];

export async function loadAvailability(date) {
  const { data, error } = await supabase.from("assignment_availability").select("technician_id,state,novelty_minutes").eq("date", date);
  if (error) throw new Error(error.message);
  const m = {};
  (data || []).forEach((r) => { m[r.technician_id] = { state: r.state, novelty: r.novelty_minutes || 0 }; });
  return m;
}

export async function saveAvailability(date, rows, userId) {
  if (!rows.length) return;
  const payload = rows.map((r) => ({ date, technician_id: r.technicianId, state: r.state, novelty_minutes: Math.max(0, Math.round(Number(r.novelty) || 0)), updated_by: userId, updated_at: new Date().toISOString() }));
  const { error } = await supabase.from("assignment_availability").upsert(payload, { onConflict: "date,technician_id" });
  if (error) throw new Error(error.message);
}

/* ------------------------------- Técnicos ------------------------------- */

export const isRouteTech = (t) => t.category !== "Administrativo" && /junior|senior/i.test(t.type || "") && t.status === "Activo";
export const perfilDe = (t) => (/senior/i.test(t.type || "") ? "Maestro" : "Aprendiz");

// Personal + disponibilidad del día → lista de técnicos en el formato del motor.
export function engineTechs(technicians, availability, abbreviations) {
  const regionOf = {};
  (abbreviations || []).filter((a) => a.level === "MUNICIPIO").forEach((a) => { regionOf[U(a.name)] = a.region_id; });
  const used = new Set();
  return technicians.filter(isRouteTech).map((t) => {
    const av = availability[t.id] || {};
    const base = t.operationSite === "Sede" ? "Sede" : "Disponible";
    const estado = av.state || base;
    const nov = Math.max(0, Number(av.novelty) || 0);
    const cap = t.capacityMinutes || 0;
    let capEff = 0;
    if (estado === "Disponible") capEff = Math.max(0, cap - nov);
    else if (ESTADOS_PARCIALES.includes(estado) && nov > 0 && nov < cap) capEff = cap - nov;
    let n = t.name; if (used.has(n)) n = `${t.name} (${t.code})`; used.add(n);
    const perf = perfilDe(t);
    return {
      n, id: t.id, code: t.code, dep: U(t.department), reg: regionOf[U(t.department)] ?? null, perf, emp: perf === "Maestro",
      cap, capEff, ord: t.assignOrder ?? null, tr: t.transportMode || "", pyp: t.picoPlacaDay || "", com: t.notes || "", tel: t.phone || "",
      usr: t.extremeUser || "", coord: t.coordinator || "", estado, nov, activo: capEff > 0,
    };
  });
}

/* -------------------------------- Bases -------------------------------- */

function sheetRows(wb, prefer, mustHave) {
  const names = prefer ? [prefer, ...wb.SheetNames] : wb.SheetNames;
  for (const n of names) {
    const ws = wb.Sheets[n]; if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    if (!rows.length) continue;
    if (!mustHave || mustHave.every((k) => k in rows[0])) return rows;
  }
  return null;
}

// kind: "jamar" (hoja Hoja139, columna SERVICIO) o "tugo" (columna evento). Devuelve filas del motor (una por unidad).
export function parseBaseFile(arrayBuffer, kind, masters) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  if (kind === "tugo") {
    const rows = sheetRows(wb, null, ["evento"]);
    if (!rows) throw new Error("El archivo no tiene el formato de la Base TUGO (falta la columna \"evento\").");
    return E.enrichTugo(rows, masters.M, masters.idx);
  }
  const rows = sheetRows(wb, "Hoja139", ["SERVICIO"]);
  if (!rows) throw new Error("No encontré una hoja con la columna SERVICIO. Debe ser la Base de Asignación (hoja Hoja139).");
  return E.enrichBase(rows, masters.M, masters.idx);
}

// Aplica una zona equivalente elegida a mano a una fila del motor.
export function applyZoneToRow(r, zoneName, masters) {
  const zi = masters.idx.zona.get(U(zoneName));
  if (!zi) return;
  Object.assign(r, { zona: zoneName, zonaVia: "manual", lat: zi[0], lng: zi[1], idzona: zi[2], cluster: zi[3], zc: zi[5] ?? null, region: zi[4] ?? r.region });
}

// Validaciones de la carga (misma idea que el paso Carga del HTML).
export function validateRows(rows) {
  const groupBy = (list, keyFn) => { const m = new Map(); list.forEach((r) => { const k = keyFn(r); m.set(k, [...(m.get(k) || []), r]); }); return m; };
  return {
    sinZona: [...groupBy(rows.filter((r) => !r.zona), (r) => `${r.depto}|${r.ciudad}|${r.barrio}`).entries()],
    sinTiempo: [...groupBy(rows.filter((r) => !r.tiempo), (r) => r.codigo || r.producto).entries()],
    tiempoJamar: rows.filter((r) => r.tiempoFuente === "JAMAR").length,
    sinComplejidad: rows.filter((r) => !r.complejidad && r.origen === "Base").length,
    sinTelefono: rows.filter((r) => !r.telefono).length,
    sinRegion: rows.filter((r) => r.region === null || r.region === undefined).length,
  };
}

/* ------------------------- Filas ⇄ registros services ------------------------- */

const isoDate = (v) => (v || "").slice(0, 10);

// Una fila de "services" por Servicio + Código de producto (las unidades repetidas suman cantidad).
export function rowsToServiceRecords(rows, session) {
  const groups = new Map();
  rows.forEach((r) => { const k = `${r.servicio}|${r.codigo}`; groups.set(k, [...(groups.get(k) || []), r]); });
  return [...groups.values()].map((g) => {
    const r0 = g[0];
    const { _k, _i, ...asig } = r0;
    return {
      servicioExterno: String(r0.servicio), productoExternoCodigo: String(r0.codigo || ""), productoExternoNombre: r0.producto,
      clienteNombre: r0.cliente, direccion: r0.direccion, departamentoExterno: r0.depto, ciudadExterna: r0.ciudad, serviceType: r0.tipo || null,
      quantity: g.length, date: isoDate(r0.fecha), fechaProg: isoDate(r0.fecha), tiempoMin: g.reduce((s, r) => s + (r.tiempo || 0), 0),
      asig, estadoGestion: "Pendiente", technicianId: null, tecnico2Nombre: "", tecnico3Nombre: "", rutaOrden: null,
      responsibleUserId: session.id,
    };
  });
}

// Servicios pendientes (o ya asignados del mismo día, si se pide) que entran a la asignación de la fecha D.
export function poolServices(services, { fecha, desde, incluirAsignados }) {
  return (services || []).filter((s) => s.asig && (
    (s.estadoGestion === "Pendiente" && s.date <= fecha && (!desde || s.date >= desde)) ||
    (incluirAsignados && s.estadoGestion === "En gestión" && s.date === fecha)
  ));
}

// Registros de la base → filas del motor (una por unidad). La fecha del motor es la de la asignación.
export function poolToEngineRows(list, fecha) {
  const rows = [];
  list.forEach((s) => {
    const n = Math.max(1, Math.round(s.quantity || 1));
    for (let i = 0; i < n; i++) rows.push({ ...s.asig, fecha, _dbId: s.id });
  });
  return rows;
}

// Resultado del plan → registros services actualizados (técnico, apoyo, orden y estado En gestión).
export function applyPlanToServices(services, plan, techs, fecha) {
  const byName = new Map(techs.map((t) => [t.n, t]));
  const assigned = new Map(); // dbId -> { tech, helper, orden }
  const seen = new Set();
  plan.services.forEach((s) => {
    s.rows.forEach((r) => {
      if (!r._dbId) return;
      seen.add(r._dbId);
      if (s.tech && byName.get(s.tech)) assigned.set(r._dbId, { tech: byName.get(s.tech), helper: s.helpers && s.helpers[0] ? byName.get(s.helpers[0]) : null, orden: s.orden || null });
    });
  });
  let asignados = 0, liberados = 0;
  const next = services.map((s) => {
    if (!seen.has(s.id)) return s;
    const a = assigned.get(s.id);
    if (a) {
      asignados++;
      return { ...s, technicianId: a.tech.id, tecnico2Nombre: a.tech.n, tecnico3Nombre: a.helper ? a.helper.n : "", rutaOrden: a.orden, estadoGestion: "En gestión", date: fecha, fechaProg: fecha };
    }
    if (s.estadoGestion === "En gestión") { // estaba asignado y ahora quedó sin técnico: vuelve a pendientes
      liberados++;
      return { ...s, technicianId: null, tecnico2Nombre: "", tecnico3Nombre: "", rutaOrden: null, estadoGestion: "Pendiente" };
    }
    return s;
  });
  return { services: next, asignados, liberados };
}

/* --------------------------------- Resumen --------------------------------- */

// Reporte sobre lo ya guardado en Carga: por técnico (y opcionalmente por día) cuántos servicios,
// cuántos movimientos (direcciones distintas el mismo día), productos y minutos de producto.
export function assignmentReport(services, technicians, { from, to, depto, byDay }) {
  const techById = Object.fromEntries(technicians.map((t) => [t.id, t]));
  const groups = new Map();
  (services || []).forEach((s) => {
    if (!s.asig || !s.technicianId || !["En gestión", "Realizado"].includes(s.estadoGestion)) return;
    if ((from && s.date < from) || (to && s.date > to)) return;
    const t = techById[s.technicianId];
    if (!t || (depto && t.department !== depto)) return;
    const key = byDay ? `${s.date}|${s.technicianId}` : s.technicianId;
    const g = groups.get(key) || { date: byDay ? s.date : "", techId: s.technicianId, name: t.name, depto: t.department || "", servicios: new Set(), direcciones: new Set(), productos: 0, minutos: 0, realizados: 0 };
    g.servicios.add(`${s.date}|${s.servicioExterno}`);
    g.direcciones.add(`${s.date}|${U(s.ciudadExterna)}|${U(s.direccion)}`);
    g.productos += s.quantity || 1;
    g.minutos += s.tiempoMin || 0;
    if (s.estadoGestion === "Realizado") g.realizados += s.quantity || 1;
    groups.set(key, g);
  });
  return [...groups.values()].map((g) => ({ ...g, servicios: g.servicios.size, movimientos: g.direcciones.size, direcciones: undefined }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.depto.localeCompare(b.depto) || a.name.localeCompare(b.name));
}

// Servicios, movimientos (direcciones distintas) y minutos por técnico.
export function summaryByTech(plan) {
  const byId = new Map(plan.services.map((s) => [s.id, s]));
  return plan.techs.filter((p) => p.svcIds.length || p.help.length).map((p) => {
    const sv = p.svcIds.map((id) => byId.get(id)).filter(Boolean);
    const dirs = new Set(sv.map((s) => `${U(s.ciudad)}|${U(s.direccion)}`));
    return { n: p.n, dep: p.t.dep, perf: p.t.perf, servicios: sv.length, productos: sv.reduce((a, s) => a + s.rows.length, 0), movimientos: dirs.size, minutos: p.used, capacidad: p.cap };
  });
}
