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

// Números de teléfono dentro de un texto (un registro puede traer varios, separados por espacio, coma, barra...). Los celulares escritos con
// espacios o guiones ("300 123 4567") se unen; sin repetidos y en el orden en que vienen.
export function numerosDeTelefono(texto) {
  const limpio = String(texto || "").replace(/(\d{3})[\s.-](\d{3})[\s.-](\d{4})/g, "$1$2$3");
  return [...new Set(limpio.match(/\d{7,}/g) || [])];
}
// Enlace de llamada: los celulares de Colombia (10 dígitos, empiezan por 3) con +57; los demás tal cual.
export const urlLlamada = (numero) => `tel:${/^3\d{9}$/.test(numero) ? "+57" : ""}${numero}`;

export const urlWsp = (telefono, texto) => `https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`;

// Aviso de cancelación de servicios (Jamar cancela) a un técnico. servicios = [{ n, regs }]: número y registros (productos) de cada servicio cancelado.
export function mensajeCancelacion(nombreTecnico, servicios) {
  const detalle = servicios.map(({ n, regs }) => {
    const s = regs[0] || {}, a = s.asig || {};
    const productos = [...new Set(regs.map((r) => r.productoExternoNombre).filter(Boolean))].join(", ");
    return [`SERVICIO: ${n}`, `CLIENTE: ${s.clienteNombre || a.cliente || ""}`, `DIRECCIÓN: ${s.direccion || a.direccion || ""}`, `PRODUCTO: ${productos}`].join("\n");
  }).join("\n\n");
  return `Buen día ${nombreTecnico}. JAMAR notificó la CANCELACIÓN de ${servicios.length === 1 ? "este servicio" : "estos servicios"}. No ${servicios.length === 1 ? "lo" : "los"} realices:\n\n${detalle}`;
}
