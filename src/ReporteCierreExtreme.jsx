import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import * as C from "./lib/cierreExtreme";

/* ============================================================================
   CIERRE EN LÍNEA (EXTREME)
   Cumplimiento del cierre de los servicios: un producto cuenta "dentro del NDS" si su HORA FIN DE TRABAJO (del Reporte detallado de encuestas de precierre de Extreme,
   el que se carga en Carga → Cargar reporte Extreme) es ANTES de la hora límite (por defecto las 17:00). Cada carga del reporte va guardando el histórico (tabla cierre_extreme).
   Vistas: Resumen (velocímetro), Evolución, Coordinador, Técnico, Departamento, Municipio y Hora. Filtros globales; todo se puede exportar a CSV.
============================================================================ */

const VERDE = "#12a166", ROJO = "#e0435c", AZUL = "#2f6fed", NARANJA = "#ff9540", GRIS = "#8991a3";
const TIP = { background: "#fff", border: "1px solid #e2e7f1", borderRadius: 8, fontSize: 12 };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmtPct = (p, d = 1) => `${(isFinite(p) ? p : 0).toFixed(d).replace(".", ",")}%`;
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const nombreMes = (k) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
const corto = (s, n) => { const t = String(s || ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const bonito = (s) => (s ? String(s).charAt(0) + String(s).slice(1).toLowerCase() : s);
const TABS = [["resumen", "Resumen"], ["evolucion", "Evolución"], ["coordinador", "Coordinador"], ["tecnico", "Técnico"], ["departamento", "Departamento"], ["municipio", "Municipio"], ["hora", "Por hora y día"]];

// Velocímetro semicircular del cumplimiento (zonas: rojo < 85, naranja 85–89, amarillo 90–94, verde ≥ 95).
function Gauge({ value }) {
  const size = 240, sw = 22, cx = size / 2, cy = size / 2 + 6, r = size / 2 - sw / 2 - 4;
  const polar = (rad, ang) => ({ x: cx + rad * Math.cos((ang * Math.PI) / 180), y: cy - rad * Math.sin((ang * Math.PI) / 180) });
  const arc = (a0, a1) => { const p0 = polar(r, a0), p1 = polar(r, a1); return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`; };
  const zonas = [[0, 85, "#e0435c"], [85, 90, "#ff9540"], [90, 95, "#f2c94c"], [95, 100, "#12a166"]];
  const v = Math.max(0, Math.min(100, value || 0));
  const ang = 180 - (v / 100) * 180, tip = polar(r - 6, ang), b1 = polar(7, ang + 90), b2 = polar(7, ang - 90);
  const lv = C.nivel(v);
  return (
    <div style={{ width: size, maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${size} ${size * 0.62}`} width="100%" style={{ display: "block", overflow: "visible" }}>
        {zonas.map(([a, b, col]) => <path key={a} d={arc(180 - (a / 100) * 180, 180 - (b / 100) * 180)} stroke={col} strokeWidth={sw} fill="none" opacity="0.92" />)}
        <circle cx={cx} cy={cy} r="7" fill="#0b1c38" stroke="#fff" strokeWidth="2" />
        <path d={`M ${tip.x.toFixed(2)} ${tip.y.toFixed(2)} L ${b1.x.toFixed(2)} ${b1.y.toFixed(2)} L ${b2.x.toFixed(2)} ${b2.y.toFixed(2)} Z`} fill="#fff" />
      </svg>
      <div style={{ textAlign: "center", marginTop: -6 }}>
        <div style={{ fontSize: 34, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{fmtPct(v)}</div>
        <div style={{ fontSize: 11, color: lv.color, fontWeight: 700, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{lv.label}</div>
      </div>
    </div>
  );
}

const BarraPct = ({ p }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150 }}>
    <div style={{ flex: 1, height: 8, background: "var(--panel-2)", borderRadius: 4 }}><div style={{ width: `${Math.min(100, p)}%`, height: "100%", borderRadius: 4, background: C.nivel(p).color }} /></div>
    <span className="amg-mono" style={{ fontSize: 12, width: 52, textAlign: "right" }}>{fmtPct(p)}</span>
  </div>
);

export default function ReporteCierreExtreme({ db, session, ui }) {
  const hoy = ui.todayISO();
  const [from, setFrom] = useState(C.sumarDias(hoy, -29));
  const [to, setTo] = useState(hoy);
  const [preset, setPreset] = useState("30");
  const [crudo, setCrudo] = useState(null); // filas del rango + las del periodo anterior (para comparar)
  const [error, setError] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [tab, setTab] = useState("resumen");
  const [lim, setLim] = useState(C.HORA_LIMITE);
  const [f, setF] = useState({ dept: "", muni: "", coord: "", tec: "", est: "" });
  const [gran, setGran] = useState("dia");
  const [busca, setBusca] = useState("");
  const [orden, setOrden] = useState({ k: "pct", dir: "desc" });
  const puedeCargar = session.role === "admin" || session.role === "operador";

  const aplicarPreset = (p) => {
    setPreset(p);
    if (p === "todo") { setFrom(""); setTo(""); return; }
    const d = (n) => C.sumarDias(hoy, n);
    if (p === "hoy") { setFrom(hoy); setTo(hoy); } else if (p === "ayer") { setFrom(d(-1)); setTo(d(-1)); } else if (p === "7") { setFrom(d(-6)); setTo(hoy); } else if (p === "30") { setFrom(d(-29)); setTo(hoy); }
    else if (p === "mes") { setFrom(`${hoy.slice(0, 7)}-01`); setTo(hoy); }
    else if (p === "mesAnt") { const ult = C.sumarDias(`${hoy.slice(0, 7)}-01`, -1); setFrom(`${ult.slice(0, 7)}-01`); setTo(ult); }
  };

  // Carga el rango pedido y el periodo anterior de igual duración (para las comparaciones).
  useEffect(() => {
    let alive = true;
    setError(""); setCrudo(null);
    const dias = from && to ? C.diasEntre(from, to) + 1 : 0;
    C.cargarCierres({ from: from ? C.sumarDias(from, -dias) : "", to: to || "" })
      .then((r) => { if (alive) setCrudo(r); })
      .catch((e) => { if (alive) { setCrudo([]); setError(`${e.message}. Si es la primera vez, falta correr el SQL del cierre en línea (sql/54) en Supabase.`); } });
    return () => { alive = false; };
  }, [from, to, recarga]);

  const dias = from && to ? C.diasEntre(from, to) + 1 : 0;
  const prevDesde = from ? C.sumarDias(from, -dias) : "", prevHasta = from ? C.sumarDias(from, -1) : "";
  const pasaFiltros = (r) => (!f.dept || r.departamento === f.dept) && (!f.muni || r.municipio === f.muni) && (!f.coord || (r.coordinador || "Sin coordinador") === f.coord) && (!f.tec || (r.tecnico || "Sin técnico") === f.tec);
  const rows = useMemo(() => (crudo || []).filter((r) => (!from || r.closed_day >= from) && (!to || r.closed_day <= to) && pasaFiltros(r) && (!f.est || C.estadoNds(r, lim) === f.est)), [crudo, from, to, f, lim]);
  const prev = useMemo(() => (from && crudo ? crudo.filter((r) => r.closed_day >= prevDesde && r.closed_day <= prevHasta && pasaFiltros(r)) : []), [crudo, from, f, lim]);
  const S = useMemo(() => C.statsNds(rows, lim), [rows, lim]);
  const Sprev = useMemo(() => C.statsNds(prev, lim), [prev, lim]);

  // Opciones de los filtros (según lo cargado en el rango)
  const opciones = useMemo(() => {
    const base = (crudo || []).filter((r) => (!from || r.closed_day >= from) && (!to || r.closed_day <= to));
    const u = (fn) => [...new Set(base.map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));
    return { depto: u((r) => r.departamento), muni: u((r) => (!f.dept || r.departamento === f.dept ? r.municipio : null)), coord: u((r) => r.coordinador || "Sin coordinador"), tec: u((r) => ((!f.coord || (r.coordinador || "Sin coordinador") === f.coord) && (!f.dept || r.departamento === f.dept) ? r.tecnico || "Sin técnico" : null)) };
  }, [crudo, from, to, f.dept, f.coord]);

  const ultimaCarga = useMemo(() => (crudo && crudo.length ? crudo.reduce((m, r) => (r.loaded_at > m ? r.loaded_at : m), "") : ""), [crudo]);
  const delta = S.evaluados && Sprev.evaluados && from ? S.pct - Sprev.pct : null;

  // Agrupaciones
  const g = (fn) => C.agrupar(rows, fn, lim);
  const porCoord = useMemo(() => g((r) => r.coordinador || "Sin coordinador").sort((a, b) => b.pct - a.pct), [rows, lim]);
  const porDepto = useMemo(() => g((r) => r.departamento || "Sin departamento").sort((a, b) => b.pct - a.pct), [rows, lim]);
  const porMuni = useMemo(() => g((r) => `${r.municipio || "Sin municipio"}|${r.departamento || ""}`).map((x) => ({ ...x, muni: x.key.split("|")[0], depto: x.key.split("|")[1] })).sort((a, b) => b.total - a.total), [rows, lim]);
  const porTec = useMemo(() => g((r) => r.tecnico || "Sin técnico").map((x) => {
    const moda = (fn) => { const m = new Map(); x.rows.forEach((r) => { const v = fn(r); if (v) m.set(v, (m.get(v) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
    const horas = new Map(); x.rows.forEach((r) => { if (C.tieneHora(r)) horas.set(r.closed_hour, (horas.get(r.closed_hour) || 0) + 1); });
    return { ...x, coord: moda((r) => r.coordinador) || "Sin coordinador", depto: moda((r) => r.departamento), horaFrec: [...horas.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
  }), [rows, lim]);
  const periodo = (fn) => g(fn).sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const porDia = useMemo(() => periodo((r) => r.closed_day), [rows, lim]);
  const serie = useMemo(() => (gran === "semana" ? periodo((r) => C.semanaIso(r.closed_day)) : gran === "mes" ? periodo((r) => r.closed_day.slice(0, 7)) : porDia), [rows, lim, gran]);
  const porHora = useMemo(() => Array.from({ length: 24 }, (_, h) => ({ hora: h, n: rows.filter((r) => r.closed_hour === h).length })), [rows]);
  const porDiaSem = useMemo(() => Array.from({ length: 7 }, (_, d) => { const rs = rows.filter((r) => C.diaSemana(r.closed_day) === d); return { dia: DIAS[d], ...C.statsNds(rs, lim) }; }), [rows, lim]);
  const horaFrec = useMemo(() => { const m = porHora.slice().sort((a, b) => b.n - a.n)[0]; return m && m.n ? m.hora : null; }, [porHora]);
  const servicios = useMemo(() => new Set(rows.map((r) => r.servicio)).size, [rows]);

  const setFiltro = (k, v) => setF((x) => ({ ...x, [k]: v, ...(k === "dept" ? { muni: "" } : {}), ...(k === "coord" ? { tec: "" } : {}) }));
  const hayFiltros = Object.values(f).some(Boolean);
  const etiquetaDia = (k) => (gran === "dia" ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : gran === "mes" ? nombreMes(k) : k.slice(2));
  const irA = (tabla, k, v) => { setFiltro(k, v); if (tabla) setTab(tabla); };

  const exportarDetalle = () => ui.downloadCSV("cierre_en_linea_detalle.csv", ["Día de cierre", "Hora de cierre", "Servicio", "Clave", "Técnico", "Coordinador", "Departamento", "Municipio", "Estado", "Causal", "Resultado"],
    rows.map((r) => [r.closed_day, r.closed_hour ?? "", r.servicio, r.clave, r.tecnico || "", r.coordinador || "", r.departamento || "", r.municipio || "", r.estado || "", r.causal || "", { dentro: "Dentro del NDS", fuera: "Fuera del NDS", pendiente: "Sin hora de cierre" }[C.estadoNds(r, lim)]]));
  const filasTabla = (lista, nombre) => ui.downloadCSV(`cierre_en_linea_${nombre}.csv`, [nombre, "Productos", "Dentro", "Fuera", "Sin hora", "% cumplimiento"], lista.map((x) => [x.key.split("|")[0], x.total, x.dentro, x.fuera, x.pend, (Math.round(x.pct * 10) / 10).toString().replace(".", ",")]));

  /* ---------------- Carga del Excel histórico del tablero ---------------- */
  const [hist, setHist] = useState(null); // { nombre, filas, desde, hasta }
  const [histMsg, setHistMsg] = useState("");
  const [histBusy, setHistBusy] = useState(false);
  const leerHistorico = (file) => {
    if (!file) return;
    setHistMsg(""); setHist(null); setHistBusy(true);
    const rd = new FileReader();
    rd.onload = (e) => {
      try { setHist({ nombre: file.name, ...C.filasDeExcelDash(new Uint8Array(e.target.result), { archivo: file.name, userId: session.id }) }); }
      catch (err) { setHistMsg(err.message); }
      setHistBusy(false);
    };
    rd.onerror = () => { setHistMsg("No se pudo leer el archivo."); setHistBusy(false); };
    rd.readAsArrayBuffer(file);
  };
  const guardarHistorico = async () => {
    setHistBusy(true); setHistMsg("");
    try { const n = await C.guardarCierres(hist.filas, { soloNuevas: true }); setHistMsg(`Listo: se enviaron ${fmtInt(n)} registros del ${hist.desde} al ${hist.hasta}. Lo que ya estaba cargado desde el reporte de Extreme no se reemplaza.`); setHist(null); setRecarga((n2) => n2 + 1); }
    catch (err) { setHistMsg(`No se pudo guardar: ${err.message}. Si es la primera vez, falta correr el SQL del cierre en línea (sql/54).`); }
    setHistBusy(false);
  };

  const sinDatos = crudo !== null && rows.length === 0;
  const lv = C.nivel(S.pct);

  const Tabla = ({ lista, titulo, col, linkTab, linkKey }) => (
    <div className="amg-card" style={{ overflow: "auto", maxHeight: 460 }}>
      <table className="amg-table compact" style={{ fontSize: 12.5 }}>
        <thead><tr><th>{titulo}</th><th>Productos</th><th>Dentro</th><th>Fuera</th><th>Sin hora</th><th style={{ minWidth: 190 }}>% cumplimiento</th></tr></thead>
        <tbody>
          {lista.map((x) => (
            <tr key={x.key}>
              <td>{linkKey ? <button className="amg-btn ghost" style={{ padding: 0, fontWeight: 600 }} title="Filtrar por este valor" onClick={() => irA(linkTab, linkKey, x.key.split("|")[0])}>{col ? col(x) : x.key}</button> : (col ? col(x) : x.key)}</td>
              <td className="amg-mono">{fmtInt(x.total)}</td><td className="amg-mono" style={{ color: VERDE }}>{fmtInt(x.dentro)}</td><td className="amg-mono" style={{ color: x.fuera ? ROJO : undefined }}>{fmtInt(x.fuera)}</td><td className="amg-mono">{fmtInt(x.pend)}</td>
              <td><BarraPct p={x.pct} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const barrasPct = (lista, alto) => (
    <ResponsiveContainer width="100%" height={alto || Math.max(200, lista.length * 28 + 40)}>
      <BarChart data={lista.map((x) => ({ n: corto(x.key.split("|")[0], 22), pct: Math.round(x.pct * 10) / 10 }))} layout="vertical" margin={{ left: 10, right: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="n" width={140} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => `${v}%`} contentStyle={TIP} />
        <Bar dataKey="pct" name="Cumplimiento" radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 10, formatter: (v) => `${v}%` }}>{lista.map((x, i) => <Cell key={i} fill={C.nivel(x.pct).color} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );

  return (
    <div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginRight: 6 }}>Cierre en línea (Extreme)</div>
          {[["hoy", "Hoy"], ["ayer", "Ayer"], ["7", "7 días"], ["30", "30 días"], ["mes", "Este mes"], ["mesAnt", "Mes anterior"], ["todo", "Todo"]].map(([k, t]) => (
            <button key={k} className="amg-btn" style={preset === k ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : undefined} onClick={() => aplicarPreset(k)}>{t}</button>
          ))}
          <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => { setFrom(e.target.value); setPreset(""); }} title="Desde (día de la hora fin de trabajo)" />
          <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => { setTo(e.target.value); setPreset(""); }} title="Hasta" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select className="amg-select" style={{ width: 170 }} value={f.dept} onChange={(e) => setFiltro("dept", e.target.value)}><option value="">Todos los departamentos</option>{opciones.depto.map((x) => <option key={x} value={x}>{bonito(x)}</option>)}</select>
          <select className="amg-select" style={{ width: 170 }} value={f.muni} onChange={(e) => setFiltro("muni", e.target.value)}><option value="">Todos los municipios</option>{opciones.muni.map((x) => <option key={x} value={x}>{bonito(x)}</option>)}</select>
          <select className="amg-select" style={{ width: 170 }} value={f.coord} onChange={(e) => setFiltro("coord", e.target.value)}><option value="">Todos los coordinadores</option>{opciones.coord.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className="amg-select" style={{ width: 190 }} value={f.tec} onChange={(e) => setFiltro("tec", e.target.value)}><option value="">Todos los técnicos</option>{opciones.tec.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className="amg-select" style={{ width: 150 }} value={f.est} onChange={(e) => setFiltro("est", e.target.value)}><option value="">Todos los estados</option><option value="dentro">Dentro del NDS</option><option value="fuera">Fuera del NDS</option><option value="pendiente">Sin hora de cierre</option></select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }} title="Un producto está dentro del NDS si su hora fin de trabajo es antes de esta hora">Cerrar antes de las
            <select className="amg-select" style={{ width: 90 }} value={lim} onChange={(e) => setLim(Number(e.target.value))}>{[12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
          {hayFiltros && <button className="amg-btn" onClick={() => setF({ dept: "", muni: "", coord: "", tec: "", est: "" })}>✕ Limpiar filtros</button>}
          <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!rows.length} onClick={exportarDetalle} title="Detalle de todos los productos del rango y los filtros">Exportar detalle (CSV)</button>
          {puedeCargar && (
            <label className="amg-btn" style={{ cursor: "pointer" }} title="Carga el Excel del tablero de Cierre en Línea (hoja Base) para tener el histórico anterior. No reemplaza lo ya cargado desde Extreme.">
              Cargar histórico (Excel)<input type="file" accept=".xlsx" style={{ display: "none" }} onChange={(e) => { leerHistorico(e.target.files[0]); e.target.value = ""; }} /></label>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
          {crudo === null ? "Cargando cierres..." : `${fmtInt(rows.length)} productos · ${fmtInt(servicios)} servicios`}{ultimaCarga ? ` · última carga: ${ui.fmtDate(ultimaCarga.slice(0, 10))}` : ""}. El histórico se va guardando cada vez que cargas el reporte de Extreme en Carga → Cargar reporte Extreme.
        </div>
        {histBusy && <div style={{ fontSize: 12.5, marginTop: 8 }}>Procesando...</div>}
        {hist && (
          <div className="amg-alert" style={{ marginTop: 10 }}>
            El Excel "{hist.nombre}" trae <b>{fmtInt(hist.filas.length)}</b> productos cerrados del <b>{hist.desde}</b> al <b>{hist.hasta}</b> (solo con la hora, sin minutos). Se guardan sin pisar lo ya cargado desde Extreme.
            <button className="amg-btn primary" style={{ marginLeft: 10 }} disabled={histBusy} onClick={guardarHistorico}>Guardar en el histórico</button>
            <button className="amg-btn" style={{ marginLeft: 6 }} onClick={() => setHist(null)}>Cancelar</button>
          </div>
        )}
        {histMsg && <div className="amg-alert" style={{ marginTop: 10 }}>{histMsg}</div>}
        {error && <div className="amg-alert danger" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map(([k, t]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{t}</button>)}
      </div>

      {crudo === null && <div className="amg-card" style={{ padding: 24, textAlign: "center", color: "var(--text-faint)" }}>Cargando...</div>}
      {sinDatos && !error && (
        <div className="amg-card" style={{ padding: 24, textAlign: "center", color: "var(--text-faint)" }}>
          No hay cierres para este rango y estos filtros. El histórico se llena al cargar el reporte de Extreme en Carga → Cargar reporte Extreme{puedeCargar ? " (o con \"Cargar histórico (Excel)\")" : ""}. Prueba con "Todo".
        </div>
      )}

      {crudo !== null && rows.length > 0 && tab === "resumen" && (
        <>
          <div style={{ background: "linear-gradient(120deg,#0b1c38,#12294d 60%,#16345f)", borderRadius: 14, color: "#fff", padding: "20px 24px", display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center", marginBottom: 14 }}>
            <Gauge value={S.pct} />
            <div style={{ flex: "1 1 260px" }}>
              <div style={{ fontSize: 10.5, letterSpacing: 1.5, textTransform: "uppercase", color: "#8fa3c8", fontWeight: 700 }}>Índice de Cierre en Línea</div>
              <div style={{ fontSize: 22, fontWeight: 700, margin: "4px 0" }}>{fmtInt(S.dentro)} de {fmtInt(S.evaluados)} productos cerrados antes de las {lim}:00</div>
              <div style={{ fontSize: 12, color: "#b7c6e6", lineHeight: 1.5 }}>Cumplimiento = productos con hora fin de trabajo antes de las {lim}:00 ÷ productos con hora de cierre. {S.pend ? `${fmtInt(S.pend)} productos no traen hora y no cuentan.` : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 22 }}>
              <div><div style={{ fontSize: 10.5, color: "#8fa3c8", textTransform: "uppercase", fontWeight: 700 }}>vs periodo anterior</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: delta === null ? "#b7c6e6" : delta >= 0 ? "#4ad991" : "#ff7b8e" }}>{delta === null ? "—" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1).replace(".", ",")} pts`}</div>
                <div style={{ fontSize: 11, color: "#8fa3c8" }}>{from && Sprev.evaluados ? `antes: ${fmtPct(Sprev.pct)}` : "sin datos previos"}</div></div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
            <ui.StatCard label="Productos" value={fmtInt(S.total)} sub={`${fmtInt(servicios)} servicios`} />
            <ui.StatCard label="Dentro del NDS" value={fmtInt(S.dentro)} accent sub={`antes de las ${lim}:00`} />
            <ui.StatCard label="Fuera del NDS" value={fmtInt(S.fuera)} sub={`${lim}:00 o más tarde`} />
            <ui.StatCard label="Sin hora de cierre" value={fmtInt(S.pend)} sub="no cuentan para el %" />
            <ui.StatCard label="Cumplimiento" value={fmtPct(S.pct)} sub={lv.label} />
            <ui.StatCard label="Hora de cierre más frecuente" value={horaFrec === null ? "-" : `${horaFrec}:00`} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(440px,100%),1fr))", gap: 14, marginBottom: 14 }}>
            <div className="amg-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Cumplimiento por día</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={porDia.map((x) => ({ d: `${x.key.slice(8, 10)}/${x.key.slice(5, 7)}`, pct: Math.round(x.pct * 10) / 10 }))} margin={{ right: 16, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="d" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => `${v}%`} contentStyle={TIP} /><ReferenceLine y={95} stroke={VERDE} strokeDasharray="4 4" label={{ value: "Meta 95%", fontSize: 10, fill: VERDE, position: "insideTopRight" }} />
                  <Line type="monotone" dataKey="pct" name="Cumplimiento" stroke={AZUL} strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="amg-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Cumplimiento por coordinador</div>
              {barrasPct(porCoord, 240)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(440px,100%),1fr))", gap: 14 }}>
            {(() => {
              const pool = porTec.filter((x) => x.evaluados >= 20), base = pool.length >= 5 ? pool : porTec;
              const mejores = [...base].sort((a, b) => b.pct - a.pct || b.total - a.total).slice(0, 5), peores = [...base].sort((a, b) => a.pct - b.pct || b.total - a.total).slice(0, 5);
              return [["Mejores 5 técnicos", mejores], ["Peores 5 técnicos", peores]].map(([t, l]) => (
                <div key={t} className="amg-card" style={{ padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t} <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 400 }}>(con 20 o más productos)</span></div>
                  <table className="amg-table compact" style={{ fontSize: 12.5 }}><tbody>{l.map((x) => <tr key={x.key}><td>{x.key}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{x.coord}</div></td><td className="amg-mono">{fmtInt(x.total)}</td><td><BarraPct p={x.pct} /></td></tr>)}</tbody></table>
                </div>
              ));
            })()}
          </div>
        </>
      )}

      {crudo !== null && rows.length > 0 && tab === "evolucion" && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>{[["dia", "Diario"], ["semana", "Semanal"], ["mes", "Mensual"]].map(([k, t]) => <button key={k} className={`amg-btn ${gran === k ? "primary" : ""}`} onClick={() => setGran(k)}>{t}</button>)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(440px,100%),1fr))", gap: 14, marginBottom: 14 }}>
            <div className="amg-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Cumplimiento ({gran === "dia" ? "por día" : gran === "semana" ? "por semana" : "por mes"})</div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={serie.map((x) => ({ d: etiquetaDia(x.key), pct: Math.round(x.pct * 10) / 10 }))} margin={{ right: 16, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="d" tick={{ fontSize: 10 }} /><YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => `${v}%`} contentStyle={TIP} /><ReferenceLine y={95} stroke={VERDE} strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="pct" name="Cumplimiento" stroke={AZUL} strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="amg-card" style={{ padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Productos dentro y fuera del NDS</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={serie.map((x) => ({ d: etiquetaDia(x.key), Dentro: x.dentro, Fuera: x.fuera, "Sin hora": x.pend }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="d" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip contentStyle={TIP} /><Legend />
                  <Bar dataKey="Dentro" stackId="a" fill={VERDE} /><Bar dataKey="Fuera" stackId="a" fill={ROJO} /><Bar dataKey="Sin hora" stackId="a" fill={GRIS} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <Tabla lista={[...serie].reverse()} titulo={gran === "dia" ? "Día" : gran === "semana" ? "Semana" : "Mes"} col={(x) => (gran === "mes" ? nombreMes(x.key) : gran === "dia" ? ui.fmtDate(x.key) : x.key)} />
        </>
      )}

      {crudo !== null && rows.length > 0 && tab === "coordinador" && (
        <>
          <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>{barrasPct(porCoord)}</div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}><button className="amg-btn" onClick={() => filasTabla(porCoord, "Coordinador")}>Exportar CSV</button></div>
          <Tabla lista={porCoord} titulo="Coordinador" linkKey="coord" linkTab="" />
        </>
      )}

      {crudo !== null && rows.length > 0 && tab === "departamento" && (
        <>
          <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>{barrasPct(porDepto)}</div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}><button className="amg-btn" onClick={() => filasTabla(porDepto, "Departamento")}>Exportar CSV</button></div>
          <Tabla lista={porDepto} titulo="Departamento" col={(x) => bonito(x.key)} linkKey="dept" linkTab="municipio" />
        </>
      )}

      {crudo !== null && rows.length > 0 && tab === "municipio" && (
        <>
          <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Los 12 municipios con más productos</div>
            {barrasPct(porMuni.slice(0, 12).map((x) => ({ ...x, key: bonito(x.muni) })))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}><button className="amg-btn" onClick={() => filasTabla(porMuni.map((x) => ({ ...x, key: `${x.muni} (${x.depto})` })), "Municipio")}>Exportar CSV</button></div>
          <Tabla lista={porMuni} titulo="Municipio" col={(x) => <span>{bonito(x.muni)} <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{bonito(x.depto)}</span></span>} />
        </>
      )}

      {crudo !== null && rows.length > 0 && tab === "tecnico" && (() => {
        const q = busca.trim().toLowerCase();
        const lista = porTec.filter((x) => !q || x.key.toLowerCase().includes(q) || x.coord.toLowerCase().includes(q))
          .sort((a, b) => { const va = orden.k === "key" ? a.key : orden.k === "coord" ? a.coord : a[orden.k], vb = orden.k === "key" ? b.key : orden.k === "coord" ? b.coord : b[orden.k]; const c = typeof va === "string" ? va.localeCompare(vb, "es") : va - vb; return orden.dir === "asc" ? c : -c; });
        const th = (k, t) => <th style={{ cursor: "pointer" }} onClick={() => setOrden((o) => ({ k, dir: o.k === k && o.dir === "desc" ? "asc" : "desc" }))}>{t}{orden.k === k ? (orden.dir === "desc" ? " ▼" : " ▲") : ""}</th>;
        return (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <input className="amg-input" style={{ width: 240 }} placeholder="Buscar técnico o coordinador..." value={busca} onChange={(e) => setBusca(e.target.value)} />
              <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{lista.length} técnicos. Pulsa un encabezado para ordenar.</span>
              <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={() => ui.downloadCSV("cierre_en_linea_tecnicos.csv", ["Técnico", "Coordinador", "Departamento", "Productos", "Dentro", "Fuera", "Sin hora", "% cumplimiento", "Hora más frecuente"], lista.map((x) => [x.key, x.coord, bonito(x.depto), x.total, x.dentro, x.fuera, x.pend, (Math.round(x.pct * 10) / 10).toString().replace(".", ","), x.horaFrec ?? ""]))}>Exportar CSV</button>
            </div>
            <div className="amg-card" style={{ overflow: "auto", maxHeight: 560 }}>
              <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                <thead><tr>{th("key", "Técnico")}{th("coord", "Coordinador")}<th>Departamento</th>{th("total", "Productos")}{th("dentro", "Dentro")}{th("fuera", "Fuera")}{th("pend", "Sin hora")}{th("pct", "% cumplimiento")}<th>Hora frecuente</th></tr></thead>
                <tbody>{lista.map((x) => (
                  <tr key={x.key}>
                    <td><button className="amg-btn ghost" style={{ padding: 0, fontWeight: 600 }} title="Filtrar por este técnico" onClick={() => irA("resumen", "tec", x.key)}>{x.key}</button></td>
                    <td>{x.coord}</td><td>{bonito(x.depto) || "-"}</td><td className="amg-mono">{fmtInt(x.total)}</td><td className="amg-mono" style={{ color: VERDE }}>{fmtInt(x.dentro)}</td><td className="amg-mono" style={{ color: x.fuera ? ROJO : undefined }}>{fmtInt(x.fuera)}</td><td className="amg-mono">{fmtInt(x.pend)}</td>
                    <td><BarraPct p={x.pct} /></td><td className="amg-mono">{x.horaFrec === null ? "-" : `${x.horaFrec}:00`}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </>
        );
      })()}

      {crudo !== null && rows.length > 0 && tab === "hora" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(440px,100%),1fr))", gap: 14 }}>
          <div className="amg-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Productos por hora de cierre</div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 8 }}>En verde, lo cerrado antes de las {lim}:00 (dentro del NDS); en rojo, lo cerrado desde esa hora.</div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porHora.map((x) => ({ h: `${x.hora}h`, n: x.n, hora: x.hora }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="h" tick={{ fontSize: 10 }} interval={1} /><YAxis tick={{ fontSize: 10 }} /><Tooltip contentStyle={TIP} />
                <Bar dataKey="n" name="Productos" radius={[3, 3, 0, 0]}>{porHora.map((x) => <Cell key={x.hora} fill={x.hora < lim ? VERDE : ROJO} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="amg-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Cumplimiento por día de la semana</div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porDiaSem.map((x) => ({ d: x.dia, pct: Math.round(x.pct * 10) / 10, total: x.total }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="d" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v, n) => (n === "Cumplimiento" ? `${v}%` : v)} contentStyle={TIP} />
                <Bar dataKey="pct" name="Cumplimiento" radius={[3, 3, 0, 0]} label={{ position: "top", fontSize: 10, formatter: (v) => `${v}%` }}>{porDiaSem.map((x, i) => <Cell key={i} fill={C.nivel(x.pct).color} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="amg-card" style={{ padding: 14, gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Por mes</div>
            <Tabla lista={periodo((r) => r.closed_day.slice(0, 7))} titulo="Mes" col={(x) => nombreMes(x.key)} />
          </div>
        </div>
      )}
    </div>
  );
}
