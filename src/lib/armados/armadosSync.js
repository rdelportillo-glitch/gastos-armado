// Sincroniza las solicitudes de armado en almacén con Asignación.
// Cada solicitud abierta deja en `services` una unidad Pendiente por cada producto que falta armar, agrupadas en "lotes" de
// una jornada (LOTE_MIN minutos) para que cada lote se pueda asignar a un técnico: AA-000001-L1, AA-000001-L2...
// A medida que se registran armados la solicitud "baja": las unidades armadas salen de Asignación (las pendientes dejan de
// aparecer; las ya asignadas pasan a Realizadas). Al cerrar o cancelar, lo que quedó pendiente se retira.
// Una solicitud puede tardar varios días: sus unidades pendientes se renuevan al día de hoy en cada sincronización,
// para que sigan entrando a la Asignación de cada día hasta que se termine.
import * as E from "../asignacion/engine.js";
import { rowsToServiceRecords } from "../asignacion/data";
import { fetchAll } from "../maestrosApi";
import { metaDe } from "./armadosMeta";
import { suma } from "./armadosData";

export const LOTE_MIN = 420; // una jornada de un técnico, en minutos
const MIN_DEFECTO = 60; // si el producto no tiene tiempo en el maestro

const norm = (s) => String(s || "").trim();
// JSON con las llaves ordenadas: la base de datos (jsonb) reordena las llaves, y así se compara el contenido y no el orden.
const estable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

// Unidades de la solicitud en orden, con el lote que les corresponde (calculado sobre TODAS las unidades, para que no se muevan al armar).
export function unidadesDe(request, masters) {
  const out = [];
  (request.items || []).forEach((it) => {
    const code = norm(it.code);
    const m = masters.M.producto[code];
    const min = (m && m[0]) || MIN_DEFECTO;
    const q = Math.max(1, Math.round(Number(it.quantity)) || 1);
    for (let u = 1; u <= q; u++) out.push({ key: `${request.id}|${code}|${u}`, code, name: it.name, line: it.line || "", unit: u, min });
  });
  let acum = 0;
  out.forEach((x) => { x.lote = Math.floor(acum / LOTE_MIN); acum += x.min; });
  const lotes = out.length ? out[out.length - 1].lote + 1 : 0;
  out.forEach((x) => { x.servicio = lotes > 1 ? `${request.request_no}-L${x.lote + 1}` : request.request_no; });
  return out;
}

// Marca cuáles unidades ya están armadas (las armadas se consumen de las primeras de cada producto).
function marcarArmadas(units, assemblies, requestId) {
  const cuenta = new Map();
  // Los registros con causal negativa (no quedó armado) no cuentan: esas unidades siguen pendientes en Asignación.
  assemblies.filter((a) => a.request_id === requestId && suma(a)).forEach((a) => cuenta.set(norm(a.product_code), (cuenta.get(norm(a.product_code)) || 0) + a.quantity));
  units.forEach((x) => { x.hecha = x.unit <= (cuenta.get(x.code) || 0); });
}

// Función pura: devuelve la lista de servicios actualizada y un resumen. `hoy` es la fecha de hoy (ISO).
export function reconcile({ services, requests, warehouses, assemblies, masters, session, uid, hoy }) {
  const wById = new Map(warehouses.map((w) => [w.id, w]));
  const porKey = new Map();
  (services || []).forEach((s) => { if (s.asig && s.asig.armadoKey) porKey.set(s.asig.armadoKey, s); });
  const cambios = new Map(); // id -> registro nuevo del servicio
  const creados = [];
  const res = { nuevos: 0, actualizados: 0, retirados: 0, completados: 0, pqr: 0, problemas: [] };
  const retirar = (s, extra) => { if (s.estadoGestion === "Pendiente" && s.asig && !s.asig.cancelada && !s.asig.armadoAlmacen) { cambios.set(s.id, { ...s, asig: { ...s.asig, ...extra } }); return true; } return false; };

  const procesar = (r) => {
    const units = unidadesDe(r, masters);
    marcarArmadas(units, assemblies, r.id);
    const keys = new Set(units.map((x) => x.key));
    // Unidades que ya no están en la solicitud (se quitó un producto o bajó la cantidad)
    (services || []).filter((s) => s.asig && s.asig.solicitudId === r.id && !keys.has(s.asig.armadoKey)).forEach((s) => { if (retirar(s, { cancelada: true })) res.retirados++; });
    const abierta = r.status === "Abierta";
    const w = wById.get(r.warehouse_id);
    const aCrear = [];
    units.forEach((x) => {
      const rec = porKey.get(x.key);
      if (!abierta) { if (rec && retirar(rec, { cancelada: true })) res.retirados++; return; }
      if (x.hecha) {
        if (!rec) return;
        if (rec.estadoGestion === "Pendiente") { if (retirar(rec, { armadoAlmacen: true })) res.completados++; }
        else if (rec.estadoGestion === "En gestión") { cambios.set(rec.id, { ...rec, estadoGestion: "Realizado", asig: { ...rec.asig, armadoAlmacen: true } }); res.completados++; }
        return;
      }
      if (rec && rec.estadoGestion !== "Pendiente") return; // ya asignada o realizada: no se toca
      aCrear.push({ x, rec });
    });
    if (!aCrear.length) return;
    if (!w || !norm(w.department) || !norm(w.city)) { res.problemas.push(`${r.request_no}: el almacén no tiene departamento y ciudad (Maestros → Almacenes).`); return; }
    const meta = metaDe(r);
    const filas = aCrear.map(({ x }) => ({
      EMPRESA: r.client, FECHA_PROG: hoy, SERVICIO: x.servicio, NOMBRECLIENTE: w.name, DIRECCION: w.address || w.name, TELEFONO: w.contact_phone || "",
      SENAS: w.contact_name ? `Contacto: ${w.contact_name}` : "", DEPARTAMENTO: w.department, "NOMBRE DEPARTAMENTO": w.department, "Nombre Ciudad": w.city, BARRIO: w.neighborhood || "",
      "NOMBRE PRODUCTO": x.name, CODIGO: x.code, LINEA: x.line, "Productos.TIEMPOS": x.min, "Tiempo ARMADO": x.min,
      CLIENTEREPORTA: `ARMADO EN ALMACEN${r.pqr_number ? ` · PQR ${r.pqr_number}` : ""}${meta ? ` · terminar antes del ${meta.split("-").reverse().join("/")}` : ""}`,
      Cantidad: 1, Llave: x.key, _origen: "Almacén",
    }));
    const out = E.enrichBase(filas, masters.M, masters.idx);
    if (out.length !== aCrear.length || out.some((o) => !o.zona || o.region == null)) { res.problemas.push(`${r.request_no}: no se pudo ubicar la zona de ${w.name} (${w.city}). Revisa departamento, ciudad y barrio en Maestros → Almacenes.`); return; }
    const recs = rowsToServiceRecords(out, session);
    aCrear.forEach(({ x, rec }, i) => {
      const nuevo = { ...recs[i], asig: { ...recs[i].asig, armadoKey: x.key, solicitudId: r.id, solicitudNo: r.request_no, metaFecha: meta || null, lote: x.lote + 1, origenAlmacen: true, pqrNumero: norm(r.pqr_number) || null } };
      if (rec) {
        const { technicianId, tecnico2Nombre, tecnico3Nombre, rutaOrden, responsibleUserId, ...campos } = nuevo;
        const igual = estable({ ...rec, ...campos }) === estable(rec);
        if (!igual) { cambios.set(rec.id, { ...rec, ...campos }); res.actualizados++; }
      } else { creados.push({ id: uid("srv"), productId: null, observacionTrabajo: null, armado: null, observation: "", createdAt: new Date().toISOString(), ...nuevo }); res.nuevos++; }
    });
  };
  // Un error en una solicitud no debe frenar a las demás (por ejemplo, el retiro de las canceladas).
  requests.forEach((r) => { try { procesar(r); } catch (e) { res.problemas.push(`${r.request_no}: ${e.message}`); } });

  // El número del PQR viaja en cada servicio (asig.pqrNumero) para mostrarlo en el CSV de Asignación en lugar del código de la solicitud.
  // Se completa también en los servicios que ya existían y se actualiza si el PQR de la solicitud cambia.
  const pqrDe = new Map(requests.map((r) => [r.id, norm(r.pqr_number) || null]));
  (services || []).forEach((s) => {
    if (!s.asig || !s.asig.solicitudId || !pqrDe.has(s.asig.solicitudId)) return;
    const actual = cambios.get(s.id) || s;
    const pqr = pqrDe.get(s.asig.solicitudId);
    if ((actual.asig.pqrNumero || null) !== pqr) { cambios.set(s.id, { ...actual, asig: { ...actual.asig, pqrNumero: pqr } }); res.pqr++; }
  });

  const lista = (services || []).map((s) => cambios.get(s.id) || s);
  res.services = [...creados, ...lista];
  res.hayCambios = res.nuevos + res.actualizados + res.retirados + res.completados + res.pqr > 0;
  return res;
}

// Lee las solicitudes de Supabase, reconcilia con Asignación y guarda si hubo cambios. Solo para el equipo (admin y operador).
export async function sincronizar({ db, persist, addAudit, session, masters, uid, hoy }) {
  const [warehouses, requests, assemblies] = await Promise.all([fetchAll("warehouses", "*", "name"), fetchAll("store_requests", "*", "created_at"), fetchAll("store_assemblies", "*", "created_at")]);
  const r = reconcile({ services: db.services, requests, warehouses, assemblies, masters, session, uid, hoy });
  if (!r.hayCambios) return r;
  const next = addAudit({ ...db, services: r.services }, { userId: session.id, action: "Sincronización de armados en almacén con Asignación", record: "armados", oldValue: "-", newValue: `${r.nuevos} nuevas, ${r.actualizados} actualizadas, ${r.completados} armadas, ${r.retirados} retiradas` });
  r.ok = await persist(next);
  return r;
}
