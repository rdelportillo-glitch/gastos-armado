import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { AlertTriangle } from "lucide-react";
import { fetchHistory, loadRegionInfo } from "./lib/asignacion/history";
import { filasCsvDeHistorico } from "./lib/asignacion/csvCarga";
import { gestionDeCausal } from "./lib/asignacion/cierreColumnas";
import { useZonaCoord } from "./lib/useCoordinadores";
import { sumarDias, diasEntre, semanaIso } from "./lib/cierreExtreme";
import * as G from "./lib/garantias";

/* ============================================================================
   GARANTÍAS (Reportes)
   Productos de garantía (causal NO ARMADO POR NOVEDAD; los ARMADO CON NOVEDAD no cuentan) frente al total de productos armados, por técnico, departamento, coordinador, producto
   y por día, semana o mes. Se arma con el histórico de asignación (la fila de cada producto del CSV de Carga), igual que el Informe de cierre y el Cumplimiento.
============================================================================ */

const VERDE = "#12a166", ROJO = "#e0435c", AZUL = "#2f6fed", NARANJA = "#ff9540";
const TIP = { background: "#fff", border: "1px solid #e2e7f1", borderRadius: 8, fontSize: 12 };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmtPct = (p, d = 1) => `${(isFinite(p) ? p : 0).toFixed(d).replace(".", ",")}%`;
const corto = (s, n) => { const t = String(s || ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "–");
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const TABS = [["resumen", "Resumen"], ["tendencia", "Tendencia"], ["tecnico", "Técnico"], ["departamento", "Departamento"], ["coordinador", "Coordinador"], ["producto", "Producto"], ["detalle", "Detalle"]];
const PRESETS = [["hoy", "Hoy"], ["ayer", "Ayer"], ["7", "7 días"], ["30", "30 días"], ["mes", "Este mes"], ["mesAnt", "Mes anterior"], ["todo", "Todo"]];

export default function ReporteGarantias({ db, session, ui }) {
  const hoy = ui.todayISO();
  const [from, setFrom] = useState(sumarDias(hoy, -29));
  const [to, setTo] = useState(hoy);
  const [preset, setPreset] = useState("30");
  const [rows, setRows] = useState(null);
  const [regionInfo, setRegionInfo] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("resumen");
  const [empresa, setEmpresa] = useState("");
  const [f, setF] = useState({ dept: "", coord: "", tec: "" });
  const [gran, setGran] = useState("dia");
  const [meta, setMeta] = useState(3);          // referencia: % de garantía que se considera aceptable (solo colorea)
  const [minArm, setMinArm] = useState(1);      // técnicos / departamentos con al menos esta cantidad de productos armados
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const zona = useZonaCoord(db);

  const aplicarPreset = (p) => {
    setPreset(p);
    const d = (n) => sumarDias(hoy, n);
    if (p === "todo") { setFrom(""); setTo(""); } else if (p === "hoy") { setFrom(hoy); setTo(hoy); } else if (p === "ayer") { setFrom(d(-1)); setTo(d(-1)); }
    else if (p === "7") { setFrom(d(-6)); setTo(hoy); } else if (p === "30") { setFrom(d(-29)); setTo(hoy); } else if (p === "mes") { setFrom(`${hoy.slice(0, 7)}-01`); setTo(hoy); }
    else if (p === "mesAnt") { const ult = sumarDias(`${hoy.slice(0, 7)}-01`, -1); setFrom(`${ult.slice(0, 7)}-01`); setTo(ult); }
  };

  // Se trae el rango y el periodo anterior de igual duración (para comparar).
  const dias = from && to ? diasEntre(from, to) + 1 : 0;
  const prevDesde = from ? sumarDias(from, -dias) : "", prevHasta = from ? sumarDias(from, -1) : "";
  useEffect(() => { loadRegionInfo().then(setRegionInfo).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    setError(""); setRows(null);
    fetchHistory({ from: prevDesde || undefined, to: to || undefined }).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) { setRows([]); setError(e.message); } });
    return () => { alive = false; };
  }, [from, to]);

  const gestionDe = useMemo(() => gestionDeCausal(db.causales), [db.causales]);
  const todos = useMemo(() => {
    if (!rows) return null;
    const filas = filasCsvDeHistorico({ rows, services: db.services, technicians: db.technicians, causales: db.causales, regionLabel: (r) => (regionInfo ? regionInfo.label(r) : ""), coordDe: (d) => zona.coordDe(d), empresaDe: regionInfo ? regionInfo.empresaDe : undefined });
    return G.registrosDeFilas(filas, gestionDe);
  }, [rows, db.services, db.technicians, db.causales, regionInfo, zona.nombres, gestionDe]);

  const base = useMemo(() => (todos || []).filter((r) => !empresa || r.empresa === empresa), [todos, empresa]);
  const pasa = (r) => (!f.dept || r.depto === f.dept) && (!f.coord || r.coordinador === f.coord) && (!f.tec || r.tecnico === f.tec);
  const actual = useMemo(() => base.filter((r) => (!from || r.fecha >= from) && (!to || r.fecha <= to) && pasa(r)), [base, from, to, f]);
  const previo = useMemo(() => (from ? base.filter((r) => r.fecha >= prevDesde && r.fecha <= prevHasta && pasa(r)) : []), [base, from, f]);
  const S = useMemo(() => G.resumir(actual), [actual]);
  const Sprev = useMemo(() => G.resumir(previo), [previo]);
  const delta = from && Sprev.armados ? S.pctGarantia - Sprev.pctGarantia : null;

  const empresas = useMemo(() => [...new Set((todos || []).map((r) => r.empresa))].sort(), [todos]);
  const opciones = useMemo(() => {
    const dentro = base.filter((r) => (!from || r.fecha >= from) && (!to || r.fecha <= to));
    const u = (fn) => [...new Set(dentro.map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));
    return { depto: u((r) => r.depto), coord: u((r) => (!f.dept || r.depto === f.dept ? r.coordinador : null)), tec: u((r) => ((!f.dept || r.depto === f.dept) && (!f.coord || r.coordinador === f.coord) ? r.tecnico : null)) };
  }, [base, from, to, f.dept, f.coord]);
  const setFiltro = (k, v) => setF((x) => ({ ...x, [k]: v, ...(k === "dept" ? { coord: "", tec: "" } : {}), ...(k === "coord" ? { tec: "" } : {}) }));
  const hayFiltros = Object.values(f).some(Boolean) || empresa;

  const color = (p) => (p <= meta ? VERDE : p <= meta * 1.5 ? NARANJA : ROJO);
  const grupos = (clave) => G.agrupar(actual, clave);
  const totalGar = S.garantias;
  const porTec = useMemo(() => grupos((r) => r.tecnico).map((x) => ({ ...x, depto: G.moda(x.regs, (r) => r.depto), coord: G.moda(x.regs, (r) => r.coordinador) })), [actual]);
  const porDepto = useMemo(() => grupos((r) => r.depto), [actual]);
  const porCoord = useMemo(() => grupos((r) => r.coordinador), [actual]);
  const porProd = useMemo(() => grupos((r) => r.producto).filter((x) => x.garantias > 0), [actual]);
  const periodo = (fn) => grupos(fn).sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const serie = useMemo(() => (gran === "semana" ? periodo((r) => (r.fecha ? semanaIso(r.fecha) : "")) : gran === "mes" ? periodo((r) => r.fecha.slice(0, 7)) : periodo((r) => r.fecha)), [actual, gran]);
  const etiqueta = (k) => (gran === "dia" ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : gran === "mes" ? `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : String(k).slice(2));

  const detalle = useMemo(() => {
    const q = String(busca || "").toUpperCase();
    return actual.filter((r) => r.garantia && (!q || `${r.servicio} ${r.tecnico} ${r.cliente} ${r.producto} ${r.depto}`.toUpperCase().includes(q)))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || a.depto.localeCompare(b.depto, "es") || a.tecnico.localeCompare(b.tecnico, "es"));
  }, [actual, busca]);
  useEffect(() => { setPagina(0); }, [busca, actual, tab]);
  const PAGINA = 100;

  const BarraPct = ({ p }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150 }}>
      <div style={{ flex: 1, height: 8, background: "var(--panel-2)", borderRadius: 4 }}><div style={{ width: `${Math.min(100, (p / Math.max(meta * 3, 1)) * 100)}%`, height: "100%", borderRadius: 4, background: color(p) }} /></div>
      <span className="amg-mono" style={{ fontSize: 12, width: 52, textAlign: "right", color: color(p), fontWeight: 600 }}>{fmtPct(p)}</span>
    </div>
  );

  const Tabla = ({ lista, titulo, extra, csv, ordenarPor = "garantias" }) => {
    const filtrada = lista.filter((x) => x.armados >= minArm || x.garantias > 0).sort((a, b) => (ordenarPor === "pct" ? b.pctGarantia - a.pctGarantia : b.garantias - a.garantias) || b.pctGarantia - a.pctGarantia);
    return (
      <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{filtrada.length} de {lista.length} {titulo.toLowerCase()}(s)</span>
          <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!filtrada.length} onClick={() => ui.downloadCSV(`garantias_${csv}.csv`, [titulo, ...(extra ? extra.map((e) => e.t) : []), "Productos armados", "Productos con garantía", "% garantía sobre armados", "% sobre total productos", "Participación en el total de garantías"],
            filtrada.map((x) => [x.key, ...(extra ? extra.map((e) => e.v(x)) : []), x.armados, x.garantias, x.pctGarantia.toFixed(2).replace(".", ","), x.pctTotal.toFixed(2).replace(".", ","), pct1(x.garantias, totalGar)]))}>Exportar CSV</button>
        </div>
        <div className="amg-card" style={{ overflow: "auto", maxHeight: 520 }}>
          <table className="amg-table compact" style={{ fontSize: 12.5 }}>
            <thead><tr><th>{titulo}</th>{extra && extra.map((e) => <th key={e.t}>{e.t}</th>)}<th>Armados</th><th>Garantías</th><th style={{ minWidth: 190 }}>% garantía sobre armados</th><th title="Garantías ÷ total de productos gestionados">% sobre total</th><th title="Qué parte de todas las garantías es de este grupo">Part. garantías</th></tr></thead>
            <tbody>
              {filtrada.map((x) => (
                <tr key={x.key}>
                  <td style={{ fontWeight: 600 }}>{x.key}</td>
                  {extra && extra.map((e) => <td key={e.t}>{e.v(x)}</td>)}
                  <td className="amg-mono">{fmtInt(x.armados)}</td><td className="amg-mono" style={{ fontWeight: 700, color: x.garantias ? NARANJA : undefined }}>{fmtInt(x.garantias)}</td>
                  <td>{x.armados ? <BarraPct p={x.pctGarantia} /> : <span style={{ color: "var(--text-faint)", fontSize: 12 }}>sin productos armados</span>}</td><td className="amg-mono">{fmtPct(x.pctTotal)}</td><td className="amg-mono">{fmtPct(pct1(x.garantias, totalGar))}</td>
                </tr>
              ))}
              {filtrada.length === 0 && <tr><td colSpan={6 + (extra ? extra.length : 0)} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay datos con esos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </>
    );
  };
  const pct1 = (n, d) => G.pct(n, d);

  const barras = (lista, alto) => (
    <ResponsiveContainer width="100%" height={alto || Math.max(200, lista.length * 28 + 40)}>
      <BarChart data={lista.map((x) => ({ n: corto(x.key, 24), garantias: x.garantias, pct: Math.round(x.pctGarantia * 10) / 10 }))} layout="vertical" margin={{ left: 10, right: 50 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis type="number" tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="n" width={150} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, n, p) => [n === "garantias" ? `${v} (${p.payload.pct}% de los armados)` : v, "Garantías"]} contentStyle={TIP} />
        <Bar dataKey="garantias" name="garantias" radius={[0, 3, 3, 0]} isAnimationActive={false} label={{ position: "right", fontSize: 10 }}>{lista.map((x, i) => <Cell key={i} fill={color(x.pctGarantia)} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );

  const sinDatos = todos !== null && actual.length === 0;
  const cargando = todos === null;

  return (
    <div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginRight: 6 }}>Garantías</div>
          {PRESETS.map(([k, t]) => <button key={k} className="amg-btn" style={preset === k ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : undefined} onClick={() => aplicarPreset(k)}>{t}</button>)}
          <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => { setFrom(e.target.value); setPreset(""); if (e.target.value && to && e.target.value > to) setTo(e.target.value); }} />
          <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => { setTo(e.target.value); setPreset(""); if (e.target.value && from && e.target.value < from) setFrom(e.target.value); }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select className="amg-select" style={{ width: 170 }} value={empresa} onChange={(e) => setEmpresa(e.target.value)}><option value="">Todas las empresas</option>{empresas.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className="amg-select" style={{ width: 170 }} value={f.dept} onChange={(e) => setFiltro("dept", e.target.value)}><option value="">Todos los departamentos</option>{opciones.depto.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className="amg-select" style={{ width: 180 }} value={f.coord} onChange={(e) => setFiltro("coord", e.target.value)}><option value="">Todos los coordinadores</option>{opciones.coord.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className="amg-select" style={{ width: 200 }} value={f.tec} onChange={(e) => setFiltro("tec", e.target.value)}><option value="">Todos los técnicos</option>{opciones.tec.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          {hayFiltros && <button className="amg-btn" onClick={() => { setF({ dept: "", coord: "", tec: "" }); setEmpresa(""); }}>✕ Quitar filtros</button>}
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }} title="Solo colorea: verde si el % de garantía está en la meta o por debajo, naranja hasta 1,5 veces la meta y rojo por encima">Meta de referencia <input type="number" min={0} step={0.5} className="amg-input" style={{ width: 70 }} value={meta} onChange={(e) => setMeta(Math.max(0, Number(e.target.value) || 0))} />%</label>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }} title="En las tablas, solo grupos con al menos esta cantidad de productos armados (evita porcentajes engañosos con pocos productos). Los grupos con garantías siempre se muestran.">Mín. armados <input type="number" min={0} className="amg-input" style={{ width: 70 }} value={minArm} onChange={(e) => setMinArm(Math.max(0, Number(e.target.value) || 0))} /></label>
        </div>
        {error && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {error}</div>}
      </div>

      {cargando && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Leyendo el histórico...</div>}
      {!cargando && sinDatos && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>No hay productos en el histórico para ese rango y filtros. El reporte sale de los días ya finalizados en Carga.</div>}

      {!cargando && !sinDatos && (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{TABS.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}</button>)}</div>

          {tab === "resumen" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 12, marginBottom: 14 }}>
                <ui.StatCard label="Productos armados" value={fmtInt(S.armados)} sub={`de ${fmtInt(S.total)} productos gestionados`} />
                <ui.StatCard label="Productos con garantía" value={fmtInt(S.garantias)} accent sub="no armados por novedad" />
                <ui.StatCard label="% garantía sobre armados" value={fmtPct(S.pctGarantia, 2)} sub={delta === null ? "sin periodo anterior para comparar" : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "="} ${fmtPct(Math.abs(delta), 2)} frente al periodo anterior (${fmtPct(Sprev.pctGarantia, 2)})`} />
                <ui.StatCard label="% garantía sobre el total" value={fmtPct(S.pctTotal, 2)} sub="sobre todos los productos gestionados" />
                <ui.StatCard label="Técnicos con garantía" value={fmtInt(porTec.filter((x) => x.garantias > 0).length)} sub={`de ${fmtInt(porTec.length)} técnicos`} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 14 }}>
                <div className="amg-card" style={{ padding: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Técnicos con más garantías</div>
                  {barras([...porTec].filter((x) => x.garantias > 0).sort((a, b) => b.garantias - a.garantias).slice(0, 10))}
                </div>
                <div className="amg-card" style={{ padding: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Por departamento</div>
                  {barras([...porDepto].filter((x) => x.armados >= minArm || x.garantias > 0).sort((a, b) => b.garantias - a.garantias))}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>El color de cada barra compara el % de garantía de ese grupo con la meta de referencia ({fmtPct(meta, 1)}): verde dentro de la meta, naranja hasta 1,5 veces, rojo por encima. La altura es la cantidad de garantías.</div>
            </>
          )}

          {tab === "tendencia" && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                {[["dia", "Por día"], ["semana", "Por semana"], ["mes", "Por mes"]].map(([k, t]) => <button key={k} className={`amg-btn ${gran === k ? "primary" : ""}`} onClick={() => setGran(k)}>{t}</button>)}
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!serie.length} onClick={() => ui.downloadCSV(`garantias_tendencia_${gran}.csv`, ["Periodo", "Productos armados", "Productos con garantía", "% garantía sobre armados", "% sobre total productos"], serie.map((x) => [x.key, x.armados, x.garantias, x.pctGarantia.toFixed(2).replace(".", ","), x.pctTotal.toFixed(2).replace(".", ",")]))}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={serie.map((x) => ({ p: etiqueta(x.key), garantias: x.garantias, armados: x.armados, pct: Math.round(x.pctGarantia * 100) / 100 }))} margin={{ left: 0, right: 10, top: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="p" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="n" tick={{ fontSize: 10 }} allowDecimals={false} /><YAxis yAxisId="p" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip contentStyle={TIP} formatter={(v, n) => (n === "% garantía" ? `${v}%` : v)} /><Legend />
                    <ReferenceLine yAxisId="p" y={meta} stroke={ROJO} strokeDasharray="5 4" label={{ value: "Meta", fontSize: 10, fill: ROJO, position: "insideTopRight" }} />
                    <Bar yAxisId="n" dataKey="garantias" name="Garantías" fill={NARANJA} isAnimationActive={false} radius={[3, 3, 0, 0]} />
                    <Line yAxisId="p" type="monotone" dataKey="pct" name="% garantía" stroke={AZUL} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="amg-card" style={{ overflow: "auto", maxHeight: 420 }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Periodo</th><th>Armados</th><th>Garantías</th><th style={{ minWidth: 190 }}>% garantía sobre armados</th><th>% sobre total</th></tr></thead>
                  <tbody>{[...serie].reverse().map((x) => <tr key={x.key}><td className="amg-mono">{gran === "dia" ? fechaCorta(x.key) : etiqueta(x.key)}</td><td className="amg-mono">{fmtInt(x.armados)}</td><td className="amg-mono" style={{ fontWeight: 700, color: x.garantias ? NARANJA : undefined }}>{fmtInt(x.garantias)}</td><td><BarraPct p={x.pctGarantia} /></td><td className="amg-mono">{fmtPct(x.pctTotal)}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}

          {tab === "tecnico" && <Tabla lista={porTec} titulo="Técnico" csv="tecnicos" extra={[{ t: "Departamento", v: (x) => x.depto }, { t: "Coordinador", v: (x) => x.coord }]} />}
          {tab === "departamento" && <Tabla lista={porDepto} titulo="Departamento" csv="departamentos" />}
          {tab === "coordinador" && <Tabla lista={porCoord} titulo="Coordinador" csv="coordinadores" />}
          {tab === "producto" && <Tabla lista={porProd} titulo="Producto" csv="productos" />}

          {tab === "detalle" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <input className="amg-input" style={{ width: 260 }} placeholder="Buscar servicio, técnico, cliente, producto..." value={busca} onChange={(e) => setBusca(e.target.value)} />
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{fmtInt(detalle.length)} producto(s) con garantía</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!detalle.length} onClick={() => ui.downloadCSV("garantias_detalle.csv", ["Fecha", "Empresa", "Servicio", "Cliente", "Departamento", "Ciudad", "Técnico", "Coordinador", "Producto", "Causal", "Notas", "Solución", "Diagnóstico"],
                  detalle.map((r) => [fechaCorta(r.fecha), r.empresa, r.servicio, r.cliente, r.depto, r.ciudad, r.tecnico, r.coordinador, r.producto, r.causal, r.notas, r.solucion, r.diagnostico]))}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Fecha</th><th>Servicio</th><th>Departamento</th><th>Técnico</th><th>Producto</th><th>Causal</th><th>Notas / solución</th></tr></thead>
                  <tbody>
                    {detalle.slice(pagina * PAGINA, pagina * PAGINA + PAGINA).map((r, i) => (
                      <tr key={`${r.servicio}-${r.fecha}-${i}`}>
                        <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{fechaCorta(r.fecha)}</td><td className="amg-mono">{r.servicio}</td><td>{r.depto}</td><td>{r.tecnico}</td>
                        <td><ui.HoverText text={r.producto} maxChars={40} /></td><td>{r.causal}</td>
                        <td style={{ maxWidth: 320 }}>{r.notas || r.solucion ? <>{r.notas}{r.solucion ? <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Solución: {r.solucion}</div> : null}</> : <span style={{ color: "var(--text-faint)" }}>–</span>}</td>
                      </tr>
                    ))}
                    {detalle.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay productos con garantía en este rango y filtros.</td></tr>}
                  </tbody>
                </table>
              </div>
              {detalle.length > PAGINA && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12.5 }}>
                  <button className="amg-btn" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
                  <span>{pagina * PAGINA + 1}–{Math.min(detalle.length, pagina * PAGINA + PAGINA)} de {detalle.length}</span>
                  <button className="amg-btn" disabled={(pagina + 1) * PAGINA >= detalle.length} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
                </div>
              )}
            </>
          )}
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>
            Armados = productos con ARMADO? = SI que no se cerraron como cancelados ni devueltos. Garantía = producto con la causal NO ARMADO POR NOVEDAD (no se pudo armar por un problema del producto y queda para garantía); los ARMADO CON NOVEDAD no cuentan como garantía, así que las garantías no son parte de los armados. % garantía = garantías ÷ armados.
            La empresa sale de la columna EMPRESA del CSV de carga (sin dato = JAMAR). El periodo anterior es el de igual duración justo antes del rango elegido.
          </div>
        </>
      )}
    </div>
  );
}
