// Carta de notificación al técnico de un descuento por auditoría (Instalación de TV → Auditorías) y el mensaje de WhatsApp que la acompaña.
// Es solo notificación: hechos de la auditoría, valor y espacio de recibido.

export const EMPRESA_CARTA = { marca: "BIVER", razon: "ASC Instalaciones y Servicios SAS" };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const fechaLarga = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : ""; };
export const pesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
export const nombreBonito = (s) => String(s || "").replace(/_/g, " ").replace(/\s+/g, " ").trim();

// Número en letras (0 a 999.999.999), como se escribe el valor en una carta.
const UN = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DEC = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CEN = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
const hasta999 = (n) => {
  if (n === 100) return "cien";
  const c = Math.floor(n / 100), r = n % 100;
  const resto = r < 30 ? UN[r] : `${DEC[Math.floor(r / 10)]}${r % 10 ? ` y ${UN[r % 10]}` : ""}`;
  return [CEN[c], resto].filter(Boolean).join(" ");
};
export function enLetras(valor) {
  const n = Math.round(Number(valor) || 0);
  if (n === 0) return "cero";
  const millones = Math.floor(n / 1e6), miles = Math.floor((n % 1e6) / 1000), resto = n % 1000;
  return [millones ? (millones === 1 ? "un millón" : `${hasta999(millones)} millones`) : "", miles ? (miles === 1 ? "mil" : `${hasta999(miles)} mil`) : "", resto ? hasta999(resto) : ""].filter(Boolean).join(" ");
}
export const valorEnLetras = (v) => { const n = Math.round(Number(v) || 0); return `${enLetras(n)} ${n % 1e6 === 0 && n >= 1e6 ? "de pesos" : n === 1 ? "peso" : "pesos"} m/cte`; };

// Texto del hallazgo propuesto (quien genera la carta puede ajustarlo antes).
export function hallazgoSugerido(a) {
  const base = a.resultado === "Lo realizó por aparte"
    ? "Según lo informado por el cliente, la instalación del televisor se realizó por aparte, sin registrarse como un servicio de la empresa."
    : "En la auditoría del servicio se identificó una novedad que da lugar al descuento.";
  const detalle = String(a.comentarios || "").trim();
  return detalle ? `${base}\n\nObservaciones de la auditoría: ${detalle}` : base;
}

export const mensajeWhatsappCarta = ({ tecnico, servicio, valor }) =>
  `Buen día ${nombreBonito(tecnico)}. Te escribimos de ${EMPRESA_CARTA.marca} para notificarte un descuento de ${pesos(valor)} resultado de la auditoría del servicio ${servicio}. Adjunto encuentras la carta con el detalle. Por favor confirma de recibido.`;

export const nombreArchivoCarta = (servicio, tecnico) => `Notificacion descuento ${servicio} ${nombreBonito(tecnico)}.pdf`.replace(/[\\/:*?"<>|]/g, "");

// datos: { hoy, ciudad, tecnico, documento, cargo, servicio, cliente, fechaServicio, fechaAuditoria, valor, hallazgo, firma, monitoreo }
export async function cartaDescuentoPdf(datos) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 64, AW = W - 2 * M;
  doc.setFillColor(58, 35, 23); doc.rect(0, 0, W, 54, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(227, 178, 60); doc.text(EMPRESA_CARTA.marca, M, 34);
  doc.setFontSize(10); doc.setTextColor(255, 255, 255); doc.text(EMPRESA_CARTA.razon, W - M, 33, { align: "right" });
  let y = 96;
  const salto = (alto) => { if (y + alto > H - 60) { doc.addPage(); y = 72; } };
  const parrafo = (texto, { negrita = false, tam = 11, despues = 12, sangria = 0 } = {}) => {
    doc.setFont("helvetica", negrita ? "bold" : "normal"); doc.setFontSize(tam); doc.setTextColor(30);
    doc.splitTextToSize(String(texto), AW - sangria).forEach((l) => { salto(tam * 1.4); doc.text(l, M + sangria, y); y += tam * 1.4; });
    y += despues;
  };
  parrafo(`${datos.ciudad ? `${datos.ciudad}, ` : ""}${fechaLarga(datos.hoy)}`, { despues: 18 });
  parrafo("Señor(a)", { despues: 0 });
  parrafo(nombreBonito(datos.tecnico).toUpperCase(), { negrita: true, despues: 0 });
  if (datos.documento) parrafo(`Documento: ${datos.documento}`, { despues: 0 });
  parrafo(datos.cargo || "Técnico", { despues: 18 });
  parrafo(`Asunto: Notificación de descuento por auditoría del servicio ${datos.servicio}`, { negrita: true, despues: 16 });
  parrafo("Cordial saludo.");
  parrafo(`Por medio de la presente le informamos que, como resultado de la auditoría${datos.fechaAuditoria ? ` realizada el ${fechaLarga(datos.fechaAuditoria)}` : ""} al servicio ${datos.servicio}${datos.cliente ? ` del cliente ${datos.cliente}` : ""}${datos.fechaServicio ? `, programado para el ${fechaLarga(datos.fechaServicio)}` : ""}${datos.monitoreo ? ` (monitoreo ${datos.monitoreo})` : ""}, se aplicará un descuento por valor de ${pesos(datos.valor)} (${valorEnLetras(datos.valor)}).`);
  parrafo("Detalle del hallazgo:", { negrita: true, despues: 4 });
  String(datos.hallazgo || "").split(/\n+/).filter((l) => l.trim()).forEach((l) => parrafo(l.trim(), { despues: 6 }));
  y += 6;
  parrafo("Esta comunicación se entrega para su conocimiento. Cualquier inquietud puede comunicarla a su coordinador.");
  parrafo("Cordialmente,", { despues: 34 });
  salto(150);
  doc.setDrawColor(80); doc.line(M, y, M + 220, y); y += 14;
  parrafo(datos.firma || "", { negrita: true, despues: 0 });
  parrafo(`${EMPRESA_CARTA.razon} (${EMPRESA_CARTA.marca})`, { despues: 30 });
  salto(110);
  parrafo("Recibido:", { negrita: true, despues: 26 });
  [["Firma", 0], ["Nombre y documento", 240]].forEach(([t, x]) => { doc.line(M + x, y, M + x + 200, y); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(t, M + x, y + 12); });
  y += 44; doc.setFontSize(11); doc.text("Fecha de recibido: ______________________", M, y);
  return doc.output("blob");
}
