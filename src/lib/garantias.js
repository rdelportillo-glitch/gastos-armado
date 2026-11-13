// Reporte de garantías: productos cuya causal es NO ARMADO POR NOVEDAD (no se pudieron armar por un problema del producto: queda para garantía) frente al total de productos armados.
//  · Armado = producto con ARMADO? = SI y que no se cerró como cancelado ni devuelto (según la gestión de su causal en Maestros → Causales).
//  · Garantía = producto con la causal NO ARMADO POR NOVEDAD (la auditada; si no hay, la de Extreme). Los ARMADO CON NOVEDAD NO cuentan como garantía.
//  · % de garantía = garantías ÷ armados. También se muestra sobre el total de productos gestionados.
// Se calcula con el histórico de asignación (la fila de cada producto del CSV de Carga), igual que el Informe de cierre.
import { CSV_CARGA_HEADERS } from "./asignacion/csvCarga";
import { empresaDeFilaCsv, nombreDepartamento } from "./informeJamar";

const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const H = Object.fromEntries(CSV_CARGA_HEADERS.map((h, i) => [h, i]));
const fechaIso = (txt) => { const m = String(txt || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
export const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0);

// Una fila por producto con lo que hace falta para el reporte. gestionDe: causal → "Cancelado" | "Devuelto" | "Pendiente" | "".
export function registrosDeFilas(filas, gestionDe = () => "") {
  return filas.map((f) => {
    const causal = String(f[H["Causal auditada"]] || f[H["Causal Extreme"]] || "").trim();
    const g = gestionDe(causal);
    const estado = g === "Cancelado" ? "cancelado" : g === "Devuelto" ? "devuelto" : plano(f[H["ARMADO?"]]) === "SI" ? "armado" : "noArmado";
    return {
      fecha: fechaIso(f[H["FECHA"]]), empresa: empresaDeFilaCsv(f), servicio: String(f[H["SERVICIO"]] ?? ""), cliente: String(f[H["NOMBRE CLIENTE"]] || ""), depto: nombreDepartamento(f[H["DPTO"]]), ciudad: String(f[H["CIUDAD"]] || ""),
      producto: String(f[H["PRODUCTO"]] || ""), tecnico: String(f[H["TECNICO"]] || "").trim() || "Sin técnico", coordinador: String(f[H["COORDINADOR"]] || "").trim() || "Sin coordinador",
      causal, estado, garantia: plano(causal) === "NO ARMADO POR NOVEDAD", notas: String(f[H["NOTAS"]] || ""), solucion: String(f[H["SOLUCION"]] || ""), diagnostico: String(f[H["Diagnóstico Extreme"]] || ""), tipo: String(f[H["OBSERVACION"]] || "").trim(),
    };
  });
}

export function resumir(regs) {
  const total = regs.length, armados = regs.filter((r) => r.estado === "armado").length, garantias = regs.filter((r) => r.garantia).length;
  return { total, armados, garantias, pctGarantia: pct(garantias, armados), pctTotal: pct(garantias, total) };
}

// Agrupa y resume por una clave (técnico, departamento, coordinador, producto, día...). Devuelve [{ key, total, armados, garantias, pctGarantia, pctTotal, regs }].
export function agrupar(regs, clave) {
  const m = new Map();
  regs.forEach((r) => { const k = clave(r) || "Sin dato"; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m.entries()].map(([key, rs]) => ({ key, regs: rs, ...resumir(rs) }));
}

// Lo más frecuente de un campo en un grupo (por ejemplo el departamento de un técnico).
export const moda = (regs, fn) => { const m = new Map(); regs.forEach((r) => { const v = fn(r); if (v) m.set(v, (m.get(v) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
