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
    sv.forEach((s) => s.rows.forEach((r) => body.push([r.prioridad === "Prioridad 1" ? "P1" : "", s.orden, s.servicio, s.cliente, r.telefono || "", r.direccion, r.zona || "", r.tipoArmado || "", r.producto, r.reporta || ""])));
    p.help.forEach((h) => { const s = byId.get(h.id); if (s) s.rows.forEach((r) => body.push([r.prioridad === "Prioridad 1" ? "P1" : "", s.orden, s.servicio, `${s.cliente} (apoyo a ${s.tech})`, r.telefono || "", r.direccion, r.zona || "", r.tipoArmado || "", r.producto, r.reporta || ""])); });
    autoTable(doc, {
      startY: 58, margin: { left: 14, right: 14 },
      head: [["Prior.", "Orden", "Servicio", "Nombre cliente", "Teléfono", "Dirección", "Zona equivalente", "Tipo armado", "Producto", "Cliente reporta"]],
      body, styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [79, 24, 7], textColor: 255 },
      columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 28, halign: "center" }, 2: { cellWidth: 50 }, 3: { cellWidth: 82 }, 4: { cellWidth: 62 }, 5: { cellWidth: 96 }, 6: { cellWidth: 76 }, 7: { cellWidth: 56 }, 9: { cellWidth: 96 } },
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

// CSV de la asignación en el formato de "CSV Asignacion.xlsx": una fila por producto, con TECNICO y APOYO
// (vacíos si el servicio quedó sin asignar). Orden: departamento, orden del técnico en Personal, orden de ruta; sin asignar al final.
const CSV_HEADERS = ["EMPRESA", "FECHA", "SERVICIO", "NOMBRE CLIENTE", "DIRECCIÓN", "TELEFONO", "SEÑAS", "DPTO", "CIUDAD", "BARRIO", "PRODUCTO", "CÓDIGO", "TIEMPO", "OBSERVACION", "CLIENTE REPORTA", "USUARIO ORIGINAL", "TECNICO", "APOYO", "AGENCIA", "DOCUMENTO", "Nombre Equivalente", "TIPOARMADO"];
const ddmmyyyy = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || "");
const numOrText = (v) => { const t = String(v ?? "").trim(); return t !== "" && /^\d+$/.test(t) ? Number(t) : t; };

export function buildAssignmentCsv(plan, techs) {
  const ordOf = new Map(techs.map((t) => [t.n, t.ord ?? 9999]));
  const servicios = [...plan.services].sort((a, b) => {
    if (!!a.tech !== !!b.tech) return a.tech ? -1 : 1;
    return String(a.depto).localeCompare(String(b.depto)) || (ordOf.get(a.tech) ?? 9999) - (ordOf.get(b.tech) ?? 9999) || String(a.tech || "").localeCompare(String(b.tech || "")) || (a.orden || 0) - (b.orden || 0) || String(a.servicio).localeCompare(String(b.servicio));
  });
  const rows = [];
  servicios.forEach((s) => s.rows.forEach((r) => rows.push([
    r.empresa, ddmmyyyy(r.fecha), numOrText(r.servicio), r.cliente, r.direccion, r.telefono, r.senas, r.depto, r.ciudad, r.barrio, r.producto, r.codigo,
    r.tiempo, r.tipo, r.reporta, numOrText(r.usuarioOriginal), s.tech || "", (s.helpers || []).join(", "), r.agencia, numOrText(r.clienteId), r.zona || "", r.tipoArmado || "",
  ])));
  return { headers: CSV_HEADERS, rows };
}

// Resumen de la asignación en PDF (mismo estilo que los PDF de rutas): hoja general por departamento y una sección
// por región con el resumen de cada técnico (servicios, productos, movimientos, minutos, capacidad y ocupación).
export async function buildSummaryPdf({ plan, techs, regionName, fecha }) {
  const { jsPDF } = await import("jspdf");
  const at = await import("jspdf-autotable");
  const autoTable = [at.default, at.default && at.default.default, at.autoTable].find((f) => typeof f === "function");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const byId = new Map(plan.services.map((s) => [s.id, s]));
  const head = { fillColor: [79, 24, 7], textColor: 255 };
  const titulo = (txt, y) => { doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(0); doc.text(txt, W / 2, y, { align: "center" }); };
  const linea = (txt, y, size = 10, gris = false) => { doc.setFont("helvetica", "normal"); doc.setFontSize(size); doc.setTextColor(gris ? 110 : 0); doc.text(txt, W / 2, y, { align: "center" }); doc.setTextColor(0); };

  // --- Hoja general
  const asignados = plan.services.filter((s) => s.tech);
  const minTot = plan.services.reduce((a, s) => a + s.min, 0), minAsig = asignados.reduce((a, s) => a + s.min, 0);
  linea(`Fecha: ${fecha} | Servicios: ${plan.services.length} (${asignados.length} asignados, ${plan.unassigned.length} sin asignar) | Productos: ${plan.services.reduce((a, s) => a + s.rows.length, 0)}`, 30, 11);
  linea(`Minutos de la carga: ${n1(minTot)} | Minutos asignados: ${n1(minAsig)} | Técnicos con ruta: ${plan.techs.filter((p) => p.svcIds.length).length}`, 46);
  titulo("RESUMEN DE LA ASIGNACIÓN - POR DEPARTAMENTO", 78);
  const dep = {};
  plan.services.forEach((s) => {
    const d = (dep[s.depto] = dep[s.depto] || { s: 0, sa: 0, p: 0, m: 0, ma: 0, t: new Set(), cap: 0 });
    d.s++; d.p += s.rows.length; d.m += s.min;
    if (s.tech) { d.sa++; d.ma += s.min; d.t.add(s.tech); }
  });
  techs.filter((t) => t.activo).forEach((t) => { if (dep[t.dep]) dep[t.dep].cap += t.capEff; });
  autoTable(doc, {
    startY: 90, margin: { left: 14, right: 14 },
    head: [["Departamento", "Servicios", "Asignados", "Productos", "Minutos carga", "Minutos asignados", "Capacidad disponible", "% Ocupación", "Técnicos con ruta"]],
    body: Object.entries(dep).sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => [d, v.s, v.sa, v.p, n1(v.m), n1(v.ma), n1(v.cap), `${n1(pctOf(v.ma, v.cap))}%`, v.t.size]),
    styles: { fontSize: 8, cellPadding: 3 }, headStyles: head,
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
  });

  // --- Una sección por región
  const regiones = [...new Set(plan.services.map((s) => s.region ?? "?"))].sort((a, b) => Number(a) - Number(b));
  regiones.forEach((region) => {
    const nombre = regionName[region] || `Región ${region}`;
    const conRuta = plan.techs.filter((p) => (p.t.reg ?? "?") === region && (p.svcIds.length || p.help.length)).sort((a, b) => (a.t.ord ?? 999) - (b.t.ord ?? 999) || a.n.localeCompare(b.n));
    const names = new Set(conRuta.map((p) => p.n));
    const sinRuta = techs.filter((t) => (t.reg ?? "?") === region && !names.has(t.n)).sort((a, b) => (a.ord ?? 999) - (b.ord ?? 999) || a.n.localeCompare(b.n));
    const svRegion = plan.services.filter((s) => (s.region ?? "?") === region);
    const filas = conRuta.map((p, i) => {
      const sv = p.svcIds.map((id) => byId.get(id)).filter(Boolean);
      const dirs = new Set(sv.map((s) => `${s.ciudad}|${s.direccion}`));
      const ciudades = [...new Set(sv.map((s) => s.ciudad).filter(Boolean))].join(", ");
      return { ord: p.t.ord ?? i + 1, n: p.n, perf: p.t.perf, sv: sv.length, pr: sv.reduce((a, s) => a + s.rows.length, 0), mov: dirs.size, min: p.used, cap: p.cap, ciudades };
    });
    const tot = filas.reduce((a, f) => ({ sv: a.sv + f.sv, pr: a.pr + f.pr, mov: a.mov + f.mov, min: a.min + f.min, cap: a.cap + f.cap }), { sv: 0, pr: 0, mov: 0, min: 0, cap: 0 });
    doc.addPage();
    linea(`Fecha: ${fecha} | Técnicos con ruta: ${conRuta.length} | Productos: ${svRegion.reduce((a, s) => a + s.rows.length, 0)} | Servicios: ${svRegion.length}`, 30, 11);
    linea(`Minutos totales de la región: ${n1(svRegion.reduce((a, s) => a + s.min, 0))}`, 46);
    titulo(`RESUMEN DE ASIGNACIÓN - REGIÓN ${region} - ${nombre}`, 74);
    autoTable(doc, {
      startY: 86, margin: { left: 14, right: 14 },
      head: [["Orden", "Técnico", "Perfil", "Servicios", "Productos", "Movimientos", "Minutos", "Capacidad", "% Ocupación", "Ciudades"]],
      body: [
        ...filas.map((f) => [f.ord, f.n, f.perf, f.sv, f.pr, f.mov, n1(f.min), n1(f.cap), `${n1(pctOf(f.min, f.cap))}%`, f.ciudades]),
        ...sinRuta.map((t) => [t.ord ?? "", t.n, t.estado && t.estado !== "Disponible" ? `${t.perf} - ${t.estado}` : t.perf, 0, 0, 0, "0.0", n1(t.capEff), "0.0%", ""]),
      ],
      foot: [["", "TOTAL", "", tot.sv, tot.pr, tot.mov, n1(tot.min), n1(tot.cap), `${n1(pctOf(tot.min, tot.cap))}%`, ""]],
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: head, footStyles: { fillColor: [241, 233, 213], textColor: 0, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 38 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
    });
  });

  // --- Sin asignar
  if (plan.unassigned.length) {
    doc.addPage();
    titulo(`SERVICIOS SIN ASIGNAR (${plan.unassigned.length})`, 32);
    autoTable(doc, {
      startY: 46, margin: { left: 14, right: 14 },
      head: [["Servicio", "Departamento", "Ciudad", "Zona equivalente", "Min", "Prior.", "Motivo"]],
      body: plan.unassigned.map((s) => [s.servicio, s.depto, s.ciudad, s.zona || "", s.min, s.prio ? "P1" : "", s.reason || ""]),
      styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [150, 40, 30], textColor: 255 },
    });
  }

  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Resumen de asignación · ${fecha} · Página ${i} de ${total}`, 14, doc.internal.pageSize.getHeight() - 12);
  }
  return doc.output("blob");
}

// Excel "Cambio de técnico" (formato de la plantilla de cambios): POR SERVICIO, no por producto.
//  - CAMBIOS DE TECNICOS: un servicio por fila, con el código del técnico (usuario Extreme).
//  - DEVUELTO: los servicios sin asignar, con código ALMACEN.
// La fecha va como número de serie de Excel exacto (días, sin hora) con formato dd/mm/aaaa. Si se escribe un Date de
// JavaScript, la librería lo guarda unos segundos antes de la medianoche y Excel muestra el día anterior.
const fechaCelda = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) + 25569 : ""; };
const formatearFechas = (ws, col = "B") => { Object.keys(ws).filter((k) => new RegExp(`^${col}[2-9]\\d*$`).test(k)).forEach((k) => { if (typeof ws[k].v === "number") { ws[k].t = "n"; ws[k].z = "dd/mm/yyyy"; } }); };
// Los códigos numéricos van como número y los que empiezan en 0 (ej. 00783) como texto, igual que la plantilla.
const codigoCelda = (v) => { const t = String(v ?? "").trim(); return /^[1-9]\d*$/.test(t) ? Number(t) : t; };

export function buildTechChangeWorkbook({ plan, techs, fecha }) {
  const usrOf = new Map(techs.map((t) => [t.n, t.usr || ""]));
  const ordOf = new Map(techs.map((t) => [t.n, t.ord ?? 9999]));
  const porDepto = (a, b) => String(a.depto).localeCompare(String(b.depto));
  const asignados = plan.services.filter((s) => s.tech).sort((a, b) => porDepto(a, b) || (ordOf.get(a.tech) ?? 9999) - (ordOf.get(b.tech) ?? 9999) || String(a.tech).localeCompare(String(b.tech)) || (a.orden || 0) - (b.orden || 0));
  const devueltos = plan.services.filter((s) => !s.tech).sort((a, b) => porDepto(a, b) || String(a.servicio).localeCompare(String(b.servicio)));
  const tipo = (s) => (s.rows.find((r) => r.tipoArmado) || {}).tipoArmado || "";
  const agencia = (s) => numOrText((s.rows[0] || {}).agencia);

  const wb = XLSX.utils.book_new();
  const cambios = [["Proveedor", "FECHA_PROG", "AGENCIA", "SERVICIO", "TIPOARMADO", "Codigo Tecnico", "NOMBRE DEPARTAMENTO"],
    ...asignados.map((s) => ["Biver", fechaCelda(fecha), agencia(s), numOrText(s.servicio), tipo(s), codigoCelda(usrOf.get(s.tech)), s.depto])];
  const w1 = XLSX.utils.aoa_to_sheet(cambios);
  formatearFechas(w1);
  w1["!cols"] = [10, 12, 9, 11, 20, 15, 20].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, w1, "CAMBIOS DE TECNICOS ");
  const devuelto = [["Proveedor", "FECHA_PROG", "DIRECCION", "AGENCIA", "CLIENTEREPORTA", "SERVICIO", "Cantidad", "TIPOARMADO", "Codigo Tecnico", "NOMBRE DEPARTAMENTO", "OBSERVACION"],
    ...devueltos.map((s) => ["Biver", fechaCelda(fecha), (s.rows[0] || {}).direccion || "", agencia(s), (s.rows[0] || {}).reporta || "", numOrText(s.servicio), s.rows.length, tipo(s), "ALMACEN", s.depto, ""])];
  const w2 = XLSX.utils.aoa_to_sheet(devuelto);
  formatearFechas(w2);
  w2["!cols"] = [10, 12, 30, 9, 36, 11, 9, 20, 15, 20, 20].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, w2, "DEVUELTO");

  const sinCodigo = [...new Set(asignados.filter((s) => !usrOf.get(s.tech)).map((s) => s.tech))];
  const [y, m, d] = String(fecha).slice(0, 10).split("-");
  return { wb, name: `Cambio_de_tecnico_${d}-${m}-${y}.xlsx`, asignados: asignados.length, devueltos: devueltos.length, sinCodigo };
}

// Enlaces para abrir el correo ya redactado (Gmail web o programa de correo). Los enlaces no pueden llevar adjuntos:
// el Excel se descarga aparte y se adjunta al correo.
export function mailLinks({ para = [], cc = [], subject = "", body = "" }) {
  const q = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return {
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&${q({ to: para.join(","), cc: cc.join(","), su: subject, body })}`,
    mailto: `mailto:${para.join(",")}?${q({ cc: cc.join(","), subject, body })}`,
  };
}

export function downloadWorkbook(wb, filename) { XLSX.writeFile(wb, filename); }

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
