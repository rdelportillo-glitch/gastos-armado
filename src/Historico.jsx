import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download, AlertTriangle, Pencil, History, Ban, RotateCcw } from "lucide-react";
import CambiosRegistros from "./CambiosRegistros";
import { fetchHistory, aggregateHistory, loadRegionInfo, updateHistoryRow, anularHistoryRow, restaurarHistoryRow } from "./lib/asignacion/history";
import { CSV_CARGA_HEADERS, filasCsvDeHistorico, camposCierreDeHistorico, parcharFilaCsv } from "./lib/asignacion/csvCarga";
import { useZonaCoord } from "./lib/useCoordinadores";

/* ============================================================================
   HISTÓRICO DE ASIGNACIÓN
   Todo lo que se finalizó con "Finalizar día" en Carga: qué se asignó a cada técnico,
   qué se realizó y qué no (con su causal). Sirve de base para el tablero y los reportes.
============================================================================ */

const GREEN = "#3F9D6E", RED = "#C0463A", ACCENT = "#D98D34", GRID = "#E3D8C4", AXIS = "#6B5D4D";
const fmt = (n) => Number(n || 0).toLocaleString("es-CO");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const shortDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function Panel({ title, children }) {
  return <div className="amg-card" style={{ padding: 14 }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{title}</div>{children}</div>;
}

// Editar un registro del histórico (solo administrador). Corrige lo que se cerró mal: técnico, resultado, causales, diagnóstico, datos del cliente y notas.
// Recalcula las columnas de cierre y la fila guardada del CSV, y deja la edición en la auditoría.
function EditarHistoricoModal({ ui, db, row, onClose, onSave }) {
  const apoyoMatch = row.helper_name ? db.technicians.find((t) => t.name === row.helper_name) : null;
  const [f, setF] = useState({
    technician_id: row.technician_id || "", apoyoId: apoyoMatch ? apoyoMatch.id : "", resultado: row.resultado, estado_extreme: row.estado_extreme || "", causal_extreme: row.causal_extreme || "",
    causal_auditada: row.causal_auditada || "", diagnostico: row.diagnostico || "", cliente: row.cliente || "", direccion: row.direccion || "", ciudad: row.ciudad || "", barrio: row.barrio || "",
    notas: row.notas || "", solucion: row.solucion || "", primer_piso: row.primer_piso || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const techOpts = db.technicians.map((t) => ({ value: t.id, label: t.name, sublabel: `${t.code} · ${t.status}` }));
  const causales = [...new Set([...(db.causales || []).filter((c) => c.active).map((c) => c.name), ...(f.causal_auditada ? [f.causal_auditada] : [])])].sort((a, b) => a.localeCompare(b, "es"));
  const guardar = async () => {
    setBusy(true); setError("");
    try {
      const tec = db.technicians.find((t) => t.id === f.technician_id);
      const apoyo = db.technicians.find((t) => t.id === f.apoyoId);
      const nuevo = {
        ...row, technician_id: tec ? tec.id : null, technician_name: tec ? tec.name : (f.technician_id === (row.technician_id || "") ? row.technician_name : null), helper_name: apoyo ? apoyo.name : null,
        resultado: f.resultado, estado_extreme: f.estado_extreme || null, causal_extreme: f.causal_extreme.trim() || null, causal_auditada: f.causal_auditada || null, diagnostico: f.diagnostico.trim() || null,
        cliente: f.cliente.trim() || null, direccion: f.direccion.trim() || null, ciudad: f.ciudad.trim() || null, barrio: f.barrio.trim() || null,
        notas: f.notas.trim() || null, solucion: f.solucion.trim() || null, primer_piso: f.primer_piso || null,
      };
      const patch = {
        technician_id: nuevo.technician_id, technician_name: nuevo.technician_name, helper_name: nuevo.helper_name, resultado: nuevo.resultado, estado_extreme: nuevo.estado_extreme,
        causal_extreme: nuevo.causal_extreme, causal_auditada: nuevo.causal_auditada, diagnostico: nuevo.diagnostico, cliente: nuevo.cliente, direccion: nuevo.direccion, ciudad: nuevo.ciudad, barrio: nuevo.barrio,
        notas: nuevo.notas, solucion: nuevo.solucion, primer_piso: nuevo.primer_piso, ...camposCierreDeHistorico(nuevo),
      };
      if (Array.isArray(row.fila_csv)) patch.fila_csv = parcharFilaCsv(row.fila_csv, { ...nuevo, ...patch }, row, { technicians: db.technicians, causales: db.causales });
      const guardado = await updateHistoryRow(row.id, patch);
      onSave(guardado, row);
    } catch (e) { setError(e.message || String(e)); setBusy(false); }
  };
  const lbl = (t) => <label className="amg-label">{t}</label>;
  return (
    <ui.Modal title={`Editar registro del histórico · ${row.servicio}`} onClose={busy ? () => {} : onClose} width={720}
      footer={<><button className="amg-btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={busy} onClick={guardar}>{busy ? "Guardando..." : "Guardar"}</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10 }}>{ui.fmtDate(row.day)} · {row.producto || "-"}. Corrige lo que se cerró mal; las columnas de cierre y el CSV del histórico se actualizan. Queda registrado en la auditoría.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>{lbl("Técnico")}<ui.SearchSelect options={[{ value: "", label: "Sin técnico" }, ...techOpts]} value={f.technician_id} onChange={(v) => setF({ ...f, technician_id: v })} placeholder="Buscar técnico..." /></div>
        <div>{lbl("Apoyo")}<ui.SearchSelect options={[{ value: "", label: "Sin apoyo" }, ...techOpts]} value={f.apoyoId} onChange={(v) => setF({ ...f, apoyoId: v })} placeholder="Buscar técnico..." /></div>
        <div>{lbl("Resultado")}<select className="amg-select" value={f.resultado} onChange={(e) => setF({ ...f, resultado: e.target.value })}><option>Realizado</option><option>No realizado</option></select></div>
        <div>{lbl("Estado Extreme")}<select className="amg-select" value={f.estado_extreme} onChange={(e) => setF({ ...f, estado_extreme: e.target.value })}><option value="">-</option><option>Realizado</option><option>No realizado</option></select></div>
        <div>{lbl("Causal Extreme")}<input className="amg-input" value={f.causal_extreme} onChange={(e) => setF({ ...f, causal_extreme: e.target.value })} /></div>
        <div>{lbl("Causal auditada")}<select className="amg-select" value={f.causal_auditada} onChange={(e) => setF({ ...f, causal_auditada: e.target.value })}><option value="">Sin auditar</option>{causales.map((n) => <option key={n}>{n}</option>)}</select></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Diagnóstico")}<textarea className="amg-textarea" rows={2} value={f.diagnostico} onChange={(e) => setF({ ...f, diagnostico: e.target.value })} /></div>
        <div>{lbl("Cliente")}<input className="amg-input" value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} /></div>
        <div>{lbl("Ciudad")}<input className="amg-input" value={f.ciudad} onChange={(e) => setF({ ...f, ciudad: e.target.value })} /></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Dirección")}<input className="amg-input" value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
        <div>{lbl("Barrio")}<input className="amg-input" value={f.barrio} onChange={(e) => setF({ ...f, barrio: e.target.value })} /></div>
        <div>{lbl("Primer piso")}<select className="amg-select" value={f.primer_piso} onChange={(e) => setF({ ...f, primer_piso: e.target.value })}><option value="">-</option><option>SI</option><option>NO</option></select></div>
        <div>{lbl("Solución")}<input className="amg-input" value={f.solucion} onChange={(e) => setF({ ...f, solucion: e.target.value })} /></div>
        <div>{lbl("Notas")}<input className="amg-input" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></div>
      </div>
      {error && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {error}</div>}
    </ui.Modal>
  );
}

export default function HistoricoModule({ db, ui, session, persist, addAudit }) {
  const esAdmin = !!session && session.role === "admin";
  const [editando, setEditando] = useState(null);
  const [cambiosOpen, setCambiosOpen] = useState(false); // quién modificó los registros del histórico (solo administrador)
  const hoy = ui.todayISO();
  const [from, setFrom] = useState(addDays(hoy, -29));
  const [to, setTo] = useState(hoy);
  const [regionQ, setRegionQ] = useState("");
  const [techQ, setTechQ] = useState("");
  const [resQ, setResQ] = useState("");
  const [rows, setRows] = useState([]);
  const [regionInfo, setRegionInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("tecnico");
  const [page, setPage] = useState(0);
  const [servicioQ, setServicioQ] = useState(""); // buscador de la pestaña Detalle de servicios
  const [verAnulados, setVerAnulados] = useState(false); // mostrar también los registros anulados en el detalle
  const [anulando, setAnulando] = useState(null); // registro por anular (solo administrador)
  const [motivo, setMotivo] = useState("");
  const [busyAnular, setBusyAnular] = useState(false);
  const [errAnular, setErrAnular] = useState("");

  useEffect(() => { loadRegionInfo().then(setRegionInfo); }, []);
  const zona = useZonaCoord(db); // coordinador del departamento, para el CSV
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    fetchHistory({ from, to, incluirAnulados: true }).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to]);
  useEffect(() => { setPage(0); }, [regionQ, techQ, resQ, from, to, tab, servicioQ]);

  const label = (r) => (regionInfo ? regionInfo.label(r) : r === null || r === undefined ? "Sin región" : `Región ${r}`);
  const orderOf = useMemo(() => Object.fromEntries(db.technicians.map((t) => [t.id, t.assignOrder ?? 9999])), [db.technicians]);

  // Los anulados no cuentan en nada (totales, graficos, por tecnico, CSV): solo se ven en el detalle si se pide.
  const activos = useMemo(() => rows.filter((r) => !r.anulado), [rows]);
  const regiones = useMemo(() => Array.from(new Set(activos.map((r) => r.region).filter((r) => r !== null))).sort((a, b) => a - b), [activos]);
  const tecnicos = useMemo(() => Array.from(new Set(activos.map((r) => r.technician_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")), [activos]);
  const pasa = (r) => (!regionQ || String(r.region) === regionQ) && (!techQ || r.technician_name === techQ) && (!resQ || r.resultado === resQ);
  const f = useMemo(() => activos.filter(pasa), [activos, regionQ, techQ, resQ]);
  const anuladosVisibles = useMemo(() => rows.filter((r) => r.anulado && pasa(r)), [rows, regionQ, techQ, resQ]);

  const tot = useMemo(() => {
    const prod = f.reduce((s, r) => s + (Number(r.quantity) || 1), 0);
    const rea = f.filter((r) => r.resultado === "Realizado").reduce((s, r) => s + (Number(r.quantity) || 1), 0);
    return {
      dias: new Set(f.map((r) => r.day)).size, servicios: new Set(f.map((r) => `${r.day}|${r.servicio}`)).size,
      movimientos: new Set(f.map((r) => `${r.day}|${r.ciudad}|${r.direccion}`)).size, productos: prod, realizados: rea, noRealizados: prod - rea,
      minutos: f.reduce((s, r) => s + (r.tiempo_min || 0), 0),
    };
  }, [f]);

  const porDia = useMemo(() => {
    const m = {};
    f.forEach((r) => { const g = (m[r.day] = m[r.day] || { dia: r.day, Realizados: 0, "No realizados": 0 }); g[r.resultado === "Realizado" ? "Realizados" : "No realizados"] += Number(r.quantity) || 1; });
    return Object.values(m).sort((a, b) => a.dia.localeCompare(b.dia)).map((g) => ({ ...g, etiqueta: shortDay(g.dia) }));
  }, [f]);
  const porRegion = useMemo(() => {
    const m = {};
    f.forEach((r) => { const k = r.region ?? "?"; const g = (m[k] = m[k] || { region: k, Realizados: 0, "No realizados": 0 }); g[r.resultado === "Realizado" ? "Realizados" : "No realizados"] += Number(r.quantity) || 1; });
    return Object.values(m).sort((a, b) => Number(a.region) - Number(b.region)).map((g) => ({ ...g, etiqueta: label(g.region === "?" ? null : Number(g.region)) }));
  }, [f, regionInfo]);
  const porTecnico = useMemo(() => aggregateHistory(f).sort((a, b) => (a.region ?? 999) - (b.region ?? 999) || (orderOf[a.techId] ?? 9999) - (orderOf[b.techId] ?? 9999) || a.name.localeCompare(b.name, "es")), [f, orderOf]);
  const topTec = useMemo(() => [...porTecnico].sort((a, b) => b.realizados - a.realizados).slice(0, 10).map((g) => ({ name: g.name, Realizados: g.realizados, "No realizados": g.noRealizados })), [porTecnico]);
  const causales = useMemo(() => {
    const m = {};
    f.filter((r) => r.resultado === "No realizado").forEach((r) => { const k = r.causal_auditada || r.causal_extreme || "Sin causal"; m[k] = (m[k] || 0) + (Number(r.quantity) || 1); });
    return Object.entries(m).map(([name, value]) => ({ name: name.length > 34 ? name.slice(0, 34) + "…" : name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [f]);

  // Buscador por servicio: uno o varios números separados por espacio, coma o salto de línea (también encuentra por número de PQR o parte del número).
  const terminos = useMemo(() => servicioQ.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean), [servicioQ]);
  const detalle = useMemo(() => [...f, ...(verAnulados ? anuladosVisibles : [])].filter((r) => !terminos.length || terminos.some((x) => String(r.servicio || "").toUpperCase().includes(x))).sort((a, b) => b.day.localeCompare(a.day) || (a.region ?? 999) - (b.region ?? 999) || (orderOf[a.technician_id] ?? 9999) - (orderOf[b.technician_id] ?? 9999) || (a.ruta_orden ?? 999) - (b.ruta_orden ?? 999)), [f, anuladosVisibles, verAnulados, orderOf, terminos]);
  const PAGE = 50;

  const exportTec = () => ui.downloadCSV("historico_por_tecnico.csv",
    ["Región", "Técnico", "Servicios", "Movimientos (direcciones)", "Productos", "Minutos de producto", "Realizados", "No realizados", "% efectividad"],
    porTecnico.map((g) => [label(g.region), g.name, g.servicios, g.movimientos, g.productos, g.minutos, g.realizados, g.noRealizados, `${pct(g.realizados, g.productos)}%`]));
  // Usuarios de Extreme: del técnico (por su ficha en Personal) y del apoyo (por nombre), según Personal hoy.
  const extremeDeTecnico = (r) => { const t = db.technicians.find((x) => x.id === r.technician_id) || db.technicians.find((x) => plano(x.name) === plano(r.technician_name)); return (t && t.extremeUser) || ""; };
  const extremeDeApoyo = (r) => { const t = r.helper_name ? db.technicians.find((x) => plano(x.name) === plano(r.helper_name)) : null; return (t && t.extremeUser) || ""; };
  // Mismo CSV que el de Carga (mismas columnas y orden). Los días cerrados desde este cambio guardan la fila completa; los anteriores se arman con lo que se guardó.
  const exportDet = () => {
    const ctx = { technicians: db.technicians, regionLabel: label, coordDe: (d) => zona.coordDe(d) };
    const orden = [...detalle].filter((r) => !r.anulado).sort((a, b) => b.day.localeCompare(a.day) || (a.csv_orden ?? 1e9) - (b.csv_orden ?? 1e9));
    ui.downloadCSV("historico_detalle.csv", CSV_CARGA_HEADERS, filasCsvDeHistorico({ rows: orden, services: db.services, technicians: db.technicians, causales: db.causales, regionLabel: label, coordDe: ctx.coordDe }));
  };

  const confirmarAnular = async () => {
    setBusyAnular(true); setErrAnular("");
    try {
      const guardado = await anularHistoryRow(anulando.id, motivo);
      setRows((rs) => rs.map((x) => (x.id === guardado.id ? guardado : x)));
      if (persist && addAudit) persist(addAudit(db, { userId: session.id, action: "Anulación de registro del histórico de asignación", record: `${anulando.servicio} · ${anulando.day}`, oldValue: anulando.producto || "-", newValue: motivo.trim().slice(0, 480) }));
      setAnulando(null); setMotivo("");
    } catch (e) { setErrAnular(`${e.message}. Si es la primera vez, falta correr el SQL de anular histórico (sql/60) en Supabase.`); }
    setBusyAnular(false);
  };
  const restaurar = async (r) => {
    setErrAnular("");
    try {
      const guardado = await restaurarHistoryRow(r.id);
      setRows((rs) => rs.map((x) => (x.id === guardado.id ? guardado : x)));
      if (persist && addAudit) persist(addAudit(db, { userId: session.id, action: "Restauración de registro del histórico de asignación", record: `${r.servicio} · ${r.day}`, oldValue: r.producto || "-", newValue: `Estaba anulado: ${r.anulado_motivo || "-"}`.slice(0, 480) }));
    } catch (e) { setErrAnular(e.message); }
  };

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label className="amg-label" style={{ margin: 0 }}>Desde</label>
        <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <label className="amg-label" style={{ margin: 0 }}>Hasta</label>
        <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <select className="amg-select" style={{ width: 190 }} value={regionQ} onChange={(e) => setRegionQ(e.target.value)}>
          <option value="">Todas las regiones</option>{regiones.map((r) => <option key={r} value={String(r)}>{label(r)}</option>)}
        </select>
        <select className="amg-select" style={{ width: 200 }} value={techQ} onChange={(e) => setTechQ(e.target.value)}>
          <option value="">Todos los técnicos</option>{tecnicos.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="amg-select" style={{ width: 150 }} value={resQ} onChange={(e) => setResQ(e.target.value)}>
          <option value="">Todo resultado</option><option>Realizado</option><option>No realizado</option>
        </select>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[["7 días", 6], ["30 días", 29], ["90 días", 89]].map(([t, n]) => <button key={t} className="amg-btn" onClick={() => { setFrom(addDays(hoy, -n)); setTo(hoy); }}>{t}</button>)}
        </div>
      </div>

      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}. Si es la primera vez, falta correr el SQL del histórico (sql/18) en Supabase.</div>}
      {loading && <div style={{ color: "var(--text-faint)", marginBottom: 10 }}>Cargando histórico...</div>}
      {errAnular && !anulando && <div className="amg-alert danger"><AlertTriangle size={14} /> {errAnular}</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="amg-card" style={{ padding: 24, textAlign: "center", color: "var(--text-dim)" }}>
          Aún no hay días finalizados en este rango. El histórico se llena cuando en <b>Carga → Auditoría / Edición</b> pulsas <b>Finalizar día</b>.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
            <ui.StatCard label="Días finalizados" value={fmt(tot.dias)} />
            <ui.StatCard label="Servicios" value={fmt(tot.servicios)} sub={`${fmt(tot.movimientos)} movimientos`} />
            <ui.StatCard label="Productos asignados" value={fmt(tot.productos)} sub={`${fmt(tot.minutos)} min de producto`} />
            <ui.StatCard label="Efectividad" value={`${pct(tot.realizados, tot.productos)}%`} sub={`${fmt(tot.realizados)} realizados`} accent />
            <ui.StatCard label="No realizados" value={fmt(tot.noRealizados)} sub="volvieron a pendientes" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px,1fr))", gap: 14, marginBottom: 16 }}>
            <Panel title="Productos por día (realizados vs. no realizados)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={porDia}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="etiqueta" tick={{ fill: AXIS, fontSize: 10 }} /><YAxis tick={{ fill: AXIS, fontSize: 10 }} />
                  <Tooltip /><Legend /><Bar dataKey="Realizados" stackId="a" fill={GREEN} /><Bar dataKey="No realizados" stackId="a" fill={RED} /></BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Por región">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={porRegion}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="etiqueta" tick={{ fill: AXIS, fontSize: 10 }} /><YAxis tick={{ fill: AXIS, fontSize: 10 }} />
                  <Tooltip /><Legend /><Bar dataKey="Realizados" stackId="a" fill={GREEN} /><Bar dataKey="No realizados" stackId="a" fill={RED} /></BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Top 10 técnicos (productos realizados)">
              <ResponsiveContainer width="100%" height={Math.max(220, topTec.length * 26)}>
                <BarChart data={topTec} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis type="number" tick={{ fill: AXIS, fontSize: 10 }} /><YAxis type="category" dataKey="name" width={150} tick={{ fill: AXIS, fontSize: 10 }} />
                  <Tooltip /><Legend /><Bar dataKey="Realizados" stackId="a" fill={GREEN} /><Bar dataKey="No realizados" stackId="a" fill={RED} /></BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Causales de lo no realizado (top 8)">
              {causales.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 20 }}>No hay productos no realizados en este rango.</div> : (
                <ResponsiveContainer width="100%" height={Math.max(220, causales.length * 28)}>
                  <BarChart data={causales} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis type="number" tick={{ fill: AXIS, fontSize: 10 }} /><YAxis type="category" dataKey="name" width={190} tick={{ fill: AXIS, fontSize: 10 }} />
                    <Tooltip /><Bar dataKey="value" name="Productos" fill={ACCENT} /></BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 12 }}>
            <div className={`amg-tab ${tab === "tecnico" ? "active" : ""}`} onClick={() => setTab("tecnico")}>Por técnico</div>
            <div className={`amg-tab ${tab === "detalle" ? "active" : ""}`} onClick={() => setTab("detalle")}>Detalle de servicios</div>
            {tab === "detalle" && (
              <input className="amg-input" style={{ width: 260, marginLeft: 12, marginBottom: 6 }} placeholder="Buscar servicio (uno o varios números)..." value={servicioQ} onChange={(e) => setServicioQ(e.target.value)} />
            )}
            {tab === "detalle" && esAdmin && rows.some((r) => r.anulado) && (
              <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", marginLeft: 12, marginBottom: 6 }}><input type="checkbox" checked={verAnulados} onChange={(e) => setVerAnulados(e.target.checked)} /> Ver anulados ({anuladosVisibles.length})</label>
            )}
            {esAdmin && <button className="amg-btn" style={{ marginLeft: "auto", marginBottom: 6 }} title="Solo administrador: quién modificó los registros, qué cambió y cuándo (auditoría)" onClick={() => setCambiosOpen(true)}><History size={14} /> Ver cambios</button>}
            <button className="amg-btn" style={{ marginLeft: esAdmin ? 8 : "auto", marginBottom: 6 }} onClick={tab === "tecnico" ? exportTec : exportDet}><Download size={14} /> Exportar CSV</button>
          </div>

          {tab === "tecnico" && (
            <div className="amg-card" style={{ overflowX: "auto" }}>
              <table className="amg-table">
                <thead><tr><th>Región</th><th>Técnico</th><th>Servicios</th><th>Movimientos</th><th>Productos</th><th>Minutos</th><th>Realizados</th><th>No realizados</th><th>Efectividad</th></tr></thead>
                <tbody>{porTecnico.map((g) => (
                  <tr key={`${g.techId}|${g.name}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{label(g.region)}</td><td>{g.name}</td>
                    <td className="amg-mono">{g.servicios}</td><td className="amg-mono">{g.movimientos}</td><td className="amg-mono">{g.productos}</td><td className="amg-mono">{fmt(g.minutos)}</td>
                    <td className="amg-mono" style={{ color: "var(--green)" }}>{g.realizados}</td><td className="amg-mono" style={{ color: g.noRealizados ? "var(--red)" : undefined }}>{g.noRealizados}</td>
                    <td className="amg-mono">{pct(g.realizados, g.productos)}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {tab === "detalle" && (
            <div>
              <div className="amg-card" style={{ overflowX: "auto" }}>
                <table className="amg-table" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Día</th><th>Región</th><th>Técnico</th><th>#</th><th>Servicio</th><th>Producto</th><th>Barrio</th><th>Dirección</th><th>Resultado</th><th>Causal</th>{esAdmin && <th></th>}</tr></thead>
                  <tbody>{detalle.length === 0 && <tr><td colSpan={esAdmin ? 11 : 10} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{terminos.length ? "Ningún servicio coincide con la búsqueda en este rango de fechas." : "Sin registros para estos filtros."}</td></tr>}{detalle.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                    <tr key={r.id} style={r.anulado ? { opacity: 0.55, textDecoration: "line-through" } : undefined} title={r.anulado ? `Anulado: ${r.anulado_motivo || "-"}` : undefined}>
                      <td className="amg-mono">{ui.fmtDate(r.day)}</td><td style={{ whiteSpace: "nowrap" }}>{label(r.region)}</td><td>{r.technician_name || "-"}</td><td className="amg-mono">{r.ruta_orden ?? "-"}</td>
                      <td className="amg-mono">{r.servicio}</td><td>{r.producto}</td><td>{r.barrio || "-"}</td><td><ui.HoverText text={r.direccion} maxChars={30} /></td>
                      <td>{r.anulado ? <ui.Badge text="Anulado" color="amber" /> : <ui.Badge text={r.resultado} color={r.resultado === "Realizado" ? "green" : "red"} />}</td><td>{r.causal_auditada || r.causal_extreme || "-"}</td>
                      {esAdmin && <td style={{ whiteSpace: "nowrap" }}>
                        {r.anulado
                          ? <button className="amg-btn ghost" style={{ padding: 4 }} title={`Restaurar este registro (anulado: ${r.anulado_motivo || "-"})`} onClick={() => restaurar(r)}><RotateCcw size={13} /></button>
                          : <><button className="amg-btn ghost" style={{ padding: 4 }} title="Editar este registro (solo administrador)" onClick={() => setEditando(r)}><Pencil size={13} /></button>
                            <button className="amg-btn ghost" style={{ padding: 4 }} title="Anular este registro (solo administrador): no cuenta en el histórico ni en los reportes, y se puede restaurar" onClick={() => { setAnulando(r); setMotivo(""); setErrAnular(""); }}><Ban size={13} /></button></>}
                      </td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>
                <span>Mostrando {detalle.length ? page * PAGE + 1 : 0}–{Math.min(detalle.length, page * PAGE + PAGE)} de {fmt(detalle.length)}{terminos.length ? ` (filtrado por servicio: ${terminos.join(", ")})` : ""}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="amg-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>← Anterior</button>
                  <button className="amg-btn" disabled={(page + 1) * PAGE >= detalle.length} onClick={() => setPage(page + 1)}>Siguiente →</button>
                </span>
              </div>
            </div>
          )}
          {anulando && (
            <ui.ConfirmModal title={`Anular el registro del servicio ${anulando.servicio}`} confirmLabel={busyAnular ? "Anulando..." : "Anular registro"} danger onConfirm={() => { if (motivo.trim() && !busyAnular) confirmarAnular(); }} onClose={() => setAnulando(null)}
              message={`${ui.fmtDate(anulando.day)} · ${anulando.producto || "-"} · ${anulando.technician_name || "sin técnico"}. El registro no se borra: queda anulado con su motivo y deja de contar en el histórico, el CSV, el informe de cierre, el resumen de rutas y los viáticos. Lo puedes restaurar cuando quieras.`}>
              <label className="amg-label">Motivo de la anulación</label><input className="amg-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              {errAnular && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {errAnular}</div>}
            </ui.ConfirmModal>
          )}
          {cambiosOpen && <CambiosRegistros db={db} ui={ui} modulo="historico" initialQ={servicioQ} onClose={() => setCambiosOpen(false)} />}
          {editando && <EditarHistoricoModal ui={ui} db={db} row={editando} onClose={() => setEditando(null)} onSave={(guardado, antes) => {
            setRows((rs) => rs.map((x) => (x.id === guardado.id ? guardado : x)));
            setEditando(null);
            const cambios = ["technician_name", "helper_name", "resultado", "estado_extreme", "causal_extreme", "causal_auditada", "diagnostico", "cliente", "direccion", "ciudad", "barrio", "notas", "solucion", "primer_piso"]
              .filter((k) => (antes[k] || "") !== (guardado[k] || "")).map((k) => `${k}: ${antes[k] || "-"} → ${guardado[k] || "-"}`).join("; ");
            if (persist && addAudit) persist(addAudit(db, { userId: session.id, action: "Edición de histórico de asignación", record: `${antes.servicio} · ${antes.day}`, oldValue: antes.producto || "-", newValue: cambios.slice(0, 480) || "sin cambios" }));
          }} />}
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>Efectividad = productos realizados sobre productos asignados. Movimientos = direcciones distintas atendidas el mismo día. Lo no realizado vuelve a pendientes para reasignarse; este histórico conserva el resultado de cada día tal como se cerró.</div>
        </>
      )}
    </div>
  );
}
