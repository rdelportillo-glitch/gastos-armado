import { useState, useEffect, useMemo } from "react";
import { Check, AlertTriangle, Download, RotateCcw } from "lucide-react";
import * as D from "./lib/asignacion/data";
import { buildCambiosCargaWorkbook, mailLinks, downloadWorkbook } from "./lib/asignacion/outputs";

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };

// Cambio de técnico de Carga: solo los servicios que, durante la gestión, pasaron a otro técnico distinto del que entregó Asignación
// (o que salieron sin técnico y se asignaron en Carga). Se lee de la base al abrir, así junta lo que hizo cualquier usuario.
export default function CambioTecnicoCargaModal({ ui, db, fecha, onFecha, onClose }) {
  const [cfg, setCfg] = useState(null);
  const [registros, setRegistros] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [asunto, setAsunto] = useState("");

  const stats = useMemo(() => (registros ? buildCambiosCargaWorkbook({ registros, technicians: db.technicians, fecha }) : null), [registros, db.technicians, fecha]);

  const cargar = () => {
    setCargando(true); setError(""); setRegistros(null);
    D.loadCambiosCarga(fecha).then(setRegistros).catch((e) => setError(`No se pudo leer Carga: ${e.message}`)).finally(() => setCargando(false));
  };
  useEffect(() => { cargar(); }, [fecha]);
  useEffect(() => { D.loadChangeEmailConfig().then(setCfg).catch((e) => { setError(`No se pudieron leer los destinatarios: ${e.message}`); setCfg(D.CAMBIO_EMAIL_DEFAULT); }); }, []);
  useEffect(() => {
    if (!stats) return;
    setAsunto(`Cambio de técnico (Carga) ${ui.fmtDate(fecha)}`);
    setMensaje(`Buenos días,\n\nAdjunto los cambios de técnico hechos durante la gestión del ${ui.fmtDate(fecha)}: ${stats.servicios} servicios.\n\nCordial saludo,`);
  }, [fecha, stats && stats.servicios]);

  const activos = ((cfg && cfg.destinatarios) || []).filter((d) => d.activo !== false && d.correo);
  const para = activos.filter((d) => d.tipo !== "CC").map((d) => d.correo);
  const cc = activos.filter((d) => d.tipo === "CC").map((d) => d.correo);
  const vacio = !stats || stats.servicios === 0;

  const descargar = () => { downloadWorkbook(stats.wb, stats.name); return stats.name; };
  const enviar = (via) => {
    const name = descargar();
    const links = mailLinks({ para, cc, subject: asunto, body: mensaje });
    if (via === "gmail") window.open(links.gmail, "_blank", "noopener");
    else window.location.href = links.mailto;
    setMsg(`Se descargó ${name}. Se abrió el correo con destinatarios, asunto y mensaje: adjunta ese archivo antes de enviar.`);
  };
  const copiar = async () => { try { await navigator.clipboard.writeText([...para, ...cc].join(", ")); setMsg("Destinatarios copiados."); } catch (e) { setError("No se pudo copiar."); } };

  return (
    <ui.Modal title={`Cambio de técnico en Carga · ${ui.fmtDate(fecha)}`} onClose={onClose} width={760}
      footer={<button className="amg-btn" onClick={onClose}>Cerrar</button>}>
      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <label className="amg-label" style={{ margin: 0 }}>Fecha</label>
          <input type="date" className="amg-input" style={{ width: 150 }} value={fecha} onChange={(e) => e.target.value && onFecha(e.target.value)} />
          <button className="amg-btn" disabled={cargando} onClick={cargar}><RotateCcw size={13} /> {cargando ? "Leyendo..." : "Actualizar"}</button>
        </div>
        <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
          Solo los <b>servicios que cambiaron de técnico durante la gestión</b>: los que Asignación entregó a un técnico y en Carga quedaron con otro, y los que salieron sin técnico y se asignaron en Carga.
          El Excel trae las columnas del de Asignación (<b>Codigo Tecnico</b> = el técnico nuevo) y, al final, el técnico anterior. Lo que no cambió de técnico no aparece.
        </div>
        {cargando && <div style={{ color: "var(--text-faint)", marginBottom: 12 }}>Leyendo Carga...</div>}
        {stats && !vacio && (
          <div style={{ overflowX: "auto", marginBottom: 12, maxHeight: 280, overflowY: "auto" }}>
            <table className="amg-table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Servicio</th><th>Departamento</th><th>Técnico anterior</th><th>Técnico nuevo</th><th>Productos</th><th>Tipo</th></tr></thead>
              <tbody>{stats.lista.map((r) => (
                <tr key={`${r.servicio}|${r.nuevo}`}><td className="amg-mono">{r.servicio}</td><td>{r.depto}</td><td>{r.anterior}</td><td><b>{r.nuevo}</b></td><td className="amg-mono">{r.productos}</td><td style={{ color: "var(--text-dim)" }}>{r.tipo}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {stats && !vacio && <div style={{ marginBottom: 12 }}><b>{stats.servicios}</b> servicio(s) con cambio de técnico.</div>}
        {vacio && registros && <div className="amg-alert" style={{ marginBottom: 12 }}>No hay cambios de técnico en Carga para el {ui.fmtDate(fecha)}. Solo se detectan los registros enviados desde Asignación y reasignados en Carga después de esta actualización.</div>}
        {stats && stats.sinCodigo.length > 0 && (
          <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> {stats.sinCodigo.length} técnico(s) no tienen <b>Usuario Extreme</b> en Personal y su código saldrá vacío: {stats.sinCodigo.join(", ")}.</div>
        )}
        {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
        {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

        <div style={{ marginBottom: 10 }}>
          <b>Destinatarios</b> <span style={{ color: "var(--text-faint)", fontSize: 12 }}>(los mismos de Maestros → Cambio de técnico)</span>
          {!cfg ? <div style={{ color: "var(--text-faint)" }}>Cargando...</div> : activos.length === 0 ? (
            <div style={{ color: "var(--red)" }}>No hay destinatarios activos. El administrador debe agregarlos en Maestros → Cambio de técnico. Aun así puedes descargar el Excel.</div>
          ) : (
            <div style={{ fontSize: 12.5 }}><div><b>Para:</b> {para.length ? para.join(", ") : "—"}</div>{cc.length > 0 && <div><b>CC:</b> {cc.join(", ")}</div>}</div>
          )}
        </div>
        <label className="amg-label">Asunto</label>
        <input className="amg-input" value={asunto} onChange={(e) => setAsunto(e.target.value)} style={{ marginBottom: 10 }} />
        <label className="amg-label">Mensaje</label>
        <textarea className="amg-textarea" rows={5} value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Los enlaces de correo no pueden llevar archivos adjuntos: el Excel se descarga y lo adjuntas tú antes de enviar.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <button className="amg-btn primary" disabled={!activos.length || vacio} onClick={() => enviar("gmail")}>Descargar y abrir Gmail</button>
          <button className="amg-btn" disabled={!activos.length || vacio} onClick={() => enviar("mailto")}>Descargar y abrir mi programa de correo</button>
          <button className="amg-btn" disabled={vacio} onClick={() => { const n = descargar(); setMsg(`Se descargó ${n}.`); }}><Download size={14} /> Solo descargar el Excel</button>
          <button className="amg-btn" disabled={!activos.length} onClick={copiar}>Copiar destinatarios</button>
        </div>
      </div>
    </ui.Modal>
  );
}
