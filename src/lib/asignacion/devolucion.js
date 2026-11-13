// Servicios devueltos sin técnico: ALMACEN, SOBRECARGA y EMPAQUE COLCHONES. En Carga, en el Histórico y en el CSV el motivo ocupa el lugar del técnico
// (así aparecen agrupados bajo ese nombre y no como filas "sin técnico"). Mismos motivos que MOTIVOS_DEVOLUCION de Asignación.
const MOTIVOS = ["ALMACEN", "SOBRECARGA", "EMPAQUE COLCHONES"];
const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

export const esMotivoDevolucion = (causal) => MOTIVOS.includes(plano(causal));

// nombre: el técnico que ya tiene el registro (si lo hay). Sin técnico y con una causal de devolución, el técnico pasa a ser la causal.
export const tecnicoOMotivo = (nombre, causalAuditada) => {
  if (nombre && String(nombre).trim()) return nombre;
  return esMotivoDevolucion(causalAuditada) ? plano(causalAuditada) : (nombre || "");
};
