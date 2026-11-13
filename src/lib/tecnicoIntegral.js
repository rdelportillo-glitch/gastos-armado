// Técnico integral: todos los indicadores de un técnico (o de un departamento / coordinador) en un mismo lugar.
//  · Cierre en línea (Extreme): % de productos con hora fin de trabajo antes de la hora límite.
//  · Garantías: productos armados con novedad ÷ productos armados.
//  · Concreción de TV: instalaciones de TV realizadas ÷ programadas con el técnico (la «concreción del técnico» de Instalación de TV).
//  · Quejas por incumplimiento: quejas que aplican al técnico ÷ servicios que armó (histórico).
//  · CSAT del cliente: promedio de los meses del rango en el informe mensual de CSAT.
// Cada grupo (técnico, departamento, coordinador) se calcula con los registros de TODOS sus técnicos, no promediando porcentajes.
import { statsNds, semanaIso } from "./cierreExtreme";
import { calcConcrecion } from "./tv/tvData";
import { resumir } from "./garantias";

export const METAS_DEFECTO = { cierre: 95, garantias: 3, concrecion: 80, quejas: 0.5, csat: 90 };
export const INDICADORES = [
  { k: "cierre", t: "Cierre en línea", mejor: "alto", unidad: "%" }, { k: "garantias", t: "Garantías", mejor: "bajo", unidad: "%" }, { k: "concrecion", t: "Concreción TV", mejor: "alto", unidad: "%" },
  { k: "quejas", t: "Quejas que aplican", mejor: "bajo", unidad: "%" }, { k: "csat", t: "CSAT", mejor: "alto", unidad: "%" },
];

const vacio = () => ({ regs: [], servicios: [], cierres: [], ofertas: [], quejas: [], csat: [] });
export const datosVacios = vacio;

// Indicadores de un conjunto de datos (de un técnico o de un grupo). Cada porcentaje es null cuando no hay con qué calcularlo.
export function indicadoresDe(d, lim) {
  const gar = resumir(d.regs);
  const nds = statsNds(d.cierres, lim);
  const tv = calcConcrecion(d.ofertas).total;
  const servicios = new Set(d.servicios.map((s) => `${s.dia}|${s.servicio}`)).size;
  const aplican = d.quejas.filter((x) => x.a.aplica === "si").length;
  const csats = d.csat.map((c) => Number(c.csat)).filter((v) => isFinite(v));
  return {
    armados: gar.armados, productos: gar.total, servicios,
    cierre: { valor: nds.evaluados ? nds.pct : null, n: nds.evaluados, dentro: nds.dentro, fuera: nds.fuera, sinHora: nds.pend },
    garantias: { valor: gar.armados ? gar.pctGarantia : null, n: gar.garantias, base: gar.armados },
    concrecion: { valor: tv.programadas ? (tv.realizadas / tv.programadas) * 100 : null, n: tv.realizadas, base: tv.programadas, noRealizadas: tv.noRealizadas, reprogramadas: tv.reprogramadas },
    quejas: { valor: servicios ? (aplican / servicios) * 100 : null, n: aplican, base: servicios, total: d.quejas.length, revisar: d.quejas.filter((x) => x.a.aplica === "revisar").length },
    csat: { valor: csats.length ? csats.reduce((a, b) => a + b, 0) / csats.length : null, n: csats.length },
    hayDatos: !!(d.regs.length || d.cierres.length || d.ofertas.length || d.quejas.length || d.csat.length),
  };
}

// Semáforo de un indicador frente a su meta: "verde" / "naranja" / "rojo" (null si no hay dato).
export function semaforo(k, valor, metas) {
  if (valor === null || valor === undefined || !isFinite(valor)) return null;
  const meta = Number(metas[k]);
  const ind = INDICADORES.find((i) => i.k === k);
  if (ind.mejor === "alto") return valor >= meta ? "verde" : valor >= meta - 5 ? "naranja" : "rojo";
  return valor <= meta ? "verde" : valor <= meta * 1.5 ? "naranja" : "rojo";
}
// Puntaje 0 a 100 de un indicador frente a su meta: en la meta (o mejor) = 100. Si es de «más es mejor» (cierre, concreción, CSAT) baja en proporción a lo que le falta;
// si es de «menos es mejor» (garantías, quejas) baja linealmente hasta 0 cuando llega a 3 veces la meta.
export function puntajeIndicador(k, valor, metas) {
  if (valor === null || valor === undefined || !isFinite(valor)) return null;
  const meta = Number(metas[k]), ind = INDICADORES.find((i) => i.k === k);
  if (ind.mejor === "alto") return valor >= meta ? 100 : meta > 0 ? Math.max(0, (valor / meta) * 100) : 100;
  return valor <= meta ? 100 : meta > 0 ? Math.max(0, 100 - ((valor - meta) / (meta * 2)) * 100) : 0;
}
// Puntaje general: promedio simple de los indicadores que tienen dato (todos pesan igual, por ahora). null si no hay ninguno.
export function puntajeDe(ind, metas) {
  const ps = INDICADORES.map((i) => puntajeIndicador(i.k, ind[i.k].valor, metas)).filter((p) => p !== null);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
}
export const COLOR_SEMAFORO = { verde: "#12a166", naranja: "#ff9540", rojo: "#e0435c" };
export const alertasDe = (ind, metas) => INDICADORES.filter((i) => semaforo(i.k, ind[i.k].valor, metas) === "rojo").length;

// Une los datos de varios técnicos (para un departamento o un coordinador).
export function unir(lista) { const out = vacio(); lista.forEach((d) => Object.keys(out).forEach((k) => out[k].push(...d[k]))); return out; }

export const periodoDe = (iso, gran) => (!iso ? "" : gran === "mes" ? iso.slice(0, 7) : gran === "semana" ? semanaIso(iso) : iso);

// Serie de un conjunto de datos: un punto por periodo (día, semana o mes) con todos sus indicadores. El CSAT es mensual: en día y semana se repite el del mes.
export function serieDe(d, lim, gran) {
  const claves = new Set();
  const fechas = { regs: (x) => x.fecha, servicios: (x) => x.dia, cierres: (x) => x.closed_day, ofertas: (x) => x.fecha_prog, quejas: (x) => x.q.fecha };
  const por = {};
  Object.keys(fechas).forEach((k) => {
    por[k] = new Map();
    d[k].forEach((x) => { const p = periodoDe(fechas[k](x), gran); if (!p) return; claves.add(p); if (!por[k].has(p)) por[k].set(p, []); por[k].get(p).push(x); });
  });
  const csatPorMes = new Map(); d.csat.forEach((c) => { const m = String(c.mes).slice(0, 7); csatPorMes.set(m, (csatPorMes.get(m) || []).concat(c)); });
  if (gran === "mes") csatPorMes.forEach((_, m) => claves.add(m));
  return [...claves].sort().map((p) => {
    const sub = { regs: por.regs.get(p) || [], servicios: por.servicios.get(p) || [], cierres: por.cierres.get(p) || [], ofertas: por.ofertas.get(p) || [], quejas: por.quejas.get(p) || [], csat: [] };
    const mes = gran === "mes" ? p : (sub.regs[0] && sub.regs[0].fecha ? sub.regs[0].fecha.slice(0, 7) : (sub.cierres[0] ? sub.cierres[0].closed_day.slice(0, 7) : ""));
    sub.csat = csatPorMes.get(mes) || [];
    return { periodo: p, ...indicadoresDe(sub, lim) };
  });
}
