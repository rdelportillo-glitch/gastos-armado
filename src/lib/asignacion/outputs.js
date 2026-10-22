// Salidas de la asignación: PDF de rutas por región y resumen en Excel.
import * as XLSX from "xlsx";
import { summaryByTech, kmVia } from "./data.js";
import { haversine } from "./engine.js";
import { tvTexto } from "../tv/tvText.js";

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
  return buildRegionsPdf({ plan, techs, regions: [region], regionName, fecha });
}

// Igual que el PDF por región, pero con varias regiones en un solo archivo y opciones para el PDF que sale de Carga:
//  - resaltarCompartidos: los servicios compartidos (con apoyo) van con toda la fila en azul, tanto en la hoja del técnico como en la del apoyo.
//    Si además son prioridad 1, la celda "Prior." queda en amarillo.
//  - origen: texto que se agrega al título (ej. "ACTUALIZADO DESDE CARGA").
export async function buildRegionsPdf({ plan, techs, regions, regionName, fecha, resaltarCompartidos = false, origen = "" }) {
  const { jsPDF } = await import("jspdf");
  const at = await import("jspdf-autotable");
  const autoTable = [at.default, at.default && at.default.default, at.autoTable].find((f) => typeof f === "function");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const byId = new Map(plan.services.map((s) => [s.id, s]));
  const inicioRegion = []; // [{ region, pagina }] para el pie de página

  // Instalación de TV (servicio adicional): se indica en la primera fila del servicio.
  const tvDe = (s) => { const o = (s.rows.find((r) => r.tv) || {}).tv; const extra = (s.rows.find((r) => r.tvMin) || {}).tvMin; return o ? `${tvTexto(o)}${extra ? ` (+${extra} min)` : ""}` : ""; };
  // Tiempo del producto según los maestros (sin los minutos de instalación de TV, que van en su propia columna).
  const tiempoDe = (r) => { const m = r.tiempoBase ?? r.tiempo; return m ? `${m} min` : ""; };
  // El PDF no lleva teléfonos: tampoco los que Jamar escribe a mano dentro de "Cliente reporta" (ej. "TEL:3002282294").
  const sinCelulares = (t) => String(t || "").replace(/(^|\D)(3\d{2}[\s.\-]?\d{3}[\s.\-]?\d{4})(?!\d)/g, "$1[tel. omitido]");

  regions.forEach((region, idxRegion) => {
    const nombre = regionName[region] || `Región ${region}`;
    const regionServices = plan.services.filter((s) => s.region === region);
    const conRuta = plan.techs.filter((p) => p.t.reg === region && (p.svcIds.length || p.help.length))
      .sort((a, b) => (a.t.ord ?? 999) - (b.t.ord ?? 999) || a.n.localeCompare(b.n));
    const sinRutaNames = new Set(conRuta.map((p) => p.n));
    const sinRuta = techs.filter((t) => t.reg === region && !sinRutaNames.has(t.n)).sort((a, b) => (a.ord ?? 999) - (b.ord ?? 999) || a.n.localeCompare(b.n));
    const ciudadesDe = (svcs) => [...new Set(svcs.map((s) => s.ciudad).filter(Boolean))].join(", ");
    const productosDe = (svcs) => svcs.reduce((a, s) => a + s.rows.length, 0);

    // --- Hoja de resumen
    if (idxRegion > 0) doc.addPage();
    inicioRegion.push({ region, pagina: doc.internal.getNumberOfPages() });
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(0);
    doc.text(`Fecha: ${fecha} | Técnicos con ruta: ${conRuta.length} | Productos: ${productosDe(regionServices)} | Servicios: ${regionServices.length}`, W / 2, 30, { align: "center" });
    doc.setFontSize(10);
    doc.text(`Minutos totales de la región: ${n1(regionServices.reduce((a, s) => a + s.min, 0))}`, W / 2, 46, { align: "center" });
    doc.setFontSize(9); doc.setTextColor(110);
    doc.text(`Orden de trabajo por técnico según la hoja de técnicos. Los servicios con prioridad 1 van resaltados en amarillo.${resaltarCompartidos ? " Los compartidos (con apoyo) van en azul, para el técnico y para el apoyo." : ""}`, W / 2, 62, { align: "center" });
    doc.setTextColor(0); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text(`PLAN DE RUTAS - REGIÓN ${region} - ${nombre}${origen ? ` (${origen})` : ""}`, W / 2, 90, { align: "center" });
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
      doc.text(`Ciudades: ${ciudadesDe(sv)} | Distancia aprox. de la ruta: ${n1(kmVia(p.km))} km`, 30, 48);
      const body = [], compartida = []; // compartida[i]: la fila i es de un servicio compartido (con apoyo)
      const fila = (s, r, i, cliente, comp) => { body.push([r.prioridad === "Prioridad 1" ? "P1" : "", s.orden ?? "", s.servicio, cliente, sinCelulares(r.direccion), r.zona || "", r.tipoArmado || "", r.producto, tiempoDe(r), i === 0 ? tvDe(s) : "", sinCelulares(r.reporta)]); compartida.push(!!comp && resaltarCompartidos); };
      sv.forEach((s) => s.rows.forEach((r, i) => fila(s, r, i, resaltarCompartidos && (s.helpers || []).length ? `${s.cliente} (con apoyo de ${s.helpers.join(", ")})` : s.cliente, (s.helpers || []).length > 0)));
      p.help.forEach((h) => { const s = byId.get(h.id); if (s) s.rows.forEach((r, i) => fila(s, r, i, `${s.cliente} (apoyo a ${s.tech})`, true)); });
      autoTable(doc, {
        startY: 58, margin: { left: 14, right: 14 },
        head: [["Prior.", "Orden", "Servicio", "Nombre cliente", "Dirección", "Zona equivalente", "Tipo armado", "Producto", "Tiempo", "Instalación TV", "Cliente reporta"]],
        body, styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" }, headStyles: { fillColor: [79, 24, 7], textColor: 255 },
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 26, halign: "center" }, 2: { cellWidth: 46 }, 3: { cellWidth: 80 }, 4: { cellWidth: 100 }, 5: { cellWidth: 72 }, 6: { cellWidth: 52 }, 8: { cellWidth: 36, halign: "right" }, 9: { cellWidth: 96 }, 10: { cellWidth: 84 } },
        didParseCell: (d) => {
          if (d.section !== "body") return;
          const p1 = d.row.raw[0] === "P1";
          if (compartida[d.row.index]) {
            d.cell.styles.fillColor = [189, 215, 255]; // servicio compartido: toda la fila en azul
            if (p1 && d.column.index === 0) { d.cell.styles.fillColor = [255, 226, 90]; d.cell.styles.fontStyle = "bold"; } // sigue visible que es prioridad
          } else if (p1) d.cell.styles.fillColor = [255, 243, 176];
          if (d.column.index === 9 && d.row.raw[9]) { d.cell.styles.fontStyle = "bold"; const t = d.row.raw[9]; d.cell.styles.textColor = t.startsWith("INSTALAR") ? [20, 110, 60] : t.startsWith("TV INDECISO") ? [160, 90, 0] : [110, 110, 110]; }
        },
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
  });

  // --- Pie de página (con la región a la que pertenece cada página)
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    const reg = [...inicioRegion].reverse().find((x) => x.pagina <= i);
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Región ${reg ? reg.region : ""} · Página ${i} de ${total}`, 14, doc.internal.pageSize.getHeight() - 12);
  }
  return doc.output("blob");
}
// Arma, con lo que hay HOY en Carga (registros de services, ya con reasignaciones y cambios), un "plan" con la misma forma que el de la
// asignación para poder usar el mismo PDF por región. Un servicio es el conjunto de productos de un número de servicio con el mismo técnico y apoyo.
//  records: registros de Carga (los que se van a imprimir) · regionOf(registro) → región · tvDe(numeroServicio) → oferta de TV o null
//  regionDeDepto(departamento) → región de la ficha del técnico · todosLosTecnicos: fichas de Personal para listar a los que no tienen ruta
//  soloTecnicos: si se indica, solo se imprimen las hojas de esos técnicos (por nombre).
export function planDesdeCarga({ records, technicians, regionOf, tvDe = () => null, regionDeDepto = () => null, sinRuta = false, soloTecnicos = null }) {
  const plano = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
  const porId = new Map(technicians.map((t) => [t.id, t]));
  const porNombre = new Map(technicians.map((t) => [plano(t.name), t]));
  const ficha = (nombre, t, regionServicio) => ({
    n: nombre, ord: t && t.assignOrder != null ? t.assignOrder : null, perf: t && /senior/i.test(t.type || "") ? "Maestro" : "Aprendiz",
    reg: (t && regionDeDepto(t.department)) ?? regionServicio ?? null, cap: t ? Number(t.capacityMinutes) || 0 : 0, capEff: t ? Number(t.capacityMinutes) || 0 : 0, estado: "Disponible",
  });

  const grupos = new Map();
  (records || []).forEach((s) => {
    const t = s.technicianId ? porId.get(s.technicianId) : null;
    const tecnico = t ? t.name : String(s.tecnico2Nombre || "").trim();
    const apoyo = String(s.tecnico3Nombre || "").trim();
    const key = `${s.servicioExterno}|${tecnico}|${apoyo}`;
    const a = s.asig || {};
    let g = grupos.get(key);
    if (!g) {
      g = { id: key, servicio: s.servicioExterno, cliente: s.clienteNombre || "", direccion: s.direccion || "", ciudad: s.ciudadExterna || "", depto: s.departamentoExterno || "", region: regionOf(s) ?? "?", zona: a.zona || "",
        orden: null, tech: tecnico || null, helpers: apoyo ? [apoyo] : [], rows: [], min: 0, prio: 0, lat: null, lng: null, reason: "" };
      grupos.set(key, g);
    }
    const n = Math.max(1, Math.round(Number(s.quantity) || 1));
    for (let i = 0; i < n; i++) {
      const tiempo = s.tiempoMin ? Math.round(Number(s.tiempoMin) / n) : null;
      g.rows.push({ prioridad: a.prioridad, direccion: s.direccion, zona: a.zona, tipoArmado: a.tipoArmado, producto: s.productoExternoNombre, tiempo, tiempoBase: tiempo, reporta: a.reporta });
      g.min += tiempo || 0;
    }
    if (a.prioridad === "Prioridad 1") g.prio = 1;
    if (s.rutaOrden != null) g.orden = g.orden == null ? s.rutaOrden : Math.min(g.orden, s.rutaOrden);
    if (g.lat == null && a.lat != null && a.lng != null) { g.lat = Number(a.lat); g.lng = Number(a.lng); }
  });
  // Instalación de TV: se marca el servicio y se suman sus minutos una sola vez.
  grupos.forEach((g) => {
    const o = tvDe(g.servicio);
    if (!o) return;
    g.rows[0].tv = o;
    const extra = ["Aceptó", "Indeciso"].includes(o.estado) ? Number(o.tiempo_min) || 0 : 0;
    if (extra > 0) { g.rows[0].tvMin = extra; g.min += extra; }
  });

  const servicios = [...grupos.values()].sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999) || String(a.servicio).localeCompare(String(b.servicio)));
  const asignados = servicios.filter((s) => s.tech), unassigned = servicios.filter((s) => !s.tech);

  const paginas = new Map(); // nombre del técnico -> { n, t, cap, used, svcIds, help, km }
  const tomar = (nombre, regionServicio) => {
    if (!paginas.has(nombre)) { const f = ficha(nombre, porNombre.get(plano(nombre)), regionServicio); paginas.set(nombre, { n: nombre, t: f, cap: f.cap, used: 0, svcIds: [], help: [], km: 0 }); }
    return paginas.get(nombre);
  };
  asignados.forEach((s) => { const p = tomar(s.tech, s.region); p.svcIds.push(s.id); p.used += s.min; });
  asignados.forEach((s) => s.helpers.forEach((h) => { const p = tomar(h, s.region); p.help.push({ id: s.id, min: s.min }); p.used += s.min; }));
  const byId = new Map(servicios.map((s) => [s.id, s]));
  paginas.forEach((p) => {
    let km = 0;
    for (let i = 1; i < p.svcIds.length; i++) km += haversine(byId.get(p.svcIds[i - 1]), byId.get(p.svcIds[i])) || 0;
    p.km = Math.round(km * 10) / 10; p.used = Math.round(p.used);
  });

  const solo = soloTecnicos ? new Set([...soloTecnicos].map(plano)) : null;
  const techsPlan = [...paginas.values()].filter((p) => !solo || solo.has(plano(p.n)));
  // Los que están en Personal y no tienen ruta (solo cuando no se filtra por técnico).
  const conRuta = new Set(techsPlan.map((p) => plano(p.n)));
  const techs = sinRuta && !solo ? technicians.filter((t) => t.category !== "Administrativo" && t.status === "Activo" && /junior|senior/i.test(t.type || "") && !conRuta.has(plano(t.name))).map((t) => ficha(t.name, t, null)) : [];
  return { plan: { services: servicios, techs: techsPlan, unassigned }, techs };
}
// Resumen de la asignación en Excel: por técnico, por departamento y sin asignar.
export function buildSummaryWorkbook({ plan, techs, fecha }) {
  const wb = XLSX.utils.book_new();
  const porTec = summaryByTech(plan).sort((a, b) => a.dep.localeCompare(b.dep) || b.minutos - a.minutos);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["DEPARTAMENTO", "TÉCNICO", "PERFIL", "SERVICIOS", "PRODUCTOS", "MOVIMIENTOS (DIRECCIONES)", "MINUTOS", "CAPACIDAD", "OCUPACIÓN", "KM RUTA APROX."],
    ...porTec.map((r) => [r.dep, r.n, r.perf, r.servicios, r.productos, r.movimientos, r.minutos, r.capacidad, r.capacidad ? r.minutos / r.capacidad : 0, r.km]),
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
export const CSV_HEADERS = ["EMPRESA", "FECHA", "SERVICIO", "NOMBRE CLIENTE", "DIRECCIÓN", "TELEFONO", "SEÑAS", "DPTO", "CIUDAD", "BARRIO", "PRODUCTO", "CÓDIGO", "TIEMPO", "OBSERVACION", "CLIENTE REPORTA", "USUARIO ORIGINAL", "TECNICO", "APOYO", "AGENCIA", "DOCUMENTO", "Nombre Equivalente", "TIPOARMADO"];
export const ddmmyyyy = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || "");
// En los servicios de armados en almacén el servicio interno es el código de la solicitud (AA-000008); en el CSV va el número del PQR
// (con el sufijo del lote cuando la solicitud se partió en varios, ej. STABARBARA-L2). Si no hay PQR, se deja el código.
export const servicioCsv = (r) => { if (!r.pqrNumero) return r.servicio; const lote = String(r.servicio).match(/-L\d+$/); return `${r.pqrNumero}${lote ? lote[0] : ""}`; };
export const numOrText = (v) => { const t = String(v ?? "").trim(); return t !== "" && /^\d+$/.test(t) ? Number(t) : t; };

// Una fila del CSV de Asignación (mismas 22 columnas y orden) a partir de un registro de Carga (services) con su técnico.
// Los datos salen de lo que guardó Asignación en el registro (asig): empresa, teléfono, señas, barrio, tipo, reporta, agencia, zona...
export function filaCsvDeRegistro(s, tecnico) {
  const a = s.asig || {};
  return [
    a.empresa || "", ddmmyyyy(a.fechaBase || a.fecha || s.fechaProg || s.date), numOrText(servicioCsv({ servicio: s.servicioExterno, pqrNumero: a.pqrNumero })), s.clienteNombre || a.cliente || "", s.direccion || a.direccion || "", a.telefono || "", a.senas || "",
    a.depto || s.departamentoExterno || "", a.ciudad || s.ciudadExterna || "", a.barrio || "", s.productoExternoNombre || a.producto || "", s.productoExternoCodigo || a.codigo || "",
    a.tiempo ?? s.tiempoMin ?? "", a.tipo || "", a.reporta || "", numOrText(a.usuarioOriginal), tecnico || "", s.tecnico3Nombre || "", a.agencia || "", numOrText(a.clienteId), a.zona || "", a.tipoArmado || "",
  ];
}

export function buildAssignmentCsv(plan, techs) {
  const ordOf = new Map(techs.map((t) => [t.n, t.ord ?? 9999]));
  const servicios = [...plan.services].sort((a, b) => {
    if (!!a.tech !== !!b.tech) return a.tech ? -1 : 1;
    return String(a.depto).localeCompare(String(b.depto)) || (ordOf.get(a.tech) ?? 9999) - (ordOf.get(b.tech) ?? 9999) || String(a.tech || "").localeCompare(String(b.tech || "")) || (a.orden || 0) - (b.orden || 0) || String(a.servicio).localeCompare(String(b.servicio));
  });
  const rows = [];
  servicios.forEach((s) => s.rows.forEach((r) => rows.push([
    r.empresa, ddmmyyyy(r.fechaBase || r.fecha), numOrText(servicioCsv(r)), r.cliente, r.direccion, r.telefono, r.senas, r.depto, r.ciudad, r.barrio, r.producto, r.codigo,
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
      return { ord: p.t.ord ?? i + 1, n: p.n, perf: p.t.perf, sv: sv.length, pr: sv.reduce((a, s) => a + s.rows.length, 0), mov: dirs.size, min: p.used, cap: p.cap, km: kmVia(p.km), ciudades };
    });
    const tot = filas.reduce((a, f) => ({ sv: a.sv + f.sv, pr: a.pr + f.pr, mov: a.mov + f.mov, min: a.min + f.min, cap: a.cap + f.cap, km: a.km + f.km }), { sv: 0, pr: 0, mov: 0, min: 0, cap: 0, km: 0 });
    doc.addPage();
    linea(`Fecha: ${fecha} | Técnicos con ruta: ${conRuta.length} | Productos: ${svRegion.reduce((a, s) => a + s.rows.length, 0)} | Servicios: ${svRegion.length}`, 30, 11);
    linea(`Minutos totales de la región: ${n1(svRegion.reduce((a, s) => a + s.min, 0))}`, 46);
    titulo(`RESUMEN DE ASIGNACIÓN - REGIÓN ${region} - ${nombre}`, 74);
    autoTable(doc, {
      startY: 86, margin: { left: 14, right: 14 },
      head: [["Orden", "Técnico", "Perfil", "Servicios", "Productos", "Movimientos", "Minutos", "Capacidad", "% Ocupación", "Km ruta", "Ciudades"]],
      body: [
        ...filas.map((f) => [f.ord, f.n, f.perf, f.sv, f.pr, f.mov, n1(f.min), n1(f.cap), `${n1(pctOf(f.min, f.cap))}%`, n1(f.km), f.ciudades]),
        ...sinRuta.map((t) => [t.ord ?? "", t.n, t.estado && t.estado !== "Disponible" ? `${t.perf} - ${t.estado}` : t.perf, 0, 0, 0, "0.0", n1(t.capEff), "0.0%", "0.0", ""]),
      ],
      foot: [["", "TOTAL", "", tot.sv, tot.pr, tot.mov, n1(tot.min), n1(tot.cap), `${n1(pctOf(tot.min, tot.cap))}%`, n1(tot.km), ""]],
      styles: { fontSize: 8, cellPadding: 3 }, headStyles: head, footStyles: { fillColor: [241, 233, 213], textColor: 0, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 38 }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } },
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

// Se arma con lo que ya está en Carga para esa fecha (registros de services), no con el plan en pantalla: así junta lo que enviaron
// todos los coordinadores. asignados/devueltos son registros (uno por producto); aquí se agrupan por servicio.
export function buildTechChangeWorkbook({ asignados: regAsignados, devueltos: regDevueltos, technicians, fecha }) {
  const tById = new Map((technicians || []).map((t) => [t.id, t]));
  const agrupar = (list) => {
    const m = new Map();
    (list || []).forEach((r) => {
      const k = String(r.servicioExterno);
      const g = m.get(k) || { servicio: k, rows: [], techId: r.technicianId, orden: r.rutaOrden, depto: (r.asig && r.asig.depto) || r.departamentoExterno || "" };
      g.rows.push(r); m.set(k, g);
    });
    return [...m.values()];
  };
  const ordOf = (g) => { const t = tById.get(g.techId); return t && t.assignOrder != null ? t.assignOrder : 9999; };
  const nomOf = (g) => { const t = tById.get(g.techId); return t ? t.name : ""; };
  const usrOf = (g) => { const t = tById.get(g.techId); return t ? t.extremeUser || "" : ""; };
  const porDepto = (a, b) => String(a.depto).localeCompare(String(b.depto));
  const asignados = agrupar(regAsignados).sort((a, b) => porDepto(a, b) || ordOf(a) - ordOf(b) || nomOf(a).localeCompare(nomOf(b)) || (a.orden || 0) - (b.orden || 0));
  const devueltos = agrupar(regDevueltos).sort((a, b) => porDepto(a, b) || String(a.servicio).localeCompare(String(b.servicio)));
  const asig = (g) => g.rows[0].asig || {};
  const tipo = (g) => (g.rows.map((r) => r.asig && r.asig.tipoArmado).find(Boolean)) || "";
  const agencia = (g) => numOrText(asig(g).agencia);
  // FECHA_PROG es la que traía cada servicio en la base de asignación (no la fecha del selector).
  const fechaDe = (g) => asig(g).fecha || g.rows[0].fechaProg || fecha;
  const cuenta = {};
  [...asignados, ...devueltos].forEach((g) => { const f = fechaDe(g); cuenta[f] = (cuenta[f] || 0) + 1; });
  const fechaBase = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0] || fecha; // la más frecuente, para el nombre del archivo y el asunto

  const wb = XLSX.utils.book_new();
  const cambios = [["Proveedor", "FECHA_PROG", "AGENCIA", "SERVICIO", "TIPOARMADO", "Codigo Tecnico", "NOMBRE DEPARTAMENTO"],
    ...asignados.map((g) => ["Biver", fechaCelda(fechaDe(g)), agencia(g), numOrText(g.servicio), tipo(g), codigoCelda(usrOf(g)), g.depto])];
  const w1 = XLSX.utils.aoa_to_sheet(cambios);
  formatearFechas(w1);
  w1["!cols"] = [10, 12, 9, 11, 20, 15, 20].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, w1, "CAMBIOS DE TECNICOS ");
  const devuelto = [["Proveedor", "FECHA_PROG", "DIRECCION", "AGENCIA", "CLIENTEREPORTA", "SERVICIO", "Cantidad", "TIPOARMADO", "Codigo Tecnico", "NOMBRE DEPARTAMENTO", "OBSERVACION"],
    ...devueltos.map((g) => ["Biver", fechaCelda(fechaDe(g)), g.rows[0].direccion || asig(g).direccion || "", agencia(g), asig(g).reporta || "", numOrText(g.servicio), g.rows.length, tipo(g), "ALMACEN", g.depto, ""])];
  const w2 = XLSX.utils.aoa_to_sheet(devuelto);
  formatearFechas(w2);
  w2["!cols"] = [10, 12, 30, 9, 36, 11, 9, 20, 15, 20, 20].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, w2, "DEVUELTO");

  const sinCodigo = [...new Set(asignados.filter((g) => !usrOf(g)).map((g) => nomOf(g) || "(técnico sin ficha)"))];
  const [y, m, d] = String(fechaBase).slice(0, 10).split("-");
  return { wb, name: `Cambio_de_tecnico_${d}-${m}-${y}.xlsx`, fechaBase, asignados: asignados.length, devueltos: devueltos.length, sinCodigo };
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
