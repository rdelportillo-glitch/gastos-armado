// Creación de personal en masa: plantilla de Excel (con ejemplos e instrucciones) y lectura/validación del archivo.
// Los valores válidos son los mismos del formulario "Nueva persona". Las filas cuyo nombre empieza por EJEMPLO no se cargan.
import * as XLSX from "xlsx";
import { DEPARTAMENTOS_CO, CITIES_BY_DEPARTMENT } from "./colombiaData";

const txt = (v) => (v === null || v === undefined ? "" : String(v)).replace(/ /g, " ").trim();
export const plano = (s) => txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_\s]+/g, " ").trim().toUpperCase();

// listas: las del formulario (las pasa quien llama para que sean las mismas).
export function columnasPersonal(listas) {
  const o = (a) => a.join(", ");
  return [
    { key: "name", header: "NOMBRE COMPLETO", obligatoria: true, nota: "Como debe aparecer en la plataforma.", alias: ["NOMBRE"] },
    { key: "category", header: "CATEGORIA", nota: `${o(listas.categorias)}. Vacío = Técnico de campo.` },
    { key: "type", header: "CARGO", nota: `Técnico de campo: ${o(listas.cargosCampo)}. Administrativo: ${o(listas.cargosAdmin)}. Vacío = el primero.` },
    { key: "document", header: "DOCUMENTO", nota: "Número de identificación, sin puntos. Evita crear la misma persona dos veces.", alias: ["CEDULA", "IDENTIFICACION"] },
    { key: "phone", header: "TELEFONO", alias: ["CELULAR"] },
    { key: "familyContactPhone", header: "TELEFONO FAMILIAR", nota: "Contacto de emergencia." },
    { key: "entryDate", header: "FECHA INGRESO", fecha: true, nota: "DD/MM/AAAA. Vacío = hoy." },
    { key: "birthDate", header: "FECHA NACIMIENTO", fecha: true, nota: "DD/MM/AAAA. La necesita el bono de cumpleaños." },
    { key: "department", header: "DEPARTAMENTO", nota: "Ver la hoja Listas." },
    { key: "city", header: "CIUDAD", alias: ["MUNICIPIO"] },
    { key: "contractType", header: "TIPO DE CONTRATO", nota: o(listas.contratos) + "." },
    { key: "transportMode", header: "MEDIO DE TRANSPORTE", nota: o(listas.transportes) + "." },
    { key: "plate", header: "PLACA" },
    { key: "picoPlacaDay", header: "DIA PICO Y PLACA", nota: o(listas.dias) + "." },
    { key: "capacityMinutes", header: "CAPACIDAD MINUTOS", numero: true, nota: "Minutos de trabajo al día (para asignar servicios)." },
    { key: "residence", header: "VIVIENDA (ZONA)", nota: "Nombre de la zona equivalente, escrito igual que en Maestros → Barrios y zonas." },
    { key: "bankAccount", header: "NUMERO DE CUENTA" },
    { key: "bankAccountType", header: "TIPO DE CUENTA", nota: o(listas.cuentas) + "." },
    { key: "bankCode", header: "BANCO (CODIGO)", nota: "Como en la plantilla de pagos." },
    { key: "idType", header: "TIPO IDENTIFICACION", nota: "1, 2, 3... como en la plantilla de pagos." },
    { key: "holderFirstName", header: "NOMBRE TITULAR", nota: "Solo si la cuenta es de otra persona." },
    { key: "holderLastName", header: "APELLIDO TITULAR" },
    { key: "extremeUser", header: "USUARIO EXTREME" },
    { key: "operationSite", header: "UBICACION OPERATIVA", nota: "Disponible, Sede o Almacén. Vacío = Disponible (para ruta)." },
    { key: "assignOrder", header: "ORDEN DE RUTAS", numero: true, nota: "1 = primero en recibir servicios." },
    { key: "notes", header: "COMENTARIOS" },
  ];
}
const SITIOS = ["Disponible", "Sede", "Almacén"];

export function filasEjemplo(listas, hoy) {
  const f = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return [
    { name: "EJEMPLO PEREZ GOMEZ JUAN", category: "Técnico de campo", type: listas.cargosCampo[0], document: "1000000001", phone: "3001234567", familyContactPhone: "3109876543", entryDate: f(hoy), birthDate: "15/03/1995",
      department: "Atlántico", city: "Barranquilla", contractType: listas.contratos[0], transportMode: listas.transportes[0], plate: "ABC12D", picoPlacaDay: listas.dias[0], capacityMinutes: 420, residence: "", bankAccount: "12345678901", bankAccountType: listas.cuentas[0], bankCode: "007", idType: "1", extremeUser: "juan.perez", operationSite: "Disponible", assignOrder: 1, notes: "Fila de ejemplo: no se carga (el nombre empieza por EJEMPLO)." },
    { name: "EJEMPLO RUIZ LOPEZ MARIA", category: "Administrativo", type: listas.cargosAdmin[0], document: "1000000002", phone: "3151112233", entryDate: f(hoy), department: "Bolívar", city: "Cartagena de Indias", contractType: listas.contratos[0], notes: "Ejemplo de personal administrativo." },
  ];
}

export function libroPlantilla(listas, hoy) {
  const cols = columnasPersonal(listas);
  const wb = XLSX.utils.book_new();
  const ejemplos = filasEjemplo(listas, hoy);
  const hoja = XLSX.utils.aoa_to_sheet([cols.map((c) => c.header), ...ejemplos.map((e) => cols.map((c) => e[c.key] ?? ""))]);
  hoja["!cols"] = cols.map((c) => ({ wch: Math.max(14, c.header.length + 2, c.key === "name" ? 32 : 0) }));
  // Texto en las columnas con números largos o ceros a la izquierda, para que Excel no los cambie.
  const comoTexto = ["document", "phone", "familyContactPhone", "bankAccount", "bankCode", "idType"];
  cols.forEach((c, j) => { if (comoTexto.includes(c.key)) ejemplos.forEach((_, i) => { const ref = XLSX.utils.encode_cell({ r: i + 1, c: j }); if (hoja[ref]) { hoja[ref].t = "s"; hoja[ref].z = "@"; } }); });
  XLSX.utils.book_append_sheet(wb, hoja, "Personal");
  const inst = XLSX.utils.aoa_to_sheet([
    ["CÓMO USAR"], ["1. Escribe una fila por persona en la hoja Personal (puedes borrar los ejemplos; si los dejas, no se cargan)."], ["2. Solo es obligatorio el NOMBRE COMPLETO. El código (TEC-.. / ADM-..) lo pone la plataforma."], ["3. Sube el archivo en Personal → Importar personas, revisa y confirma."], [],
    ["COLUMNA", "OBLIGATORIA", "QUÉ VA"], ...cols.map((c) => [c.header, c.obligatoria ? "Sí" : "No", c.nota || ""]),
  ]);
  inst["!cols"] = [{ wch: 24 }, { wch: 12 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, inst, "Instrucciones");
  const grupos = [["CATEGORIA", listas.categorias], ["CARGO CAMPO", listas.cargosCampo], ["CARGO ADMINISTRATIVO", listas.cargosAdmin], ["TIPO DE CONTRATO", listas.contratos], ["MEDIO DE TRANSPORTE", listas.transportes], ["DIA PICO Y PLACA", listas.dias], ["TIPO DE CUENTA", listas.cuentas], ["UBICACION OPERATIVA", SITIOS], ["DEPARTAMENTO", DEPARTAMENTOS_CO]];
  const n = Math.max(...grupos.map(([, l]) => l.length));
  const l = XLSX.utils.aoa_to_sheet([grupos.map(([t]) => t), ...Array.from({ length: n }, (_, i) => grupos.map(([, x]) => x[i] || ""))]);
  l["!cols"] = grupos.map(() => ({ wch: 24 }));
  XLSX.utils.book_append_sheet(wb, l, "Listas");
  return wb;
}

// "15/03/1995", "1995-03-15" o número de serie de Excel → "1995-03-15"; "" si viene vacío; null si no es una fecha.
export function fechaIso(v) {
  if (v === null || v === undefined || v === "") return "";
  let y, m, d;
  if (typeof v === "number") { const x = new Date(Math.round((v - 25569) * 86400000)); y = x.getUTCFullYear(); m = x.getUTCMonth() + 1; d = x.getUTCDate(); }
  else {
    const s = txt(v);
    let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (r) [, y, m, d] = r.map(Number);
    else { r = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if (!r) return null; [, d, m, y] = r.map(Number); }
  }
  const x = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 2100 || x.getUTCFullYear() !== y || x.getUTCMonth() !== m - 1 || x.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Lee la hoja "Personal" (o la primera): devuelve [{ fila, datos: { key: valor crudo } }] sin las filas vacías.
export function leerFilas(wb, listas) {
  const cols = columnasPersonal(listas);
  const ws = wb.Sheets.Personal || wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
  if (!aoa.length) throw new Error("El archivo está vacío.");
  const cab = aoa[0].map(plano);
  const indice = cols.map((c) => cab.findIndex((h) => [c.header, ...(c.alias || [])].map(plano).includes(h)));
  if (indice[0] < 0) throw new Error("No encuentro la columna NOMBRE COMPLETO. Usa la plantilla (Descargar plantilla).");
  return aoa.slice(1).map((r, i) => ({ fila: i + 2, datos: Object.fromEntries(cols.map((c, j) => [c.key, indice[j] >= 0 ? r[indice[j]] : ""])) })).filter((x) => Object.values(x.datos).some((v) => txt(v)));
}

// Valida cada fila contra el formulario y el personal que ya existe. Devuelve [{ fila, nombre, estado: "ok"|"error"|"existe"|"ejemplo", errores, avisos, persona }].
export function validarPersonal(filas, { listas, existentes = [], hoy }) {
  const cols = columnasPersonal(listas);
  const doc = (v) => txt(v).replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const porDoc = new Map(), porNombre = new Map();
  existentes.forEach((t) => { if (doc(t.document)) porDoc.set(doc(t.document), t); porNombre.set(plano(t.name), t); });
  const vistosDoc = new Map(), vistosNombre = new Map();
  return filas.map(({ fila, datos }) => {
    const errores = [], avisos = [];
    const p = {};
    cols.forEach((c) => { p[c.key] = c.fecha || c.numero ? datos[c.key] : txt(datos[c.key]); });
    const nombre = p.name.replace(/\s+/g, " ");
    p.name = nombre;
    if (plano(nombre).startsWith("EJEMPLO")) return { fila, nombre, estado: "ejemplo", errores, avisos, persona: p };
    if (!nombre) errores.push("Falta el NOMBRE COMPLETO.");
    const elegir = (k, lista, header, defecto = "") => {
      if (!p[k]) { p[k] = defecto; return; }
      const hit = lista.find((x) => plano(x) === plano(p[k]));
      if (hit) p[k] = hit; else errores.push(`${header} «${p[k]}» no es válido (${lista.join(", ")}).`);
    };
    elegir("category", listas.categorias, "CATEGORIA", listas.categorias[0]);
    const cargos = p.category === "Administrativo" ? listas.cargosAdmin : listas.cargosCampo;
    elegir("type", cargos, "CARGO", cargos[0]);
    elegir("contractType", listas.contratos, "TIPO DE CONTRATO");
    elegir("transportMode", listas.transportes, "MEDIO DE TRANSPORTE");
    elegir("picoPlacaDay", listas.dias, "DIA PICO Y PLACA");
    elegir("bankAccountType", listas.cuentas, "TIPO DE CUENTA");
    elegir("operationSite", SITIOS, "UBICACION OPERATIVA", "Disponible");
    if (p.department) {
      const dep = DEPARTAMENTOS_CO.find((x) => plano(x) === plano(p.department));
      if (!dep) errores.push(`DEPARTAMENTO «${p.department}» no reconocido (ver la hoja Listas).`);
      else {
        p.department = dep;
        if (p.city) { const c = (CITIES_BY_DEPARTMENT[dep] || []).find((x) => plano(x) === plano(p.city)); if (c) p.city = c; else avisos.push(`La ciudad «${p.city}» no está en la lista de ${dep}; se guarda como la escribiste.`); }
      }
    }
    [["entryDate", "FECHA INGRESO", hoy], ["birthDate", "FECHA NACIMIENTO", ""]].forEach(([k, h, defecto]) => {
      const iso = fechaIso(p[k]);
      if (iso === null) errores.push(`${h} «${txt(p[k])}» no es una fecha (usa DD/MM/AAAA).`);
      p[k] = iso || defecto;
    });
    [["capacityMinutes", "CAPACIDAD MINUTOS"], ["assignOrder", "ORDEN DE RUTAS"]].forEach(([k, h]) => {
      if (txt(p[k]) === "") { p[k] = ""; return; }
      const n = Number(txt(p[k]).replace(",", "."));
      if (!Number.isFinite(n) || n < 0) errores.push(`${h} «${txt(p[k])}» debe ser un número.`); else p[k] = Math.round(n);
    });
    p.plate = p.plate.toUpperCase();

    const d = doc(p.document), n = plano(nombre);
    let existe = "";
    if (d && porDoc.has(d)) existe = `El documento ya es de ${porDoc.get(d).name} (${porDoc.get(d).code || "sin código"}).`;
    else if (n && porNombre.has(n)) existe = `Ya hay una persona con ese nombre (${porNombre.get(n).code || "sin código"}).`;
    if (!existe && d && vistosDoc.has(d)) errores.push(`El documento se repite en el archivo (fila ${vistosDoc.get(d)}).`);
    if (!existe && n && vistosNombre.has(n)) errores.push(`El nombre se repite en el archivo (fila ${vistosNombre.get(n)}).`);
    if (d) vistosDoc.set(d, fila);
    if (n) vistosNombre.set(n, fila);
    if (!existe && !d) avisos.push("Sin DOCUMENTO.");
    if (!existe && p.category !== "Administrativo" && !p.department) avisos.push("Sin DEPARTAMENTO: no se le podrán asignar servicios hasta completarlo.");
    return { fila, nombre, estado: existe ? "existe" : errores.length ? "error" : "ok", errores: existe ? [existe] : errores, avisos, persona: p };
  });
}
