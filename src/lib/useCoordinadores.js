// Filtro por departamento y por coordinador, reutilizable en varios módulos.
// El coordinador de cada departamento sale de Maestros → Coordinadores y, si allí falta, del que más se repite en Personal (cfgEfectiva).
// pasa(departamento, depto, coord): ¿un registro de ese departamento cumple los filtros elegidos? (un filtro vacío no filtra).
import { useState, useEffect, useMemo } from "react";
import { loadCoordinadores, coordinadorDe, cfgEfectiva } from "./coordinadores";

export const SIN_COORD = "__sin_coordinador";
const plano = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();

// enabled=false no consulta nada (por ejemplo para clientes y técnicos externos, que no ven esta configuración).
export function useZonaCoord(db, enabled = true) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { if (enabled) loadCoordinadores().then((r) => setCfg(r.cfg)).catch(() => setCfg({ coordinadores: [], asignaciones: [] })); }, [enabled]);
  const ef = useMemo(() => cfgEfectiva(cfg, (db && db.technicians) || []), [cfg, db && db.technicians]);
  const nombres = useMemo(() => ((ef && ef.coordinadores) || []).filter((c) => c.activo !== false).map((c) => c.nombre), [ef]);
  const coordDe = (depto) => (ef ? coordinadorDe(ef, depto) || "" : "");
  const pasa = (departamento, depto, coord) => (!depto || plano(departamento) === plano(depto))
    && (!coord || !ef || (coord === SIN_COORD ? !coordDe(departamento) : coordDe(departamento) === coord));
  return { nombres, coordDe, pasa };
}