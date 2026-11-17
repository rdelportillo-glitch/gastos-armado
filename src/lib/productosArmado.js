// Catálogo de Productos de armado para los técnicos con contrato «Producción» (solo lectura). Las funciones de la base (sql/68) deciden quién puede verlo.
import { supabase } from "./supabaseClient";

// ¿Este usuario puede ver el catálogo? (el técnico, solo si su ficha de Personal tiene contrato Producción)
export async function tecnicoVeProductos() {
  const { data, error } = await supabase.rpc("tecnico_ve_productos_armado");
  if (error) throw new Error(error.message);
  return data === true;
}

export async function productosParaTecnico() {
  const { data, error } = await supabase.rpc("tecnico_productos_armado");
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({ code: r.code, name: r.name, line: r.line || "", subline: r.subline || "", minutes: r.minutes, persons: r.persons, individual: r.price_single, pareja: r.price_pair }));
}
