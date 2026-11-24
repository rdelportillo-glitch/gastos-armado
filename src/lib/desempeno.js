// "Mi desempeño" del técnico: lo que el administrador u operador publica desde el reporte Técnico integral (una fila por técnico y mes) y lo que el técnico lee.
// Se usa el mismo cálculo del reporte (lib/tecnicoIntegral.js), así los números del técnico coinciden con los de la administración. El ranking se publica solo como posición
// (puesto y total), nunca con datos de otros técnicos; el detalle no lleva nombres, teléfonos ni direcciones de clientes.
import { supabase } from "./supabaseClient";
import * as TI from "./tecnicoIntegral";
import { estadoNds } from "./cierreExtreme";

const MAX_DETALLE = 200; // filas máximas de cada lista de detalle
const r1 = (v) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
const claveDepto = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const corto = (s, n = 220) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };

// Texto corto de cada indicador (el mismo del reporte).
export function textoIndicador(k, i) {
  const n = (v) => Number(v || 0).toLocaleString("es-CO");
  switch (k) {
    case "cierre": return i.cierre.n ? `${i.cierre.dentro} de ${i.cierre.n} a tiempo${i.cierre.sinHora ? ` · ${i.cierre.sinHora} sin hora` : ""}` : "sin cierres";
    case "garantias": return i.armados ? `${i.garantias.n} de ${i.armados} armados` : "sin armados";
    case "concrecion": return i.concrecion.base ? `${i.concrecion.n} de ${i.concrecion.base} programadas` : "sin instalaciones";
    case "quejas": return `${i.quejas.n} de ${i.quejas.total} quejas · ${n(i.servicios)} servicios`;
    case "csat": return i.csat.n ? `${i.csat.n} mes(es)` : "sin CSAT";
    case "monitoreos": return i.monitoreos.n ? `${i.monitoreos.n} monitoreo(s)${i.monitoreos.criticos ? ` · ${i.monitoreos.criticos} con error crítico` : ""}` : "sin monitoreos";
    case "productividad": return i.productividad.n ? `${n(Math.round(i.productividad.promedio))} min/día · ${i.productividad.n} días` : "sin datos";
    default: return "";
  }
}

// Posición de cada id dentro de un grupo: 1 + cuántos están estrictamente mejor (los empatados comparten puesto). items: [{ id, v }]; mejor: "alto" | "bajo".
function posiciones(items, mejor) {
  const con = items.filter((x) => x.v !== null && x.v !== undefined && isFinite(x.v)).map((x) => ({ id: x.id, v: Math.round(x.v * 1e4) / 1e4 }));
  const out = new Map();
  con.forEach((x) => out.set(x.id, { pos: 1 + con.filter((o) => (mejor === "alto" ? o.v > x.v : o.v < x.v)).length, total: con.length }));
  return out;
}

// Filas a publicar. tecnicos: Personal (los que entran al ranking) · porTec: Map id → datos del reporte · metas · lim: hora límite del cierre en línea · periodo AAAA-MM, desde y hasta (YYYY-MM-DD).
export function construirPublicacion({ tecnicos, porTec, metas, lim, periodo, desde, hasta, userId }) {
  const poblacion = (tecnicos || []).filter((t) => t.status !== "Retirado" && t.category !== "Administrativo").map((t) => {
    const d = (porTec && porTec.get(t.id)) || TI.datosVacios();
    const ind = TI.indicadoresDe(d, lim);
    const depto = t.department || "Sin departamento";
    return { t, d, ind, depto, dk: claveDepto(depto), puntaje: TI.puntajeDe(ind, metas) };
  }).filter((x) => x.ind.hayDatos);
  // El departamento se agrupa sin tildes ni mayúsculas ("Bolívar" y "BOLIVAR" son el mismo), para que el ranking no se parta por cómo está escrito en Personal.
  const deDepto = (dk) => poblacion.filter((x) => x.dk === dk);
  const rankGeneral = (k) => {
    const valor = (x) => (k === "puntaje" ? x.puntaje : x.ind[k].valor);
    const mejor = k === "puntaje" ? "alto" : TI.INDICADORES.find((i) => i.k === k).mejor;
    const nac = posiciones(poblacion.map((x) => ({ id: x.t.id, v: valor(x) })), mejor);
    const dep = new Map(); [...new Set(poblacion.map((x) => x.dk))].forEach((dk) => posiciones(deDepto(dk).map((x) => ({ id: x.t.id, v: valor(x) })), mejor).forEach((v, id) => dep.set(id, v)));
    return { nac, dep };
  };
  const rankPor = { puntaje: rankGeneral("puntaje") };
  TI.INDICADORES.forEach((i) => { rankPor[i.k] = rankGeneral(i.k); });
  const ahora = new Date().toISOString();

  return poblacion.map((x) => {
    const id = x.t.id;
    const g = { nac: rankPor.puntaje.nac.get(id), dep: rankPor.puntaje.dep.get(id) };
    const indicadores = TI.INDICADORES.map((i) => {
      const v = x.ind[i.k].valor, rk = rankPor[i.k];
      return { k: i.k, t: i.t, mejor: i.mejor, valor: r1(v), meta: Number(metas[i.k]), semaforo: TI.semaforo(i.k, v, metas), puntaje: r1(TI.puntajeIndicador(i.k, v, metas)), texto: textoIndicador(i.k, x.ind),
        rank_depto: rk.dep.get(id) ? rk.dep.get(id).pos : null, total_depto: rk.dep.get(id) ? rk.dep.get(id).total : null, rank_nacional: rk.nac.get(id) ? rk.nac.get(id).pos : null, total_nacional: rk.nac.get(id) ? rk.nac.get(id).total : null };
    });
    const d = x.d;
    const detalle = {
      resumen: { armados: x.ind.armados, productos: x.ind.productos, servicios: x.ind.servicios, cierres_fuera: x.ind.cierre.fuera, cierres_sin_hora: x.ind.cierre.sinHora },
      // Quejas: el motivo solo si ya se revisó (el texto de «por revisar» es una instrucción para quien decide, no para el técnico).
      quejas: d.quejas.map(({ q, a }) => ({ fecha: q.fecha || null, caso: q.caso || "", servicio: q.servicio || "", aplica: a.aplica, motivo: a.aplica === "revisar" ? "" : corto(a.motivo) }))
        .sort((p, q) => String(q.fecha).localeCompare(String(p.fecha))).slice(0, MAX_DETALLE),
      cierres_fuera: d.cierres.filter((c) => estadoNds(c, lim) === "fuera").map((c) => ({ dia: c.closed_day, hora: c.closed_hour, servicio: c.servicio || "", clave: c.clave || "", programado: c.scheduled_day || null, estado: c.estado || "", causal: corto(c.causal, 80) }))
        .sort((p, q) => String(q.dia).localeCompare(String(p.dia))).slice(0, MAX_DETALLE),
      garantias: d.regs.filter((r) => r.garantia).map((r) => ({ fecha: r.fecha || null, servicio: r.servicio, producto: r.producto, notas: corto(r.notas), diagnostico: corto(r.diagnostico) }))
        .sort((p, q) => String(q.fecha).localeCompare(String(p.fecha))).slice(0, MAX_DETALLE),
      monitoreos_bajo: d.mon.filter((m) => m.critico || (Number(m.score) || 0) < Number(metas.monitoreos)).map((m) => ({ fecha: m.fecha || null, no: m.no || "", canal: m.canal || "", servicio: m.servicio || "", score: r1(Number(m.score) || 0), luz: m.luz || "", critico: !!m.critico, tipo_critico: m.tipoCritico || "" }))
        .sort((p, q) => String(q.fecha).localeCompare(String(p.fecha))).slice(0, MAX_DETALLE),
    };
    return {
      technician_id: id, periodo, desde, hasta, departamento: x.depto, puntaje: r1(x.puntaje),
      rank_depto: g.dep ? g.dep.pos : null, total_depto: g.dep ? g.dep.total : null, rank_nacional: g.nac ? g.nac.pos : null, total_nacional: g.nac ? g.nac.total : null,
      indicadores, detalle, metas, publicado_por: userId || null, publicado_at: ahora,
    };
  });
}

export async function publicarDesempeno(filas) {
  for (let i = 0; i < filas.length; i += 25) {
    const { error } = await supabase.from("tecnico_desempeno").upsert(filas.slice(i, i + 25), { onConflict: "technician_id,periodo" });
    if (error) throw new Error(error.message);
  }
  return filas.length;
}

// Última publicación de un mes (para mostrarla en el reporte): { publicado_at, publicado_por, tecnicos } o null.
export async function ultimaPublicacion(periodo) {
  const { data, error } = await supabase.from("tecnico_desempeno").select("publicado_at,publicado_por,hasta").eq("periodo", periodo).order("publicado_at", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  if (!data || !data.length) return null;
  return { publicado_at: data[0].publicado_at, publicado_por: data[0].publicado_por, hasta: data[0].hasta, tecnicos: data.length };
}

// Lo publicado de un técnico (el técnico recibe solo lo suyo por permisos; el administrador pide el de un técnico con technicianId). Devuelve las filas, la más reciente primero.
export async function cargarDesempeno({ technicianId } = {}) {
  let q = supabase.from("tecnico_desempeno").select("*").order("periodo", { ascending: false });
  if (technicianId) q = q.eq("technician_id", technicianId);
  const { data, error } = await q.limit(technicianId ? 24 : 24);
  if (error) throw new Error(error.message);
  return data || [];
}
