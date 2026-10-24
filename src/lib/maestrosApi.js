// Acceso a Supabase de los maestros de Asignación. Son tablas grandes (miles de filas),
// por eso no viven en el estado `db` de la app: se consultan por páginas y se cargan al abrir cada pantalla.
import { supabase } from "./supabaseClient";

const clean = (s) => String(s || "").replace(/[,()%*\\]/g, " ").trim();

// Página de una tabla con búsqueda (ilike en varias columnas) y filtros de igualdad.
export async function listPage(table, { select = "*", search = "", searchCols = [], filters = {}, orderBy = "name", ascending = true, thenBy = null, page = 0, pageSize = 50 } = {}) {
  let q = supabase.from(table).select(select, { count: "exact" });
  // "__null__" / "__notnull__" filtran por vacío / con dato (p. ej. productos sin manual).
  Object.entries(filters).forEach(([k, v]) => {
    if (v === "" || v === null || v === undefined) return;
    if (v === "__null__") q = q.is(k, null);
    else if (v === "__notnull__") q = q.not(k, "is", null);
    else q = q.eq(k, v);
  });
  const s = clean(search);
  if (s && searchCols.length) q = q.or(searchCols.map((c) => `${c}.ilike.%${s}%`).join(","));
  q = q.order(orderBy, { ascending });
  if (thenBy) q = q.order(thenBy, { ascending: true }); // desempate estable entre páginas cuando muchos registros comparten el mismo valor
  q = q.range(page * pageSize, page * pageSize + pageSize - 1);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: data || [], count: count ?? 0 };
}

// Trae toda una tabla (de a 1000 filas, que es el tope de Supabase por consulta).
export async function fetchAll(table, select = "*", orderBy = "id") {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).order(orderBy).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function insertRow(table, row, select = "*") {
  const { data, error } = await supabase.from(table).insert(row).select(select).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateRow(table, id, fields, pk = "id") {
  const { error } = await supabase.from(table).update(fields).eq(pk, id);
  if (error) throw new Error(error.message);
}

// Sube filas en tandas (upsert por la llave natural: no borra nada de lo que ya existe).
export async function upsertInBatches(table, rows, onConflict, onProgress, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + size), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    if (onProgress) onProgress(Math.min(rows.length, i + size), rows.length);
  }
}

// Importación de zonas + barrios (+ abreviaturas). Las zonas van primero porque los barrios las referencian.
export async function importGeo({ abbreviations, zones, neighborhoods }, onStep) {
  onStep("Abreviaturas y regiones...");
  await upsertInBatches("geo_abbreviations", abbreviations, "abbr");
  onStep("Zonas equivalentes...", 0);
  await upsertInBatches("geo_zones", zones, "name", (d, t) => onStep(`Zonas equivalentes ${d}/${t}`));
  onStep("Leyendo zonas guardadas...");
  const saved = await fetchAll("geo_zones", "id,name");
  const idByName = new Map(saved.map((z) => [z.name, z.id]));
  const rows = neighborhoods.map(({ zoneName, ...r }) => ({ ...r, zone_id: idByName.get(zoneName) })).filter((r) => r.zone_id);
  await upsertInBatches("geo_neighborhoods", rows, "region,city,neighborhood", (d, t) => onStep(`Barrios ${d}/${t}`));
  return { zones: zones.length, neighborhoods: rows.length };
}

/* ------------------- Manual / instructivo de cada producto ------------------- */

const MANUAL_MAX = 20 * 1024 * 1024;
const MANUAL_MIME = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", mp4: "video/mp4",
};
export const MANUAL_ACCEPT = Object.keys(MANUAL_MIME).map((e) => `.${e}`).join(",");
const seguro = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_");

// Sube el manual de un producto y lo deja como el vigente (los anteriores quedan guardados, no se borran).
export async function subirManual(product, file, userId) {
  if (!file) throw new Error("Elige un archivo.");
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (!MANUAL_MIME[ext]) throw new Error("Formato no permitido. Usa PDF, imagen (JPG, PNG, WEBP), Word, PowerPoint, Excel o MP4.");
  if (file.size > MANUAL_MAX) throw new Error("El archivo pesa más de 20 MB. Comprímelo o súbelo más liviano.");
  const path = `${seguro(product.code)}/${Date.now()}-${seguro(file.name)}`;
  const { error } = await supabase.storage.from("producto-manuales").upload(path, file, { contentType: MANUAL_MIME[ext], upsert: false });
  if (error) throw new Error(/row-level|policy|permission/i.test(error.message) ? "Sin permiso para subir el manual (solo el administrador)." : error.message);
  const patch = { manual_path: path, manual_name: file.name, manual_at: new Date().toISOString(), manual_by: userId };
  await updateRow("assembly_products", product.code, patch, "code");
  return patch;
}

// Enlace temporal (10 minutos) para ver el manual; el bucket es privado. Con `descargar` (nombre del archivo) el navegador lo baja en vez de abrirlo.
export async function urlManual(path, descargar) {
  const { data, error } = await supabase.storage.from("producto-manuales").createSignedUrl(path, 600, descargar ? { download: descargar } : undefined);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Todos los archivos que se han adjuntado a un producto (el más reciente primero). El nombre guardado empieza con la fecha en milisegundos.
export async function listarManuales(code) {
  const carpeta = seguro(code);
  const { data, error } = await supabase.storage.from("producto-manuales").list(carpeta, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  if (error) throw new Error(error.message);
  return (data || []).filter((f) => f.name && !f.name.startsWith(".")).map((f) => ({
    path: `${carpeta}/${f.name}`, nombre: f.name.replace(/^\d+-/, ""), size: f.metadata?.size ?? null, fecha: f.created_at || f.updated_at || null,
  }));
}

export async function importAssembly({ products, complexity }, onStep) {
  onStep("Productos de armado...");
  await upsertInBatches("assembly_products", products, "code", (d, t) => onStep(`Productos ${d}/${t}`));
  onStep("Complejidad por línea...");
  await upsertInBatches("assembly_complexity", complexity, "line,subline");
  return { products: products.length, complexity: complexity.length };
}
