// Coordinadores responsables por departamento (Maestros → Coordinadores). Se guarda para todo el equipo en
// assignment_settings (clave "coordinadores"):
//   { coordinadores: [{ id, nombre, activo }], asignaciones: [{ depto, coordinadorId }] }
// El campo "Coordinador" de Personal se llena solo con esta tabla (es de solo lectura allá).
import { supabase } from "./supabaseClient";

export const COORDINADORES_DEFAULT = {
  coordinadores: [{ id: "coord-paola-valencia", nombre: "PAOLA VALENCIA", activo: true }, { id: "coord-victor-orozco", nombre: "VICTOR OROZCO", activo: true }],
  asignaciones: [],
};

// Llave de comparación: sin tildes, mayúsculas y sin espacios repetidos ("Atlántico" = "ATLANTICO").
export const llaveDepto = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();

export async function loadCoordinadores() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", "coordinadores").maybeSingle();
  if (error) throw new Error(error.message);
  const v = data && data.value;
  return { guardado: !!v, cfg: { ...COORDINADORES_DEFAULT, ...(v || {}) } };
}

export async function saveCoordinadores(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: "coordinadores", value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// Nombre del coordinador de un departamento, o null si no tiene (o el coordinador ya no existe).
export function coordinadorDe(cfg, depto) {
  if (!cfg) return null;
  const a = (cfg.asignaciones || []).find((x) => llaveDepto(x.depto) === llaveDepto(depto));
  const c = a && (cfg.coordinadores || []).find((x) => x.id === a.coordinadorId);
  return c ? c.nombre : null;
}

// Llena el coordinador de cada persona de campo según su departamento. Solo toca a quien tiene el departamento
// configurado: el resto conserva lo que tenga. Devuelve la lista nueva y cuántas personas cambiaron.
export function aplicarCoordinadores(technicians, cfg) {
  let cambios = 0;
  const list = (technicians || []).map((t) => {
    if ((t.category || "Técnico de campo") === "Administrativo") return t;
    const c = coordinadorDe(cfg, t.department);
    if (!c || (t.coordinator || "") === c) return t;
    cambios++;
    return { ...t, coordinator: c };
  });
  return { technicians: list, cambios };
}

// Sugerencia inicial a partir de Personal: el coordinador más repetido en cada departamento, si coincide con uno de la lista.
export function sugerirAsignaciones(technicians, cfg) {
  const porDepto = new Map();
  (technicians || []).forEach((t) => {
    if (!t.department || !t.coordinator || (t.category || "Técnico de campo") === "Administrativo") return;
    const c = (cfg.coordinadores || []).find((x) => llaveDepto(x.nombre) === llaveDepto(t.coordinator));
    if (!c) return;
    const k = llaveDepto(t.department);
    const e = porDepto.get(k) || { depto: t.department, cuenta: new Map() };
    e.cuenta.set(c.id, (e.cuenta.get(c.id) || 0) + 1);
    porDepto.set(k, e);
  });
  return [...porDepto.values()].map((e) => ({ depto: e.depto, coordinadorId: [...e.cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0] }));
}
