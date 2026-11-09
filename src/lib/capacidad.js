// Capacidad instalada por departamento (Reportes). Sale de Personal: los técnicos de campo (junior y senior; sin administrativos).
//  · Activos / Inactivos / Total: por el estado en Personal (Inactivo y, si se pide, Retirado cuentan como inactivos).
//  · Capacidad instalada = minutos de los técnicos ACTIVOS (el campo "Capacidad (minutos)" de Personal).
//  · Disponibles = activos que ese día pueden salir a ruta: no están en sede ni en almacén ni con una novedad que los saque (Asignación → paso 2); su capacidad
//    disponible es la capacidad menos los minutos de novedad (la misma cuenta que usa la Asignación).
const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
export const esTecnicoCampo = (t) => (t.category || "Técnico de campo") !== "Administrativo" && /junior|senior/i.test(t.type || "");
export const perfilDe = (t) => (/senior/i.test(t.type || "") ? "Maestro" : "Aprendiz");

// technicians: Personal · engine: Map id → técnico en formato del motor (D.engineTechs: estado, nov, cap, capEff) · opciones: { incluirRetirados, perfil, coordDe(depto), regionDe(depto) }
export function calcularCapacidad({ technicians, engine, incluirRetirados = false, perfil = "", coordDe = () => "", regionDe = () => null }) {
  const m = new Map();
  (technicians || []).filter(esTecnicoCampo).forEach((t) => {
    const status = t.status || "Activo";
    if (status === "Retirado" && !incluirRetirados) return;
    if (perfil && perfilDe(t) !== perfil) return;
    const nombre = t.department || "Sin departamento", k = plano(nombre);
    const g = m.get(k) || { depto: nombre, coord: coordDe(nombre) || "", region: regionDe(nombre), activos: 0, inactivos: 0, total: 0, maestros: 0, aprendices: 0, disponibles: 0, noDisponibles: 0, enSede: 0, conNovedad: 0, capInstalada: 0, capDisponible: 0, tecnicos: [] };
    g.total++;
    const activo = status === "Activo";
    const e = engine.get(t.id);
    const cap = Number(t.capacityMinutes) || 0;
    let capEff = 0, estado = status, nov = 0, disponible = false;
    if (activo) {
      g.activos++; g.capInstalada += cap;
      if (perfilDe(t) === "Maestro") g.maestros++; else g.aprendices++;
      estado = e ? e.estado : "Disponible"; nov = e ? e.nov : 0; capEff = e ? e.capEff : cap;
      disponible = capEff > 0;
      if (disponible) { g.disponibles++; g.capDisponible += capEff; }
      else { g.noDisponibles++; if (estado === "Sede" || estado === "Almacén") g.enSede++; else g.conNovedad++; }
    } else g.inactivos++;
    g.tecnicos.push({ id: t.id, nombre: t.name, perfil: perfilDe(t), statusPersonal: status, estado, cap, capEff, nov, orden: t.assignOrder ?? null, disponible });
    m.set(k, g);
  });
  const filas = [...m.values()].map((g) => ({ ...g, tecnicos: g.tecnicos.sort((a, b) => (b.disponible ? 1 : 0) - (a.disponible ? 1 : 0) || String(a.nombre).localeCompare(String(b.nombre), "es")), pctDisponible: g.capInstalada ? (g.capDisponible / g.capInstalada) * 100 : 0, promDisponible: g.disponibles ? g.capDisponible / g.disponibles : 0 }))
    .sort((a, b) => b.capInstalada - a.capInstalada || a.depto.localeCompare(b.depto, "es"));
  const sum = (k) => filas.reduce((s, f) => s + f[k], 0);
  const total = { activos: sum("activos"), inactivos: sum("inactivos"), total: sum("total"), maestros: sum("maestros"), aprendices: sum("aprendices"), disponibles: sum("disponibles"), noDisponibles: sum("noDisponibles"), enSede: sum("enSede"), conNovedad: sum("conNovedad"), capInstalada: sum("capInstalada"), capDisponible: sum("capDisponible") };
  total.pctDisponible = total.capInstalada ? (total.capDisponible / total.capInstalada) * 100 : 0;
  total.promDisponible = total.disponibles ? total.capDisponible / total.disponibles : 0;
  return { filas, total };
}
