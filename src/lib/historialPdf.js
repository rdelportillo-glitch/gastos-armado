// PDF del Historial de gastos según los filtros seleccionados (horizontal, carta). Las filas llegan ya formateadas desde la pantalla.
//   head: encabezados · body: filas de texto · filtros: líneas "Etiqueta: valor" de lo que se filtró · resumen: { total, activos, anulados }
const C = { oscuro: [59, 47, 42], naranja: [224, 138, 30], gris: [110, 100, 92], beige: [243, 236, 223] };

export async function buildHistorialPdf({ head, body, filtros, resumen, generadoPor, fecha }) {
  const { jsPDF } = await import("jspdf");
  const at = await import("jspdf-autotable");
  const autoTable = [at.default, at.default && at.default.default, at.autoTable].find((f) => typeof f === "function");
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 30;

  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...C.oscuro); doc.text("Historial de gastos", M, 40);
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(74, 58, 50); doc.text("BIVER", W - M, 40, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...C.gris);
  doc.text(`Generado el ${fecha}${generadoPor ? ` por ${generadoPor}` : ""}  ·  ${resumen.activos} gasto(s) activo(s)${resumen.anulados ? ` y ${resumen.anulados} anulado(s)` : ""}`, M, 54);
  doc.setFillColor(...C.naranja); doc.rect(M, 60, W - 2 * M, 1.6, "F");

  let y = 76;
  doc.setFontSize(8.5); doc.setTextColor(...C.oscuro);
  doc.setFont("helvetica", "bold"); doc.text("Filtros aplicados:", M, y);
  doc.setFont("helvetica", "normal");
  const lineas = doc.splitTextToSize(filtros.length ? filtros.join("   ·   ") : "Ninguno (todos los gastos)", W - 2 * M - 80);
  doc.text(lineas, M + 78, y);
  y += Math.max(1, lineas.length) * 11 + 6;

  const numeros = [5, 6, 7]; // cantidad, valor unitario y total (a la derecha)
  const columnStyles = Object.fromEntries(numeros.map((i) => [i, { halign: "right", cellWidth: i === 5 ? 28 : 56 }]));
  autoTable(doc, {
    startY: y, margin: { left: M, right: M, bottom: 34 }, head: [head], body, theme: "grid",
    styles: { font: "helvetica", fontSize: 7, cellPadding: 3, lineColor: [225, 215, 200], lineWidth: 0.4, textColor: C.oscuro, overflow: "linebreak" },
    headStyles: { fillColor: C.oscuro, textColor: 255, fontStyle: "bold", halign: "left" },
    alternateRowStyles: { fillColor: C.beige },
    columnStyles,
    didParseCell: (d) => { if (d.section === "body" && body[d.row.index] && body[d.row.index][9] === "Anulado") d.cell.styles.textColor = [150, 140, 130]; if (d.section === "head" && numeros.includes(d.column.index)) d.cell.styles.halign = "right"; },
  });
  let fin = doc.lastAutoTable.finalY + 14;
  if (fin > H - 50) { doc.addPage(); fin = 50; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...C.oscuro);
  doc.text(`Total de gastos activos: ${resumen.total}`, W - M, fin, { align: "right" });

  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...C.gris);
    doc.text("Biver · Gastos operativos – Técnicos de armado", M, H - 16);
    doc.text(`Página ${p} de ${n}`, W - M, H - 16, { align: "right" });
  }
  return doc.output("blob");
}
