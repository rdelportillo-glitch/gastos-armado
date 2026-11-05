// Banco: lectura del archivo de movimientos de Davivienda, clasificación (gasto, pago, abono), saldo y pagos aún sin reflejar.
//
//  Fecha: cada movimiento trae la "fecha de sistema" del banco; el gasto y el saldo diario se causan un día después (fecha de sistema + 1).
//  Saldo: el administrador escribe el saldo del banco en una fecha de sistema (referencia). Desde ahí se calcula el saldo de cualquier día con los movimientos cargados.
//  Pendiente por debitar: gastos de la plantilla marcados como enviados al banco cuya fecha de pago es posterior a lo que ya muestra el archivo.
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";

export const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
export const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
export const fmtSaldo = (n) => `$ ${(Number(n) || 0).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KEY = "banco_config";
// patron: texto que debe contener la descripción del banco. tipo: Gasto (costo financiero) o Pago (ya está como gasto de cada persona: solo mueve el saldo).
// claves: palabras para sugerir la subcategoría entre las que ya existen (la primera que aparezca en el nombre de una subcategoría activa).
export const REGLAS_DEFAULT = [
  { id: "r-comision-proveedores", patron: "COBRO PAGO PROVEEDORES", tipo: "Gasto", concepto: "Comisión pago a proveedores (banco)", claves: ["COMISION", "PROVEEDOR", "BANCARI"], subcategoryId: "" },
  { id: "r-comision-daviplata", patron: "COBRO DISP FOND DAVIPLATA", tipo: "Gasto", concepto: "Comisión dispersión de fondos Daviplata", claves: ["DAVIPLATA", "DISPERSION", "COMISION"], subcategoryId: "" },
  { id: "r-iva", patron: "COBRO IVA SERVICIOS FINANCIEROS", tipo: "Gasto", concepto: "IVA servicios financieros", claves: ["IVA", "SERVICIOS FINANCIEROS"], subcategoryId: "" },
  { id: "r-gmf", patron: "GRAVAMEN MOVIMIENTO FINANCIER", tipo: "Gasto", concepto: "Gravamen movimientos financieros (4x1000)", claves: ["GRAVAMEN", "4X1000", "4 X 1000", "GMF"], subcategoryId: "" },
  { id: "r-pago-proveedores", patron: "DESCUENTO POR PAGO DE PROVEEDORES", tipo: "Pago", concepto: "", claves: [], subcategoryId: "" },
  { id: "r-pago-daviplata", patron: "TRANSFERENCIA ENVIADA A DAVIPLATA", tipo: "Pago", concepto: "", claves: [], subcategoryId: "" },
  { id: "r-pago-interbancaria", patron: "DESCUENTO TRANSFER", tipo: "Pago", concepto: "", claves: [], subcategoryId: "" },
];
export const BANCO_DEFAULT = { saldoReferencia: "", fechaReferencia: "", reglas: REGLAS_DEFAULT };

export async function loadBancoConfig() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data && data.value) || {};
  return { ...BANCO_DEFAULT, ...v, reglas: v.reglas && v.reglas.length ? v.reglas : REGLAS_DEFAULT };
}
export async function saveBancoConfig(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function loadMovimientos({ from, to } = {}) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    let q = supabase.from("bank_movements").select("*").order("fecha_sistema", { ascending: false }).order("created_at", { ascending: false }).order("id");
    if (from) q = q.gte("fecha_sistema", from);
    if (to) q = q.lte("fecha_sistema", to);
    const { data, error } = await q.range(start, start + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Inserta los movimientos nuevos; los que ya estaban (misma llave) se ignoran. Devuelve solo los insertados, con su id.
export async function guardarMovimientos(rows) {
  const inserted = [];
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await supabase.from("bank_movements").upsert(rows.slice(i, i + 200), { onConflict: "dedupe_key", ignoreDuplicates: true }).select();
    if (error) throw new Error(error.message);
    inserted.push(...(data || []));
  }
  return inserted;
}
export async function cambiarTipoMovimiento(id, tipo) {
  const { error } = await supabase.from("bank_movements").update({ tipo }).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ------------------------------ Lectura del archivo ------------------------------ */

// "$ 1.695,20" (formato es-CO) → 1695.2
export function parseValor(v) {
  if (typeof v === "number") return v;
  const t = String(v ?? "").replace(/[^\d,.\-]/g, "");
  if (!t) return 0;
  const n = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : (/\.\d{3}($|\.)/.test(t) ? t.replace(/\./g, "") : t);
  return Number(n) || 0;
}
// "03/11/2026" → "2026-11-03" (también acepta fechas de Excel)
export function parseFecha(v) {
  if (typeof v === "number" && v > 20000) return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  const m = String(v ?? "").trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : "";
}

export async function leerArchivoBanco(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
  const h = filas.findIndex((r) => r.some((c) => plano(c) === "FECHA DE SISTEMA"));
  if (h < 0) throw new Error("No encuentro la columna \"Fecha de Sistema\": este no parece el archivo de movimientos de Davivienda.");
  const ix = (nombre) => filas[h].findIndex((c) => plano(c) === nombre);
  const c = { fecha: ix("FECHA DE SISTEMA"), doc: ix("DOCUMENTO"), desc: ix("DESCRIPCION MOTIVO"), trans: ix("TRANSACCION"), ofi: ix("OFICINA DE RECAUDO"), valor: ix("VALOR TOTAL") };
  if (c.desc < 0 || c.trans < 0 || c.valor < 0) throw new Error("Faltan columnas en el archivo (Descripción motivo, Transacción o Valor Total).");
  return filas.slice(h + 1).filter((r) => r[c.fecha] !== "" && r[c.desc] !== "").map((r) => {
    const fechaSistema = parseFecha(r[c.fecha]);
    const descripcion = String(r[c.desc]).replace(/\s+/g, " ").trim();
    const transaccion = plano(r[c.trans]).includes("CREDITO") ? "Nota Crédito" : "Nota Débito";
    const valor = Math.round(parseValor(r[c.valor]) * 100) / 100;
    const documento = String(r[c.doc] ?? "").trim();
    return { fechaSistema, fecha: fechaSistema ? sumarDias(fechaSistema, 1) : "", documento, descripcion, transaccion, oficina: String(r[c.ofi] ?? "").trim(), valor,
      key: [fechaSistema, documento, plano(descripcion), valor.toFixed(2)].join("|") };
  }).filter((m) => m.fechaSistema && m.valor > 0);
}

/* ------------------------------ Clasificación ------------------------------ */

// Regla que aplica a una descripción (la de patrón más largo), o null.
export function reglaDe(descripcion, reglas) {
  const d = plano(descripcion);
  return [...reglas].filter((r) => r.patron && d.includes(plano(r.patron))).sort((a, b) => b.patron.length - a.patron.length)[0] || null;
}
// Tipo por defecto: la regla; si no hay, un crédito es Abono y un débito queda Sin clasificar (Otro: solo mueve el saldo).
export function tipoDe(mov, reglas) {
  if (mov.transaccion === "Nota Crédito") return "Abono";
  const r = reglaDe(mov.descripcion, reglas);
  return r ? r.tipo : "Otro";
}
// Subcategoría de una regla de gasto: la elegida, o la sugerida con las palabras clave entre las subcategorías activas.
export function subDeRegla(regla, db) {
  if (!regla) return null;
  const subs = db.subcategories.filter((s) => s.active);
  const elegida = subs.find((s) => s.id === regla.subcategoryId);
  if (elegida) return { sub: elegida, sugerida: false };
  for (const k of regla.claves || []) {
    const hit = subs.find((s) => plano(s.name).includes(plano(k)));
    if (hit) return { sub: hit, sugerida: true };
  }
  return null;
}

/* ---------------------------------- Saldo ---------------------------------- */

const firma = (m) => (m.transaccion === "Nota Crédito" ? 1 : -1) * Number(m.valor);

// Saldo al cierre de un día de sistema d: referencia + movimientos después de la referencia hasta d − movimientos después de d hasta la referencia.
export function saldoAl(d, cfg, movs) {
  const ref = Number(cfg.saldoReferencia), f = cfg.fechaReferencia;
  if (!(cfg.saldoReferencia !== "" && Number.isFinite(ref)) || !f) return null;
  let s = ref;
  movs.forEach((m) => {
    if (m.fecha_sistema > f && m.fecha_sistema <= d) s += firma(m);
    else if (m.fecha_sistema > d && m.fecha_sistema <= f) s -= firma(m);
  });
  return Math.round(s * 100) / 100;
}
export function saldoActual(cfg, movs) {
  const ref = Number(cfg.saldoReferencia), f = cfg.fechaReferencia;
  if (!(cfg.saldoReferencia !== "" && Number.isFinite(ref)) || !f) return null;
  return Math.round((ref + movs.filter((m) => m.fecha_sistema > f).reduce((s, m) => s + firma(m), 0)) * 100) / 100;
}

// Gastos enviados al banco (marcados en la Plantilla de pago) que todavía no se reflejan en el saldo ni en el archivo del banco.
// Un pago con fecha de pago D se debita en el banco ese mismo día (fecha de sistema D): lo ya reflejado llega hasta la última fecha de sistema conocida (la del saldo de referencia o la de los pagos del archivo).
// Lo enviado con fecha posterior a esa todavía no está en el saldo del banco y se descuenta del saldo actual estimado.
export function pendientesPorDebitar(expenses, cfg, movs) {
  if (!cfg.fechaReferencia) return { corte: null, gastos: [], total: 0 };
  const pagos = movs.filter((m) => m.tipo === "Pago").map((m) => m.fecha_sistema);
  const ultima = [cfg.fechaReferencia, ...pagos].sort().slice(-1)[0];
  const corte = ultima;
  const gastos = (expenses || []).filter((e) => e.status === "Activo" && e.bankSentAt && (e.technicianId || e.supplierId) && !e.bankMovementId && e.date > corte);
  return { corte, gastos, total: gastos.reduce((s, e) => s + (e.totalValue || 0), 0) };
}
