// Mensaje de WhatsApp con el detalle de un servicio para el técnico (enlace wa.me: abre WhatsApp con el texto escrito; la persona lo envía).
import { servicioCsv } from "./asignacion/outputs";

// Teléfono de Personal → número internacional de Colombia (57 + celular de 10 dígitos). null si no se reconoce.
export function telefonoWsp(valor) {
  const digitos = String(valor || "").replace(/\D/g, "");
  const cel = digitos.match(/3\d{9}/);
  if (cel) return `57${cel[0]}`;
  return digitos.length >= 11 ? digitos : null;
}

// Detalle del servicio con la plantilla de notificación; registros = todos los productos (registros de Carga) del mismo servicio y técnico.
export function mensajeServicio(registros) {
  const s = registros[0], a = s.asig || {};
  const productos = new Map();
  registros.forEach((r) => {
    const k = `${r.productoExternoCodigo || ""}|${r.productoExternoNombre || ""}`;
    const e = productos.get(k) || { nombre: r.productoExternoNombre || a.producto || "", codigo: r.productoExternoCodigo || a.codigo || "", n: 0 };
    e.n += Math.max(1, Math.round(Number(r.quantity) || 1)); productos.set(k, e);
  });
  const bloques = [...productos.values()].map((p) => `PRODUCTO:\n${p.nombre}${p.n > 1 ? ` (x${p.n})` : ""}\nCÓDIGO: ${p.codigo}`).join("\n");
  return [
    `SERVICIO: ${servicioCsv({ servicio: s.servicioExterno, pqrNumero: a.pqrNumero })}`,
    `CLIENTE: ${s.clienteNombre || a.cliente || ""}`,
    "",
    "DIRECCIÓN:", s.direccion || a.direccion || "",
    "SEÑAS:", a.senas || "",
    "TELEFONOS:", a.telefono || "",
    `CIUDAD: ${s.ciudadExterna || a.ciudad || ""}`,
    `BARRIO: ${a.barrio || ""}`,
    "",
    bloques,
    `TIPO DE SERVICIO: ${s.serviceType || a.tipo || ""}`,
    `CLIENTE REPORTA: ${a.reporta || ""}`,
  ].join("\n");
}

export const urlWsp = (telefono, texto) => `https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`;
