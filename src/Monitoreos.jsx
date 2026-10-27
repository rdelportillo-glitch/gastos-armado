import { useState, useEffect, useMemo } from "react";
import { Check, AlertTriangle, Plus, Download, Eye, Pencil, Ban, RotateCcw, ChevronDown, ChevronRight, X } from "lucide-react";
import * as M from "./lib/monitoreos/monData";
import { useZonaCoord, SIN_COORD } from "./lib/useCoordinadores";

/* ============================================================================
   MONITOREOS · registro de monitoreos digitales y presenciales
   Un mismo módulo para los dos canales (prop `canal`). Los componentes, subcomponentes, pesos, semáforo y errores críticos vienen de la
   configuración (Maestros → Monitoreos). El resultado se calcula solo: un componente es NEGATIVO si algún subcomponente es "No Cumple";
   suma su peso si es POSITIVO; un error crítico lleva la calificación a 0.
============================================================================ */

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };
const COLOR_RESPUESTA = { Cumple: "#3F9D6E", "No Cumple": "#C0463A", "N/A": "#8A7F70" };
const COLOR_RESULTADO = { POSITIVO: "green", NEGATIVO: "red", PENDIENTE: "gray" };

export default function MonitoreosModule({ db, session, persist, addAudit, ui, canal }) {
  const canEdit = session.role === "admin" || session.role === "operador";
  const hoy = ui.todayISO();
  const nombre = M.NOMBRE_CANAL[canal];
  const [cfg, setCfg] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [vista, setVista] = useState({ tipo: "lista" }); // lista | form { record? } | ver { record }
  const [anular, setAnular] = useState(null);
  const [f, setF] = useState({ q: "", desde: "", hasta: "", depto: "", coord: "", semaforo: "", estado: "Activo" });
  const zona = useZonaCoord(db, true);

  const recargar = async () => {
    setLoading(true); setError("");
    try { const [c, r] = await Promise.all([M.loadMonConfig(), M.listRecords({ canal })]); setCfg(c); setRecords(r); }
    catch (e) { setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL de Monitoreos (sql/36).`); if (!cfg) setCfg(M.configInicial()); }
    setLoading(false);
  };
  useEffect(() => { setVista({ tipo: "lista" }); recargar(); }, [canal]);

  const deptos = useMemo(() => [...new Set(records.map((r) => r.department).filter(Boolean))].sort(), [records]);
  const rows = useMemo(() => records.filter((r) => {
    const q = f.q.trim().toLowerCase();
    return (!f.estado || r.status === f.estado)
      && (!q || `${r.record_no} ${r.technician_name || ""} ${r.service_no || ""} ${r.auditor_name || ""}`.toLowerCase().includes(q))
      && (!f.desde || r.audit_date >= f.desde) && (!f.hasta || r.audit_date <= f.hasta)
      && zona.pasa(r.department, f.depto, f.coord) && (!f.semaforo || r.traffic_light === f.semaforo);
  }), [records, f, zona.nombres]);

  const activos = rows.filter((r) => r.status === "Activo");
  const prom = activos.length ? activos.reduce((s, r) => s + Number(r.score || 0), 0) / activos.length : 0;
  const nCrit = activos.filter((r) => r.critical_error).length;
  const nRojo = activos.filter((r) => r.traffic_light === "Rojo").length;

  const audit = (accion, registro, detalle) => persist(addAudit(db, { userId: session.id, action: accion, record: registro, oldValue: "-", newValue: detalle }));

  const exportar = () => {
    const comps = cfg ? M.componentesActivos(cfg, canal) : [];
    ui.downloadCSV(`${nombre.toLowerCase().replace(/\s+/g, "_")}_${hoy}.csv`,
      ["ID", "Fecha", M.ROL_AUDITOR[canal], "Técnico", "Departamento", "Coordinador", "Ciudad", "N° Servicio", ...(canal === "Digital" ? ["Cantidad productos"] : ["Fecha servicio original"]),
        ...comps.flatMap((c) => [`${c.codigo} resultado`, `${c.codigo} puntaje (${c.peso}%)`]), "Error crítico", "Tipo de error crítico", "Calificación final (%)", "Semáforo", "Estado", "Observaciones"],
      rows.map((r) => [r.record_no, ui.fmtDate(r.audit_date), r.auditor_name || "", r.technician_name || "", r.department || "", r.coordinator || "", r.city || "", r.service_no || "",
        canal === "Digital" ? r.products_count ?? "" : (r.original_service_date ? ui.fmtDate(r.original_service_date) : ""),
        ...comps.flatMap((c) => { const x = (r.results || []).find((y) => y.id === c.id); return [x ? x.resultado : "", x ? x.puntaje : ""]; }),
        r.critical_error ? "SI" : "NO", r.critical_type || "", r.score, r.traffic_light || "", r.status, r.observations || ""]));
  };

  if (!cfg) return <div style={{ color: "var(--text-faint)" }}>{error ? <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div> : "Cargando..."}</div>;

  if (vista.tipo === "form" || vista.tipo === "ver") {
    return <MonitoreoForm key={vista.record ? vista.record.id : "nuevo"} ui={ui} db={db} cfg={cfg} canal={canal} session={session} zona={zona} hoy={hoy} record={vista.record || null} soloLectura={vista.tipo === "ver"}
      onCancel={() => setVista({ tipo: "lista" })} onEditar={() => setVista({ tipo: "form", record: vista.record })}
      onSaved={async (txt, r, nuevo) => { setVista({ tipo: "lista" }); setMsg(txt); await audit(`${nuevo ? "Registro" : "Edición"} de ${nombre.toLowerCase()}`, r.record_no, `Calificación ${r.score}% · ${r.traffic_light}`); await recargar(); }} />;
  }

  return (
    <div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Monitoreos" value={activos.length} sub="según los filtros" accent />
        <ui.StatCard label="Calificación promedio" value={activos.length ? M.fmtPct(prom) : "-"} sub={activos.length ? M.semaforoDe(cfg, prom).nombre : ""} />
        <ui.StatCard label="Con error crítico" value={nCrit} sub={activos.length ? M.fmtPct((nCrit / activos.length) * 100) : ""} />
        <ui.StatCard label="En semáforo rojo" value={nRojo} sub={activos.length ? M.fmtPct((nRojo / activos.length) * 100) : ""} />
      </div>

      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input className="amg-input" style={{ width: 220 }} placeholder="Buscar ID, técnico, servicio..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <label style={{ fontSize: 12.5 }}>Desde <input type="date" className="amg-input" style={{ width: 145 }} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
        <label style={{ fontSize: 12.5 }}>hasta <input type="date" className="amg-input" style={{ width: 145 }} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
        <select className="amg-select" style={{ width: 170 }} value={f.depto} onChange={(e) => setF({ ...f, depto: e.target.value })}><option value="">Todos los departamentos</option>{deptos.map((d) => <option key={d}>{d}</option>)}</select>
        <select className="amg-select" style={{ width: 190 }} value={f.coord} onChange={(e) => setF({ ...f, coord: e.target.value })}><option value="">Todos los coordinadores</option>{zona.nombres.map((n) => <option key={n} value={n}>{n}</option>)}<option value={SIN_COORD}>Sin coordinador</option></select>
        <select className="amg-select" style={{ width: 140 }} value={f.semaforo} onChange={(e) => setF({ ...f, semaforo: e.target.value })}><option value="">Todo semáforo</option>{(cfg.semaforo || []).map((s) => <option key={s.nombre}>{s.nombre}</option>)}</select>
        <select className="amg-select" style={{ width: 130 }} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="Activo">Activos</option><option value="Anulado">Anulados</option><option value="">Todos</option></select>
        <button className="amg-btn" onClick={recargar} disabled={loading}><RotateCcw size={13} /> {loading ? "Actualizando..." : "Actualizar"}</button>
        <button className="amg-btn" onClick={exportar}><Download size={14} /> Exportar CSV</button>
        {canEdit && <button className="amg-btn primary" style={{ marginLeft: "auto" }} onClick={() => setVista({ tipo: "form" })}><Plus size={14} /> Nuevo {nombre.toLowerCase()}</button>}
      </div>

      <div className="amg-card" style={{ overflow: "auto", maxHeight: "calc(100vh - 380px)" }}>
        <table className="amg-table compact">
          <thead><tr><th>ID</th><th>Fecha</th><th>Técnico</th><th>Departamento</th><th>Servicio</th><th>{M.ROL_AUDITOR[canal]}</th><th>Calificación</th><th>Componentes</th><th></th></tr></thead>
          <tbody>
            {rows.slice(0, 300).map((r) => (
              <tr key={r.id} style={r.status === "Anulado" ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                <td className="amg-mono" style={{ whiteSpace: "nowrap" }}><b>{r.record_no}</b></td>
                <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{ui.fmtDate(r.audit_date)}</td>
                <td>{r.technician_name}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{r.coordinator || ""}</div></td>
                <td>{r.department || "-"}</td>
                <td className="amg-mono">{r.service_no || "-"}</td>
                <td style={{ fontSize: 12 }}>{r.auditor_name || "-"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 10, background: M.colorSemaforo(cfg, r.traffic_light) }} /> <b className="amg-mono">{M.fmtPct(r.score)}</b>
                  </span>
                  {r.critical_error && <div style={{ fontSize: 10.5, color: "var(--red)" }}>error crítico</div>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{(r.results || []).map((x) => <span key={x.id} title={`${x.codigo} ${x.nombre}: ${x.resultado}`} style={{ marginRight: 3 }}><ui.Badge text={x.codigo} color={COLOR_RESULTADO[x.resultado] || "gray"} /></span>)}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="amg-btn ghost" style={{ padding: 4 }} title="Ver" onClick={() => setVista({ tipo: "ver", record: r })}><Eye size={13} /></button>
                  {canEdit && r.status === "Activo" && <button className="amg-btn ghost" style={{ padding: 4 }} title="Editar" onClick={() => setVista({ tipo: "form", record: r })}><Pencil size={13} /></button>}
                  {canEdit && r.status === "Activo" && <button className="amg-btn ghost" style={{ padding: 4 }} title="Anular (no se borra)" onClick={() => setAnular(r)}><Ban size={13} color="var(--red)" /></button>}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{records.length ? "Ningún monitoreo coincide con los filtros." : `Aún no hay registros de ${nombre.toLowerCase()}.${canEdit ? " Usa el botón \"Nuevo\"." : ""}`}</td></tr>}
            {loading && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Cargando...</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>{rows.length} registro(s){rows.length > 300 ? " (se muestran 300; usa los filtros)" : ""}. Los monitoreos no se borran: se anulan con un motivo. Las reglas y pesos se configuran en Maestros → Monitoreos.</div>

      {anular && <AnularModal ui={ui} record={anular} onClose={() => setAnular(null)}
        onConfirm={async (motivo) => {
          try { await M.updateRecord(anular.id, { status: "Anulado", void_reason: motivo }); await audit(`Anulación de ${nombre.toLowerCase()}`, anular.record_no, motivo); setMsg(`${anular.record_no} anulado.`); setAnular(null); await recargar(); }
          catch (e) { setError(e.message); setAnular(null); }
        }} />}
    </div>
  );
}

function AnularModal({ ui, record, onConfirm, onClose }) {
  const [motivo, setMotivo] = useState("");
  return (
    <ui.Modal title={`Anular ${record.record_no}`} onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Volver</button><button className="amg-btn primary" disabled={!motivo.trim()} onClick={() => onConfirm(motivo.trim())}>Anular monitoreo</button></>}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>El monitoreo deja de contar en los resultados. No se borra: queda registrado como anulado.</div>
      <label className="amg-label">Motivo *</label>
      <textarea className="amg-textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
    </ui.Modal>
  );
}

/* ----------------------------------- Formulario ----------------------------------- */

function MonitoreoForm({ ui, db, cfg, canal, session, zona, hoy, record, soloLectura, onCancel, onEditar, onSaved }) {
  const nombre = M.NOMBRE_CANAL[canal];
  const comps = useMemo(() => M.componentesActivos(cfg, canal), [cfg, canal]);
  const auditores = useMemo(() => (db.users || []).filter((u) => ["admin", "operador"].includes(u.role) && u.active !== false), [db.users]);
  const tecnicos = useMemo(() => db.technicians.filter((t) => (t.category || "Técnico de campo") !== "Administrativo" && (t.status === "Activo" || (record && t.id === record.technician_id))).sort((a, b) => a.name.localeCompare(b.name, "es")), [db.technicians, record]);
  const [g, setG] = useState(() => ({
    audit_date: record ? record.audit_date : hoy, auditor_id: record ? record.auditor_id || "" : session.id, technician_id: record ? record.technician_id : "",
    city: record ? record.city || "" : "", service_no: record ? record.service_no || "" : "", products_count: record ? record.products_count ?? "" : "",
    original_service_date: record ? record.original_service_date || "" : "", observations: record ? record.observations || "" : "",
  }));
  const [resp, setResp] = useState(() => (record ? { ...(record.answers || {}) } : {}));
  const [errCrit, setErrCrit] = useState(record ? !!record.critical_error : false);
  const [tipoCrit, setTipoCrit] = useState(record ? record.critical_type || "" : "");
  const [verDesc, setVerDesc] = useState(true);
  const [abiertos, setAbiertos] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tec = db.technicians.find((t) => t.id === g.technician_id) || null;
  const depto = tec ? tec.department || "" : record ? record.department || "" : "";
  const coordinador = tec ? zona.coordDe(depto) || tec.coordinator || "" : record ? record.coordinator || "" : "";
  const calc = useMemo(() => M.calcular(cfg, canal, resp, errCrit), [cfg, canal, resp, errCrit]);
  const sem = M.semaforoDe(cfg, calc.calificacion);
  const totalSubs = comps.reduce((a, c) => a + c.subs.length, 0);
  const respondidas = totalSubs - calc.pendientes;

  const elegirTecnico = (id) => { const t = db.technicians.find((x) => x.id === id); setG((x) => ({ ...x, technician_id: id, city: x.city || (t && t.city) || "" })); };
  const responder = (id, v) => { if (soloLectura) return; setResp((r) => ({ ...r, [id]: r[id] === v ? "" : v })); };
  const todo = (c, v) => { if (soloLectura) return; setResp((r) => { const n = { ...r }; c.subs.forEach((s) => { n[s.id] = v; }); return n; }); };

  const faltas = [];
  if (!g.audit_date) faltas.push("la fecha");
  if (!g.technician_id) faltas.push("el técnico");
  if (!g.service_no.trim()) faltas.push("el número de servicio");
  if (calc.pendientes > 0) faltas.push(`${calc.pendientes} subcomponente(s) por responder`);
  if (errCrit && !tipoCrit.trim()) faltas.push("el tipo de error crítico");
  const listo = faltas.length === 0;

  const guardar = async () => {
    setBusy(true); setError("");
    try {
      const aud = auditores.find((u) => u.id === g.auditor_id);
      const respLimpia = Object.fromEntries(comps.flatMap((c) => c.subs.map((s) => [s.id, resp[s.id]])).filter(([, v]) => v));
      const row = {
        audit_date: g.audit_date, auditor_id: g.auditor_id || null, auditor_name: aud ? aud.name : null, technician_id: g.technician_id, technician_name: tec ? tec.name : null,
        department: depto || null, coordinator: coordinador || null, city: g.city.trim() || null, service_no: g.service_no.trim(),
        products_count: canal === "Digital" && g.products_count !== "" ? Math.max(1, Math.round(Number(g.products_count))) : null,
        original_service_date: canal === "Presencial" && g.original_service_date ? g.original_service_date : null,
        answers: respLimpia, results: calc.resultados.map(({ id, codigo, nombre: n, peso, resultado, puntaje }) => ({ id, codigo, nombre: n, peso, resultado, puntaje })),
        critical_error: errCrit, critical_type: errCrit ? tipoCrit.trim() : null, score: calc.calificacion, traffic_light: sem.nombre, observations: g.observations.trim() || null,
      };
      const r = record ? await M.updateRecord(record.id, row) : await M.createRecord({ ...row, channel: canal, status: "Activo" });
      await onSaved(`${r.record_no} ${record ? "actualizado" : "registrado"}: ${M.fmtPct(r.score)} · ${r.traffic_light}.`, r, !record);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const fila = (t, v) => <div><div className="amg-label">{t}</div><div style={{ fontSize: 13 }}>{v || "-"}</div></div>;
  const lectura = soloLectura;

  return (
    <div>
      {/* Resumen fijo: calificación en vivo */}
      <div className="amg-card" style={{ position: "sticky", top: 0, zIndex: 5, padding: "10px 14px", marginBottom: 12, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", borderLeft: `5px solid ${sem.color}` }}>
        <div><div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{record ? record.record_no : `Nuevo ${nombre.toLowerCase()}`}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }} className="amg-mono">{M.fmtPct(lectura && record ? record.score : calc.calificacion)}</div></div>
        <div><span style={{ padding: "3px 12px", borderRadius: 14, background: sem.color, color: "#fff", fontWeight: 600, fontSize: 13 }}>{lectura && record ? record.traffic_light : sem.nombre}</span></div>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{respondidas} de {totalSubs} subcomponentes respondidos
          <div style={{ width: 200, height: 6, background: "var(--panel-2)", borderRadius: 4, marginTop: 4 }}><div style={{ width: `${totalSubs ? (respondidas / totalSubs) * 100 : 0}%`, height: "100%", background: "var(--accent)", borderRadius: 4 }} /></div></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{calc.resultados.map((r) => <span key={r.id} title={`${r.nombre}: ${r.resultado} · ${r.puntaje}/${r.peso}`}><ui.Badge text={`${r.codigo} ${r.puntaje}/${r.peso}`} color={COLOR_RESULTADO[r.resultado]} /></span>)}</div>
        {errCrit && <span style={{ color: "var(--red)", fontWeight: 600, fontSize: 13 }}>⚠ Error crítico: calificación 0%</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={verDesc} onChange={(e) => setVerDesc(e.target.checked)} /> Mostrar descripciones</label>
          <button className="amg-btn" onClick={onCancel}>{lectura ? "Volver" : "Cancelar"}</button>
          {lectura && onEditar && (record && record.status === "Activo") && (session.role === "admin" || session.role === "operador") && <button className="amg-btn primary" onClick={onEditar}><Pencil size={13} /> Editar</button>}
          {!lectura && <button className="amg-btn primary" disabled={!listo || busy} onClick={guardar} title={listo ? "" : `Falta: ${faltas.join(", ")}`}>{busy ? "Guardando..." : record ? "Guardar cambios" : "Guardar monitoreo"}</button>}
        </div>
      </div>
      {error && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> {error}</div>}
      {!lectura && !listo && <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 10 }}>Para guardar falta: {faltas.join(" · ")}.</div>}
      {lectura && record && record.status === "Anulado" && <div className="amg-alert danger" style={{ marginBottom: 12 }}><Ban size={14} /> Anulado{record.void_reason ? `: ${record.void_reason}` : ""}</div>}

      {/* Información general */}
      <div className="amg-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Información general</div>
        {lectura ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
            {fila("Fecha", ui.fmtDate(g.audit_date))}{fila(M.ROL_AUDITOR[canal], record && record.auditor_name)}{fila("Técnico", record && record.technician_name)}{fila("Departamento", depto)}{fila("Coordinador", coordinador)}{fila("Ciudad", g.city)}
            {fila("N° de servicio", g.service_no)}{canal === "Digital" ? fila("Cantidad de productos", g.products_count) : fila("Fecha del servicio original", g.original_service_date ? ui.fmtDate(g.original_service_date) : "")}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
            <div><label className="amg-label">Fecha *</label><input type="date" className="amg-input" max={hoy} value={g.audit_date} onChange={(e) => setG({ ...g, audit_date: e.target.value })} /></div>
            <div><label className="amg-label">{M.ROL_AUDITOR[canal]}</label>
              <select className="amg-select" value={g.auditor_id} onChange={(e) => setG({ ...g, auditor_id: e.target.value })}><option value="">Sin asignar</option>{auditores.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <div style={{ gridColumn: "span 2", minWidth: 220 }}><label className="amg-label">Técnico monitoreado *</label>
              <ui.SearchSelect options={tecnicos.map((t) => ({ value: t.id, label: t.name, sublabel: `${t.code}${t.department ? ` · ${t.department}` : ""}` }))} value={g.technician_id} onChange={elegirTecnico} placeholder="Buscar en Personal..." /></div>
            <div><label className="amg-label">Departamento</label><div className="amg-input" style={{ background: "var(--panel)", color: "var(--text-dim)" }}>{depto || "Sale de la ficha del técnico"}</div></div>
            <div><label className="amg-label">Coordinador</label><div className="amg-input" style={{ background: "var(--panel)", color: "var(--text-dim)" }}>{coordinador || "Sale del departamento"}</div></div>
            <div><label className="amg-label">Ciudad</label><input className="amg-input" value={g.city} onChange={(e) => setG({ ...g, city: e.target.value })} /></div>
            <div><label className="amg-label">N° de servicio *</label><input className="amg-input amg-mono" value={g.service_no} onChange={(e) => setG({ ...g, service_no: e.target.value })} /></div>
            {canal === "Digital"
              ? <div><label className="amg-label">Cantidad de productos</label><input type="number" min="1" className="amg-input" value={g.products_count} onChange={(e) => setG({ ...g, products_count: e.target.value })} /></div>
              : <div><label className="amg-label">Fecha del servicio original</label><input type="date" className="amg-input" value={g.original_service_date} onChange={(e) => setG({ ...g, original_service_date: e.target.value })} /></div>}
          </div>
        )}
      </div>

      {/* Componentes */}
      {comps.map((c, ci) => {
        const r = calc.resultados[ci];
        const cerrado = abiertos[c.id] === false;
        return (
          <div key={c.id} className="amg-card" style={{ padding: 0, marginBottom: 12, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "var(--panel-2)", cursor: "pointer" }} onClick={() => setAbiertos({ ...abiertos, [c.id]: cerrado })}>
              {cerrado ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              <b>{c.codigo} · {c.nombre}</b><span style={{ fontSize: 12, color: "var(--text-faint)" }}>({c.peso}%)</span>
              <ui.Badge text={r.resultado === "PENDIENTE" ? `${r.respondidas}/${r.total}` : r.resultado} color={COLOR_RESULTADO[r.resultado]} />
              <span className="amg-mono" style={{ fontSize: 12.5 }}>{r.puntaje}/{r.peso} pts</span>
              {!lectura && <span style={{ marginLeft: "auto", display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <button className="amg-btn ghost" style={{ fontSize: 11.5, padding: "2px 8px" }} onClick={() => todo(c, "Cumple")}>Todo cumple</button>
                <button className="amg-btn ghost" style={{ fontSize: 11.5, padding: "2px 8px" }} onClick={() => todo(c, "")}>Limpiar</button>
              </span>}
            </div>
            {!cerrado && c.subs.map((s) => (
              <div key={s.id} style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 320px", minWidth: 220 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.nombre}</div>
                  {verDesc && s.descripcion && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 2, lineHeight: 1.5 }}>{s.descripcion}</div>}
                  {verDesc && s.regla && /cr[ií]tico/i.test(s.regla) && <div style={{ fontSize: 11.5, color: "var(--red)", marginTop: 2 }}>⚠ {s.regla}</div>}
                </div>
                <div style={{ display: "flex", gap: 6 }} role="group" aria-label={s.nombre}>
                  {M.RESPUESTAS.map((v) => {
                    const sel = resp[s.id] === v;
                    return <button key={v} type="button" disabled={lectura} onClick={() => responder(s.id, v)}
                      style={{ minWidth: 86, padding: "7px 10px", borderRadius: 7, fontSize: 13, fontWeight: sel ? 700 : 500, cursor: lectura ? "default" : "pointer", border: `1.5px solid ${sel ? COLOR_RESPUESTA[v] : "var(--border)"}`,
                        background: sel ? COLOR_RESPUESTA[v] : "transparent", color: sel ? "#fff" : "var(--text-dim)" }}>{v}</button>;
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {/* Error crítico y observaciones */}
      <div className="amg-card" style={{ padding: 14, marginBottom: 12, borderColor: errCrit ? "var(--red)" : undefined }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Error crítico</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {[["NO", false], ["SI", true]].map(([t, v]) => (
            <button key={t} type="button" disabled={lectura} onClick={() => { setErrCrit(v); if (!v) setTipoCrit(""); }}
              style={{ minWidth: 80, padding: "7px 10px", borderRadius: 7, fontSize: 13, fontWeight: errCrit === v ? 700 : 500, cursor: lectura ? "default" : "pointer", border: `1.5px solid ${errCrit === v ? (v ? "#C0463A" : "#3F9D6E") : "var(--border)"}`, background: errCrit === v ? (v ? "#C0463A" : "#3F9D6E") : "transparent", color: errCrit === v ? "#fff" : "var(--text-dim)" }}>{t}</button>
          ))}
          <span style={{ fontSize: 12, color: "var(--text-faint)", alignSelf: "center" }}>Un error crítico lleva la calificación final a 0%.</span>
        </div>
        {errCrit && (
          <div>
            <label className="amg-label">Tipo de error crítico *</label>
            <select className="amg-select" disabled={lectura} value={(cfg.erroresCriticos || []).some((e) => e.nombre === tipoCrit) ? tipoCrit : tipoCrit ? "__otro" : ""} onChange={(e) => setTipoCrit(e.target.value === "__otro" ? " " : e.target.value)}>
              <option value="">Seleccionar...</option>{(cfg.erroresCriticos || []).map((e) => <option key={e.nombre} value={e.nombre}>{e.nombre}</option>)}<option value="__otro">Otro (describir)</option>
            </select>
            {(cfg.erroresCriticos || []).some((e) => e.nombre === tipoCrit) && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>{(cfg.erroresCriticos.find((e) => e.nombre === tipoCrit) || {}).descripcion}</div>}
            {!(cfg.erroresCriticos || []).some((e) => e.nombre === tipoCrit) && tipoCrit !== "" && <input className="amg-input" disabled={lectura} style={{ marginTop: 6 }} placeholder="Describe el error crítico" value={tipoCrit.trim() === "" ? "" : tipoCrit} onChange={(e) => setTipoCrit(e.target.value || " ")} />}
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>Recuerda registrar el hallazgo y su plan de acción.</div>
          </div>
        )}
      </div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 20 }}>
        <label className="amg-label">Observaciones</label>
        <textarea className="amg-textarea" rows={3} disabled={lectura} value={g.observations} onChange={(e) => setG({ ...g, observations: e.target.value })} />
      </div>
    </div>
  );
}
