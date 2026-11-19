// Tiempo Jamar de un registro de Carga: el MAYOR entre el tiempo que trae Jamar (asig.tiempoArmado, por unidad) y el del maestro de Biver.
// El registro guarda en tiempoMin el que se está usando (el del maestro de Biver si el producto está en el maestro, si no el de Jamar), así que el mayor es max(tiempoMin, tiempo de Jamar).
// Un registro de varias unidades (los antiguos) trae el tiempo de Jamar por unidad: se multiplica por la cantidad.
export function tiempoJamarDe(s) {
  const a = (s && s.asig) || {};
  const unidades = Math.max(1, Math.round(Number(s && s.quantity) || 1));
  const jamar = (Number(a.tiempoArmado) || 0) * unidades;
  return Math.max(Number(s && s.tiempoMin) || 0, jamar);
}
export const tiempoJamarTotal = (lista) => (lista || []).reduce((acc, s) => acc + tiempoJamarDe(s), 0);
