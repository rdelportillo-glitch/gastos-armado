// Resumen de rutas del día (Reportes): por región, un resumen por técnico (servicios armados / no armados / parciales / cancelados / hallazgos de auditoría) y,
// por cada técnico, el detalle de sus productos. Se arma con las mismas filas del CSV de Carga (las del histórico del día y las que siguen en Carga) y sale en PDF por región.
//  · Cada SERVICIO de un técnico se clasifica por el ARMADO? de sus productos: todos SI = Armado · todos NO = No armado · mezcla de SI con NO o cancelados = Parcial · todos CANCELADOS = Cancelado.
//  · Hallazgo de auditoría = servicio con algún producto con la columna AUDITORIA llena (ej. SERVICIO MAL CERRADO).
import { CSV_CARGA_HEADERS } from "./asignacion/csvCarga";

const IDX = Object.fromEntries(CSV_CARGA_HEADERS.map((h, i) => [h, i]));
const val = (fila, h) => { const v = fila[IDX[h]]; return v === undefined || v === null ? "" : String(v).trim(); };
export const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

// Filas (del CSV de Carga) + datos de origen → productos del resumen. origen: [{ fila, region, orden, fuente }]
export function itemsDeFilas(origen) {
  return origen.map(({ fila, region, orden, fuente }) => ({
    region: region ?? null, fuente, orden: orden ?? 9999,
    depto: val(fila, "DPTO"), coord: val(fila, "COORDINADOR"), empresa: val(fila, "EMPRESA"), tecnico: val(fila, "TECNICO") || "SIN TECNICO",
    servicio: val(fila, "SERVICIO"), fecha: val(fila, "FECHA"), cliente: val(fila, "NOMBRE CLIENTE"), ciudad: val(fila, "CIUDAD"), barrio: val(fila, "BARRIO"),
    producto: val(fila, "PRODUCTO"), observacion: val(fila, "OBSERVACION"), armado: plano(val(fila, "ARMADO?")), causales: val(fila, "CAUSALES"),
    auditoria: val(fila, "AUDITORIA"), primerPiso: val(fila, "PRIMER PISO"),
  }));
}

// Estado de un servicio de un técnico según el ARMADO? de sus productos.
export function estadoServicio(prods) {
  const v = prods.map((p) => p.armado);
  const si = v.filter((x) => x === "SI").length, canc = v.filter((x) => x === "CANCELADOS").length;
  if (canc === v.length) return "cancelado";
  if (si === v.length) return "armado";
  if (si > 0) return "parcial";
  return "noArmado";
}

// Agrupa los productos por técnico y por servicio: [{ tecnico, servicios, armados, noArmados, parciales, cancelados, hallazgos, productos, items }] (más servicios primero, luego por nombre).
export function resumirPorTecnico(items) {
  const porTec = new Map();
  items.forEach((it) => { if (!porTec.has(it.tecnico)) porTec.set(it.tecnico, new Map()); const m = porTec.get(it.tecnico); if (!m.has(it.servicio)) m.set(it.servicio, []); m.get(it.servicio).push(it); });
  const out = [...porTec.entries()].map(([tecnico, servs]) => {
    const r = { tecnico, servicios: servs.size, armados: 0, noArmados: 0, parciales: 0, cancelados: 0, hallazgos: 0, productos: 0, items: [] };
    servs.forEach((prods) => {
      const e = estadoServicio(prods);
      if (e === "armado") r.armados++; else if (e === "parcial") r.parciales++; else if (e === "cancelado") r.cancelados++; else r.noArmados++;
      if (prods.some((p) => p.auditoria)) r.hallazgos++;
      r.productos += prods.length;
      prods.forEach((p) => r.items.push({ ...p, estadoServicio: e }));
    });
    r.items.sort((a, b) => a.orden - b.orden || String(a.servicio).localeCompare(String(b.servicio), "es", { numeric: true }));
    return r;
  });
  return out.sort((a, b) => b.servicios - a.servicios || a.tecnico.localeCompare(b.tecnico, "es"));
}

export function totales(resumen) {
  const t = { servicios: 0, armados: 0, noArmados: 0, parciales: 0, cancelados: 0, hallazgos: 0, productos: 0 };
  resumen.forEach((r) => { Object.keys(t).forEach((k) => { t[k] += r[k]; }); });
  return t;
}

export const fechaCorta = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const fechaArchivo = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}-${m}-${y.slice(2)}`; };
export const nombreArchivoResumen = (nombre, from, to) => `Resumen Rutas ${String(nombre).replace(/[\\/:*?"<>|]/g, "").trim()} ${from === to ? fechaArchivo(from) : `${fechaArchivo(from)} a ${fechaArchivo(to)}`}.pdf`;

/* ------------------------------------ PDF ------------------------------------ */

const MARRON = [58, 35, 23], ORO = [227, 178, 60], NARANJA = [217, 130, 43], DURAZNO = [251, 228, 204], GRIS = [239, 239, 239];
// Filas del detalle: ARMADO? SI en verde claro y NO en rojo claro (las demás, como siempre). Los mismos colores se usan en pantalla.
export const COLOR_FILA = { SI: { pdf: [208, 238, 214], pantalla: "rgba(18,161,102,0.16)" }, NO: { pdf: [250, 214, 214], pantalla: "rgba(224,67,92,0.14)" } };

// regiones: [{ nombre (ej. "BOLIVAR" o "REGIÓN 4"), titulo (texto de la franja), etiquetaTec (texto tras el nombre del técnico), items }]; periodo: { from, to }.
export async function buildResumenRutasPdf({ regiones, periodo }) {
  const { jsPDF } = await import("jspdf");
  const at = await import("jspdf-autotable");
  const autoTable = [at.default, at.default && at.default.default, at.autoTable].find((f) => typeof f === "function");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), M = 24, AW = W - 2 * M;
  const texto = `${fechaCorta(periodo.from)} al ${fechaCorta(periodo.to)}`;

  const banda = (titulo) => {
    doc.setFillColor(...MARRON); doc.rect(M, 24, AW, 32, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...ORO); doc.text("BIVER", M + 12, 45);
    doc.setFontSize(14); doc.setTextColor(255, 255, 255); doc.text(titulo, W / 2, 45, { align: "center" });
  };
  const linea = (y, productos, servicios, tecnicos) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(60);
    const partes = [["Periodo: ", texto], ["Registros de productos: ", String(productos)], ["Servicios: ", String(servicios)], ...(tecnicos !== undefined ? [["Tecnicos: ", String(tecnicos)]] : [])];
    let x = M + 6;
    partes.forEach(([a, b], i) => {
      doc.setFont("helvetica", "bold"); doc.text(a, x, y); x += doc.getTextWidth(a);
      doc.setFont("helvetica", "normal"); const t = b + (i < partes.length - 1 ? "  |  " : ""); doc.text(t, x, y); x += doc.getTextWidth(t);
    });
  };
  const tarjetas = (y, t) => {
    doc.setFillColor(...GRIS); doc.rect(M, y, AW, 57, "F");
    const lista = [["SERVICIOS", t.servicios], ["ARMADOS", t.armados], ["NO ARMADOS", t.noArmados], ["PARCIALES", t.parciales], ["CANCELADOS", t.cancelados], ["HALLAZGOS AUDITORÍA", t.hallazgos]];
    const w = AW / 6;
    doc.setDrawColor(221); doc.setLineWidth(0.5);
    lista.forEach(([label, v], i) => {
      const x = M + i * w;
      if (i > 0) doc.line(x, y, x, y + 57);
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(100); doc.text(label, x + w / 2, y + 16, { align: "center" });
      doc.setFontSize(22); doc.setTextColor(...MARRON); doc.text(String(v), x + w / 2, y + 44, { align: "center" });
    });
  };
  const estiloTabla = { styles: { fontSize: 6.5, cellPadding: 2.5, lineColor: [232, 211, 188], lineWidth: 0.25, textColor: 0, valign: "middle" }, headStyles: { fillColor: NARANJA, textColor: 255, fontStyle: "bold", halign: "left" }, alternateRowStyles: { fillColor: DURAZNO }, bodyStyles: { fillColor: [255, 255, 255] } };

  regiones.forEach((reg, ri) => {
    const resumen = resumirPorTecnico(reg.items);
    const tot = totales(resumen);
    const servTotal = new Set(reg.items.map((i) => i.servicio)).size;
    // --- Página de resumen por técnico
    if (ri > 0) doc.addPage();
    banda(reg.titulo);
    linea(76, reg.items.length, servTotal, resumen.length);
    tarjetas(86, { ...tot, servicios: servTotal });
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...MARRON); doc.text("RESUMEN POR TÉCNICO", M + 6, 164);
    const paginaResumen = doc.internal.getNumberOfPages();
    autoTable(doc, {
      startY: 172, margin: { left: M, right: M, top: 70, bottom: 30 },
      head: [["Técnico", "Servicios", "Armados", "No Armados", "Parciales", "Cancelados", "Hallazgos Auditoría"]],
      body: resumen.map((r) => [r.tecnico, r.servicios, r.armados, r.noArmados, r.parciales, r.cancelados, r.hallazgos]),
      foot: [[`TOTAL ${reg.nombre}`, servTotal, tot.armados, tot.noArmados, tot.parciales, tot.cancelados, tot.hallazgos].map((c, i) => (i === 0 ? c : { content: String(c), styles: { halign: "right" } }))],
      showFoot: "lastPage", footStyles: { fillColor: MARRON, textColor: 255, fontStyle: "bold", fontSize: 7.5 },
      ...estiloTabla, columnStyles: { 0: { cellWidth: 240 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
      didDrawPage: (d) => { if (d.pageNumber > paginaResumen) banda(reg.titulo); },
    });

    // --- Una sección por técnico (detalle de productos)
    resumen.forEach((r) => {
      doc.addPage();
      banda(`${r.tecnico} | ${reg.etiquetaTec}`);
      linea(76, r.productos, r.servicios);
      tarjetas(86, r);
      const paginaInicial = doc.internal.getNumberOfPages();
      autoTable(doc, {
        startY: 152, margin: { left: M, right: M, top: 70, bottom: 30 },
        head: [["SERVICIO", "FECHA", "NOMBRE CLIENTE", "CIUDAD", "BARRIO", "PRODUCTO", "OBSERVACION", "TECNICO", "ARMADO?", "CAUSALES", "AUDITORIA", "PRIMER PISO"]],
        body: r.items.map((i) => [i.servicio, i.fecha, i.cliente, i.ciudad, i.barrio, i.producto, i.observacion, i.tecnico, i.armado, i.causales, i.auditoria, i.primerPiso]),
        ...estiloTabla,
        columnStyles: { 0: { cellWidth: 47 }, 1: { cellWidth: 45 }, 2: { cellWidth: 83 }, 3: { cellWidth: 53 }, 4: { cellWidth: 61 }, 5: { cellWidth: 107 }, 6: { cellWidth: 61 }, 7: { cellWidth: 80 }, 8: { cellWidth: 42 }, 9: { cellWidth: 86 }, 10: { cellWidth: 47 }, 11: { cellWidth: 32 } },
        // Color de la fila según ARMADO? (SI verde, NO rojo claro)
        didParseCell: (d) => { if (d.section === "body") { const c = COLOR_FILA[r.items[d.row.index] && r.items[d.row.index].armado]; if (c) d.cell.styles.fillColor = c.pdf; } },
        didDrawPage: (d) => { if (d.pageNumber > paginaInicial) banda(`${r.tecnico} | ${reg.etiquetaTec}`); },
      });
    });
  });

  // Pie de página
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120); doc.text(`Página ${i}`, W - M - 4, doc.internal.pageSize.getHeight() - 12, { align: "right" }); }
  return doc.output("blob");
}
