// Cambios de técnico durante la gestión en Carga. Asignación guarda en cada registro (asig.tecnicoOriginal) a quién se lo entregó: { id, nombre },
// o null si salió sin técnico. Si en Carga se reasigna a otro técnico, el registro conserva ese original y la diferencia es el "cambio de técnico".

// asig del registro con el técnico original, si todavía no lo tenía y el técnico está por cambiar. Los registros que no vienen de Asignación (sin asig) no se siguen.
export function asigConOriginal(s, nuevoTecnicoId, nombreDe) {
  if (!s.asig || "tecnicoOriginal" in s.asig) return s.asig;
  if ((s.technicianId || null) === (nuevoTecnicoId || null)) return s.asig;
  return { ...s.asig, tecnicoOriginal: s.technicianId ? { id: s.technicianId, nombre: nombreDe(s.technicianId) || "" } : null };
}

// Un servicio devuelto (ALMACEN o SOBRECARGA) llega a Carga cerrado como "No realizado", con el motivo como causal y como técnico. Cuando se le asigna un técnico
// en Carga, esas marcas ya no aplican: se limpian (el motivo queda en asig.motivoDevolucion para el documento de Cambio de técnico).
export function sinMarcaDevolucion(s) {
  const m = s.asig && s.asig.motivoDevolucion;
  if (!m) return {};
  return {
    estadoExtreme: s.estadoExtreme === "No realizado" ? "" : s.estadoExtreme,
    causalAuditada: s.causalAuditada === m ? "" : s.causalAuditada,
    diagnostico: s.diagnostico === `Devuelto por ${m}` ? "" : s.diagnostico,
  };
}

// ¿El registro lo tiene hoy un técnico distinto del que entregó Asignación? Incluye lo que salió sin técnico y se asignó en Carga.
export function esCambioDeTecnico(s) {
  const a = s.asig;
  if (!a || !("tecnicoOriginal" in a) || !s.technicianId) return false;
  const original = a.tecnicoOriginal ? a.tecnicoOriginal.id : null;
  return original !== s.technicianId;
}
