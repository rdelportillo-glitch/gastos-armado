// Pago de viáticos por persona y día (a partir del histórico de asignación) y plantilla de pago al banco.
// Regla del viático (la de la consulta de Power Query): por técnico y día, solo cuentan los servicios realizados o que generaron un desplazamiento y que están en un municipio
// con viático "ENVIAR" en Maestros → Viáticos por municipio. Valor = el mayor valor de municipio + (ciudades distintas - 1) x adicional (según el departamento).
// Si ese día la persona tiene viático y pico y placa, solo se paga el viático.
import { supabase } from "./supabaseClient";

export const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

const KEY = "viaticos_config";
export const VIATICOS_DEFAULT = {
  excluidos: [], // ids de personal que no reciben viático (por ejemplo, quien vive en la misma ciudad de trabajo)
  adicionalDefault: 10000, adicionalPorDepto: { CUNDINAMARCA: 20000, ANTIOQUIA: 20000 }, // por cada ciudad adicional el mismo día
  tiposDesplazamiento: ["Desplazamiento", "Diagnóstico"], // causales con estos tipos de pago cuentan como desplazamiento aunque el servicio no se haya realizado
  subViatico: "", subPyp: "", // subcategorías de los gastos que se crean al marcar el pago
};

export async function loadViaticosConfig() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return { ...VIATICOS_DEFAULT, ...((data && data.value) || {}) };
}
export async function saveViaticosConfig(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
export async function loadMunicipiosViatico() {
  const { data, error } = await supabase.from("viatico_municipios").select("*").eq("active", true);
  if (error) throw new Error(error.message);
  return data || [];
}
export async function loadPagosViatico(day) {
  const { data, error } = await supabase.from("viatico_pagos").select("*").eq("day", day);
  if (error) throw new Error(error.message);
  return data || [];
}

// Viáticos del día. rows: filas del histórico de ese día. Devuelve una línea por técnico con viático.
export function calcularViaticos({ rows, municipios, causales, cfg }) {
  const valorMun = new Map(municipios.filter((m) => plano(m.expense_action) === "ENVIAR").map((m) => [`${plano(m.department)}|${plano(m.municipality)}`, Number(m.value) || 0]));
  const tipoPago = new Map((causales || []).map((c) => [plano(c.name), c.paymentType || ""]));
  const desplaza = new Set((cfg.tiposDesplazamiento || []).map(plano));
  const excluidos = new Set(cfg.excluidos || []);
  const grupos = new Map();
  rows.forEach((r) => {
    if (!r.technician_id || excluidos.has(r.technician_id)) return;
    const causal = r.causal_auditada || r.causal_extreme;
    const cuenta = r.resultado === "Realizado" || desplaza.has(plano(tipoPago.get(plano(causal)) || ""));
    if (!cuenta) return;
    const k = `${r.departamento ? plano(r.departamento) : ""}|${plano(r.ciudad)}`;
    if (!valorMun.has(k)) return; // municipio sin viático (o que no es ENVIAR)
    const g = grupos.get(r.technician_id) || { technicianId: r.technician_id, nombre: r.technician_name || "", day: r.day, departamento: r.departamento || "", ciudades: new Map(), servicios: [] };
    const c = plano(r.ciudad);
    if (!g.ciudades.has(c)) g.ciudades.set(c, { nombre: r.ciudad, valor: valorMun.get(k) });
    if (!g.servicios.includes(String(r.servicio))) g.servicios.push(String(r.servicio));
    grupos.set(r.technician_id, g);
  });
  return [...grupos.values()].map((g) => {
    const ciudades = [...g.ciudades.values()];
    const max = Math.max(...ciudades.map((c) => c.valor));
    const adicional = (cfg.adicionalPorDepto && cfg.adicionalPorDepto[plano(g.departamento)]) ?? cfg.adicionalDefault ?? 0;
    const extra = (ciudades.length - 1) * Number(adicional || 0);
    return { kind: "Viático", technicianId: g.technicianId, nombre: g.nombre, day: g.day, departamento: g.departamento, valor: max + extra, detalle: `${ciudades.map((c) => c.nombre).join(", ")} - ${g.servicios.join(" - ")}` };
  });
}

// Líneas a pagar del día: viático por persona y, para quien no tuvo viático, el pico y placa (rowsPyp: salida de calcularPicoPlaca con estado "pyp").
export function lineasDePago({ viaticos, rowsPyp }) {
  const conViatico = new Set(viaticos.map((v) => v.technicianId));
  const pyp = rowsPyp.filter((r) => r.estado === "pyp" && r.valor && !conViatico.has(r.id))
    .map((r) => ({ kind: "Pico y placa", technicianId: r.id, nombre: r.nombre, day: r.fecha, departamento: r.depto, valor: r.valor, detalle: `Pico y placa ${r.dia} - ${r.ciudadesPyP}` }));
  return [...viaticos, ...pyp].sort((a, b) => a.departamento.localeCompare(b.departamento, "es") || a.nombre.localeCompare(b.nombre, "es") || a.kind.localeCompare(b.kind));
}

/* ---------------------------- Plantilla de pago al banco ---------------------------- */

export const COLUMNAS_PAGO = ["TIPO DE IDENTIFICACION", "NUMERO IDENTIFICACION", "NOMBRE DEL TITULAR", "APELLIDO DEL TITULAR", "BANCO DESTINO", "TIPO DE CUENTA", "NUMERO CUENTA", "VALOR DEL PAGO"];

// Número si es solo dígitos sin cero a la izquierda; si no, texto (conserva los ceros de una cuenta).
export const numOTexto = (v) => { const t = String(v ?? "").trim(); return t !== "" && /^[1-9]\d{0,14}$/.test(t) ? Number(t) : t; };

// "JUAN_PANIAGUA" → nombre / apellido. Con 4 o más palabras, las dos primeras son el nombre; con 3, una; con 2, una y una.
export function partirNombre(nombre) {
  const p = String(nombre || "").replace(/_/g, " ").trim().split(/\s+/).filter(Boolean);
  if (p.length <= 1) return [p[0] || "", ""];
  const n = p.length >= 4 ? 2 : 1;
  return [p.slice(0, n).join(" "), p.slice(n).join(" ")];
}
const tipoCuenta = (t) => { const x = plano(t); return x.startsWith("AHORRO") ? "CA" : x.startsWith("CORRIENTE") ? "CC" : x === "CA" || x === "CC" ? x : String(t || ""); };

// Beneficiarios del día: suma de los gastos activos de esa fecha por persona de Personal o por proveedor. incluirEnviados: también los ya enviados al banco.
export function beneficiariosDelDia({ expenses, technicians, suppliers, fecha, incluirEnviados }) {
  const tecs = Object.fromEntries(technicians.map((t) => [t.id, t])), sups = Object.fromEntries((suppliers || []).map((s) => [s.id, s]));
  const m = new Map();
  expenses.filter((e) => e.status === "Activo" && e.date === fecha && (e.technicianId || e.supplierId) && (incluirEnviados || !e.bankSentAt)).forEach((e) => {
    const k = e.technicianId ? `t:${e.technicianId}` : `s:${e.supplierId}`;
    const g = m.get(k) || { key: k, expenses: [], total: 0 };
    g.expenses.push(e); g.total += e.totalValue || 0; m.set(k, g);
  });
  return [...m.values()].map((g) => {
    const esTec = g.key.startsWith("t:"), id = g.key.slice(2);
    let fila, nombre, faltan = [];
    if (esTec) {
      const t = tecs[id] || {};
      const [n1, a1] = partirNombre(t.name);
      nombre = t.name || "(sin ficha)";
      fila = { idType: t.idType, idNumber: t.document, first: t.holderFirstName || n1, last: t.holderLastName || a1, bank: t.bankCode, type: tipoCuenta(t.bankAccountType), account: t.bankAccount };
    } else {
      const s = sups[id] || {};
      nombre = s.name || "(sin ficha)";
      fila = { idType: s.idType, idNumber: s.idNumber, first: s.holderFirstName, last: s.holderLastName, bank: s.bankCode, type: tipoCuenta(s.accountType), account: s.accountNumber };
    }
    if (!fila.idNumber) faltan.push("identificación"); if (!fila.bank) faltan.push("banco"); if (!fila.account) faltan.push("cuenta"); if (!fila.type) faltan.push("tipo de cuenta");
    return { ...g, tipo: esTec ? "Personal" : "Proveedor", nombre, fila, faltan };
  }).sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nombre.localeCompare(b.nombre, "es"));
}
export const filaPlantilla = (b) => [numOTexto(b.fila.idType), numOTexto(b.fila.idNumber), b.fila.first || "", b.fila.last || "", numOTexto(b.fila.bank), b.fila.type || "", numOTexto(b.fila.account), b.total];
