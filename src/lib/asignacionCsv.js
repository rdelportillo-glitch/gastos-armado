// Cargar a Carga una asignación descargada en CSV desde Asignación, cuando no se alcanzó a hacer "Enviar a Carga".
// El CSV trae, por producto, el técnico (y el apoyo) que le asignó el motor; los servicios siguen Pendientes en la base, así que aquí se les aplica esa asignación igual que lo hace
// "Enviar a Carga" (applyPlanToServices): técnico, apoyo, orden de ruta (el del servicio dentro de la ruta de su técnico), estado En gestión y la fecha de la asignación.
// Lo que ya está en Carga (En gestión o Realizado) o ya se finalizó no se toca, y nada se crea: si un servicio no está en la base, se avisa.
import { existingForUnit } from "./asignacion/data";

const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

// CSV con ; (el de Asignación) o , — con comillas. Devuelve la matriz de filas sin las vacías.
function parseDelimitado(texto) {
  const t = String(texto || "").replace(/^﻿/, "");
  const primera = t.split(/\r?\n/, 1)[0] || "";
  const sep = (primera.match(/;/g) || []).length >= (primera.match(/,/g) || []).length ? ";" : ",";
  const filas = []; let fila = [], campo = "", comillas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) { if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += ch; }
    else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ""; }
    else if (ch === "\n") { fila.push(campo.replace(/\r$/, "")); filas.push(fila); fila = []; campo = ""; }
    else campo += ch;
  }
  if (campo !== "" || fila.length) { fila.push(campo.replace(/\r$/, "")); filas.push(fila); }
  return filas.filter((f) => f.some((c) => String(c).trim() !== ""));
}

const aISO = (v) => {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
};

// Lee el CSV de Asignación. Devuelve { filas: [{ fila, servicio, codigo, producto, tecnico, apoyo, fecha }] } o lanza un Error entendible.
export function leerCsvAsignacion(texto) {
  const m = parseDelimitado(texto);
  if (m.length < 2) throw new Error("El archivo no tiene filas con servicios.");
  const col = {};
  m[0].forEach((c, i) => { const k = plano(c); if (col[k] === undefined) col[k] = i; });
  const falta = ["SERVICIO", "CODIGO", "TECNICO", "FECHA"].filter((k) => col[k] === undefined);
  if (falta.length) throw new Error(`No parece el CSV de Asignación: faltan las columnas ${falta.join(", ")}.`);
  const v = (r, k) => (col[k] === undefined ? "" : String(r[col[k]] ?? "").trim());
  const filas = m.slice(1).map((r, i) => ({ fila: i + 2, servicio: v(r, "SERVICIO"), codigo: v(r, "CODIGO"), producto: v(r, "PRODUCTO"), tecnico: v(r, "TECNICO"), apoyo: v(r, "APOYO"), fecha: aISO(v(r, "FECHA")) })).filter((x) => x.servicio);
  if (!filas.length) throw new Error("El archivo no tiene filas con servicios.");
  return { filas };
}

// Qué se le haría a cada servicio del CSV. services: registros de Carga/Asignación (db.services) · technicians: Personal.
// Cada item: { servicio, fecha, unidades, tecnicoTxt, apoyoTxt, tecnico, apoyo, orden, asignar: [ids], ya: [{ id, estado }], faltan, errores, avisos, estado }
// estado: "ok" (se asigna) · "parcial" (se asigna una parte; el resto ya estaba en Carga o falta) · "ya" (todo estaba ya en Carga o finalizado) · "falta" (no está en la base) · "sin-tecnico" (el CSV no trae técnico: se deja) · "error"
export function planAsignacionCsv({ filas, services, technicians }) {
  const porNombre = new Map(), porCodigo = new Map();
  (technicians || []).forEach((t) => { const k = plano(t.name); if (k) porNombre.set(k, porNombre.has(k) ? null : t); if (t.code) porCodigo.set(plano(t.code), t); });
  const buscarTec = (txt) => { const k = plano(txt); return k ? porNombre.get(k) || porCodigo.get(k) || null : null; };

  const porClave = new Map(); // servicio|código → registros abiertos (no finalizados ni anulados)
  (services || []).filter((s) => s.servicioExterno && !s.finalizedAt && !(s.asig && s.asig.anulada)).forEach((s) => {
    const k = `${s.servicioExterno}|${s.productoExternoCodigo || ""}`;
    porClave.set(k, [...(porClave.get(k) || []), s]);
  });

  const grupos = new Map(); // servicio → filas, en el orden en que aparece cada servicio
  filas.forEach((f) => { if (!grupos.has(f.servicio)) grupos.set(f.servicio, []); grupos.get(f.servicio).push(f); });

  const ordenPorTecnico = new Map();
  const items = [...grupos.entries()].map(([servicio, fs]) => {
    const distintos = (k) => [...new Set(fs.map((f) => f[k]).filter(Boolean).map(plano))];
    const tecnicoTxt = fs.map((f) => f.tecnico).find(Boolean) || "", apoyoTxt = fs.map((f) => f.apoyo).find(Boolean) || "";
    const it = { servicio, fecha: fs.map((f) => f.fecha).find(Boolean) || "", unidades: fs.length, tecnicoTxt, apoyoTxt, tecnico: null, apoyo: null, orden: null, asignar: [], ya: [], faltan: 0, errores: [], avisos: [], estado: "ok" };
    if (distintos("tecnico").length > 1) it.errores.push(`El servicio tiene técnicos distintos en sus filas (${distintos("tecnico").join(", ")}).`);
    if (!tecnicoTxt) { it.estado = "sin-tecnico"; return it; }
    it.tecnico = buscarTec(tecnicoTxt);
    if (!it.tecnico) it.errores.push(`El técnico «${tecnicoTxt}» no está en Personal (nombre o código).`);
    else if (it.tecnico.status !== "Activo") it.errores.push(`El técnico «${it.tecnico.name}» no está activo (${it.tecnico.status}).`);
    if (apoyoTxt) { it.apoyo = buscarTec(apoyoTxt); if (!it.apoyo) it.avisos.push(`El apoyo «${apoyoTxt}» no está en Personal: se guarda con ese nombre.`); }
    if (!it.fecha) it.errores.push("El servicio no trae una FECHA válida.");
    // cada fila es una unidad de producto: la unidad N de servicio+código se cruza con el N-ésimo registro de esa base
    const vistas = new Map(); const usados = new Set();
    fs.forEach((f) => {
      const k = `${servicio}|${f.codigo}`; const unidad = (vistas.get(k) || 0) + 1; vistas.set(k, unidad);
      const rec = existingForUnit(porClave.get(k) || [], unidad);
      if (!rec) { it.faltan++; return; }
      if (usados.has(rec.id)) return; // un registro antiguo que agrupa varias unidades se asigna una sola vez
      usados.add(rec.id);
      if (rec.estadoGestion === "Pendiente" && !(rec.asig && rec.asig.cancelada)) it.asignar.push(rec.id);
      else it.ya.push({ id: rec.id, estado: rec.asig && rec.asig.cancelada ? "Cancelado" : rec.estadoGestion || "Realizado" });
    });
    if (it.errores.length) it.estado = "error";
    else if (!it.asignar.length && !it.ya.length) it.estado = "falta";
    else if (!it.asignar.length) it.estado = "ya";
    else if (it.ya.length || it.faltan) it.estado = "parcial";
    // orden de ruta: el del servicio dentro de la ruta de su técnico (en el orden del CSV), solo de lo que de verdad se asigna
    if (it.tecnico && it.asignar.length && !it.errores.length) { const n = (ordenPorTecnico.get(it.tecnico.id) || 0) + 1; ordenPorTecnico.set(it.tecnico.id, n); it.orden = n; }
    return it;
  });
  const cuenta = (e) => items.filter((x) => x.estado === e);
  const seAsignan = items.filter((x) => x.estado === "ok" || x.estado === "parcial"); // los que tienen error no se tocan
  return {
    items,
    resumen: {
      servicios: items.length, productos: filas.length,
      porAsignar: seAsignan.length, registrosPorAsignar: seAsignan.reduce((a, x) => a + x.asignar.length, 0),
      yaEnCarga: cuenta("ya").length, noEncontrados: cuenta("falta").length, sinTecnico: cuenta("sin-tecnico").length, conError: cuenta("error").length,
      tecnicos: new Set(seAsignan.filter((x) => x.tecnico).map((x) => x.tecnico.id)).size,
    },
  };
}

// Aplica el plan a los registros (igual que applyPlanToServices). Devuelve { services, asignados }.
export function aplicarAsignacionCsv(services, items) {
  const porId = new Map();
  items.filter((x) => !x.errores.length && x.tecnico && x.asignar.length).forEach((x) => x.asignar.forEach((id) => porId.set(id, x)));
  let asignados = 0;
  const next = (services || []).map((s) => {
    const x = porId.get(s.id);
    if (!x) return s;
    asignados++;
    const { devueltoFecha, ...asigSinMarca } = s.asig || {};
    return {
      ...s, technicianId: x.tecnico.id, tecnico2Nombre: x.tecnico.name, tecnico3Nombre: x.apoyo ? x.apoyo.name : (x.apoyoTxt || ""), rutaOrden: x.orden, estadoGestion: "En gestión", date: x.fecha, fechaProg: x.fecha,
      asig: s.asig ? { ...asigSinMarca, tecnicoOriginal: { id: x.tecnico.id, nombre: x.tecnico.name } } : s.asig,
    };
  });
  return { services: next, asignados };
}
