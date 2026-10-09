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

// Aceptó / Indeciso son las que suman tiempo a la ruta y llevan instalación.
export const tvLlevaInstalacion = (o) => !!o && (o.estado === "Aceptó" || o.estado === "Indeciso");
