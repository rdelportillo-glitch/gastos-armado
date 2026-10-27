// Monitoreos (digital y presencial): configuración (componentes, subcomponentes, pesos, semáforo, errores críticos), cálculo de resultados y
// acceso a los registros (monitoring_records). La configuración se guarda para todo el equipo en assignment_settings (clave "monitoreos_config");
// mientras no se guarde nada se usa la inicial (MON_DEFAULT, tomada del Excel de auditorías).
import { supabase } from "../supabaseClient";
import { MON_DEFAULT } from "./monDefaults";

export const CANALES = ["Digital", "Presencial"];
export const RESPUESTAS = ["Cumple", "No Cumple", "N/A"];
export const NOMBRE_CANAL = { Digital: "Monitoreo digital", Presencial: "Monitoreo presencial" };
// Nombre de quien monitorea, según el canal (en el Excel: Auditor / Inspector QA).
export const ROL_AUDITOR = { Digital: "Auditor", Presencial: "Inspector QA" };

const KEY = "monitoreos_config";
const copia = (x) => JSON.parse(JSON.stringify(x));

export async function loadMonConfig() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = data && data.value;
  return v && v.canales ? { ...copia(MON_DEFAULT), ...v } : copia(MON_DEFAULT);
}
export async function saveMonConfig(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
export const configInicial = () => copia(MON_DEFAULT);

// Componentes y subcomponentes vigentes (activos) de un canal, en orden.
export const componentesActivos = (cfg, canal) => (((cfg.canales || {})[canal] || {}).componentes || [])
  .filter((c) => c.activo !== false).map((c) => ({ ...c, subs: (c.subs || []).filter((s) => s.activo !== false) })).filter((c) => c.subs.length);
export const sumaPesos = (cfg, canal) => ((((cfg.canales || {})[canal] || {}).componentes) || []).filter((c) => c.activo !== false).reduce((a, c) => a + (Number(c.peso) || 0), 0);

// Semáforo: el primero (de mayor a menor mínimo) cuyo mínimo no supera la calificación.
export function semaforoDe(cfg, score) {
  const lista = [...(cfg.semaforo || [])].sort((a, b) => Number(b.min) - Number(a.min));
  return lista.find((s) => Number(score) >= Number(s.min)) || lista[lista.length - 1] || { nombre: "-", color: "#999" };
}
export const colorSemaforo = (cfg, nombre) => ((cfg.semaforo || []).find((s) => s.nombre === nombre) || {}).color || "#999";

// Cálculo de un monitoreo. Regla de arrastre: un componente es NEGATIVO si cualquiera de sus subcomponentes es "No Cumple" (N/A no cuenta);
// POSITIVO si todos están respondidos y ninguno es No Cumple; PENDIENTE si falta responder. El puntaje del componente es su peso si es POSITIVO y 0 si no.
// Con error crítico toda la calificación es 0.
export function calcular(cfg, canal, respuestas, errorCritico) {
  const resultados = componentesActivos(cfg, canal).map((c) => {
    const rs = c.subs.map((s) => respuestas[s.id] || "");
    const noCumple = rs.filter((r) => r === "No Cumple").length;
    const respondidas = rs.filter(Boolean).length;
    const resultado = noCumple > 0 ? "NEGATIVO" : respondidas < rs.length ? "PENDIENTE" : "POSITIVO";
    return { id: c.id, codigo: c.codigo, nombre: c.nombre, peso: Number(c.peso) || 0, resultado, noCumple, respondidas, total: rs.length, puntaje: !errorCritico && resultado === "POSITIVO" ? Number(c.peso) || 0 : 0 };
  });
  const calificacion = errorCritico ? 0 : Math.round(resultados.reduce((a, r) => a + r.puntaje, 0) * 100) / 100;
  const pendientes = resultados.reduce((a, r) => a + (r.total - r.respondidas), 0);
  return { resultados, calificacion, pendientes, semaforo: semaforoDe(cfg, calificacion).nombre };
}

/* ------------------------------- Registros ------------------------------- */

export async function listRecords({ canal, desde, hasta } = {}) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("monitoring_records").select("*").order("audit_date", { ascending: false }).order("created_at", { ascending: false }).order("id");
    if (canal) q = q.eq("channel", canal);
    if (desde) q = q.gte("audit_date", desde);
    if (hasta) q = q.lte("audit_date", hasta);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
export async function createRecord(row) {
  const { data, error } = await supabase.from("monitoring_records").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}
export async function updateRecord(id, patch) {
  const { data, error } = await supabase.from("monitoring_records").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export const fmtPct = (n) => `${(Math.round((Number(n) || 0) * 10) / 10).toLocaleString("es-CO")}%`;
