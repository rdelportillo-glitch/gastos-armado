// Al cerrar una solicitud de armado en almacén (PQR), sus armados viajan al Histórico de asignación con la fecha en que se CERRÓ el PQR (closed_at),
// no con la de registro del armado. Una fila por registro de armado (producto, cantidad, técnico), con el almacén como ubicación y el número de PQR como servicio.
// Es idempotente: la fila usa el id del armado como service_id y el histórico es único por (día, service_id), así que cerrar, reabrir y volver a cerrar
// (o pulsar "Enviar al histórico") no duplica nada. Si las filas ya estaban en el histórico con otra fecha (la de registro, como se hacía antes, o la de un cierre anterior),
// al volver a enviarlas pasan a la fecha de cierre actual (se les cambia el día; no se borra nada).
import { supabase } from "../supabaseClient";
import { saveSnapshot, loadRegionInfo } from "../asignacion/history";
import { activos, suma, updateAssembly } from "./armadosData";
import { CSV_CARGA_HEADERS } from "../asignacion/csvCarga";

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
      technician_id: a.technician_id || null, technician_name: a.technician_name || null, helper_name: a.helper_name || null,
      region: regionDe(almacen.department), departamento: almacen.department || null, ciudad: almacen.city || null, barrio: almacen.neighborhood || null,
      direccion: almacen.address || almacen.name || null, cliente: almacen.name || r.client || null, zona: null, ruta_orden: null, prioridad: null, tipo: "Armado en almacén",
      resultado: hecho ? "Realizado" : "No realizado", estado_extreme: hecho ? "Realizado" : "No realizado", causal_extreme: null, causal_auditada: a.cause || null, diagnostico: null,
      armado: hecho ? "SI" : "NO", notas: a.notes || null, finalized_by: userId,
    };
  });
}

// Agrega, cambia o quita el APOYO de un armado ya registrado (también en solicitudes cerradas) y lo lleva al Histórico si el armado ya está allí:
//  · las filas que entraron al cerrar el PQR (service_id = id del armado);
//  · si no tiene (ese producto pasó por la Asignación diaria), las filas de la solicitud con el mismo producto y técnico que no tengan otro apoyo.
// apoyo: { id, name, extremeUser } o null para quitarlo. Devuelve cuántas filas del histórico cambiaron.
export async function cambiarApoyo({ assembly: a, apoyo, requestNo }) {
  const guardado = await updateAssembly(a.id, { helper_id: apoyo ? apoyo.id : null });
  const nombre = apoyo ? (guardado && guardado.helper_name) || apoyo.name : null;
  const leer = async (q) => { const { data, error } = await q; if (error) throw new Error(error.message); return data || []; };
  let filas = await leer(supabase.from("assignment_history").select("*").eq("service_id", a.id));
  if (!filas.length && requestNo) {
    const antes = plano(a.helper_name);
    filas = (await leer(supabase.from("assignment_history").select("*").like("servicio", `${requestNo}%`).eq("anulado", false).limit(200)))
      .filter((h) => String(h.codigo || "") === String(a.product_code || "") && plano(h.technician_name) === plano(a.technician_name) && (!h.helper_name || plano(h.helper_name) === antes));
  }
  for (const h of filas) {
    const patch = { helper_name: nombre };
    if (Array.isArray(h.fila_csv)) { // la fila guardada del CSV: solo las columnas del apoyo
      const f = [...h.fila_csv];
      const poner = (col, v) => { const i = CSV_CARGA_HEADERS.indexOf(col); if (i >= 0) f[i] = v || ""; };
      poner("APOYO", nombre); poner("USUARIO2", apoyo ? apoyo.extremeUser : "");
      patch.fila_csv = f;
    }
    const { error } = await supabase.from("assignment_history").update(patch).eq("id", h.id);
    if (error) throw new Error(`El apoyo quedó en el armado, pero no se pudo actualizar el histórico: ${error.message}`);
  }
  return { historico: filas.length };
}

// Número de PQR de cada solicitud (AA-000066 → 267851315). Las filas que salieron de la Asignación diaria llevan el código de la solicitud como servicio, no el PQR:
// con este mapa el buscador del Histórico también las encuentra por número de PQR. Si no se puede leer, devuelve vacío.
export async function pqrPorSolicitud() {
  const out = new Map();
  try {
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from("store_requests").select("request_no,pqr_number").range(start, start + 999);
      if (error) break;
      (data || []).forEach((x) => { if (x.request_no && x.pqr_number) out.set(String(x.request_no).toUpperCase(), String(x.pqr_number).trim()); });
      if (!data || data.length < 1000) break;
    }
  } catch (e) { /* sin permiso o sin tabla: el buscador sigue funcionando por servicio */ }
  return out;
}
// Código de solicitud de un servicio de armados en almacén: "AA-000066-L1" → "AA-000066".
export const solicitudDeServicio = (servicio) => { const m = String(servicio || "").toUpperCase().match(/^AA-\d+/); return m ? m[0] : ""; };

// Fecha en que se armaron los productos de las filas de armados en almacén del histórico (service_id = id del armado → assembled_on). El día de la fila es el del CIERRE del PQR.
// Las demás filas no están en el mapa (su fecha de armado es el día de la fila). Si no se puede leer, se devuelve vacío y el CSV usa el día de la fila.
export async function fechasDeArmado(rows) {
  const ids = [...new Set((rows || []).filter((r) => r.tipo === "Armado en almacén" && r.service_id).map((r) => r.service_id))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("store_assemblies").select("id,assembled_on").in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    (data || []).forEach((a) => { if (a.assembled_on) out.set(a.id, a.assembled_on); });
  }
  return out;
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
  const { data, error } = await supabase.from("assignment_history").select("service_id,codigo").like("servicio", `${request.request_no}%`).eq("anulado", false).limit(200); // las filas anuladas de la Asignación no cuentan: el armado debe poder entrar al cerrar el PQR
  if (error) throw new Error(error.message);
  // Lo que ya pasó por la Asignación se omite POR PRODUCTO: si a la solicitud se le agregó un producto después (la lista pasó de 2 a 3 productos), ese producto no estaba en la Asignación y sí debe entrar.
  const deAsignacion = (data || []).filter((x) => !propios.has(x.service_id));
  const cubiertos = new Set(deAsignacion.map((x) => String(x.codigo || "")).filter(Boolean));
  const porEnviar = deAsignacion.length ? filas.filter((f) => !cubiertos.has(String(f.codigo || ""))) : filas;
  if (deAsignacion.length && !porEnviar.length) return { omitido: true };
  // Filas ya enviadas con otra fecha: se les cambia el día al del cierre (si ya existe la del día de cierre, esa se actualiza abajo y no se toca la otra).
  const { movidas } = await redatar(new Map(porEnviar.map((f) => [f.service_id, f.day])));
  await saveSnapshot(porEnviar);
  // dia y productos: para decirle al usuario qué entró y con qué fecha buscarlo en el Histórico.
  return { n: porEnviar.length, movidas, yaEnAsignacion: filas.length - porEnviar.length, dia: porEnviar[0].day, productos: porEnviar.map((f) => [f.codigo, f.producto].filter(Boolean).join(" ")) };
}
