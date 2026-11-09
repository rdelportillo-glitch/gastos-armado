// Lector del PowerPoint del informe CSAT del cliente ("INFORME CSAT ARMADO"): lo convierte en datos para guardar en la plataforma.
//  · Diapositiva 1: mes del informe y meta. · "Resultados CSAT General": CSAT general (satisfechos, insatisfechos, total) y su tendencia (gráfico).
//  · "Asc - Biver – Resumen": lo mismo, solo de nuestra operación. · Tabla por departamento (satisfechos, insatisfechos, CSAT).
//  · Páginas por departamento: una fila por técnico con el CSAT de cada uno de los 3 meses y el motivo de insatisfacción.
// Se lee por posición de cada texto en la diapositiva (no por el orden), y sin DOMParser, para que también se pueda probar fuera del navegador.
import { unzipSync, strFromU8 } from "fflate";

const EMU = 9525; // un píxel de la diapositiva
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const numero = (s) => { const m = String(s ?? "").match(/-?\d[\d.,]*/); if (!m) return null; const t = m[0]; return Number(/^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t.replace(",", ".")); };
const porcentaje = (s) => { const m = String(s ?? "").match(/(\d+(?:[.,]\d+)?)\s*%/); return m ? Number(m[1].replace(",", ".")) : null; };

const textoDe = (xml) => dec((xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) || []).map((p) => (p.match(/<a:t>[^<]*<\/a:t>|<a:t [^>]*>[^<]*<\/a:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("")).join(" ").replace(/\s+/g, " ").trim());

// Formas de texto de una diapositiva con su posición en píxeles, en el orden del archivo.
function formasDe(xml) {
  const sinTablas = xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, "");
  return (sinTablas.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).map((f) => {
    const off = f.match(/<a:off x="(-?\d+)" y="(-?\d+)"/), ext = f.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    return { x: off ? Number(off[1]) / EMU : 0, y: off ? Number(off[2]) / EMU : 0, w: ext ? Number(ext[1]) / EMU : 0, h: ext ? Number(ext[2]) / EMU : 0, t: textoDe(f) };
  });
}
function tablasDe(xml) {
  return (xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) || []).map((t) => (t.match(/<a:tr[ >][\s\S]*?<\/a:tr>/g) || []).map((tr) => (tr.match(/<a:tc[ >][\s\S]*?<\/a:tc>/g) || []).map((tc) => textoDe(tc))));
}

// "Agosto" con el año del informe → "2026-08" (si el mes es posterior al del informe, es del año anterior: informe de enero con noviembre y diciembre).
function claveMes(nombre, mesInforme) {
  const i = MESES.indexOf(plano(nombre)); if (i < 0 || !mesInforme) return null;
  const [y, m] = mesInforme.split("-").map(Number);
  const anio = i + 1 > m ? y - 1 : y;
  return `${anio}-${String(i + 1).padStart(2, "0")}`;
}

// Valor que está justo antes de una etiqueta ("974" + "Clientes Satisfechos").
const antesDe = (formas, etiqueta) => { const i = formas.findIndex((f) => plano(f.t).startsWith(plano(etiqueta))); return i > 0 ? formas[i - 1].t : null; };

function leerResumen(formas) {
  const csat = porcentaje(antesDe(formas, "CSAT GENERAL") || antesDe(formas, "CSAT") || "");
  const sat = numero(antesDe(formas, "Clientes Satisfechos")), insat = numero(antesDe(formas, "Clientes Insatisfechos")), total = numero(antesDe(formas, "Total Respuestas"));
  return { csat, satisfechos: sat, insatisfechos: insat, total };
}

// Página de un departamento: encabezado (nombre, "164 Sat", "1 Insat", "99% CSAT"), meses de las columnas y una fila por técnico.
function leerPaginaDepartamento(formas, mesInforme, avisos, n) {
  const iSat = formas.findIndex((f) => /^[\d.]+\s+Sat$/i.test(f.t));
  if (iSat < 0) return null;
  const nombre = formas.slice(0, iSat).reverse().find((f) => f.t && !/^Asc\b/i.test(f.t));
  if (!nombre) return null;
  const departamento = nombre.t.replace(/\s*\(\d+\/\d+\)\s*$/, "").trim();
  const sat = numero(formas[iSat].t), insat = numero((formas.find((f) => /^[\d.]+\s+Insat$/i.test(f.t)) || {}).t), csat = porcentaje((formas.find((f) => /%\s*CSAT$/i.test(f.t)) || {}).t);
  const cols = formas.filter((f) => MESES.includes(plano(f.t)) && f.y < 80).sort((a, b) => a.x - b.x).map((f) => ({ cx: f.x + f.w / 2, mes: claveMes(f.t, mesInforme) }));
  if (cols.length === 0) { avisos.push(`Diapositiva ${n}: no encontré los meses de las columnas.`); return null; }
  const primeraX = Math.min(...cols.map((c) => c.cx)) - 110;
  // Solo cajas de texto (las de fondo de cada celda son altas y sin texto)
  const cajas = formas.filter((f) => f.y >= 78 && f.y < 505 && f.h < 30);
  const cuerpo = cajas.filter((f) => f.x + f.w / 2 >= primeraX);
  const nombres = cajas.filter((f) => f.x + f.w / 2 < primeraX && f.t);
  const tecnicos = [];
  nombres.forEach((nm) => {
    const banda = cuerpo.filter((f) => f.y >= nm.y - 20 && f.y < nm.y + 32 && f.x + f.w / 2 >= primeraX);
    cols.forEach((col) => {
      const celda = banda.filter((f) => Math.abs(f.x + f.w / 2 - col.cx) < 60).sort((a, b) => a.y - b.y);
      const valor = celda[0] ? celda[0].t : "";
      const v = porcentaje(valor);
      if (v === null) return; // "–": ese mes no tuvo encuestas del técnico
      const motivo = (celda[1] ? celda[1].t : "").trim();
      tecnicos.push({ tecnico: nm.t, departamento, mes: col.mes, csat: v, motivos: /^sin insatisfechos$/i.test(motivo) ? "" : motivo });
    });
  });
  return { departamento, satisfechos: sat, insatisfechos: insat, csat, tecnicos };
}

// Tendencia del CSAT general: el gráfico de la diapositiva de resultados (serie "CSAT %").
function leerTendencia(archivos, mesInforme) {
  const nombres = Object.keys(archivos).filter((k) => /^ppt\/charts\/chart\d+\.xml$/.test(k));
  for (const k of nombres) {
    const x = strFromU8(archivos[k]);
    const serie = (x.match(/<c:ser>[\s\S]*?<\/c:ser>/) || [""])[0];
    const nom = ((serie.match(/<c:tx>[\s\S]*?<\/c:tx>/) || [""])[0].match(/<c:v>([^<]*)<\/c:v>/) || [])[1] || "";
    if (!/csat/i.test(nom)) continue;
    const cats = ((serie.match(/<c:cat>[\s\S]*?<\/c:cat>/) || [""])[0].match(/<c:v>([^<]*)<\/c:v>/g) || []).map((v) => dec(v.replace(/<\/?c:v>/g, "")));
    const vals = ((serie.match(/<c:val>[\s\S]*?<\/c:val>/) || [""])[0].match(/<c:v>([^<]*)<\/c:v>/g) || []).map((v) => Number(v.replace(/<\/?c:v>/g, "")));
    return cats.map((c, i) => ({ mes: claveMes(c, mesInforme), csat: vals[i] })).filter((p) => p.mes && isFinite(p.csat));
  }
  return [];
}

// buffer: ArrayBuffer o Uint8Array del .pptx. Devuelve { mes, meta, general, asc, tendencia, departamentos, tecnicos, avisos }.
export function leerPptxCsat(buffer) {
  let archivos;
  try { archivos = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)); } catch { throw new Error("No pude abrir el archivo: debe ser un PowerPoint (.pptx)."); }
  const slides = Object.keys(archivos).map((k) => k.match(/^ppt\/slides\/slide(\d+)\.xml$/)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
  if (!slides.length) throw new Error("El archivo no trae diapositivas: debe ser el PowerPoint del informe CSAT.");
  const avisos = [];
  const xmlDe = (n) => strFromU8(archivos[`ppt/slides/slide${n}.xml`]);

  // Mes del informe y meta (portada)
  const portada = formasDe(xmlDe(slides[0])).map((f) => f.t).join(" ");
  const mm = portada.match(new RegExp(`(${MESES.join("|")})\\s+(\\d{4})`, "i"));
  if (!mm) throw new Error("No encontré el mes del informe en la portada (ej. \"Octubre 2026\"). ¿Es el PowerPoint del informe CSAT?");
  const mes = `${mm[2]}-${String(MESES.indexOf(plano(mm[1])) + 1).padStart(2, "0")}`;
  const meta = porcentaje((portada.match(/Meta CSAT:\s*\d+(?:[.,]\d+)?\s*%/i) || [""])[0]) ?? 90;

  let general = null, asc = null; const departamentos = [], tecnicos = [], paginas = [];
  let tablaDeptos = [];
  slides.forEach((n) => {
    const xml = xmlDe(n), formas = formasDe(xml);
    const titulos = formas.map((f) => f.t);
    if (titulos.some((t) => /^Resultados CSAT General/i.test(t))) general = leerResumen(formas);
    else if (titulos.some((t) => /^Asc\s*-\s*Biver\s*[–-]\s*Resumen/i.test(t))) asc = leerResumen(formas);
    else {
      const pag = leerPaginaDepartamento(formas, mes, avisos, n);
      if (pag) { paginas.push(pag); return; }
    }
    tablasDe(xml).forEach((t) => { if (t.length > 1 && /departamento/i.test(t[0][0] || "")) tablaDeptos = t.slice(1); });
  });

  if (!general) avisos.push("No encontré la diapositiva \"Resultados CSAT General\": no se guardará el CSAT general.");
  if (!asc) avisos.push("No encontré la diapositiva \"Asc - Biver – Resumen\": no se guardará el CSAT de la operación.");
  [["general", general], ["Asc - Biver", asc]].forEach(([nom, r]) => { if (r && r.total !== null && r.satisfechos !== null && r.insatisfechos !== null && r.satisfechos + r.insatisfechos !== r.total) avisos.push(`CSAT ${nom}: satisfechos + insatisfechos no suman el total (${r.satisfechos} + ${r.insatisfechos} ≠ ${r.total}).`); });

  // Departamentos: la tabla trae las cifras oficiales; las páginas de cada departamento traen a los técnicos.
  tablaDeptos.forEach((f) => { const sat = numero(f[1]), insat = numero(f[2]), csat = porcentaje(f[3]); if (f[0] && sat !== null && insat !== null) departamentos.push({ departamento: f[0], satisfechos: sat, insatisfechos: insat, csat: csat ?? (sat + insat ? Math.round((sat / (sat + insat)) * 1000) / 10 : null) }); });
  paginas.forEach((p) => { tecnicos.push(...p.tecnicos); });
  if (!departamentos.length) paginas.forEach((p) => { if (!departamentos.some((d) => plano(d.departamento) === plano(p.departamento)) && p.satisfechos !== null) departamentos.push({ departamento: p.departamento, satisfechos: p.satisfechos, insatisfechos: p.insatisfechos, csat: p.csat }); });
  if (!tecnicos.length) avisos.push("No encontré técnicos en las páginas por departamento.");
  // El mismo técnico y departamento y mes solo puede venir una vez (si hay páginas repetidas, queda la última).
  const unico = new Map(); tecnicos.forEach((t) => unico.set(`${plano(t.tecnico)}|${plano(t.departamento)}|${t.mes}`, t));

  return { mes, meta, general, asc, tendencia: leerTendencia(archivos, mes), departamentos, tecnicos: [...unico.values()], avisos };
}
