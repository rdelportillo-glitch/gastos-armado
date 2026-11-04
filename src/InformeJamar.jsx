import { useState, useEffect, useMemo } from "react";
import { Download, Mail, AlertTriangle, Check, Plus, RotateCcw, Ban } from "lucide-react";
import { fetchHistory, loadRegionInfo } from "./lib/asignacion/history";
import { filasCsvDeHistorico } from "./lib/asignacion/csvCarga";
import { useZonaCoord } from "./lib/useCoordinadores";
import { mailLinks, downloadBlob } from "./lib/asignacion/outputs";
import { calcularInforme, buildInformeJamarPdf, loadInformeEmailConfig, saveInformeEmailConfig, INFORME_EMAIL_DEFAULT, fechaCorta, fmtPct } from "./lib/informeJamar";

/* ============================================================================
   INFORME DE CIERRE – JAMAR (Reportes)
   Se arma con el histórico de asignación del día (la fila de cada producto del CSV de Carga): resultado general, volumen por departamento, causas de lo no armado,
   tipo de servicio, cancelaciones, pendientes y cierre operativo. Se descarga en PDF o se envía por correo (destinatarios y texto en Maestros → Informe Jamar).
============================================================================ */

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const COLOR = { armado: "#00b050", noArmado: "#ed7d31", cancelado: "#9b2c90", garantia: "#f5b800" };

export function ReporteInformeJamar({ db, session, ui }) {
  const hoy = ui.todayISO();
  const [fecha, setFecha] = useState(sumarDias(hoy, -1));
  const [empresa, setEmpresa] = useState("JAMAR");
  const [rows, setRows] = useState([]);
  const [cfg, setCfg] = useState(INFORME_EMAIL_DEFAULT);
  const [regionInfo, setRegionInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const zona = useZonaCoord(db);
  const canEnviar = session.role === "admin" || session.role === "operador";

  useEffect(() => { loadRegionInfo().then(setRegionInfo).catch(() => {}); loadInformeEmailConfig().then(setCfg).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    fetchHistory({ from: fecha, to: fecha }).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) { setRows([]); setError(e.message); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [fecha]);

  const filas = useMemo(() => filasCsvDeHistorico({ rows, services: db.services, technicians: db.technicians, causales: db.causales, regionLabel: (r) => (regionInfo ? regionInfo.label(r) : ""), coordDe: (d) => zona.coordDe(d) }),
    [rows, db.services, db.technicians, db.causales, regionInfo, zona.nombres]);
  const empresas = useMemo(() => calcularInforme(filas).empresas, [filas]);
  const empresaEf = empresas.some((e) => plano(e) === plano(empresa)) ? empresa : ""; // si el día no trae esa empresa, se muestran todas
  const info = useMemo(() => calcularInforme(filas, { empresa: empresaEf }), [filas, empresaEf]);

  // Productos del día que siguen en Carga sin causal (sin gestionar): los pendientes del informe.
  const pendientes = useMemo(() => (db.services || []).filter((s) => s.servicioExterno && s.date === fecha && !s.finalizedAt && (s.estadoGestion || "Realizado") !== "Pendiente" && !s.causalAuditada && !s.causalExtreme && !(s.asig && (s.asig.cancelada || s.asig.anulada)) && (!empresaEf || plano(s.asig && s.asig.empresa) === plano(empresaEf)))
    .map((s) => ({ servicio: String(s.servicioExterno), producto: s.productoExternoNombre || "-", depto: s.departamentoExterno || "-" })), [db.services, fecha, empresaEf]);

  // Texto del correo con los datos del informe.
  const sub = (t) => String(t || "").replace(/\{fecha\}/g, fechaCorta(fecha)).replace(/\{total\}/g, info.total).replace(/\{armados\}/g, info.armados).replace(/\{noArmados\}/g, info.noArmados)
    .replace(/\{cancelados\}/g, info.cancelados).replace(/\{efectividad\}/g, (Math.round(info.pctArmados * 10) / 10).toFixed(1));
  useEffect(() => { setAsunto(sub(cfg.asunto)); setMensaje(sub(cfg.mensaje)); }, [cfg, fecha, info.total, info.armados, info.noArmados, info.cancelados]);

  const activos = (cfg.destinatarios || []).filter((d) => d.activo !== false && d.correo);
  const para = activos.filter((d) => d.tipo !== "CC").map((d) => d.correo), cc = activos.filter((d) => d.tipo === "CC").map((d) => d.correo);
  const vacio = info.total === 0;

  const pdf = async () => {
    const blob = await buildInformeJamarPdf({ info, fecha, pendientes });
    const [y, m, d] = fecha.split("-");
    downloadBlob(blob, `Informe_Cierre_Jamar_${d}-${m}-${y}.pdf`);
    return `Informe_Cierre_Jamar_${d}-${m}-${y}.pdf`;
  };
  const descargar = async () => { setBusy(true); setError(""); setMsg(""); try { const n = await pdf(); setMsg(`Se descargó ${n}.`); } catch (e) { setError(`No se pudo generar el PDF: ${e.message}`); } setBusy(false); };
  const enviar = async (via) => {
    setBusy(true); setError(""); setMsg("");
    try {
      const n = await pdf();
      const links = mailLinks({ para, cc, subject: asunto, body: mensaje });
      if (via === "gmail") window.open(links.gmail, "_blank", "noopener"); else window.location.href = links.mailto;
      setMsg(`Se descargó ${n}. Se abrió el correo con destinatarios, asunto y mensaje: adjunta ese archivo antes de enviar.`);
    } catch (e) { setError(`No se pudo generar el PDF: ${e.message}`); }
    setBusy(false);
  };
  const copiar = async () => { try { await navigator.clipboard.writeText([...para, ...cc].join(", ")); setMsg("Destinatarios copiados."); } catch (e) { setError("No se pudo copiar."); } };

  const Tarjeta = ({ valor, titulo, sub, color }) => (
    <div style={{ textAlign: "center", padding: "10px 6px", borderRight: "1px solid var(--border)" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{valor}</div><div style={{ fontSize: 12, fontWeight: 600 }}>{titulo}</div><div style={{ fontSize: 11, color: "var(--text-faint)" }}>{sub}</div>
    </div>
  );

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 600 }}>Informe de cierre – Jamar</div>
        <label className="amg-label" style={{ margin: 0 }}>Corte operativo</label>
        <input type="date" className="amg-input" style={{ width: 150 }} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <button className="amg-btn" onClick={() => setFecha(sumarDias(hoy, -1))}>Ayer</button>
        <button className="amg-btn" onClick={() => setFecha(hoy)}>Hoy</button>
        {empresas.length > 1 && (
          <select className="amg-select" style={{ width: 170 }} value={empresaEf} onChange={(e) => setEmpresa(e.target.value)}><option value="">Todas las empresas</option>{empresas.map((e) => <option key={e} value={e}>{e}</option>)}</select>
        )}
        <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={busy || vacio} onClick={descargar}><Download size={14} /> {busy ? "Generando..." : "Descargar PDF"}</button>
        {canEnviar && <button className="amg-btn primary" disabled={busy || vacio || !activos.length} title={activos.length ? "Descarga el PDF y abre el correo con los destinatarios de Maestros → Informe Jamar" : "Agrega destinatarios en Maestros → Informe Jamar"} onClick={() => enviar("gmail")}><Mail size={14} /> Enviar por correo</button>}
      </div>
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      {loading && <div style={{ color: "var(--text-faint)", marginBottom: 10 }}>Leyendo el histórico...</div>}
      {!loading && vacio && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>No hay productos finalizados el {ui.fmtDate(fecha)}. El informe sale del histórico: finaliza ese día en Carga.</div>}

      {!vacio && (
        <>
          <div className="amg-card" style={{ borderTop: "3px solid var(--accent)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", marginBottom: 12 }}>
            <Tarjeta valor={info.total} titulo="Total registros" sub="productos" color="var(--text)" />
            <Tarjeta valor={info.armados} titulo="Armados" sub={fmtPct(info.pctArmados)} color={COLOR.armado} />
            <Tarjeta valor={info.noArmados} titulo="No armados" sub={fmtPct(info.pctNoArmados)} color={COLOR.noArmado} />
            <Tarjeta valor={info.cancelados} titulo="Cancelados" sub={fmtPct(info.pctCancelados)} color={COLOR.cancelado} />
            <Tarjeta valor={pendientes.length} titulo="Pendientes" sub={pendientes.length ? "por gestionar" : "operación al día"} color={pendientes.length ? COLOR.noArmado : COLOR.armado} />
            <Tarjeta valor={info.garantias} titulo="Garantías" sub="con novedad" color={COLOR.garantia} />
          </div>
          <div style={{ display: "flex", height: 28, borderRadius: 4, overflow: "hidden", marginBottom: 14, color: "#fff", fontSize: 12.5, fontWeight: 600 }}>
            {[[info.armados, COLOR.armado, `Armado ${info.armados} · ${fmtPct(info.pctArmados)}`], [info.noArmados, COLOR.noArmado, `No armado ${info.noArmados} · ${fmtPct(info.pctNoArmados)}`], [info.cancelados, COLOR.cancelado, String(info.cancelados)]]
              .map(([n, c, t], i) => n ? <div key={i} style={{ width: `${(n / info.total) * 100}%`, background: c, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap" }}>{t}</div> : null)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 14 }}>
            <div className="amg-card" style={{ padding: 12, overflowX: "auto" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>2. Volumen por departamento</div>
              <table className="amg-table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Departamento</th><th>Total</th><th>Particip.</th><th>Armado</th><th>No armado</th><th>Cancelado</th><th>% Armado</th></tr></thead>
                <tbody>
                  {info.listaDeptos.map((d) => <tr key={d.nombre}><td>{d.nombre}</td><td className="amg-mono">{d.total}</td><td className="amg-mono">{fmtPct(d.particip)}</td><td className="amg-mono">{d.armado}</td><td className="amg-mono">{d.noArmado}</td><td className="amg-mono">{d.cancelado}</td><td className="amg-mono">{fmtPct(d.pctArmado)}</td></tr>)}
                  <tr style={{ fontWeight: 700, background: "var(--panel-2)" }}><td>Total</td><td className="amg-mono">{info.total}</td><td className="amg-mono">100%</td><td className="amg-mono">{info.armados}</td><td className="amg-mono">{info.noArmados}</td><td className="amg-mono">{info.cancelados}</td><td className="amg-mono">{fmtPct(info.pctArmados)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="amg-card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>3. Causas de productos no armados ({info.noArmados})</div>
              {info.listaCausas.map((c) => (
                <div key={c.nombre} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 3 }}>
                  <div style={{ width: 210, textAlign: "right" }}>{c.nombre}</div>
                  <div style={{ background: COLOR.noArmado, height: 12, width: `${Math.max(2, (c.n / info.listaCausas[0].n) * 55)}%` }} />
                  <b>{c.n} · {fmtPct(c.particip)}</b>
                </div>
              ))}
              {info.listaCausas.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 12.5 }}>No hay productos no armados.</div>}
              {info.sinCausal.length > 0 && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Sin causal registrada ({info.sinCausal.length}): servicios {[...new Set(info.sinCausal)].join(", ")}.</div>}
            </div>
            <div className="amg-card" style={{ padding: 12, overflowX: "auto" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>4. Desglose por tipo de servicio (observación)</div>
              <table className="amg-table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Tipo</th><th>Total</th><th>Particip.</th><th>Armado</th><th>No armado</th><th>Cancelado</th></tr></thead>
                <tbody>{info.listaTipos.map((t) => <tr key={t.nombre}><td>{t.nombre}</td><td className="amg-mono">{t.total}</td><td className="amg-mono">{fmtPct(t.particip)}</td><td className="amg-mono">{t.armado}</td><td className="amg-mono">{t.noArmado}</td><td className="amg-mono">{t.cancelado}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="amg-card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>5. Cancelaciones por técnico ({info.cancelados})</div>
              {info.listaCancelaciones.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 3 }}>
                  <div style={{ width: 250, textAlign: "right" }}>{c.quien} · {c.motivo}</div>
                  <div style={{ background: COLOR.cancelado, height: 12, width: `${Math.max(2, (c.n / info.listaCancelaciones[0].n) * 45)}%` }} /><b>{c.n} · {fmtPct(c.particip)}</b>
                </div>
              ))}
              {info.listaCancelaciones.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 12.5 }}>No hay productos cancelados.</div>}
            </div>
          </div>
          <div className="amg-card" style={{ padding: 12, marginTop: 14, fontSize: 12.5, lineHeight: 1.6 }}>
            <div><b>6. Productos pendientes ({pendientes.length}):</b> {pendientes.length ? pendientes.map((p) => p.servicio).join(", ") : "sin productos pendientes: la operación quedó al día."}</div>
            <div><b>7. Primer piso:</b> {info.primerPiso.length ? `${info.primerPiso.length} registro(s): servicios ${[...new Set(info.primerPiso)].join(", ")}.` : "no se identifican registros con Primer piso = SI ni diagnósticos que indiquen primer piso."}</div>
            <div><b>Cierre:</b> la operación del {fechaCorta(fecha).slice(0, 5)} cerró con <b>{fmtPct(info.pctArmados)}</b> de efectividad de armado sobre {info.total} productos.</div>
          </div>

          {canEnviar && (
            <div className="amg-card" style={{ padding: 12, marginTop: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Correo <span style={{ fontWeight: 400, color: "var(--text-faint)", fontSize: 12 }}>(destinatarios y texto en Maestros → Informe Jamar)</span></div>
              {activos.length === 0
                ? <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 8 }}>No hay destinatarios activos. El administrador debe agregarlos en Maestros → Informe Jamar. Aun así puedes descargar el PDF.</div>
                : <div style={{ fontSize: 12.5, marginBottom: 8 }}><div><b>Para:</b> {para.length ? para.join(", ") : "—"}</div>{cc.length > 0 && <div><b>CC:</b> {cc.join(", ")}</div>}</div>}
              <label className="amg-label">Asunto</label>
              <input className="amg-input" value={asunto} onChange={(e) => setAsunto(e.target.value)} style={{ marginBottom: 8 }} />
              <label className="amg-label">Mensaje</label>
              <textarea className="amg-textarea" rows={5} value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Los enlaces de correo no pueden llevar archivos adjuntos: el PDF se descarga y lo adjuntas tú antes de enviar.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button className="amg-btn primary" disabled={busy || !activos.length} onClick={() => enviar("gmail")}>Descargar y abrir Gmail</button>
                <button className="amg-btn" disabled={busy || !activos.length} onClick={() => enviar("mailto")}>Descargar y abrir mi programa de correo</button>
                <button className="amg-btn" disabled={!activos.length} onClick={copiar}>Copiar destinatarios</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------- Maestros → Informe Jamar --------------------------- */

export function MaestroInformeJamar({ db, persist, addAudit, session, ui }) {
  const [cfg, setCfg] = useState(null);
  const [nuevo, setNuevo] = useState({ nombre: "", correo: "", tipo: "Para" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { loadInformeEmailConfig().then(setCfg).catch((e) => { setError(e.message); setCfg(INFORME_EMAIL_DEFAULT); }); }, []);
  if (!cfg) return <div style={{ color: "var(--text-faint)" }}>Cargando...</div>;

  const valido = (c) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(c || "").trim());
  const change = (next) => { setCfg(next); setDirty(true); setMsg(""); };
  const setDest = (id, patch) => change({ ...cfg, destinatarios: cfg.destinatarios.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const agregar = () => {
    const correo = nuevo.correo.trim().toLowerCase();
    if (!valido(correo)) { setError("Escribe un correo válido."); return; }
    if (cfg.destinatarios.some((d) => d.correo.toLowerCase() === correo)) { setError("Ese correo ya está en la lista."); return; }
    setError("");
    change({ ...cfg, destinatarios: [...cfg.destinatarios, { id: ui.uid("dst"), nombre: nuevo.nombre.trim(), correo, tipo: nuevo.tipo, activo: true }] });
    setNuevo({ nombre: "", correo: "", tipo: nuevo.tipo });
  };
  const guardar = async () => {
    const malos = cfg.destinatarios.filter((d) => !valido(d.correo));
    if (malos.length) { setError(`Hay correos inválidos: ${malos.map((d) => d.correo || "(vacío)").join(", ")}`); return; }
    setError("");
    try {
      await saveInformeEmailConfig(cfg, session.id);
      persist(addAudit(db, { userId: session.id, action: "Cambio de destinatarios (Informe de cierre Jamar)", record: "informe_jamar_email", oldValue: "-", newValue: `${cfg.destinatarios.filter((d) => d.activo !== false).length} destinatarios activos` }));
      setDirty(false); setMsg("Guardado para todo el equipo.");
    } catch (e) { setError(e.message); }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.6 }}>
        Personas a las que se envía el <b>Informe de cierre – Jamar</b> (Reportes → Informe de cierre Jamar). El botón "Enviar por correo" descarga el PDF y abre el correo ya redactado con estos destinatarios; solo adjuntas el archivo.
      </div>
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      <div className="amg-card" style={{ overflowX: "auto", marginBottom: 12 }}>
        <table className="amg-table">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Envío</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {cfg.destinatarios.map((d) => (
              <tr key={d.id} style={d.activo === false ? { opacity: 0.55 } : undefined}>
                <td><input className="amg-input" style={{ padding: "4px 6px" }} value={d.nombre} onChange={(e) => setDest(d.id, { nombre: e.target.value })} /></td>
                <td><input className="amg-input" style={{ padding: "4px 6px", borderColor: valido(d.correo) ? undefined : "var(--red)" }} value={d.correo} onChange={(e) => setDest(d.id, { correo: e.target.value })} /></td>
                <td><select className="amg-select" style={{ width: 90 }} value={d.tipo || "Para"} onChange={(e) => setDest(d.id, { tipo: e.target.value })}><option>Para</option><option>CC</option></select></td>
                <td><ui.Badge text={d.activo === false ? "Inactivo" : "Activo"} color={d.activo === false ? "gray" : "green"} /></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="amg-btn ghost" style={{ padding: 4 }} title={d.activo === false ? "Reactivar" : "Inactivar (deja de recibir el correo)"} onClick={() => setDest(d.id, { activo: d.activo === false })}>{d.activo === false ? <RotateCcw size={13} color="var(--green)" /> : <Ban size={13} color="var(--red)" />}</button>
                  <button className="amg-btn ghost" style={{ padding: 4, fontSize: 11 }} title="Quitar de la lista" onClick={() => change({ ...cfg, destinatarios: cfg.destinatarios.filter((x) => x.id !== d.id) })}>Quitar</button>
                </td>
              </tr>
            ))}
            {cfg.destinatarios.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-faint)", padding: 16 }}>Aún no hay destinatarios. Agrega el primero abajo.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="amg-input" style={{ width: 200 }} placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        <input className="amg-input" style={{ width: 260 }} placeholder="correo@empresa.com" value={nuevo.correo} onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregar()} />
        <select className="amg-select" style={{ width: 90 }} value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}><option>Para</option><option>CC</option></select>
        <button className="amg-btn" onClick={agregar}><Plus size={14} /> Agregar</button>
      </div>
      <div className="amg-card" style={{ padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Texto del correo</div>
        <label className="amg-label">Asunto</label>
        <input className="amg-input" value={cfg.asunto} onChange={(e) => change({ ...cfg, asunto: e.target.value })} style={{ marginBottom: 10 }} />
        <label className="amg-label">Mensaje</label>
        <textarea className="amg-textarea" rows={6} value={cfg.mensaje} onChange={(e) => change({ ...cfg, mensaje: e.target.value })} />
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Se reemplazan solos: <code>{"{fecha}"}</code> (corte operativo), <code>{"{total}"}</code>, <code>{"{armados}"}</code>, <code>{"{noArmados}"}</code>, <code>{"{cancelados}"}</code> y <code>{"{efectividad}"}</code> (% de armado).</div>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <button className="amg-btn primary" disabled={!dirty} onClick={guardar}><Check size={14} /> Guardar</button>
        {dirty && <span style={{ fontSize: 12, color: "var(--accent)" }}>Hay cambios sin guardar.</span>}
      </div>
    </div>
  );
}
