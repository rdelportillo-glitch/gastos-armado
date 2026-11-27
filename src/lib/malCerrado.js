// Reporte de SERVICIO MAL CERRADO: productos que el técnico cerró en Extreme con una causal y la auditoría corrigió con otra (columna AUDITORIA del histórico).
//  · Mal cerrado = AUDITORIA = SERVICIO MAL CERRADO (preventiva y las devoluciones ALMACEN y SOBRECARGA no cuentan: ver noAplicaMalCerrado).
//  · Cierres de Extreme = productos con causal de Extreme (sin los excluidos). % mal cerrado = mal cerrados ÷ cierres de Extreme.
// Se calcula con la misma fila del CSV de Carga que los demás reportes del histórico.
import { CSV_CARGA_HEADERS } from "./asignacion/csvCarga";
import { noAplicaMalCerrado } from "./asignacion/cierreColumnas";
import { empresaDeFilaCsv, nombreDepartamento } from "./informeJamar";

const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const H = Object.fromEntries(CSV_CARGA_HEADERS.map((h, i) => [h, i]));
const fechaIso = (txt) => { const m = String(txt || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
const t = (v) => String(v ?? "").trim();
export const pct = (n, d) => (d > 0 ? (n / d) * 100 : 0);

export function registrosDeFilas(filas) {
  return filas.map((f) => {
    const causalExtreme = t(f[H["Causal Extreme"]]).toUpperCase(), causalAuditada = t(f[H["Causal auditada"]]).toUpperCase(), tecnico = t(f[H["TECNICO"]]);
    const preventiva = noAplicaMalCerrado(causalAuditada, causalExtreme, tecnico);
    return {
      fecha: fechaIso(f[H["FECHA"]]), empresa: empresaDeFilaCsv(f), servicio: t(f[H["SERVICIO"]]), cliente: t(f[H["NOMBRE CLIENTE"]]), depto: nombreDepartamento(f[H["DPTO"]]), ciudad: t(f[H["CIUDAD"]]),
      producto: t(f[H["PRODUCTO"]]), tecnico: tecnico || "Sin técnico", coordinador: t(f[H["COORDINADOR"]]) || "Sin coordinador",
      causalExtreme, causalAuditada, diagnostico: t(f[H["Diagnóstico Extreme"]]), notas: t(f[H["NOTAS"]]),
      cierre: !!causalExtreme && !preventiva, mal: !preventiva && plano(f[H["AUDITORIA"]]) === "SERVICIO MAL CERRADO",
    };
  });
}

export function resumir(regs) {
  const malos = regs.filter((r) => r.mal);
  const cierres = regs.filter((r) => r.cierre).length;
  return { total: regs.length, cierres, mal: malos.length, servicios: new Set(malos.map((r) => r.servicio)).size, pct: pct(malos.length, cierres) };
}

// Agrupa y resume por una clave (técnico, departamento, coordinador, causal, día...). Devuelve [{ key, regs, total, cierres, mal, servicios, pct }].
export function agrupar(regs, clave) {
  const m = new Map();
  regs.forEach((r) => { const k = clave(r) || "Sin dato"; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m.entries()].map(([key, rs]) => ({ key, regs: rs, ...resumir(rs) }));
}

// Cambios de causal de los mal cerrados: con cuál se cerró en Extreme → cuál era la correcta. De más a menos casos.
export function cambios(regs) {
  const malos = regs.filter((r) => r.mal);
  const m = new Map();
  malos.forEach((r) => { const k = `${r.causalExtreme}|${r.causalAuditada}`; const x = m.get(k) || { key: k, extreme: r.causalExtreme, auditada: r.causalAuditada, casos: 0, tecnicos: new Set() }; x.casos++; x.tecnicos.add(r.tecnico); m.set(k, x); });
  return [...m.values()].map((x) => ({ ...x, tecnicos: x.tecnicos.size, parte: pct(x.casos, malos.length) })).sort((a, b) => b.casos - a.casos || a.extreme.localeCompare(b.extreme, "es"));
}

// Lo más frecuente de un campo en un grupo (por ejemplo el departamento de un técnico).
export const moda = (regs, fn) => { const m = new Map(); regs.forEach((r) => { const v = fn(r); if (v) m.set(v, (m.get(v) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
