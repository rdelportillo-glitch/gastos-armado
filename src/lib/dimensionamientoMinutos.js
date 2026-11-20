// Dimensionamiento en minutos: por departamento, lo que pide la carga, lo que nos solicitaron (dimensionamiento) y lo que Biver tiene con sus técnicos activos, todo en minutos
// por día y también convertido a técnicos (minutos ÷ 420).
//  · Carga = Tiempo Jamar promedio por día con carga (por registro, el MAYOR entre el tiempo de Jamar y el del maestro de Biver). Es la misma de Asignación y del Dimensionamiento.
//  · Dimensionamiento = técnicos solicitados del mes × 420 min (Reportes → Dimensionamiento → Técnicos solicitados).
//  · Capacidad Biver = suma de la capacidad en minutos (ficha de Personal; si no tiene, 420) de los técnicos ACTIVOS del departamento (técnicos de campo, junior o senior).
//  · Carga − dimensionamiento: positivo = sobrecarga a devolver a Jamar. Capacidad Biver − carga: positivo = holgura propia, negativo = Biver no alcanza con sus activos.
import { plano } from "./dimensionamiento";

const r1 = (n) => Math.round(n * 10) / 10;

// Técnicos activos por departamento (clave plana). Mismo criterio de Asignación: Activo, no administrativo y de perfil junior o senior.
export function tecnicosActivos(technicians, jornada = 420, nombreDepto = (d) => d) {
  const m = new Map();
  (technicians || []).filter((t) => t.status === "Activo" && t.category !== "Administrativo" && /junior|senior/i.test(t.type || "")).forEach((t) => {
    const nombre = nombreDepto(t.department) || "Sin departamento", k = plano(nombre);
    const g = m.get(k) || { key: k, nombre, n: 0, cap: 0 };
    g.n += 1; g.cap += Number(t.capacityMinutes) > 0 ? Number(t.capacityMinutes) : jornada; m.set(k, g);
  });
  return m;
}

// deptos: salida de resumirPorDepto (dimensionamiento.js). Une los técnicos activos y calcula las diferencias en minutos y en técnicos.
export function filasMinutos({ deptos, activos, jornada = 420 }) {
  const vistos = new Set();
  const filas = deptos.map((d) => {
    vistos.add(d.key);
    return armar({ key: d.key, nombre: d.nombre, carga: d.promMin, llego: d.total, servicios: new Set(d.registros.map((r) => r.servicio)).size, solicitados: d.solicitados, dias: d.dias.length, estado: d.estado, a: activos.get(d.key), jornada });
  });
  // Departamentos con técnicos activos que no tienen carga ni técnicos solicitados en el rango.
  activos.forEach((a, k) => { if (!vistos.has(k)) filas.push(armar({ key: k, nombre: a.nombre, carga: 0, llego: 0, servicios: 0, solicitados: 0, dias: 0, estado: "En línea", a, jornada })); });
  return filas.sort((a, b) => b.dim - a.dim || b.carga - a.carga || a.nombre.localeCompare(b.nombre, "es"));
}

function armar({ key, nombre, carga, llego = 0, servicios = 0, solicitados, dias, estado, a, jornada }) {
  const dim = Math.round(solicitados * jornada), cap = a ? a.cap : 0, activosN = a ? a.n : 0;
  return {
    key, nombre, dias, estado,
    // Lo que llegó de carga en el rango: total de minutos (Tiempo Jamar) y número de servicios
    llego: r1(llego), servicios,
    // En minutos por día
    carga: r1(carga), dim, cap, devolver: r1(carga - dim), holgura: r1(cap - carga), faltaActivos: r1(dim - cap),
    // En técnicos (minutos ÷ jornada)
    necesarios: r1(carga / jornada), solicitados: r1(solicitados), activos: activosN, capTecnicos: r1(cap / jornada),
    tecDevolver: r1((carga - dim) / jornada), tecHolgura: r1((cap - carga) / jornada), tecFaltan: r1(solicitados - activosN),
  };
}

export function totalMinutos(filas, jornada = 420) {
  const s = (k) => filas.reduce((a, f) => a + f[k], 0);
  const carga = s("carga"), dim = s("dim"), cap = s("cap");
  return {
    llego: r1(s("llego")), servicios: s("servicios"),
    carga: r1(carga), dim, cap, devolver: r1(carga - dim), holgura: r1(cap - carga), faltaActivos: r1(dim - cap),
    necesarios: r1(carga / jornada), solicitados: r1(s("solicitados")), activos: s("activos"), capTecnicos: r1(cap / jornada),
    tecDevolver: r1((carga - dim) / jornada), tecHolgura: r1((cap - carga) / jornada), tecFaltan: r1(s("solicitados") - s("activos")),
    // Brutos: solo los departamentos con sobrecarga (a devolver a Jamar) y solo los que no alcanzan con sus activos (déficit); una holgura de un departamento no cubre el déficit de otro.
    devolverBruto: r1(filas.reduce((a, f) => a + Math.max(0, f.devolver), 0)), deficitBruto: r1(filas.reduce((a, f) => a + Math.max(0, -f.holgura), 0)),
    deptosDevolver: filas.filter((f) => f.devolver > 0).length, deptosDeficit: filas.filter((f) => f.holgura < 0).length,
  };
}
