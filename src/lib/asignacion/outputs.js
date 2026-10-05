// Salidas de la asignación: PDF de rutas por región y resumen en Excel.
import * as XLSX from "xlsx";
import { summaryByTech } from "./data.js";

const n1 = (v) => Number(v || 0).toFixed(1);
const pctOf = (a, b) => (b ? (a / b) * 100 : 0);

// Regiones que tienen servicios en el plan, con sus totales.
export function regionsOfPlan(plan, regionName) {
  const m = new Map();
  plan.services.forEach((s) => {
    const r = s.region ?? "?";
    const g = m.get(r) || { region: r, nombre: regionName[r] || `Región ${r}`, servicios: 0, asignados: 0, productos: 0, minutos: 0 };
    g.servicios++; if (s.tech) g.asignados++; g.productos += s.rows.length; g.minutos += s.min;
    m.set(r, g);
  });
  return [...m.values()].sort((a, b) => Number(a.region) - Number(b.region));
}

// PDF de una región: hoja de resumen + una página por técnico (horizontal, con las rutas en orden).
export async function buildRegionPdf({ plan, techs, region, regionName, fecha }) {
  const { jsPDF } = await import("jspdf");
  const at = await import("jspdf-autotable");
  const autoTable = [at.default, at.default && at.default.default, at.autoTable].find((f) => typeof f === "function");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const byId = new Map(plan.services.map((s) => [s.id, s]));
  const nombre = regionName[region] || `Región ${region}`;

  const regionServices = plan.services.filter((s) => s.region === region);
  const conRuta = plan.techs.filter((p) => p.t.reg === region && (p.svcIds.length || p.help.length))
    .sort((a, b) => (a.t.ord ?? 999) - (b.t.ord ?? 999) || a.n.localeCompare(b.n));
  const sinRutaNames = new Set(conRuta.map((p) => p.n));
  const sinRuta = techs.filter((t) => t.reg === region && !sinRutaNames.has(t.n)).sort((a, b) => (a.ord ?? 999) - (b.ord ?? 999) || a.n.localeCompare(b.n));
  const ciudadesDe = (svcs) => [...new Set(svcs.map((s) => s.ciudad).filter(Boolean))].join(", ");
  const productosDe = (svcs) => svcs.reduce((a, s) => a + s.rows.length, 0);

  // --- Hoja de resumen
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  doc.text(`Fecha: ${fecha} | Técnicos con ruta: ${conRuta.length} | Productos: ${productosDe(regionServices)} | Servicios: ${regionServices.length}`, W / 2, 30, { align: "center" });
  doc.setFontSize(10);
  doc.text(`Minutos totales de la región: ${n1(regionServices.reduce((a, s) => a + s.min, 0))}`, W / 2, 46, { align: "center" });
  doc.setFontSize(9); doc.setTextColor(110);
  doc.text("Orden de trabajo por técnico según la hoja de técnicos. Los servicios con prioridad 1 van resaltados en amarillo.", W / 2, 62, { align: "center" });
  doc.setTextColor(0); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(`PLAN DE RUTAS - REGIÓN ${region} - ${nombre}`, W / 2, 90, { align: "center" });
  const resumenRows = [
    ...conRuta.map((p, i) => {
      const sv = p.svcIds.map((id) => byId.get(id)).filter(Boolean);
      return [p.t.ord ?? i + 1, p.n, p.t.perf, productosDe(sv), sv.length, n1(p.used), n1(p.cap), `${n1(pctOf(p.used, p.cap))}%`, ciudadesDe(sv)];
    }),
    ...sinRuta.map((t) => [t.ord ?? "", t.n, t.estado && t.estado !== "Disponible" ? `${t.perf} - ${t.estado}` : t.perf, 0, 0, "0.0", n1(t.capEff), "0.0%", ""]),
  ];
  autoTable(doc, {
    startY: 102, margin: { left: 14, right: 14 },
    head: [["Orden", "Técnico", "Perfil", "Productos", "Servicios", "Minutos", "Capacidad", "% Utilización", "Ciudades"]],
    body: resumenRows, styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [79, 24, 7], textColor: 255 },
    columnStyles: { 0: { cellWidth: 40 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
  });

  // --- Una página por técnico
  conRuta.forEach((p, i) => {
    doc.addPage();
    const sv = p.svcIds.map((id) => byId.get(id)).filter(Boolean);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(0);
    doc.text(`Orden #${p.t.ord ?? i + 1} | Técnico: ${p.n} Región: ${region} | Perfil: ${p.t.perf} Productos: ${productosDe(sv)} | Servicios: ${sv.length} Min: ${n1(p.used)}/${n1(p.cap)} (${n1(pctOf(p.used, p.cap))}%)`, 30, 32);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Ciudades: ${ciudadesDe(sv)}`, 30, 48);
    const body = [];
    sv.forEach((s) => s.rows.forEach((r) => body.push([r.prioridad === "Prioridad 1" ? "P1" : "", s.orden, s.servicio, s.cliente, r.telefono || "", r.direccion, r.zona || "", r.tiempo ? `${r.tiempo} min` : "", r.tipoArmado || "", r.producto, r.reporta || ""])));
    p.help.forEach((h) => { const s = byId.get(h.id); if (s) s.rows.forEach((r) => body.push([r.prioridad === "Prioridad 1" ? "P1" : "", s.orden, s.servicio, `${s.cliente} (apoyo a ${s.tech})`, r.telefono || "", r.direccion, r.zona || "", "", r.tipoArmado || "", r.producto, r.reporta || ""])); });
    autoTable(doc, {
      startY: 58, margin: { left: 14, right: 14 },
      head: [["Prior.", "Orden", "Servicio", "Nombre cliente", "Teléfono", "Dirección", "Zona equivalente", "Tiempo", "Tipo armado", "Producto", "Cliente reporta"]],
      body, styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [79, 24, 7], textColor: 255 },
      columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 28, halign: "center" }, 2: { cellWidth: 50 }, 3: { cellWidth: 78 }, 4: { cellWidth: 60 }, 5: { cellWidth: 90 }, 6: { cellWidth: 70 }, 7: { cellWidth: 36, halign: "right" }, 8: { cellWidth: 52 }, 10: { cellWidth: 90 } },
      didParseCell: (d) => { if (d.section === "body" && d.row.raw[0] === "P1") d.cell.styles.fillColor = [255, 243, 176]; },
    });
  });

  // --- Sin asignar de la región
  const un = plan.unassigned.filter((s) => s.region === region);
  if (un.length) {
    doc.addPage();
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(0);
    doc.text(`SERVICIOS SIN ASIGNAR - REGIÓN ${region} (${un.length})`, 30, 32);
    autoTable(doc, {
      startY: 46, margin: { left: 14, right: 14 },
      head: [["Servicio", "Cliente", "Dirección", "Ciudad", "Zona equivalente", "Min", "Prior.", "Motivo"]],
      body: un.map((s) => [s.servicio, s.cliente, s.direccion, s.ciudad, s.zona || "", s.min, s.prio ? "P1" : "", s.reason || ""]),
      styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [150, 40, 30], textColor: 255 },
    });
  }

  // --- Pie de página
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Región ${region} · Página ${i} de ${total}`, 14, doc.internal.pageSize.getHeight() - 12);
  }
  return doc.output("blob");
}

// Resumen de la asignación en Excel: por técnico, por departamento y sin asignar.
export function buildSummaryWorkbook({ plan, techs, fecha }) {
  const wb = XLSX.utils.book_new();
  const porTec = summaryByTech(plan).sort((a, b) => a.dep.localeCompare(b.dep) || b.minutos - a.minutos);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["DEPARTAMENTO", "TÉCNICO", "PERFIL", "SERVICIOS", "PRODUCTOS", "MOVIMIENTOS (DIRECCIONES)", "MINUTOS", "CAPACIDAD", "OCUPACIÓN"],
    ...porTec.map((r) => [r.dep, r.n, r.perf, r.servicios, r.productos, r.movimientos, r.minutos, r.capacidad, r.capacidad ? r.minutos / r.capacidad : 0]),
  ]), "Por técnico");

  const dep = {};
  plan.services.forEach((s) => {
    const d = dep[s.depto] = dep[s.depto] || { s: 0, sa: 0, p: 0, m: 0, ma: 0, t: new Set(), cap: 0 };
    d.s++; d.p += s.rows.length; d.m += s.min;
    if (s.tech) { d.sa++; d.ma += s.min; d.t.add(s.tech); }
  });
  techs.filter((t) => t.activo).forEach((t) => { if (dep[t.dep]) dep[t.dep].cap += t.capEff; });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["DEPARTAMENTO", "SERVICIOS", "ASIGNADOS", "PRODUCTOS", "MINUTOS CARGA", "MINUTOS ASIGNADOS", "CAPACIDAD DISPONIBLE", "OCUPACIÓN", "TÉCNICOS CON RUTA"],
    ...Object.entries(dep).map(([d, v]) => [d, v.s, v.sa, v.p, v.m, v.ma, v.cap, v.cap ? v.ma / v.cap : 0, v.t.size]),
  ]), "Por departamento");

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["SERVICIO", "DEPARTAMENTO", "CIUDAD", "ZONA", "MINUTOS", "PRIORIDAD", "MOTIVO"],
    ...plan.unassigned.map((s) => [s.servicio, s.depto, s.ciudad, s.zona || "", s.min, s.prio ? "Prioridad 1" : "Normal", s.reason || ""]),
  ]), "Sin asignar");
  return { wb, name: `Resumen_asignacion_${fecha}.xlsx` };
}

export function downloadWorkbook(wb, filename) { XLSX.writeFile(wb, filename); }

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
