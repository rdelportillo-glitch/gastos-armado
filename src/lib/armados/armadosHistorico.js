// Al cerrar una solicitud de armado en almacén (PQR), sus armados viajan al Histórico de asignación con la fecha en que se registraron (assembled_on),
// no con la del cierre. Una fila por registro de armado (producto, cantidad, técnico), con el almacén como ubicación y el número de PQR como servicio.
// Es idempotente: la fila usa el id del armado como service_id y el histórico es único por (día, service_id), así que cerrar, reabrir y volver a cerrar
// (o pulsar "Enviar al histórico") no duplica nada.
import { supabase } from "../supabaseClient";
import { saveSnapshot, loadRegionInfo } from "../asignacion/history";
import { activos, suma } from "./armadosData";

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

export function filasHistorico({ request: r, assemblies, warehouse: w, regionDe, userId }) {
  const servicio = String(r.pqr_number || "").trim() || r.request_no;
  const almacen = w || {};
  return activos(assemblies, r.id).map((a) => {
    const hecho = suma(a); // las causales negativas (no quedó armado) no suman, pero también viajan al histórico como No realizado
    return {
      day: a.assembled_on, service_id: a.id, servicio, codigo: a.product_code || null, producto: a.product_name || null, quantity: a.quantity, tiempo_min: null,
      technician_id: a.technician_id || null, technician_name: a.technician_name || null, helper_name: null,
      region: regionDe(almacen.department), departamento: almacen.department || null, ciudad: almacen.city || null, barrio: almacen.neighborhood || null,
      direccion: almacen.address || almacen.name || null, cliente: almacen.name || r.client || null, zona: null, ruta_orden: null, prioridad: null, tipo: "Armado en almacén",
      resultado: hecho ? "Realizado" : "No realizado", estado_extreme: hecho ? "Realizado" : "No realizado", causal_extreme: null, causal_auditada: a.cause || null, diagnostico: null,
      armado: hecho ? "SI" : "NO", notas: a.notes || null, finalized_by: userId,
    };
  });
}

// Devuelve { n } con los armados enviados, o { omitido: true } si la solicitud ya está en el histórico por la Asignación diaria (para no contarla dos veces).
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
  await saveSnapshot(filas);
  return { n: filas.length };
}
