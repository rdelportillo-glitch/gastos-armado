// Lectura de los Excel de maestros de Asignación (zonas, barrios, distancias, productos de armado).
// Funciones puras: reciben un libro de SheetJS y devuelven filas listas para Supabase + un reporte.
import * as XLSX from "xlsx";

const U = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const txt = (v) => (v === null || v === undefined ? "" : String(v)).replace(/ /g, " ").trim();
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
};
const int = (v) => { const x = num(v); return x === null ? null : Math.round(x); };
const validLL = (lat, lng) => lat !== null && lng !== null && lat > -5 && lat < 14 && lng > -80 && lng < -66;

// Hoja → objetos. Los encabezados se limpian de espacios (el Excel de distancias los trae con espacios).
function sheetObjects(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (!rows.length) return [];
  const head = rows[0].map((h) => txt(h));
  return rows.slice(1).filter((r) => r && r.some((c) => c !== null && c !== "")).map((r) => {
    const o = {};
    head.forEach((h, i) => { if (h) o[h] = r[i] ?? null; });
    return o;
  });
}

export function readWorkbook(arrayBuffer) {
  return XLSX.read(arrayBuffer, { type: "array", cellDates: true });
}

// "Distancia en Tiempo" viene mezclada: 24 / 55 son minutos y 1.06 / 2.18 son horas.minutos.
function travelMinutes(v) {
  const x = num(v);
  if (x === null) return null;
  if (x >= 10) return Math.round(x);
  const h = Math.floor(x);
  const m = Math.round((x - h) * 100);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Zonas equivalentes + barrios (+ distancias de municipios)
// ---------------------------------------------------------------------------
export function parseZonasBarrios(wbBarrios, wbDist) {
  const report = { warnings: [] };

  const abRows = sheetObjects(wbBarrios, "Abreviatura");
  const zRows = sheetObjects(wbBarrios, "Zonas Equivalentes");
  const bRows = sheetObjects(wbBarrios, "Barrios");
  if (!abRows || !zRows || !bRows) throw new Error("El archivo debe tener las hojas Barrios, Zonas Equivalentes y Abreviatura.");

  // Abreviaturas (departamentos/ciudades con su región)
  const abbreviations = [];
  const seenAb = new Set();
  abRows.forEach((r) => {
    const abbr = txt(r["Abreviatura"]);
    if (!abbr || seenAb.has(abbr)) return;
    seenAb.add(abbr);
    abbreviations.push({ abbr, name: txt(r["Nombre"]), region_id: int(r["ID Región"]), level: U(r["A nivel de"]) || "MUNICIPIO", dept_abbr: txt(r["Abreviatura del Dpto"]) || null });
  });
  const deptAbbrByName = {};
  abbreviations.filter((a) => a.level === "MUNICIPIO").forEach((a) => { deptAbbrByName[U(a.name)] = a.abbr; });

  // Zonas equivalentes (nombre único; si se repite, queda la primera)
  const zones = [];
  const zoneByName = new Map();
  let zonasRepetidas = 0, zonasSinCoordenadas = 0;
  zRows.forEach((r) => {
    const name = txt(r["ZONA EQUIVALENTE"]);
    if (!name) return;
    if (zoneByName.has(U(name))) { zonasRepetidas++; return; }
    let lat = num(r["Latitud"]), lng = num(r["Longitud"]);
    if (!validLL(lat, lng)) { lat = null; lng = null; zonasSinCoordenadas++; }
    const z = {
      name, latitude: lat, longitude: lng, zone_id: int(r["IDZona"]), cluster: int(r["Cluster"]), head: txt(r["Cabecera"]) || null,
      region: int(r["Región"]), compatibility: int(r["Z.Compatibilidad"]), danger: txt(r["Peligrosidad"]) || null,
      zone_type: U(r["Tipo de Zona Equivalente"]) || null, dept_abbr: txt(r["Abreviatura del Dpto"]) || null,
      distance_km: null, travel_time: null, viatico: null, distance_value: null,
    };
    zones.push(z);
    zoneByName.set(U(name), z);
  });
  report.zonas = zones.length; report.zonasRepetidas = zonasRepetidas; report.zonasSinCoordenadas = zonasSinCoordenadas;

  // Distancias de municipios → se pegan a la zona de tipo municipio
  report.distancias = 0; report.distanciasSinZona = [];
  if (wbDist) {
    const dRows = sheetObjects(wbDist, "Hoja1") || [];
    const munByKey = new Map();
    const byName = new Map();
    zones.filter((z) => z.zone_type === "MUNICIPIO").forEach((z) => {
      const base = U(z.name.replace(/^[A-Za-z]{2,4}\s*-\s*/, ""));
      munByKey.set(`${z.dept_abbr}|${base}`, z);
      byName.set(base, [...(byName.get(base) || []), z]);
    });
    dRows.forEach((r) => {
      const dep = U(r["DEPARTAMENTO"]), mun = U(r["MUNICIPIO"]);
      if (!dep || !mun) return;
      let z = munByKey.get(`${deptAbbrByName[dep]}|${mun}`);
      // El archivo de distancias trae algunos municipios con departamento equivocado (ej. Caucasia en Córdoba):
      // si el nombre del municipio es único entre todas las zonas, se usa igual.
      if (!z && byName.get(mun) && byName.get(mun).length === 1) z = byName.get(mun)[0];
      if (!z) { report.distanciasSinZona.push(`${txt(r["DEPARTAMENTO"])} · ${txt(r["MUNICIPIO"])}`); return; }
      z.distance_km = num(r["Distancia en Kilometros"]);
      z.travel_time = travelMinutes(r["Distancia en Tiempo"]);
      z.distance_value = num(r["Valor por distancia"]);
      const via = num(r["GASTO VIATICO"]); // en el archivo trae el texto "ENVIAR": solo se guarda si es un número
      if (via !== null) z.viatico = via;
      report.distancias++;
    });
  }

  // Barrios: la llave es región + ciudad + barrio (un mismo nombre puede existir en departamentos distintos)
  const neighborhoods = [];
  const seenKey = new Map();
  let exactRepeats = 0, conflicts = [], sinZona = [], sinRegion = 0;
  bRows.forEach((r) => {
    const city = txt(r["NOMBRE CIUDAD"]), barrio = txt(r["BARRIO"]), zoneName = txt(r["ZONA EQUIVALENTE"]);
    if (!city || !barrio) return;
    const z = zoneByName.get(U(zoneName));
    if (!z) { sinZona.push(`${city} · ${barrio} → ${zoneName || "(vacía)"}`); return; }
    // La región se toma de la zona: la columna REGIÓN de la hoja Barrios tiene errores
    // (ej. Cascajal de Bolívar aparece con región 6).
    const region = z.region !== null ? z.region : int(r["REGIÓN"]);
    if (region === null) { sinRegion++; return; }
    const key = `${region}|${U(city)}|${U(barrio)}`;
    if (seenKey.has(key)) {
      if (U(seenKey.get(key).zoneName) === U(zoneName)) exactRepeats++;
      else conflicts.push(`${city} · ${barrio}: ${seenKey.get(key).zoneName} / ${zoneName}`);
      return;
    }
    const row = { city, neighborhood: barrio, zoneName: z.name, region, zone_type: U(r["Tipo de Zona Equivalente"]) || null };
    seenKey.set(key, row);
    neighborhoods.push(row);
  });
  report.barrios = neighborhoods.length; report.barriosRepetidos = exactRepeats;
  report.barriosEnConflicto = conflicts; report.barriosSinZona = sinZona; report.barriosSinRegion = sinRegion;

  return { abbreviations, zones, neighborhoods, report };
}

// ---------------------------------------------------------------------------
// Productos de armado + complejidad por línea/sublínea
// ---------------------------------------------------------------------------
const capital = (s) => { const t = txt(s).toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };

export function parseProductos(wb) {
  const pRows = sheetObjects(wb, "Productos");
  const cRows = sheetObjects(wb, "Complejidad");
  if (!pRows && !cRows) throw new Error("El archivo debe tener las hojas Productos y/o Complejidad.");
  const report = { warnings: [] };

  const products = [];
  const seen = new Set();
  let repetidos = 0, sinTiempo = 0, sinPersonas = 0;
  (pRows || []).forEach((r) => {
    const code = txt(r["CÓDIGO"]);
    const name = txt(r["PRODUCTO"]);
    if (!code || !name) return;
    if (seen.has(code)) { repetidos++; return; }
    seen.add(code);
    const minutes = int(r["TIEMPOS"]);
    if (!minutes) sinTiempo++;
    let persons = int(r["# Personas Armado"]);
    if (!persons) { persons = 1; sinPersonas++; }
    products.push({
      code, name, code2: txt(r["CÓDIGO2"]) || null, price_single: num(r["PRECIO ARMADO INDIVIDUAL"]), price_pair: num(r["PRECIO ARMADO ENTRE DOS"]),
      minutes: minutes || null, supplier: txt(r["PROVEEDOR"]) || null, persons: persons >= 2 ? 2 : 1,
    });
  });
  report.productos = products.length; report.productosRepetidos = repetidos; report.productosSinTiempo = sinTiempo; report.productosSinPersonas = sinPersonas;

  const complexity = [];
  const seenC = new Set();
  let cRepetidas = 0, cInvalidas = [];
  (cRows || []).forEach((r) => {
    const line = txt(r["Linea"]), subline = txt(r["Sub Linea"]);
    if (!line || !subline) return;
    const comp = capital(r["Complejidad"]);
    if (!["Baja", "Media", "Alta"].includes(comp)) { cInvalidas.push(`${line} · ${subline}: "${txt(r["Complejidad"])}"`); return; }
    const key = `${U(line)}|${U(subline)}`;
    if (seenC.has(key)) { cRepetidas++; return; }
    seenC.add(key);
    complexity.push({ line, subline, complexity: comp, embeddable: U(r["Empotrable"]) === "SI" });
  });
  report.complejidad = complexity.length; report.complejidadRepetida = cRepetidas; report.complejidadInvalida = cInvalidas;

  return { products, complexity, report };
}
