// Sobrecarga de la asignación: la misma lógica del reporte de Dimensionamiento aplicada a lo que entra a la asignación de una fecha.
//  · Carga por departamento = suma del Tiempo Jamar de sus servicios (por registro, el MAYOR entre el tiempo de Jamar y el del maestro de Biver; ver tiempoJamar.js).
//  · Capacidad = técnicos solicitados del departamento en el mes de la fecha × 420 min (Dimensionamiento → Técnicos solicitados).
//  · Minutos a devolver a Jamar = carga − capacidad (si es positivo). Técnicos necesarios = carga ÷ 420.
//  · Con el plan armado, lo que ya se marcó como devuelto por SOBRECARGA (servicios sin asignar con ese motivo) se descuenta: queda lo que falta por devolver.
import { plano, solicitadosDe, estadoDe } from "./dimensionamiento";
import { tiempoJamarDe } from "./tiempoJamar";

const r1 = (n) => Math.round(n * 10) / 10;

// Registros de Carga/Asignación (paso 1) → una entrada por registro.
export function itemsDePool(pool, excluded = new Set()) {
  return (pool || []).filter((s) => !excluded.has(s.servicioExterno)).map((s) => ({
    servicio: String(s.servicioExterno), depto: String((s.asig && s.asig.depto) || s.departamentoExterno || ""), ciudad: String(s.ciudadExterna || (s.asig && s.asig.ciudad) || ""),
    jamar: tiempoJamarDe(s), prio: !!(s.asig && s.asig.prioridad === "Prioridad 1"), devuelto: false,
  }));
}

// Servicios del plan de asignación (paso 3) → una entrada por servicio. Cada fila del plan es una unidad: tiempo de Biver (tiempoBase, sin la instalación de TV) o el de Jamar (tiempoArmado), el mayor.
export function itemsDePlan(plan) {
  return ((plan && plan.services) || []).map((s) => ({
    servicio: String(s.servicio), depto: String(s.depto || ""), ciudad: String(s.ciudad || ""),
    jamar: (s.rows || []).reduce((a, r) => a + Math.max(Number(r.tiempoBase ?? r.tiempo) || 0, Number(r.tiempoArmado) || 0), 0),
    prio: !!s.prio, devuelto: !s.tech && s.motivoDev === "SOBRECARGA",
  }));
}

// Resumen por departamento. nombreDepto normaliza el nombre ("ATLANTICO" → "Atlántico").
export function resumenSobrecarga({ items, cfg, fecha, nombreDepto = (d) => d }) {
  const jornada = Number(cfg.jornada) || 420, mes = String(fecha || "").slice(0, 7);
  const m = new Map();
  items.forEach((x) => {
    const nombre = nombreDepto(x.depto) || "Sin departamento", k = plano(nombre);
    const g = m.get(k) || { key: k, nombre, items: [], servicios: new Set() };
    g.items.push(x); g.servicios.add(x.servicio); m.set(k, g);
  });
  const filas = [...m.values()].map((g) => {
    const carga = g.items.reduce((s, x) => s + x.jamar, 0);
    const devuelto = g.items.filter((x) => x.devuelto).reduce((s, x) => s + x.jamar, 0);
    const solicitados = solicitadosDe(cfg, mes, g.key), capacidad = solicitados * jornada;
    // Sin técnicos solicitados no hay capacidad contra la cual comparar: no genera minutos a devolver (se avisa en pantalla).
    const devolver = solicitados > 0 ? Math.max(0, carga - capacidad) : 0, falta = solicitados > 0 ? Math.max(0, carga - devuelto - capacidad) : 0;
    return {
      key: g.key, nombre: g.nombre, items: g.items, servicios: g.servicios.size, carga: r1(carga), solicitados, capacidad, necesarios: r1(carga / jornada),
      devolver: r1(devolver), devuelto: r1(devuelto), falta: r1(falta), tecnicosDevolver: r1(devolver / jornada),
      estado: estadoDe(carga / jornada, solicitados, cfg.tolerancia), sinSolicitados: !(solicitados > 0),
    };
  }).sort((a, b) => b.devolver - a.devolver || b.carga - a.carga || a.nombre.localeCompare(b.nombre, "es"));
  const suma = (k) => r1(filas.reduce((s, f) => s + f[k], 0));
  return { filas, jornada, mes, total: { carga: suma("carga"), capacidad: filas.reduce((s, f) => s + f.capacidad, 0), solicitados: filas.reduce((s, f) => s + f.solicitados, 0), devolver: suma("devolver"), devuelto: suma("devuelto"), falta: suma("falta"), tecnicosDevolver: r1(filas.reduce((s, f) => s + f.devolver, 0) / jornada), conSobrecarga: filas.filter((f) => f.devolver > 0).length } };
}
