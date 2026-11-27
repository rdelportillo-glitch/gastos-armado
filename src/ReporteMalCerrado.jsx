import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { AlertTriangle } from "lucide-react";
import { fetchHistory, loadRegionInfo } from "./lib/asignacion/history";
import { filasCsvDeHistorico } from "./lib/asignacion/csvCarga";
import { useZonaCoord } from "./lib/useCoordinadores";
import { sumarDias, diasEntre, semanaIso } from "./lib/cierreExtreme";
import * as MC from "./lib/malCerrado";

/* ============================================================================
   SERVICIO MAL CERRADO (Reportes)
   Productos que se cerraron en Extreme con una causal y la auditoría corrigió con otra, frente a todos los cierres de Extreme; por técnico, departamento, coordinador,
   cambio de causal y por día, semana o mes. No cuentan preventiva ni las devoluciones ALMACEN y SOBRECARGA. Sale del histórico de asignación, igual que Garantías.
============================================================================ */

const VERDE = "#12a166", ROJO = "#e0435c", AZUL = "#2f6fed", NARANJA = "#ff9540";
const TIP = { background: "#fff", border: "1px solid #e2e7f1", borderRadius: 8, fontSize: 12 };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmtPct = (p, d = 1) => `${(isFinite(p) ? p : 0).toFixed(d).replace(".", ",")}%`;
const num2 = (v) => v.toFixed(2).replace(".", ",");
const corto = (s, n) => { const t = String(s || ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "–");
const nombre = (s) => String(s || "").replace(/_/g, " ");
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const TABS = [["resumen", "Resumen"], ["tendencia", "Tendencia"], ["tecnico", "Técnico"], ["departamento", "Departamento"], ["coordinador", "Coordinador"], ["causales", "Cambios de causal"], ["detalle", "Detalle"]];
const PRESETS = [["hoy", "Hoy"], ["ayer", "Ayer"], ["7", "7 días"], ["30", "30 días"], ["mes", "Este mes"], ["mesAnt", "Mes anterior"], ["todo", "Todo"]];
const SIN_FILTROS = { dept: "", coord: "", tec: "", ext: "", aud: "" };
const PAGINA = 100;

export default function ReporteMalCerrado({ db, ui }) {
  const hoy = ui.todayISO();
  const [from, setFrom] = useState(sumarDias(hoy, -29));
  const [to, setTo] = useState(hoy);
  const [preset, setPreset] = useState("30");
  const [rows, setRows] = useState(null);
  const [regionInfo, setRegionInfo] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("resumen");
  const [empresa, setEmpresa] = useState("");
  const [f, setF] = useState(SIN_FILTROS);
  const [gran, setGran] = useState("dia");
  const [meta, setMeta] = useState(1);       // referencia: % de cierres mal hechos aceptable (solo colorea)
  const [minCie, setMinCie] = useState(1);   // en las tablas, grupos con al menos estos cierres (los que tienen casos siempre salen)
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
  const prevDesde = from && dias ? sumarDias(from, -dias) : "", prevHasta = from ? sumarDias(from, -1) : "";
  useEffect(() => { loadRegionInfo().then(setRegionInfo).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    setError(""); setRows(null);
    fetchHistory({ from: prevDesde || from || undefined, to: to || undefined }).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) { setRows([]); setError(e.message); } });
    return () => { alive = false; };
  }, [from, to]);

  const todos = useMemo(() => {
    if (!rows) return null;
    const filas = filasCsvDeHistorico({ rows, services: db.services, technicians: db.technicians, causales: db.causales, regionLabel: (r) => (regionInfo ? regionInfo.label(r) : ""), coordDe: (d) => zona.coordDe(d), empresaDe: regionInfo ? regionInfo.empresaDe : undefined });
    return MC.registrosDeFilas(filas);
  }, [rows, db.services, db.technicians, db.causales, regionInfo, zona.nombres]);

  const base = useMemo(() => (todos || []).filter((r) => !empresa || r.empresa === empresa), [todos, empresa]);
  const pasa = (r) => (!f.dept || r.depto === f.dept) && (!f.coord || r.coordinador === f.coord) && (!f.tec || r.tecnico === f.tec) && (!f.ext || r.causalExtreme === f.ext) && (!f.aud || r.causalAuditada === f.aud);
  const actual = useMemo(() => base.filter((r) => (!from || r.fecha >= from) && (!to || r.fecha <= to) && pasa(r)), [base, from, to, f]);
  const previo = useMemo(() => (prevDesde ? base.filter((r) => r.fecha >= prevDesde && r.fecha <= prevHasta && pasa(r)) : []), [base, from, to, f]);
  const S = useMemo(() => MC.resumir(actual), [actual]);
  const Sprev = useMemo(() => MC.resumir(previo), [previo]);
  const delta = prevDesde && Sprev.cierres ? S.pct - Sprev.pct : null;

  const empresas = useMemo(() => [...new Set((todos || []).map((r) => r.empresa))].sort(), [todos]);
  const opciones = useMemo(() => {
    const dentro = base.filter((r) => (!from || r.fecha >= from) && (!to || r.fecha <= to));
    const u = (lista, fn) => [...new Set(lista.map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));
    const malos = dentro.filter((r) => r.mal);
    return {
      depto: u(dentro, (r) => r.depto), coord: u(dentro, (r) => (!f.dept || r.depto === f.dept ? r.coordinador : null)),
      tec: u(dentro, (r) => ((!f.dept || r.depto === f.dept) && (!f.coord || r.coordinador === f.coord) ? r.tecnico : null)),
      ext: u(malos, (r) => r.causalExtreme), aud: u(malos, (r) => r.causalAuditada), // solo las causales que aparecen en casos mal cerrados
    };
  }, [base, from, to, f.dept, f.coord]);
  const setFiltro = (k, v) => setF((x) => ({ ...x, [k]: v, ...(k === "dept" ? { coord: "", tec: "" } : {}), ...(k === "coord" ? { tec: "" } : {}) }));
  const hayFiltros = Object.values(f).some(Boolean) || empresa;

  const color = (p) => (p <= meta ? VERDE : p <= meta * 1.5 ? NARANJA : ROJO);
  const porTec = useMemo(() => MC.agrupar(actual, (r) => r.tecnico).map((x) => ({ ...x, depto: MC.moda(x.regs, (r) => r.depto), coord: MC.moda(x.regs, (r) => r.coordinador) })), [actual]);
  const porDepto = useMemo(() => MC.agrupar(actual, (r) => r.depto), [actual]);
  const porCoord = useMemo(() => MC.agrupar(actual, (r) => r.coordinador), [actual]);
  const porExtreme = useMemo(() => MC.agrupar(actual.filter((r) => r.cierre), (r) => r.causalExtreme).filter((x) => x.mal > 0), [actual]);
  const pares = useMemo(() => MC.cambios(actual), [actual]);
  const serie = useMemo(() => {
    const fn = gran === "semana" ? (r) => (r.fecha ? semanaIso(r.fecha) : "") : gran === "mes" ? (r) => r.fecha.slice(0, 7) : (r) => r.fecha;
    return MC.agrupar(actual.filter((r) => r.cierre || r.mal), fn).sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }, [actual, gran]);
  const etiqueta = (k) => (gran === "dia" ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : gran === "mes" ? `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : String(k).slice(2));

  const detalle = useMemo(() => {
    const q = String(busca || "").toUpperCase();
    return actual.filter((r) => r.mal && (!q || `${r.servicio} ${r.tecnico} ${nombre(r.tecnico)} ${r.cliente} ${r.producto} ${r.depto} ${r.causalExtreme} ${r.causalAuditada}`.toUpperCase().includes(q)))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || a.depto.localeCompare(b.depto, "es") || a.tecnico.localeCompare(b.tecnico, "es"));
  }, [actual, busca]);
  useEffect(() => { setPagina(0); }, [busca, actual, tab]);

  const BarraPct = ({ p }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 150 }}>
      <div style={{ flex: 1, height: 8, background: "var(--panel-2)", borderRadius: 4 }}><div style={{ width: `${Math.min(100, (p / Math.max(meta * 3, 1)) * 100)}%`, height: "100%", borderRadius: 4, background: color(p) }} /></div>
      <span className="amg-mono" style={{ fontSize: 12, width: 52, textAlign: "right", color: color(p), fontWeight: 600 }}>{fmtPct(p)}</span>
    </div>
  );

  const Tabla = ({ lista, titulo, extra, csv, esTecnico }) => {
    const filtrada = lista.filter((x) => x.cierres >= minCie || x.mal > 0).sort((a, b) => b.mal - a.mal || b.pct - a.pct);
    return (
      <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{filtrada.length} de {lista.length} {titulo.toLowerCase()}(s). Pulsa el nombre para ver sus casos.</span>
          <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!filtrada.length} onClick={() => ui.downloadCSV(`mal_cerrado_${csv}.csv`, [titulo, ...(extra ? extra.map((e) => e.t) : []), "Cierres de Extreme", "Mal cerrados", "Servicios afectados", "% mal cerrado", "Participación en el total"],
            filtrada.map((x) => [x.key, ...(extra ? extra.map((e) => e.v(x)) : []), x.cierres, x.mal, x.servicios, num2(x.pct), num2(MC.pct(x.mal, S.mal))]))}>Exportar CSV</button>
        </div>
        <div className="amg-card" style={{ overflow: "auto", maxHeight: 520 }}>
          <table className="amg-table compact" style={{ fontSize: 12.5 }}>
            <thead><tr><th>{titulo}</th>{extra && extra.map((e) => <th key={e.t}>{e.t}</th>)}<th>Cierres Extreme</th><th>Mal cerrados</th><th>Servicios</th><th style={{ minWidth: 190 }}>% mal cerrado</th><th title="Qué parte de todos los mal cerrados es de este grupo">Part. del total</th></tr></thead>
            <tbody>
              {filtrada.map((x) => (
                <tr key={x.key}>
                  <td style={{ fontWeight: 600 }}>
                    <button className="amg-btn ghost" style={{ padding: 0, fontWeight: 600, textAlign: "left" }} disabled={!x.mal} onClick={() => { setBusca(esTecnico ? nombre(x.key) : String(x.key)); setTab("detalle"); }}>{esTecnico ? nombre(x.key) : x.key}</button>
                  </td>
                  {extra && extra.map((e) => <td key={e.t}>{e.v(x)}</td>)}
                  <td className="amg-mono">{fmtInt(x.cierres)}</td><td className="amg-mono" style={{ fontWeight: 700, color: x.mal ? ROJO : undefined }}>{fmtInt(x.mal)}</td><td className="amg-mono">{fmtInt(x.servicios)}</td>
                  <td>{x.cierres ? <BarraPct p={x.pct} /> : <span style={{ color: "var(--text-faint)", fontSize: 12 }}>sin cierres</span>}</td><td className="amg-mono">{fmtPct(MC.pct(x.mal, S.mal))}</td>
                </tr>
              ))}
              {filtrada.length === 0 && <tr><td colSpan={6 + (extra ? extra.length : 0)} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay datos con esos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const barras = (lista, { etiquetaDe = (x) => x.key, valor = "mal", colorDe = (x) => color(x.pct) } = {}) => (lista.length === 0
    ? <div style={{ color: "var(--text-faint)", fontSize: 12.5, padding: "30px 0", textAlign: "center" }}>Sin casos en el periodo.</div>
    : (
      <ResponsiveContainer width="100%" height={Math.max(200, lista.length * 28 + 40)}>
        <BarChart data={lista.map((x) => ({ n: corto(etiquetaDe(x), 34), v: x[valor] }))} layout="vertical" margin={{ left: 10, right: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} /><YAxis type="category" dataKey="n" width={210} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => [v, "Mal cerrados"]} contentStyle={TIP} />
          <Bar dataKey="v" radius={[0, 3, 3, 0]} isAnimationActive={false} label={{ position: "right", fontSize: 10 }}>{lista.map((x, i) => <Cell key={i} fill={colorDe(x)} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    ));

  const top = (lista) => [...lista].filter((x) => x.mal > 0).sort((a, b) => b.mal - a.mal).slice(0, 10);
  const cargando = todos === null;
  const sinDatos = !cargando && actual.length === 0;
  const Select = ({ k, vacio, lista, ancho = 180, formato = (x) => x }) => <select className="amg-select" style={{ width: ancho }} value={f[k]} onChange={(e) => setFiltro(k, e.target.value)}><option value="">{vacio}</option>{(f[k] && !lista.includes(f[k]) ? [f[k], ...lista] : lista).map((x) => <option key={x} value={x}>{formato(x)}</option>)}</select>;

  return (
    <div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginRight: 6 }}>Servicio mal cerrado</div>
          {PRESETS.map(([k, t]) => <button key={k} className="amg-btn" style={preset === k ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : undefined} onClick={() => aplicarPreset(k)}>{t}</button>)}
          <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => { setFrom(e.target.value); setPreset(""); if (e.target.value && to && e.target.value > to) setTo(e.target.value); }} />
          <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => { setTo(e.target.value); setPreset(""); if (e.target.value && from && e.target.value < from) setFrom(e.target.value); }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select className="amg-select" style={{ width: 170 }} value={empresa} onChange={(e) => setEmpresa(e.target.value)}><option value="">Todas las empresas</option>{empresas.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          {Select({ k: "dept", vacio: "Todos los departamentos", lista: opciones.depto })}
          {Select({ k: "coord", vacio: "Todos los coordinadores", lista: opciones.coord })}
          {Select({ k: "tec", vacio: "Todos los técnicos", lista: opciones.tec, ancho: 220, formato: nombre })}
          {Select({ k: "ext", vacio: "Cerrado en Extreme con…", lista: opciones.ext, ancho: 230 })}
          {Select({ k: "aud", vacio: "Causal correcta…", lista: opciones.aud, ancho: 230 })}
          {hayFiltros && <button className="amg-btn" onClick={() => { setF(SIN_FILTROS); setEmpresa(""); }}>✕ Quitar filtros</button>}
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", marginLeft: "auto" }} title="Solo colorea: verde si el % mal cerrado está en la meta o por debajo, naranja hasta 1,5 veces la meta y rojo por encima">Meta de referencia <input type="number" min={0} step={0.5} className="amg-input" style={{ width: 70 }} value={meta} onChange={(e) => setMeta(Math.max(0, Number(e.target.value) || 0))} />%</label>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }} title="En las tablas, solo grupos con al menos esta cantidad de cierres de Extreme (evita porcentajes engañosos con pocos cierres). Los grupos con casos siempre se muestran.">Mín. cierres <input type="number" min={0} className="amg-input" style={{ width: 70 }} value={minCie} onChange={(e) => setMinCie(Math.max(0, Number(e.target.value) || 0))} /></label>
        </div>
        {error && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {error}</div>}
      </div>

      {cargando && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Leyendo el histórico...</div>}
      {sinDatos && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>No hay productos en el histórico para ese rango y filtros. El reporte sale de los días ya finalizados en Carga.</div>}

      {!cargando && !sinDatos && (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{TABS.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}</button>)}</div>

          {tab === "resumen" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 12, marginBottom: 14 }}>
                <ui.StatCard label="Productos mal cerrados" value={fmtInt(S.mal)} accent sub={`${fmtInt(S.servicios)} servicio(s) afectado(s)`} />
                <ui.StatCard label="% mal cerrado" value={fmtPct(S.pct, 2)} sub={delta === null ? "sin periodo anterior para comparar" : `${delta > 0 ? "▲" : delta < 0 ? "▼" : "="} ${fmtPct(Math.abs(delta), 2)} frente al periodo anterior (${fmtPct(Sprev.pct, 2)})`} />
                <ui.StatCard label="Cierres de Extreme" value={fmtInt(S.cierres)} sub={`de ${fmtInt(S.total)} productos gestionados`} />
                <ui.StatCard label="Técnicos con casos" value={fmtInt(porTec.filter((x) => x.mal > 0).length)} sub={`de ${fmtInt(porTec.length)} técnicos`} />
                <ui.StatCard label="Cambio más repetido" value={fmtInt(pares[0] ? pares[0].casos : 0)} sub={pares[0] ? `${pares[0].extreme} → ${pares[0].auditada}` : "sin casos"} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 14 }}>
                <div className="amg-card" style={{ padding: 14 }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Técnicos con más casos</div>{barras(top(porTec), { etiquetaDe: (x) => nombre(x.key) })}</div>
                <div className="amg-card" style={{ padding: 14 }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Por departamento</div>{barras(top(porDepto))}</div>
                <div className="amg-card" style={{ padding: 14 }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Cambios de causal más repetidos</div>{barras(pares.slice(0, 10).map((x) => ({ ...x, mal: x.casos })), { etiquetaDe: (x) => `${corto(x.extreme, 16)} → ${corto(x.auditada, 16)}`, colorDe: () => AZUL })}</div>
                <div className="amg-card" style={{ padding: 14 }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Con qué causal se cerró mal (Extreme)</div>{barras(top(porExtreme))}</div>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>El color compara el % mal cerrado del grupo con la meta de referencia ({fmtPct(meta, 1)}): verde dentro, naranja hasta 1,5 veces, rojo por encima. La barra es la cantidad de casos.</div>
            </>
          )}

          {tab === "tendencia" && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
                {[["dia", "Por día"], ["semana", "Por semana"], ["mes", "Por mes"]].map(([k, t]) => <button key={k} className={`amg-btn ${gran === k ? "primary" : ""}`} onClick={() => setGran(k)}>{t}</button>)}
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!serie.length} onClick={() => ui.downloadCSV(`mal_cerrado_tendencia_${gran}.csv`, ["Periodo", "Cierres de Extreme", "Mal cerrados", "Servicios afectados", "% mal cerrado"], serie.map((x) => [x.key, x.cierres, x.mal, x.servicios, num2(x.pct)]))}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={serie.map((x) => ({ p: etiqueta(x.key), mal: x.mal, pct: Math.round(x.pct * 100) / 100 }))} margin={{ left: 0, right: 10, top: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="p" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="n" tick={{ fontSize: 10 }} allowDecimals={false} /><YAxis yAxisId="p" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip contentStyle={TIP} formatter={(v, n) => (n === "% mal cerrado" ? `${v}%` : v)} /><Legend />
                    <ReferenceLine yAxisId="p" y={meta} stroke={ROJO} strokeDasharray="5 4" label={{ value: "Meta", fontSize: 10, fill: ROJO, position: "insideTopRight" }} />
                    <Bar yAxisId="n" dataKey="mal" name="Mal cerrados" fill={NARANJA} isAnimationActive={false} radius={[3, 3, 0, 0]} />
                    <Line yAxisId="p" type="monotone" dataKey="pct" name="% mal cerrado" stroke={AZUL} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="amg-card" style={{ overflow: "auto", maxHeight: 420 }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Periodo</th><th>Cierres Extreme</th><th>Mal cerrados</th><th>Servicios</th><th style={{ minWidth: 190 }}>% mal cerrado</th></tr></thead>
                  <tbody>{[...serie].reverse().map((x) => <tr key={x.key}><td className="amg-mono">{gran === "dia" ? fechaCorta(x.key) : etiqueta(x.key)}</td><td className="amg-mono">{fmtInt(x.cierres)}</td><td className="amg-mono" style={{ fontWeight: 700, color: x.mal ? ROJO : undefined }}>{fmtInt(x.mal)}</td><td className="amg-mono">{fmtInt(x.servicios)}</td><td><BarraPct p={x.pct} /></td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}

          {tab === "tecnico" && Tabla({ lista: porTec, titulo: "Técnico", csv: "tecnicos", esTecnico: true, extra: [{ t: "Departamento", v: (x) => x.depto }, { t: "Coordinador", v: (x) => x.coord }] })}
          {tab === "departamento" && Tabla({ lista: porDepto, titulo: "Departamento", csv: "departamentos" })}
          {tab === "coordinador" && Tabla({ lista: porCoord, titulo: "Coordinador", csv: "coordinadores" })}

          {tab === "causales" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Con qué causal se cerró en Extreme y cuál era la correcta según la auditoría.</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!pares.length} onClick={() => ui.downloadCSV("mal_cerrado_causales.csv", ["Cerrado en Extreme", "Causal correcta (auditada)", "Casos", "Técnicos", "Participación"], pares.map((x) => [x.extreme, x.auditada, x.casos, x.tecnicos, num2(x.parte)]))}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto", maxHeight: 520 }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Cerrado en Extreme</th><th>Causal correcta (auditada)</th><th>Casos</th><th>Técnicos</th><th>Participación</th></tr></thead>
                  <tbody>
                    {pares.map((x) => <tr key={x.key}><td>{x.extreme}</td><td style={{ fontWeight: 600 }}>{x.auditada}</td><td className="amg-mono" style={{ fontWeight: 700, color: ROJO }}>{fmtInt(x.casos)}</td><td className="amg-mono">{fmtInt(x.tecnicos)}</td><td className="amg-mono">{fmtPct(x.parte)}</td></tr>)}
                    {pares.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay casos en este rango y filtros.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === "detalle" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <input className="amg-input" style={{ width: 280 }} placeholder="Buscar servicio, técnico, cliente, producto, causal..." value={busca} onChange={(e) => setBusca(e.target.value)} />
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{fmtInt(detalle.length)} producto(s) mal cerrado(s)</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!detalle.length} onClick={() => ui.downloadCSV("mal_cerrado_detalle.csv", ["Fecha", "Empresa", "Servicio", "Cliente", "Departamento", "Ciudad", "Técnico", "Coordinador", "Producto", "Cerrado en Extreme", "Causal correcta (auditada)", "Diagnóstico Extreme", "Notas"],
                  detalle.map((r) => [fechaCorta(r.fecha), r.empresa, r.servicio, r.cliente, r.depto, r.ciudad, r.tecnico, r.coordinador, r.producto, r.causalExtreme, r.causalAuditada, r.diagnostico, r.notas]))}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Fecha</th><th>Servicio</th><th>Departamento</th><th>Técnico</th><th>Producto</th><th>Cerrado en Extreme</th><th>Causal correcta</th><th>Diagnóstico / notas</th></tr></thead>
                  <tbody>
                    {detalle.slice(pagina * PAGINA, pagina * PAGINA + PAGINA).map((r, i) => (
                      <tr key={`${r.servicio}-${r.fecha}-${i}`}>
                        <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{fechaCorta(r.fecha)}</td><td className="amg-mono">{r.servicio}</td><td>{r.depto}</td><td>{nombre(r.tecnico)}</td>
                        <td><ui.HoverText text={r.producto} maxChars={36} /></td><td style={{ color: ROJO }}>{r.causalExtreme}</td><td style={{ fontWeight: 600 }}>{r.causalAuditada}</td>
                        <td style={{ maxWidth: 300 }}>{r.diagnostico || r.notas ? <>{r.diagnostico && <ui.HoverText text={r.diagnostico} maxChars={48} />}{r.notas ? <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{r.notas}</div> : null}</> : <span style={{ color: "var(--text-faint)" }}>–</span>}</td>
                      </tr>
                    ))}
                    {detalle.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay productos mal cerrados en este rango y filtros.</td></tr>}
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
            Mal cerrado = producto que se cerró en Extreme con una causal y la auditoría corrigió con otra (columna AUDITORIA del histórico). % mal cerrado = mal cerrados ÷ cierres de Extreme (productos con causal de Extreme). No cuentan los casos de preventiva ni las devoluciones ALMACEN y SOBRECARGA. Solo aparecen los productos ya auditados, así que los días recientes pueden subir a medida que se audita.
            El periodo anterior es el de igual duración justo antes del rango elegido.
          </div>
        </>
      )}
    </div>
  );
}
