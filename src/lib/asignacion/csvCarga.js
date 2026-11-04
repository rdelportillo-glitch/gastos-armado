// CSV de Carga: encabezados, orden de las filas y construcción de cada fila. Lo usan el "Exportar CSV" de Carga y el cierre del día (se guarda la fila en el
// histórico), de modo que el CSV del Histórico de asignación sea el mismo, con las mismas columnas y en el mismo orden.
import { CSV_HEADERS, filaCsvDeRegistro, ddmmyyyy, numOrText } from "./outputs";
import { CIERRE_HEADERS, calcularCierre, cierreAFila } from "./cierreColumnas";

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

// Las 18 primeras de Asignación (hasta APOYO), usuarios de Extreme, columnas de cierre, causal auditada, diagnóstico, tipo de pago, lo demás de Asignación y lo propio de Carga.
export const CSV_CARGA_HEADERS = [...CSV_HEADERS.slice(0, 18), "USUARIO", "USUARIO2", ...CIERRE_HEADERS, "Causal auditada", "Diagnóstico Extreme", "TIPO DE PAGO", ...CSV_HEADERS.slice(18),
  "Gestión", "Estado Extreme", "Causal Extreme", "Región", "ID zona", "COORDINADOR"];

const nombreTecnico = (s, techById) => (techById[s.technicianId] && techById[s.technicianId].name) || s.tecnico2Nombre || "";
const deptoDe = (s) => String((s.asig && s.asig.depto) || s.departamentoExterno || "");

// Orden de Asignación: lo que tiene técnico primero, por departamento, orden del técnico en Personal, nombre, orden de ruta y servicio.
export function ordenarComoAsignacion(lista, techById) {
  const tec = (s) => nombreTecnico(s, techById);
  const ordTec = (s) => (techById[s.technicianId] && techById[s.technicianId].assignOrder) ?? 9999;
  return [...lista].sort((a, b) => (!!tec(a) !== !!tec(b) ? (tec(a) ? -1 : 1) : 0) || deptoDe(a).localeCompare(deptoDe(b)) || ordTec(a) - ordTec(b) || tec(a).localeCompare(tec(b))
    || (a.rutaOrden || 0) - (b.rutaOrden || 0) || String(a.servicioExterno).localeCompare(String(b.servicioExterno)));
}

// Filas del CSV de Carga para registros YA ordenados (el tipo de pago "Desplazamiento" va una sola vez por servicio y técnico, en el primero).
// regionLabelDe(registro) y coordDe(departamento) los da quien llama; valorTvDe(registro) es la función de cargarValoresTv.
export function filasCsvCarga({ registros, technicians, causales, valorTvDe, regionLabelDe, coordDe }) {
  const techById = Object.fromEntries(technicians.map((t) => [t.id, t]));
  const extremeDe = (nombre) => { const t = nombre ? technicians.find((x) => plano(x.name) === plano(nombre)) : null; return (t && t.extremeUser) || ""; };
  const pagoPorCausal = new Map((causales || []).map((c) => [plano(c.name), c.paymentType || ""]));
  const desplazamientoYa = new Set();
  const tipoPagoDe = (s) => {
    const tipo = pagoPorCausal.get(plano(s.causalAuditada || s.causalExtreme || "")) || "";
    if (plano(tipo) !== "DESPLAZAMIENTO") return tipo;
    const clave = `${s.servicioExterno}|${nombreTecnico(s, techById)}`;
    if (desplazamientoYa.has(clave)) return "";
    desplazamientoYa.add(clave);
    return tipo;
  };
  return registros.map((s) => {
    const base = filaCsvDeRegistro(s, nombreTecnico(s, techById));
    return [...base.slice(0, 18), (techById[s.technicianId] && techById[s.technicianId].extremeUser) || extremeDe(s.tecnico2Nombre), extremeDe(s.tecnico3Nombre),
      ...cierreAFila(calcularCierre(s, valorTvDe ? valorTvDe(s) : "")), s.causalAuditada || "", s.diagnostico || "", tipoPagoDe(s),
      ...base.slice(18), s.estadoGestion || "Realizado", s.estadoExtreme || "", s.causalExtreme || "", regionLabelDe(s), (s.asig && s.asig.idzona) ?? "", coordDe(deptoDe(s))];
  });
}

// Fila equivalente para días cerrados ANTES de que el histórico guardara la fila completa: se arma con lo que sí se guardó (lo demás queda vacío).
export function filaDesdeHistorico(r, { technicians, regionLabel, coordDe }) {
  const extremeDe = (nombre) => { const t = nombre ? technicians.find((x) => x.id === r.technician_id || plano(x.name) === plano(nombre)) : null; return (t && t.extremeUser) || ""; };
  const apoyo = r.helper_name ? technicians.find((x) => plano(x.name) === plano(r.helper_name)) : null;
  const o = {
    FECHA: ddmmyyyy(r.day), SERVICIO: numOrText(r.servicio), "NOMBRE CLIENTE": r.cliente, "DIRECCIÓN": r.direccion, DPTO: r.departamento, CIUDAD: r.ciudad, BARRIO: r.barrio,
    PRODUCTO: r.producto, "CÓDIGO": r.codigo, TIEMPO: r.tiempo_min, OBSERVACION: r.tipo, TECNICO: r.technician_name, APOYO: r.helper_name,
    USUARIO: extremeDe(r.technician_name), USUARIO2: (apoyo && apoyo.extremeUser) || "",
    "ARMADO?": r.armado, CAUSALES: r.causales, SUBCAUSALES: r.subcausales, NOTAS: r.notas, GARANTIA: r.garantia, SOLUCION: r.solucion, AUDITORIA: r.auditoria,
    "PRIMER PISO": r.primer_piso, "VALOR INSTALACION DE TV": r.valor_tv, "Causal auditada": r.causal_auditada, "Diagnóstico Extreme": r.diagnostico,
    "Nombre Equivalente": r.zona, "Gestión": r.resultado === "Realizado" ? "Realizado" : "En gestión", "Estado Extreme": r.estado_extreme, "Causal Extreme": r.causal_extreme,
    "Región": regionLabel(r.region), COORDINADOR: coordDe(r.departamento),
  };
  return CSV_CARGA_HEADERS.map((h) => (o[h] === undefined || o[h] === null ? "" : o[h]));
}

// Para días cerrados antes de que el histórico guardara la fila completa: el registro de Carga (services) sigue existiendo archivado, así que se reconstruye la fila
// con él (empresa, teléfono, señas, tipo de solicitud, cliente reporta, agencia...) y se le superponen los datos que el histórico guardó al cerrar (técnico, apoyo, resultado,
// causales, diagnóstico y columnas de cierre), porque lo no realizado volvió a pendientes y perdió esos datos en el registro.
export function registroDeHistorico(r, s) {
  const a = { ...(s.asig || {}) };
  if (r.notas) a.notas = r.notas;
  if (r.solucion) a.solucion = r.solucion;
  if (r.primer_piso) a.primerPiso = r.primer_piso;
  return {
    ...s, technicianId: r.technician_id || null, tecnico2Nombre: r.technician_name || s.tecnico2Nombre || "", tecnico3Nombre: r.helper_name || "", rutaOrden: r.ruta_orden ?? s.rutaOrden,
    estadoGestion: r.resultado === "Realizado" ? "Realizado" : "En gestión", estadoExtreme: r.estado_extreme || "", causalExtreme: r.causal_extreme || "",
    causalAuditada: r.causal_auditada || "", diagnostico: r.diagnostico || "", asig: a, _region: r.region, _valorTv: r.valor_tv ?? "",
  };
}

// Columnas de cierre (ARMADO?, CAUSALES, SUBCAUSALES, GARANTIA, AUDITORIA) de un registro del histórico, recalculadas con su causal, diagnóstico y notas.
export function camposCierreDeHistorico(r) {
  const rec = { causalAuditada: r.causal_auditada, causalExtreme: r.causal_extreme, diagnostico: r.diagnostico, tecnico2Nombre: r.technician_name, asig: { notas: r.notas, solucion: r.solucion, primerPiso: r.primer_piso } };
  const x = calcularCierre(rec, r.valor_tv ?? "");
  return { armado: x.armado || null, causales: x.causales || null, subcausales: x.subcausales || null, garantia: x.garantia || null, auditoria: x.auditoria || null };
}

// Pone en la fila guardada del CSV (fila_csv) lo que se editó del registro, por nombre de columna. antes = el registro antes de editar.
export function parcharFilaCsv(fila, r, antes, { technicians, causales }) {
  if (!Array.isArray(fila)) return fila;
  const f = [...fila];
  const poner = (h, v) => { const i = CSV_CARGA_HEADERS.indexOf(h); if (i >= 0) f[i] = v === undefined || v === null ? "" : v; };
  const tec = technicians.find((x) => x.id === r.technician_id) || technicians.find((x) => plano(x.name) === plano(r.technician_name));
  const apoyo = r.helper_name ? technicians.find((x) => plano(x.name) === plano(r.helper_name)) : null;
  poner("TECNICO", r.technician_name); poner("APOYO", r.helper_name); poner("USUARIO", tec ? tec.extremeUser : ""); poner("USUARIO2", apoyo ? apoyo.extremeUser : "");
  poner("NOMBRE CLIENTE", r.cliente); poner("DIRECCIÓN", r.direccion); poner("CIUDAD", r.ciudad); poner("BARRIO", r.barrio);
  const rec = { causalAuditada: r.causal_auditada, causalExtreme: r.causal_extreme, diagnostico: r.diagnostico, tecnico2Nombre: r.technician_name, asig: { notas: r.notas, solucion: r.solucion, primerPiso: r.primer_piso } };
  const cierre = cierreAFila(calcularCierre(rec, r.valor_tv ?? ""));
  CIERRE_HEADERS.forEach((h, k) => poner(h, cierre[k]));
  poner("Causal auditada", r.causal_auditada); poner("Diagnóstico Extreme", r.diagnostico); poner("Causal Extreme", r.causal_extreme); poner("Estado Extreme", r.estado_extreme);
  poner("Gestión", r.resultado === "Realizado" ? "Realizado" : "En gestión");
  // El tipo de pago solo se recalcula si cambió la causal (el "Desplazamiento" de un servicio con varios productos va en uno solo y no se puede rehacer desde un registro suelto).
  const causalAntes = plano(antes.causal_auditada || antes.causal_extreme), causalAhora = plano(r.causal_auditada || r.causal_extreme);
  if (causalAntes !== causalAhora) {
    const pago = new Map((causales || []).map((x) => [plano(x.name), x.paymentType || ""]));
    poner("TIPO DE PAGO", pago.get(causalAhora) || "");
  }
  return f;
}
