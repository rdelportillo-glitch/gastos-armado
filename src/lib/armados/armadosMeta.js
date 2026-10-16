// Meta de una solicitud de armado en almacén: los días sugeridos para terminar y la fecha límite que resulta.
const dia = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`);
const iso = (d) => d.toISOString().slice(0, 10);

export const sumarDias = (fecha, n) => { const d = dia(fecha); d.setDate(d.getDate() + n); return iso(d); };

// Fecha límite: los días sugeridos contados desde la fecha de solicitud; si no hay días, la fecha de compromiso del PQR.
export function calcularMeta(fechaSolicitud, dias, compromiso) {
  const n = Math.round(Number(dias));
  if (n > 0 && fechaSolicitud) return sumarDias(fechaSolicitud, n);
  return compromiso || null;
}

// Fecha límite guardada en la solicitud (o, en las antiguas, la de compromiso).
export const metaDe = (r) => r.target_date || r.commitment_date || null;

// Días que quedan hasta la meta, contando hoy (mínimo 1).
export function diasRestantes(meta, hoy) {
  if (!meta) return null;
  return Math.max(1, Math.round((dia(meta) - dia(hoy)) / 86400000) + 1);
}

// Meta diaria sugerida: unidades que faltan ÷ días que quedan (redondeo hacia arriba).
export function metaDiaria(pendientes, meta, hoy) {
  const d = diasRestantes(meta, hoy);
  return d ? Math.ceil(pendientes / d) : null;
}
