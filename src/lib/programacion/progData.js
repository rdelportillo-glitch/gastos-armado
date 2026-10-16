// Programación de servicios: órdenes (service_orders), fotos de la solicitud y su paso a Asignación.
// Cada orden genera un servicio Pendiente por producto en `services` (el mismo formato de las bases de Jamar),
// con el número de orden como "servicio", para que la Asignación lo tome como cualquier otro.
import { supabase } from "../supabaseClient";
import { fetchAll } from "../maestrosApi";
import * as E from "../asignacion/engine.js";
import { rowsToServiceRecords, existingForUnit } from "../asignacion/data";

export const TIPOS_SOLICITUD = ["Ruta Critica", "Particular", "IGS", "Instalación de Tv"];
const FOTO_MAX = 10 * 1024 * 1024;
const FOTO_RE = /\.(jpe?g|png|webp|heic|pdf)$/i;

export const listOrders = () => fetchAll("service_orders", "*", "created_at");

export async function createOrder(f) {
  const { data, error } = await supabase.from("service_orders").insert(f).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateOrder(id, patch) {
  const { data, error } = await supabase.from("service_orders").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function comprimirImagen(file) {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return file;
  try {
    const bmp = await createImageBitmap(file);
    const escala = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * escala); canvas.height = Math.round(bmp.height * escala);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch (e) { return file; }
}

// Lo que necesita el formulario de un cliente (rol "cliente"): departamentos y barrios; no lee zonas, productos ni nada interno.
export async function cargarGeoCliente() {
  const [abbreviations, neighborhoods] = await Promise.all([fetchAll("geo_abbreviations", "*", "abbr"), fetchAll("geo_neighborhoods", "city,neighborhood,region,zone_type,active", "id")]);
  return { abbreviations, neighborhoods };
}

// Búsqueda de productos que devuelve solo código, nombre, tiempo, personas, línea y sublínea (sin precios).
export async function buscarProductos(q) {
  const { data, error } = await supabase.rpc("cliente_buscar_productos", { q });
  if (error) throw new Error(error.message);
  return data || [];
}

// Sube una foto o PDF de la solicitud a la carpeta indicada (número de orden o una carpeta temporal); devuelve { path, name }.
export async function subirFoto(carpeta, file) {
  const orderNo = carpeta;
  if (!FOTO_RE.test(file.name)) throw new Error(`${file.name}: solo se aceptan imágenes (JPG, PNG, WEBP, HEIC) o PDF.`);
  const listo = await comprimirImagen(file);
  if (listo.size > FOTO_MAX) throw new Error(`${file.name}: pesa más de 10 MB.`);
  const seguro = listo.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^\w.\-]+/g, "_");
  const path = `${orderNo}/${Date.now()}-${seguro}`;
  const { error } = await supabase.storage.from("programacion-fotos").upload(path, listo, { contentType: listo.type || undefined, upsert: false });
  if (error) throw new Error(`${file.name}: ${error.message}`);
  return { path, name: file.name };
}

export async function urlFoto(path) {
  const { data, error } = await supabase.storage.from("programacion-fotos").createSignedUrl(path, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

/* ------------------------------ Listas desde los maestros ------------------------------ */

// Departamentos (con su región), ciudades de la región y barrios de la ciudad, tal como están en Maestros → Barrios y zonas.
export function listasGeo(masters) {
  const deptos = (masters.abbreviations || []).filter((a) => a.level === "MUNICIPIO").map((a) => ({ name: a.name, region: a.region_id })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const nbh = (masters.neighborhoods || []).filter((n) => n.active !== false);
  const ciudades = (region) => [...new Set(nbh.filter((n) => n.region === region).map((n) => n.city))].sort((a, b) => a.localeCompare(b, "es"));
  const barrios = (region, ciudad) => [...new Set(nbh.filter((n) => n.region === region && n.city === ciudad && String(n.zone_type).toUpperCase() !== "MUNICIPIO").map((n) => n.neighborhood))].sort((a, b) => a.localeCompare(b, "es"));
  return { deptos, ciudades, barrios };
}

/* ------------------------------ Orden → servicios de Asignación ------------------------------ */

// Número de servicio con el que la orden entra a Asignación: el que escribe el usuario (el de Jamar / Extreme); si no hay, el de la orden (PS-...).
export const servicioDe = (o) => String(o.service_number || "").trim() || o.order_no;
// Servicios de Asignación que pertenecen a la orden (por su id, o por el número en las órdenes antiguas).
export const esDeOrden = (s, o) => !!s.asig && (s.asig.ordenId ? s.asig.ordenId === o.id : s.servicioExterno === o.order_no || s.servicioExterno === servicioDe(o));

const esCritica = (tipo) => E.deaccent(E.U(tipo)).includes("RUTA CRITICA");

// Filas del motor (una por unidad) de una orden, con zona, región, tiempo y complejidad resueltos con los maestros.
export function ordenAFilas(order, masters) {
  const rows = (order.products || []).map((p) => ({
    EMPRESA: "JAMAR", FECHA_PROG: order.scheduled_date, SERVICIO: servicioDe(order), NOMBRECLIENTE: order.customer_name,
    DIRECCION: order.address, TELEFONO: order.phone || "", SENAS: order.notes || "",
    DEPARTAMENTO: order.department, "NOMBRE DEPARTAMENTO": order.department, "Nombre Ciudad": order.city, BARRIO: order.neighborhood || "",
    "NOMBRE PRODUCTO": p.name, CODIGO: p.code, LINEA: p.line || "", SUBLINEA: p.subline || "",
    "Productos.TIEMPOS": p.minutes || null, "Tiempo ARMADO": (p.minutes || 0) * (p.quantity || 1),
    CLIENTEREPORTA: order.customer_report || "", Cantidad: p.quantity || 1, Prioridad: esCritica(order.request_type) ? "Prioridad 1" : undefined,
    _origen: "Programación",
  }));
  return E.enrichBase(rows, masters.M, masters.idx).map((r) => ({ ...r, tipoSolicitud: order.request_type, ordenId: order.id }));
}

// Los tiempos de una orden creada por un cliente se toman del maestro de productos (el cliente no los define): se corrigen una sola vez,
// al enviarla a Asignación; después se respetan los ajustes que haga el equipo.
export function verificarTiempos(order, masters) {
  const products = (order.products || []).map((p) => {
    if (p.verificado) return p;
    const m = masters.M.producto[String(p.code).trim()];
    return { ...p, minutes: m && m[0] ? m[0] : p.minutes, verificado: true };
  });
  return { ...order, products, total_minutes: Math.round(products.reduce((s, p) => s + (Number(p.minutes) || 0) * (Number(p.quantity) || 1), 0)) };
}

// Productos de la orden que no se pudieron ubicar (sin zona/región): hay que corregir ciudad o barrio.
export const filasSinZona = (rows) => rows.filter((r) => !r.zona || r.region == null || r.region === undefined);

// Une los registros de la orden con la lista de servicios: crea los nuevos, actualiza los que siguen Pendientes,
// y marca como cancelados los Pendientes que ya no están en la orden. Los que ya están en gestión no se tocan.
export function sincronizarServicios(services, order, rows, session, uid) {
  const records = rowsToServiceRecords(rows, session);
  const byKey = new Map();
  (services || []).filter((s) => esDeOrden(s, order)).forEach((s) => { const k = `${servicioDe(order)}|${s.productoExternoCodigo || ""}`; byKey.set(k, [...(byKey.get(k) || []), s]); });
  let list = [...(services || [])];
  const created = [], tocados = new Set();
  let nuevos = 0, actualizados = 0, omitidos = 0;
  records.forEach((rec) => {
    const ex = existingForUnit(byKey.get(`${rec.servicioExterno}|${rec.productoExternoCodigo}`) || [], rec.asig.unidad);
    if (!ex) { created.push({ id: uid("srv"), productId: null, observacionTrabajo: null, armado: null, observation: "", createdAt: new Date().toISOString(), ...rec }); nuevos++; }
    else if (ex.estadoGestion === "Pendiente" && ex.asig && Math.round(ex.quantity || 1) === 1) {
      const { technicianId, tecnico2Nombre, tecnico3Nombre, rutaOrden, responsibleUserId, ...fields } = rec;
      list = list.map((s) => (s.id === ex.id ? { ...s, ...fields } : s)); tocados.add(ex.id); actualizados++;
    } else { tocados.add(ex.id); omitidos++; }
  });
  let cancelados = 0;
  list = list.map((s) => {
    if (!esDeOrden(s, order) || tocados.has(s.id) || s.estadoGestion !== "Pendiente" || !s.asig || s.asig.cancelada) return s;
    cancelados++; return { ...s, asig: { ...s.asig, cancelada: true } };
  });
  return { services: [...created, ...list], nuevos, actualizados, omitidos, cancelados };
}

// Marca como canceladas las unidades Pendientes de una orden (no entran más a Asignación).
export function cancelarServicios(services, order) {
  let n = 0;
  const list = (services || []).map((s) => {
    if (!esDeOrden(s, order) || s.estadoGestion !== "Pendiente" || !s.asig || s.asig.cancelada) return s;
    n++; return { ...s, asig: { ...s.asig, cancelada: true } };
  });
  return { services: list, cancelados: n };
}

// Estado de una orden según sus servicios en Asignación.
export function estadoOrden(order, services) {
  if (order.status === "Cancelada") return { texto: "Cancelada", color: "gray" };
  const sv = (services || []).filter((s) => esDeOrden(s, order) && !(s.asig && s.asig.cancelada));
  if (sv.length === 0) return { texto: "Sin enviar a Asignación", color: "red" };
  if (sv.every((s) => s.estadoGestion === "Realizado" || s.finalizedAt)) return { texto: "Realizada", color: "green" };
  if (sv.some((s) => s.estadoGestion === "En gestión" || s.estadoGestion === "Realizado")) return { texto: "En gestión", color: "blue" };
  return { texto: "Pendiente de asignar", color: "amber" };
}
