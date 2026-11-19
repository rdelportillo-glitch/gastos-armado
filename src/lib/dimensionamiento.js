// Dimensionamiento: la carga que envía Jamar (Tiempo Jamar) frente a los técnicos que Jamar nos pidió (solicitados) en el mes, por departamento.
//  · Tiempo Jamar = por registro, el mayor entre el tiempo de Jamar y el del maestro de Biver (ver tiempoJamar.js).
//  · Técnicos necesarios = Tiempo Jamar del día ÷ jornada (420 min). Capacidad solicitada = técnicos solicitados × 420 min.
//  · Los técnicos solicitados cambian cada mes: cada día se compara con los del mes al que pertenece. Un mes sin dato usa el último mes anterior que sí tenga (o el primero que haya).
//  · Alerta por departamento: "Más carga" (necesarios por encima de los solicitados más la tolerancia), "Menos carga" (por debajo) o "En línea".
// Origen de los datos: un día anterior sale del histórico de asignación; el día de hoy (y lo que siga en Carga sin finalizar) sale del módulo de Carga.
import { supabase } from "./supabaseClient";
import { activosDeCarga } from "./finalizarDia";
import { tiempoJamarDe } from "./tiempoJamar";

export const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

// Técnicos solicitados por departamento y mes (columnas "Técnicos oct / nov / dic" del dimensionamiento entregado). Editable por el administrador.
export const CONFIG_DEFAULT = {
  jornada: 420, tolerancia: 5, // % de tolerancia antes de alertar
  solicitados: {
    "2026-10": { ATLANTICO: 21, CUNDINAMARCA: 10, BOLIVAR: 12, ANTIOQUIA: 8, MAGDALENA: 4, SANTANDER: 4, CORDOBA: 2, SUCRE: 2 },
    "2026-11": { ATLANTICO: 27, CUNDINAMARCA: 13, BOLIVAR: 13, ANTIOQUIA: 11, MAGDALENA: 6, SANTANDER: 5, CORDOBA: 3, SUCRE: 3 },
    "2026-12": { ATLANTICO: 27, CUNDINAMARCA: 11, BOLIVAR: 13, ANTIOQUIA: 9, MAGDALENA: 5, SANTANDER: 5, CORDOBA: 3, SUCRE: 2 },
  },
};
const copiaDefault = () => JSON.parse(JSON.stringify(CONFIG_DEFAULT.solicitados));

const KEY = "dimensionamiento_cfg";
export async function cargarCfg() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data && data.value) || {}; // una configuración vieja con "plantilla" ya no se usa: rigen los técnicos solicitados
  return { jornada: v.jornada || CONFIG_DEFAULT.jornada, tolerancia: v.tolerancia ?? CONFIG_DEFAULT.tolerancia, solicitados: v.solicitados && Object.keys(v.solicitados).length ? v.solicitados : copiaDefault() };
}
export async function guardarCfg(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: { jornada: cfg.jornada, tolerancia: cfg.tolerancia, solicitados: cfg.solicitados }, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// Mes ("AAAA-MM") cuyos técnicos solicitados rigen para el mes pedido: el mismo, o el último anterior con dato, o el primero que haya.
export function mesVigente(cfg, mes) {
  const meses = Object.keys(cfg.solicitados || {}).sort();
  if (!meses.length) return "";
  return [...meses].reverse().find((m) => m <= mes) || meses[0];
}
// Técnicos solicitados de un departamento (clave plana) en un mes.
export function solicitadosDe(cfg, mes, deptoKey) {
  const m = mesVigente(cfg, mes);
  const tabla = (cfg.solicitados || {})[m] || {};
  const k = Object.keys(tabla).find((x) => plano(x) === deptoKey);
  return k ? Number(tabla[k]) || 0 : 0;
}
const deptoDe = (s) => String((s.asig && s.asig.depto) || s.departamentoExterno || "").trim();

// Registros de la carga enviada entre from y to. history: filas de assignment_history (no anuladas); services: db.services.
// Cada registro: { id, day, servicio, depto, ciudad, producto, jamar, usado, origen, cancelado }.
export function registrosDeCarga({ from, to, history, services }) {
  const porId = new Map((services || []).map((s) => [s.id, s]));
  const out = [], enHistorico = new Set();
  (history || []).forEach((r) => {
    if ((from && r.day < from) || (to && r.day > to)) return;
    enHistorico.add(`${r.day}|${r.service_id}`); // día + registro: lo no realizado vuelve a Carga otro día con el mismo id y sí cuenta ese día
    const s = porId.get(r.service_id);
    const base = { tiempoMin: r.tiempo_min, quantity: r.quantity, asig: s && s.asig };
    out.push({ id: r.service_id || r.id, day: r.day, servicio: String(r.servicio), depto: String(r.departamento || (s && deptoDe(s)) || ""), ciudad: String(r.ciudad || ""), producto: r.producto || "",
      jamar: tiempoJamarDe(base), usado: Number(r.tiempo_min) || 0, origen: "Histórico", cancelado: !!(s && s.asig && s.asig.cancelada), tecnico: r.technician_name || "" });
  });
  // Lo que sigue en Carga sin finalizar (el día de hoy y los días que aún no se han cerrado): no se cuenta dos veces si ya está en el histórico.
  activosDeCarga(services).forEach((s) => {
    if (enHistorico.has(`${s.date}|${s.id}`) || !s.date || (from && s.date < from) || (to && s.date > to)) return;
    out.push({ id: s.id, day: s.date, servicio: String(s.servicioExterno), depto: deptoDe(s), ciudad: String(s.ciudadExterna || (s.asig && s.asig.ciudad) || ""), producto: s.productoExternoNombre || "",
      jamar: tiempoJamarDe(s), usado: Number(s.tiempoMin) || 0, origen: "Carga", cancelado: !!(s.asig && s.asig.cancelada), tecnico: "" });
  });
  return out;
}

export function estadoDe(necesarios, solicitados, tolerancia) {
  if (!(solicitados > 0)) return necesarios > 0 ? "Sin solicitados" : "En línea";
  const t = (Number(tolerancia) || 0) / 100;
  if (necesarios > solicitados * (1 + t) + 1e-9) return "Más carga";
  if (necesarios < solicitados * (1 - t) - 1e-9) return "Menos carga";
  return "En línea";
}

const r1 = (n) => Math.round(n * 10) / 10;

// Resumen por departamento (con sus días y ciudades). mesRef: mes ("AAAA-MM") con el que se listan los departamentos que tienen técnicos solicitados y no tienen carga (carga 0).
// Cada día se compara con los técnicos solicitados de SU mes; el resumen muestra el promedio de los solicitados de los días con carga.
export function resumirPorDepto({ registros, cfg, incluirCancelados = false, nombreDepto = (d) => d, mesRef = "" }) {
  const jornada = Number(cfg.jornada) || 420;
  const lista = registros.filter((r) => incluirCancelados || !r.cancelado);
  const m = new Map();
  const grupo = (d) => { const k = plano(nombreDepto(d)) || "SIN DEPARTAMENTO"; if (!m.has(k)) m.set(k, { key: k, nombre: nombreDepto(d) || "Sin departamento", registros: [] }); return m.get(k); };
  lista.forEach((r) => grupo(r.depto).registros.push(r));
  const tablaRef = (cfg.solicitados || {})[mesVigente(cfg, mesRef)] || {};
  Object.keys(tablaRef).forEach((nombre) => { const k = plano(nombre); if (!m.has(k)) m.set(k, { key: k, nombre: nombreDepto(nombre) || nombre.charAt(0) + nombre.slice(1).toLowerCase(), registros: [] }); });
  return [...m.values()].map((g) => {
    const porDia = new Map();
    g.registros.forEach((r) => porDia.set(r.day, (porDia.get(r.day) || 0) + r.jamar));
    const dd = [...porDia.entries()].sort().map(([day, min]) => { const sol = solicitadosDe(cfg, day.slice(0, 7), g.key); return { day, min, necesarios: r1(min / jornada), solicitados: sol, estado: estadoDe(min / jornada, sol, cfg.tolerancia) }; });
    const solicitados = dd.length ? dd.reduce((s, d) => s + d.solicitados, 0) / dd.length : solicitadosDe(cfg, mesRef, g.key);
    const total = g.registros.reduce((s, r) => s + r.jamar, 0);
    const usado = g.registros.reduce((s, r) => s + r.usado, 0);
    const promMin = dd.length ? total / dd.length : 0;
    const pico = dd.reduce((a, d) => (d.min > a.min ? d : a), { min: 0, day: "" });
    const ciudades = new Map();
    g.registros.forEach((r) => { const k = r.ciudad || "Sin ciudad"; const c = ciudades.get(k) || { nombre: k, min: 0, dias: new Set(), registros: 0 }; c.min += r.jamar; c.dias.add(r.day); c.registros++; ciudades.set(k, c); });
    return {
      ...g, solicitados: r1(solicitados), capacidad: Math.round(solicitados * jornada), total, usado, dias: dd, registrosN: g.registros.length,
      promMin: r1(promMin), necesarios: r1(promMin / jornada), pico: r1(pico.min / jornada), picoDia: pico.day, picoNecesarios: Math.ceil(pico.min / jornada - 1e-9),
      diferencia: r1(solicitados - promMin / jornada), uso: solicitados > 0 ? (promMin / (solicitados * jornada)) * 100 : null,
      estado: estadoDe(promMin / jornada, solicitados, cfg.tolerancia),
      diasMas: dd.filter((d) => d.estado === "Más carga").length, diasMenos: dd.filter((d) => d.estado === "Menos carga").length,
      ciudades: [...ciudades.values()].map((c) => ({ nombre: c.nombre, min: c.min, dias: c.dias.size, promMin: r1(c.min / Math.max(1, c.dias.size)), necesarios: r1(c.min / Math.max(1, c.dias.size) / jornada), registros: c.registros })).sort((a, b) => b.min - a.min),
    };
  }).sort((a, b) => b.solicitados - a.solicitados || b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
}

// Totales de todos los departamentos (días con carga del rango; técnicos necesarios = promedio diario de la carga de todos ÷ jornada).
export function totales(deptos, cfg) {
  const jornada = Number(cfg.jornada) || 420;
  const porDia = new Map();
  deptos.forEach((d) => d.dias.forEach((x) => porDia.set(x.day, (porDia.get(x.day) || 0) + x.min)));
  const total = [...porDia.values()].reduce((s, v) => s + v, 0), n = porDia.size;
  const solicitados = r1(deptos.reduce((s, d) => s + d.solicitados, 0));
  const prom = n ? total / n : 0;
  return { total, dias: n, solicitados, necesarios: r1(prom / jornada), promMin: r1(prom), estado: estadoDe(prom / jornada, solicitados, cfg.tolerancia), uso: solicitados > 0 ? (prom / (solicitados * jornada)) * 100 : null,
    mas: deptos.filter((d) => d.estado === "Más carga").length, menos: deptos.filter((d) => d.estado === "Menos carga").length };
}