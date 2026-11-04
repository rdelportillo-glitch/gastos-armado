// Informe de cierre de operación – Jamar: se calcula con el histórico de asignación de un día (la misma fila del CSV de Carga) y se entrega en PDF y por correo.
// Clasificación por producto: ARMADO? = SI → armado; NO → no armado; técnico aplazado, duplicado, devuelto (almacén / sobrecarga)... → cancelado; sin causal → no armado "sin causal registrada".
import { supabase } from "./supabaseClient";
import { CSV_CARGA_HEADERS } from "./asignacion/csvCarga";
import { DEPARTAMENTOS_CO } from "./colombiaData";

const KEY = "informe_jamar_email";
export const INFORME_EMAIL_DEFAULT = {
  destinatarios: [],
  asunto: "Informe de cierre de operación – Jamar {fecha}",
  mensaje: "Buenos días,\n\nAdjunto el informe de cierre de la operación del {fecha}: {total} productos gestionados, {armados} armados ({efectividad}% de efectividad), {noArmados} no armados y {cancelados} cancelados.\n\nCordial saludo,",
};
export async function loadInformeEmailConfig() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  return { ...INFORME_EMAIL_DEFAULT, ...((data && data.value) || {}) };
}
export async function saveInformeEmailConfig(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: KEY, value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const H = Object.fromEntries(CSV_CARGA_HEADERS.map((h, i) => [h, i]));
const bonito = (d) => { const p = plano(d); return d ? (DEPARTAMENTOS_CO.find((x) => plano(x) === p || plano(x).replace(/^LA /, "") === p) || d.charAt(0) + d.slice(1).toLowerCase()) : "Sin departamento"; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
export const fmtPct = (n) => `${(Math.round((Number(n) || 0) * 10) / 10).toFixed(1)}%`;

// Técnicos "de mentira" con los que se marca lo cancelado, aplazado, duplicado o devuelto.
const CANCELADORES = { APLAZADO: "Aplazado", DUPLICADO: "Duplicado", NO_PROGRAMAR: "No programar", "NO PROGRAMAR": "No programar", SERVICIO_ARMADO: "Servicio armado", "SERVICIO ARMADO": "Servicio armado", ALMACEN: "Almacén", SOBRECARGA: "Sobrecarga", "SOBRECARGA DIMENSIONAMIENTO": "Sobrecarga dimensionamiento" };

// Causa de un producto no armado (la agrupación del informe).
function causaNoArmado(c, causal, causales, diag) {
  const k = plano(causal), cod = plano(causales), d = plano(diag);
  if (!k && !cod) return "Sin causal registrada";
  if (cod === "CLTE_ARMO_MUEBLE" || k === "CLIENTE ARMO EL PRODUCTO" || k === "CLIENTE ARMA - LLAMADA") return "Cliente ya armó el producto";
  if (cod === "CLTE_APLAZA_CANCELA_SERVICIO" || k === "CLIENTE CANCELA") return "Cliente aplaza / cancela";
  if (cod === "CONTACTO_NO_EF" || k === "INMUEBLE CERRADO") return "Sin contacto / inmueble cerrado";
  if (cod === "DIR_ERRADA" || k === "DIRECCION ERRADA") return "Dirección errada";
  if (cod === "CONDICIONES_NO_OPERABLES" || k === "CONDICION NO OPERABLE") return "Condiciones no operables";
  if (cod === "PRODUCTO_NO_ARMABLE" || k === "PRODUCTO NO ARMABLE") return "Producto no armable";
  if (k === "NO QUISO ARMADO") return "El cliente no quiso el armado";
  if (k === "ESPERA PROLONGADA") return "Espera prolongada";
  if (k.startsWith("VISITA NO EFECTIVA")) return "Visita no efectiva / fuerza mayor";
  if (/ENTREGA ERRADA|COLOR/.test(d) && (k === "NO ARMADO POR NOVEDAD" || cod === "P_CALIDAD")) return "Entrega errada (color / producto)";
  if (cod === "MALTRATO_EN_CAJA") return "Maltrato en caja / pieza dañada";
  if (cod === "P_CALIDAD") return "Calidad / pieza errada";
  if (k === "NO ARMADO POR NOVEDAD") return "No armado por novedad";
  return causal || "Otra causa";
}

// filas: filas del CSV de Carga (arreglos en el orden de CSV_CARGA_HEADERS) de un día. empresa: "" = todas.
export function calcularInforme(filas, { empresa = "" } = {}) {
  const lista = filas.filter((f) => !empresa || plano(f[H["EMPRESA"]]) === plano(empresa));
  const info = { total: lista.length, armados: 0, noArmados: 0, cancelados: 0, garantias: 0, deptos: new Map(), causas: new Map(), tipos: new Map(), cancelaciones: new Map(), sinCausal: [], primerPiso: [] };
  const suma = (m, k, f) => { const e = m.get(k) || { total: 0, armado: 0, noArmado: 0, cancelado: 0 }; e.total++; e[f]++; m.set(k, e); };
  lista.forEach((f) => {
    const tec = plano(f[H["TECNICO"]]);
    const causal = f[H["Causal auditada"]] || f[H["Causal Extreme"]] || "";
    const armado = plano(f[H["ARMADO?"]]);
    const estado = CANCELADORES[tec] || armado === "CANCELADOS" ? "cancelado" : armado === "SI" ? "armado" : "noArmado";
    const campo = estado === "cancelado" ? "cancelado" : estado === "armado" ? "armado" : "noArmado";
    info[estado === "cancelado" ? "cancelados" : estado === "armado" ? "armados" : "noArmados"]++;
    if (plano(f[H["GARANTIA"]]) === "SI") info.garantias++;
    suma(info.deptos, bonito(f[H["DPTO"]]), campo);
    suma(info.tipos, String(f[H["OBSERVACION"]] || "").trim() || "Sin tipo", campo);
    if (estado === "noArmado") {
      const causa = causaNoArmado(f, causal, f[H["CAUSALES"]], f[H["Diagnóstico Extreme"]]);
      const e = info.causas.get(causa) || { n: 0, servicios: new Map() }; e.n++; e.servicios.set(String(f[H["SERVICIO"]]), (e.servicios.get(String(f[H["SERVICIO"]])) || 0) + 1); info.causas.set(causa, e);
      if (causa === "Sin causal registrada") info.sinCausal.push(String(f[H["SERVICIO"]]));
    }
    if (estado === "cancelado") {
      const quien = CANCELADORES[tec] || String(f[H["TECNICO"]] || "Sin técnico");
      const diag = String(f[H["Diagnóstico Extreme"]] || "").trim();
      const motivo = diag && !/^DEVUELTO POR/.test(plano(diag)) ? diag : "Sin motivo registrado";
      const k = `${quien}||${motivo}`;
      info.cancelaciones.set(k, (info.cancelaciones.get(k) || 0) + 1);
    }
    if (plano(f[H["PRIMER PISO"]]) === "SI" || /PRIMER PISO/.test(plano(f[H["Diagnóstico Extreme"]]))) info.primerPiso.push(String(f[H["SERVICIO"]]));
  });
  const orden = (m) => [...m.entries()].sort((a, b) => (b[1].total ?? b[1].n ?? b[1]) - (a[1].total ?? a[1].n ?? a[1]));
  info.listaDeptos = orden(info.deptos).map(([nombre, v]) => ({ nombre, ...v, particip: pct(v.total, info.total), pctArmado: pct(v.armado, v.total) }));
  info.listaTipos = orden(info.tipos).map(([nombre, v]) => ({ nombre, ...v, particip: pct(v.total, info.total) }));
  info.listaCausas = orden(info.causas).map(([nombre, v]) => ({ nombre, n: v.n, particip: pct(v.n, info.noArmados), servicios: [...v.servicios.entries()] }));
  info.listaCancelaciones = orden(info.cancelaciones).map(([k, n]) => { const [quien, motivo] = k.split("||"); return { quien, motivo, n, particip: pct(n, info.cancelados) }; });
  info.pctArmados = pct(info.armados, info.total); info.pctNoArmados = pct(info.noArmados, info.total); info.pctCancelados = pct(info.cancelados, info.total);
  info.empresas = [...new Set(filas.map((f) => String(f[H["EMPRESA"]] || "").trim()).filter(Boolean))];
  return info;
}

/* ------------------------------------ PDF ------------------------------------ */

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const fechaLarga = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };
export const fechaCorta = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };

const C = { oscuro: [59, 47, 42], naranja: [224, 138, 30], verde: [0, 176, 80], noArmado: [237, 125, 49], cancelado: [155, 44, 144], amarillo: [245, 184, 0], gris: [110, 100, 92], beige: [243, 236, 223], tan: [214, 199, 176] };

export async function buildInformeJamarPdf({ info, fecha, pendientes = [] }) {
  const { jsPDF } = await import("jspdf");
  const at = await import("jspdf-autotable");
  const autoTable = [at.default, at.default && at.default.default, at.autoTable].find((f) => typeof f === "function");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth(), Hh = doc.internal.pageSize.getHeight(), M = 42;
  let y = 0, pagina = 0;
  const color = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c) => doc.setFillColor(c[0], c[1], c[2]);

  const encabezado = () => {
    pagina++;
    // franja superior en degradé aproximado
    [[59, 47, 42], [110, 70, 30], [200, 120, 25], [224, 170, 90], [235, 205, 160]].forEach((c, i) => { fill(c); doc.rect((W / 5) * i, 0, W / 5 + 1, 6, "F"); });
    doc.setFont("helvetica", "bold"); doc.setFontSize(17); color(C.oscuro); doc.text("Informe de cierre de operación – Jamar", M, 38);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); color(C.gris);
    doc.text(`Corte operativo: ${fechaLarga(fecha)}  ·  Armado, desarme y empaque  ·  Resultado por producto`, M, 52);
    doc.setFont("helvetica", "bold"); doc.setFontSize(24); color([74, 58, 50]); doc.text("BIVER", W - M, 44, { align: "right" });
    fill(C.naranja); doc.rect(M, 60, W - 2 * M, 1.6, "F");
    y = 76;
  };
  const pie = () => {
    fill(C.oscuro); doc.rect(0, Hh - 26, W, 26, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255); doc.text("BIVER", M, Hh - 10);
    doc.setFont("helvetica", "normal"); doc.text("·  Informe operativo para Jamar", M + 28, Hh - 10);
    color(C.naranja); doc.setFont("helvetica", "bold"); doc.text(String(pagina), W - M, Hh - 10, { align: "right" });
  };
  const nueva = () => { pie(); doc.addPage(); encabezado(); };
  const ensure = (h) => { if (y + h > Hh - 40) nueva(); };
  const seccion = (txt) => {
    ensure(40);
    fill(C.oscuro); doc.rect(M, y, W - 2 * M, 22, "F"); fill(C.naranja); doc.rect(M, y, 4, 22, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(255, 255, 255); doc.text(txt, M + 14, y + 15);
    y += 30;
  };
  const tabla = (head, body, opts = {}) => {
    autoTable(doc, { startY: y, margin: { left: M, right: M, bottom: 40 }, head: [head], body, theme: "plain",
      styles: { fontSize: 8, cellPadding: 3, textColor: [50, 44, 40] }, headStyles: { fillColor: C.oscuro, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: C.beige }, columnStyles: Object.fromEntries(head.map((_, i) => [i, i === 0 ? {} : { halign: "right" }])),
      didParseCell: (d) => { if (opts.totalFila && d.section === "body" && d.row.index === body.length - 1) { d.cell.styles.fillColor = C.tan; d.cell.styles.fontStyle = "bold"; } }, ...opts.extra });
    y = doc.lastAutoTable.finalY + 8;
  };
  const barras = (items, colorBarra, maxItems = 12) => {
    const lista = items.slice(0, maxItems);
    const max = Math.max(1, ...lista.map((i) => i.n));
    const ancho = W - 2 * M - 230;
    lista.forEach((it) => {
      ensure(20);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); color([60, 52, 46]); doc.text(it.etiqueta, M + 190, y + 11, { align: "right" });
      fill(colorBarra); doc.rect(M + 198, y, Math.max(2, (it.n / max) * ancho), 14, "F");
      doc.setFont("helvetica", "bold"); color(C.oscuro); doc.text(`${it.n} · ${fmtPct(it.particip)}`, M + 198 + Math.max(2, (it.n / max) * ancho) + 6, y + 11);
      y += 19;
    });
    y += 4;
  };

  encabezado();
  // Tarjetas de resumen
  const tarjetas = [
    [String(info.total), "Total registros", "productos", [40, 40, 40]],
    [String(info.armados), "Armados", fmtPct(info.pctArmados), C.verde],
    [String(info.noArmados), "No armados", fmtPct(info.pctNoArmados), C.noArmado],
    [String(info.cancelados), "Cancelados", fmtPct(info.pctCancelados), C.cancelado],
    [String(pendientes.length), "Pendientes", pendientes.length ? "por gestionar" : "operación al día", pendientes.length ? C.noArmado : C.verde],
    [String(info.garantias), "Garantías", "con novedad", C.amarillo],
  ];
  const cw = (W - 2 * M) / tarjetas.length;
  fill(C.naranja); doc.rect(M, y, W - 2 * M, 2.5, "F"); y += 2.5;
  doc.setDrawColor(225, 215, 200); doc.rect(M, y, W - 2 * M, 62);
  tarjetas.forEach((t, i) => {
    const cx = M + cw * i + cw / 2;
    doc.setFont("helvetica", "bold"); doc.setFontSize(21); color(t[3]); doc.text(t[0], cx, y + 27, { align: "center" });
    doc.setFontSize(8); color([40, 40, 40]); doc.text(t[1], cx, y + 42, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); color(C.gris); doc.text(t[2], cx, y + 54, { align: "center" });
    if (i) { doc.setDrawColor(225, 215, 200); doc.line(M + cw * i, y + 4, M + cw * i, y + 58); }
  });
  y += 74;

  seccion("1. Resultado general");
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); color([50, 44, 40]);
  doc.text(`Se gestionaron ${info.total} productos: ${info.armados} armados (${fmtPct(info.pctArmados)}), ${info.noArmados} no armados (${fmtPct(info.pctNoArmados)}), ${info.cancelados} cancelados (${fmtPct(info.pctCancelados)}).`, M + 6, y); y += 14;
  const anchoBarra = W - 2 * M; let x = M;
  [[info.armados, C.verde, `Armado  ${info.armados} · ${fmtPct(info.pctArmados)}`], [info.noArmados, C.noArmado, `No armado  ${info.noArmados} · ${fmtPct(info.pctNoArmados)}`], [info.cancelados, C.cancelado, String(info.cancelados)]].forEach(([n, c, txt]) => {
    const w = info.total ? (n / info.total) * anchoBarra : 0; if (!w) return;
    fill(c); doc.rect(x, y, w, 28, "F");
    if (w > 28) { doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(255, 255, 255); doc.text(txt, x + w / 2, y + 18, { align: "center" }); }
    x += w;
  });
  y += 40;
  [[C.verde, `Armado ${info.armados} (${fmtPct(info.pctArmados)})`], [C.noArmado, `No armado ${info.noArmados} (${fmtPct(info.pctNoArmados)})`], [C.cancelado, `Cancelado ${info.cancelados} (${fmtPct(info.pctCancelados)})`]].forEach(([c, t], i) => {
    const lx = M + 70 + i * 150; fill(c); doc.rect(lx, y - 7, 18, 8, "F"); doc.setFont("helvetica", "normal"); doc.setFontSize(8); color([60, 52, 46]); doc.text(t, lx + 24, y);
  });
  y += 18;

  seccion("2. Volumen por departamento");
  tabla(["Departamento", "Total", "Particip.", "Armado", "No armado", "Cancelado", "% Armado"],
    [...info.listaDeptos.map((d) => [d.nombre, d.total, fmtPct(d.particip), d.armado, d.noArmado, d.cancelado, fmtPct(d.pctArmado)]), ["Total", info.total, "100%", info.armados, info.noArmados, info.cancelados, fmtPct(info.pctArmados)]], { totalFila: true });

  seccion(`3. Causas de productos no armados (${info.noArmados})`);
  if (info.listaCausas.length) barras(info.listaCausas.map((c) => ({ etiqueta: c.nombre, n: c.n, particip: c.particip })), C.noArmado);
  else { doc.setFontSize(9); color(C.gris); doc.text("No hay productos no armados.", M + 6, y + 4); y += 18; }
  const sc = info.listaCausas.find((c) => c.nombre === "Sin causal registrada");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); color(C.gris);
  const nota3 = `Participación sobre los ${info.noArmados} productos no armados.${sc ? ` Sin causal registrada (${sc.n}): servicios ${sc.servicios.map(([s, n]) => (n > 1 ? `${s} (${n} productos)` : s)).join(", ")}.` : ""}`;
  doc.splitTextToSize(nota3, W - 2 * M - 12).forEach((l) => { ensure(12); doc.text(l, M + 6, y); y += 10; });
  y += 8;

  seccion("4. Desglose por tipo de servicio (observación)");
  tabla(["Tipo de servicio (observación)", "Total", "Particip.", "Armado", "No armado", "Cancelado"],
    [...info.listaTipos.map((t) => [t.nombre, t.total, fmtPct(t.particip), t.armado, t.noArmado, t.cancelado]), ["Total", info.total, "100%", info.armados, info.noArmados, info.cancelados]], { totalFila: true });
  const sinArmado = info.listaTipos.filter((t) => t.armado === 0 && t.total > 0).map((t) => t.nombre);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); color(C.gris);
  doc.text(`En Desarme, Empaque y Adicional, “Armado” indica servicio ejecutado.${sinArmado.length ? ` Ningún registro de ${sinArmado.join(", ")} requirió armado.` : ""}`, M + 6, y); y += 18;

  seccion(`5. Cancelaciones por técnico (${info.cancelados})`);
  if (info.listaCancelaciones.length) barras(info.listaCancelaciones.map((c) => ({ etiqueta: `${c.quien} · ${c.motivo}`.slice(0, 48), n: c.n, particip: c.particip })), C.cancelado);
  else { doc.setFontSize(9); color(C.gris); doc.text("No hay productos cancelados.", M + 6, y + 4); y += 18; }

  seccion(`6. Productos pendientes (${pendientes.length})`);
  ensure(70);
  if (!pendientes.length) {
    fill([232, 245, 236]); doc.rect(M, y, W - 2 * M, 54, "F"); fill(C.verde); doc.rect(M, y, 4, 54, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(26); color(C.verde); doc.text("0", M + 50, y + 34, { align: "center" });
    doc.setFontSize(11); color(C.oscuro); doc.text("Sin productos pendientes", M + 100, y + 18);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); color([60, 52, 46]);
    doc.splitTextToSize("Todos los productos de la carga quedaron gestionados (armado, no armado o cancelado). No quedan servicios en estado pendiente, lo que refleja una operación al día.", W - 2 * M - 112).forEach((l, i) => doc.text(l, M + 100, y + 31 + i * 10));
    y += 64;
  } else {
    tabla(["Servicio", "Producto", "Departamento"], pendientes.map((p) => [p.servicio, p.producto, p.depto]), { extra: { columnStyles: { 0: { halign: "left" }, 1: { halign: "left" }, 2: { halign: "left" } } } });
  }

  seccion("7. Primer piso y cierre operativo");
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); color([50, 44, 40]);
  const pp = info.primerPiso.length ? `se identifican ${info.primerPiso.length} registro(s) con Primer piso: servicios ${[...new Set(info.primerPiso)].join(", ")}.` : "no se identifican registros con Primer piso = SI ni diagnósticos que indiquen que el producto se dejó en primer piso.";
  [[`Primer piso: ${pp}`], [`Cierre: la operación del ${fechaCorta(fecha).slice(0, 5)} cerró con ${fmtPct(info.pctArmados)} de efectividad de armado sobre ${info.total} productos. BIVER refuerza la confirmación previa con el cliente y solicita a Jamar validar dirección y disponibilidad al agendar.`]].forEach(([t]) => {
    doc.splitTextToSize(t, W - 2 * M - 12).forEach((l) => { ensure(13); doc.text(l, M + 6, y); y += 12; });
    y += 4;
  });
  pie();
  return doc.output("blob");
}
