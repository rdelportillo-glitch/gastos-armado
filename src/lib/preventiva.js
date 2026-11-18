// Gestión preventiva: llamadas a los clientes para confirmar la cita del día siguiente.
// Datos: preventive_calls (cada llamada/gestión) y preventive_alert_reads (avisos leídos). Los servicios salen de Carga (db.services).
// Cancela / Cliente arma / Reprogramado retiran el servicio de la asignación (queda cancelado en Carga con una causal PREVENTIVA) y generan un aviso para quienes asignan.
import { supabase } from "./supabaseClient";
import { esProductoTv, loadTvConfig, loadOffersByServicio } from "./tv/tvData";
import { numerosDeTelefono } from "./whatsapp";

export const RESULTADOS = ["Confirmado", "No contesta", "Cancela", "Cliente arma", "Reprogramado"];
// Resultados que sacan el servicio de la asignación → causal que queda en Carga (Maestros → Causales, gestión Cancelado).
export const CAUSAL_PREVENTIVA = { Cancela: "PREVENTIVA - CLIENTE CANCELA", "Cliente arma": "PREVENTIVA - CLIENTE ARMA", Reprogramado: "PREVENTIVA - REPROGRAMADO" };
export const RETIRA = (resultado) => !!CAUSAL_PREVENTIVA[resultado];
export const esCausalPreventiva = (c) => Object.values(CAUSAL_PREVENTIVA).includes(String(c || "").trim().toUpperCase());
export const TEXTO_RESULTADO = { Cancela: "Cliente cancela", "Cliente arma": "Cliente arma", Reprogramado: "Reprogramado", Confirmado: "Confirmado", "No contesta": "No contesta", Revertido: "Devuelto a la asignación" };
export const COLOR_RESULTADO = { Confirmado: "green", "No contesta": "amber", Cancela: "red", "Cliente arma": "red", Reprogramado: "red", Revertido: "blue" };

export const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
// Fecha por defecto: el día siguiente (si es domingo, el lunes).
export const fechaPorDefecto = (hoy) => { const m = sumarDias(hoy, 1); return new Date(`${m}T12:00:00`).getDay() === 0 ? sumarDias(m, 1) : m; };

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

// Servicios de la fecha para llamar: una entrada por servicio (cliente), con todos sus productos. Excluye lo que se gestiona en Instalación de TV
// (servicios con panel/centro de TV o con oferta de TV). Lo ya retirado por una gestión preventiva se sigue mostrando (para verlo y poder deshacerlo).
export function construirLista(services, fecha, { tvCfg, servicioConOferta = new Set() } = {}) {
  const m = new Map();
  (services || []).forEach((s) => {
    if (!s.servicioExterno || s.date !== fecha || s.finalizedAt || !s.asig) return;
    const a = s.asig, prev = a.preventiva;
    if ((a.cancelada || a.anulada) && !prev) return;
    if (!prev && s.estadoGestion !== "En gestión") return;
    const g = m.get(s.servicioExterno) || { servicio: s.servicioExterno, cliente: s.clienteNombre || a.cliente || "", telefonoTxt: a.telefono || "", direccion: s.direccion || a.direccion || "", barrio: a.barrio || "",
      ciudad: s.ciudadExterna || a.ciudad || "", departamento: s.departamentoExterno || a.depto || "", senas: a.senas || "", empresa: a.empresa || "", tecnicoId: s.technicianId || null, tecnicoNombre: s.tecnico2Nombre || "",
      rutaOrden: s.rutaOrden ?? null, productos: [], registros: [], hayTv: false, retirado: null };
    g.registros.push(s);
    g.productos.push(`${s.productoExternoNombre || a.producto || ""}${Math.round(s.quantity || 1) > 1 ? ` (x${Math.round(s.quantity)})` : ""}`);
    if (tvCfg && esProductoTv(a, tvCfg)) g.hayTv = true;
    if (s.technicianId && !g.tecnicoId) g.tecnicoId = s.technicianId;
    if (s.tecnico2Nombre && !g.tecnicoNombre) g.tecnicoNombre = s.tecnico2Nombre;
    if (prev && a.cancelada) g.retirado = prev;
    m.set(s.servicioExterno, g);
  });
  const todos = [...m.values()].map((g) => ({ ...g, telefonos: numerosDeTelefono(g.telefonoTxt), productos: [...new Set(g.productos.filter(Boolean))], hayTv: g.hayTv || servicioConOferta.has(String(g.servicio)) }));
  return { lista: todos.filter((g) => !g.hayTv), excluidosTv: todos.filter((g) => g.hayTv).length };
}

// Servicios de la lista que tienen oferta de Instalación de TV (aunque el producto no sea una TV): se excluyen igual.
export async function cargarContextoTv(servicios) {
  try {
    const [cfg, ofertas] = await Promise.all([loadTvConfig(), servicios.length ? loadOffersByServicio(servicios) : Promise.resolve([])]);
    return { tvCfg: cfg, servicioConOferta: new Set((ofertas || []).map((o) => String(o.servicio))) };
  } catch (e) { return { tvCfg: null, servicioConOferta: new Set() }; }
}

// Estado de un servicio según sus llamadas (la última manda; "No contesta" cuenta los intentos).
export function estadoDe(llamadas) {
  const ord = [...(llamadas || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (!ord.length) return { estado: "Por llamar", intentos: 0, ultima: null };
  const ultima = ord[ord.length - 1];
  return { estado: ultima.resultado === "Revertido" ? "Por llamar" : ultima.resultado, intentos: ord.filter((x) => x.resultado === "No contesta").length, ultima };
}

/* ------------------------------ Acceso a datos ------------------------------ */

export async function cargarLlamadas({ fecha, desde }) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("preventive_calls").select("*").order("created_at", { ascending: false }).order("id");
    if (fecha) q = q.eq("fecha_servicio", fecha);
    if (desde) q = q.gte("fecha_servicio", desde);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
export async function registrarLlamada(fila) {
  const { data, error } = await supabase.from("preventive_calls").insert(fila).select().single();
  if (error) throw new Error(error.message);
  return data;
}
// Avisos para quienes asignan: llamadas que retiran (o devuelven) servicios de la asignación, de servicios con fecha de hoy en adelante, sin leer por este usuario.
export async function cargarAvisos({ hoy, userId }) {
  const [calls, reads] = await Promise.all([
    supabase.from("preventive_calls").select("*").eq("alerta", true).gte("fecha_servicio", hoy).order("created_at", { ascending: false }).range(0, 199),
    supabase.from("preventive_alert_reads").select("call_id").eq("user_id", userId).range(0, 999),
  ]);
  if (calls.error) throw new Error(calls.error.message);
  const leidas = new Set(((reads && reads.data) || []).map((r) => r.call_id));
  return (calls.data || []).map((c) => ({ ...c, leida: leidas.has(c.id) }));
}
export async function marcarLeidos(ids, userId) {
  if (!ids.length) return;
  const { error } = await supabase.from("preventive_alert_reads").upsert(ids.map((id) => ({ call_id: id, user_id: userId })), { onConflict: "call_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

/* ------------------------- Retirar / devolver de la asignación ------------------------- */

// Registros de Carga → registros ya cancelados con la causal PREVENTIVA (mismos campos que deja una auditoría con causal de gestión Cancelado).
export function retirarRegistros(registros, { resultado, nuevaFecha, nota, usuario }) {
  const causal = CAUSAL_PREVENTIVA[resultado];
  const hoy = new Date().toISOString().slice(0, 10);
  return registros.map((s) => ({
    ...s, causalAuditada: causal, estadoGestion: "En gestión", estadoExtreme: "No realizado",
    asig: { ...(s.asig || {}), cancelada: true, canceladaFecha: hoy, canceladaPor: "Auditoría", estadoManual: true, preventiva: { resultado, nuevaFecha: nuevaFecha || "", nota: nota || "", por: usuario, en: new Date().toISOString() } },
  }));
}
// Deshacer: el registro vuelve a la asignación del día como estaba (sin causal, sin cancelar).
export function devolverRegistros(registros) {
  return registros.map((s) => {
    const { cancelada, canceladaFecha, canceladaPor, estadoManual, preventiva, ...resto } = s.asig || {};
    return { ...s, causalAuditada: "", estadoGestion: "En gestión", estadoExtreme: "", asig: resto };
  });
}

export const csvFilas = (lista, llamadasPorServicio) => lista.map((g) => {
  const e = estadoDe(llamadasPorServicio.get(g.servicio));
  const u = e.ultima || {};
  return [g.servicio, g.cliente, g.telefonoTxt, g.direccion, g.barrio, g.ciudad, g.departamento, g.productos.join(" | "), g.tecnicoNombre, e.estado, e.intentos, u.nota || "", u.nueva_fecha || "", u.created_by_name || "", u.created_at ? new Date(u.created_at).toLocaleString("es-CO") : ""];
});
export const CSV_ENCABEZADOS = ["Servicio", "Cliente", "Teléfonos", "Dirección", "Barrio", "Ciudad", "Departamento", "Productos", "Técnico asignado", "Estado preventivo", "Intentos sin contestar", "Nota", "Nueva fecha", "Gestionó", "Fecha y hora de la gestión"];
export { plano };
