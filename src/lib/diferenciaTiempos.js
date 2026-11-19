// Diferencia de tiempos: el tiempo que Jamar manda por producto (columna de tiempo de su archivo) frente al del maestro de Biver (Productos de armado).
//  · Jamar inferior: el tiempo de Jamar es menor que el del maestro de Biver. Diferencia = tiempo Biver − tiempo Jamar (por unidad × unidades).
//  · Técnicos equivalentes = diferencia ÷ jornada (420 min) ÷ días con carga: los técnicos que ese tiempo de menos representa por día (mismo criterio del Dimensionamiento).
//  · Un producto sin tiempo en Jamar, o que no está en el maestro de Biver, no se puede comparar (se cuenta aparte).
// Los registros salen de lib/dimensionamiento.js (histórico de asignación para días anteriores y Carga para hoy), ya con línea, sublínea, código y tiempos.
import { plano } from "./dimensionamiento";

// Maestro de Biver por código de producto: { minutos por unidad, nombre, línea, sublínea }.
export function maestroPorCodigo(productos) {
  return new Map((productos || []).map((p) => [plano(p.code), { minutos: Number(p.minutes) || 0, nombre: p.name || "", linea: p.line || "", sublinea: p.subline || "" }]));
}

export const ESTADOS = ["Jamar inferior", "Jamar superior", "Igual", "Sin tiempo Jamar", "Sin maestro"];

// Una fila por registro con el tiempo de Jamar, el de Biver y su diferencia.
export function compararRegistros({ registros, maestro, incluirCancelados = false }) {
  return (registros || []).filter((r) => incluirCancelados || !r.cancelado).map((r) => {
    const m = maestro.get(plano(r.codigo)) || null;
    const biverMaestro = m && m.minutos > 0 ? m.minutos * r.unidades : null;
    const biver = biverMaestro !== null ? biverMaestro : r.biverGuardado; // si el producto ya no está en el maestro, el tiempo de Biver que se guardó al cargarlo
    const jamar = r.jamarPropio;
    const estado = !(jamar > 0) ? "Sin tiempo Jamar" : !(biver > 0) ? "Sin maestro" : jamar < biver - 1e-9 ? "Jamar inferior" : jamar > biver + 1e-9 ? "Jamar superior" : "Igual";
    const comparable = estado === "Jamar inferior" || estado === "Jamar superior" || estado === "Igual";
    return { ...r, nombre: (m && m.nombre) || r.producto || "", linea: r.linea || (m && m.linea) || "Sin línea", sublinea: r.sublinea || (m && m.sublinea) || "Sin sublínea", jamarT: jamar, biverT: biver ?? 0, estado, comparable, dif: comparable ? biver - jamar : 0 };
  });
}

const r1 = (n) => Math.round(n * 10) / 10;

// Resumen de un conjunto de filas. soloInferior: la diferencia y los tiempos solo cuentan las unidades donde Jamar es menor (si no, todas las comparables).
function resumir(filas, { soloInferior, jornada, dias }) {
  const comparables = filas.filter((x) => x.comparable);
  const inferiores = comparables.filter((x) => x.estado === "Jamar inferior");
  const base = soloInferior ? inferiores : comparables;
  const jamar = base.reduce((s, x) => s + x.jamarT, 0), biver = base.reduce((s, x) => s + x.biverT, 0);
  const dif = biver - jamar;
  return {
    unidades: comparables.reduce((s, x) => s + x.unidades, 0), inferiores: inferiores.reduce((s, x) => s + x.unidades, 0),
    sinJamar: filas.filter((x) => x.estado === "Sin tiempo Jamar").reduce((s, x) => s + x.unidades, 0), sinMaestro: filas.filter((x) => x.estado === "Sin maestro").reduce((s, x) => s + x.unidades, 0),
    jamar: r1(jamar), biver: r1(biver), dif: r1(dif), pct: biver > 0 ? (dif / biver) * 100 : null,
    tecnicos: dias > 0 && jornada > 0 ? Math.round((dif / jornada / dias) * 100) / 100 : 0,
    productos: new Set(base.map((x) => plano(x.codigo) || plano(x.nombre))).size,
  };
}

// Agrupa por una clave (línea, sublínea, producto). Con soloInferior se omiten los grupos sin unidades con Jamar inferior; siempre se omiten los que no se pueden comparar.
export function agrupar(filas, clave, { soloInferior = true, jornada = 420, dias = 1 } = {}) {
  const m = new Map();
  filas.forEach((x) => { const k = clave(x); if (!m.has(k.key)) m.set(k.key, { ...k, filas: [] }); m.get(k.key).filas.push(x); });
  return [...m.values()].map((g) => ({ ...g, ...resumir(g.filas, { soloInferior, jornada, dias }) }))
    .filter((g) => (soloInferior ? g.inferiores > 0 : g.unidades > 0))
    .sort((a, b) => b.dif - a.dif || b.inferiores - a.inferiores || String(a.nombre).localeCompare(String(b.nombre), "es"));
}

export const claveLinea = (x) => ({ key: plano(x.linea), nombre: x.linea });
export const claveSublinea = (x) => ({ key: `${plano(x.linea)}|${plano(x.sublinea)}`, nombre: x.sublinea, linea: x.linea });
export const claveProducto = (x) => ({ key: plano(x.codigo) || plano(x.nombre), nombre: x.nombre, codigo: x.codigo, linea: x.linea, sublinea: x.sublinea });

export const totalGeneral = (filas, opts) => resumir(filas, { soloInferior: true, jornada: 420, dias: 1, ...opts });
