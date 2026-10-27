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
const esCancelado = (nombreTecnico) => ["APLAZADO", "DUPLICADO", "NO_PROGRAMAR", "NO PROGRAMAR", "SERVICIO_ARMADO", "SERVICIO ARMADO"].includes(plain(nombreTecnico));

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
