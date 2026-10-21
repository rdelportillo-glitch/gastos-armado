import { useState, useEffect, useMemo } from "react";
import { Check, AlertTriangle, Plus, Paperclip, Download, Eye, X, Pencil, RotateCcw } from "lucide-react";
import * as DD from "./lib/disciplinarios/discData";

/* ============================================================================
   PROCESOS DISCIPLINARIOS
   Seguimiento de casos de personal: se abre el caso sobre una persona de Personal, avanza por estados (Abierto, Citado a descargos,
   En seguimiento, Pendiente de decisión, Decisión aplicada, Cerrado, Archivado) y cada movimiento queda en una bitácora con sus
   documentos. Es información sensible: el administrador gestiona, el operador solo consulta. Nada se borra.
============================================================================ */

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };
const EN_CURSO = "__en_curso";

export default function DisciplinariosModule({ db, session, persist, addAudit, ui }) {
  const canEdit = session.role === "admin";
  const hoy = ui.todayISO();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [detalleId, setDetalleId] = useState(null);
  const [f, setF] = useState({ q: "", estado: EN_CURSO, persona: "", tipo: "", desde: "", hasta: "" });

  const personas = useMemo(() => Object.fromEntries(db.technicians.map((t) => [t.id, t])), [db.technicians]);
  const usuarios = useMemo(() => Object.fromEntries((db.users || []).map((u) => [u.id, u.name])), [db.users]);

  const recargar = async () => {
    setLoading(true); setError("");
    try { setCases(await DD.listCases()); }
    catch (e) { setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL de Procesos disciplinarios (sql/31).`); }
    setLoading(false);
  };
  useEffect(() => { recargar(); }, []);

  const audit = (accion, registro, detalle) => persist(addAudit(db, { userId: session.id, action: accion, record: registro, oldValue: "-", newValue: detalle }));

  const rows = useMemo(() => cases.filter((c) => {
    const p = personas[c.technician_id];
    const q = f.q.trim().toLowerCase();
    return (!q || `${c.case_no} ${c.subject} ${c.fault_type} ${p ? `${p.name} ${p.code}` : ""}`.toLowerCase().includes(q))
      && (f.estado === "" || (f.estado === EN_CURSO ? DD.ESTADOS_ABIERTOS.includes(c.status) : c.status === f.estado))
      && (!f.persona || c.technician_id === f.persona) && (!f.tipo || c.fault_type === f.tipo)
      && (!f.desde || c.opened_on >= f.desde) && (!f.hasta || c.opened_on <= f.hasta);
  }), [cases, personas, f]);

  const n = (fn) => cases.filter(fn).length;
  const abiertos = cases.filter((c) => DD.ESTADOS_ABIERTOS.includes(c.status));
  const masViejo = abiertos.reduce((m, c) => Math.max(m, DD.diasEntre(c.opened_on, hoy)), 0);

  const exportar = () => ui.downloadCSV(`procesos_disciplinarios_${hoy}.csv`,
    ["Caso", "Persona", "Código", "Departamento", "Tipo de falta", "Asunto", "Estado", "Fecha de los hechos", "Abierto el", "Días abierto", "Responsable", "Decisión", "Cerrado el"],
    rows.map((c) => { const p = personas[c.technician_id] || {}; return [c.case_no, p.name || "", p.code || "", p.department || "", c.fault_type, c.subject, c.status, c.incident_date ? ui.fmtDate(c.incident_date) : "", ui.fmtDate(c.opened_on),
      DD.ESTADOS_ABIERTOS.includes(c.status) ? DD.diasEntre(c.opened_on, hoy) : "", usuarios[c.responsible_id] || "", c.decision || "", c.closed_on ? ui.fmtDate(c.closed_on) : ""]; }));

  const caso = detalleId ? cases.find((c) => c.id === detalleId) : null;
  const opcionesPersona = useMemo(() => [{ value: "", label: "Todas las personas" }, ...db.technicians.slice().sort((a, b) => a.name.localeCompare(b.name, "es")).map((t) => ({ value: t.id, label: t.name, sublabel: t.code }))], [db.technicians]);

  return (
    <div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Casos en curso" value={abiertos.length} sub={abiertos.length ? `el más antiguo lleva ${masViejo} día(s)` : "ninguno abierto"} accent />
        <ui.StatCard label="Abiertos" value={n((c) => c.status === "Abierto")} />
        <ui.StatCard label="En seguimiento" value={n((c) => c.status === "En seguimiento" || c.status === "Citado a descargos")} sub="incluye citados a descargos" />
        <ui.StatCard label="Pendientes de decisión" value={n((c) => c.status === "Pendiente de decisión")} />
        <ui.StatCard label="Cerrados / archivados" value={n((c) => c.status === "Cerrado" || c.status === "Archivado")} sub={`${n((c) => c.status === "Decisión aplicada")} con decisión aplicada`} />
      </div>

      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input className="amg-input" style={{ width: 220 }} placeholder="Buscar caso, persona, asunto..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className="amg-select" style={{ width: 190 }} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}>
          <option value={EN_CURSO}>Casos en curso</option><option value="">Todos los estados</option>{DD.ESTADOS.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
        </select>
        <div style={{ minWidth: 200 }}><ui.SearchSelect options={opcionesPersona} value={f.persona} onChange={(v) => setF({ ...f, persona: v })} placeholder="Todas las personas" /></div>
        <select className="amg-select" style={{ width: 210 }} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
          <option value="">Todos los tipos de falta</option>{DD.TIPOS_FALTA.map((t) => <option key={t}>{t}</option>)}
        </select>
        <label style={{ fontSize: 12.5 }}>Abierto desde <input type="date" className="amg-input" style={{ width: 145 }} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
        <label style={{ fontSize: 12.5 }}>hasta <input type="date" className="amg-input" style={{ width: 145 }} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
        <button className="amg-btn" onClick={recargar} disabled={loading}><RotateCcw size={13} /> {loading ? "Actualizando..." : "Actualizar"}</button>
        <button className="amg-btn" onClick={exportar}><Download size={14} /> Exportar CSV</button>
        {canEdit && <button className="amg-btn primary" style={{ marginLeft: "auto" }} onClick={() => setNuevo(true)}><Plus size={14} /> Abrir caso</button>}
      </div>

      <div className="amg-card" style={{ overflow: "auto", maxHeight: "calc(100vh - 380px)" }}>
        <table className="amg-table compact">
          <thead><tr><th>Caso</th><th>Persona</th><th>Tipo de falta</th><th>Asunto</th><th>Estado</th><th>Abierto</th><th>Último movimiento</th><th>Responsable</th><th></th></tr></thead>
          <tbody>
            {rows.slice(0, 300).map((c) => {
              const p = personas[c.technician_id];
              const abierto = DD.ESTADOS_ABIERTOS.includes(c.status);
              return (
                <tr key={c.id} style={abierto ? undefined : { opacity: 0.75 }}>
                  <td className="amg-mono" style={{ whiteSpace: "nowrap" }}><b>{c.case_no}</b></td>
                  <td>{p ? p.name : "-"}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{p ? `${p.code} · ${p.department || "sin departamento"}${p.status !== "Activo" ? " · inactivo" : ""}` : ""}</div></td>
                  <td>{c.fault_type}</td>
                  <td><ui.HoverText text={c.subject} maxChars={40} /></td>
                  <td><ui.Badge text={c.status} color={DD.colorEstado(c.status)} /></td>
                  <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{ui.fmtDate(c.opened_on)}{abierto && <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{DD.diasEntre(c.opened_on, hoy)} día(s)</div>}</td>
                  <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{ui.fmtDate(String(c.updated_at).slice(0, 10))}</td>
                  <td style={{ fontSize: 12 }}>{usuarios[c.responsible_id] || "-"}</td>
                  <td><button className="amg-btn ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setDetalleId(c.id)}><Eye size={13} /> {canEdit ? "Gestionar" : "Ver"}</button></td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{cases.length ? "Ningún caso coincide con los filtros." : canEdit ? "Aún no hay casos. Usa \"Abrir caso\"." : "Aún no hay casos."}</td></tr>}
            {loading && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Cargando...</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>{rows.length} caso(s){rows.length > 300 ? " (se muestran 300; usa los filtros)" : ""}. Información confidencial. Los casos no se borran: se cierran o se archivan, y cada movimiento queda en la bitácora del caso.</div>

      {nuevo && <NuevoCasoModal ui={ui} db={db} session={session} hoy={hoy} onClose={() => setNuevo(false)}
        onCreated={async (c, aviso) => { setNuevo(false); setMsg(`Caso ${c.case_no} abierto.`); if (aviso) setError(aviso); await audit("Apertura de proceso disciplinario", c.case_no, "Caso abierto"); await recargar(); setDetalleId(c.id); }} />}
      {caso && <DetalleModal ui={ui} db={db} session={session} hoy={hoy} canEdit={canEdit} caso={caso} persona={personas[caso.technician_id]} usuarios={usuarios}
        onClose={() => setDetalleId(null)} onChanged={recargar} onAudit={audit} />}
    </div>
  );
}

/* ----------------------------- Selector de documentos ----------------------------- */

function Adjuntos({ files, setFiles }) {
  return (
    <div>
      <label className="amg-btn" style={{ cursor: "pointer" }}><Paperclip size={13} /> Adjuntar documentos
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt" style={{ display: "none" }} onChange={(e) => { setFiles([...files, ...Array.from(e.target.files)]); e.target.value = ""; }} />
      </label>
      <span style={{ fontSize: 11.5, color: "var(--text-faint)", marginLeft: 8 }}>PDF, imágenes, Word, Excel o texto · máx. 15 MB cada uno</span>
      {files.length > 0 && <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {files.map((f, i) => <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 12, border: "1px solid var(--border)", fontSize: 12 }}>
          {f.name}<button className="amg-btn ghost" style={{ padding: 0, lineHeight: 1 }} title="Quitar" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}
      </div>}
    </div>
  );
}

// Sube los documentos uno a uno; devuelve los que subieron y los errores (uno que falle no frena a los demás).
async function subirTodos(caseNo, files) {
  const ok = [], fallos = [];
  for (const file of files) {
    try { ok.push(await DD.uploadDoc(caseNo, file)); } catch (e) { fallos.push(e.message); }
  }
  return { ok, fallos };
}

/* ----------------------------------- Abrir caso ----------------------------------- */

function NuevoCasoModal({ ui, db, session, hoy, onClose, onCreated }) {
  const [f, setF] = useState({ technician_id: "", incident_date: "", fault_type: "", subject: "", description: "", responsible_id: session.id });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const personas = useMemo(() => db.technicians.slice().sort((a, b) => a.name.localeCompare(b.name, "es")).map((t) => ({ value: t.id, label: `${t.name}${t.status !== "Activo" ? " (inactivo)" : ""}`, sublabel: `${t.code}${t.department ? ` · ${t.department}` : ""}` })), [db.technicians]);
  const responsables = (db.users || []).filter((u) => ["admin", "operador"].includes(u.role));
  const listo = f.technician_id && f.fault_type && f.subject.trim() && f.description.trim();

  const guardar = async () => {
    setBusy(true); setError("");
    try {
      const c = await DD.createCase({ technician_id: f.technician_id, opened_on: hoy, incident_date: f.incident_date || null, fault_type: f.fault_type, subject: f.subject.trim(), description: f.description.trim(), status: "Abierto", responsible_id: f.responsible_id || null, updated_by: session.id });
      const { ok, fallos } = await subirTodos(c.case_no, files);
      await DD.addEvent({ case_id: c.id, event_date: hoy, event_type: "Apertura del caso", note: f.description.trim(), from_status: null, to_status: "Abierto", attachments: ok });
      onCreated(c, fallos.length ? `El caso se abrió, pero estos documentos no se subieron: ${fallos.join(" · ")}. Ábrelo y adjúntalos de nuevo.` : "");
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <ui.Modal title="Abrir proceso disciplinario" onClose={onClose} width={720}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!listo || busy} onClick={guardar}>{busy ? "Guardando..." : "Abrir caso"}</button></>}>
      {error && <div className="amg-alert danger" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> {error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}><label className="amg-label">Persona *</label><ui.SearchSelect options={personas} value={f.technician_id} onChange={(v) => set({ technician_id: v })} placeholder="Buscar en Personal..." /></div>
        <div><label className="amg-label">Tipo de falta *</label>
          <select className="amg-select" value={f.fault_type} onChange={(e) => set({ fault_type: e.target.value })}><option value="">Seleccionar...</option>{DD.TIPOS_FALTA.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className="amg-label">Fecha de los hechos</label><input type="date" className="amg-input" max={hoy} value={f.incident_date} onChange={(e) => set({ incident_date: e.target.value })} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label className="amg-label">Asunto *</label><input className="amg-input" maxLength={140} placeholder="Resumen corto del caso" value={f.subject} onChange={(e) => set({ subject: e.target.value })} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label className="amg-label">Descripción de los hechos *</label><textarea className="amg-textarea" rows={5} value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
        <div><label className="amg-label">Responsable del caso</label>
          <select className="amg-select" value={f.responsible_id} onChange={(e) => set({ responsible_id: e.target.value })}><option value="">Sin responsable</option>{responsables.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div style={{ gridColumn: "1 / -1" }}><Adjuntos files={files} setFiles={setFiles} /></div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>El caso queda en estado <b>Abierto</b> y se registra el movimiento de apertura con la descripción y los documentos. Los casos no se pueden borrar.</div>
    </ui.Modal>
  );
}

/* ------------------------------- Detalle y seguimiento ------------------------------- */

function DetalleModal({ ui, db, session, hoy, canEdit, caso, persona, usuarios, onClose, onChanged, onAudit }) {
  const [events, setEvents] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [editando, setEditando] = useState(false);
  const vacio = { event_type: "Nota de seguimiento", event_date: hoy, note: "", to_status: "", decision: caso.decision || "", decision_notes: caso.decision_notes || "" };
  const [m, setM] = useState(vacio);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  const cargar = async () => { setCargando(true); try { setEvents(await DD.listEvents(caso.id)); } catch (e) { setError(e.message); } setCargando(false); };
  useEffect(() => { cargar(); }, [caso.id]);

  const abrirDoc = async (d) => {
    const w = window.open("", "_blank");
    try { const url = await DD.docUrl(d.path); if (w) w.location.href = url; else window.location.href = url; }
    catch (e) { if (w) w.close(); setError(e.message); }
  };

  const cierra = ["Cerrado", "Archivado"].includes(m.to_status);
  const hayCambio = !!m.to_status && m.to_status !== caso.status;
  const listo = m.note.trim() && m.event_date && (m.to_status !== "Decisión aplicada" || m.decision);

  const registrar = async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      const { ok, fallos } = await subirTodos(caso.case_no, files);
      if (fallos.length) throw new Error(`No se subieron: ${fallos.join(" · ")}. Corrige o quita esos documentos y vuelve a intentar.`);
      const nuevoEstado = hayCambio ? m.to_status : null;
      await DD.addEvent({ case_id: caso.id, event_date: m.event_date, event_type: m.event_type, note: m.note.trim(), from_status: nuevoEstado ? caso.status : null, to_status: nuevoEstado, attachments: ok });
      const patch = { updated_by: session.id, updated_at: new Date().toISOString() };
      if (nuevoEstado) patch.status = nuevoEstado;
      if (m.to_status === "Decisión aplicada") { patch.decision = m.decision; patch.decision_notes = m.decision_notes.trim() || null; }
      if (cierra) patch.closed_on = m.event_date;
      else if (nuevoEstado && DD.ESTADOS_ABIERTOS.includes(nuevoEstado)) patch.closed_on = null; // se reabrió
      await DD.updateCase(caso.id, patch);
      if (nuevoEstado) await onAudit("Cambio de estado de proceso disciplinario", caso.case_no, `${caso.status} → ${nuevoEstado}`);
      setM({ ...vacio, decision: patch.decision || caso.decision || "", decision_notes: patch.decision_notes || caso.decision_notes || "" }); setFiles([]);
      setMsg(nuevoEstado ? `Movimiento registrado. El caso pasó a "${nuevoEstado}".` : "Movimiento registrado.");
      await cargar(); await onChanged();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const abierto = DD.ESTADOS_ABIERTOS.includes(caso.status);
  const fila = (t, v) => <div><div className="amg-label">{t}</div><div style={{ fontSize: 13 }}>{v || "-"}</div></div>;

  return (
    <ui.Modal title={`Caso ${caso.case_no}`} onClose={onClose} width={900} footer={<button className="amg-btn" onClick={onClose}>Cerrar</button>}>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> {error}</div>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <ui.Badge text={caso.status} color={DD.colorEstado(caso.status)} />
        <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{(DD.ESTADOS.find((e) => e.key === caso.status) || {}).desc}</span>
        {canEdit && <button className="amg-btn ghost" style={{ marginLeft: "auto", fontSize: 12 }} onClick={() => setEditando(!editando)}><Pencil size={12} /> {editando ? "Cerrar edición" : "Editar datos del caso"}</button>}
      </div>

      {editando && canEdit
        ? <EditarCaso ui={ui} db={db} caso={caso} hoy={hoy} session={session} onDone={async (txt) => { setEditando(false); setMsg(txt); await cargar(); await onChanged(); }} onError={setError} />
        : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            {fila("Persona", persona ? `${persona.name} (${persona.code})` : "")}{fila("Departamento / cargo", persona ? `${persona.department || "-"} · ${persona.type || persona.category || ""}` : "")}{fila("Responsable del caso", usuarios[caso.responsible_id])}
            {fila("Tipo de falta", caso.fault_type)}{fila("Fecha de los hechos", caso.incident_date ? ui.fmtDate(caso.incident_date) : "")}{fila("Abierto el", `${ui.fmtDate(caso.opened_on)}${abierto ? ` · ${DD.diasEntre(caso.opened_on, hoy)} día(s)` : ""}`)}
            <div style={{ gridColumn: "1 / -1" }}>{fila("Asunto", caso.subject)}</div>
            <div style={{ gridColumn: "1 / -1" }}>{fila("Descripción de los hechos", <span style={{ whiteSpace: "pre-wrap" }}>{caso.description}</span>)}</div>
            {(caso.decision || caso.closed_on) && <>{fila("Decisión", caso.decision)}{fila("Observaciones de la decisión", caso.decision_notes)}{fila("Cerrado el", caso.closed_on ? ui.fmtDate(caso.closed_on) : "")}</>}
          </div>
        )}

      {canEdit && (
        <div className="amg-card" style={{ padding: 12, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Registrar movimiento o cambiar el estado</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div><label className="amg-label">Tipo de movimiento</label>
              <select className="amg-select" value={m.event_type} onChange={(e) => setM({ ...m, event_type: e.target.value })}>{DD.TIPOS_MOVIMIENTO.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" max={hoy} value={m.event_date} onChange={(e) => setM({ ...m, event_date: e.target.value })} /></div>
            <div><label className="amg-label">Cambiar estado a</label>
              <select className="amg-select" value={m.to_status} onChange={(e) => setM({ ...m, to_status: e.target.value })}><option value="">Mantener "{caso.status}"</option>{DD.ESTADOS.filter((s) => s.key !== caso.status).map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}</select></div>
            {m.to_status === "Decisión aplicada" && <>
              <div><label className="amg-label">Decisión *</label>
                <select className="amg-select" value={m.decision} onChange={(e) => setM({ ...m, decision: e.target.value })}><option value="">Seleccionar...</option>{DD.DECISIONES.map((d) => <option key={d}>{d}</option>)}</select></div>
              <div style={{ gridColumn: "span 2" }}><label className="amg-label">Observaciones de la decisión</label><input className="amg-input" value={m.decision_notes} onChange={(e) => setM({ ...m, decision_notes: e.target.value })} /></div>
            </>}
            <div style={{ gridColumn: "1 / -1" }}><label className="amg-label">Detalle *</label><textarea className="amg-textarea" rows={3} value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} placeholder="Qué pasó, qué se acordó, qué sigue..." /></div>
            <div style={{ gridColumn: "1 / -1" }}><Adjuntos files={files} setFiles={setFiles} /></div>
          </div>
          {!abierto && !hayCambio && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>El caso está {caso.status.toLowerCase()}. Para continuarlo, cámbialo a otro estado (queda registrado en la bitácora).</div>}
          <div style={{ marginTop: 10 }}><button className="amg-btn primary" disabled={!listo || busy} onClick={registrar}>{busy ? "Guardando..." : hayCambio ? `Registrar y pasar a "${m.to_status}"` : "Registrar movimiento"}</button></div>
        </div>
      )}

      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Bitácora del caso</div>
      {cargando && <div style={{ color: "var(--text-faint)" }}>Cargando...</div>}
      {!cargando && events.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 13 }}>Sin movimientos.</div>}
      {events.map((ev) => (
        <div key={ev.id} className="amg-card" style={{ padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
            <b>{ev.event_type}</b>
            <span className="amg-mono" style={{ color: "var(--text-faint)" }}>{ui.fmtDate(ev.event_date)}</span>
            {ev.to_status && <span>{ev.from_status ? <>{ev.from_status} → </> : null}<ui.Badge text={ev.to_status} color={DD.colorEstado(ev.to_status)} /></span>}
            <span style={{ marginLeft: "auto", color: "var(--text-faint)", fontSize: 11.5 }}>{usuarios[ev.created_by] || ""} · {String(ev.created_at).slice(0, 16).replace("T", " ")}</span>
          </div>
          {ev.note && <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>{ev.note}</div>}
          {(ev.attachments || []).length > 0 && <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ev.attachments.map((d) => <button key={d.path} className="amg-btn ghost" style={{ fontSize: 12, padding: "2px 8px" }} title={d.size ? `${(d.size / 1024).toFixed(0)} KB` : ""} onClick={() => abrirDoc(d)}><Paperclip size={12} /> {d.name}</button>)}
          </div>}
        </div>
      ))}
    </ui.Modal>
  );
}

// Edición de los datos del caso (la persona no se puede cambiar). Cada edición queda en la bitácora.
function EditarCaso({ ui, db, caso, hoy, session, onDone, onError }) {
  const [f, setF] = useState({ fault_type: caso.fault_type, subject: caso.subject, description: caso.description || "", incident_date: caso.incident_date || "", responsible_id: caso.responsible_id || "" });
  const [busy, setBusy] = useState(false);
  const responsables = (db.users || []).filter((u) => ["admin", "operador"].includes(u.role));
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const etiquetas = { fault_type: "tipo de falta", subject: "asunto", description: "descripción", incident_date: "fecha de los hechos", responsible_id: "responsable" };
  const cambios = Object.keys(etiquetas).filter((k) => String(f[k] || "") !== String(caso[k] || ""));
  const guardar = async () => {
    setBusy(true); onError("");
    try {
      await DD.updateCase(caso.id, { fault_type: f.fault_type, subject: f.subject.trim(), description: f.description.trim(), incident_date: f.incident_date || null, responsible_id: f.responsible_id || null, updated_by: session.id, updated_at: new Date().toISOString() });
      await DD.addEvent({ case_id: caso.id, event_date: hoy, event_type: "Datos del caso editados", note: `Se modificó: ${cambios.map((k) => etiquetas[k]).join(", ")}.`, attachments: [] });
      onDone("Datos del caso actualizados.");
    } catch (e) { onError(e.message); setBusy(false); }
  };
  return (
    <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div><label className="amg-label">Tipo de falta</label><select className="amg-select" value={f.fault_type} onChange={(e) => set({ fault_type: e.target.value })}>{[...new Set([f.fault_type, ...DD.TIPOS_FALTA])].map((t) => <option key={t}>{t}</option>)}</select></div>
        <div><label className="amg-label">Fecha de los hechos</label><input type="date" className="amg-input" max={hoy} value={f.incident_date} onChange={(e) => set({ incident_date: e.target.value })} /></div>
        <div><label className="amg-label">Responsable</label><select className="amg-select" value={f.responsible_id} onChange={(e) => set({ responsible_id: e.target.value })}><option value="">Sin responsable</option>{responsables.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div style={{ gridColumn: "1 / -1" }}><label className="amg-label">Asunto</label><input className="amg-input" maxLength={140} value={f.subject} onChange={(e) => set({ subject: e.target.value })} /></div>
        <div style={{ gridColumn: "1 / -1" }}><label className="amg-label">Descripción de los hechos</label><textarea className="amg-textarea" rows={4} value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>
      </div>
      <div style={{ marginTop: 10 }}><button className="amg-btn primary" disabled={busy || !cambios.length || !f.subject.trim()} onClick={guardar}>{busy ? "Guardando..." : "Guardar cambios"}</button>
        <span style={{ fontSize: 11.5, color: "var(--text-faint)", marginLeft: 8 }}>Queda un registro de la edición en la bitácora.</span></div>
    </div>
  );
}
