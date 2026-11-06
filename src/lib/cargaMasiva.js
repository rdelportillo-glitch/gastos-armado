// Carga masiva de servicios (Carga y Programación) con UNA sola plantilla transversal: sirve para Jamar, Tugo, particulares u otras empresas.
// Las columnas salen de la homologación de variables de Asignación (las del CSV de Asignación y las de la base del motor): EMPRESA, FECHA, SERVICIO, NOMBRE CLIENTE,
// DIRECCIÓN, TELEFONO, SEÑAS, DEPARTAMENTO, CIUDAD, BARRIO, PRODUCTO, CÓDIGO, CANTIDAD, TIEMPO, CLIENTE REPORTA, TIPO DE SERVICIO, PRIORIDAD, TECNICO, APOYO (+ TIPO DE SOLICITUD).
// Cada fila es un producto; las filas con el mismo SERVICIO son un solo servicio con varios productos. La ubicación (zona, región), el tiempo, la línea y la complejidad se resuelven con
// los maestros, igual que en Asignación (motor enrichBase).
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";
import * as E from "./asignacion/engine.js";
import { rowsToServiceRecords } from "./asignacion/data";
import { TIPOS_SOLICITUD } from "./programacion/progData";

const plano = (s) => E.deaccent(E.U(s));
const clave = (h) => plano(h).replace(/[^A-Z0-9]/g, "");
export const NOMBRE_PLANTILLA = "PLANTILLA CARGA MASIVA DE SERVICIOS.xlsx";
export const TIPOS_SERVICIO = ["Armado", "Desarme", "Empaque", "Instalación de pieza"];
export const PRIORIDADES = ["Normal", "Prioridad 1"];

// key interna, encabezado de la plantilla, obligatoriedad por módulo y nota. alias: otros encabezados que se reconocen (CSV de Asignación, bases de Jamar y Tugo).
export const COLUMNAS = [
  { key: "empresa", header: "EMPRESA", carga: "Opcional", prog: "Opcional", nota: "Jamar, Tugo, Particular, IGS u otra. Vacío = JAMAR.", alias: ["EMPRESA"] },
  { key: "fecha", header: "FECHA", carga: "Opcional (hoy)", prog: "Obligatoria", nota: "Fecha del servicio: AAAA-MM-DD o DD/MM/AAAA.", alias: ["FECHA", "FECHAPROG", "FECHAPROGRAMACION", "FECHASERVICIO"] },
  { key: "servicio", header: "SERVICIO", carga: "Obligatoria", prog: "Obligatoria", nota: "Número de servicio (el de Jamar / Extreme / Tugo). Las filas con el mismo número son un solo servicio con varios productos.", alias: ["SERVICIO", "NUMEROSERVICIO", "NROSERVICIO", "NSERVICIO", "EVENTO"] },
  { key: "tipoSolicitud", header: "TIPO DE SOLICITUD", carga: "No se usa", prog: "Opcional", nota: "Solo Programación: Ruta Critica, Particular, IGS o Instalación de Tv. Vacío = Particular.", alias: ["TIPODESOLICITUD", "TIPOSOLICITUD"] },
  { key: "cliente", header: "NOMBRE CLIENTE", carga: "Obligatoria", prog: "Obligatoria", nota: "Nombre del cliente.", alias: ["NOMBRECLIENTE", "CLIENTE", "NOMBRE"] },
  { key: "telefono", header: "TELEFONO", carga: "Opcional", prog: "Obligatoria", nota: "Uno o varios números, separados por espacio, coma o barra.", alias: ["TELEFONO", "TELEFONOS", "CELULAR", "TEL"] },
  { key: "direccion", header: "DIRECCIÓN", carga: "Obligatoria", prog: "Obligatoria", nota: "Dirección del servicio.", alias: ["DIRECCION", "DIRECCIONENVIO"] },
  { key: "senas", header: "SEÑAS", carga: "Opcional", prog: "Opcional", nota: "Referencias para llegar.", alias: ["SENAS", "REFERENCIA", "REFERENCIAS"] },
  { key: "depto", header: "DEPARTAMENTO", carga: "Obligatoria", prog: "Obligatoria", nota: "Nombre como está en Maestros → Barrios y zonas (ej. ATLANTICO).", alias: ["DEPARTAMENTO", "DPTO", "NOMBREDEPARTAMENTO"] },
  { key: "ciudad", header: "CIUDAD", carga: "Obligatoria", prog: "Obligatoria", nota: "Ciudad o municipio del maestro.", alias: ["CIUDAD", "NOMBRECIUDAD", "MUNICIPIO"] },
  { key: "barrio", header: "BARRIO", carga: "Opcional", prog: "Obligatoria si la ciudad tiene barrios", nota: "Barrio del maestro: define la zona y la región del servicio.", alias: ["BARRIO"] },
  { key: "producto", header: "PRODUCTO", carga: "Producto o código", prog: "Producto o código", nota: "Nombre del producto.", alias: ["PRODUCTO", "NOMBREPRODUCTO", "DESCRIPCIONITEM"] },
  { key: "codigo", header: "CÓDIGO", carga: "Recomendada", prog: "Recomendada", nota: "Código del producto: con él se toman del maestro el tiempo, la línea y la complejidad.", alias: ["CODIGO", "CODIGOPRODUCTO", "CODIGOITEM", "SKU"] },
  { key: "cantidad", header: "CANTIDAD", carga: "Opcional (1)", prog: "Opcional (1)", nota: "Unidades del producto. Vacío = 1.", alias: ["CANTIDAD", "CANT"] },
  { key: "tiempo", header: "TIEMPO", carga: "Opcional", prog: "Opcional", nota: "Minutos de armado POR UNIDAD. Vacío = el del maestro de productos (por código). Si no hay ninguno, la fila no se carga.", alias: ["TIEMPO", "TIEMPOARMADO", "MINUTOS", "DURACION"] },
  { key: "reporta", header: "CLIENTE REPORTA", carga: "Opcional", prog: "Opcional", nota: "Lo que reporta el cliente (motivo del servicio).", alias: ["CLIENTEREPORTA", "REPORTA", "MOTIVO"] },
  { key: "tipoServicio", header: "TIPO DE SERVICIO", carga: "Opcional", prog: "Opcional", nota: `Armado, Desarme, Empaque o Instalación de pieza. Vacío = se deduce de CLIENTE REPORTA.`, alias: ["TIPODESERVICIO", "TIPOSERVICIO", "OBSERVACION"] },
  { key: "prioridad", header: "PRIORIDAD", carga: "Opcional", prog: "Opcional", nota: "Normal o Prioridad 1. Vacío = Normal (Ruta Critica = Prioridad 1).", alias: ["PRIORIDAD"] },
  { key: "tecnico", header: "TECNICO", carga: "Obligatoria", prog: "No se usa", nota: "Solo Carga: el técnico asignado (nombre o código de Personal). El servicio entra a Carga En gestión con él.", alias: ["TECNICO", "TECNICOASIGNADO"] },
  { key: "apoyo", header: "APOYO", carga: "Opcional", prog: "No se usa", nota: "Solo Carga: técnico de apoyo (nombre o código de Personal).", alias: ["APOYO", "TECNICOAPOYO"] },
];
const ALIAS = new Map(COLUMNAS.flatMap((c) => c.alias.map((a) => [a, c.key])));

/* --------------------------------- Plantilla --------------------------------- */

// Plantilla con filas de ejemplo que SÍ cargan: usa productos y barrios reales de los maestros (códigos, tiempos, zonas) y un técnico de Personal.
export async function descargarPlantilla({ masters, tecnicos = [], hoy }) {
  let productos = [];
  try {
    const { data } = await supabase.from("assembly_products").select("code,name,minutes").eq("active", true).gt("minutes", 0).limit(4);
    productos = data || [];
  } catch (e) { /* sin productos: quedan filas de ejemplo con valores genéricos */ }
  const ab = (masters && masters.abbreviations) || [];
  const barrios = [];
  const vistos = new Set();
  ((masters && masters.neighborhoods) || []).filter((n) => n.active !== false && String(n.zone_type).toUpperCase() !== "MUNICIPIO").forEach((n) => {
    const k = `${n.region}|${n.city}`;
    if (barrios.length < 3 && !vistos.has(k)) { vistos.add(k); const d = ab.find((a) => a.level === "MUNICIPIO" && a.region_id === n.region); if (d) barrios.push({ depto: d.name, ciudad: n.city, barrio: n.neighborhood }); }
  });
  const geo = (i) => barrios[i % Math.max(1, barrios.length)] || { depto: "ATLANTICO", ciudad: "BARRANQUILLA", barrio: "" };
  const p = (i) => productos[i % Math.max(1, productos.length)] || { code: `COD-${i + 1}`, name: `PRODUCTO DE EJEMPLO ${i + 1}`, minutes: 60 };
  const manana = (() => { const d = new Date(`${hoy}T12:00:00`); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const tec = tecnicos[0] ? tecnicos[0].name : "NOMBRE DEL TECNICO";
  const ej = (o) => COLUMNAS.map((c) => (o[c.key] !== undefined ? o[c.key] : ""));
  const filas = [
    ej({ empresa: "JAMAR", fecha: manana, servicio: "PRUEBA-0001", tipoSolicitud: "Ruta Critica", cliente: "CLIENTE DE PRUEBA JAMAR", telefono: "3001234567 / 3109876543", direccion: "CL 1 No 2-3", senas: "Casa de dos pisos", depto: geo(0).depto, ciudad: geo(0).ciudad, barrio: geo(0).barrio, producto: p(0).name, codigo: p(0).code, cantidad: 1, tiempo: "", reporta: "Armado de mueble", tipoServicio: "Armado", prioridad: "", tecnico: tec, apoyo: "" }),
    ej({ empresa: "JAMAR", fecha: manana, servicio: "PRUEBA-0001", tipoSolicitud: "Ruta Critica", cliente: "CLIENTE DE PRUEBA JAMAR", telefono: "3001234567 / 3109876543", direccion: "CL 1 No 2-3", senas: "Casa de dos pisos", depto: geo(0).depto, ciudad: geo(0).ciudad, barrio: geo(0).barrio, producto: p(1).name, codigo: p(1).code, cantidad: 2, tiempo: "", reporta: "Armado de mueble", tipoServicio: "Armado", prioridad: "", tecnico: tec, apoyo: "" }),
    ej({ empresa: "TUGO", fecha: manana, servicio: "PRUEBA-0002", tipoSolicitud: "Particular", cliente: "CLIENTE DE PRUEBA TUGO", telefono: "3151112233", direccion: "KR 5 No 6-7", senas: "", depto: geo(1).depto, ciudad: geo(1).ciudad, barrio: geo(1).barrio, producto: p(2).name, codigo: p(2).code, cantidad: 1, tiempo: "", reporta: "Armado", tipoServicio: "Armado", prioridad: "Normal", tecnico: tec, apoyo: "" }),
    ej({ empresa: "PARTICULAR", fecha: manana, servicio: "PRUEBA-0003", tipoSolicitud: "Particular", cliente: "CLIENTE PARTICULAR DE PRUEBA", telefono: "3201234567", direccion: "CL 10 No 20-30", senas: "Portería, torre 2", depto: geo(2).depto, ciudad: geo(2).ciudad, barrio: geo(2).barrio, producto: p(3).name, codigo: p(3).code, cantidad: 1, tiempo: 90, reporta: "Servicio particular", tipoServicio: "Armado", prioridad: "Normal", tecnico: tec, apoyo: "" }),
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([COLUMNAS.map((c) => c.header), ...filas]);
  ws["!cols"] = COLUMNAS.map((c) => ({ wch: Math.max(c.header.length + 4, ["direccion", "cliente", "producto", "reporta", "senas"].includes(c.key) ? 30 : 14) }));
  XLSX.utils.book_append_sheet(wb, ws, "Plantilla");
  const ayuda = XLSX.utils.aoa_to_sheet([
    ["Plantilla de carga masiva de servicios (Carga y Programación)"],
    ["Una sola plantilla para Jamar, Tugo, particulares y otras empresas. Una fila por producto; las filas con el mismo SERVICIO son un solo servicio con varios productos."],
    ["Las filas de ejemplo (PRUEBA-0001, 0002 y 0003) usan productos, barrios y un técnico reales de los maestros para que puedas probar la carga: bórralas o cámbiales los datos antes de usarla de verdad."],
    [],
    ["Columna", "Carga", "Programación", "Descripción"],
    ...COLUMNAS.map((c) => [c.header, c.carga, c.prog, c.nota]),
    [],
    ["Notas"],
    ["- Si el SERVICIO ya existe (en Carga, o en una orden de Programación no cancelada) se omite y se avisa: no se duplica."],
    ["- La zona y la región salen del DEPARTAMENTO, la CIUDAD y el BARRIO con el maestro de zonas; el tiempo, la línea y la complejidad, del CÓDIGO con el maestro de productos."],
    ["- Carga: el servicio entra En gestión con el TECNICO indicado (y el APOYO). Programación: se crea la orden (PS-000001...) y se envía a Asignación, como al programar uno por uno."],
  ]);
  ayuda["!cols"] = [{ wch: 22 }, { wch: 18 }, { wch: 30 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, ayuda, "Instrucciones");
  const listas = XLSX.utils.aoa_to_sheet([
    ["TIPO DE SOLICITUD", "TIPO DE SERVICIO", "PRIORIDAD", "TECNICOS (Personal)"],
    ...Array.from({ length: Math.max(TIPOS_SOLICITUD.length, TIPOS_SERVICIO.length, PRIORIDADES.length, tecnicos.length) }, (_, i) => [TIPOS_SOLICITUD[i] || "", TIPOS_SERVICIO[i] || "", PRIORIDADES[i] || "", tecnicos[i] ? tecnicos[i].name : ""]),
  ]);
  listas["!cols"] = [{ wch: 22 }, { wch: 24 }, { wch: 16 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, listas, "Listas");
  XLSX.writeFile(wb, NOMBRE_PLANTILLA);
}

/* ---------------------------------- Lectura ---------------------------------- */

const txt = (v) => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).replace(/ /g, " ").trim();
};

// Lee el primer libro (hoja "Plantilla" o la primera) y devuelve las filas con las columnas ya homologadas. Reconoce los encabezados de la plantilla y los del CSV de Asignación.
export async function leerArchivo(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const hoja = wb.SheetNames.find((n) => clave(n) === "PLANTILLA") || wb.SheetNames[0];
  const crudas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: "" });
  const h = crudas.findIndex((r) => r.some((c) => ALIAS.get(clave(c)) === "servicio"));
  if (h < 0) throw new Error("No encuentro la columna SERVICIO. Usa la plantilla de carga masiva (botón \"Descargar plantilla\").");
  const col = {};
  crudas[h].forEach((c, i) => { const k = ALIAS.get(clave(c)); if (k && col[k] === undefined) col[k] = i; });
  const faltan = ["cliente", "direccion", "depto", "ciudad"].filter((k) => col[k] === undefined).map((k) => COLUMNAS.find((c) => c.key === k).header);
  if (faltan.length) throw new Error(`Faltan columnas en el archivo: ${faltan.join(", ")}. Usa la plantilla de carga masiva.`);
  if (col.producto === undefined && col.codigo === undefined) throw new Error("Faltan las columnas PRODUCTO o CÓDIGO. Usa la plantilla de carga masiva.");
  const filas = [];
  crudas.slice(h + 1).forEach((r, i) => {
    if (r.every((c) => txt(c) === "")) return;
    const o = { fila: h + i + 2 };
    COLUMNAS.forEach((c) => { o[c.key] = col[c.key] === undefined ? "" : (c.key === "fecha" ? E.toISODate(r[col[c.key]]) : txt(r[col[c.key]])); });
    filas.push(o);
  });
  if (!filas.length) throw new Error("El archivo no tiene filas con servicios.");
  return filas;
}

/* -------------------------------- Validación -------------------------------- */

// Departamento, ciudad y barrio como están en el maestro (para guardar los nombres exactos y encontrar la zona).
function geoCanonica(masters, depto, ciudad, barrio) {
  const ab = (masters.abbreviations || []).filter((a) => a.level === "MUNICIPIO");
  const d = plano(depto), sinLa = (s) => s.replace(/^LA /, "");
  const dep = ab.find((a) => plano(a.name) === d) || ab.find((a) => sinLa(plano(a.name)) === sinLa(d));
  if (!dep) return { error: `El departamento «${depto}» no está en el maestro (Maestros → Barrios y zonas).` };
  const nb = (masters.neighborhoods || []).filter((n) => n.active !== false && n.region === dep.region_id);
  const mapaCiudades = new Map(nb.map((n) => [plano(n.city), n.city]));
  const ciudadC = mapaCiudades.get(plano(ciudad)) || null;
  if (!ciudadC) return { error: `La ciudad «${ciudad}» no está en el maestro de ${dep.name}.` };
  const delBarrio = nb.filter((n) => n.city === ciudadC && String(n.zone_type).toUpperCase() !== "MUNICIPIO");
  const hit = barrio ? delBarrio.find((n) => plano(n.neighborhood) === plano(barrio)) : null;
  return { depto: dep.name, ciudad: ciudadC, barrio: hit ? hit.neighborhood : "", hayBarrios: delBarrio.length > 0, barrioDado: !!barrio };
}

const num = (v) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };

// Filas del motor (una por unidad) de un servicio ya validado: igual que Programación (ordenAFilas), con la empresa del archivo.
export function filasMotor(g, masters) {
  const critica = plano(g.tipoSolicitud).includes("RUTA CRITICA");
  const rows = g.productos.map((p) => ({
    EMPRESA: g.empresa, FECHA_PROG: g.fecha, SERVICIO: g.servicio, NOMBRECLIENTE: g.cliente, DIRECCION: g.direccion, TELEFONO: g.telefono || "", SENAS: g.senas || "",
    DEPARTAMENTO: g.depto, "NOMBRE DEPARTAMENTO": g.depto, "Nombre Ciudad": g.ciudad, BARRIO: g.barrio || "",
    "NOMBRE PRODUCTO": p.nombre, CODIGO: p.codigo, LINEA: p.linea || "", SUBLINEA: p.subline || "", "Productos.TIEMPOS": p.tiempo || null, "Tiempo ARMADO": (p.tiempo || 0) * p.cantidad,
    CLIENTEREPORTA: g.reporta || "", Cantidad: p.cantidad, "Tipo de Servicio": g.tipoServicio || undefined, Prioridad: g.prioridad || (critica ? "Prioridad 1" : undefined), _origen: "Carga masiva",
  }));
  return E.enrichBase(rows, masters.M, masters.idx);
}

// modulo: "carga" | "programacion". existentes: Set con los números de servicio que ya existen (en minúsculas). tecnicos: Personal activo de campo.
export function validarYAgrupar(filas, { modulo, masters, tecnicos = [], existentes = new Set(), hoy }) {
  const prog = modulo === "programacion";
  const mapa = new Map();
  filas.forEach((f) => {
    const sv = txt(f.servicio);
    const k = sv ? sv.toLowerCase() : `__sin_servicio_${f.fila}`;
    const g = mapa.get(k) || { servicio: sv, filas: [], lineas: [], errores: [], avisos: [] };
    g.filas.push(f.fila); g.lineas.push(f); mapa.set(k, g);
  });
  const buscarTec = (v) => { const x = plano(v); return x ? tecnicos.find((t) => plano(t.name) === x || plano(t.code) === x) || null : null; };

  const grupos = [...mapa.values()].map((g) => {
    const l0 = g.lineas[0];
    // Los datos del servicio salen de la primera fila que los trae; si otra fila trae un dato distinto, hay un error (el mismo servicio no puede tener dos clientes o direcciones).
    const dato = (k) => g.lineas.map((l) => txt(l[k])).find(Boolean) || "";
    ["cliente", "direccion", "ciudad", "fecha", "tecnico"].forEach((k) => {
      const dif = [...new Set(g.lineas.map((l) => txt(l[k])).filter(Boolean).map((v) => plano(v)))];
      if (dif.length > 1) g.errores.push(`El servicio tiene ${COLUMNAS.find((c) => c.key === k).header} distinto en sus filas (${g.filas.join(", ")}).`);
    });
    Object.assign(g, {
      empresa: (dato("empresa") || "JAMAR").toUpperCase(), fecha: dato("fecha") || (prog ? "" : hoy), tipoSolicitud: dato("tipoSolicitud"), cliente: dato("cliente"), telefono: dato("telefono"), direccion: dato("direccion"),
      senas: dato("senas"), depto: dato("depto"), ciudad: dato("ciudad"), barrio: dato("barrio"), reporta: dato("reporta"), tipoServicio: dato("tipoServicio"), prioridad: dato("prioridad"), tecnicoTxt: dato("tecnico"), apoyoTxt: dato("apoyo"),
    });
    if (!g.servicio) g.errores.push(`Falta el SERVICIO (fila ${l0.fila}).`);
    if (!g.cliente) g.errores.push("Falta el NOMBRE CLIENTE.");
    if (!g.direccion) g.errores.push("Falta la DIRECCIÓN.");
    if (!g.depto) g.errores.push("Falta el DEPARTAMENTO.");
    if (!g.ciudad) g.errores.push("Falta la CIUDAD.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.fecha || "")) g.errores.push(g.fecha ? `La FECHA «${g.fecha}» no es válida (usa AAAA-MM-DD o DD/MM/AAAA).` : "Falta la FECHA.");
    if (prog && !g.telefono) g.errores.push("Falta el TELEFONO (obligatorio en Programación).");
    if (g.tipoServicio) { const t = TIPOS_SERVICIO.find((x) => plano(x) === plano(g.tipoServicio)); if (t) g.tipoServicio = t; else g.errores.push(`TIPO DE SERVICIO «${g.tipoServicio}» no válido (${TIPOS_SERVICIO.join(", ")}).`); }
    if (g.prioridad) { const t = PRIORIDADES.find((x) => plano(x) === plano(g.prioridad)); if (t) g.prioridad = t; else g.errores.push(`PRIORIDAD «${g.prioridad}» no válida (${PRIORIDADES.join(", ")}).`); }
    if (prog) {
      const t = g.tipoSolicitud ? TIPOS_SOLICITUD.find((x) => plano(x) === plano(g.tipoSolicitud)) : "Particular";
      if (t) g.tipoSolicitud = t; else g.errores.push(`TIPO DE SOLICITUD «${g.tipoSolicitud}» no válido (${TIPOS_SOLICITUD.join(", ")}).`);
    } else {
      g.tecnico = buscarTec(g.tecnicoTxt);
      if (!g.tecnicoTxt) g.errores.push("Falta el TECNICO (obligatorio en Carga).");
      else if (!g.tecnico) g.errores.push(`El técnico «${g.tecnicoTxt}» no está en Personal (nombre o código) o no está activo.`);
      g.apoyo = g.apoyoTxt ? buscarTec(g.apoyoTxt) : null;
      if (g.apoyoTxt && !g.apoyo) g.errores.push(`El apoyo «${g.apoyoTxt}» no está en Personal (nombre o código) o no está activo.`);
    }

    // Productos: filas del mismo producto se suman. El tiempo sale de la fila o del maestro por código.
    const prods = new Map();
    g.lineas.forEach((l) => {
      const codigo = txt(l.codigo), nombre = txt(l.producto);
      if (!codigo && !nombre) { g.errores.push(`Fila ${l.fila}: falta el PRODUCTO o el CÓDIGO.`); return; }
      const cant = Math.max(1, Math.round(num(l.cantidad) || 1));
      const m = codigo ? masters.M.producto[codigo] : null, lin = codigo ? masters.M.productoLinea[codigo] : null;
      const tFila = num(l.tiempo);
      const tiempo = tFila && tFila > 0 ? tFila : (m && m[0]) || null;
      if (!tiempo) { g.errores.push(`Fila ${l.fila}: el producto ${codigo || nombre} no tiene tiempo (escribe TIEMPO o usa un CÓDIGO del maestro).`); return; }
      if (codigo && !m) g.avisos.push(`Código ${codigo} no está en el maestro de productos (se usa el tiempo del archivo).`);
      const k = `${codigo}|${plano(nombre)}`;
      const e = prods.get(k) || { codigo, nombre: nombre || codigo, cantidad: 0, tiempo, linea: lin ? lin[0] : "", subline: lin ? lin[1] : "", personas: (m && m[1]) || 1 };
      e.cantidad += cant; prods.set(k, e);
    });
    g.productos = [...prods.values()];
    g.minutos = Math.round(g.productos.reduce((s, p) => s + p.tiempo * p.cantidad, 0));
    g.unidades = g.productos.reduce((s, p) => s + p.cantidad, 0);

    // Ubicación con los maestros (departamento, ciudad, barrio → zona y región).
    if (g.depto && g.ciudad) {
      const geo = geoCanonica(masters, g.depto, g.ciudad, g.barrio);
      if (geo.error) g.errores.push(geo.error);
      else {
        Object.assign(g, { depto: geo.depto, ciudad: geo.ciudad, barrio: geo.barrio });
        if (geo.hayBarrios && !geo.barrio) {
          const msg = geo.barrioDado ? `El barrio «${txt(l0.barrio)}» no está en el maestro de ${geo.ciudad}.` : `Falta el BARRIO (${geo.ciudad} tiene barrios en el maestro).`;
          if (prog) g.errores.push(msg); else g.avisos.push(`${msg} La zona se toma del municipio.`);
        }
      }
    }
    if (!g.errores.length && g.productos.length) {
      try {
        const filasM = filasMotor(g, masters);
        const sinZona = filasM.some((r) => !r.zona || r.region == null);
        if (sinZona) { const msg = `No se pudo ubicar la zona de ${g.ciudad}${g.barrio ? ` · ${g.barrio}` : ""}. Revisa ciudad y barrio en el maestro de zonas.`; if (prog) g.errores.push(msg); else g.avisos.push(msg); }
        g.zona = (filasM[0] || {}).zona || "";
      } catch (e) { g.errores.push(`No se pudo procesar el servicio: ${e.message}`); }
    }
    g.omitido = !!g.servicio && existentes.has(g.servicio.toLowerCase());
    g.estado = g.omitido ? "omitido" : g.errores.length ? "error" : "ok";
    return g;
  });
  return { grupos, listos: grupos.filter((g) => g.estado === "ok"), conError: grupos.filter((g) => g.estado === "error"), omitidos: grupos.filter((g) => g.estado === "omitido") };
}

/* ---------------------------- Conversión a registros ---------------------------- */

// Carga: un registro por unidad de producto, En gestión con el técnico (y el apoyo), igual que los servicios enviados desde Programación a Carga.
export function registrosParaCarga(g, { masters, session, uid, rutaInicial = 1 }) {
  const filas = filasMotor(g, masters);
  const recs = rowsToServiceRecords(filas, session);
  const ahora = new Date().toISOString();
  return recs.map((rec, i) => ({
    id: uid("srv"), productId: null, observacionTrabajo: null, armado: null, observation: "", createdAt: ahora, ...rec,
    technicianId: g.tecnico.id, tecnico2Nombre: g.tecnico.name, tecnico3Nombre: g.apoyo ? g.apoyo.name : "", rutaOrden: rutaInicial + i,
    estadoGestion: "En gestión", date: g.fecha, fechaProg: g.fecha, asig: { ...rec.asig, tecnicoOriginal: { id: g.tecnico.id, nombre: g.tecnico.name } },
  }));
}

// Programación: la fila de service_orders de un servicio (el número de orden PS-... lo pone la base de datos).
export function ordenParaProgramacion(g, session) {
  const productos = g.productos.map((p) => ({ code: p.codigo, name: p.nombre, minutes: p.tiempo, quantity: p.cantidad, persons: p.personas || 1, line: p.linea || "", subline: p.subline || "" }));
  return {
    customer_name: g.cliente, phone: g.telefono, department: g.depto, city: g.ciudad, neighborhood: g.barrio || null, address: g.direccion, notes: g.senas || null,
    customer_report: g.reporta || null, scheduled_date: g.fecha, request_type: g.tipoSolicitud, service_number: g.servicio, company: g.empresa,
    products: productos, total_minutes: g.minutos, photos: [], requester_email: session.email || null, created_by: session.id,
  };
}
