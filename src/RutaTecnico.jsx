import { useState, useEffect, useMemo } from "react";
import { Phone, MessageCircle, MapPin, Check, RotateCcw, AlertTriangle, RefreshCw } from "lucide-react";
import * as R from "./lib/ruta";

/* ============================================================================
   MI RUTA DEL DÍA (técnico)
   La carga de un día agrupada por servicio, con el detalle de sus productos, los teléfonos del cliente separados (llamar y WhatsApp por número) y la marca de realizado,
   que guarda la hora y la ubicación del celular. La asignación se hace el día anterior: por eso están Hoy y Mañana. Cada técnico ve solo su ruta (lo garantiza la base de datos);
   administrador, operador y consulta la ven por técnico, sin poder marcar.
============================================================================ */

const MOTIVO = { denegada: "permiso de ubicación denegado (actívalo en el navegador)", sin_senal: "sin señal de GPS", no_disponible: "este dispositivo no ofrece ubicación" };
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "");

export default function RutaTecnico({ db, session, ui }) {
  const esTecnico = session.role === "tecnico";
  const hoy = ui.todayISO(), manana = R.sumarDias(hoy, 1);
  const [fecha, setFecha] = useState(hoy);
  const [techSel, setTechSel] = useState("");
  const [registros, setRegistros] = useState([]);
  const [reportes, setReportes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmar, setConfirmar] = useState(null);
  const [recarga, setRecarga] = useState(0);

  const tecnicos = useMemo(() => (db.technicians || []).filter((t) => t.category !== "Administrativo" && t.status === "Activo").sort((a, b) => a.name.localeCompare(b.name, "es")), [db.technicians]);
  const techId = esTecnico ? session.technicianId : techSel;
  const techNombre = esTecnico ? session.name : ((tecnicos.find((t) => t.id === techSel) || {}).name || "");

  useEffect(() => {
    if (!techId) { setRegistros([]); setReportes([]); return; }
    let alive = true;
    setLoading(true); setError("");
    Promise.all([R.cargarServiciosDelDia(techId, fecha), R.cargarReportes({ day: fecha, technicianId: techId })])
      .then(([s, r]) => { if (alive) { setRegistros(s); setReportes(r); } })
      .catch((e) => { if (alive) { setRegistros([]); setReportes([]); setError(`${e.message}. Si es la primera vez, falta correr el SQL de la ruta del técnico (sql/50) en Supabase.`); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [techId, fecha, recarga]);

  const grupos = useMemo(() => R.agruparPorServicio(registros), [registros]);
  const repDe = (servicio) => reportes.find((r) => r.servicio === servicio && r.done);
  const hechos = grupos.filter((g) => repDe(g.servicio)).length;
  const productos = grupos.reduce((s, g) => s + g.productos.reduce((x, p) => x + p.n, 0), 0);
  const fechaTexto = fecha === hoy ? "Hoy" : fecha === manana ? "Mañana" : `El ${ui.fmtDate(fecha)}`;

  const marcar = async (g, done) => {
    setBusy(g.servicio); setError(""); setMsg(""); setConfirmar(null);
    try {
      const pos = done ? await R.posicionActual() : null;
      const r = await R.guardarReporte({ day: fecha, servicio: g.servicio, technicianId: techId, userId: session.id, done, posicion: pos });
      setReportes((rs) => [...rs.filter((x) => x.servicio !== g.servicio), r]);
      setMsg(!done ? `Servicio ${g.servicio} desmarcado.` : pos.status === "ok" ? `Servicio ${g.servicio} marcado como realizado, con tu ubicación.` : `Servicio ${g.servicio} marcado como realizado, pero sin ubicación: ${MOTIVO[pos.status]}.`);
    } catch (e) { setError(`No se pudo guardar: ${e.message}`); }
    setBusy("");
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input type="date" className="amg-input" style={{ width: 150 }} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <button className={`amg-btn ${fecha === hoy ? "primary" : ""}`} onClick={() => setFecha(hoy)}>Hoy</button>
        <button className={`amg-btn ${fecha === manana ? "primary" : ""}`} title="La asignación se hace el día anterior: aquí ves la de mañana" onClick={() => setFecha(manana)}>Mañana</button>
        <button className="amg-btn" onClick={() => setRecarga((n) => n + 1)} title="Vuelve a consultar tu carga"><RefreshCw size={14} /> Actualizar</button>
        {!esTecnico && (
          <select className="amg-select" style={{ width: 220 }} value={techSel} onChange={(e) => setTechSel(e.target.value)}>
            <option value="">Elegir técnico...</option>{tecnicos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {!esTecnico && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>Vista del equipo: así ve su ruta el técnico elegido. Solo el técnico marca realizado.</div>}
      {esTecnico && !session.technicianId && <div className="amg-alert danger"><AlertTriangle size={14} /> Tu usuario no tiene ficha de Personal enlazada. Pídele a un administrador que la enlace en Usuarios.</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      {!esTecnico && !techSel && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Elige un técnico para ver su ruta.</div>}

      {techId && (
        <>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, marginBottom: 10 }}>
            <span><b>{ui.fmtDate(fecha)}</b> · {fechaTexto}</span>
            <span><b>{grupos.length}</b> servicio(s)</span><span><b>{productos}</b> producto(s)</span>
            <span style={{ color: "var(--green)" }}><b>{hechos}</b> realizado(s)</span>
          </div>
          {loading && <div style={{ color: "var(--text-faint)", marginBottom: 10 }}>Cargando la ruta...</div>}
          {!loading && !error && grupos.length === 0 && (
            <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>
              No hay servicios asignados para el {ui.fmtDate(fecha)}. {fecha === hoy ? "Revisa \"Mañana\": la asignación se hace el día anterior." : ""}
            </div>
          )}

          {grupos.map((g, i) => {
            const rep = repDe(g.servicio);
            const mapa = R.enlaceMapa(rep);
            const cuando = [g.direccion, g.barrio, g.ciudad].filter(Boolean).join(", ");
            return (
              <div key={g.servicio} className="amg-card" style={{ padding: 14, marginBottom: 12, borderLeft: `4px solid ${rep ? "var(--green)" : "var(--accent)"}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{i + 1}. Servicio <span className="amg-mono">{g.servicio}</span></span>
                  {g.pqr && <span className="amg-mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>PQR {g.pqr}</span>}
                  <span style={{ marginLeft: "auto" }}>{rep ? <ui.Badge text={`Realizado ${hora(rep.done_at)}`} color="green" /> : <ui.Badge text="Pendiente" color="amber" />}</span>
                </div>

                <div style={{ fontSize: 13.5, lineHeight: 1.65 }}>
                  <div><b>Cliente:</b> {g.cliente || "-"}</div>
                  <div><b>Ciudad:</b> {g.ciudad || "-"}{g.barrio ? <> · <b>Barrio:</b> {g.barrio}</> : null}</div>
                  <div><b>Dirección:</b> {g.direccion || "-"} {cuando && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cuando)}`} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6, whiteSpace: "nowrap" }}><MapPin size={12} /> Cómo llegar</a>}</div>
                  {g.senas && <div><b>Señas:</b> {g.senas}</div>}
                  {g.reporta && <div><b>Cliente reporta:</b> {g.reporta}</div>}
                  {g.tipo && <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Tipo de servicio: {g.tipo}</div>}
                </div>

                <div style={{ marginTop: 10, padding: 10, background: "var(--panel-2)", borderRadius: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Productos ({g.productos.reduce((s, p) => s + p.n, 0)})</div>
                  {g.productos.map((p, k) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "2px 0" }}>
                      <span>{p.nombre}{p.n > 1 ? <b> ×{p.n}</b> : null}</span><span className="amg-mono" style={{ color: "var(--text-dim)" }}>{p.codigo || "-"}</span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>Teléfonos del cliente</div>
                  {g.telefonos.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Este servicio no trae teléfono.</div>}
                  {g.telefonos.map((n) => {
                    const wsp = R.enlaceWhatsappCliente(n, { cliente: g.cliente, tecnico: techNombre, servicio: g.servicio, productos: g.productos, fechaTexto, direccion: g.direccion });
                    return (
                      <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <span className="amg-mono" style={{ minWidth: 110 }}>{n}</span>
                        <a className="amg-btn" style={{ textDecoration: "none" }} href={R.enlaceLlamar(n)}><Phone size={14} color="#2f5fa8" /> Llamar</a>
                        {wsp
                          ? <a className="amg-btn" style={{ textDecoration: "none" }} href={wsp} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} color="#25a244" /> WhatsApp</a>
                          : <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>no es un celular: solo llamada</span>}
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {rep ? (
                    <>
                      <span style={{ fontSize: 12.5, color: "var(--green)" }}><Check size={13} /> Realizado a las {hora(rep.done_at)}</span>
                      {mapa ? <a href={mapa} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5 }}><MapPin size={12} /> Ubicación guardada{rep.accuracy ? ` (±${rep.accuracy} m)` : ""}</a>
                        : <span style={{ fontSize: 12.5, color: "var(--red)" }}>Sin ubicación: {MOTIVO[rep.location_status] || "no se pudo tomar"}</span>}
                      {esTecnico && <button className="amg-btn ghost" disabled={busy === g.servicio} onClick={() => marcar(g, false)}><RotateCcw size={13} /> Deshacer</button>}
                    </>
                  ) : (
                    esTecnico
                      ? <button className="amg-btn primary" style={{ flex: "1 1 220px", justifyContent: "center", padding: "10px 14px" }} disabled={busy === g.servicio} onClick={() => setConfirmar(g)}><Check size={15} /> {busy === g.servicio ? "Guardando ubicación..." : "Marcar servicio como realizado"}</button>
                      : <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Aún sin marcar por el técnico.</span>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      {confirmar && (
        <ui.ConfirmModal title={`Servicio ${confirmar.servicio} realizado`} confirmLabel="Sí, realizado" onConfirm={() => marcar(confirmar, true)} onClose={() => setConfirmar(null)}
          message={`Vas a marcar como realizado el servicio ${confirmar.servicio} (${confirmar.productos.reduce((s, p) => s + p.n, 0)} producto(s)) de ${confirmar.cliente || "el cliente"}. Se guarda la hora y la ubicación de tu celular: acepta el permiso de ubicación cuando el navegador lo pida.`} />
      )}
    </div>
  );
}
