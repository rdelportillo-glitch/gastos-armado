// Bono de cumpleaños: quién cumple años en la fecha de pago, su perfil, su antigüedad y el valor que le corresponde según la matriz de Maestros → Bono de cumpleaños.
//  · Técnicos de campo: valor según PERFIL (Técnico junior = Aprendiz; técnico senior, supervisor y otros = Maestro) y ANTIGÜEDAD (Nuevo si lleva menos de `mesesNuevo` meses desde la
//    fecha de ingreso, Antiguo si lleva más; sin fecha de ingreso se trata como Nuevo).
//  · Administrativos: valor según el CARGO (Auxiliar, Coordinador, ...); los cargos que no estén en la matriz usan el valor "resto".
// La matriz se guarda con la configuración de Pagos (assignment_settings → viaticos_config → cumpleanos).

export const CARGOS_ADMINISTRATIVOS = ["Auxiliar administrativo", "Coordinador administrativo", "Gerente administrativo", "Jefe Operativo", "Directivo"];

export const CUMPLE_DEFAULT = {
  mesesNuevo: 12, // menos de estos meses = Nuevo; de ahí en adelante = Antiguo
  subcategoria: "", // categoría y subcategoría del gasto que se crea al marcar el pago
  tecnicos: { Aprendiz: { Nuevo: 40000, Antiguo: 60000 }, Maestro: { Nuevo: 60000, Antiguo: 80000 } },
  administrativos: { "Auxiliar administrativo": 80000, "Coordinador administrativo": 100000, "Gerente administrativo": 120000, "Jefe Operativo": 120000, Directivo: 120000 },
  resto: 120000, // cargos administrativos que no estén en la lista
};

// Completa lo que falte de una configuración guardada con los valores por defecto (sin perder lo ya configurado).
export function completarCumple(c) {
  const v = c || {};
  return {
    ...CUMPLE_DEFAULT, ...v,
    tecnicos: { Aprendiz: { ...CUMPLE_DEFAULT.tecnicos.Aprendiz, ...((v.tecnicos || {}).Aprendiz || {}) }, Maestro: { ...CUMPLE_DEFAULT.tecnicos.Maestro, ...((v.tecnicos || {}).Maestro || {}) } },
    administrativos: { ...CUMPLE_DEFAULT.administrativos, ...(v.administrativos || {}) },
  };
}

const partes = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null; };
const bisiesto = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// ¿Cumple años en esa fecha (día y mes)? El 29 de febrero se celebra el 28 en los años no bisiestos.
export function esCumple(nacimiento, fecha) {
  const n = partes(nacimiento), f = partes(fecha);
  if (!n || !f) return false;
  if (n.m === f.m && n.d === f.d) return true;
  return n.m === 2 && n.d === 29 && !bisiesto(f.y) && f.m === 2 && f.d === 28;
}

// Años cumplidos a una fecha (null si no hay fecha de nacimiento).
export function edadA(nacimiento, fecha) {
  const n = partes(nacimiento), f = partes(fecha);
  if (!n || !f) return null;
  return f.y - n.y - (f.m < n.m || (f.m === n.m && f.d < n.d) ? 1 : 0);
}

// Meses completos entre la fecha de ingreso y una fecha (null si no hay fecha de ingreso).
export function mesesEntre(ingreso, fecha) {
  const a = partes(ingreso), b = partes(fecha);
  if (!a || !b) return null;
  return Math.max(0, (b.y - a.y) * 12 + (b.m - a.m) - (b.d < a.d ? 1 : 0));
}
export const antiguedadTexto = (meses) => {
  if (meses === null || meses === undefined) return "sin fecha de ingreso";
  const a = Math.floor(meses / 12), m = meses % 12;
  return [a ? `${a} año${a === 1 ? "" : "s"}` : "", m || !a ? `${m} mes${m === 1 ? "" : "es"}` : ""].filter(Boolean).join(" ");
};

export const perfilDe = (tipo) => (/junior/i.test(tipo || "") ? "Aprendiz" : "Maestro");
const esAdmin = (t) => (t.category || "Técnico de campo") === "Administrativo";

// Perfil, antigüedad y valor del bono de una persona a una fecha, según la matriz cfg (cfg.cumpleanos ya completada).
export function valorCumple(t, fecha, cfg) {
  const c = completarCumple(cfg);
  const meses = mesesEntre(t.entryDate, fecha);
  if (esAdmin(t)) {
    const valor = c.administrativos[t.type] !== undefined ? Number(c.administrativos[t.type]) : Number(c.resto);
    return { valor: valor || 0, admin: true, cargo: t.type || "Administrativo", meses, antiguedad: meses === null ? null : meses < c.mesesNuevo ? "Nuevo" : "Antiguo" };
  }
  const perfil = perfilDe(t.type), antiguedad = meses === null || meses < c.mesesNuevo ? "Nuevo" : "Antiguo";
  return { valor: Number(c.tecnicos[perfil][antiguedad]) || 0, admin: false, perfil, meses, antiguedad, sinIngreso: meses === null };
}

const ddmm = (iso) => { const p = partes(iso); return p ? `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}` : ""; };

// Líneas del listado de pagos: una por persona activa que cumple años en la fecha de pago (con su valor). technicians: Personal.
export function lineasCumpleanos({ technicians, fecha, cfg }) {
  return (technicians || []).filter((t) => t.status === "Activo" && esCumple(t.birthDate, fecha)).map((t) => {
    const v = valorCumple(t, fecha, cfg);
    const edad = edadA(t.birthDate, fecha);
    const detalle = v.admin
      ? `Bono de cumpleaños ${ddmm(fecha)}${edad !== null ? ` (${edad} años)` : ""}: ${v.cargo}`
      : `Bono de cumpleaños ${ddmm(fecha)}${edad !== null ? ` (${edad} años)` : ""}: ${v.perfil} ${v.antiguedad} (${antiguedadTexto(v.meses)}${v.sinIngreso ? ", se trata como Nuevo" : ""})`;
    return { kind: "Cumpleaños", technicianId: t.id, nombre: t.name, day: fecha, departamento: t.department || "", valor: v.valor, detalle };
  });
}
