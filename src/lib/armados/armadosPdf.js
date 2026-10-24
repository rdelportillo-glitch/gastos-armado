// Informe en PDF de una solicitud de armado en almacén (PQR): datos, solicitado vs armado, armados registrados y los soportes
// (las fotos de cada armado y los soportes del PQR) incluidos como imágenes. Los archivos que no son imagen (PDF, Excel, correo...) se
// listan con un enlace temporal para abrirlos.
import { activos, contables, suma, comparativo, unidades, ORIGEN_TXT, firmarUrls } from "./armadosData";

const IMG_RE = /\.(jpe?g|png|webp)$/i;
const fmtD = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const DIAS_ENLACE = 7 * 24 * 3600;

// Descarga una imagen del bucket privado y la reduce (máx. 900 px) a JPEG para que el PDF no pese demasiado.
async function cargarImagen(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("no se pudo descargar");
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const escala = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * escala)); canvas.height = Math.max(1, Math.round(bmp.height * escala));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL("image/jpeg", 0.78), w: canvas.width, h: canvas.height };
}

export async function buildSolicitudPdf({ request: r, warehouse, assemblies, onProgress }) {
  const { jsPDF } = await import("jspdf");
  const at = await import("jspdf-autotable");
  const autoTable = [at.default, at.default && at.default.default, at.autoTable].find((f) => typeof f === "function");
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36;
  const mios = activos(assemblies, r.id).sort((a, b) => String(a.assembled_on).localeCompare(String(b.assembled_on)));
  const comp = comparativo(r, assemblies);

  // Soportes: fotos de cada armado y soportes del PQR. Se firman todas las rutas de una vez.
  const fotos = mios.flatMap((a) => (a.photos || []).map((p) => ({ ...p, armado: a })));
  const soportes = (r.attachments || []).map((p) => ({ ...p }));
  const urls = await firmarUrls([...fotos, ...soportes].map((x) => x.path), DIAS_ENLACE);
  const total = [...fotos, ...soportes].filter((x) => IMG_RE.test(x.name || x.path)).length;
  let hechos = 0;
  const cargar = async (lista) => {
    for (let i = 0; i < lista.length; i += 4) {
      await Promise.all(lista.slice(i, i + 4).map(async (x) => {
        x.url = urls.get(x.path) || null;
        if (!IMG_RE.test(x.name || x.path) || !x.url) return;
        try { x.img = await cargarImagen(x.url); } catch (e) { x.error = true; }
        hechos++; if (onProgress) onProgress(hechos, total);
      }));
    }
  };
  await cargar(fotos); await cargar(soportes);

  // --- Encabezado
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(79, 24, 7);
  doc.text("INFORME DE ARMADO EN ALMACÉN", M, 44);
  doc.setFontSize(11); doc.setTextColor(0);
  doc.text(`Solicitud ${r.request_no}${r.pqr_number ? `  ·  PQR ${r.pqr_number}` : "  ·  sin PQR"}`, M, 62);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110);
  doc.text(`${warehouse ? warehouse.name : ""}${warehouse && warehouse.city ? ` · ${warehouse.city}` : ""}`, M, 76);
  doc.setTextColor(0);

  const tecnicos = [...new Set(mios.map((a) => a.technician_name).filter(Boolean))].join(", ");
  autoTable(doc, {
    startY: 88, margin: { left: M, right: M }, theme: "grid",
    body: [
      ["Estado", r.status, "Origen", ORIGEN_TXT[r.origin] || r.origin],
      ["Fecha de solicitud", fmtD(r.requested_date), "Fecha de compromiso", fmtD(r.commitment_date) || "-"],
      ["Unidades solicitadas", String(unidades(r.items || [])), "Unidades armadas", String(unidades(contables(assemblies, r.id)))],
      ["Cliente", r.client || "-", "Solicita", r.requester_name || "-"],
      ["Técnicos", tecnicos || "-", "Cerrada", fmtD(r.closed_at) || "-"],
      ...(r.close_notes ? [["Observaciones del cierre", { content: r.close_notes, colSpan: 3 }]] : []),
    ],
    styles: { fontSize: 8.5, cellPadding: 3 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 100, fillColor: [245, 240, 232] }, 2: { fontStyle: "bold", cellWidth: 100, fillColor: [245, 240, 232] } },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 14, margin: { left: M, right: M },
    head: [["Código", "Producto", "Solicitado", "Armado", "Estado"]],
    body: comp.map((c) => [c.code, c.name, c.solicitado, c.armado, c.estado]),
    styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [79, 24, 7], textColor: 255 }, columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
  });
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 14, margin: { left: M, right: M },
    head: [["Fecha", "Código", "Producto", "Cant.", "Causal", "Suma", "Técnico", "Fotos", "Observación"]],
    body: mios.map((a) => [fmtD(a.assembled_on), a.product_code, a.product_name, a.quantity, a.cause || "", suma(a) ? "Sí" : "No", a.technician_name || "", (a.photos || []).length, a.notes || ""]),
    styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" }, headStyles: { fillColor: [79, 24, 7], textColor: 255 }, columnStyles: { 3: { halign: "right" }, 7: { halign: "right" } },
  });

  // --- Soportes como imágenes (2 por fila)
  let y = doc.lastAutoTable.finalY + 22;
  const titulo = (t) => { if (y > H - 90) { doc.addPage(); y = 44; } doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(79, 24, 7); doc.text(t, M, y); doc.setTextColor(0); y += 14; };
  const subtitulo = (t) => { if (y > H - 80) { doc.addPage(); y = 44; } doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text(t, M, y); y += 10; };
  const COL_W = (W - 2 * M - 12) / 2, MAX_H = 190;

  const dibujar = (lista) => {
    const imgs = lista.filter((x) => x.img), otros = lista.filter((x) => !x.img);
    for (let i = 0; i < imgs.length; i += 2) {
      const par = imgs.slice(i, i + 2);
      const dims = par.map((x) => { const k = Math.min(COL_W / x.img.w, MAX_H / x.img.h); return { w: x.img.w * k, h: x.img.h * k }; });
      const alto = Math.max(...dims.map((d) => d.h)) + 14;
      if (y + alto > H - 44) { doc.addPage(); y = 44; }
      par.forEach((x, j) => {
        const px = M + j * (COL_W + 12);
        doc.addImage(x.img.data, "JPEG", px, y, dims[j].w, dims[j].h);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(110);
        doc.text(String(x.name || "").slice(0, 60), px, y + dims[j].h + 9);
      });
      doc.setTextColor(0); y += alto;
    }
    otros.forEach((x) => {
      if (y > H - 50) { doc.addPage(); y = 44; }
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(x.url ? 20 : 110, x.url ? 70 : 110, x.url ? 160 : 110);
      const txt = `${x.name || x.path}${x.error ? " (no se pudo incluir la imagen)" : IMG_RE.test(x.name || "") ? "" : " (archivo adjunto)"}`;
      if (x.url) doc.textWithLink(txt, M, y, { url: x.url }); else doc.text(txt, M, y);
      doc.setTextColor(0); y += 12;
    });
  };

  const armadosConFotos = mios.filter((a) => (a.photos || []).length);
  if (armadosConFotos.length) {
    titulo("SOPORTES FOTOGRÁFICOS DE LOS ARMADOS");
    armadosConFotos.forEach((a) => {
      subtitulo(`${fmtD(a.assembled_on)} · ${a.product_name} (${a.product_code}) x${a.quantity}${a.cause ? ` · ${a.cause}` : ""}${a.technician_name ? ` · ${a.technician_name}` : ""}`);
      dibujar(fotos.filter((f) => f.armado.id === a.id));
      y += 6;
    });
  } else { titulo("SOPORTES FOTOGRÁFICOS DE LOS ARMADOS"); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text("Esta solicitud no tiene armados con fotos.", M, y); y += 14; }
  if (soportes.length) { y += 8; titulo("SOPORTES DEL PQR"); dibujar(soportes); }

  const paginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`${r.request_no}${r.pqr_number ? ` · PQR ${r.pqr_number}` : ""} · Página ${i} de ${paginas} · Generado el ${new Date().toLocaleDateString("es-CO")}`, M, H - 20);
  }
  return doc.output("blob");
}
