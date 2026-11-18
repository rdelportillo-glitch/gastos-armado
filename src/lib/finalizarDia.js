// Cierre del día de Carga (Finalizar día): lo comparten el botón manual y el cierre automático de las 11:59 pm.
// Guarda en el histórico lo que pasó con cada servicio del día, archiva lo realizado y lo cancelado (salen de Carga) y devuelve a Pendientes lo no realizado.
import { supabase } from "./supabaseClient";
import { CSV_CARGA_HEADERS, filasCsvCarga, ordenarComoAsignacion as ordenarCsvCarga } from "./asignacion/csvCarga";
import { cargarValoresTv, sinCierreManual } from "./asignacion/cierreColumnas";
import { buildSnapshot, saveSnapshot, loadRegionInfo } from "./asignacion/history";
import { loadCoordinadores, cfgEfectiva, coordinadorDe } from "./coordinadores";

// Registros activos de Carga (los que se pueden finalizar).
export const activosDeCarga = (services) => (services || []).filter((s) => s.servicioExterno && !s.finalizedAt && ["En gestión", "Realizado"].includes(s.estadoGestion || "Realizado"));

// Qué pasa con los registros de un día al finalizarlo.
export function clasificarDia(services, day) {
  const activos = activosDeCarga(services);
  const dayRows = activos.filter((s) => s.date === day);
  const cancelada = (s) => !!(s.asig && s.asig.cancelada);
  // Copia repetida que se canceló (Asignación → "Cancelar los duplicados"): no es un servicio real, no se guarda en el histórico (solo se archiva en Carga).
  const esDuplicado = (s) => cancelada(s) && /^duplicad/i.test(String((s.asig && s.asig.canceladaMotivo) || ""));
  return {
    activos, dayRows, esDuplicado,
    realizados: dayRows.filter((s) => (s.estadoGestion || "Realizado") === "Realizado" && !cancelada(s)),
    cancelados: dayRows.filter((s) => cancelada(s)), // cancelados (Jamar, preventiva o duplicados): se archivan, no vuelven a pendientes
    noRealizados: dayRows.filter((s) => s.estadoGestion === "En gestión" && !cancelada(s)),
  };
}

// Ejecuta el cierre de un día. Devuelve { ok, realizados, noRealizados, cancelados }; ok=false si no se pudo actualizar Carga (el histórico ya quedó guardado y se puede repetir sin duplicar).
// Lanza un Error si falla antes (por ejemplo, el histórico). automatico=true lo deja anotado en la auditoría.
export async function finalizarDiaCarga({ db, day, session, persist, addAudit, regionOfService, regionLabel, coordDe, automatico = false }) {
  const { dayRows, esDuplicado, realizados, cancelados, noRealizados } = clasificarDia(db.services, day);
  const paraHistorico = dayRows.filter((s) => !esDuplicado(s));
  const valorTvDe = await cargarValoresTv(paraHistorico);
  // Se guarda también la fila completa del CSV de Carga (con su orden), para que el CSV del histórico sea igual al de Carga.
  const techById = Object.fromEntries(db.technicians.map((t) => [t.id, t]));
  const ordenados = ordenarCsvCarga(paraHistorico, techById);
  const filas = filasCsvCarga({ registros: ordenados, technicians: db.technicians, causales: db.causales, valorTvDe, regionLabelDe: (s) => regionLabel(regionOfService(s)), coordDe });
  const extra = new Map(ordenados.map((s, i) => [s.id, { fila_csv: filas[i], csv_orden: i }]));
  // Lo que no se realizó y no se auditó vuelve a pendientes: en el histórico queda con la causal auditada PENDIENTE (en la fila y en su CSV), no vacía.
  const pendSinCausal = new Set(noRealizados.filter((s) => !s.causalAuditada).map((s) => s.id));
  const idxCausalAud = CSV_CARGA_HEADERS.indexOf("Causal auditada");
  await saveSnapshot(buildSnapshot(paraHistorico, db.technicians, regionOfService, session, valorTvDe).map((r) => {
    const x = { ...r, ...(extra.get(r.service_id) || {}) };
    if (!pendSinCausal.has(r.service_id)) return x;
    return { ...x, causal_auditada: "PENDIENTE", fila_csv: Array.isArray(x.fila_csv) && idxCausalAud >= 0 ? x.fila_csv.map((v, i) => (i === idxCausalAud ? "PENDIENTE" : v)) : x.fila_csv };
  }));
  const now = new Date().toISOString();
  const ids = new Set(dayRows.map((s) => s.id));
  const services = db.services.map((s) => {
    if (!ids.has(s.id)) return s;
    // Lo realizado y lo cancelado se archiva; lo demás no realizado vuelve a pendientes.
    if ((s.estadoGestion || "Realizado") === "Realizado" || (s.asig && s.asig.cancelada)) return { ...s, finalizedAt: now, finalizedBy: session.id };
    return { ...s, estadoGestion: "Pendiente", technicianId: null, tecnico2Nombre: "", tecnico3Nombre: "", rutaOrden: null, estadoExtreme: "", causalExtreme: "", diagnostico: "", causalAuditada: "", asig: sinCierreManual(s.asig) };
  });
  const ok = await persist(addAudit({ ...db, services }, { userId: session.id, action: automatico ? "Finalización automática del día (Carga, 11:59 pm)" : "Finalización del día (Carga)", record: day, oldValue: "-",
    newValue: `${realizados.length} realizados archivados en el histórico, ${noRealizados.length} no realizados vuelven a pendientes${cancelados.length ? `, ${cancelados.length} cancelados archivados` : ""}` }));
  return { ok, realizados: realizados.length, noRealizados: noRealizados.length, cancelados: cancelados.length };
}

/* ----------------------------- Cierre automático ----------------------------- */

export const HORA_CIERRE = { h: 23, m: 59 }; // 11:59 pm
export const DIAS_RECUPERABLES = 3; // al entrar, se recuperan los días cerrados sin finalizar de los últimos 3 días (cubre un fin de semana)
const KEY = "carga_cierre_auto";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const hoyLocal = (ahora = new Date()) => iso(ahora);
export const sumarDias = (isoDia, n) => { const d = new Date(`${isoDia}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };

// Días que ya les tocó cerrarse y siguen con registros activos: los anteriores a hoy (hasta DIAS_RECUPERABLES atrás) y el de hoy si ya son las 11:59 pm.
export function diasPorCerrar(services, ahora = new Date()) {
  const hoy = hoyLocal(ahora);
  const pasoLaHora = ahora.getHours() > HORA_CIERRE.h || (ahora.getHours() === HORA_CIERRE.h && ahora.getMinutes() >= HORA_CIERRE.m);
  const desde = sumarDias(hoy, -DIAS_RECUPERABLES);
  const dias = new Set(activosDeCarga(services).map((s) => s.date).filter((d) => d && d >= desde && (d < hoy || (d === hoy && pasoLaHora))));
  return [...dias].sort();
}

// Interruptor del cierre automático (lo cambia el administrador en Carga). Sin configurar = activo.
export async function cargarCierreAuto() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return { activo: !(data && data.value && data.value.activo === false) };
}
export async function guardarCierreAuto(activo, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: { activo: !!activo }, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// Reserva el cierre de un día para este navegador (así dos personas conectadas no lo ejecutan a la vez). false = otro ya lo hizo o lo está haciendo.
export async function reservarCierre(day) {
  const { data, error } = await supabase.rpc("claim_cierre_dia", { p_day: day });
  if (error) throw new Error(error.message);
  return data === true;
}
export async function terminarCierre(day, ok, detalle) {
  const { error } = await supabase.rpc("finish_cierre_dia", { p_day: day, p_ok: !!ok, p_detail: String(detalle || "").slice(0, 500) });
  if (error) throw new Error(error.message);
}

// Lo que necesita el cierre y vive en pantallas: región de cada servicio y coordinador de cada departamento.
export async function contextoCierre(technicians) {
  const info = await loadRegionInfo();
  let ef = null;
  try { const r = await loadCoordinadores(); ef = cfgEfectiva(r.cfg, technicians); } catch (e) { /* sin coordinadores: el CSV sale sin coordinador */ }
  // Mismo rótulo de región que usa la pantalla de Carga para el CSV ("-" cuando no hay región).
  const regionLabel = (r) => (r === null || r === undefined ? "-" : `Región ${r}${info.nameOf[r] ? ` (${info.nameOf[r]})` : ""}`);
  return { regionOfService: info.regionOfService, regionLabel, coordDe: (d) => (ef ? coordinadorDe(ef, d) || "" : "") };
}
