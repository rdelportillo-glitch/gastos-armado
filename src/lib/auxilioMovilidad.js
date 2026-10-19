// Auxilio de movilidad por pico y placa: valor a pagar por día según el departamento donde se trabajó y el tipo de contrato del técnico.
// Se guarda para todo el equipo en assignment_settings (clave "auxilio_movilidad"): { matriz: { DEPARTAMENTO: { CONTRATO: valor } } }
// con llaves sin tildes y en mayúsculas (ANTIOQUIA → { BIVER, PRODUCCION, TEMPORAL }).
import { supabase } from "./supabaseClient";

export const CONTRATOS = ["Biver", "Producción", "Temporal"];

export const plano = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();

// Valores de partida (los definió el negocio): Antioquia 30.000 para Biver y Temporal y 70.000 por producción; Bolívar 30.000 y
// Santander 50.000 para todos los contratos. Atlántico queda por definir.
export const AUXILIO_DEFAULT = {
  matriz: {
    ANTIOQUIA: { BIVER: 30000, PRODUCCION: 70000, TEMPORAL: 30000 },
    BOLIVAR: { BIVER: 30000, PRODUCCION: 30000, TEMPORAL: 30000 },
    SANTANDER: { BIVER: 50000, PRODUCCION: 50000, TEMPORAL: 50000 },
    ATLANTICO: {},
  },
  // Ciudades con pico y placa por departamento. modo "solo": únicamente esas ciudades; modo "todas_menos": todas las ciudades del
  // departamento menos esas (Atlántico: Barranquilla no tiene, el resto de municipios sí).
  pyp: {
    ANTIOQUIA: { modo: "solo", ciudades: ["Medellín"] },
    ATLANTICO: { modo: "todas_menos", ciudades: ["Barranquilla"] },
    BOLIVAR: { modo: "solo", ciudades: ["Cartagena de Indias", "Cartagena"] },
    SANTANDER: { modo: "solo", ciudades: ["Bucaramanga"] },
  },
};

// ¿Esa ciudad tiene pico y placa según la configuración? null si el departamento no está configurado (el llamador decide el respaldo).
export function ciudadConPyP(cfg, depto, ciudad) {
  const r = cfg && cfg.pyp && cfg.pyp[plano(depto)];
  if (!r) return null;
  const esta = (r.ciudades || []).map(plano).includes(plano(ciudad));
  return r.modo === "todas_menos" ? !esta : esta;
}

export async function loadAuxilio() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", "auxilio_movilidad").maybeSingle();
  if (error) throw new Error(error.message);
  const v = data && data.value;
  return v && v.matriz ? { ...AUXILIO_DEFAULT, ...v } : AUXILIO_DEFAULT;
}

export async function saveAuxilio(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: "auxilio_movilidad", value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

// Valor del auxilio para un departamento y un tipo de contrato; null si no está configurado.
export function valorAuxilio(cfg, depto, contrato) {
  const fila = (cfg && cfg.matriz && cfg.matriz[plano(depto)]) || null;
  if (!fila) return null;
  const v = fila[plano(contrato)];
  return v === undefined || v === null || v === "" ? null : Number(v);
}
