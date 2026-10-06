import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download, AlertTriangle } from "lucide-react";
import { fetchHistory, aggregateHistory, loadRegionInfo } from "./lib/asignacion/history";

/* ============================================================================
   HISTÓRICO DE ASIGNACIÓN
   Todo lo que se finalizó con "Finalizar día" en Carga: qué se asignó a cada técnico,
   qué se realizó y qué no (con su causal). Sirve de base para el tablero y los reportes.
============================================================================ */

const GREEN = "#3F9D6E", RED = "#C0463A", ACCENT = "#D98D34", GRID = "#E3D8C4", AXIS = "#6B5D4D";
const fmt = (n) => Number(n || 0).toLocaleString("es-CO");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const shortDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function Panel({ title, children }) {
  return <div className="amg-card" style={{ padding: 14 }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{title}</div>{children}</div>;
}

export default function HistoricoModule({ db, ui }) {
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

  useEffect(() => { loadRegionInfo().then(setRegionInfo); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    fetchHistory({ from, to }).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to]);
  useEffect(() => { setPage(0); }, [regionQ, techQ, resQ, from, to, tab]);

  const label = (r) => (regionInfo ? regionInfo.label(r) : r === null || r === undefined ? "Sin región" : `Región ${r}`);
  const orderOf = useMemo(() => Object.fromEntries(db.technicians.map((t) => [t.id, t.assignOrder ?? 9999])), [db.technicians]);

  const regiones = useMemo(() => Array.from(new Set(rows.map((r) => r.region).filter((r) => r !== null))).sort((a, b) => a - b), [rows]);
  const tecnicos = useMemo(() => Array.from(new Set(rows.map((r) => r.technician_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")), [rows]);
  const f = useMemo(() => rows.filter((r) => (!regionQ || String(r.region) === regionQ) && (!techQ || r.technician_name === techQ) && (!resQ || r.resultado === resQ)), [rows, regionQ, techQ, resQ]);

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

  const detalle = useMemo(() => [...f].sort((a, b) => b.day.localeCompare(a.day) || (a.region ?? 999) - (b.region ?? 999) || (orderOf[a.technician_id] ?? 9999) - (orderOf[b.technician_id] ?? 9999) || (a.ruta_orden ?? 999) - (b.ruta_orden ?? 999)), [f, orderOf]);
  const PAGE = 50;

  const exportTec = () => ui.downloadCSV("historico_por_tecnico.csv",
    ["Región", "Técnico", "Servicios", "Movimientos (direcciones)", "Productos", "Minutos de producto", "Realizados", "No realizados", "% efectividad"],
    porTecnico.map((g) => [label(g.region), g.name, g.servicios, g.movimientos, g.productos, g.minutos, g.realizados, g.noRealizados, `${pct(g.realizados, g.productos)}%`]));
  const exportDet = () => ui.downloadCSV("historico_detalle.csv",
    ["Día", "Región", "Técnico", "Apoyo", "Orden de ruta", "Servicio", "Código", "Producto", "Cantidad", "Minutos", "Ciudad", "Barrio", "Dirección", "Cliente", "Resultado", "Estado Extreme", "Causal Extreme", "Causal auditada"],
    detalle.map((r) => [ui.fmtDate(r.day), label(r.region), r.technician_name, r.helper_name, r.ruta_orden, r.servicio, r.codigo, r.producto, r.quantity, r.tiempo_min, r.ciudad, r.barrio, r.direccion, r.cliente, r.resultado, r.estado_extreme, r.causal_extreme, r.causal_auditada]));

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
            <button className="amg-btn" style={{ marginLeft: "auto", marginBottom: 6 }} onClick={tab === "tecnico" ? exportTec : exportDet}><Download size={14} /> Exportar CSV</button>
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
                  <thead><tr><th>Día</th><th>Región</th><th>Técnico</th><th>#</th><th>Servicio</th><th>Producto</th><th>Barrio</th><th>Dirección</th><th>Resultado</th><th>Causal</th></tr></thead>
                  <tbody>{detalle.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                    <tr key={r.id}>
                      <td className="amg-mono">{ui.fmtDate(r.day)}</td><td style={{ whiteSpace: "nowrap" }}>{label(r.region)}</td><td>{r.technician_name || "-"}</td><td className="amg-mono">{r.ruta_orden ?? "-"}</td>
                      <td className="amg-mono">{r.servicio}</td><td>{r.producto}</td><td>{r.barrio || "-"}</td><td><ui.HoverText text={r.direccion} maxChars={30} /></td>
                      <td><ui.Badge text={r.resultado} color={r.resultado === "Realizado" ? "green" : "red"} /></td><td>{r.causal_auditada || r.causal_extreme || "-"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>
                <span>Mostrando {detalle.length ? page * PAGE + 1 : 0}–{Math.min(detalle.length, page * PAGE + PAGE)} de {fmt(detalle.length)}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="amg-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>← Anterior</button>
                  <button className="amg-btn" disabled={(page + 1) * PAGE >= detalle.length} onClick={() => setPage(page + 1)}>Siguiente →</button>
                </span>
              </div>
            </div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>Efectividad = productos realizados sobre productos asignados. Movimientos = direcciones distintas atendidas el mismo día. Lo no realizado vuelve a pendientes para reasignarse; este histórico conserva el resultado de cada día tal como se cerró.</div>
        </>
      )}
    </div>
  );
}
