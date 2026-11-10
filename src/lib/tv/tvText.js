// Textos de la instalación de TV (sin dependencias, para usarlos también en los PDF de rutas).
export const fmtCOP = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-CO");

// Cómo se ve la instalación en los PDF de rutas y en la asignación (lo que el técnico debe saber).
export function tvTexto(o) {
  if (!o) return "";
  const acciones = Array.isArray(o.adicionales) && o.adicionales.length
    ? o.adicionales.map((a) => String(a.nombre || "").toLowerCase()).filter(Boolean)
    : [o.desmonte_tv && "desmonte TV anterior", o.organizar_cables && "organizar cables", o.mover_punto && "mover punto eléctrico"].filter(Boolean);
  if (o.estado === "Aceptó") {
    return [`INSTALAR TV${o.pulgadas ? ` ${o.pulgadas}"` : ""}`, `cobrar ${fmtCOP(o.valor_total)}`,
      o.forma_pago ? `${o.forma_pago.toLowerCase()}${o.forma_pago === "Transferencia" && !o.comprobante_ok ? " (comprobante pendiente)" : ""}` : "",
      acciones.length ? `+ ${acciones.join(", ")}` : ""].filter(Boolean).join(" · ");
  }
  if (o.estado === "Indeciso") return `TV INDECISO: conversar en casa${o.pulgadas ? ` (${o.pulgadas}")` : ""}${o.valor_total ? ` · ${fmtCOP(o.valor_total)}` : ""}`;
  // Gestiones negativas o sin resultado: el técnico también las ve.
  const intentos = Number(o.intentos) || 0;
  const veces = `${intentos} intento${intentos === 1 ? "" : "s"}`;
  if (o.estado === "No aceptó") return `TV: el cliente no aceptó${o.objecion ? ` (${o.objecion})` : ""}`;
  if (o.estado === "Rellamar" || o.estado === "No contactado") return `TV: el cliente no contestó (${veces})`;
  if (o.estado === "Por llamar") return "TV: sin gestionar";
  return "";
}

// ¿Este producto es de los que llevan la instalación de TV (panel de TV, centro de entretenimiento, mesa flotante)? Sirve para poner el aviso de TV en la fila del panel y no en la de otro producto del mismo servicio.
// Mira la sublínea si se conoce (igual que la agenda de Instalación de TV) y, si no, el nombre del producto. Las sublíneas por defecto son las de la configuración de Instalación de TV.
export const TV_SUBLINEAS_DEFECTO = ["PANEL DE TV", "CENTRO ENTRETEN", "MESA FLOTANTE"];
const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const palabras = (s) => plano(s).split(/[^A-Z0-9]+/).filter(Boolean);
export function esProductoTv(r, sublineas = TV_SUBLINEAS_DEFECTO) {
  if (!r) return false;
  const sub = plano(r.sublinea).trim();
  if (sub && sublineas.some((s) => sub.includes(plano(s).trim()))) return true;
  const nombre = palabras(r.producto);
  return sublineas.some((s) => { const w = palabras(s).filter((x) => x !== "DE" && x !== "DEL"); return w.length > 0 && w.every((x) => nombre.some((n) => n.startsWith(x))); });
}

// Aceptó / Indeciso son las que suman tiempo a la ruta y llevan instalación.
export const tvLlevaInstalacion = (o) => !!o && (o.estado === "Aceptó" || o.estado === "Indeciso");
