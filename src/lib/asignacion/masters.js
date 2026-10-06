// Arma los maestros que usa el motor (mismo formato que traía el HTML original) a partir de las
// tablas de Supabase: zonas, barrios, abreviaturas/regiones, productos de armado y complejidad.
import { U, deaccent } from "./engine.js";

// Códigos de departamento que trae la base de Jamar (columna DEPARTAMENTO).
export const DEPTO_CODES = {
  AN: "ANTIOQUIA", AT: "ATLANTICO", BO: "BOLIVAR", CO: "CORDOBA", CU: "CUNDINAMARCA", MA: "MAGDALENA", SD: "SANTANDER", SU: "SUCRE",
};

// Municipios que la base de Jamar trae solo como código (columna CIUDAD) y sin "Nombre Ciudad": departamento|código → nombre.
// Copiado de los maestros del HTML "Asignación BIVER 2.0". Si aparece un código nuevo, hay que agregarlo aquí.
export const PUEBLO_CODES = {
  "AT|SU": "SUAN", "MA|GUH": "GUACHACA", "AT|RE": "REPELON", "BO|SP": "SAN JUAN DE NEMOPUSENO",
  "AT|SV": "SANTA VERONICA", "AN|BA": "BARBOSA", "BO|AR": "ARENAL", "CU|LC": "LA CALERA", "AT|PA": "PALERMO",
  "AT|CP": "CAMPECHE", "AT|IL": "ISABEL LOPEZ", "AT|JM": "JUAN MINA", "SU|MO": "MORROA", "BO|ST": "SANTA CATALINA",
  "CO|SA": "SAGUN", "MA|BU": "BURITACA", "BO|CL": "CLEMENCIA", "CU|TA": "TABIO", "AT|CL": "CANDELARIA",
  "SD|LB": "LEBRIJA", "MA|TA": "TASAJERA", "GU|CAM": "CAMARONES", "CO|SP": "SAN PELAYO", "MA|GY": "GUAMAL",
  "MA|ZB": "ZONA BANANERA", "CO|SS": "SAN ANDRES DE SOTAVENTO", "AT|MO": "MOLINERO", "AT|MR": "MARTILLO",
  "CO|SE": "SAN ANTERO", "CU|RO": "EL ROSAL", "AT|PG": "PUERTO GIRALDO", "SU|TV": "TOLU VIEJO", "MA|OR": "ORIHUECA",
  "MA|RF": "RIOFRIO", "AT|PTAL": "PITAL DE MEGUA", "SU|CZ": "COROZAL", "AT|CR": "CARACOLI",
};

const okLL = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && a > -5 && a < 14 && b > -80 && b < -66;
const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

// neighborhoods: [{ city, neighborhood, region, zone_type, zoneName, active }]
export function buildMasters({ abbreviations = [], zones = [], neighborhoods = [], products = [], complexity = [], cityCodes = [] }) {
  // Códigos de municipio: los del maestro (si ya se cargaron) mandan sobre la lista base.
  const pueblo = { ...PUEBLO_CODES };
  cityCodes.filter((c) => c.active !== false).forEach((c) => { pueblo[`${U(c.dept_code)}|${U(c.city_code)}`] = c.city_name; });
  const M = { pueblo, depto: { ...DEPTO_CODES }, region: {}, barrio: {}, municipio: {}, zona: {}, sector: {}, complejidad: {}, producto: {}, distancia: {} };

  const deptNameByAbbr = {};
  abbreviations.filter((a) => a.level === "MUNICIPIO").forEach((a) => {
    M.region[deaccent(U(a.name))] = a.region_id;
    deptNameByAbbr[a.abbr] = deaccent(U(a.name));
  });

  const sec = {};
  zones.filter((z) => z.active !== false).forEach((z) => {
    M.zona[z.name] = [z.latitude === null ? null : Number(z.latitude), z.longitude === null ? null : Number(z.longitude), z.zone_id, z.cluster, z.region, z.compatibility];
    if (z.region !== null && z.zone_id !== null) {
      const k = z.region + "|" + z.zone_id;
      const q = sec[k] = sec[k] || { la: [], lo: [], zc: new Set(), noMun: false };
      if (okLL(Number(z.latitude), Number(z.longitude))) { q.la.push(Number(z.latitude)); q.lo.push(Number(z.longitude)); }
      if (z.compatibility !== null && z.compatibility !== undefined) q.zc.add(z.compatibility);
      if (U(z.zone_type) !== "MUNICIPIO") q.noMun = true;
    }
    if (U(z.zone_type) === "MUNICIPIO" && z.distance_km !== null && z.distance_km !== undefined) {
      const dep = deptNameByAbbr[z.dept_abbr];
      if (dep) M.distancia[`${dep}|${deaccent(U(z.name.replace(/^[A-Za-z]{2,4}\s*-\s*/, "")))}`] = [Number(z.distance_km), z.travel_time];
    }
  });
  for (const k in sec) M.sector[k] = [med(sec[k].la), med(sec[k].lo), [...sec[k].zc].sort((a, b) => a - b), sec[k].noMun ? 0 : 1];

  // Las llaves llevan la región adelante: el mismo barrio/municipio puede existir en departamentos distintos.
  neighborhoods.filter((n) => n.active !== false).forEach((n) => {
    const city = deaccent(U(n.city));
    if (U(n.zone_type) === "MUNICIPIO") { const k = `${n.region}|${city}`; if (!M.municipio[k]) M.municipio[k] = n.zoneName; }
    else { const k = `${n.region}|${city}|${deaccent(U(n.neighborhood))}`; if (!M.barrio[k]) M.barrio[k] = n.zoneName; }
  });

  complexity.forEach((c) => { M.complejidad[`${c.line}|${c.subline}`] = [c.complexity, c.embeddable ? "Si" : "No"]; });
  products.filter((p) => p.active !== false).forEach((p) => { M.producto[String(p.code).trim()] = [p.minutes || null, p.persons || 1]; });
  return M;
}
