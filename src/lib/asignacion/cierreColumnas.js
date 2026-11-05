// Columnas de cierre de la plantilla de Carga (CONSOLIDADO, columnas U a AC): ARMADO?, CAUSALES, SUBCAUSALES, NOTAS, GARANTIA, SOLUCION,
// AUDITORIA, PRIMER PISO y VALOR INSTALACION DE TV. Se calculan a partir de la causal y el diagnóstico del registro (los mismos de Extreme que se
// auditan en Carga); NOTAS, SOLUCION y PRIMER PISO los escribe la persona al editar el registro (se guardan en asig).
import { loadOffersByServicio, loadTvConfig, esProductoTv } from "../tv/tvData";

export const CIERRE_HEADERS = ["ARMADO?", "CAUSALES", "SUBCAUSALES", "NOTAS", "GARANTIA", "SOLUCION", "AUDITORIA", "PRIMER PISO", "VALOR INSTALACION DE TV"];

const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

// Causales con las que el producto sí quedó armado (o se hizo el trabajo); cualquier otra causal es "NO".
const ARMADO_SI = new Set(["CAL-TRA ARMADO DE MULTIMUEBLE", "ARMADO CON NOVEDAD", "DESARMADO DE MULTIMUEBLE", "EMPAQUE", "AJUSTE DE PRODUCTO", "INSTALACION PIEZA", "REPARACION MENOR"]);
const CAUSAL_DIRECTA = {
  "CLIENTE ARMA - LLAMADA": "CLTE_ARMO_MUEBLE", "CLIENTE ARMO EL PRODUCTO": "CLTE_ARMO_MUEBLE", "CLIENTE CANCELA": "CLTE_APLAZA_CANCELA_SERVICIO",
  "PRODUCTO NO ARMABLE": "PRODUCTO_NO_ARMABLE", "CONDICION NO OPERABLE": "CONDICIONES_NO_OPERABLES", "DIRECCION ERRADA": "DIR_ERRADA", "INMUEBLE CERRADO": "CONTACTO_NO_EF",
};
const SUB_DIRECTA = {
  "CLIENTE CANCELA": "COMPROMISOS VARIOS DEL CLIENTE", "DIRECCION ERRADA": "NO COINCIDE BARRIO CON LA DIRECCION", "INMUEBLE CERRADO": "NO SE UBICÓ AL CLIENTE POR NINGÚN MEDIO",
};
const RE_MALTRATO = /GOLPE|MALTRAT|PARTID|RAJAD|ROT[AO]S?\b|DA[NÑ]AD|DA[NÑ]O|MAL ESTADO|AFECTAD|PELA|ASTILL|DESPORTILL|MANCHAD|RAYAD/;
const RE_ERRADA = /ERRAD|NO ES LA|NO SON LAS?|NO ES LOS|NO CORRESPOND|EQUIVOCAD|DIFERENTE/;
const RE_HERRAJES = /HERRAJE|TORNILL|TORTILLER|FALTAN|FALTA/;

// ¿La causal es de trabajo hecho? (las mismas con las que ARMADO? sale SI)
export const causalEsRealizada = (causal) => ARMADO_SI.has(plain(causal));

// ¿La causal es PENDIENTE por su nombre? (respaldo para causales sin gestión configurada)
export const causalEsPendiente = (causal) => plain(causal).includes("PENDIENTE");

// Gestión de cada causal, configurable en Maestros → Causales: "Pendiente" (en rojo; sigue En gestión y vuelve a Asignación al finalizar el día),
// "Cancelado" (en rojo; el registro queda como cancelado, igual que Cliente cancela), "Devuelto" (en rojo; igual que cancelado en Carga, pero el Informe de cierre Jamar lo cuenta aparte)
// o "" (normal: la causal cierra la gestión).
// Una causal sin gestión elegida se trata como Pendiente si su nombre dice PENDIENTE, y como normal en cualquier otro caso. Devuelve una función nombre → gestión.
export function gestionDeCausal(causales) {
  const m = new Map((causales || []).map((x) => [plain(x.name), x.gestion || ""]));
  return (nombre) => {
    const k = plain(nombre);
    if (!k) return "";
    const v = m.get(k);
    if (v === "Normal") return "";
    if (v) return v;
    return k.includes("PENDIENTE") ? "Pendiente" : "";
  };
}
const porNombre = (c) => (causalEsPendiente(c) ? "Pendiente" : "");

// Al auditar la causal (a mano, aceptando la de Extreme o en masa) cambia la gestión del registro según la gestión de la causal (gestionDe):
//  · Pendiente → sigue "En gestión" (al finalizar el día vuelve a Asignación para reprogramarlo);
//  · Cancelado o Devuelto → el registro queda cancelado (asig.cancelada, causal auditada y Estado Extreme "No realizado"): no vuelve a Asignación; si luego se cambia la causal, deja de estar cancelado;
//  · normal → "Realizado": la gestión terminó y se archiva al finalizar el día.
// El Estado Extreme no se inventa: si el registro ya trae resultado de Extreme se deja como está; si no (auditoría a mano), trabajo hecho → "Realizado" y lo demás → "No realizado"
// (marcado en asig.estadoManual, para poder corregir la causal después). Lo cancelado por Jamar (cancelación masiva) no se toca. Devuelve los campos a cambiar, con la causal ya puesta en rec.
export function patchAuditoriaManual(rec, gestionDe = porNombre) {
  const a0 = rec.asig || {};
  if (!rec.causalAuditada) return {};
  const g = gestionDe(rec.causalAuditada);
  const propioExtreme = !!rec.estadoExtreme && !a0.estadoManual; // el resultado lo reportó Extreme
  if (g === "Cancelado" || g === "Devuelto") {
    if (a0.cancelada) return {};
    if (propioExtreme && rec.estadoExtreme === "Realizado") return {}; // no se cancela lo que Extreme reportó como hecho
    return { estadoGestion: "En gestión", estadoExtreme: "No realizado", asig: { ...a0, cancelada: true, canceladaFecha: new Date().toISOString().slice(0, 10), canceladaPor: "Auditoría", ...(propioExtreme ? {} : { estadoManual: true }) } };
  }
  // Cancelado antes por una causal y ahora se corrigió: deja de estar cancelado (lo cancelado por Jamar no se toca).
  let a = a0, extra = {};
  if (a0.cancelada) {
    if (a0.canceladaPor !== "Auditoría") return {};
    const { cancelada, canceladaFecha, canceladaPor, ...resto } = a0;
    a = resto; extra = { asig: a };
  }
  if (g === "Pendiente") {
    if (propioExtreme) return rec.estadoExtreme === "Realizado" ? { ...extra } : { ...extra, estadoGestion: "En gestión" };
    return { estadoGestion: "En gestión", estadoExtreme: "No realizado", asig: { ...a, estadoManual: true } };
  }
  if (propioExtreme) return { ...extra, estadoGestion: "Realizado" };
  return { estadoGestion: "Realizado", estadoExtreme: causalEsRealizada(rec.causalAuditada) ? "Realizado" : "No realizado", asig: { ...a, estadoManual: true } };
}

// Causal en uso: la auditada si ya la corrigieron, si no la que reportó Extreme.
export const causalDeCierre = (s) => String(s.causalAuditada || s.causalExtreme || "").trim();

function causalesDe(causal, diag) {
  if (CAUSAL_DIRECTA[causal]) return CAUSAL_DIRECTA[causal];
  if (causal === "NO ARMADO POR NOVEDAD") {
    if (RE_MALTRATO.test(diag)) return "MALTRATO_EN_CAJA";
    if (RE_ERRADA.test(diag) || RE_HERRAJES.test(diag)) return "P_CALIDAD";
  }
  return "";
}
function subcausalesDe(causal, diag) {
  if (SUB_DIRECTA[causal]) return SUB_DIRECTA[causal];
  if (causal === "NO ARMADO POR NOVEDAD") {
    if (RE_MALTRATO.test(diag)) return "PIEZAS MALTRATADAS O GOLPEADAS";
    if (RE_ERRADA.test(diag)) return "PIEZAS ERRADAS";
    if (RE_HERRAJES.test(diag)) return "FALTA DE HERRAJES";
  }
  if (causal === "CONDICION NO OPERABLE") {
    if (/TOMA|CORRIENTE/.test(diag)) return "TOMA CORRIENTES";
    if (/ESPACIO/.test(diag)) return "ESPACIO FISICO NO ADECUADO";
    if (/LLAMADA|TELEFON/.test(diag)) return "CONDICIONES NO OPERABLES POR LLAMADA";
  }
  return "";
}

// Servicios que se mandan a un "técnico" de mentira (aplazado, duplicado, no programar, servicio de armado) no se hicieron: van como CANCELADOS.
const esCancelado = (nombreTecnico) => ["APLAZADO", "DUPLICADO", "NO_PROGRAMAR", "NO PROGRAMAR", "SERVICIO_ARMADO", "SERVICIO ARMADO", "ALMACEN", "SOBRECARGA", "SOBRECARGA DIMENSIONAMIENTO"].includes(plain(nombreTecnico));

// Las nueve columnas de un registro de Carga. valorTv es el valor de la instalación de TV (del módulo TV) si el producto es una TV.
export function calcularCierre(s, valorTv) {
  const a = s.asig || {};
  const manual = { notas: a.notas || "", solucion: a.solucion || "", primerPiso: a.primerPiso || "" };
  const causalOrig = causalDeCierre(s);
  const causal = plain(causalOrig), diag = plain(s.diagnostico);
  const cancelado = esCancelado(s.tecnico2Nombre);
  const garantia = causal === "ARMADO CON NOVEDAD" ? "SI" : ""; // se armó pero con una pieza con problema: queda para garantía
  // Auditoría corrigió lo que Extreme reportó: el servicio se había cerrado con otra causal.
  const mal = !!s.causalAuditada && !!s.causalExtreme && plain(s.causalAuditada) !== plain(s.causalExtreme) ? "SERVICIO MAL CERRADO" : "";
  return {
    armado: cancelado ? "CANCELADOS" : !causal ? "" : ARMADO_SI.has(causal) ? "SI" : "NO",
    causales: causalesDe(causal, diag), subcausales: subcausalesDe(causal, diag),
    notas: manual.notas, garantia, solucion: manual.solucion, auditoria: mal, primerPiso: manual.primerPiso,
    valorTv: valorTv ?? "",
  };
}
export const cierreAFila = (c) => [c.armado, c.causales, c.subcausales, c.notas, c.garantia, c.solucion, c.auditoria, c.primerPiso, c.valorTv];

// Valor de la instalación de TV por servicio: de la oferta del módulo TV ya realizada (valor facturado; si falta, el cobrado o el acordado).
// Devuelve una función (registro) → valor; el valor se pone solo en la primera línea de TV de cada servicio para no repetirlo.
export async function cargarValoresTv(services) {
  const vacia = () => "";
  try {
    const servicios = [...new Set(services.map((s) => String(s.servicioExterno || "")).filter(Boolean))];
    if (!servicios.length) return vacia;
    const [cfg, offers] = await Promise.all([loadTvConfig(), loadOffersByServicio(servicios)]);
    const valorDe = new Map();
    offers.filter((o) => o.ejecucion === "Realizada").forEach((o) => {
      const v = [o.valor_facturado, o.valor_cobrado, o.valor_total].map(Number).find((x) => x > 0);
      if (v) valorDe.set(String(o.servicio), v);
    });
    const usados = new Set();
    return (s) => {
      const k = String(s.servicioExterno);
      if (!valorDe.has(k) || usados.has(k) || !esProductoTv(s.asig, cfg)) return "";
      usados.add(k);
      return valorDe.get(k);
    };
  } catch (e) {
    return vacia; // sin módulo TV o sin permiso: la columna queda vacía, el resto no se afecta
  }
}

// Al devolver un registro a pendientes se borra lo que se escribió a mano del cierre (notas, solución, primer piso): es de esa visita.
export function sinCierreManual(asig) {
  if (!asig) return asig;
  const { notas, solucion, primerPiso, ...resto } = asig;
  return resto;
}
