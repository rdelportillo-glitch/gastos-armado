// Quejas por incumplimiento: lectura del Excel que envía el cliente, guardado, cruce con el cierre de Extreme y el histórico de asignación,
// y reglas que proponen qué técnico fue el causante y si la queja le aplica o no.
//  · Lo que se guarda es lo del Excel y lo que la persona decida a mano. El análisis (técnico, hora de cierre, aplica) se calcula al abrir el reporte con los datos más recientes.
//  · Regla de la operación: si el técnico llama al cliente tarde (casi de noche), el cliente dice que no puede atender y el técnico cierra como «Cliente cancela», pero luego el cliente
//    pone la queja, el cliente no canceló: el técnico no llegó o avisó a destiempo. Ese caso SÍ aplica. La hora se valida con el reporte de Extreme (hora fin de trabajo).
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";
import { CSV_CARGA_HEADERS } from "./asignacion/csvCarga";

export const HORA_TARDE = 16; // desde esta hora (4 p. m.) un cierre «del cliente» se considera tardío
export const CAUSANTES = ["Técnico", "Asignación (Biver)", "Cliente", "Fuerza mayor", "Otro"];

export const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const mesLargo = (k) => { const [y, m] = String(k).split("-").map(Number); return `${MESES[m - 1]} ${y}`; };
export const mesLabel = (k) => { const [y, m] = String(k).split("-").map(Number); return `${MESES[m - 1].slice(0, 3)} ${String(y).slice(2)}`; };
export const finDeMes = (k) => { const [y, m] = k.split("-").map(Number); return `${k}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
export const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);

/* ------------------------------ Lectura del Excel ------------------------------ */

const COLS = {
  fecha: ["FECHA"], caso: ["CASO", "NUMERO DE CASO", "NO CASO"], servicio: ["SERVICIO", "NUMERO DE SERVICIO"],
  informacion: ["INFORMACION DEL CASO SALESFORCE", "INFORMACION DEL CASO", "INFORMACION"], diagnostico: ["DIAGNOSTICO DEL TECNICO", "DIAGNOSTICO"],
  pregunta: ["PREGUNTA"], subcausal: ["SUBCAUSAL"], causal: ["CAUSAL DE CIERRE", "CAUSAL CIERRE", "CAUSAL"], departamento: ["DEPARTAMENTO", "DPTO"], proveedor: ["PROVEEDOR"],
};

// La fecha del Excel viene como instante UTC de medianoche de Colombia (05:00 UTC): se pasa al día de Colombia.
export function diaDeCelda(v) {
  if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() - 5 * 3600000).toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

export function leerExcelQuejas(buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const iHead = filas.findIndex((r) => (r || []).some((c) => plano(c) === "CASO") && (r || []).some((c) => plano(c) === "SERVICIO"));
  if (iHead < 0) throw new Error("No encontré las columnas «Caso» y «Servicio» en el Excel. Revisa que sea el archivo de quejas por incumplimiento.");
  const idx = {};
  const cab = filas[iHead].map((c) => plano(c));
  Object.entries(COLS).forEach(([k, nombres]) => { idx[k] = cab.findIndex((c) => nombres.includes(c)); });
  const avisos = []; const out = []; const vistos = new Set();
  const txt = (r, k) => (idx[k] >= 0 && r[idx[k]] !== null && r[idx[k]] !== undefined ? String(r[idx[k]]).trim() : "");
  filas.slice(iHead + 1).forEach((r, i) => {
    if (!r || r.every((c) => c === null || String(c).trim() === "")) return;
    const caso = txt(r, "caso").replace(/\.0$/, ""), servicio = txt(r, "servicio").replace(/\.0$/, "");
    const fecha = diaDeCelda(idx.fecha >= 0 ? r[idx.fecha] : "");
    if (!caso) { avisos.push(`Fila ${iHead + i + 2}: sin número de caso, se omitió.`); return; }
    if (!fecha) { avisos.push(`Caso ${caso}: la fecha no se pudo leer, se omitió.`); return; }
    if (vistos.has(caso)) { avisos.push(`Caso ${caso}: está repetido en el archivo, se tomó la primera fila.`); return; }
    vistos.add(caso);
    out.push({
      caso, fecha, servicio, informacion_caso: txt(r, "informacion"), diagnostico: txt(r, "diagnostico"), pregunta: txt(r, "pregunta"), subcausal: txt(r, "subcausal"),
      causal_cierre: txt(r, "causal"), departamento: txt(r, "departamento"), proveedor: txt(r, "proveedor"),
    });
  });
  if (!out.length) throw new Error("El Excel no trae quejas (filas con caso y fecha).");
  return { filas: out, avisos };
}

/* ------------------------------ Base de datos ------------------------------ */

export async function cargarQuejas() {
  const out = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase.from("quejas_incumplimiento").select("*").order("fecha", { ascending: false }).order("caso").range(start, start + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Guarda lo del Excel. No se mandan las columnas manuales: así, volver a cargar un caso actualiza el Excel y respeta lo que la persona decidió.
export async function guardarQuejas(filas, { archivo, userId, empresa }) {
  const lista = filas.map((f) => ({ ...f, empresa: plano(empresa) || "JAMAR", source_file: archivo || null, loaded_by: userId || null }));
  for (let i = 0; i < lista.length; i += 200) {
    const { error } = await supabase.from("quejas_incumplimiento").upsert(lista.slice(i, i + 200), { onConflict: "caso" });
    if (error) throw new Error(error.message);
  }
  return lista.length;
}

export async function guardarDecision(id, { aplica, causante, technicianId, comentario, userId }) {
  const { data, error } = await supabase.from("quejas_incumplimiento").update({
    aplica_manual: aplica || null, causante_manual: causante || null, technician_manual_id: technicianId || null, comentario: String(comentario || "").trim() || null,
    revisado_por: userId || null, revisado_at: new Date().toISOString(),
  }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function quitarQueja(id) {
  const { error } = await supabase.from("quejas_incumplimiento").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

async function porServicio(tabla, servicios, cols) {
  const out = [];
  const unicos = [...new Set(servicios.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 100) {
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from(tabla).select(cols).in("servicio", unicos.slice(i, i + 100)).range(start, start + 999);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

// Cierres de Extreme e histórico de asignación de los servicios de las quejas, agrupados por número de servicio.
export async function cargarContexto(quejas) {
  const servicios = quejas.map((q) => String(q.servicio || "").trim()).filter(Boolean);
  const [ext, hist] = await Promise.all([
    porServicio("cierre_extreme", servicios, "servicio,clave,unidad,closed_day,closed_hour,closed_at,technician_id,tecnico,coordinador,departamento,municipio,estado,causal"),
    porServicio("assignment_history", servicios, "day,servicio,producto,quantity,technician_id,technician_name,resultado,causal_extreme,causal_auditada,departamento,ciudad,anulado"),
  ]);
  const agrupar = (rows) => { const m = new Map(); rows.forEach((r) => { const k = String(r.servicio); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); return m; };
  return { extreme: agrupar(ext), historia: agrupar(hist.filter((h) => !h.anulado)) };
}

/* ------------------------------ Análisis ------------------------------ */

const REG_ERROR_ASIG = /ERROR EN ASIGNACION|ERROR DE ASIGNACION/;
const REG_FUERZA_MAYOR = /FUERZA MAYOR/;
const REG_POSTERIOR = /REALIZADO POSTERIORMENTE|NO SE REALIZO EL DIA|NO SE REALIZO ESE DIA/;
const REG_CLIENTE = /CLIENTE CANCELA|CLIENTE ARMA|CLIENTE REPROGRAMA|CLIENTE NO |CLIENTE AUSENTE|NO CONTESTA|NO ATIENDE|DIRECCION ERRADA|VISITA NO EFECTIVA|AUSENTE|CLIENTE DESISTE/;
const REG_TARDE_TEXTO = /MUY TARDE|POR LA HORA|POR EL HORARIO|HORA TARDE|YA ERA TARDE|ERA DE NOCHE/;
const REG_EVIDENCIA = /FALS[AO]|NO PASO EL REPORTE|NO REPORTO|NO SE COMUNICO|NUNCA SE VOLVIO A COMUNICAR|NO LLAMO|SIN EVIDENCIA|NO SUBE (LA )?EVIDENCIA|NO REGISTRA EN LA BASE|CONFIRMA EL ARMADO|CONFIRMADO POR EL CLIENTE|ES DEL PASADO|NO FUE ARMAD|NO LLEGO|NO SE PRESENTO|NO LLAMARON|NO TUVO COMUNICACION|DURA \d{1,2} SEGUNDOS/;

export const horaTxt = (hhmm) => { // "16:45" → "4:45 p. m."
  const [h, m] = String(hhmm).split(":").map(Number); if (isNaN(h)) return "";
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
};

const ultimoDia = (rows, campo, fecha) => {
  const dias = [...new Set(rows.map((r) => r[campo]).filter(Boolean))].sort();
  const antes = dias.filter((d) => d <= fecha);
  return antes.length ? antes[antes.length - 1] : dias[dias.length - 1] || null;
};

// Cierre de Extreme del servicio: el último día cerrado hasta la fecha de la queja y su hora más tardía.
export function cierreDe(servicio, fecha, ctx) {
  const rows = (ctx.extreme.get(String(servicio)) || []).filter((r) => r.closed_day);
  if (!rows.length) return null;
  const dia = ultimoDia(rows, "closed_day", fecha);
  const delDia = rows.filter((r) => r.closed_day === dia);
  const hh = (r) => (r.closed_at ? String(r.closed_at).slice(11, 16) : r.closed_hour !== null && r.closed_hour !== undefined ? `${String(r.closed_hour).padStart(2, "0")}:00` : "");
  const conHora = delDia.filter((r) => hh(r)).sort((a, b) => hh(a).localeCompare(hh(b)));
  const r = conHora.length ? conHora[conHora.length - 1] : delDia[0];
  return { dia, hora: hh(r) || null, minutos: !!r.closed_at, causal: r.causal || "", estado: r.estado || "", technician_id: r.technician_id || null, tecnico: r.tecnico || "", coordinador: r.coordinador || "", departamento: r.departamento || "" };
}

export function historiaDe(servicio, fecha, ctx) {
  const rows = ctx.historia.get(String(servicio)) || [];
  if (!rows.length) return null;
  const dia = ultimoDia(rows, "day", fecha);
  const delDia = rows.filter((r) => r.day === dia);
  const productos = delDia.map((r) => `${r.producto || "producto"}${(Number(r.quantity) || 1) > 1 ? ` x${r.quantity}` : ""}`);
  const r = delDia[0];
  return { dia, technician_id: r.technician_id || null, tecnico: r.technician_name || "", resultado: r.resultado || "", causal: r.causal_auditada || r.causal_extreme || "", productos };
}

const nuevosServicios = (q) => [...new Set((String(q.diagnostico || "").match(/\b5\d{6}\b/g) || []).filter((n) => n !== String(q.servicio)))];

// Qué técnico y si la queja le aplica. tecnicos: Personal. ctx: cargarContexto. cargaDelDia(technician_id, dia) → servicios de ese técnico ese día (opcional).
export function analizarQueja(q, ctx, { tecnicos = [], limite = HORA_TARDE, cargaDelDia } = {}) {
  const techById = new Map((tecnicos || []).map((t) => [t.id, t]));
  const cierre = q.servicio ? cierreDe(q.servicio, q.fecha, ctx) : null;
  const hist = q.servicio ? historiaDe(q.servicio, q.fecha, ctx) : null;

  // Técnico causante: lo que decida la persona; si no, el de Extreme el día del cierre; si no, el del histórico.
  let tecnico = { id: null, nombre: "", fuente: "" };
  const manual = q.technician_manual_id && techById.get(q.technician_manual_id);
  if (manual) tecnico = { id: manual.id, nombre: manual.name, fuente: "manual" };
  else if (cierre && (cierre.technician_id || cierre.tecnico)) tecnico = { id: cierre.technician_id, nombre: (cierre.technician_id && techById.get(cierre.technician_id) && techById.get(cierre.technician_id).name) || cierre.tecnico, fuente: "Extreme" };
  else if (hist && (hist.technician_id || hist.tecnico)) tecnico = { id: hist.technician_id, nombre: (hist.technician_id && techById.get(hist.technician_id) && techById.get(hist.technician_id).name) || hist.tecnico, fuente: "histórico" };

  const causal = plano(q.causal_cierre || (cierre && cierre.causal) || (hist && hist.causal) || "");
  const sub = plano(q.subcausal);
  const diag = plano(q.diagnostico);
  const hora = cierre && cierre.hora ? Number(cierre.hora.slice(0, 2)) : null;
  const tarde = hora !== null && hora >= limite;
  const horaLinda = cierre && cierre.hora ? horaTxt(cierre.hora) : "";
  const limiteTxt = horaTxt(`${limite}:00`);
  const evidencia = REG_EVIDENCIA.test(`${diag} ${plano(q.informacion_caso)}`);

  let aplica, origen, motivo, regla;
  if (REG_ERROR_ASIG.test(sub) || REG_ERROR_ASIG.test(causal)) {
    aplica = "revisar"; origen = "Asignación (Biver)"; regla = "error-asignacion";
    motivo = "El cliente la calificó como error en la asignación. Verifica si el producto reclamado estaba en la orden asignada al técnico (productos del histórico abajo) antes de decidir si le aplica."
      + (hist && hist.productos.length ? ` Asignado ese día: ${hist.productos.join(", ")}.` : "");
  } else if (REG_FUERZA_MAYOR.test(causal)) {
    if (evidencia || tarde) { aplica = "si"; origen = "Técnico"; regla = "fuerza-mayor-sin-aviso"; motivo = `Cerró como fuerza mayor${horaLinda ? ` a las ${horaLinda}` : ""}, pero el técnico no avisó ni reportó al cliente (el cliente dice que nunca volvió a comunicarse).`; }
    else { aplica = "no"; origen = "Fuerza mayor"; regla = "fuerza-mayor"; motivo = "Cerrado por fuerza mayor y no hay señal de falta de aviso del técnico."; }
  } else if (REG_POSTERIOR.test(sub) || REG_POSTERIOR.test(causal) || REG_POSTERIOR.test(diag)) {
    aplica = "si"; origen = "Técnico"; regla = "no-cumplio-dia";
    motivo = "El servicio no se hizo el día acordado con el cliente y se realizó después: incumplimiento del técnico.";
  } else if (REG_CLIENTE.test(causal)) {
    if (tarde) { aplica = "si"; origen = "Técnico"; regla = "cierre-tardio"; motivo = `Cerró «${q.causal_cierre || causal}» a las ${horaLinda}, después de las ${limiteTxt}: llamó al cliente tarde y el cliente no canceló de verdad; el técnico no llegó o avisó a destiempo.`; }
    else if (REG_TARDE_TEXTO.test(diag)) { aplica = "si"; origen = "Técnico"; regla = "cierre-tardio-texto"; motivo = `Cerró «${q.causal_cierre || causal}» por la hora: el propio diagnóstico dice que ya era tarde.${horaLinda ? ` (cierre en Extreme: ${horaLinda})` : " (no hay hora de cierre en Extreme)"}.`; }
    else if (evidencia) { aplica = "si"; origen = "Técnico"; regla = "evidencia"; motivo = `Cerró «${q.causal_cierre || causal}», pero el cliente lo desmiente y la evidencia del técnico no sostiene el cierre (ver diagnóstico)${horaLinda ? `; cierre en Extreme: ${horaLinda}` : ""}.`; }
    else {
      aplica = "revisar"; origen = "Técnico"; regla = "revisar-cliente";
      motivo = horaLinda ? `Cerró «${q.causal_cierre || causal}» a las ${horaLinda} (antes de las ${limiteTxt}). El cliente lo niega: valida la evidencia (llamada o foto) y decide.` : `Cerró «${q.causal_cierre || causal}», pero no hay hora de cierre en Extreme para ese servicio: carga el reporte de Extreme del día y vuelve a abrir el reporte.`;
    }
  } else {
    aplica = "revisar"; origen = "Técnico"; regla = "sin-regla";
    motivo = "No coincide con ninguna regla automática: lee el caso y decide.";
  }

  motivo = motivo.replace(/\.\.+$/, "."); // "a. m.." → "a. m."

  // Datos de apoyo para entender el caso
  const extras = [];
  if (!q.servicio) extras.push("La queja no trae número de servicio.");
  else if (!cierre && !hist) extras.push("El servicio no aparece en Extreme ni en el histórico: no se pudo identificar al técnico.");
  else if (!cierre) extras.push("Sin cierre en Extreme para este servicio: la hora de cierre no se pudo validar.");
  if (cierre && cierre.dia && cierre.dia > q.fecha) extras.push(`Ojo: el único cierre en Extreme es del ${cierre.dia}, posterior a la queja.`);
  const nuevos = nuevosServicios(q); if (nuevos.length) extras.push(`Al cliente se le creó ${nuevos.length > 1 ? "nuevos servicios" : "un nuevo servicio"}: ${nuevos.join(", ")}.`);
  const carga = cargaDelDia && tecnico.id ? cargaDelDia(tecnico.id, (cierre && cierre.dia) || (hist && hist.dia) || q.fecha) : null;
  if (carga) extras.push(`Ese día el técnico tenía ${carga} servicio${carga === 1 ? "" : "s"} asignado${carga === 1 ? "" : "s"}.`);

  // Lo que decidió la persona manda sobre el análisis
  const aplicaFinal = q.aplica_manual || aplica;
  const origenFinal = q.causante_manual || (q.aplica_manual === "no" && origen === "Técnico" ? "Otro" : origen);
  return {
    tecnico, cierre, hist, aplica: aplicaFinal, aplicaAuto: aplica, origen: origenFinal, regla, tarde, carga,
    manual: !!(q.aplica_manual || q.causante_manual || q.technician_manual_id), motivo, extras, nuevos,
    comentario: q.comentario || "",
  };
}

/* ------------------------------ Servicios armados (denominador) ------------------------------ */

const IDX_EMPRESA = CSV_CARGA_HEADERS.indexOf("EMPRESA");
// Empresa de una fila del histórico: la del CSV guardado al cerrar el día; si no, la del registro de servicio; si no, la del almacén; si no, JAMAR (empresa por defecto de la plataforma).
export function empresaDeFila(r, svcById, empresaDe) {
  if (Array.isArray(r.fila_csv) && IDX_EMPRESA >= 0 && String(r.fila_csv[IDX_EMPRESA] || "").trim()) return plano(r.fila_csv[IDX_EMPRESA]);
  const s = svcById && svcById.get(r.service_id);
  if (s && s.asig && s.asig.empresa) return plano(s.asig.empresa);
  const e = empresaDe ? empresaDe(r) : "";
  return e ? plano(e) : "JAMAR";
}

// Servicios armados (únicos por día y número de servicio, resultado Realizado) de una empresa. Devuelve totales por mes, por técnico y por departamento, y los de otras empresas que quedaron fuera.
export function serviciosArmados(historia, { empresa = "JAMAR", services = [], empresaDe } = {}) {
  const svcById = new Map((services || []).map((s) => [s.id, s]));
  const emp = plano(empresa);
  const vistos = new Set(); const porMes = new Map(), porMesTec = new Map(), porMesDepto = new Map(), cargaDia = new Map(); const fuera = new Map();
  const suma = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  (historia || []).forEach((r) => {
    if (r.anulado || r.resultado !== "Realizado") return;
    const id = `${r.day}|${r.servicio}`;
    if (vistos.has(id)) return;
    vistos.add(id);
    const e = empresaDeFila(r, svcById, empresaDe);
    const mes = String(r.day).slice(0, 7);
    if (r.technician_id) suma(cargaDia, `${r.technician_id}|${r.day}`); // la carga del técnico cuenta todos sus servicios, de cualquier empresa
    if (emp && e !== emp) { suma(fuera, `${mes}|${e}`); return; }
    suma(porMes, mes);
    suma(porMesTec, `${mes}|${r.technician_id || plano(r.technician_name) || "-"}`);
    suma(porMesDepto, `${mes}|${plano(r.departamento)}`);
  });
  return { porMes, porMesTec, porMesDepto, cargaDia, fuera };
}

// Todas las empresas que aparecen en las filas realizadas (para el selector).
export function empresasEnHistoria(historia, { services = [], empresaDe } = {}) {
  const svcById = new Map((services || []).map((s) => [s.id, s]));
  return [...new Set((historia || []).filter((r) => !r.anulado && r.resultado === "Realizado").map((r) => empresaDeFila(r, svcById, empresaDe)))].sort();
}

/* ------------------------------ Resumen ------------------------------ */

export const cuenta = (items) => ({ total: items.length, aplican: items.filter((x) => x.a.aplica === "si").length, noAplican: items.filter((x) => x.a.aplica === "no").length, revisar: items.filter((x) => x.a.aplica === "revisar").length });
