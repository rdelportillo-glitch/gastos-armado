import { useEffect, useRef, useState } from "react";
import { Check, AlertTriangle, X } from "lucide-react";
import * as F from "./lib/finalizarDia";

/* ============================================================================
   CIERRE AUTOMÁTICO DE CARGA · "Finalizar día" solo a las 11:59 pm
   Corre en el navegador de un administrador u operador que tenga la plataforma abierta (en cualquier módulo): a las 11:59 pm finaliza el día de Carga con la misma
   lógica del botón. Si a esa hora nadie la tenía abierta, el día se finaliza en cuanto alguien entre (hasta 3 días atrás). Un solo navegador lo ejecuta (reserva atómica
   en la base de datos) y no interrumpe: espera a que no haya ventanas abiertas ni guardados en curso. El administrador puede apagarlo desde Carga.
============================================================================ */

const CADA_MS = 20000;

export default function CierreAutomaticoCarga({ session, getDb, getFresh, persist, addAudit, puedeCorrer, ui }) {
  const activo = !!session && (session.role === "admin" || session.role === "operador");
  const [avisos, setAvisos] = useState([]);
  const corriendo = useRef(false);
  const intentos = useRef(new Map()); // día → hora del último intento (no se insiste antes de 10 minutos)
  const cfgCache = useRef({ en: 0, activo: true });

  useEffect(() => {
    if (!activo) return undefined;
    const revisar = async () => {
      if (corriendo.current) return;
      const db = getDb();
      if (!db || !puedeCorrer()) return;
      const ahora = Date.now();
      const dias = F.diasPorCerrar(db.services).filter((d) => !(intentos.current.get(d) > ahora - 10 * 60 * 1000));
      if (!dias.length) return;
      corriendo.current = true;
      try {
        if (ahora - cfgCache.current.en > 120000) { cfgCache.current = { en: ahora, activo: (await F.cargarCierreAuto()).activo }; }
        if (!cfgCache.current.activo) return;
        for (const day of dias) {
          intentos.current.set(day, Date.now());
          let reservado = false;
          try { reservado = await F.reservarCierre(day); } catch (e) { return; } // sin la función en la base (SQL 73 pendiente) o sin red: no hace nada
          if (!reservado) continue; // otro navegador lo hizo o lo está haciendo
          try {
            const fresca = await getFresh();
            if (F.clasificarDia(fresca.services, day).dayRows.length === 0) { await F.terminarCierre(day, true, "Sin registros activos"); continue; }
            const ctx = await F.contextoCierre(fresca.technicians);
            const r = await F.finalizarDiaCarga({ db: fresca, day, session, persist, addAudit, ...ctx, automatico: true });
            if (r.ok) {
              await F.terminarCierre(day, true, `${r.realizados} realizados, ${r.noRealizados} a pendientes, ${r.cancelados} cancelados`);
              setAvisos((a) => [...a, { id: `${day}-${Date.now()}`, ok: true, texto: `Se finalizó automáticamente el día ${ui.fmtDate(day)}: ${r.realizados} realizados archivados en el histórico y ${r.noRealizados} no realizados volvieron a Pendientes${r.cancelados ? `; ${r.cancelados} cancelados archivados` : ""}.` }]);
            } else {
              await F.terminarCierre(day, false, "No se pudo actualizar Carga");
              setAvisos((a) => [...a, { id: `${day}-${Date.now()}`, ok: false, texto: `El cierre automático del día ${ui.fmtDate(day)} guardó el histórico pero no pudo actualizar Carga. Entra a Carga y pulsa Finalizar día (no duplica).` }]);
            }
          } catch (e) {
            try { await F.terminarCierre(day, false, e.message); } catch (e2) { /* sin conexión */ }
            setAvisos((a) => [...a, { id: `${day}-${Date.now()}`, ok: false, texto: `No se pudo finalizar automáticamente el día ${ui.fmtDate(day)}: ${e.message}. Pulsa Finalizar día en Carga.` }]);
          }
        }
      } finally { corriendo.current = false; }
    };
    const t = setInterval(revisar, CADA_MS);
    const alVolver = () => { if (!document.hidden) revisar(); };
    document.addEventListener("visibilitychange", alVolver);
    const t0 = setTimeout(revisar, 4000); // al entrar: recupera los días cerrados que nadie finalizó
    return () => { clearInterval(t); clearTimeout(t0); document.removeEventListener("visibilitychange", alVolver); };
  }, [activo, session && session.id]);

  if (!activo || avisos.length === 0) return null;
  return (
    <div style={{ position: "fixed", left: 16, bottom: 16, zIndex: 80, display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
      {avisos.map((a) => (
        <div key={a.id} className="amg-card" role="status" style={{ padding: 12, borderLeft: `5px solid ${a.ok ? "var(--green)" : "var(--red)"}`, boxShadow: "0 8px 30px rgba(0,0,0,0.4)", display: "flex", gap: 8, alignItems: "flex-start" }}>
          {a.ok ? <Check size={16} color="var(--green)" /> : <AlertTriangle size={16} color="var(--red)" />}
          <div style={{ fontSize: 12.5, flex: 1 }}>{a.texto}</div>
          <X size={15} style={{ cursor: "pointer" }} onClick={() => setAvisos((x) => x.filter((y) => y.id !== a.id))} />
        </div>
      ))}
    </div>
  );
}
