// Dimensionamiento: la carga que envía Jamar (Tiempo Jamar) frente a los técnicos legalizados (plantilla) por departamento.
//  · Tiempo Jamar = por registro, el mayor entre el tiempo de Jamar y el del maestro de Biver (ver tiempoJamar.js).
//  · Técnicos necesarios = Tiempo Jamar del día ÷ jornada (420 min). Capacidad legalizada = plantilla × 420 min.
//  · Alerta por departamento: "Más carga" (necesarios por encima de la plantilla más la tolerancia), "Menos carga" (por debajo) o "En línea".
// Origen de los datos: un día anterior sale del histórico de asignación; el día de hoy (y lo que siga en Carga sin finalizar) sale del módulo de Carga.
import { supabase } from "./supabaseClient";
import { activosDeCarga } from "./finalizarDia";
import { tiempoJamarDe } from "./tiempoJamar";

export const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

// Plantilla legalizada por departamento (dimensionamiento entregado). Editable por el administrador.
export const CONFIG_DEFAULT = {
  jornada: 420, tolerancia: 5, // % de tolerancia antes de alertar
  plantilla: { ATLANTICO: 27, CUNDINAMARCA: 14, BOLIVAR: 12, ANTIOQUIA: 11, MAGDALENA: 4, SANTANDER: 5, CORDOBA: 3, SUCRE: 2 },
};

const KEY = "dimensionamiento_cfg";
export async function cargarCfg() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data && data.value) || {};
  return { ...CONFIG_DEFAULT, ...v, plantilla: v.plantilla && Object.keys(v.plantilla).length ? v.plantilla : { ...CONFIG_DEFAULT.plantilla } };
}
export async function guardarCfg(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
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

export function estadoDe(necesarios, plantilla, tolerancia) {
  if (!(plantilla > 0)) return necesarios > 0 ? "Sin plantilla" : "En línea";
  const t = (Number(tolerancia) || 0) / 100;
  if (necesarios > plantilla * (1 + t) + 1e-9) return "Más carga";
  if (necesarios < plantilla * (1 - t) - 1e-9) return "Menos carga";
  return "En línea";
}

const r1 = (n) => Math.round(n * 10) / 10;

// Resumen por departamento (con sus días y ciudades). Los departamentos con plantilla y sin carga también salen (carga 0).
export function resumirPorDepto({ registros, cfg, incluirCancelados = false, nombreDepto = (d) => d }) {
  const jornada = Number(cfg.jornada) || 420;
  const lista = registros.filter((r) => incluirCancelados || !r.cancelado);
  const plantillaDe = new Map(Object.entries(cfg.plantilla || {}).map(([k, v]) => [plano(k), Number(v) || 0]));
  const dias = [...new Set(lista.map((r) => r.day))].sort();
  const m = new Map();
  const grupo = (d) => { const k = plano(nombreDepto(d)) || "SIN DEPARTAMENTO"; if (!m.has(k)) m.set(k, { key: k, nombre: nombreDepto(d) || "Sin departamento", registros: [] }); return m.get(k); };
  lista.forEach((r) => grupo(r.depto).registros.push(r));
  plantillaDe.forEach((_, k) => { if (!m.has(k)) m.set(k, { key: k, nombre: nombreDepto(k) || k.charAt(0) + k.slice(1).toLowerCase(), registros: [] }); });
  return [...m.values()].map((g) => {
    const plantilla = plantillaDe.get(g.key) || 0;
    const porDia = new Map();
    g.registros.forEach((r) => porDia.set(r.day, (porDia.get(r.day) || 0) + r.jamar));
    const dd = [...porDia.entries()].sort().map(([day, min]) => ({ day, min, necesarios: r1(min / jornada), estado: estadoDe(min / jornada, plantilla, cfg.tolerancia) }));
    const total = g.registros.reduce((s, r) => s + r.jamar, 0);
    const usado = g.registros.reduce((s, r) => s + r.usado, 0);
    const promMin = dd.length ? total / dd.length : 0;
    const pico = dd.reduce((a, d) => (d.min > a.min ? d : a), { min: 0, day: "" });
    const ciudades = new Map();
    g.registros.forEach((r) => { const k = r.ciudad || "Sin ciudad"; const c = ciudades.get(k) || { nombre: k, min: 0, dias: new Set(), registros: 0 }; c.min += r.jamar; c.dias.add(r.day); c.registros++; ciudades.set(k, c); });
    return {
      ...g, plantilla, capacidad: plantilla * jornada, total, usado, dias: dd, registrosN: g.registros.length,
      promMin: r1(promMin), necesarios: r1(promMin / jornada), pico: r1(pico.min / jornada), picoDia: pico.day, picoNecesarios: Math.ceil(pico.min / jornada - 1e-9),
      diferencia: r1(plantilla - promMin / jornada), uso: plantilla > 0 ? (promMin / (plantilla * jornada)) * 100 : null,
      estado: estadoDe(promMin / jornada, plantilla, cfg.tolerancia),
      diasMas: dd.filter((d) => d.estado === "Más carga").length, diasMenos: dd.filter((d) => d.estado === "Menos carga").length,
      ciudades: [...ciudades.values()].map((c) => ({ nombre: c.nombre, min: c.min, dias: c.dias.size, promMin: r1(c.min / Math.max(1, c.dias.size)), necesarios: r1(c.min / Math.max(1, c.dias.size) / jornada), registros: c.registros })).sort((a, b) => b.min - a.min),
    };
  }).sort((a, b) => b.plantilla - a.plantilla || b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
}

// Totales de todos los departamentos (días con carga del rango; técnicos necesarios = promedio diario de la carga de todos ÷ jornada).
export function totales(deptos, cfg) {
  const jornada = Number(cfg.jornada) || 420;
  const porDia = new Map();
  deptos.forEach((d) => d.dias.forEach((x) => porDia.set(x.day, (porDia.get(x.day) || 0) + x.min)));
  const total = [...porDia.values()].reduce((s, v) => s + v, 0), n = porDia.size;
  const plantilla = deptos.reduce((s, d) => s + d.plantilla, 0);
  const prom = n ? total / n : 0;
  return { total, dias: n, plantilla, necesarios: r1(prom / jornada), promMin: r1(prom), estado: estadoDe(prom / jornada, plantilla, cfg.tolerancia), uso: plantilla > 0 ? (prom / (plantilla * jornada)) * 100 : null,
    mas: deptos.filter((d) => d.estado === "Más carga").length, menos: deptos.filter((d) => d.estado === "Menos carga").length };
}
