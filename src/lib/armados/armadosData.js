// Armados en almacén: solicitudes (store_requests), armados ejecutados (store_assemblies), almacenes (warehouses),
// archivos (fotos y soportes del PQR) y utilidades: lectura del Excel de un PQR, comparativo y Excel de cierre.
import * as XLSX from "xlsx";
import { supabase } from "../supabaseClient";
import { fetchAll } from "../maestrosApi";
import { CSV_HEADERS } from "../asignacion/outputs";

export const ORIGEN_TXT = { PQR: "PQR de Jamar", Directo: "Directo (almacén)" };
const BUCKET = "armados-fotos";
const ARCHIVO_MAX = 15 * 1024 * 1024;
const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", pdf: "application/pdf", eml: "message/rfc822",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", csv: "text/csv",
};
export const ARCHIVO_ACCEPT = Object.keys(MIME).map((e) => `.${e}`).join(",");

// Llave de comparación sin tildes ni mayúsculas ("Almacén Riohacha" = "ALMACEN RIOHACHA").
export const llave = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();

/* ------------------------------- Acceso a datos ------------------------------- */

export const listWarehouses = () => fetchAll("warehouses", "*", "name");
export const listRequests = () => fetchAll("store_requests", "*", "created_at");
export const listAssemblies = () => fetchAll("store_assemblies", "*", "created_at");

export async function listEvents(requestId) {
  const { data, error } = await supabase.from("store_request_events").select("*").eq("request_id", requestId).order("at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
export async function createRequest(f) {
  const { data, error } = await supabase.from("store_requests").insert(f).select().single();
  if (error) throw new Error(error.message);
  return data;
}
export async function updateRequest(id, patch) {
  const { data, error } = await supabase.from("store_requests").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
}
export async function createAssembly(f) {
  const { data, error } = await supabase.from("store_assemblies").insert(f).select().single();
  if (error) throw new Error(error.message);
  return data;
}
export async function updateAssembly(id, patch) {
  const { data, error } = await supabase.from("store_assemblies").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// Búsqueda de productos sin precios (cliente, técnico y equipo) y validación de códigos del Excel.
export async function buscarProductos(q) {
  const { data, error } = await supabase.rpc("cliente_buscar_productos", { q });
  if (error) throw new Error(error.message);
  return data || [];
}
export async function productosPorCodigo(codes) {
  const out = [];
  for (let i = 0; i < codes.length; i += 200) {
    const { data, error } = await supabase.rpc("productos_por_codigo", { codes: codes.slice(i, i + 200) });
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}

/* --------------------------------- Archivos --------------------------------- */

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

// Sube una foto o soporte a la carpeta indicada (id de la solicitud, o una carpeta temporal "nuevas/..."); devuelve { path, name }.
export async function subirArchivo(carpeta, file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!MIME[ext]) throw new Error(`${file.name}: formato no permitido (usa imágenes, PDF, Excel, Word o correo .eml).`);
  const listo = await comprimirImagen(file);
  if (listo.size > ARCHIVO_MAX) throw new Error(`${file.name}: pesa más de 15 MB.`);
  const seguro = listo.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^\w.\-]+/g, "_");
  const path = `${carpeta}/${Date.now()}-${seguro}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, listo, { contentType: MIME[ext], upsert: false });
  if (error) throw new Error(`${file.name}: ${error.message}`);
  return { path, name: file.name };
}
export async function urlArchivo(path, descargar) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600, descargar ? { download: descargar } : undefined);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Enlaces temporales (por defecto 7 días) para abrir varios archivos del bucket privado; devuelve un Map ruta -> enlace.
// Quien tenga el enlace puede abrir el archivo mientras no venza, aunque no tenga usuario.
export async function firmarUrls(paths, segundos = 7 * 24 * 3600) {
  const out = new Map();
  const unicas = [...new Set(paths.filter(Boolean))];
  for (let i = 0; i < unicas.length; i += 100) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unicas.slice(i, i + 100), segundos);
    if (error) throw new Error(error.message);
    (data || []).forEach((x) => { if (x.signedUrl && !x.error) out.set(x.path, x.signedUrl); });
  }
  return out;
}
/* ------------------------- Excel del PQR (puede traer varios PQR) ------------------------- */

const COL = {
  codigo: /^(CODIGO|COD|CODE|REFERENCIA|SKU)\b/, nombre: /(NOMBRE|PRODUCTO|DESCRIPCION)/, pqr: /^PQR/, almacen: /(ALMACEN|TIENDA|SEDE)/,
  fecha: /FECHA/, cantidad: /^(CANTIDAD|CANT|QTY|UNIDADES)/, dias: /^DIAS/,
};
function fechaISO(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!m) return null;
  let [, a, b, y] = m; a = +a; b = +b;
  const [d, mo] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b]; // si un número pasa de 12 se sabe cuál es el día; si no, día/mes
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Lee el Excel de Jamar (CODIGO, NOMBRE DEL PRODUCTO, PQR, ALMACEN, FECHA DE COMPROMISO; cantidad opcional) y agrupa por PQR.
// Las filas repetidas del mismo producto suman cantidad. Devuelve { grupos: [{ pqr, almacen, fecha, items: [{ code, name, quantity }] }], avisos }.
export function parsePqrExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (!rows.length) throw new Error("El archivo no tiene filas.");
  const heads = Object.keys(rows[0]);
  const find = (re) => heads.find((h) => re.test(llave(h)));
  const cCod = find(COL.codigo), cNom = find(COL.nombre), cPqr = find(COL.pqr), cAlm = find(COL.almacen), cFec = find(COL.fecha), cCan = find(COL.cantidad), cDias = find(COL.dias);
  if (!cCod || !cNom) throw new Error("No encontré las columnas CODIGO y NOMBRE DEL PRODUCTO.");
  const avisos = [];
  const grupos = new Map();
  let sinCodigo = 0;
  rows.forEach((r) => {
    const code = String(r[cCod] ?? "").trim();
    const name = String(r[cNom] ?? "").trim();
    if (!code && !name) return;
    if (!code) { sinCodigo++; return; }
    const pqr = cPqr ? String(r[cPqr] ?? "").trim() : "";
    const almacen = cAlm ? String(r[cAlm] ?? "").trim() : "";
    const k = `${pqr}|${llave(almacen)}`;
    const g = grupos.get(k) || { pqr, almacen, fecha: null, dias: null, items: new Map() };
    const f = cFec ? fechaISO(r[cFec]) : null;
    if (f && (!g.fecha || f > g.fecha)) g.fecha = f;
    const dd = cDias ? Math.round(Number(r[cDias])) : 0;
    if (dd > 0 && !g.dias) g.dias = dd;
    const q = Math.max(1, Math.round(Number(cCan ? r[cCan] : 1)) || 1);
    const it = g.items.get(code);
    if (it) it.quantity += q; else g.items.set(code, { code, name, quantity: q });
    grupos.set(k, g);
  });
  if (sinCodigo) avisos.push(`${sinCodigo} fila(s) sin código se omitieron.`);
  const lista = [...grupos.values()].map((g) => ({ ...g, items: [...g.items.values()] }));
  if (!lista.length) throw new Error("No encontré productos en el archivo.");
  if (lista.some((g) => !g.pqr)) avisos.push("Hay filas sin número de PQR: se agrupan juntas y el PQR queda por completar.");
  return { grupos: lista, avisos };
}

// Plantilla de muestra para que Jamar envíe el PQR con el formato esperado (una hoja con ejemplos y otra con las instrucciones).
export function buildPlantillaPqr() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["CODIGO", "NOMBRE DEL PRODUCTO", "CANTIDAD", "PQR", "ALMACEN", "FECHA DE COMPROMISO", "DIAS SUGERIDOS"],
    [7044379, "COMEDOR 6 PTOS SABINA EUROLINO", 1, 267816436, "ALMACEN RIOACHA", "2026-10-30", 5],
    [7040993, "MESA DE CENTRO AMY OFF WHITE/CHAMPANA", 2, 267816436, "ALMACEN RIOACHA", "2026-10-30", 5],
    [7042648, "SILLA BAR ETHAN VERDE", 1, 267807194, "ALMACEN RIOACHA", "2026-10-25", 3],
  ]);
  ws["!cols"] = [{ wch: 12 }, { wch: 46 }, { wch: 10 }, { wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, "PQR");
  const info = XLSX.utils.aoa_to_sheet([
    ["Plantilla de PQR para armado en almacén"], [],
    ["Cada fila es un producto. Borra las filas de ejemplo y escribe las tuyas, conservando los encabezados de la fila 1."], [],
    ["Columna", "¿Obligatoria?", "Qué escribir"],
    ["CODIGO", "Sí", "Código del producto (el mismo del maestro de productos de Biver)."],
    ["NOMBRE DEL PRODUCTO", "Sí", "Nombre del producto."],
    ["CANTIDAD", "No", "Unidades a armar. Si no la pones, cuenta 1 por fila; si repites el mismo producto en varias filas, se suman."],
    ["PQR", "Sí", "Número del PQR. Un mismo archivo puede traer varios PQR: se crea una solicitud por cada uno."],
    ["ALMACEN", "Sí", "Nombre del almacén, igual al registrado en Biver (ej. ALMACEN RIOACHA)."],
    ["FECHA DE COMPROMISO", "No", "Fecha límite del PQR (AAAA-MM-DD o DD/MM/AAAA)."],
    ["DIAS SUGERIDOS", "No", "Días en los que se sugiere terminar el PQR, contados desde que se carga. Si lo dejas vacío, se usa la fecha de compromiso."],
    [], ["Un PQR puede tardar varios días: las unidades pendientes se muestran en la asignación de cada día y bajan a medida que se registran los armados."],
  ]);
  info["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, info, "Instrucciones");
  return wb;
}

// Almacén del maestro que corresponde al nombre escrito en el Excel (sin tildes ni mayúsculas); null si no hay.
export function emparejarAlmacen(nombre, warehouses) {
  const k = llave(nombre);
  if (!k) return null;
  return warehouses.find((w) => llave(w.name) === k) || warehouses.find((w) => llave(w.name).replace(/^ALMACEN /, "") === k.replace(/^ALMACEN /, "")) || null;
}

/* ------------------------------- Comparativo y cierre ------------------------------- */

export const activos = (assemblies, requestId) => assemblies.filter((a) => a.request_id === requestId && !a.voided);
export const unidades = (list, f = (x) => x.quantity) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);

// Solicitado vs armado por producto. Estados: Completo, Pendiente, Excede, No solicitado.
export function comparativo(request, assemblies) {
  const m = new Map();
  (request.items || []).forEach((it) => { const e = m.get(it.code) || { code: it.code, name: it.name, line: it.line || "", solicitado: 0, armado: 0 }; e.solicitado += Number(it.quantity) || 0; m.set(it.code, e); });
  activos(assemblies, request.id).forEach((a) => {
    const e = m.get(a.product_code) || { code: a.product_code, name: a.product_name, line: a.product_line || "", solicitado: 0, armado: 0 };
    e.armado += a.quantity; if (!e.line && a.product_line) e.line = a.product_line; m.set(a.product_code, e);
  });
  return [...m.values()].map((e) => ({ ...e, estado: e.solicitado === 0 ? "No solicitado" : e.armado === 0 ? "Pendiente" : e.armado < e.solicitado ? "Parcial" : e.armado === e.solicitado ? "Completo" : "Excede" }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// Lo que falta para poder cerrar la solicitud.
export function validarCierre(request, assemblies, pqr) {
  const mios = activos(assemblies, request.id);
  const faltas = [];
  if (!String(pqr || "").trim()) faltas.push("Falta el número de PQR.");
  if (mios.length === 0) faltas.push("No hay armados registrados.");
  const sinFoto = mios.filter((a) => !(a.photos || []).length);
  if (sinFoto.length) faltas.push(`${sinFoto.length} armado(s) sin foto: ${sinFoto.slice(0, 4).map((a) => a.product_code).join(", ")}${sinFoto.length > 4 ? "…" : ""}.`);
  if (mios.some((a) => !a.technician_id)) faltas.push("Hay armados sin técnico.");
  return faltas;
}

const fmtD = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");

// Excel del módulo (lo que se ve en pantalla) con detalle por producto y enlaces a los soportes (fotos de los armados y soportes del PQR).
// urls: Map ruta -> enlace temporal (ver firmarUrls). Hojas: Solicitudes, Detalle por producto y Armados y soportes.
export function buildDetalleWorkbook({ requests, warehouses, assemblies, urls }) {
  const almacen = Object.fromEntries(warehouses.map((w) => [w.id, w]));
  const enlace = (f, i) => (f && urls.get(f.path) ? { t: "s", v: `${i}`, l: { Target: urls.get(f.path), Tooltip: f.name || "" } } : "");
  const MAXF = 8;
  const encabezadoFotos = Array.from({ length: MAXF }, (_, i) => `FOTO ${i + 1}`);
  const fotosDe = (list) => list.flatMap((a) => a.photos || []);
  const wb = XLSX.utils.book_new();

  const maxSop = Math.min(4, Math.max(1, ...requests.map((r) => (r.attachments || []).length)));
  const hoja1 = XLSX.utils.aoa_to_sheet([
    ["SOLICITUD", "PQR", "ORIGEN", "ALMACÉN", "CIUDAD", "FECHA SOLICITUD", "FECHA COMPROMISO", "ESTADO", "UNIDADES SOLICITADAS", "UNIDADES ARMADAS", "TÉCNICOS", ...Array.from({ length: maxSop }, (_, i) => `SOPORTE PQR ${i + 1}`)],
    ...requests.map((r) => { const w = almacen[r.warehouse_id] || {}; const mios = activos(assemblies, r.id);
      return [r.request_no, r.pqr_number || "", ORIGEN_TXT[r.origin], w.name || "", w.city || "", r.requested_date, r.commitment_date || "", r.status, unidades(r.items || []), unidades(mios),
        [...new Set(mios.map((a) => a.technician_name).filter(Boolean))].join(", "), ...Array.from({ length: maxSop }, (_, i) => enlace((r.attachments || [])[i], "Abrir"))]; }),
  ]);
  XLSX.utils.book_append_sheet(wb, hoja1, "Solicitudes");

  // Las primeras 22 columnas son las mismas, en el mismo orden, que las del CSV de Asignación (paso 3); después van los datos propios del armado en almacén.
  const detalle = [[...CSV_HEADERS, "SOLICITUD", "ESTADO SOLICITUD", "LÍNEA", "SOLICITADO", "ARMADO", "PENDIENTE", "ESTADO", "FECHAS DE ARMADO", "FOTOS", ...encabezadoFotos]];
  requests.forEach((r) => {
    const w = almacen[r.warehouse_id] || {};
    const meta = r.target_date || r.commitment_date || null;
    comparativo(r, assemblies).forEach((c) => {
      const mios = activos(assemblies, r.id).filter((a) => a.product_code === c.code);
      const fotos = fotosDe(mios);
      const pqr = String(r.pqr_number || "").trim();
      const servicio = pqr || r.request_no;
      detalle.push([
        r.client || "", fmtD(r.requested_date), /^\d+$/.test(servicio) ? Number(servicio) : servicio, w.name || "", w.address || w.name || "", w.contact_phone || "",
        w.contact_name ? `Contacto: ${w.contact_name}` : "", w.department || "", w.city || "", w.neighborhood || "", c.name, c.code, "", "",
        `ARMADO EN ALMACEN${pqr ? ` · PQR ${pqr}` : ""}${meta ? ` · terminar antes del ${fmtD(meta)}` : ""}`, "",
        [...new Set(mios.map((a) => a.technician_name).filter(Boolean))].join(", "), "", "", "", "", "",
        r.request_no, r.status, c.line, c.solicitado, c.armado, Math.max(0, c.solicitado - c.armado), c.estado, [...new Set(mios.map((a) => fmtD(a.assembled_on)))].join(", "), fotos.length,
        ...Array.from({ length: MAXF }, (_, i) => enlace(fotos[i], "Ver"))]);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle), "Detalle por producto");

  const armados = [["FECHA", "SOLICITUD", "PQR", "ALMACÉN", "CÓDIGO", "PRODUCTO", "LÍNEA", "CANTIDAD", "TÉCNICO", "OBSERVACIÓN", "FOTOS", ...encabezadoFotos]];
  requests.forEach((r) => {
    const w = almacen[r.warehouse_id] || {};
    activos(assemblies, r.id).sort((a, b) => String(a.assembled_on).localeCompare(String(b.assembled_on))).forEach((a) => {
      armados.push([fmtD(a.assembled_on), r.request_no, r.pqr_number || "", w.name || "", a.product_code, a.product_name, a.product_line || "", a.quantity, a.technician_name || "", a.notes || "", (a.photos || []).length,
        ...Array.from({ length: MAXF }, (_, i) => enlace((a.photos || [])[i], "Ver"))]);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(armados), "Armados y soportes");

  const info = XLSX.utils.aoa_to_sheet([["Los enlaces de fotos y soportes abren los archivos del sistema y vencen a los 7 días (después se vuelve a exportar). Quien tenga el archivo puede abrirlos mientras no venzan."],
    [`Cada producto muestra hasta ${MAXF} fotos; el resto está en el sistema o en el informe PDF de la solicitud.`]]);
  XLSX.utils.book_append_sheet(wb, info, "Notas");
  return wb;
}
// Excel del cierre de una solicitud (resumen, comparativo y detalle de armados).
export function buildCierreWorkbook(request, warehouse, assemblies) {
  const mios = activos(assemblies, request.id).sort((a, b) => String(a.assembled_on).localeCompare(String(b.assembled_on)));
  const comp = comparativo(request, assemblies);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Solicitud de armado en almacén"], [],
    ["Solicitud", request.request_no], ["PQR", request.pqr_number || ""], ["Cliente", request.client], ["Almacén", warehouse ? warehouse.name : ""],
    ["Ciudad", warehouse ? warehouse.city || "" : ""], ["Origen", ORIGEN_TXT[request.origin] || request.origin], ["Fecha de solicitud", fmtD(request.requested_date)],
    ["Fecha de compromiso", fmtD(request.commitment_date)], ["Días sugeridos", request.suggested_days || ""], ["Meta (terminar antes del)", fmtD(request.target_date)], ["Estado", request.status], ["Cerrada", fmtD(request.closed_at)],
    ["Unidades solicitadas", unidades(request.items || [])], ["Unidades armadas", unidades(mios)],
    ["Técnicos", [...new Set(mios.map((a) => a.technician_name).filter(Boolean))].join(", ")], ["Observaciones del cierre", request.close_notes || ""],
  ]), "Resumen");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["CÓDIGO", "PRODUCTO", "LÍNEA", "SOLICITADO", "ARMADO", "ESTADO"],
    ...comp.map((c) => [c.code, c.name, c.line, c.solicitado, c.armado, c.estado]),
  ]), "Comparativo");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["FECHA", "CÓDIGO", "PRODUCTO", "LÍNEA", "CANTIDAD", "TÉCNICO", "FOTOS", "OBSERVACIÓN"],
    ...mios.map((a) => [fmtD(a.assembled_on), a.product_code, a.product_name, a.product_line || "", a.quantity, a.technician_name || "", (a.photos || []).length, a.notes || ""]),
  ]), "Armados");
  return wb;
}
