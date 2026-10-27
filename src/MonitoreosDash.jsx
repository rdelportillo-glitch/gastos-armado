import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from "recharts";
import { AlertTriangle, Download } from "lucide-react";
import * as M from "./lib/monitoreos/monData";
import * as C from "./lib/monitoreos/cronogramaData";
import { useZonaCoord, SIN_COORD } from "./lib/useCoordinadores";

/* Dashboard de monitoreos (grupo Resumen): resultados de los monitoreos digitales y presenciales — calificación promedio, semáforo, errores críticos,
   componentes con más fallas y ranking por técnico, departamento y coordinador. */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (k) => { const [y, m] = k.split("-"); return `${MESES[+m - 1]} ${String(y).slice(2)}`; };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const prom = (l) => (l.length ? l.reduce((s, r) => s + Number(r.score || 0), 0) / l.length : 0);
const pct = (a, b) => (b ? (a / b) * 100 : 0);

function Tarjeta({ titulo, children, alto }) {
  return <div className="amg-card" style={{ padding: 14, minHeight: alto }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{titulo}</div>{children}</div>;
}

function ResultadosMonitoreos({ db, ui }) {
  const hoy = ui.todayISO();
  const [cfg, setCfg] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [f, setF] = useState({ canal: "", desde: addDays(hoy, -89), hasta: hoy, depto: "", coord: "" });
  const zona = useZonaCoord(db, true);

  useEffect(() => {
    let vivo = true;
    setLoading(true); setError("");
    Promise.all([M.loadMonConfig(), M.listRecords({ desde: f.desde || undefined, hasta: f.hasta || undefined })])
      .then(([c, r]) => { if (vivo) { setCfg(c); setRecords(r); } })
      .catch((e) => { if (vivo) { setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL de Monitoreos (sql/36).`); setCfg((c) => c || M.configInicial()); } })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [f.desde, f.hasta]);

  const deptos = useMemo(() => [...new Set(records.map((r) => r.department).filter(Boolean))].sort(), [records]);
  const rows = useMemo(() => records.filter((r) => r.status === "Activo" && (!f.canal || r.channel === f.canal) && zona.pasa(r.department, f.depto, f.coord)), [records, f.canal, f.depto, f.coord, zona.nombres]);

  const d = useMemo(() => {
    if (!cfg) return null;
    const n = rows.length;
    const verde = (cfg.semaforo || []).slice().sort((a, b) => b.min - a.min)[0];
    const porSem = (cfg.semaforo || []).map((s) => ({ name: s.nombre, value: rows.filter((r) => r.traffic_light === s.nombre).length, color: s.color }));
    const positivas = rows.filter((r) => Number(r.score) >= 80).length;
    const crit = rows.filter((r) => r.critical_error);
    // Resultado de cada componente (solo los canales que se estén viendo)
    const canales = f.canal ? [f.canal] : M.CANALES;
    const compKpi = canales.flatMap((canal) => M.componentesActivos(cfg, canal).map((c) => {
      const del = rows.filter((r) => r.channel === canal);
      const neg = del.filter((r) => (r.results || []).some((x) => x.id === c.id && x.resultado === "NEGATIVO")).length;
      return { name: `${canal === "Digital" ? "Dig" : "Pres"} ${c.codigo} ${c.nombre}`, negativos: Math.round(pct(neg, del.length) * 10) / 10, n: del.length };
    })).filter((x) => x.n > 0);
    const agrupa = (key) => { const m = new Map(); rows.forEach((r) => { const k = r[key] || "Sin dato"; const e = m.get(k) || []; e.push(r); m.set(k, e); }); return [...m.entries()].map(([name, l]) => ({ name, promedio: Math.round(prom(l) * 10) / 10, n: l.length, rojos: l.filter((r) => r.traffic_light === "Rojo").length })); };
    const meses = new Map(); rows.forEach((r) => { const k = String(r.audit_date).slice(0, 7); const e = meses.get(k) || []; e.push(r); meses.set(k, e); });
    const tipos = new Map(); crit.forEach((r) => tipos.set(r.critical_type || "Sin tipo", (tipos.get(r.critical_type || "Sin tipo") || 0) + 1));
    return {
      n, promedio: prom(rows), positivas, verdePct: pct(rows.filter((r) => verde && r.traffic_light === verde.nombre).length, n), rojoPct: pct(rows.filter((r) => r.traffic_light === "Rojo").length, n), critPct: pct(crit.length, n),
      porSem, compKpi, tendencia: [...meses.entries()].sort().map(([k, l]) => ({ name: mesLabel(k), promedio: Math.round(prom(l) * 10) / 10, monitoreos: l.length })),
      porDepto: agrupa("department").sort((a, b) => a.promedio - b.promedio), porCoord: agrupa("coordinator").sort((a, b) => a.promedio - b.promedio),
      porTecnico: agrupa("technician_name").sort((a, b) => a.promedio - b.promedio), tipos: [...tipos.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    };
  }, [rows, cfg, f.canal]);

  const exportar = () => ui.downloadCSV(`monitoreos_resultados_${hoy}.csv`, ["Técnico", "Monitoreos", "Calificación promedio (%)", "En rojo"], d.porTecnico.map((t) => [t.name, t.n, t.promedio, t.rojos]));

  if (!cfg || !d) return <div style={{ color: "var(--text-faint)" }}>{error ? <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div> : "Cargando..."}</div>;

  const Barras = ({ datos, color = "var(--accent)", ancho = 150, alto, clave = "promedio", fmt = (v) => `${v}%` }) => (
    datos.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 12.5, padding: 16, textAlign: "center" }}>Sin datos</div> : (
      <ResponsiveContainer width="100%" height={alto || Math.max(120, datos.length * 28 + 30)}>
        <BarChart data={datos} layout="vertical" margin={{ left: 0, right: 24 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={ancho} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => fmt(v)} /><Bar dataKey={clave} fill={color} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )
  );

  return (
    <div>
      {error && <div className="amg-alert danger" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> {error}</div>}
      <div className="amg-card" style={{ padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <select className="amg-select" style={{ width: 190 }} value={f.canal} onChange={(e) => setF({ ...f, canal: e.target.value })}><option value="">Digital y presencial</option>{M.CANALES.map((c) => <option key={c} value={c}>{M.NOMBRE_CANAL[c]}</option>)}</select>
        <label style={{ fontSize: 12.5 }}>Desde <input type="date" className="amg-input" style={{ width: 145 }} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
        <label style={{ fontSize: 12.5 }}>hasta <input type="date" className="amg-input" style={{ width: 145 }} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
        {[["30 días", 29], ["90 días", 89], ["1 año", 364]].map(([t, n]) => <button key={t} className="amg-btn" onClick={() => setF({ ...f, desde: addDays(hoy, -n), hasta: hoy })}>{t}</button>)}
        <button className="amg-btn" onClick={() => setF({ ...f, desde: "", hasta: "" })}>Todo</button>
        <select className="amg-select" style={{ width: 170 }} value={f.depto} onChange={(e) => setF({ ...f, depto: e.target.value })}><option value="">Todos los departamentos</option>{deptos.map((x) => <option key={x}>{x}</option>)}</select>
        <select className="amg-select" style={{ width: 190 }} value={f.coord} onChange={(e) => setF({ ...f, coord: e.target.value })}><option value="">Todos los coordinadores</option>{zona.nombres.map((x) => <option key={x} value={x}>{x}</option>)}<option value={SIN_COORD}>Sin coordinador</option></select>
        <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={exportar} disabled={!d.n}><Download size={14} /> Exportar por técnico (CSV)</button>
      </div>
      {loading && <div style={{ color: "var(--text-faint)", marginBottom: 8 }}>Calculando...</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Monitoreos" value={d.n} sub="activos en el rango" accent />
        <ui.StatCard label="Calificación promedio" value={d.n ? M.fmtPct(d.promedio) : "-"} sub={d.n ? M.semaforoDe(cfg, d.promedio).nombre : ""} />
        <ui.StatCard label="Aprobados (≥ 80%)" value={d.n ? M.fmtPct(pct(d.positivas, d.n)) : "-"} sub={`${d.positivas} de ${d.n}`} />
        <ui.StatCard label="Semáforo verde" value={d.n ? M.fmtPct(d.verdePct) : "-"} sub="del total" />
        <ui.StatCard label="Semáforo rojo" value={d.n ? M.fmtPct(d.rojoPct) : "-"} sub="del total" />
        <ui.StatCard label="Con error crítico" value={d.n ? M.fmtPct(d.critPct) : "-"} sub={`${rows.filter((r) => r.critical_error).length} monitoreo(s)`} />
      </div>

      {d.n === 0 ? <div className="amg-card" style={{ padding: 24, textAlign: "center", color: "var(--text-faint)" }}>No hay monitoreos para estos filtros.</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, marginBottom: 14 }}>
            <Tarjeta titulo="Distribución por semáforo">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart><Pie data={d.porSem.filter((s) => s.value > 0)} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} label={(e) => `${e.name} ${e.value}`}>
                  {d.porSem.filter((s) => s.value > 0).map((s) => <Cell key={s.name} fill={s.color} />)}</Pie><Tooltip /><Legend /></PieChart>
              </ResponsiveContainer>
            </Tarjeta>
            <Tarjeta titulo="Calificación promedio por mes">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={d.tendencia} margin={{ left: 0, right: 12 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => (n === "promedio" ? `${v}%` : v)} /><Line type="monotone" dataKey="promedio" name="promedio" stroke="var(--accent)" strokeWidth={2} dot /></LineChart>
              </ResponsiveContainer>
            </Tarjeta>
            <Tarjeta titulo="% de monitoreos con el componente en NEGATIVO"><Barras datos={d.compKpi} color="#C0463A" clave="negativos" ancho={190} /></Tarjeta>
            <Tarjeta titulo="Errores críticos por tipo">
              {d.tipos.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 12.5, padding: 16, textAlign: "center" }}>Sin errores críticos en el rango</div> : d.tipos.map((t) => (
                <div key={t.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--border)" }}><span>{t.name}</span><b className="amg-mono">{t.value}</b></div>))}
            </Tarjeta>
            <Tarjeta titulo="Calificación promedio por departamento"><Barras datos={d.porDepto} ancho={110} /></Tarjeta>
            <Tarjeta titulo="Calificación promedio por coordinador"><Barras datos={d.porCoord} ancho={130} /></Tarjeta>
          </div>

          <div className="amg-card" style={{ overflow: "auto", marginBottom: 14 }}>
            <div style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13 }}>Resultados por técnico (de menor a mayor calificación)</div>
            <table className="amg-table compact">
              <thead><tr><th>Técnico</th><th>Monitoreos</th><th>Calificación promedio</th><th>Semáforo</th><th>En rojo</th></tr></thead>
              <tbody>{d.porTecnico.slice(0, 200).map((t) => { const s = M.semaforoDe(cfg, t.promedio); return (
                <tr key={t.name}><td>{t.name}</td><td className="amg-mono">{t.n}</td><td className="amg-mono"><b>{M.fmtPct(t.promedio)}</b></td>
                  <td><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 10, background: s.color }} />{s.nombre}</span></td><td className="amg-mono">{t.rojos}</td></tr>); })}</tbody>
            </table>
          </div>
        </>
      )}
      <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Solo cuentan los monitoreos activos (no los anulados). Aprobado = calificación de 80% o más. Los pesos, el semáforo y los errores críticos se configuran en Maestros → Monitoreos.</div>
    </div>
  );
}

/* ------------------------- Cumplimiento del cronograma ------------------------- */

function CumplimientoCronograma({ db, ui }) {
  const hoy = ui.todayISO();
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [cron, setCron] = useState(null);
  const [entradas, setEntradas] = useState([]);
  const [recMes, setRecMes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const tec = useMemo(() => Object.fromEntries(db.technicians.map((t) => [t.id, t])), [db.technicians]);

  useEffect(() => {
    let vivo = true; setLoading(true); setError("");
    const r = C.rangoMes(mes);
    Promise.all([C.loadCronConfig(), C.listSchedule(mes), M.listRecords({ desde: r.desde, hasta: r.hasta })])
      .then(([c, e, rec]) => { if (vivo) { setCron(c); setEntradas(e); setRecMes(rec); } })
      .catch((e) => { if (vivo) setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL del cronograma de monitoreos (sql/37).`); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [mes]);

  const vivas = useMemo(() => entradas.filter((e) => e.status !== "Cancelado"), [entradas]);
  const estados = useMemo(() => C.estadoEntradas(entradas, recMes, hoy), [entradas, recMes, hoy]);
  const dias = useMemo(() => C.diasHabiles(mes, (cron && cron.params.diasNoHabiles) || []), [mes, cron]);
  const est = (e) => (estados.get(e.id) || {}).estado || "Pendiente";
  const nReal = vivas.filter((e) => est(e) === "Realizado").length, nVenc = vivas.filter((e) => est(e) === "Vencido").length;
  const activos = recMes.filter((r) => r.status === "Activo");

  const porAuditor = useMemo(() => {
    const m = new Map();
    (cron ? cron.auditores : []).forEach((a) => m.set(a.personId, { name: (tec[a.personId] || {}).name || "(auditor)", meta: Number(a.monitoreosMes) || 0, prog: 0, real: 0, venc: 0 }));
    vivas.forEach((e) => { const k = e.auditor_person_id || "sin"; const x = m.get(k) || { name: "Sin auditor", meta: 0, prog: 0, real: 0, venc: 0 }; x.prog++; if (est(e) === "Realizado") x.real++; if (est(e) === "Vencido") x.venc++; m.set(k, x); });
    return [...m.values()].map((x) => ({ ...x, pct: x.prog ? Math.round((x.real / x.prog) * 1000) / 10 : 0 }));
  }, [vivas, estados, cron, tec]);
  const porSemana = useMemo(() => {
    const m = new Map();
    vivas.forEach((e) => { const s = C.semanaDelMes(e.planned_date, dias) || 1; const x = m.get(s) || { name: `Sem ${s}`, programados: 0, realizados: 0 }; x.programados++; if (est(e) === "Realizado") x.realizados++; m.set(s, x); });
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }, [vivas, estados, dias]);
  const porDepto = useMemo(() => {
    const m = new Map();
    vivas.forEach((e) => { const k = (tec[e.technician_id] || {}).department || "Sin dato"; const x = m.get(k) || { name: k, programados: 0, realizados: 0 }; x.programados++; if (est(e) === "Realizado") x.realizados++; m.set(k, x); });
    return [...m.values()].map((x) => ({ ...x, pct: Math.round((x.realizados / x.programados) * 1000) / 10 })).sort((a, b) => a.pct - b.pct);
  }, [vivas, estados, tec]);
  const pendientes = vivas.filter((e) => est(e) !== "Realizado").sort((a, b) => a.planned_date.localeCompare(b.planned_date));

  return (
    <div>
      {error && <div className="amg-alert danger" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> {error}</div>}
      <div className="amg-card" style={{ padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button className="amg-btn" onClick={() => setMes(C.mesAnterior(mes))}>‹</button>
        <div style={{ fontWeight: 700, minWidth: 140, textAlign: "center", textTransform: "capitalize" }}>{C.nombreMes(mes)}</div>
        <button className="amg-btn" onClick={() => setMes(C.mesSiguiente(mes))}>›</button>
        <button className="amg-btn" onClick={() => setMes(hoy.slice(0, 7))}>Este mes</button>
        {loading && <span style={{ color: "var(--text-faint)", fontSize: 12 }}>Calculando...</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Programados" value={vivas.length} sub="monitoreos en el cronograma" accent />
        <ui.StatCard label="Realizados" value={nReal} sub={vivas.length ? M.fmtPct((nReal / vivas.length) * 100) : "-"} />
        <ui.StatCard label="Pendientes" value={vivas.length - nReal - nVenc} />
        <ui.StatCard label="Vencidos" value={nVenc} sub="fecha pasada sin monitoreo" />
        <ui.StatCard label="Monitoreos registrados" value={activos.length} sub="en el mes (con o sin cronograma)" />
        <ui.StatCard label="Calificación promedio" value={activos.length ? M.fmtPct(prom(activos)) : "-"} />
      </div>
      {vivas.length === 0 ? <div className="amg-card" style={{ padding: 24, textAlign: "center", color: "var(--text-faint)" }}>No hay cronograma para {C.nombreMes(mes)}. Se calcula en Monitoreos → Cronograma de monitoreos.</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, marginBottom: 14 }}>
            <Tarjeta titulo="Programados vs realizados por semana">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={porSemana} margin={{ left: 0, right: 12 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Legend />
                  <Bar dataKey="programados" name="Programados" fill="#C9B79A" /><Bar dataKey="realizados" name="Realizados" fill="#3F9D6E" /></BarChart>
              </ResponsiveContainer>
            </Tarjeta>
            <Tarjeta titulo="Cumplimiento por departamento (% realizados)">
              {porDepto.map((d) => <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 5 }}><div style={{ width: 120 }}>{d.name}</div>
                <div style={{ flex: 1, height: 8, background: "var(--panel-2)", borderRadius: 4 }}><div style={{ width: `${d.pct}%`, height: "100%", background: d.pct >= 80 ? "#3F9D6E" : d.pct >= 50 ? "#E0B020" : "#C0463A", borderRadius: 4 }} /></div><span className="amg-mono" style={{ width: 90, textAlign: "right" }}>{d.realizados}/{d.programados} · {d.pct}%</span></div>)}
            </Tarjeta>
          </div>
          <div className="amg-card" style={{ overflow: "auto", marginBottom: 14 }}>
            <div style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13 }}>Cumplimiento por auditor</div>
            <table className="amg-table compact">
              <thead><tr><th>Auditor</th><th>Meta del mes</th><th>Programados</th><th>Realizados</th><th>Vencidos</th><th>Cumplimiento</th></tr></thead>
              <tbody>{porAuditor.map((a) => <tr key={a.name}><td>{a.name}</td><td className="amg-mono">{a.meta || "-"}</td><td className="amg-mono">{a.prog}</td><td className="amg-mono" style={{ color: "var(--green)" }}>{a.real}</td><td className="amg-mono" style={{ color: a.venc ? "var(--red)" : undefined }}>{a.venc}</td><td className="amg-mono"><b>{a.prog ? M.fmtPct(a.pct) : "-"}</b></td></tr>)}</tbody>
            </table>
          </div>
          <div className="amg-card" style={{ overflow: "auto", maxHeight: 360, marginBottom: 14 }}>
            <div style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13 }}>Monitoreos pendientes y vencidos ({pendientes.length})</div>
            <table className="amg-table compact">
              <thead><tr><th>Fecha</th><th>Técnico</th><th>Departamento</th><th>Auditor</th><th>Estado</th></tr></thead>
              <tbody>{pendientes.slice(0, 150).map((e) => <tr key={e.id}><td className="amg-mono">{ui.fmtDate(e.planned_date)}</td><td>{(tec[e.technician_id] || {}).name}</td><td>{(tec[e.technician_id] || {}).department || "-"}</td><td>{(tec[e.auditor_person_id] || {}).name || "-"}</td><td><ui.Badge text={est(e)} color={est(e) === "Vencido" ? "red" : "gray"} /></td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Dashboard de monitoreos (grupo Resumen): resultados de los monitoreos y cumplimiento del cronograma.
export default function MonitoreosDash({ db, ui }) {
  const [vista, setVista] = useState("resultados");
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        <div className={`amg-tab ${vista === "resultados" ? "active" : ""}`} onClick={() => setVista("resultados")}>Resultados de los monitoreos</div>
        <div className={`amg-tab ${vista === "cumplimiento" ? "active" : ""}`} onClick={() => setVista("cumplimiento")}>Cumplimiento del cronograma</div>
      </div>
      {vista === "resultados" ? <ResultadosMonitoreos db={db} ui={ui} /> : <CumplimientoCronograma db={db} ui={ui} />}
    </div>
  );
}
