// Histórico de la asignación: foto de cada servicio al cerrar el día + lectura para reportes y tablero.
import { supabase } from "../supabaseClient";
import { fetchAll } from "../maestrosApi";
import { DEPARTAMENTOS_CO } from "../colombiaData";

const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

// Región por departamento y nombre de cada región ("Atlántico"), desde la tabla de abreviaturas.
export async function loadRegionInfo() {
  let abbr = [];
  try { abbr = await fetchAll("geo_abbreviations", "*", "abbr"); } catch (e) { /* sin maestros: queda vacío */ }
  const byDept = {}, nameOf = {};
  abbr.filter((a) => a.level === "MUNICIPIO").forEach((a) => {
    const key = plain(a.name);
    byDept[key] = a.region_id;
    const bonito = DEPARTAMENTOS_CO.find((d) => plain(d) === key || plain(d).replace(/^LA /, "") === key) || key.charAt(0) + key.slice(1).toLowerCase();
    if (!nameOf[a.region_id]) nameOf[a.region_id] = bonito;
  });
  return {
    byDept, nameOf,
    regionOfService: (s) => (s.asig && s.asig.region != null ? s.asig.region : (byDept[plain(s.departamentoExterno)] ?? null)),
    label: (r) => (r === null || r === undefined ? "Sin región" : `Región ${r}${nameOf[r] ? ` (${nameOf[r]})` : ""}`),
  };
}

// Servicios de Carga → filas del histórico. Realizado queda "Realizado"; lo demás "No realizado".
export function buildSnapshot(services, technicians, regionOfService, session) {
  const techById = Object.fromEntries(technicians.map((t) => [t.id, t]));
  return services.map((s) => ({
    day: s.date, service_id: s.id, servicio: String(s.servicioExterno), codigo: s.productoExternoCodigo || null, producto: s.productoExternoNombre || null,
    quantity: s.quantity || 1, tiempo_min: s.tiempoMin ?? null,
    technician_id: s.technicianId || null, technician_name: (techById[s.technicianId] && techById[s.technicianId].name) || s.tecnico2Nombre || null, helper_name: s.tecnico3Nombre || null,
    region: regionOfService(s), departamento: s.departamentoExterno || null, ciudad: s.ciudadExterna || null, barrio: (s.asig && s.asig.barrio) || null,
    direccion: s.direccion || null, cliente: s.clienteNombre || null, zona: (s.asig && s.asig.zona) || null, ruta_orden: s.rutaOrden ?? null,
    prioridad: (s.asig && s.asig.prioridad) || null, tipo: s.serviceType || null,
    resultado: (s.estadoGestion || "Realizado") === "Realizado" ? "Realizado" : "No realizado",
    estado_extreme: s.estadoExtreme || null, causal_extreme: s.causalExtreme || null, causal_auditada: s.causalAuditada || null, diagnostico: s.diagnostico || null,
    finalized_by: session.id,
  }));
}

// Upsert por (día, servicio): cerrar el mismo día dos veces no duplica.
export async function saveSnapshot(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("assignment_history").upsert(rows.slice(i, i + 500), { onConflict: "day,service_id" });
    if (error) throw new Error(error.message);
  }
}

export async function fetchHistory({ from, to }) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    let q = supabase.from("assignment_history").select("*").order("day", { ascending: false }).order("id");
    if (from) q = q.gte("day", from);
    if (to) q = q.lte("day", to);
    const { data, error } = await q.range(start, start + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Agregación por técnico (y opcionalmente por día) sobre filas del histórico.
export function aggregateHistory(rows, { byDay = false } = {}) {
  const groups = new Map();
  rows.forEach((r) => {
    const key = `${byDay ? r.day : ""}|${r.technician_id || r.technician_name || "-"}`;
    const g = groups.get(key) || {
      day: byDay ? r.day : "", techId: r.technician_id, name: r.technician_name || "Sin técnico", region: r.region,
      servicios: new Set(), direcciones: new Set(), productos: 0, minutos: 0, realizados: 0, noRealizados: 0,
    };
    g.servicios.add(`${r.day}|${r.servicio}`);
    g.direcciones.add(`${r.day}|${plain(r.ciudad)}|${plain(r.direccion)}`);
    const q = Number(r.quantity) || 1;
    g.productos += q; g.minutos += r.tiempo_min || 0;
    if (r.resultado === "Realizado") g.realizados += q; else g.noRealizados += q;
    groups.set(key, g);
  });
  return [...groups.values()].map((g) => ({ ...g, servicios: g.servicios.size, movimientos: g.direcciones.size, direcciones: undefined }));
}
