// CSAT del cliente (informe mensual en PowerPoint): homologación de nombres con Personal, guardado en la base de datos y cálculos del reporte.
//  · El PowerPoint solo trae el % de cada técnico por mes (no cuántas encuestas tuvo): por eso, cuando un técnico sale en varios departamentos, su CSAT del mes es el promedio simple de esos %.
//  · Cada técnico se cuenta en el departamento de su ficha de Personal; si no tiene ficha, en el departamento del PowerPoint.
import { supabase } from "./supabaseClient";

export const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const sinRaros = (s) => plano(String(s ?? "").replace(/_/g, " ")).replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// Nombre sin importar el orden ni los guiones bajos: "EDGAR_GOMEZ" = "Gomez Edgar".
export const claveNombre = (s) => sinRaros(s).split(" ").filter(Boolean).sort().join(" ");
export const llaveAlias = (s) => sinRaros(s);
export const esSinIdentificar = (s) => /^SIN IDENTIFICAR$/.test(sinRaros(s));
export const mesLabel = (k) => { const [y, m] = String(k).split("-").map(Number); return `${["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][m - 1]} ${String(y).slice(2)}`; };
export const mesLargo = (k) => { const [y, m] = String(k).split("-").map(Number); return `${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][m - 1]} ${y}`; };
export const mesAnterior = (k, n = 1) => { const [y, m] = k.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 - n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const prom = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
export const redondear = (v, d = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);

/* ------------------------------ Homologación ------------------------------ */

// Para cada nombre del PowerPoint busca a quién corresponde en Personal.
//  · "alias": ya se había confirmado en una carga anterior (o se decidió que no tiene ficha) · "exacto": mismas palabras, sin importar el orden, y una sola persona
//  · "probable": comparte al menos 2 palabras con alguien (ej. falta un apellido): hay que confirmarlo · "ninguno": sin coincidencia
// tecnicos: Personal (id, name, department, status, category). alias: filas de csat_alias (nombre_plano, technician_id; technician_id vacío = sin ficha a propósito).
export function homologar(nombresPpt, tecnicos, alias = []) {
  const campo = (tecnicos || []).filter((t) => t.category !== "Administrativo");
  const porAlias = new Map(alias.map((a) => [a.nombre_plano, a]));
  const info = campo.map((t) => { const cl = claveNombre(t.name); return { t, cl, tokens: new Set(cl.split(" ").filter(Boolean)) }; });
  const out = new Map();
  [...new Set(nombresPpt)].forEach((nombre) => {
    const k = llaveAlias(nombre);
    if (esSinIdentificar(nombre)) { out.set(k, { nombre, via: "sinIdentificar", tecnico: null, candidatos: [] }); return; }
    const a = porAlias.get(k);
    if (a) { out.set(k, { nombre, via: "alias", tecnico: a.technician_id ? campo.find((t) => t.id === a.technician_id) || null : null, sinFicha: !a.technician_id, candidatos: [] }); return; }
    const cl = claveNombre(nombre), toks = new Set(cl.split(" ").filter(Boolean));
    const iguales = info.filter((x) => x.cl === cl);
    if (iguales.length === 1) { out.set(k, { nombre, via: "exacto", tecnico: iguales[0].t, candidatos: [] }); return; }
    const cand = info.map((x) => { const comunes = [...toks].filter((w) => x.tokens.has(w)).length; return { t: x.t, comunes, score: comunes / Math.min(toks.size, x.tokens.size || 1) }; })
      .filter((x) => x.comunes >= 2 && x.score >= 0.66)
      .sort((p, q) => q.score - p.score || q.comunes - p.comunes || (p.t.status === "Activo" ? 0 : 1) - (q.t.status === "Activo" ? 0 : 1))
      .slice(0, 5).map((x) => x.t);
    const todos = iguales.length > 1 ? iguales.map((x) => x.t) : cand;
    out.set(k, { nombre, via: todos.length ? "probable" : "ninguno", tecnico: todos.length ? todos[0] : null, candidatos: todos });
  });
  return out;
}

/* ------------------------------ Base de datos ------------------------------ */

async function leerTodo(tabla, cols, orden) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    let q = supabase.from(tabla).select(cols);
    if (orden) q = q.order(orden);
    const { data, error } = await q.range(start, start + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function cargarCsat() {
  const [resumen, departamentos, tecnicos, alias] = await Promise.all([
    leerTodo("csat_resumen", "mes,ambito,satisfechos,insatisfechos,total,csat,meta"),
    leerTodo("csat_departamento", "mes,departamento,satisfechos,insatisfechos,csat"),
    leerTodo("csat_tecnico", "mes,tecnico_ppt,nombre_plano,departamento,technician_id,csat,motivos"),
    leerTodo("csat_alias", "nombre_plano,technician_id"),
  ]);
  return { resumen, departamentos, tecnicos, alias };
}

async function subir(tabla, filas, onConflict) {
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await supabase.from(tabla).upsert(filas.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

// Guarda lo leído del PowerPoint. decisiones: Map llaveAlias → technician_id | null (null = sin ficha). Volver a cargar el mismo mes reemplaza esas filas (no duplica).
export async function guardarCsat({ datos, decisiones, archivo, userId }) {
  const mes1 = (k) => `${k}-01`;
  const resumen = [];
  const base = { source_file: archivo || null, loaded_by: userId || null };
  if (datos.general) resumen.push({ mes: mes1(datos.mes), ambito: "general", satisfechos: datos.general.satisfechos, insatisfechos: datos.general.insatisfechos, total: datos.general.total, csat: datos.general.csat, meta: datos.meta, ...base });
  if (datos.asc) resumen.push({ mes: mes1(datos.mes), ambito: "asc", satisfechos: datos.asc.satisfechos, insatisfechos: datos.asc.insatisfechos, total: datos.asc.total, csat: datos.asc.csat, meta: datos.meta, ...base });
  // Meses anteriores del gráfico de tendencia: solo el CSAT general (sin cantidades). No pisa un mes que ya trae sus cantidades.
  const tendencia = (datos.tendencia || []).filter((p) => p.mes !== datos.mes).map((p) => ({ mes: mes1(p.mes), ambito: "general", satisfechos: null, insatisfechos: null, total: null, csat: p.csat, meta: datos.meta, ...base }));
  const deptos = datos.departamentos.map((d) => ({ mes: mes1(datos.mes), departamento: d.departamento, satisfechos: d.satisfechos, insatisfechos: d.insatisfechos, csat: d.csat, ...base }));
  const tecnicos = datos.tecnicos.map((t) => {
    const k = llaveAlias(t.tecnico);
    return { mes: mes1(t.mes), tecnico_ppt: t.tecnico, nombre_plano: k, departamento: t.departamento, technician_id: decisiones.get(k) || null, csat: t.csat, motivos: t.motivos || null, ...base };
  });
  const alias = [...decisiones.entries()].filter(([k]) => k !== "SIN IDENTIFICAR").map(([k, id]) => ({ nombre_plano: k, technician_id: id || null, updated_by: userId || null, updated_at: new Date().toISOString() }));

  await subir("csat_alias", alias, "nombre_plano");
  // Antes de pisar la tendencia, se respetan los meses que ya tienen cantidades guardadas.
  let existentes = [];
  if (tendencia.length) { const { data } = await supabase.from("csat_resumen").select("mes,ambito,total").eq("ambito", "general"); existentes = data || []; }
  const conCantidades = new Set(existentes.filter((e) => e.total !== null && e.total !== undefined).map((e) => String(e.mes).slice(0, 7)));
  await subir("csat_resumen", [...resumen, ...tendencia.filter((p) => !conCantidades.has(p.mes.slice(0, 7)))], "mes,ambito");
  await subir("csat_departamento", deptos, "mes,departamento");
  await subir("csat_tecnico", tecnicos, "mes,nombre_plano,departamento");
  return { tecnicos: tecnicos.length, departamentos: deptos.length };
}

/* --------------------------------- Cálculo --------------------------------- */

export const nivel = (v, meta = 90) => (v === null || v === undefined ? { color: "var(--text-faint)", label: "Sin dato" } : v >= meta ? { color: "var(--green)", label: "Cumple" } : v >= meta - 10 ? { color: "#c47f12", label: "Bajo la meta" } : { color: "var(--red)", label: "Crítico" });

// Una fila por técnico: CSAT por mes (promedio simple si salió en varios departamentos), motivos y departamento de Personal.
// filasCsat: csat_tecnico; tecnicosPersonal: Personal. Devuelve [{ key, nombre, depto, ficha, porMes: { mes: { csat, motivos, deptos } }, sinFicha }]
export function armarTecnicos(filasCsat, tecnicosPersonal) {
  const porId = new Map((tecnicosPersonal || []).map((t) => [t.id, t]));
  const m = new Map();
  filasCsat.forEach((f) => {
    const mes = String(f.mes).slice(0, 7);
    const sinId = esSinIdentificar(f.tecnico_ppt);
    const key = f.technician_id ? `t:${f.technician_id}` : sinId ? `s:${plano(f.departamento)}` : `n:${f.nombre_plano}`;
    const t = f.technician_id ? porId.get(f.technician_id) : null;
    const reg = m.get(key) || { key, nombre: t ? t.name.replace(/_/g, " ") : f.tecnico_ppt, deptoPpt: f.departamento, depto: t && t.department ? t.department : f.departamento, ficha: !!t, sinIdentificar: sinId, estado: t ? t.status : null, porMes: {} };
    const c = reg.porMes[mes] || { valores: [], motivos: [], deptos: [] };
    if (f.csat !== null && f.csat !== undefined) c.valores.push(Number(f.csat));
    if (f.motivos) c.motivos.push(f.motivos);
    c.deptos.push(f.departamento);
    reg.porMes[mes] = c; m.set(key, reg);
  });
  return [...m.values()].map((r) => {
    Object.values(r.porMes).forEach((c) => { c.csat = redondear(prom(c.valores), 1); c.motivos = [...new Set(c.motivos)].join(" · "); });
    return r;
  });
}

// Por departamento de Personal y mes: promedio del CSAT de sus técnicos, cuántos tienen dato y cuántos están bajo la meta.
export function resumenPorDepto(tecnicos, meses, meta = 90) {
  const g = new Map();
  tecnicos.forEach((t) => { const k = plano(t.depto) || "SIN DEPARTAMENTO"; const r = g.get(k) || { depto: t.depto || "Sin departamento", tecnicos: [] }; r.tecnicos.push(t); g.set(k, r); });
  return [...g.values()].map((r) => {
    const porMes = {};
    meses.forEach((mes) => {
      const vals = r.tecnicos.map((t) => t.porMes[mes]).filter((c) => c && c.csat !== null && c.csat !== undefined);
      porMes[mes] = { n: vals.length, prom: redondear(prom(vals.map((c) => c.csat)), 1), bajo: vals.filter((c) => c.csat < meta).length };
    });
    return { depto: r.depto, n: r.tecnicos.length, porMes };
  }).sort((a, b) => a.depto.localeCompare(b.depto, "es"));
}
