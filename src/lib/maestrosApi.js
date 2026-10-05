// Acceso a Supabase de los maestros de Asignación. Son tablas grandes (miles de filas),
// por eso no viven en el estado `db` de la app: se consultan por páginas y se cargan al abrir cada pantalla.
import { supabase } from "./supabaseClient";

const clean = (s) => String(s || "").replace(/[,()%*\\]/g, " ").trim();

// Página de una tabla con búsqueda (ilike en varias columnas) y filtros de igualdad.
export async function listPage(table, { select = "*", search = "", searchCols = [], filters = {}, orderBy = "name", ascending = true, page = 0, pageSize = 50 } = {}) {
  let q = supabase.from(table).select(select, { count: "exact" });
  Object.entries(filters).forEach(([k, v]) => { if (v !== "" && v !== null && v !== undefined) q = q.eq(k, v); });
  const s = clean(search);
  if (s && searchCols.length) q = q.or(searchCols.map((c) => `${c}.ilike.%${s}%`).join(","));
  q = q.order(orderBy, { ascending }).range(page * pageSize, page * pageSize + pageSize - 1);
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

export async function importAssembly({ products, complexity }, onStep) {
  onStep("Productos de armado...");
  await upsertInBatches("assembly_products", products, "code", (d, t) => onStep(`Productos ${d}/${t}`));
  onStep("Complejidad por línea...");
  await upsertInBatches("assembly_complexity", complexity, "line,subline");
  return { products: products.length, complexity: complexity.length };
}
