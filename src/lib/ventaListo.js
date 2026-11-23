// ¿Qué le falta a un insumo para poder venderse? Lo usa el Catálogo de insumos (columna "Venta") para no tener que adivinar por qué un producto no aparece en Ventas.
//
// Para que un técnico pueda vender un producto hacen falta, en este orden:
//   1. que el insumo controle inventario por sí mismo (Ventas solo ve el inventario por producto, no el de toda una subcategoría),
//   2. que tenga precio y comisión y esté marcado "Se vende" (Ventas → Precios y comisiones, o el Catálogo),
//   3. que se haya comprado (Inventario → Compras),
//   4. que se le haya entregado a un técnico y le quede stock (Inventario → Entregas; las ventas del técnico lo van descontando).
//
// producto: insumo del catálogo · subcategoria: la suya · catalogo: filas de sales_products · movimientos: stockMovements de la app · inventario: filas de ventas_inventario (por técnico y producto).
export function estadoVenta({ producto, subcategoria, catalogo, movimientos, inventario }) {
  const propio = !!producto.trackStock;
  const porSub = !propio && !!(subcategoria && subcategoria.trackStock);
  const fila = (catalogo || []).find((c) => c.product_id === producto.id) || null;
  const compras = (movimientos || []).filter((m) => m.productId === producto.id && m.type === "Compra" && m.status !== "Anulado");
  const conStock = (inventario || []).filter((r) => r.productId === producto.id && r.stock > 0);
  const enVenta = !!(fila && fila.active);

  const pasos = [
    { ok: propio, texto: porSub ? "Controla inventario por su subcategoría: Ventas no lo ve; márcalo en el insumo" : "Controla inventario" },
    { ok: enVenta, texto: fila ? (fila.active ? "Tiene precio y está en venta" : "Tiene precio pero está fuera de venta") : "Sin precio de venta" },
    { ok: compras.length > 0, texto: compras.length ? `Tiene ${compras.length} compra${compras.length === 1 ? "" : "s"} registrada${compras.length === 1 ? "" : "s"}` : "Sin compras registradas" },
    { ok: conStock.length > 0, texto: conStock.length ? `${conStock.length} técnico${conStock.length === 1 ? "" : "s"} con stock para vender` : "Ningún técnico tiene stock (falta entregárselo)" },
  ];

  let codigo, etiqueta, color;
  if (porSub) { codigo = "subcategoria"; etiqueta = "Inventario por subcategoría"; color = "amber"; }
  else if (!propio) { codigo = "sin-inventario"; etiqueta = "Sin inventario"; color = "gray"; }
  else if (!fila) { codigo = "no-vende"; etiqueta = "No está en venta"; color = "gray"; }
  else if (!fila.active) { codigo = "fuera"; etiqueta = "Fuera de venta"; color = "amber"; }
  else if (!compras.length) { codigo = "falta-compra"; etiqueta = "En venta · falta comprar"; color = "amber"; }
  else if (!conStock.length) { codigo = "falta-entrega"; etiqueta = "En venta · falta entregar a un técnico"; color = "amber"; }
  else { codigo = "listo"; etiqueta = `Listo para vender · ${conStock.length} técnico${conStock.length === 1 ? "" : "s"}`; color = "green"; }
  return { codigo, etiqueta, color, pasos, precio: fila ? Number(fila.unit_price) : null, comision: fila ? Number(fila.commission) : null, enVenta, porSub };
}
