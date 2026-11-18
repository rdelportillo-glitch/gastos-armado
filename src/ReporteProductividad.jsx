import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { AlertTriangle } from "lucide-react";
import { fetchHistory } from "./lib/asignacion/history";
import { fetchAll } from "./lib/maestrosApi";
import { loadMunicipiosViatico } from "./lib/viaticos";
import { nombreDepartamento } from "./lib/informeJamar";
import { useZonaCoord } from "./lib/useCoordinadores";
import { sumarDias } from "./lib/cierreExtreme";
import * as P from "./lib/productividad";

/* ============================================================================
   PRODUCTIVIDAD (Reportes)
   Minutos productivos por técnico y día frente a la meta (430 min = 100 %), a partir del histórico de asignación. La regla de cada causal (armado OK, no armado,
   diagnóstico, cliente no estaba / no quiso, solo llamada) se elige en Maestros → Causales; los minutos de cada regla y la meta se configuran en la pestaña Reglas.
   Pueblo (+15 min por producto) = municipio o barrio de Maestros → Viáticos por municipio. En pareja el tiempo base se divide y cada uno recibe el +15 completo.
============================================================================ */

const VERDE = "#12a166", ROJO = "#e0435c", NARANJA = "#ff9540";
const TIP = { background: "#fff", border: "1px solid #e2e7f1", borderRadius: 8, fontSize: 12 };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString("es-CO");
const fmtPct = (p, d = 1) => `${(isFinite(p) ? p : 0).toFixed(d).replace(".", ",")}%`;
const corto = (s, n) => { const t = String(s || ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "–");
const TABS = [["resumen", "Resumen"], ["tecnico", "Por técnico"], ["dia", "Por día"], ["detalle", "Detalle"], ["reglas", "Reglas"]];
const PRESETS = [["hoy", "Hoy"], ["ayer", "Ayer"], ["7", "7 días"], ["30", "30 días"], ["mes", "Este mes"], ["mesAnt", "Mes anterior"]];
const PAGINA = 100;

export default function ReporteProductividad({ db, session, ui }) {
  const hoy = ui.todayISO();
  const [from, setFrom] = useState(sumarDias(hoy, -6));
  const [to, setTo] = useState(hoy);
  const [preset, setPreset] = useState("7");
  const [rows, setRows] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [ctx, setCtx] = useState(null); // { esPueblo, productos, complejidad }
  const [error, setError] = useState("");
  const [tab, setTab] = useState("resumen");
  const [f, setF] = useState({ dept: "", coord: "", tec: "" });
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [edit, setEdit] = useState(null); // configuración en edición (solo administrador)
  const [guardando, setGuardando] = useState(false);
  const zona = useZonaCoord(db);
  const esAdmin = session && session.role === "admin";

  const aplicarPreset = (p) => {
    setPreset(p);
    const d = (n) => sumarDias(hoy, n);
    if (p === "hoy") { setFrom(hoy); setTo(hoy); } else if (p === "ayer") { setFrom(d(-1)); setTo(d(-1)); }
    else if (p === "7") { setFrom(d(-6)); setTo(hoy); } else if (p === "30") { setFrom(d(-29)); setTo(hoy); } else if (p === "mes") { setFrom(`${hoy.slice(0, 7)}-01`); setTo(hoy); }
    else if (p === "mesAnt") { const ult = sumarDias(`${hoy.slice(0, 7)}-01`, -1); setFrom(`${ult.slice(0, 7)}-01`); setTo(ult); }
  };

  // Configuración, municipios con viático (pueblos) y maestros de productos/complejidad: se leen una vez.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, mun, productos, complejidad] = await Promise.all([
          P.cargarCfg().catch(() => ({ config: P.CONFIG_DEFAULT, reglas: {} })),
          loadMunicipiosViatico().catch(() => []),
          fetchAll("assembly_products", "code,line,subline", "code").catch(() => []),
          fetchAll("assembly_complexity", "line,subline,complexity,embeddable", "line").catch(() => []),
        ]);
        if (alive) { setCfg(c); setCtx({ esPueblo: P.crearEsPueblo(mun), productos, complejidad, municipios: mun.length }); }
      } catch (e) { if (alive) { setCfg({ config: P.CONFIG_DEFAULT, reglas: {} }); setCtx({ esPueblo: () => false, productos: [], complejidad: [], municipios: 0 }); setError(e.message); } }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    setError(""); setRows(null);
    fetchHistory({ from: from || undefined, to: to || undefined }).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) { setRows([]); setError(e.message); } });
    return () => { alive = false; };
  }, [from, to]);

  const meta = (cfg && cfg.config.meta) || P.CONFIG_DEFAULT.meta;
  const calculo = useMemo(() => {
    if (!rows || !cfg || !ctx) return null;
    const esComplejo = P.crearEsComplejo({ productos: ctx.productos, complejidad: ctx.complejidad, services: db.services });
    return P.calcularItems({ rows, technicians: db.technicians, cfg, esPueblo: ctx.esPueblo, esComplejo });
  }, [rows, cfg, ctx, db.technicians, db.services]);

  // Cada ítem lleva su departamento (nombre) y coordinador para los filtros.
  const todos = useMemo(() => (calculo ? calculo.items.map((x) => ({ ...x, depto: nombreDepartamento(x.departamento) || "Sin departamento", coord: zona.coordDe(x.departamento) || "Sin coordinador" })) : null), [calculo, zona.nombres]);
  const pasa = (x) => (!f.dept || x.depto === f.dept) && (!f.coord || x.coord === f.coord) && (!f.tec || x.nombre === f.tec);
  const items = useMemo(() => (todos || []).filter(pasa), [todos, f]);
  const dias = useMemo(() => P.porTecnicoDia(items, meta), [items, meta]);
  const tecnicos = useMemo(() => P.resumenPorTecnico(dias, meta).sort((a, b) => b.pct - a.pct), [dias, meta]);
  const opciones = useMemo(() => {
    const u = (fn) => [...new Set((todos || []).map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));
    const base = (todos || []).filter((x) => (!f.dept || x.depto === f.dept) && (!f.coord || x.coord === f.coord));
    return { depto: u((x) => x.depto), coord: u((x) => (!f.dept || x.depto === f.dept ? x.coord : null)), tec: [...new Set(base.map((x) => x.nombre))].sort((a, b) => a.localeCompare(b, "es")) };
  }, [todos, f.dept, f.coord]);
  const setFiltro = (k, v) => setF((x) => ({ ...x, [k]: v, ...(k === "dept" ? { coord: "", tec: "" } : {}), ...(k === "coord" ? { tec: "" } : {}) }));
  const hayFiltros = Object.values(f).some(Boolean);

  const total = useMemo(() => {
    const min = dias.reduce((s, d) => s + d.minutos, 0);
    const prom = dias.length ? min / dias.length : 0;
    return { min, prom, pct: meta > 0 ? (prom / meta) * 100 : 0, cumplen: dias.filter((d) => d.minutos >= meta).length, pueblos: items.filter((x) => x.pueblo).length };
  }, [dias, items, meta]);

  const color = (p) => (p >= 100 ? VERDE : p >= 80 ? NARANJA : ROJO);
  const BarraPct = ({ p }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160 }}>
      <div style={{ flex: 1, height: 8, background: "var(--panel-2)", borderRadius: 4 }}><div style={{ width: `${Math.min(100, p)}%`, height: "100%", borderRadius: 4, background: color(p) }} /></div>
      <span className="amg-mono" style={{ fontSize: 12, width: 56, textAlign: "right", color: color(p), fontWeight: 600 }}>{fmtPct(p)}</span>
    </div>
  );

  const detalle = useMemo(() => {
    const q = String(busca || "").toUpperCase();
    return items.filter((x) => !q || `${x.servicio} ${x.nombre} ${x.producto} ${x.causal} ${x.depto}`.toUpperCase().includes(q))
      .sort((a, b) => String(b.day).localeCompare(String(a.day)) || a.nombre.localeCompare(b.nombre, "es") || String(a.servicio).localeCompare(String(b.servicio)));
  }, [items, busca]);
  const diasLista = useMemo(() => [...dias].sort((a, b) => String(b.day).localeCompare(String(a.day)) || a.nombre.localeCompare(b.nombre, "es")), [dias]);
  useEffect(() => { setPagina(0); }, [busca, items, tab]);

  const ETQ = P.etiquetasRegla(cfg ? cfg.config : P.CONFIG_DEFAULT);
  const guardar = async () => {
    setGuardando(true); setError("");
    try { await P.guardarCfg(edit, session.id); setCfg(edit); setEdit(null); } catch (e) { setError(e.message); }
    setGuardando(false);
  };
  const campoCfg = (k, t) => (
    <label style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 3 }}>{t}
      <input type="number" min={0} className="amg-input" style={{ width: 110 }} value={edit.config[k]} onChange={(e) => setEdit({ ...edit, config: { ...edit.config, [k]: Math.max(0, Number(e.target.value) || 0) } })} /></label>
  );

  const cargando = !calculo;
  const sinDatos = !!calculo && items.length === 0;
  const csvHoy = (nombre, cab, filas) => ui.downloadCSV(nombre, cab, filas);

  return (
    <div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginRight: 6 }}>Productividad</div>
          {PRESETS.map(([k, t]) => <button key={k} className="amg-btn" style={preset === k ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : undefined} onClick={() => aplicarPreset(k)}>{t}</button>)}
          <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => { setFrom(e.target.value); setPreset(""); if (e.target.value && to && e.target.value > to) setTo(e.target.value); }} />
          <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => { setTo(e.target.value); setPreset(""); if (e.target.value && from && e.target.value < from) setFrom(e.target.value); }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select className="amg-select" style={{ width: 170 }} value={f.dept} onChange={(e) => setFiltro("dept", e.target.value)}><option value="">Todos los departamentos</option>{opciones.depto.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className="amg-select" style={{ width: 180 }} value={f.coord} onChange={(e) => setFiltro("coord", e.target.value)}><option value="">Todos los coordinadores</option>{opciones.coord.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className="amg-select" style={{ width: 200 }} value={f.tec} onChange={(e) => setFiltro("tec", e.target.value)}><option value="">Todos los técnicos</option>{opciones.tec.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          {hayFiltros && <button className="amg-btn" onClick={() => setF({ dept: "", coord: "", tec: "" })}>✕ Quitar filtros</button>}
          <span style={{ fontSize: 12.5, color: "var(--text-dim)", marginLeft: "auto" }}>Meta: <b>{fmtInt(meta)} min</b> por técnico y día = 100 %</span>
        </div>
        {error && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {error}</div>}
      </div>

      {cargando && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Calculando la productividad...</div>}

      {!cargando && (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{TABS.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}</button>)}</div>

          {sinDatos && tab !== "reglas" && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>No hay servicios con técnico en el histórico para ese rango y filtros. El reporte sale de los días ya finalizados en Carga.</div>}

          {!sinDatos && tab === "resumen" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 12, marginBottom: 14 }}>
                <ui.StatCard label="Productividad promedio" value={fmtPct(total.pct)} accent sub={`${fmt1(total.prom)} min por técnico y día (meta ${fmtInt(meta)})`} />
                <ui.StatCard label="Técnicos" value={fmtInt(tecnicos.length)} sub={`${fmtInt(dias.length)} días de trabajo en el rango`} />
                <ui.StatCard label="Días que llegaron a la meta" value={fmtInt(total.cumplen)} sub={`de ${fmtInt(dias.length)} (${fmtPct(dias.length ? (total.cumplen / dias.length) * 100 : 0)})`} />
                <ui.StatCard label="Minutos productivos" value={fmtInt(total.min)} sub={`${fmtInt(total.pueblos)} productos en pueblo (+${cfg.config.pueblo} min)`} />
              </div>
              <div className="amg-card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Minutos promedio por día de cada técnico (línea = meta de {fmtInt(meta)} min)</div>
                <ResponsiveContainer width="100%" height={Math.max(220, tecnicos.length * 26 + 50)}>
                  <BarChart data={[...tecnicos].sort((a, b) => b.promedio - a.promedio).map((x) => ({ n: corto(x.nombre, 26), prom: x.promedio, pct: x.pct }))} layout="vertical" margin={{ left: 10, right: 50 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis type="number" tick={{ fontSize: 10 }} domain={[0, (max) => Math.ceil(Math.max(meta * 1.1, max))]} /><YAxis type="category" dataKey="n" width={160} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={TIP} formatter={(v, n, p) => [`${v} min (${fmtPct(p.payload.pct)})`, "Promedio por día"]} />
                    <ReferenceLine x={meta} stroke={ROJO} strokeDasharray="5 4" label={{ value: `Meta ${fmtInt(meta)}`, fontSize: 10, fill: ROJO, position: "top" }} />
                    <Bar dataKey="prom" radius={[0, 3, 3, 0]} isAnimationActive={false} label={{ position: "right", fontSize: 10 }}>{tecnicos.map((x, i) => <Cell key={i} fill={color(x.pct)} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {!sinDatos && tab === "tecnico" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{tecnicos.length} técnico(s)</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={() => csvHoy("productividad_tecnicos.csv", ["Técnico", "Departamento", "Días con servicios", "Minutos productivos", "Promedio por día", "% productividad", "Días que llegaron a la meta", "Productos"],
                  tecnicos.map((x) => [x.nombre, x.depto, x.dias, x.minutos, String(x.promedio).replace(".", ","), x.pct.toFixed(1).replace(".", ","), x.diasMeta, x.productos]))}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto", maxHeight: 560 }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Técnico</th><th>Departamento</th><th title="Días en los que tuvo servicios en el histórico">Días</th><th>Minutos</th><th title="Minutos ÷ días con servicios">Promedio por día</th><th style={{ minWidth: 190 }} title={`Promedio por día ÷ ${meta} min`}>% productividad</th><th title="Días con al menos la meta de minutos">Días en meta</th></tr></thead>
                  <tbody>
                    {tecnicos.map((x) => (
                      <tr key={x.key}>
                        <td style={{ fontWeight: 600 }}>{x.nombre}</td><td>{nombreDepartamento(x.depto) || x.depto}</td><td className="amg-mono">{x.dias}</td><td className="amg-mono">{fmt1(x.minutos)}</td>
                        <td className="amg-mono" style={{ fontWeight: 700 }}>{fmt1(x.promedio)}</td><td><BarraPct p={x.pct} /></td><td className="amg-mono">{x.diasMeta} de {x.dias}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!sinDatos && tab === "dia" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{fmtInt(diasLista.length)} día(s) de técnico</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={() => csvHoy("productividad_por_dia.csv", ["Fecha", "Técnico", "Servicios", "Productos", "Minutos productivos", "% productividad", "Productos en pueblo"],
                  diasLista.map((d) => [fechaCorta(d.day), d.nombre, d.servicios, d.productos, String(d.minutos).replace(".", ","), d.pct.toFixed(1).replace(".", ","), d.pueblos]))}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Fecha</th><th>Técnico</th><th>Servicios</th><th>Productos</th><th>Minutos</th><th style={{ minWidth: 190 }}>% productividad</th></tr></thead>
                  <tbody>
                    {diasLista.slice(pagina * PAGINA, pagina * PAGINA + PAGINA).map((d) => (
                      <tr key={`${d.key}|${d.day}`}><td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{fechaCorta(d.day)}</td><td style={{ fontWeight: 600 }}>{d.nombre}</td><td className="amg-mono">{d.servicios}</td><td className="amg-mono">{d.productos}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{fmt1(d.minutos)}</td><td><BarraPct p={d.pct} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {diasLista.length > PAGINA && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12.5 }}>
                  <button className="amg-btn" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
                  <span>{pagina * PAGINA + 1}–{Math.min(diasLista.length, pagina * PAGINA + PAGINA)} de {diasLista.length}</span>
                  <button className="amg-btn" disabled={(pagina + 1) * PAGINA >= diasLista.length} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
                </div>
              )}
            </>
          )}

          {!sinDatos && tab === "detalle" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <input className="amg-input" style={{ width: 260 }} placeholder="Buscar servicio, técnico, producto, causal..." value={busca} onChange={(e) => setBusca(e.target.value)} />
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{fmtInt(detalle.length)} línea(s)</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!detalle.length} onClick={() => csvHoy("productividad_detalle.csv", ["Fecha", "Servicio", "Técnico", "Rol", "En pareja con", "Departamento", "Ciudad", "Pueblo", "Producto", "Causal", "Regla", "Complejo", "Minutos base", "Minutos pueblo", "Minutos", "Nota"],
                  detalle.map((x) => [fechaCorta(x.day), x.servicio, x.nombre, x.rol, x.conQuien, x.depto, x.ciudad, x.pueblo ? "Sí" : "No", x.producto, x.causal, ETQ[x.regla], x.complejo ? "Sí" : "No", String(x.base).replace(".", ","), x.extraPueblo, String(x.minutos).replace(".", ","), x.nota]))}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Fecha</th><th>Servicio</th><th>Técnico</th><th>Producto</th><th>Causal</th><th>Regla</th><th title="Tiempo base de la regla (dividido si fue en pareja)">Base</th><th title="+15 si es pueblo">Pueblo</th><th>Minutos</th></tr></thead>
                  <tbody>
                    {detalle.slice(pagina * PAGINA, pagina * PAGINA + PAGINA).map((x, i) => (
                      <tr key={`${x.servicio}-${x.day}-${x.key}-${i}`}>
                        <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{fechaCorta(x.day)}</td><td className="amg-mono">{x.servicio}</td>
                        <td>{x.nombre}{x.pareja ? <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{x.rol} · en pareja con {x.conQuien}</div> : null}</td>
                        <td><ui.HoverText text={x.producto} maxChars={34} /></td><td>{x.causal || <span style={{ color: "var(--text-faint)" }}>–</span>}</td>
                        <td style={{ fontSize: 11.5 }}>{ETQ[x.regla]}{x.complejo ? " · complejo" : ""}{x.nota ? <div style={{ color: "var(--text-faint)" }}>{x.nota}</div> : null}</td>
                        <td className="amg-mono">{fmt1(x.base)}</td><td className="amg-mono">{x.pueblo ? `+${x.extraPueblo}` : "–"}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{fmt1(x.minutos)}</td>
                      </tr>
                    ))}
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

          {tab === "reglas" && (
            <div className="amg-card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Cómo se calcula</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--text-dim)" }}>
                <div><b>Meta:</b> {fmtInt(cfg.config.meta)} min por técnico y día = 100 % de productividad ({fmtInt(cfg.config.jornada)} min = jornada laboral completa, solo de referencia).</div>
                <div><b>Armado OK:</b> el tiempo completo del producto. <b>No armado:</b> {cfg.config.noArmado} min por producto ({cfg.config.noArmadoComplejo} si es complejo: complejidad Alta o empotrable).</div>
                <div><b>Diagnóstico:</b> {cfg.config.diagnostico} min, una vez por servicio. <b>Cliente no estaba / no quiso:</b> {cfg.config.visita} min, una vez por servicio. <b>Solo llamada (cliente canceló):</b> 0 min.</div>
                <div><b>Pueblo:</b> +{cfg.config.pueblo} min por producto (una vez por servicio en diagnóstico y visitas) si el municipio o barrio está en Maestros → Viáticos por municipio ({fmtInt(ctx.municipios)} activos).</div>
                <div><b>En pareja:</b> el tiempo base se divide entre el técnico y su apoyo; cada uno recibe completo el +{cfg.config.pueblo} del pueblo.</div>
                <div>La regla de cada causal se elige en <b>Maestros → Causales</b> (columna Productividad). Lo que no tiene técnico o causal, o es pendiente, no suma. El promedio diario cuenta solo los días en que el técnico tuvo servicios en el histórico.</div>
                {calculo.sinTecnico > 0 && <div style={{ marginTop: 6 }}>{fmtInt(calculo.sinTecnico)} producto(s) del rango no tienen técnico (almacén, devueltos...) y no se cuentan.</div>}
              </div>
              {esAdmin && !edit && <button className="amg-btn" style={{ marginTop: 12 }} onClick={() => setEdit({ config: { ...cfg.config }, reglas: cfg.reglas })}>Cambiar meta y minutos</button>}
              {esAdmin && edit && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                    {campoCfg("meta", "Meta (min por día)")}{campoCfg("jornada", "Jornada (referencia)")}{campoCfg("noArmado", "No armado")}{campoCfg("noArmadoComplejo", "No armado complejo")}
                    {campoCfg("diagnostico", "Diagnóstico")}{campoCfg("visita", "Cliente no estaba / no quiso")}{campoCfg("pueblo", "Pueblo (+ por producto)")}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button className="amg-btn primary" disabled={guardando || !(edit.config.meta > 0)} onClick={guardar}>{guardando ? "Guardando..." : "Guardar"}</button>
                    <button className="amg-btn" disabled={guardando} onClick={() => setEdit(null)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
