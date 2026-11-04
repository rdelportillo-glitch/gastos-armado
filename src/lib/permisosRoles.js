// Acceso por rol a las categorías y módulos del menú (Maestros → Permisos por rol). Se guarda para todo el equipo en assignment_settings (clave "permisos_roles"):
// { roles: { operador: { carga: false, pagos: true }, ... } } con solo lo que difiere del valor por defecto de cada módulo (NAV_ITEMS). El administrador siempre tiene todo.
// Es una restricción de lo que se ve y se abre en la plataforma; la seguridad de los datos sigue en la base de datos (políticas por rol).
import { supabase } from "./supabaseClient";

const KEY = "permisos_roles";
export const ROLES_CONFIGURABLES = ["operador", "consulta", "cliente", "tecnico"];
export const ROL_NOMBRE = { admin: "Administrador", operador: "Operador", consulta: "Consulta", cliente: "Cliente (Jamar)", tecnico: "Técnico" };

export async function loadPermisos() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = data && data.value;
  return v && v.roles ? v : { roles: {} };
}
export async function savePermisos(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// ¿El rol puede ver ese módulo? item: { key, roles } de NAV_ITEMS. Los módulos solo de administrador no se pueden abrir a otros roles.
export function tieneAcceso(cfg, rol, item) {
  if (rol === "admin") return true;
  const soloAdmin = item.roles.length === 1 && item.roles[0] === "admin";
  if (soloAdmin) return false;
  const o = cfg && cfg.roles && cfg.roles[rol];
  if (o && typeof o[item.key] === "boolean") return o[item.key];
  return item.roles.includes(rol);
}
