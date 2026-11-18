// Reporte de productividad de los técnicos: minutos productivos por técnico y día frente a la meta (430 min = 100 %).
// Se calcula con el histórico de asignación (una fila por producto) y con la regla de productividad de la causal de cada producto:
//   · completo    → el tiempo completo del producto (armado OK).
//   · noArmado    → 90 min por producto (120 si el producto es complejo).
//   · diagnostico → 30 min (una sola vez por servicio y técnico: es una visita).
//   · visita      → 15 min (cliente no estaba / no quiso; una sola vez por servicio y técnico).
//   · llamada     → 0 min (cliente canceló o solo llamada).
//   · ninguna     → no suma (sin regla, pendiente, etc.).
// Pueblo (municipio o barrio de Maestros → Viáticos por municipio): +15 min por producto (una vez por servicio en las visitas).
// En pareja (técnico + apoyo): el tiempo base se divide entre los dos; el +15 del pueblo lo recibe cada uno completo.
// Los minutos de cada regla y la meta se configuran (assignment_settings); la regla de cada causal se elige en Maestros → Causales (si no se eligió, se usa la predeterminada).
import { supabase } from "./supabaseClient";

export const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

export const CONFIG_DEFAULT = { meta: 430, jornada: 440, noArmado: 90, noArmadoComplejo: 120, diagnostico: 30, visita: 15, pueblo: 15 };

export const etiquetasRegla = (c = CONFIG_DEFAULT) => ({
  completo: "Armado OK (tiempo completo)",
  noArmado: `No armado (${c.noArmado} min; ${c.noArmadoComplejo} si es complejo)`,
  diagnostico: `Diagnóstico (${c.diagnostico} min)`,
  visita: `Cliente no estaba / no quiso (${c.visita} min)`,
  llamada: "Solo llamada (0 min)",
  ninguna: "Sin regla (no suma)",
});
export const ORDEN_REGLAS = ["completo", "noArmado", "diagnostico", "visita", "llamada", "ninguna"];

// Regla predeterminada de cada causal (hasta que se elija otra en Maestros → Causales).
const POR_DEFECTO = {
  completo: ["CAL-TRA ARMADO DE MULTIMUEBLE", "ARMADO CON NOVEDAD", "DESARMADO DE MULTIMUEBLE", "EMPAQUE", "AJUSTE DE PRODUCTO", "INSTALACION PIEZA", "INSTALACION DE PIEZA", "REPARACION MENOR"],
  noArmado: ["NO ARMADO POR NOVEDAD", "PRODUCTO NO ARMABLE"],
  diagnostico: ["CONDICION NO OPERABLE"],
  visita: ["NO QUISO ARMADO", "INMUEBLE CERRADO", "CLIENTE NO RESIDE", "DIRECCION ERRADA", "ESPERA PROLONGADA", "VISITA NO EFECTIVA - FUERZA MAYOR", "CLIENTE ARMO EL PRODUCTO"],
  llamada: ["CLIENTE CANCELA", "CLIENTE ARMA - LLAMADA", "PREVENTIVA - CLIENTE CANCELA", "PREVENTIVA - CLIENTE ARMA", "PREVENTIVA - REPROGRAMADO"],
};
const MAPA_DEFECTO = new Map(Object.entries(POR_DEFECTO).flatMap(([regla, nombres]) => nombres.map((n) => [plano(n), regla])));

export const reglaPredeterminada = (causal) => MAPA_DEFECTO.get(plano(causal)) || "ninguna";
// reglas: { NOMBRE DE LA CAUSAL (plano): regla } con lo elegido en Maestros → Causales.
export function reglaDeCausal(causal, reglas = {}) {
  const k = plano(causal);
  if (!k) return "ninguna";
  const r = reglas[k];
  if (r && ORDEN_REGLAS.includes(r)) return r;
  return reglaPredeterminada(k);
}

/* ------------------------------ Configuración guardada ------------------------------ */
const KEY = "productividad_cfg";
export async function cargarCfg() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data && data.value) || {};
  return { config: { ...CONFIG_DEFAULT, ...(v.config || {}) }, reglas: v.reglas || {} };
}
export async function guardarCfg(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: { config: cfg.config, reglas: cfg.reglas }, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* ------------------------------ Pueblo y complejidad ------------------------------ */
// municipios: filas activas de viatico_municipios (municipio o barrio). Un servicio es de pueblo si su municipio (o su barrio, igual que en los viáticos) está en la lista.
export function crearEsPueblo(municipios) {
  const mun = new Set(), barrios = new Map();
  (municipios || []).forEach((m) => {
    if (m.active === false) return;
    const dep = plano(m.department), nom = plano(m.municipality);
    if (plano(m.kind) === "BARRIO") { const k = `${dep}|${nom}`; barrios.set(k, [...(barrios.get(k) || []), plano(m.parent_city)]); } else mun.add(`${dep}|${nom}`);
  });
  return (r) => {
    const dep = plano(r.departamento), ciu = plano(r.ciudad);
    if (mun.has(`${dep}|${ciu}`)) return true;
    if (!r.barrio) return false;
    const mismaCiudad = (p) => !p || ciu === p || ciu.startsWith(`${p} `) || p.startsWith(`${ciu} `);
    return (barrios.get(`${dep}|${plano(r.barrio)}`) || []).some(mismaCiudad);
  };
}

// Complejo = complejidad Alta o empotrable. Se toma del registro de Carga (asig) y, si no está, de los maestros de productos y complejidad por línea/sublínea.
export function crearEsComplejo({ productos = [], complejidad = [], services = [] }) {
  const prod = new Map(productos.map((p) => [plano(p.code), p]));
  const comp = new Map(complejidad.map((c) => [`${plano(c.line)}|${plano(c.subline)}`, c]));
  const svc = new Map(services.map((s) => [s.id, s]));
  return (r) => {
    const a = (svc.get(r.service_id) || {}).asig;
    if (a && (a.complejidad || a.empotrable !== undefined)) return a.complejidad === "Alta" || a.empotrable === true || a.empotrable === "Si";
    const p = prod.get(plano(r.codigo));
    const c = p ? comp.get(`${plano(p.line)}|${plano(p.subline)}`) : null;
    return !!c && (c.complexity === "Alta" || !!c.embeddable);
  };
}

/* ------------------------------ Cálculo ------------------------------ */
const redondear = (n) => Math.round(n * 10) / 10;

// rows: filas del histórico. Devuelve { items (uno por técnico y producto), sinTecnico }.
export function calcularItems({ rows, technicians, cfg, esPueblo = () => false, esComplejo = () => false }) {
  const c = { ...CONFIG_DEFAULT, ...(cfg.config || {}) };
  const reglas = cfg.reglas || {};
  const porId = new Map((technicians || []).map((t) => [t.id, t]));
  const porNombre = new Map((technicians || []).map((t) => [plano(t.name), t]));
  const orden = [...rows].sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.servicio).localeCompare(String(b.servicio)) || String(a.id ?? a.service_id).localeCompare(String(b.id ?? b.service_id)));
  const visitaContada = new Set();
  const items = [];
  let sinTecnico = 0;
  orden.forEach((r) => {
    const t = (r.technician_id && porId.get(r.technician_id)) || porNombre.get(plano(r.technician_name)) || null;
    if (!t) { sinTecnico++; return; }
    const ap = r.helper_name ? (porNombre.get(plano(r.helper_name)) || null) : null;
    const apoyo = r.helper_name ? { key: ap ? ap.id : `n:${plano(r.helper_name)}`, nombre: ap ? ap.name : r.helper_name } : null;
    const titular = { key: t.id, nombre: t.name };
    const personas = apoyo && apoyo.key !== titular.key ? 2 : 1;
    const causal = String(r.causal_auditada || r.causal_extreme || "").trim();
    const regla = reglaDeCausal(causal, reglas);
    const complejo = regla === "noArmado" ? !!esComplejo(r) : false;
    const pueblo = !!esPueblo(r);
    let base = 0, nota = "", extraPueblo = 0;
    if (regla === "completo") {
      base = Number(r.tiempo_min) || 0;
      if (!r.tiempo_min) nota = "El producto no tiene tiempo";
      if (pueblo) extraPueblo = c.pueblo;
    } else if (regla === "noArmado") {
      base = complejo ? c.noArmadoComplejo : c.noArmado;
      if (pueblo) extraPueblo = c.pueblo;
    } else if (regla === "diagnostico" || regla === "visita") {
      const clave = `${r.day}|${r.servicio}|${titular.key}|${regla}`;
      if (visitaContada.has(clave)) nota = "Ya contado en este servicio";
      else { visitaContada.add(clave); base = regla === "diagnostico" ? c.diagnostico : c.visita; if (pueblo) extraPueblo = c.pueblo; }
    } else if (regla === "ninguna") nota = causal ? "Causal sin regla de productividad" : "Sin causal";
    const comunes = { day: r.day, servicio: String(r.servicio), producto: r.producto || "", causal, regla, complejo, pueblo, departamento: r.departamento || "", ciudad: r.ciudad || "", pareja: personas === 2, base: redondear(base / personas), extraPueblo, nota };
    items.push({ ...comunes, key: titular.key, nombre: titular.nombre, rol: "Técnico", conQuien: personas === 2 ? apoyo.nombre : "", minutos: redondear(base / personas + extraPueblo) });
    if (personas === 2) items.push({ ...comunes, key: apoyo.key, nombre: apoyo.nombre, rol: "Apoyo", conQuien: titular.nombre, minutos: redondear(base / personas + extraPueblo) });
  });
  return { items, sinTecnico };
}

// Minutos por técnico y día.
export function porTecnicoDia(items, meta) {
  const m = new Map();
  items.forEach((x) => {
    const k = `${x.key}|${x.day}`;
    const g = m.get(k) || { key: x.key, nombre: x.nombre, day: x.day, minutos: 0, servicios: new Set(), productos: 0, pueblos: 0, items: [] };
    g.minutos += x.minutos; g.servicios.add(x.servicio); g.productos += 1; if (x.pueblo) g.pueblos += 1; g.items.push(x);
    m.set(k, g);
  });
  return [...m.values()].map((g) => ({ ...g, minutos: redondear(g.minutos), servicios: g.servicios.size, pct: meta > 0 ? (g.minutos / meta) * 100 : 0 }));
}

const moda = (lista) => { const m = new Map(); lista.filter(Boolean).forEach((v) => m.set(v, (m.get(v) || 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };

// Resumen por técnico: días con servicios, minutos, promedio diario, % de productividad (promedio ÷ meta) y días que llegaron a la meta.
export function resumenPorTecnico(dias, meta) {
  const m = new Map();
  dias.forEach((d) => { if (!m.has(d.key)) m.set(d.key, []); m.get(d.key).push(d); });
  return [...m.entries()].map(([key, ds]) => {
    const minutos = redondear(ds.reduce((s, d) => s + d.minutos, 0));
    const promedio = ds.length ? minutos / ds.length : 0;
    return {
      key, nombre: ds[0].nombre, dias: ds.length, minutos, promedio: redondear(promedio), pct: meta > 0 ? (promedio / meta) * 100 : 0,
      diasMeta: ds.filter((d) => d.minutos >= meta).length, servicios: ds.reduce((s, d) => s + d.servicios, 0), productos: ds.reduce((s, d) => s + d.productos, 0),
      depto: moda(ds.flatMap((d) => d.items.map((i) => i.departamento))), ds,
    };
  });
}
