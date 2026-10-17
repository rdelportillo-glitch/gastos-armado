// Plantillas de muestra para la carga masiva de los maestros (Maestros → Importar desde Excel).
// Cada plantilla trae los encabezados EXACTOS que lee la importación, filas de ejemplo y una hoja "Instrucciones".
// También se incluye la lectura del Excel de almacenes, para que plantilla e importación usen las mismas columnas.
import * as XLSX from "xlsx";

const hoja = (aoa, anchos) => { const ws = XLSX.utils.aoa_to_sheet(aoa); if (anchos) ws["!cols"] = anchos.map((wch) => ({ wch })); return ws; };
const instrucciones = (titulo, filas) => hoja([[titulo], [], ["Columna", "¿Obligatoria?", "Qué escribir"], ...filas], [30, 14, 110]);
const libro = (hojas) => { const wb = XLSX.utils.book_new(); hojas.forEach(([n, ws]) => XLSX.utils.book_append_sheet(wb, ws, n)); return wb; };

export const descargarPlantilla = (wb, nombre) => XLSX.writeFile(wb, nombre);

/* ----------------------- Barrios y zonas equivalentes ----------------------- */

export function plantillaZonasBarrios() {
  return libro([
    ["Abreviatura", hoja([
      ["Abreviatura", "Nombre", "ID Región", "A nivel de", "Abreviatura del Dpto"],
      ["ATL", "ATLANTICO", 1, "MUNICIPIO", "ATL"],
      ["BAQ", "BARRANQUILLA", 1, "BARRIO", "ATL"],
    ], [14, 22, 12, 14, 22])],
    ["Zonas Equivalentes", hoja([
      ["ZONA EQUIVALENTE", "Latitud", "Longitud", "IDZona", "Cluster", "Cabecera", "Región", "Z.Compatibilidad", "Peligrosidad", "Tipo de Zona Equivalente", "Abreviatura del Dpto"],
      ["BAQ - ADELITA DE CHAR", 10.9639, -74.7964, 3, 1, "BARRANQUILLA", 1, 2, "", "BARRIO", "ATL"],
      ["ATL - PUERTO COLOMBIA", 10.9878, -74.9547, 20, 1, "PUERTO COLOMBIA", 1, 1, "", "MUNICIPIO", "ATL"],
    ], [28, 10, 10, 8, 8, 20, 8, 16, 14, 24, 22])],
    ["Barrios", hoja([
      ["NOMBRE CIUDAD", "BARRIO", "ZONA EQUIVALENTE", "REGIÓN", "Tipo de Zona Equivalente"],
      ["BARRANQUILLA", "ADELITA DE CHAR", "BAQ - ADELITA DE CHAR", 1, "BARRIO"],
      ["PUERTO COLOMBIA", "TODOS", "ATL - PUERTO COLOMBIA", 1, "MUNICIPIO"],
    ], [24, 26, 28, 10, 24])],
    ["Instrucciones", instrucciones("Plantilla de barrios y zonas equivalentes", [
      ["Hoja Abreviatura", "Sí", "Un departamento por fila con A nivel de = MUNICIPIO (con su ID Región), y las ciudades con barrios con A nivel de = BARRIO. Cada departamento tiene una región."],
      ["Hoja Zonas Equivalentes", "Sí", "Una fila por zona. ZONA EQUIVALENTE es el nombre único (ej. 'BAQ - ADELITA DE CHAR'). Tipo de Zona Equivalente: MUNICIPIO o BARRIO. Latitud y longitud ayudan a ordenar las rutas."],
      ["Hoja Barrios", "Sí", "Una fila por barrio: ciudad, barrio y la ZONA EQUIVALENTE a la que pertenece (debe existir en la hoja anterior). Los municipios sin barrios usan el barrio TODOS."],
      ["Qué hace la importación", "", "Crea lo nuevo y actualiza lo que ya existe; no borra nada. Las filas de ejemplo son solo guía: bórralas o reemplázalas."],
      ["Distancias (opcional)", "No", "Aparte hay una 'Plantilla de distancias' para unir distancia y tiempo a los municipios."],
    ])],
  ]);
}

export function plantillaDistancias() {
  return libro([
    ["Hoja1", hoja([
      ["DEPARTAMENTO", "MUNICIPIO", "Distancia en Kilometros", "Distancia en Tiempo", "Valor por distancia", "GASTO VIATICO"],
      ["ATLANTICO", "PUERTO COLOMBIA", 18, 35, 25000, 0],
    ], [20, 24, 22, 20, 18, 16])],
    ["Instrucciones", instrucciones("Plantilla de distancias a municipios (opcional)", [
      ["DEPARTAMENTO", "Sí", "Nombre del departamento, como está en el maestro."],
      ["MUNICIPIO", "Sí", "Nombre del municipio (debe existir como zona de tipo MUNICIPIO)."],
      ["Distancia en Kilometros", "No", "Kilómetros desde la sede."],
      ["Distancia en Tiempo", "No", "Minutos de desplazamiento (ej. 45). También se entiende 1.30 como 1 hora 30 minutos."],
      ["Valor por distancia / GASTO VIATICO", "No", "Valores en pesos, solo números."],
      ["Cómo se usa", "", "Se sube junto con el archivo de barrios y zonas, en el segundo campo (opcional) del cuadro de importación."],
    ])],
  ]);
}

/* ------------------------ Productos de armado y complejidad ------------------------ */

export function plantillaProductos() {
  return libro([
    ["Productos", hoja([
      ["CÓDIGO", "PRODUCTO", "CÓDIGO2", "PRECIO ARMADO INDIVIDUAL", "PRECIO ARMADO ENTRE DOS", "TIEMPOS", "PROVEEDOR", "# Personas Armado"],
      [7044379, "COMEDOR 6 PTOS SABINA EUROLINO", 7044379, 18000, 9000, 60, "JAMAR", 1],
      [7040993, "MESA DE CENTRO AMY OFF WHITE/CHAMPANA", 7040993, 9000, 4500, 30, "JAMAR", 1],
      [7044742, "ROPERO PATRIC NATURAL/NEGRO", 7044742, 30000, 15000, 120, "JAMAR", 2],
    ], [12, 46, 12, 26, 26, 10, 14, 18])],
    ["Complejidad", hoja([
      ["Linea", "Sub Linea", "Complejidad", "Empotrable"],
      ["COMEDORES", "Comedor 6 Ptos", "Media", "No"],
      ["SALAS", "Mesa De Centro", "Baja", "No"],
      ["CLOSET", "Ropero", "Alta", "Si"],
    ], [20, 26, 14, 12])],
    ["Instrucciones", instrucciones("Plantilla de productos de armado y complejidad", [
      ["Hoja Productos · CÓDIGO", "Sí", "Código del producto (único). Si se repite, queda el primero."],
      ["Hoja Productos · PRODUCTO", "Sí", "Nombre del producto."],
      ["Hoja Productos · TIEMPOS", "Recomendada", "Minutos de armado. Sin tiempo, el producto no se puede asignar hasta que lo tenga."],
      ["Hoja Productos · # Personas Armado", "No", "1 o 2 (si se deja vacío cuenta 1)."],
      ["Hoja Productos · precios, CÓDIGO2, PROVEEDOR", "No", "Precio de armado individual y entre dos, código alterno y proveedor."],
      ["Hoja Complejidad", "No", "Una fila por línea y sublínea: Complejidad = Baja, Media o Alta; Empotrable = Si o No. Alta o empotrable lo toma un técnico senior."],
      ["Línea y sublínea de cada producto", "", "No va en esta plantilla: se completa en Maestros → Productos de armado con el botón 'Completar línea y sublínea'."],
      ["Qué hace la importación", "", "Crea lo nuevo y actualiza lo que ya existe; no borra nada. Las filas de ejemplo son solo guía."],
    ])],
  ]);
}

/* ------------------------------------ Almacenes ------------------------------------ */

const ALMACEN_COLS = [
  ["name", /^(NOMBRE|ALMACEN|TIENDA|SEDE)/], ["client", /^(CLIENTE|EMPRESA)/], ["department", /^DEPARTAMENTO/], ["city", /^CIUDAD/], ["neighborhood", /^BARRIO/],
  ["address", /^DIRECCION/], ["contact_name", /^(CONTACTO|ADMIN)/], ["contact_phone", /^(TELEFONO|CELULAR)/],
];
const llave = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();

export function plantillaAlmacenes() {
  return libro([
    ["Almacenes", hoja([
      ["NOMBRE", "CLIENTE", "DEPARTAMENTO", "CIUDAD", "BARRIO", "DIRECCION", "CONTACTO", "TELEFONO"],
      ["ALMACEN RIOACHA", "JAMAR", "GUAJIRA", "RIOHACHA", "", "CR 15 12 34", "Nombre del administrador", "3001234567"],
      ["ALMACEN BARRANQUILLA CENTRO", "JAMAR", "ATLANTICO", "BARRANQUILLA", "", "CL 34 43 12", "Nombre del administrador", "3007654321"],
    ], [32, 12, 18, 20, 20, 26, 26, 16])],
    ["Instrucciones", instrucciones("Plantilla de almacenes", [
      ["NOMBRE", "Sí", "Nombre del almacén, igual al que usa el cliente en sus PQR (ej. ALMACEN RIOACHA)."],
      ["CLIENTE", "No", "Empresa dueña del almacén (por defecto JAMAR). Cada cliente solo ve sus almacenes."],
      ["DEPARTAMENTO", "Sí", "Debe escribirse como está en el maestro de zonas (ej. GUAJIRA, no LA GUAJIRA). Si no coincide, las unidades del almacén no entran a Asignación."],
      ["CIUDAD", "Sí", "Ciudad o municipio del maestro de zonas (ej. RIOHACHA)."],
      ["BARRIO", "Si la ciudad tiene barrios", "Barrio del maestro de zonas; para ubicar el almacén con precisión."],
      ["DIRECCION, CONTACTO, TELEFONO", "No", "Dirección, administrador y teléfono del almacén."],
      ["Qué hace la importación", "", "Crea los almacenes nuevos y actualiza los existentes (se reconocen por cliente + nombre); no borra nada. Avisa si algún departamento, ciudad o barrio no coincide con el maestro."],
    ])],
  ]);
}

// Lee el Excel de almacenes. Devuelve { filas } listas para la tabla warehouses (llave client + name).
export function parseAlmacenes(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  if (!rows.length) throw new Error("El archivo no tiene filas.");
  const heads = Object.keys(rows[0]);
  const col = {};
  ALMACEN_COLS.forEach(([k, re]) => { col[k] = heads.find((h) => re.test(llave(h))); });
  if (!col.name) throw new Error("No encontré almacenes: el archivo necesita una columna NOMBRE (o ALMACEN).");
  const val = (r, k) => (col[k] ? String(r[col[k]] ?? "").trim() : "");
  const mapa = new Map();
  rows.forEach((r) => {
    const name = val(r, "name").toUpperCase();
    if (!name) return;
    const client = (val(r, "client") || "JAMAR").toUpperCase();
    // Solo se guardan las columnas que trae el archivo: un archivo con menos columnas no borra lo ya registrado en las demás.
    const fila = { client, name, active: true };
    ["department", "city", "neighborhood"].forEach((k) => { if (col[k]) fila[k] = val(r, k).toUpperCase() || null; });
    ["address", "contact_name", "contact_phone"].forEach((k) => { if (col[k]) fila[k] = val(r, k) || null; });
    mapa.set(`${client}|${name}`, fila);
  });
  return { filas: [...mapa.values()] };
}

// Almacenes cuyo departamento, ciudad o barrio no está en el maestro de zonas (no podrían ubicarse en Asignación).
export function almacenesSinZona(filas, geo) {
  return filas.filter((w) => {
    const d = geo.deptos.find((x) => llave(x.name) === llave(w.department));
    if (!d) return true;
    const ciudad = geo.ciudades(d.region).find((c) => llave(c) === llave(w.city));
    if (!ciudad) return true;
    const barrios = geo.barrios(d.region, ciudad);
    return !!w.neighborhood && barrios.length > 0 && !barrios.some((b) => llave(b) === llave(w.neighborhood));
  });
}
