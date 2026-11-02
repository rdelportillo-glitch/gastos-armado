import { useState, useEffect, useMemo } from "react";
import { Check, AlertTriangle, Download, RotateCcw } from "lucide-react";
import * as D from "./lib/asignacion/data";
import { loadCoordinadores, coordinadorDe, cfgEfectiva } from "./lib/coordinadores";
import { buildTechChangeWorkbook, mailLinks, downloadWorkbook } from "./lib/asignacion/outputs";

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };

/* ------------------------ Cambio de técnico (Excel + correo) ------------------------ */

// Un solo Excel y un solo correo por fecha. Se arma con lo que ya está en Carga (leído de la base al abrir), así junta lo que enviaron
// todos los coordinadores aunque hayan trabajado a la vez en equipos distintos. Se genera DESPUÉS de enviar a Carga.
export default function CambioTecnicoModal({ ui, db, fecha, onClose, onFecha }) {
  const [cfg, setCfg] = useState(null);
  const [envio, setEnvio] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [asunto, setAsunto] = useState("");
  // Coordinadores (Maestros → Coordinadores) y, donde falta, el más repetido en Personal: para contar lo enviado por coordinador.
  const [coordRaw, setCoordRaw] = useState(null);
  useEffect(() => { loadCoordinadores().then((r) => setCoordRaw(r.cfg)).catch(() => setCoordRaw({ coordinadores: [], asignaciones: [] })); }, []);
  const coordCfg = useMemo(() => cfgEfectiva(coordRaw, db.technicians), [coordRaw, db.technicians]);

  const stats = useMemo(() => (envio ? buildTechChangeWorkbook({ asignados: envio.asignados, devueltos: envio.devueltos, technicians: db.technicians, fecha }) : null), [envio, db.technicians, fecha]);

  const cargar = () => {
    setCargando(true); setError("");
    D.loadEnvioDelDia(fecha).then(setEnvio).catch((e) => setError(`No se pudo leer lo enviado a Carga: ${e.message}`)).finally(() => setCargando(false));
  };
  useEffect(() => { cargar(); }, [fecha]);
  useEffect(() => { D.loadChangeEmailConfig().then(setCfg).catch((e) => { setError(`No se pudieron leer los destinatarios: ${e.message}`); setCfg(D.CAMBIO_EMAIL_DEFAULT); }); }, []);
  // Asunto y mensaje con los datos de lo enviado; se recalculan cada vez que cambia lo enviado.
  useEffect(() => {
    if (!cfg || !stats) return;
    const sub = (t) => String(t || "").replace(/\{fecha\}/g, ui.fmtDate(stats.fechaBase)).replace(/\{asignados\}/g, stats.asignados).replace(/\{devueltos\}/g, stats.devueltos);
    setAsunto(sub(cfg.asunto)); setMensaje(sub(cfg.mensaje));
  }, [cfg, stats && stats.fechaBase, stats && stats.asignados, stats && stats.devueltos]);

  const activos = ((cfg && cfg.destinatarios) || []).filter((d) => d.activo !== false && d.correo);
  const para = activos.filter((d) => d.tipo !== "CC").map((d) => d.correo);
  const cc = activos.filter((d) => d.tipo === "CC").map((d) => d.correo);

  // Lo enviado por coordinador (según el departamento de cada servicio).
  const porCoord = useMemo(() => {
    if (!envio) return [];
    const nombres = ((coordCfg && coordCfg.coordinadores) || []).filter((c) => c.activo !== false).map((c) => c.nombre);
    const mapa = new Map([...nombres, "Sin coordinador"].map((n) => [n, { n, asig: new Set(), dev: new Set() }]));
    const dePor = (s) => (coordinadorDe(coordCfg, (s.asig && s.asig.depto) || s.departamentoExterno) || "Sin coordinador");
    envio.asignados.forEach((s) => (mapa.get(dePor(s)) || mapa.get("Sin coordinador")).asig.add(String(s.servicioExterno)));
    envio.devueltos.forEach((s) => (mapa.get(dePor(s)) || mapa.get("Sin coordinador")).dev.add(String(s.servicioExterno)));
    return [...mapa.values()].filter((g) => g.n !== "Sin coordinador" || g.asig.size || g.dev.size);
  }, [envio, coordCfg]);
  const sinEnvio = porCoord.filter((g) => g.n !== "Sin coordinador" && !g.asig.size && !g.dev.size).map((g) => g.n);

  const descargar = () => { downloadWorkbook(stats.wb, stats.name); return stats.name; };
  const enviar = (via) => {
    const name = descargar();
    const links = mailLinks({ para, cc, subject: asunto, body: mensaje });
    if (via === "gmail") window.open(links.gmail, "_blank", "noopener");
    else window.location.href = links.mailto;
    setMsg(`Se descargó ${name}. Se abrió el correo con destinatarios, asunto y mensaje: adjunta ese archivo antes de enviar.`);
  };
  const copiar = async () => { try { await navigator.clipboard.writeText([...para, ...cc].join(", ")); setMsg("Destinatarios copiados."); } catch (e) { setError("No se pudo copiar."); } };
  const vacio = !stats || (stats.asignados === 0 && stats.devueltos === 0);

  return (
    <ui.Modal title={`Cambio de técnico · ${ui.fmtDate(fecha)}`} onClose={onClose} width={720}
      footer={<button className="amg-btn" onClick={onClose}>Cerrar</button>}>
      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        {onFecha && <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}><label className="amg-label" style={{ margin: 0 }}>Fecha de la asignación</label><input type="date" className="amg-input" style={{ width: 150 }} value={fecha} onChange={(e) => e.target.value && onFecha(e.target.value)} /></div>}
        <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
          <b>Un solo Excel y un solo correo</b> con lo que todos los coordinadores enviaron a Carga para el <b>{ui.fmtDate(fecha)}</b>, por <b>servicio</b> (no por producto): hoja <b>CAMBIOS DE TECNICOS</b> (código = usuario Extreme del técnico) y hoja <b>DEVUELTO</b> con lo que quedó sin asignar (código ALMACEN). Genéralo cuando todos hayan enviado a Carga.
          <div style={{ marginTop: 6 }}><button className="amg-btn" disabled={cargando} onClick={cargar}><RotateCcw size={13} /> {cargando ? "Leyendo..." : "Actualizar lo enviado"}</button></div>
        </div>
        {cargando && !envio && <div style={{ color: "var(--text-faint)", marginBottom: 12 }}>Leyendo lo enviado a Carga...</div>}
        {envio && (
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table className="amg-table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Coordinador</th><th>Servicios enviados con técnico</th><th>Devueltos (sin asignar)</th></tr></thead>
              <tbody>
                {porCoord.map((g) => <tr key={g.n}><td>{g.n}</td><td className="amg-mono">{g.asig.size}</td><td className="amg-mono">{g.dev.size}</td></tr>)}
                <tr style={{ fontWeight: 700 }}><td>Total</td><td className="amg-mono">{stats ? stats.asignados : 0}</td><td className="amg-mono">{stats ? stats.devueltos : 0}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        {sinEnvio.length > 0 && !vacio && (
          <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> Todavía no hay envíos a Carga de: {sinEnvio.join(", ")}. Si ellos aún están asignando, espera a que envíen para generar un solo documento.</div>
        )}
        {vacio && envio && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> No hay nada enviado a Carga para el {ui.fmtDate(fecha)}. Primero confirma la asignación con "Confirmar y enviar a Carga".</div>}
        {stats && stats.sinCodigo.length > 0 && (
          <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> {stats.sinCodigo.length} técnico(s) no tienen <b>Usuario Extreme</b> en Personal y su código saldrá vacío: {stats.sinCodigo.join(", ")}. Corrígelo en Personal y vuelve a generar el archivo.</div>
        )}
        {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
        {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

        <div style={{ marginBottom: 10 }}>
          <b>Destinatarios</b> <span style={{ color: "var(--text-faint)", fontSize: 12 }}>(se administran en Maestros → Cambio de técnico)</span>
          {!cfg ? <div style={{ color: "var(--text-faint)" }}>Cargando...</div> : activos.length === 0 ? (
            <div style={{ color: "var(--red)" }}>No hay destinatarios activos. El administrador debe agregarlos en Maestros → Cambio de técnico. Aun así puedes descargar el Excel.</div>
          ) : (
            <div style={{ fontSize: 12.5 }}>
              <div><b>Para:</b> {para.length ? para.join(", ") : "—"}</div>
              {cc.length > 0 && <div><b>CC:</b> {cc.join(", ")}</div>}
            </div>
          )}
        </div>
        <label className="amg-label">Asunto</label>
        <input className="amg-input" value={asunto} onChange={(e) => setAsunto(e.target.value)} style={{ marginBottom: 10 }} />
        <label className="amg-label">Mensaje</label>
        <textarea className="amg-textarea" rows={6} value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
          Los enlaces de correo no pueden llevar archivos adjuntos: el Excel se descarga y lo adjuntas tú antes de enviar.
        </div>
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
