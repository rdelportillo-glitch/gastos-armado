// Comercial → Ventas: venta de productos por los técnicos, con su inventario (entregado − vendido), precios, comisión y consecutivo propio (VEN-000001).
// Las ventas se crean y se anulan solo con funciones de la base de datos (registrar_venta, anular_venta): ahí se fijan el precio y la comisión y se revisa el stock.
import { supabase } from "./supabaseClient";

export const fmtCOP = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
export const TIPOS_DOC = ["CC", "CE", "NIT", "PA", "TI", "PEP", "PPT"];
export const PAGOS = ["Efectivo", "Transferencia"];
export const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const msg = (e) => String((e && e.message) || e || "Error");

// ------------------------------- Catálogo de venta (precios y comisión) -------------------------------

export async function cargarCatalogo() {
  const { data, error } = await supabase.from("sales_products").select("id,product_id,unit_price,commission,active,updated_at");
  if (error) throw new Error(error.message);
  return data || [];
}

export async function cargarHistorialPrecios() {
  const { data, error } = await supabase.from("sales_price_history").select("product_id,unit_price,commission,active,changed_by,changed_at").order("changed_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return data || [];
}

// Crea o actualiza el precio, la comisión y si está en venta (solo el administrador; la base de datos lo exige y guarda el historial).
export async function guardarPrecio({ productId, unitPrice, commission, active, userId }) {
  const fila = { product_id: productId, unit_price: Number(unitPrice) || 0, commission: Number(commission) || 0, active: !!active, updated_by: userId || null, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("sales_products").upsert(fila, { onConflict: "product_id" });
  if (error) throw new Error(error.message);
}

// ------------------------------------------ Inventario ------------------------------------------

// Inventario para vender: por técnico y producto (entregado, vendido y stock). El técnico recibe solo el suyo; con tecnicoId se pide el de uno en particular.
export async function inventarioVentas(tecnicoId = null) {
  const { data, error } = await supabase.rpc("ventas_inventario", { p_tecnico: tecnicoId });
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    technicianId: r.technician_id, productId: r.product_id, nombre: r.product_name, precio: Number(r.unit_price), comision: Number(r.commission), enVenta: !!r.price_active,
    entregado: Number(r.entregado), vendido: Number(r.vendido), stock: Number(r.stock),
  }));
}

// ------------------------------------------ Ventas ------------------------------------------

// Ventas con sus productos, de un rango de fechas (el técnico recibe solo las suyas). Sin límite de 1.000 filas.
export async function cargarVentas({ from, to } = {}) {
  const out = [];
  for (let start = 0; ; start += 500) {
    let q = supabase.from("sales").select("*, sale_items(*)").order("created_at", { ascending: false });
    if (from) q = q.gte("sale_date", from);
    if (to) q = q.lte("sale_date", to);
    const { data, error } = await q.range(start, start + 499);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  return out.map((v) => ({
    id: v.id, consecutivo: v.consecutive, fecha: String(v.sale_date).slice(0, 10), technicianId: v.technician_id, origen: v.origin, servicio: v.service_no || "", cliente: v.customer_name,
    tipoDoc: v.doc_type || "", documento: v.doc_number || "", pago: v.payment_method, nota: v.notes || "", total: Number(v.total), comision: Number(v.commission_total),
    estado: v.status, motivoAnulacion: v.void_reason || "", anuladaEn: v.voided_at || "", creadaEn: v.created_at,
    items: (v.sale_items || []).map((i) => ({ productId: i.product_id, nombre: i.product_name, cantidad: Number(i.quantity), precio: Number(i.unit_price), comision: Number(i.commission), total: Number(i.line_total), comisionTotal: Number(i.commission_total) })),
  }));
}

// payload: { technician_id?, sale_date?, origin, service_no, customer_name, doc_type, doc_number, payment_method, notes, items: [{ product_id, quantity }] }
export async function registrarVenta(payload) {
  const { data, error } = await supabase.rpc("registrar_venta", { p: payload });
  if (error) throw new Error(msg(error));
  return data;
}

export async function anularVenta(id, motivo) {
  const { data, error } = await supabase.rpc("anular_venta", { p_venta: id, p_motivo: motivo });
  if (error) throw new Error(msg(error));
  return data;
}

// ------------------------------------------ Cálculo ------------------------------------------

// Resumen de ventas ACTIVAS: por técnico y por producto, y el total.
export function resumirVentas(ventas) {
  const act = ventas.filter((v) => v.estado === "Activa");
  const porTec = new Map(), porProd = new Map();
  const total = { ventas: act.length, unidades: 0, valor: 0, comision: 0 };
  act.forEach((v) => {
    const t = porTec.get(v.technicianId) || { technicianId: v.technicianId, ventas: 0, unidades: 0, valor: 0, comision: 0 };
    t.ventas++; t.valor += v.total; t.comision += v.comision;
    v.items.forEach((i) => {
      t.unidades += i.cantidad; total.unidades += i.cantidad;
      const p = porProd.get(i.productId) || { productId: i.productId, nombre: i.nombre, unidades: 0, valor: 0, comision: 0 };
      p.unidades += i.cantidad; p.valor += i.total; p.comision += i.comisionTotal; porProd.set(i.productId, p);
    });
    total.valor += v.total; total.comision += v.comision;
    porTec.set(v.technicianId, t);
  });
  return { porTec: [...porTec.values()], porProd: [...porProd.values()].sort((a, b) => b.valor - a.valor), total };
}
