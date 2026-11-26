// Al cerrar una solicitud de armado en almacén (PQR), sus armados viajan al Histórico de asignación con la fecha en que se CERRÓ el PQR (closed_at),
// no con la de registro del armado. Una fila por registro de armado (producto, cantidad, técnico), con el almacén como ubicación y el número de PQR como servicio.
// Es idempotente: la fila usa el id del armado como service_id y el histórico es único por (día, service_id), así que cerrar, reabrir y volver a cerrar
// (o pulsar "Enviar al histórico") no duplica nada. Si las filas ya estaban en el histórico con otra fecha (la de registro, como se hacía antes, o la de un cierre anterior),
// al volver a enviarlas pasan a la fecha de cierre actual (se les cambia el día; no se borra nada).
import { supabase } from "../supabaseClient";
import { saveSnapshot, loadRegionInfo } from "../asignacion/history";
import { ddmmyyyy } from "../asignacion/outputs";
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

// Fecha en que se armaron los productos de las filas de armados en almacén del histórico. El día de la fila es el del CIERRE del PQR.
//  · filas que entraron al cerrar el PQR: service_id = id del armado → assembled_on;
//  · filas que llegaron por la Asignación diaria (servicio AA-…, realizadas): el armado de la misma solicitud y producto.
// Las demás filas no están en el mapa (su fecha de armado es el día de la fila). Si no se puede leer, se devuelve vacío y el CSV usa el día de la fila.
export async function fechasDeArmado(rows) {
  const ids = [...new Set((rows || []).filter((r) => r.tipo === "Armado en almacén" && r.service_id).map((r) => r.service_id))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("store_assemblies").select("id,assembled_on").in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    (data || []).forEach((a) => { if (a.assembled_on) out.set(a.id, a.assembled_on); });
  }
  const deAsignacion = (rows || []).filter((r) => r.tipo !== "Armado en almacén" && r.service_id && r.resultado === "Realizado" && solicitudDeServicio(r.servicio));
  if (!deAsignacion.length) return out;
  const nos = [...new Set(deAsignacion.map((r) => solicitudDeServicio(r.servicio)))];
  const solicitudes = [], armados = [];
  for (let i = 0; i < nos.length; i += 100) {
    const { data, error } = await supabase.from("store_requests").select("id,request_no").in("request_no", nos.slice(i, i + 100));
    if (error) throw new Error(error.message);
    solicitudes.push(...(data || []));
  }
  for (let i = 0; i < solicitudes.length; i += 50) {
    const { data, error } = await supabase.from("store_assemblies").select("request_id,product_code,assembled_on,voided").in("request_id", solicitudes.slice(i, i + 50).map((s) => s.id));
    if (error) throw new Error(error.message);
    armados.push(...(data || []).filter((a) => !a.voided && a.assembled_on));
  }
  const idDe = new Map(solicitudes.map((s) => [String(s.request_no).toUpperCase(), s.id]));
  deAsignacion.forEach((r) => {
    const rid = idDe.get(solicitudDeServicio(r.servicio));
    const fechas = armados.filter((a) => a.request_id === rid && String(a.product_code) === String(r.codigo)).map((a) => a.assembled_on).sort();
    if (fechas.length) out.set(r.service_id, fechas[fechas.length - 1]);
  });
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

// Filas que llegaron al histórico por la Asignación diaria (servicio AA-000071, AA-000071-L2...): las REALIZADAS pasan también a la fecha del último cierre del PQR
// (el día y la columna FECHA guardada del CSV). Los intentos no realizados se quedan en su día. diaDe: Map número de solicitud → día de cierre. Devuelve cuántas cambiaron.
async function redatarAsignacion(filas, diaDe) {
  const col = CSV_CARGA_HEADERS.indexOf("FECHA");
  let movidas = 0;
  for (const x of filas) {
    const destino = diaDe.get(solicitudDeServicio(x.servicio));
    if (!destino || x.resultado !== "Realizado") continue;
    // El histórico es único por día y servicio: si ese servicio ya tiene fila en el día de cierre, no se mueve otra encima.
    if (x.day !== destino && filas.some((y) => y.id !== x.id && y.service_id === x.service_id && y.day === destino)) continue;
    const fecha = ddmmyyyy(destino);
    const csv = Array.isArray(x.fila_csv) && x.fila_csv[col] !== fecha ? x.fila_csv.map((v, i) => (i === col ? fecha : v)) : null;
    if (x.day === destino && !csv) continue;
    const { error } = await supabase.from("assignment_history").update(csv ? { day: destino, fila_csv: csv } : { day: destino }).eq("id", x.id);
    if (error) throw new Error(error.message);
    x.day = destino;
    movidas++;
  }
  return movidas;
}
const COLUMNAS_ASIGNACION = "id,day,service_id,servicio,codigo,resultado,fila_csv";

// Corrección masiva: para las solicitudes cerradas, pasa a la fecha de cierre los registros que YA estaban en el histórico con otra fecha (los armados y los que llegaron por la Asignación diaria).
// No envía lo que nunca se envió ni borra nada. Devuelve { solicitudes, armados, movidas, movidasAsignacion, yaOk, conflictos, sinEnviar }.
export async function corregirFechasHistorico({ requests, assemblies }) {
  const diaPorId = new Map();
  const solicitudDe = new Map();
  (requests || []).filter((r) => r.status === "Cerrada" && r.closed_at).forEach((r) => {
    const dia = diaLocal(r.closed_at);
    activos(assemblies, r.id).forEach((a) => { diaPorId.set(a.id, dia); solicitudDe.set(a.id, r.id); });
  });
  const res = await redatar(diaPorId);
  const sinEnviar = [...diaPorId.keys()].filter((id) => !res.encontrados.has(id)).length;
  const diaDe = new Map((requests || []).filter((r) => r.status === "Cerrada" && r.closed_at && r.request_no).map((r) => [r.request_no.toUpperCase(), diaLocal(r.closed_at)]));
  const deAsignacion = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from("assignment_history").select(COLUMNAS_ASIGNACION).like("servicio", "AA-%").eq("anulado", false).order("id").range(start, start + 999);
    if (error) throw new Error(error.message);
    deAsignacion.push(...(data || []).filter((x) => !diaPorId.has(x.service_id)));
    if (!data || data.length < 1000) break;
  }
  const movidasAsignacion = await redatarAsignacion(deAsignacion, diaDe);
  return { solicitudes: new Set(solicitudDe.values()).size, armados: diaPorId.size, movidas: res.movidas, movidasAsignacion, yaOk: res.yaOk, conflictos: res.conflictos, sinEnviar };
}

// Devuelve { n, movidas, movidasAsignacion, dia } con los armados enviados (cuántos ya estaban con otra fecha y pasaron a la de cierre, y cuántos de la Asignación diaria cambiaron de fecha),
// o { omitido: true, movidasAsignacion, dia } si la solicitud completa ya está en el histórico por la Asignación diaria (para no contarla dos veces).
export async function enviarAlHistorico({ request, assemblies, warehouse, session }) {
  if (!warehouse) throw new Error("No encuentro el almacén de la solicitud.");
  const info = await loadRegionInfo();
  const filas = filasHistorico({ request, assemblies, warehouse, userId: session.id, regionDe: (d) => (d ? (info.byDept[plano(d)] ?? null) : null) });
  if (!filas.length) return { n: 0 };
  // Si las unidades de esta solicitud ya pasaron por la Asignación y el cierre del día, ya están en el histórico con su número de servicio (AA-000001, AA-000001-L1...).
  const propios = new Set(filas.map((f) => f.service_id));
  const { data, error } = await supabase.from("assignment_history").select(COLUMNAS_ASIGNACION).like("servicio", `${request.request_no}%`).eq("anulado", false).limit(500); // las filas anuladas de la Asignación no cuentan: el armado debe poder entrar al cerrar el PQR
  if (error) throw new Error(error.message);
  // Lo que ya pasó por la Asignación se omite POR PRODUCTO: si a la solicitud se le agregó un producto después (la lista pasó de 2 a 3 productos), ese producto no estaba en la Asignación y sí debe entrar.
  const deAsignacion = (data || []).filter((x) => !propios.has(x.service_id));
  const cubiertos = new Set(deAsignacion.map((x) => String(x.codigo || "")).filter(Boolean));
  const porEnviar = deAsignacion.length ? filas.filter((f) => !cubiertos.has(String(f.codigo || ""))) : filas;
  // Todo el PQR queda con la fecha del último cierre: también lo que llegó por la Asignación diaria (si se reabre y se vuelve a cerrar, la fecha nueva reemplaza a la anterior).
  const cierre = diaLocal(request.closed_at);
  const movidasAsignacion = cierre ? await redatarAsignacion(deAsignacion, new Map([[String(request.request_no).toUpperCase(), cierre]])) : 0;
  if (deAsignacion.length && !porEnviar.length) return { omitido: true, movidasAsignacion, dia: cierre };
  // Filas ya enviadas con otra fecha: se les cambia el día al del cierre (si ya existe la del día de cierre, esa se actualiza abajo y no se toca la otra).
  const { movidas } = await redatar(new Map(porEnviar.map((f) => [f.service_id, f.day])));
  await saveSnapshot(porEnviar);
  // dia y productos: para decirle al usuario qué entró y con qué fecha buscarlo en el Histórico.
  return { n: porEnviar.length, movidas, movidasAsignacion, yaEnAsignacion: filas.length - porEnviar.length, dia: porEnviar[0].day, productos: porEnviar.map((f) => [f.codigo, f.producto].filter(Boolean).join(" ")) };
}
