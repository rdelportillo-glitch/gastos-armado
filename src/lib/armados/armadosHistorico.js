// Al cerrar una solicitud de armado en almacén (PQR), sus armados viajan al Histórico de asignación con la fecha en que se CERRÓ el PQR (closed_at),
// no con la de registro del armado. Una fila por registro de armado (producto, cantidad, técnico), con el almacén como ubicación y el número de PQR como servicio.
// Es idempotente: la fila usa el id del armado como service_id y el histórico es único por (día, service_id), así que cerrar, reabrir y volver a cerrar
// (o pulsar "Enviar al histórico") no duplica nada. Si las filas ya estaban en el histórico con otra fecha (la de registro, como se hacía antes, o la de un cierre anterior),
// al volver a enviarlas pasan a la fecha de cierre actual (se les cambia el día; no se borra nada).
import { supabase } from "../supabaseClient";
import { saveSnapshot, loadRegionInfo } from "../asignacion/history";
import { activos, suma } from "./armadosData";

// Día (AAAA-MM-DD) en hora local de un instante ISO, p. ej. el closed_at de la solicitud.
export function diaLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 10);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

export function filasHistorico({ request: r, assemblies, warehouse: w, regionDe, userId }) {
  const dia = diaLocal(r.closed_at); // fecha de cierre del PQR; si no la hay, la del registro del armado
  const servicio = String(r.pqr_number || "").trim() || r.request_no;
  const almacen = w || {};
  return activos(assemblies, r.id).map((a) => {
    const hecho = suma(a); // las causales negativas (no quedó armado) no suman, pero también viajan al histórico como No realizado
    return {
      day: dia || a.assembled_on, service_id: a.id, servicio, codigo: a.product_code || null, producto: a.product_name || null, quantity: a.quantity, tiempo_min: null,
      technician_id: a.technician_id || null, technician_name: a.technician_name || null, helper_name: null,
      region: regionDe(almacen.department), departamento: almacen.department || null, ciudad: almacen.city || null, barrio: almacen.neighborhood || null,
      direccion: almacen.address || almacen.name || null, cliente: almacen.name || r.client || null, zona: null, ruta_orden: null, prioridad: null, tipo: "Armado en almacén",
      resultado: hecho ? "Realizado" : "No realizado", estado_extreme: hecho ? "Realizado" : "No realizado", causal_extreme: null, causal_auditada: a.cause || null, diagnostico: null,
      armado: hecho ? "SI" : "NO", notas: a.notes || null, finalized_by: userId,
    };
  });
}

// Cambia el día de las filas que ya están en el histórico al día destino de cada armado. diaPorId: Map service_id (id del armado) → día destino.
// No agrega ni borra filas: solo les cambia el día. Si un armado ya tiene una fila en el día destino, no se mueve otra (el histórico es único por día y servicio).
// Devuelve { movidas, yaOk, conflictos, encontrados } (encontrados: los service_id que tenían alguna fila en el histórico).
async function redatar(diaPorId) {
  const ids = [...diaPorId.keys()];
  const encontrados = new Set();
  const porDestino = new Map(); // día destino → ids de fila a mover
  let yaOk = 0, conflictos = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("assignment_history").select("id,day,service_id").in("service_id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    const ex = data || [];
    const moviendo = new Set();
    ex.forEach((x) => encontrados.add(x.service_id));
    for (const x of ex) {
      const destino = diaPorId.get(x.service_id);
      if (!destino) continue;
      if (x.day === destino) { yaOk++; continue; }
      if (moviendo.has(x.service_id) || ex.some((y) => y.service_id === x.service_id && y.day === destino)) { conflictos++; continue; }
      moviendo.add(x.service_id);
      porDestino.set(destino, [...(porDestino.get(destino) || []), x.id]);
    }
  }
  let movidas = 0;
  for (const [destino, lista] of porDestino) {
    for (let i = 0; i < lista.length; i += 100) {
      const trozo = lista.slice(i, i + 100);
      const { error } = await supabase.from("assignment_history").update({ day: destino }).in("id", trozo);
      if (error) throw new Error(error.message);
      movidas += trozo.length;
    }
  }
  return { movidas, yaOk, conflictos, encontrados };
}

// Corrección masiva: para las solicitudes cerradas, pasa a la fecha de cierre los armados que YA estaban en el histórico con otra fecha (la de registro).
// No envía lo que nunca se envió ni borra nada. Devuelve { solicitudes, armados, movidas, yaOk, conflictos, sinEnviar }.
export async function corregirFechasHistorico({ requests, assemblies }) {
  const diaPorId = new Map();
  const solicitudDe = new Map();
  (requests || []).filter((r) => r.status === "Cerrada" && r.closed_at).forEach((r) => {
    const dia = diaLocal(r.closed_at);
    activos(assemblies, r.id).forEach((a) => { diaPorId.set(a.id, dia); solicitudDe.set(a.id, r.id); });
  });
  const res = await redatar(diaPorId);
  const sinEnviar = [...diaPorId.keys()].filter((id) => !res.encontrados.has(id)).length;
  return { solicitudes: new Set(solicitudDe.values()).size, armados: diaPorId.size, movidas: res.movidas, yaOk: res.yaOk, conflictos: res.conflictos, sinEnviar };
}

// Devuelve { n, movidas } con los armados enviados (y cuántos ya estaban con otra fecha y pasaron a la de cierre), o { omitido: true } si la solicitud ya está en el histórico por la Asignación diaria (para no contarla dos veces).
export async function enviarAlHistorico({ request, assemblies, warehouse, session }) {
  if (!warehouse) throw new Error("No encuentro el almacén de la solicitud.");
  const info = await loadRegionInfo();
  const filas = filasHistorico({ request, assemblies, warehouse, userId: session.id, regionDe: (d) => (d ? (info.byDept[plano(d)] ?? null) : null) });
  if (!filas.length) return { n: 0 };
  // Si las unidades de esta solicitud ya pasaron por la Asignación y el cierre del día, ya están en el histórico con su número de servicio (AA-000001, AA-000001-L1...).
  const propios = new Set(filas.map((f) => f.service_id));
  const { data, error } = await supabase.from("assignment_history").select("service_id").like("servicio", `${request.request_no}%`).eq("anulado", false).limit(200); // las filas anuladas de la Asignación no cuentan: el armado debe poder entrar al cerrar el PQR
  if (error) throw new Error(error.message);
  if ((data || []).some((x) => !propios.has(x.service_id))) return { omitido: true };
  // Filas ya enviadas con otra fecha: se les cambia el día al del cierre (si ya existe la del día de cierre, esa se actualiza abajo y no se toca la otra).
  const { movidas } = await redatar(new Map(filas.map((f) => [f.service_id, f.day])));
  await saveSnapshot(filas);
  return { n: filas.length, movidas };
}
