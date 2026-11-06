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

// Devuelve { n, movidas } con los armados enviados (y cuántos ya estaban con otra fecha y pasaron a la de cierre), o { omitido: true } si la solicitud ya está en el histórico por la Asignación diaria (para no contarla dos veces).
export async function enviarAlHistorico({ request, assemblies, warehouse, session }) {
  if (!warehouse) throw new Error("No encuentro el almacén de la solicitud.");
  const info = await loadRegionInfo();
  const filas = filasHistorico({ request, assemblies, warehouse, userId: session.id, regionDe: (d) => (d ? (info.byDept[plano(d)] ?? null) : null) });
  if (!filas.length) return { n: 0 };
  // Si las unidades de esta solicitud ya pasaron por la Asignación y el cierre del día, ya están en el histórico con su número de servicio (AA-000001, AA-000001-L1...).
  const propios = new Set(filas.map((f) => f.service_id));
  const { data, error } = await supabase.from("assignment_history").select("service_id").like("servicio", `${request.request_no}%`).limit(200);
  if (error) throw new Error(error.message);
  if ((data || []).some((x) => !propios.has(x.service_id))) return { omitido: true };
  // Filas ya enviadas con otra fecha: se les cambia el día al del cierre (si ya existe la del día de cierre, esa se actualiza abajo y no se toca la otra).
  let movidas = 0;
  const ids = filas.map((f) => f.service_id), diaPorId = new Map(filas.map((f) => [f.service_id, f.day]));
  for (let i = 0; i < ids.length; i += 100) {
    const { data: ex, error: e2 } = await supabase.from("assignment_history").select("id,day,service_id").in("service_id", ids.slice(i, i + 100));
    if (e2) throw new Error(e2.message);
    const filasEx = ex || [];
    for (const x of filasEx) {
      const destino = diaPorId.get(x.service_id);
      if (!destino || x.day === destino || filasEx.some((y) => y.service_id === x.service_id && y.day === destino)) continue;
      const { error: e3 } = await supabase.from("assignment_history").update({ day: destino }).eq("id", x.id);
      if (e3) throw new Error(e3.message);
      movidas++;
    }
  }
  await saveSnapshot(filas);
  return { n: filas.length, movidas };
}
