// Ruta del técnico: servicios del día agrupados por servicio, reportes de "realizado" con ubicación y enlaces para llamar o escribir al cliente.
import { supabase } from "./supabaseClient";
import { rowToService } from "./mapping";
import { numerosDeTelefono, urlLlamada, telefonoWsp, urlWsp } from "./whatsapp";

export const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Servicios que tiene un técnico para un día (la asignación se hace el día anterior). Solo lectura; con el rol técnico la base de datos devuelve únicamente los suyos.
export async function cargarServiciosDelDia(technicianId, day) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from("services").select("*").eq("technician_id", technicianId).eq("date", day).order("ruta_orden", { ascending: true, nullsFirst: false }).range(start, start + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out.map(rowToService);
}

// Agrupa los registros (uno por producto o unidad) por número de servicio: un bloque por servicio con el detalle de sus productos.
export function agruparPorServicio(registros) {
  const m = new Map();
  registros.filter((s) => s.servicioExterno && !(s.asig && (s.asig.cancelada || s.asig.anulada)) && ["En gestión", "Realizado"].includes(s.estadoGestion)).forEach((s) => {
    const k = String(s.servicioExterno);
    const g = m.get(k) || { servicio: k, registros: [], orden: s.rutaOrden ?? 9999, productos: new Map() };
    g.registros.push(s); g.orden = Math.min(g.orden, s.rutaOrden ?? 9999);
    const pk = `${s.productoExternoCodigo || ""}|${s.productoExternoNombre || ""}`;
    const p = g.productos.get(pk) || { nombre: s.productoExternoNombre || (s.asig && s.asig.producto) || "-", codigo: s.productoExternoCodigo || (s.asig && s.asig.codigo) || "", n: 0 };
    p.n += Math.max(1, Math.round(Number(s.quantity) || 1)); g.productos.set(pk, p);
    m.set(k, g);
  });
  return [...m.values()].map((g) => {
    const s = g.registros[0], a = s.asig || {};
    return {
      servicio: g.servicio, orden: g.orden, productos: [...g.productos.values()], cliente: s.clienteNombre || a.cliente || "", direccion: s.direccion || a.direccion || "", senas: a.senas || "",
      barrio: a.barrio || "", ciudad: s.ciudadExterna || a.ciudad || "", reporta: a.reporta || "", tipo: s.serviceType || a.tipo || "", pqr: a.pqrNumero || "", telefonos: numerosDeTelefono(a.telefono),
      documento: a.clienteId ? String(a.clienteId).trim() : "", // documento del cliente (columna CLIENTE de la base de Jamar), si el servicio lo trae
    };
  }).sort((x, y) => x.orden - y.orden || x.servicio.localeCompare(y.servicio));
}

export const enlaceLlamar = (numero) => urlLlamada(numero);
// WhatsApp al cliente con un aviso corto del técnico. null si el número no es un celular reconocible.
export function enlaceWhatsappCliente(numero, { cliente, tecnico, servicio, productos, fechaTexto, direccion }) {
  const tel = telefonoWsp(numero);
  if (!tel) return null;
  const lista = productos.map((p) => `${p.nombre}${p.n > 1 ? ` (x${p.n})` : ""}`).join(", ");
  const texto = `Buen día${cliente ? ` ${cliente}` : ""}. Soy ${tecnico || "el técnico"} de BIVER, empresa encargada de los servicios de JAMAR. ${fechaTexto} voy a realizar el servicio ${servicio} (${lista})${direccion ? ` en ${direccion}` : ""}. ¿Me confirma que estará disponible? Gracias.`;
  return urlWsp(tel, texto);
}

/* ------------------------------- Reportes ------------------------------- */

export async function cargarReportes({ day, technicianId, from, to }) {
  let q = supabase.from("route_reports").select("*");
  if (day) q = q.eq("day", day);
  if (from) q = q.gte("day", from);
  if (to) q = q.lte("day", to);
  if (technicianId) q = q.eq("technician_id", technicianId);
  const { data, error } = await q.limit(5000);
  if (error) throw new Error(error.message);
  return data || [];
}

// Ubicación del celular. Nunca falla: devuelve el estado (ok, denegada, sin_senal, no_disponible) para guardarlo con el reporte.
export function posicionActual(timeoutMs = 12000) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) { resolve({ status: "no_disponible" }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ status: "ok", lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => resolve({ status: e && e.code === 1 ? "denegada" : "sin_senal" }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 });
  });
}

// Marca (o desmarca) un servicio como realizado. Al marcar guarda la hora y la ubicación; es una fila por (día, servicio, técnico).
export async function guardarReporte({ day, servicio, technicianId, userId, done, posicion }) {
  const ahora = new Date().toISOString();
  const fila = { day, servicio, technician_id: technicianId, done, created_by: userId, updated_at: ahora };
  if (done) Object.assign(fila, { done_at: ahora, lat: posicion && posicion.lat != null ? posicion.lat : null, lng: posicion && posicion.lng != null ? posicion.lng : null, accuracy: posicion && posicion.accuracy != null ? Math.round(posicion.accuracy) : null, location_status: (posicion && posicion.status) || "no_disponible" });
  const { data, error } = await supabase.from("route_reports").upsert(fila, { onConflict: "day,servicio,technician_id" }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export const enlaceMapa = (r) => (r && r.lat != null && r.lng != null ? `https://www.google.com/maps?q=${r.lat},${r.lng}` : null);
