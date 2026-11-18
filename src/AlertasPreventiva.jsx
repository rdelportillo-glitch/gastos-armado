import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, X, AlertTriangle } from "lucide-react";
import * as P from "./lib/preventiva";

/* ============================================================================
   Avisos de la gestión preventiva para quienes asignan (administrador y operador).
   Cuando un cliente cancela / arma / reprograma (o se devuelve un servicio a la asignación), llega un aviso: campana en la barra superior,
   cuadro emergente al llegar uno nuevo y franja visible en Asignación, Carga y Gestión preventiva hasta que se marca como leído.
============================================================================ */

export function useAvisosPreventiva(session, hoy) {
  const activo = !!session && (session.role === "admin" || session.role === "operador");
  const [avisos, setAvisos] = useState([]);
  const [nuevo, setNuevo] = useState(null);
  const vistos = useRef(null);
  const cargar = useCallback(async () => {
    if (!activo) return;
    try {
      const a = await P.cargarAvisos({ hoy, userId: session.id });
      setAvisos(a);
      const sinLeer = a.filter((x) => !x.leida);
      if (vistos.current === null) vistos.current = new Set(a.map((x) => x.id)); // la primera carga no genera emergentes
      else { const frescos = sinLeer.filter((x) => !vistos.current.has(x.id)); if (frescos.length) setNuevo(frescos[0]); sinLeer.forEach((x) => vistos.current.add(x.id)); }
    } catch (e) { /* sin la tabla (SQL 72 pendiente) o sin red: no molesta */ }
  }, [activo, hoy, session && session.id]);
  useEffect(() => { if (!activo) return; vistos.current = null; cargar(); const t = setInterval(cargar, 30000); return () => clearInterval(t); }, [cargar, activo]);
  const marcarLeidos = async (ids) => {
    if (!ids.length) return;
    setAvisos((a) => a.map((x) => (ids.includes(x.id) ? { ...x, leida: true } : x)));
    try { await P.marcarLeidos(ids, session.id); } catch (e) { cargar(); }
  };
  return { activo, avisos, sinLeer: avisos.filter((x) => !x.leida), marcarLeidos, nuevo, cerrarNuevo: () => setNuevo(null) };
}

const titulo = (a) => (a.resultado === "Revertido" ? "VUELVE A LA ASIGNACIÓN" : `${P.TEXTO_RESULTADO[a.resultado] || a.resultado}`.toUpperCase());
const hora = (iso) => { try { return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", hour12: true }); } catch (e) { return ""; } };

function Detalle({ a, ui }) {
  return (
    <>
      <div style={{ fontWeight: 700, fontSize: 12.5, color: a.resultado === "Revertido" ? "var(--accent)" : "var(--red)" }}>{titulo(a)} · Servicio {a.servicio}</div>
      <div style={{ fontSize: 12.5 }}>{a.cliente || "-"}{a.technician_name ? ` · técnico ${a.technician_name}` : " · sin técnico"}</div>
      {a.productos && <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{a.productos}</div>}
      <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Servicio del {ui.fmtDate(a.fecha_servicio)}{a.nueva_fecha ? ` · nueva fecha ${ui.fmtDate(a.nueva_fecha)}` : ""} · {a.created_by_name || ""} {hora(a.created_at)}</div>
      {a.nota && <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>“{a.nota}”</div>}
      <div style={{ fontSize: 11.5, marginTop: 2 }}>{a.resultado === "Revertido" ? "El servicio volvió a la asignación del día." : "Se retiró de la asignación (queda cancelado en Carga). Quítalo de la ruta si ya lo habías asignado."}</div>
    </>
  );
}

// Campana de la barra superior con la lista de avisos.
export function CampanaAvisos({ av, ui, onIr }) {
  const [abierto, setAbierto] = useState(false);
  if (!av.activo) return null;
  const n = av.sinLeer.length;
  return (
    <div style={{ position: "relative" }}>
      <button className="amg-btn ghost" style={{ padding: "4px 8px", position: "relative" }} title={n ? `${n} aviso(s) de gestión preventiva` : "Avisos de gestión preventiva"} onClick={() => setAbierto((v) => !v)}>
        <Bell size={16} color={n ? "var(--red)" : undefined} />
        {n > 0 && <span style={{ position: "absolute", top: -2, right: -2, background: "var(--red)", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "0 5px", minWidth: 16, textAlign: "center" }}>{n}</span>}
      </button>
      {abierto && (
        <div className="amg-card" style={{ position: "absolute", right: 0, top: 36, width: 380, maxWidth: "90vw", maxHeight: 460, overflow: "auto", zIndex: 60, padding: 0, boxShadow: "0 8px 30px rgba(0,0,0,0.35)" }}>
          <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--border)" }}>
            <b style={{ fontSize: 13 }}>Avisos de gestión preventiva</b>
            {n > 0 && <button className="amg-btn ghost" style={{ marginLeft: "auto", fontSize: 11.5, padding: "2px 8px" }} onClick={() => av.marcarLeidos(av.sinLeer.map((x) => x.id))}>Marcar todo leído</button>}
            <X size={16} style={{ cursor: "pointer", marginLeft: n ? 0 : "auto" }} onClick={() => setAbierto(false)} />
          </div>
          {av.avisos.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: "var(--text-faint)" }}>Sin avisos. Aquí llegan las cancelaciones, reprogramaciones y servicios que el cliente arma, para que los retires de la asignación.</div>}
          {av.avisos.map((a) => (
            <div key={a.id} style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", background: a.leida ? "transparent" : "rgba(192,70,58,0.07)", opacity: a.leida ? 0.7 : 1 }}>
              <Detalle a={a} ui={ui} />
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {!a.leida && <button className="amg-btn" style={{ fontSize: 11.5, padding: "2px 8px" }} onClick={() => av.marcarLeidos([a.id])}>Marcar leído</button>}
                <button className="amg-btn ghost" style={{ fontSize: 11.5, padding: "2px 8px" }} onClick={() => { setAbierto(false); onIr("preventiva"); }}>Ver gestión</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Cuadro emergente cuando llega un aviso nuevo.
export function EmergenteAviso({ av, ui, onIr }) {
  useEffect(() => { if (!av.nuevo) return; const t = setTimeout(av.cerrarNuevo, 20000); return () => clearTimeout(t); }, [av.nuevo]);
  if (!av.activo || !av.nuevo) return null;
  return (
    <div className="amg-card" role="alert" style={{ position: "fixed", right: 16, bottom: 16, width: 360, maxWidth: "92vw", zIndex: 80, padding: 12, borderLeft: "5px solid var(--red)", boxShadow: "0 8px 30px rgba(0,0,0,0.4)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}><AlertTriangle size={15} color="var(--red)" /><b style={{ fontSize: 13 }}>Aviso de gestión preventiva</b><X size={15} style={{ marginLeft: "auto", cursor: "pointer" }} onClick={av.cerrarNuevo} /></div>
      <Detalle a={av.nuevo} ui={ui} />
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button className="amg-btn primary" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => { av.marcarLeidos([av.nuevo.id]); av.cerrarNuevo(); }}>Entendido</button>
        <button className="amg-btn" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => { av.cerrarNuevo(); onIr("preventiva"); }}>Ver gestión</button>
      </div>
    </div>
  );
}

// Franja visible arriba de Asignación y Carga mientras haya avisos sin leer.
export function FranjaAvisos({ av, ui, onIr }) {
  if (!av.activo || av.sinLeer.length === 0) return null;
  return (
    <div className="amg-alert danger" style={{ display: "block", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <AlertTriangle size={15} /><b>Gestión preventiva: {av.sinLeer.length} aviso(s) para quienes asignan</b>
        <button className="amg-btn" style={{ marginLeft: "auto", fontSize: 11.5, padding: "2px 8px" }} onClick={() => av.marcarLeidos(av.sinLeer.map((x) => x.id))}>Marcar todo leído</button>
        <button className="amg-btn ghost" style={{ fontSize: 11.5, padding: "2px 8px" }} onClick={() => onIr("preventiva")}>Ver gestión</button>
      </div>
      {av.sinLeer.slice(0, 6).map((a) => <div key={a.id} style={{ padding: "4px 0", borderTop: "1px solid rgba(192,70,58,0.25)" }}><Detalle a={a} ui={ui} /></div>)}
      {av.sinLeer.length > 6 && <div style={{ fontSize: 12, marginTop: 4 }}>y {av.sinLeer.length - 6} más en la campana de la barra superior.</div>}
    </div>
  );
}
