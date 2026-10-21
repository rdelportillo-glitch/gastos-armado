// Procesos disciplinarios: casos (disciplinary_cases), bitácora de movimientos (disciplinary_events) y documentos (bucket privado
// "procesos-disciplinarios"). Los casos no se borran y la bitácora no se edita: queda el historial completo.
import { supabase } from "../supabaseClient";

export const ESTADOS = [
  { key: "Abierto", color: "amber", desc: "Caso recién abierto, en recolección de información." },
  { key: "Citado a descargos", color: "blue", desc: "Se citó a la persona a descargos." },
  { key: "En seguimiento", color: "blue", desc: "En investigación o seguimiento." },
  { key: "Pendiente de decisión", color: "amber", desc: "Falta la decisión final." },
  { key: "Decisión aplicada", color: "red", desc: "Ya hay decisión (sanción o sin sanción) y se notificó." },
  { key: "Cerrado", color: "green", desc: "Caso terminado." },
  { key: "Archivado", color: "gray", desc: "Archivado sin continuar (sin mérito, desistido...)." },
];
export const ESTADOS_ABIERTOS = ["Abierto", "Citado a descargos", "En seguimiento", "Pendiente de decisión"];
export const colorEstado = (e) => (ESTADOS.find((x) => x.key === e) || {}).color || "gray";

export const TIPOS_FALTA = [
  "Incumplimiento de horario o ruta", "Trato inadecuado al cliente", "Mal uso de herramientas o activos", "Incumplimiento de normas de seguridad (EPP)",
  "Diligenciamiento o reporte incorrecto", "Ausencia injustificada", "Conducta indebida", "Otro",
];
export const DECISIONES = ["Sin sanción", "Llamado de atención verbal", "Llamado de atención escrito", "Suspensión", "Terminación del contrato", "Otra"];
export const TIPOS_MOVIMIENTO = ["Nota de seguimiento", "Citación a descargos", "Descargos", "Decisión", "Notificación", "Documento", "Otro"];

export const MAX_ARCHIVO = 15 * 1024 * 1024;
const ARCHIVO_RE = /\.(pdf|jpe?g|png|webp|heic|docx?|xlsx?|txt)$/i;

export async function listCases() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("disciplinary_cases").select("*").order("created_at", { ascending: false }).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function listEvents(caseId) {
  const { data, error } = await supabase.from("disciplinary_events").select("*").eq("case_id", caseId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createCase(row) {
  const { data, error } = await supabase.from("disciplinary_cases").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateCase(id, patch) {
  const { data, error } = await supabase.from("disciplinary_cases").update(patch).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function addEvent(row) {
  const { data, error } = await supabase.from("disciplinary_events").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// Sube un documento a la carpeta del caso; devuelve { path, name, size }.
export async function uploadDoc(caseNo, file) {
  if (!ARCHIVO_RE.test(file.name)) throw new Error(`${file.name}: formato no permitido (PDF, imagen, Word, Excel o texto).`);
  if (file.size > MAX_ARCHIVO) throw new Error(`${file.name}: pesa más de 15 MB.`);
  const seguro = file.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^\w.\-]+/g, "_");
  const path = `${caseNo}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${seguro}`;
  const { error } = await supabase.storage.from("procesos-disciplinarios").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error(`${file.name}: ${error.message}`);
  return { path, name: file.name, size: file.size };
}

export async function docUrl(path) {
  const { data, error } = await supabase.storage.from("procesos-disciplinarios").createSignedUrl(path, 600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export const diasEntre = (desdeISO, hastaISO) => Math.max(0, Math.round((new Date(`${hastaISO}T12:00:00`) - new Date(`${desdeISO}T12:00:00`)) / 864e5));
