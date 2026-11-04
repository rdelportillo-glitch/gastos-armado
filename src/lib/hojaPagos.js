// Lee la hoja de pagos (columnas ID, TIPO DE IDENTIFICACION, NUMERO IDENTIFICACION, NOMBRE DEL TITULAR, APELLIDO DEL TITULAR, BANCO DESTINO, TIPO DE CUENTA, NUMERO CUENTA, OBSERVACIONES).
// La usan la importación de Proveedores y la de datos bancarios de Personal. Los valores se leen tal cual: los números largos de cuenta no pasan a notación científica.
import * as XLSX from "xlsx";

export const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const aTexto = (v) => (v === undefined || v === null ? "" : typeof v === "number" ? String(v) : String(v).trim());

export function leerHojaPagos(buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
  const iEnc = filas.findIndex((f) => f.some((c) => plano(c) === "ID") && f.some((c) => plano(c).startsWith("NUMERO CUENTA")));
  if (iEnc < 0) throw new Error("No encontré los encabezados (ID, NUMERO CUENTA...). Usa la misma hoja de pagos.");
  const col = Object.fromEntries(filas[iEnc].map((c, i) => [plano(c), i]));
  const g = (f, nombre) => aTexto(f[col[nombre]]);
  return filas.slice(iEnc + 1).filter((f) => aTexto(f[col["ID"]])).map((f) => ({
    name: g(f, "ID"), idType: g(f, "TIPO DE IDENTIFICACION"), idNumber: g(f, "NUMERO IDENTIFICACION"), holderFirstName: g(f, "NOMBRE DEL TITULAR"), holderLastName: g(f, "APELLIDO DEL TITULAR"),
    bankCode: g(f, "BANCO DESTINO"), accountType: plano(g(f, "TIPO DE CUENTA")), accountNumber: g(f, "NUMERO CUENTA"), observations: g(f, "OBSERVACIONES"),
  }));
}
