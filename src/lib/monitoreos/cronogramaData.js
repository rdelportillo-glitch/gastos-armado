// Cronograma mensual de monitoreos: configuración (auditores y parámetros), cálculo de qué técnicos requieren monitoreo y cuántos, programación en el
// calendario y estado de cumplimiento. Funciones puras salvo las de acceso a datos (loadCronConfig, listSchedule...).
// El cálculo se basa en tres cosas: la antigüedad del técnico, su cargo (técnico junior = Aprendiz, técnico senior = Maestro) y su resultado en los
// monitoreos del mes anterior. Cada dimensión da un puntaje (editable en Maestros → Monitoreos → Cronograma) y la prioridad es el promedio ponderado.
import { supabase } from "../supabaseClient";
import { semaforoDe } from "./monData";

export const CRON_DEFAULT = {
  auditores: [], // { personId, activo, monitoreosMes }  (personas administrativas de Personal)
  params: {
    canalDefecto: "Digital",
    mesesNuevo: 6, mesesAntiguo: 24,
    pesos: { antiguedad: 30, cargo: 20, resultado: 50 },
    puntosAntiguedad: { nuevo: 3, intermedio: 2, antiguo: 1, sinFecha: 2 },
    puntosCargo: { aprendiz: 3, maestro: 2, otro: 1 },
    puntosResultado: { Rojo: 4, Naranja: 3, Amarillo: 2, Verde: 1, sinDato: 3, errorCritico: 4 },
    minPorTecnico: 1, maxPorTecnico: 4, incluirSupervisores: false,
    nivelAlta: 0.7, nivelMedia: 0.45,
    diasNoHabiles: [], // fechas extra (AAAA-MM-DD) que no se programan, además de fines de semana y festivos
  },
};
const copia = (x) => JSON.parse(JSON.stringify(x));
const KEY = "monitoreos_cronograma";

export async function loadCronConfig() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data && data.value) || {};
  const d = copia(CRON_DEFAULT);
  return { auditores: v.auditores || d.auditores, params: { ...d.params, ...(v.params || {}), pesos: { ...d.params.pesos, ...((v.params || {}).pesos || {}) },
    puntosAntiguedad: { ...d.params.puntosAntiguedad, ...((v.params || {}).puntosAntiguedad || {}) }, puntosCargo: { ...d.params.puntosCargo, ...((v.params || {}).puntosCargo || {}) },
    puntosResultado: { ...d.params.puntosResultado, ...((v.params || {}).puntosResultado || {}) } } };
}
export async function saveCronConfig(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------------- Calendario --------------------------------- */

const pad = (n) => String(n).padStart(2, "0");
const isoUTC = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const sumar = (d, n) => new Date(d.getTime() + n * 864e5);
const lunesDesde = (d) => { const w = d.getUTCDay(); return w === 1 ? d : sumar(d, (8 - w) % 7); }; // el lunes de ese día o el siguiente (ley Emiliani)

export const mesAnterior = (mes) => { const [y, m] = mes.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`; };
export const mesSiguiente = (mes) => { const [y, m] = mes.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; };
export const mesDe = (iso) => String(iso).slice(0, 7);
export const rangoMes = (mes) => { const [y, m] = mes.split("-").map(Number); return { desde: `${mes}-01`, hasta: isoUTC(utc(y, m + 1, 0)) }; };
export const nombreMes = (mes) => { const [y, m] = mes.split("-").map(Number); return `${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][m - 1]} ${y}`; };

// Festivos de Colombia de un año (fijos, trasladados al lunes y los que dependen de la Semana Santa). Son una guía: se pueden ajustar en los parámetros.
export function festivosColombia(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  const pascua = utc(y, mes, dia);
  const s = new Set();
  [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].forEach(([mm, dd]) => s.add(isoUTC(utc(y, mm, dd))));
  [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].forEach(([mm, dd]) => s.add(isoUTC(lunesDesde(utc(y, mm, dd)))));
  s.add(isoUTC(sumar(pascua, -3))); s.add(isoUTC(sumar(pascua, -2)));
  [39, 60, 68].forEach((n) => s.add(isoUTC(lunesDesde(sumar(pascua, n)))));
  return s;
}

// Días hábiles (lunes a viernes, sin festivos ni los días no hábiles que se agreguen) de un mes.
export function diasHabiles(mes, extra = []) {
  const [y, m] = mes.split("-").map(Number);
  const fest = festivosColombia(y), ex = new Set(extra);
  const out = [];
  for (let d = utc(y, m, 1); d.getUTCMonth() === m - 1; d = sumar(d, 1)) {
    const w = d.getUTCDay(), s = isoUTC(d);
    if (w >= 1 && w <= 5 && !fest.has(s) && !ex.has(s)) out.push(s);
  }
  return out;
}
export const diaSemana = (iso) => ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date(`${iso}T12:00:00Z`).getUTCDay()];
export const semanaDelMes = (iso, dias) => { const i = dias.indexOf(iso); if (i < 0) return 0; const prim = new Date(`${dias[0]}T12:00:00Z`).getUTCDay(); return Math.floor((i + (prim === 0 ? 6 : prim - 1)) / 5) + 1; };

/* --------------------------------- Cálculo --------------------------------- */

const norm = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
export const cargoDe = (type) => (/junior/i.test(type || "") ? "aprendiz" : /senior/i.test(type || "") ? "maestro" : "otro");
export const NOMBRE_CARGO = { aprendiz: "Aprendiz", maestro: "Maestro", otro: "Otro" };

// Meses entre la fecha de ingreso y el primer día del mes; null si no hay fecha.
export function mesesAntiguedad(entryDate, mes) {
  if (!entryDate) return null;
  const [y, m] = mes.split("-").map(Number);
  const e = new Date(`${String(entryDate).slice(0, 10)}T12:00:00Z`);
  if (isNaN(e)) return null;
  return Math.max(0, (y - e.getUTCFullYear()) * 12 + (m - 1 - e.getUTCMonth()));
}
export const categoriaAntiguedad = (meses, p) => (meses === null ? "sinFecha" : meses < p.mesesNuevo ? "nuevo" : meses >= p.mesesAntiguo ? "antiguo" : "intermedio");
export const NOMBRE_ANTIG = { nuevo: "Nuevo", intermedio: "Intermedio", antiguo: "Antiguo", sinFecha: "Sin fecha" };

// Resumen del mes anterior de cada técnico: promedio de calificación, cuántos monitoreos y si tuvo error crítico.
export function resumenPrevio(recordsPrev) {
  const m = new Map();
  recordsPrev.filter((r) => r.status === "Activo").forEach((r) => { const e = m.get(r.technician_id) || { suma: 0, n: 0, critico: false }; e.suma += Number(r.score || 0); e.n++; if (r.critical_error) e.critico = true; m.set(r.technician_id, e); });
  return m;
}

// Técnicos que pueden monitorearse y su prioridad (0 a 1) con el detalle de cómo se calculó.
export function analizarTecnicos({ mes, tecnicos, recordsPrev, monCfg, cron }) {
  const p = cron.params, prev = resumenPrevio(recordsPrev);
  const maxA = Math.max(...Object.values(p.puntosAntiguedad)), maxC = Math.max(...Object.values(p.puntosCargo));
  const maxR = Math.max(...Object.values(p.puntosResultado));
  const sumaPesos = (Number(p.pesos.antiguedad) || 0) + (Number(p.pesos.cargo) || 0) + (Number(p.pesos.resultado) || 0) || 1;
  return tecnicos
    .filter((t) => (t.category || "Técnico de campo") !== "Administrativo" && t.status === "Activo" && (p.incluirSupervisores || cargoDe(t.type) !== "otro"))
    .map((t) => {
      const meses = mesesAntiguedad(t.entryDate, mes), antig = categoriaAntiguedad(meses, p), cargo = cargoDe(t.type);
      const pr = prev.get(t.id), promPrev = pr ? pr.suma / pr.n : null;
      const semPrev = promPrev === null ? "Sin dato" : semaforoDe(monCfg, promPrev).nombre;
      let ptsRes = promPrev === null ? p.puntosResultado.sinDato : (p.puntosResultado[semPrev] ?? p.puntosResultado.sinDato);
      if (pr && pr.critico) ptsRes = Math.max(ptsRes, p.puntosResultado.errorCritico);
      const ptsAnt = p.puntosAntiguedad[antig], ptsCargo = p.puntosCargo[cargo];
      const score = ((p.pesos.antiguedad * ptsAnt) / maxA + (p.pesos.cargo * ptsCargo) / maxC + (p.pesos.resultado * ptsRes) / maxR) / sumaPesos;
      const nivel = score >= p.nivelAlta ? "Alta" : score >= p.nivelMedia ? "Media" : "Baja";
      return { tecnico: t, meses, antig, cargo, promPrev, semPrev, nMonPrev: pr ? pr.n : 0, critPrev: !!(pr && pr.critico), ptsAnt, ptsCargo, ptsRes, score: Math.round(score * 1000) / 1000, nivel, cantidad: 0 };
    })
    .sort((a, b) => b.score - a.score || a.tecnico.name.localeCompare(b.tecnico.name, "es"));
}

// Cuántos monitoreos le tocan a cada técnico: lo mínimo a todos (si alcanza la capacidad) y el resto en proporción a su prioridad, sin pasar del máximo.
export function repartirCantidades(filas, capacidad, p) {
  const N = filas.length, min = Math.max(0, Math.round(p.minPorTecnico)), max = Math.max(min, Math.round(p.maxPorTecnico));
  const out = filas.map((f) => ({ ...f, cantidad: 0 }));
  if (!N || capacidad <= 0) return out;
  if (capacidad < N * min) { let resto = capacidad; out.forEach((f) => { const q = Math.min(min, resto); f.cantidad = q; resto -= q; }); return out; }
  out.forEach((f) => { f.cantidad = min; });
  let resto = capacidad - N * min;
  for (let vuelta = 0; resto > 0 && vuelta < 50; vuelta++) {
    const cand = out.filter((f) => f.cantidad < max);
    if (!cand.length) break;
    const sw = cand.reduce((s, f) => s + f.score, 0) || cand.length;
    const cuotas = cand.map((f) => { const raw = (resto * (f.score || 1 / cand.length)) / sw; return { f, base: Math.min(Math.floor(raw), max - f.cantidad), frac: raw - Math.floor(raw) }; });
    let dado = 0; cuotas.forEach((c) => { c.f.cantidad += c.base; dado += c.base; });
    resto -= dado;
    if (dado === 0) { // reparte de a uno por mayor fracción / prioridad
      const orden = [...cuotas].sort((a, b) => b.frac - a.frac || b.f.score - a.f.score);
      for (const c of orden) { if (resto <= 0) break; if (c.f.cantidad < max) { c.f.cantidad++; resto--; } }
    }
  }
  return out;
}

const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; };

// Calendario: reparte los monitoreos de cada técnico a lo largo de los días hábiles, sin pasar de la cuota diaria de cada auditor.
export function programar({ filas, auditores, dias, canal }) {
  const D = dias.length;
  const act = auditores.filter((a) => a.activo !== false && Number(a.monitoreosMes) > 0);
  const total = filas.reduce((s, f) => s + f.cantidad, 0);
  if (!D || !act.length || !total) return [];
  const sumaA = act.reduce((s, a) => s + Number(a.monitoreosMes), 0);
  // Carga de cada auditor en proporción a lo que se comprometió a hacer, y su cuota por día repartida de forma pareja.
  let asignado = 0;
  const carga = act.map((a, i) => { const q = i === act.length - 1 ? total - asignado : Math.round((total * Number(a.monitoreosMes)) / sumaA); asignado += q; return Math.max(0, q); });
  const cap = act.map((a, i) => dias.map((_, d) => Math.floor(((d + 1) * carga[i]) / D) - Math.floor((d * carga[i]) / D)));
  const usados = new Set(); // técnico|día
  const ultimoAud = new Map();
  const entradas = [];
  filas.filter((f) => f.cantidad > 0).forEach((f) => {
    const q = f.cantidad, off = hash(f.tecnico.id) % Math.max(1, Math.floor(D / q));
    for (let j = 0; j < q; j++) {
      const objetivo = (Math.floor(((j + 0.5) * D) / q) + off) % D;
      let hecho = false;
      for (let dist = 0; dist < D && !hecho; dist++) {
        for (const d of dist === 0 ? [objetivo] : [(objetivo + dist) % D, (objetivo - dist + D) % D]) {
          if (usados.has(`${f.tecnico.id}|${d}`)) continue;
          const libres = act.map((a, i) => ({ a, i, c: cap[i][d] })).filter((x) => x.c > 0);
          if (!libres.length) continue;
          libres.sort((x, y) => (x.a.personId === ultimoAud.get(f.tecnico.id) ? 1 : 0) - (y.a.personId === ultimoAud.get(f.tecnico.id) ? 1 : 0) || y.c - x.c);
          const el = libres[0];
          cap[el.i][d]--; usados.add(`${f.tecnico.id}|${d}`); ultimoAud.set(f.tecnico.id, el.a.personId);
          entradas.push({ planned_date: dias[d], auditor_person_id: el.a.personId, technician_id: f.tecnico.id, channel: canal, score: f.score, level: f.nivel, origin: "Calculado" });
          hecho = true; break;
        }
      }
    }
  });
  return entradas.sort((a, b) => a.planned_date.localeCompare(b.planned_date));
}

// Estado de cada entrada: las entradas de un técnico se emparejan, por fecha, con sus monitoreos registrados en el mes.
export function estadoEntradas(entradas, recordsMes, hoy) {
  const porTec = new Map();
  recordsMes.filter((r) => r.status === "Activo").sort((a, b) => String(a.audit_date).localeCompare(String(b.audit_date))).forEach((r) => { const l = porTec.get(r.technician_id) || []; l.push(r); porTec.set(r.technician_id, l); });
  const usados = new Map();
  const out = new Map();
  [...entradas].filter((e) => e.status !== "Cancelado").sort((a, b) => a.planned_date.localeCompare(b.planned_date)).forEach((e) => {
    const k = usados.get(e.technician_id) || 0, lista = porTec.get(e.technician_id) || [];
    if (k < lista.length) { out.set(e.id, { estado: "Realizado", record: lista[k] }); usados.set(e.technician_id, k + 1); }
    else out.set(e.id, { estado: e.planned_date < hoy ? "Vencido" : "Pendiente", record: null });
  });
  return out;
}

/* ----------------------------------- Datos ----------------------------------- */

export async function listSchedule(mes) {
  const { data, error } = await supabase.from("monitoring_schedule").select("*").eq("month", mes).order("planned_date").order("created_at");
  if (error) throw new Error(error.message);
  return data || [];
}
export async function insertEntries(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await supabase.from("monitoring_schedule").insert(rows.slice(i, i + 200)).select();
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}
export async function updateEntry(id, patch) {
  const { data, error } = await supabase.from("monitoring_schedule").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
}
export async function cancelEntries(ids, nota) {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from("monitoring_schedule").update({ status: "Cancelado", note: nota }).in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
}
export const buscar = norm;
