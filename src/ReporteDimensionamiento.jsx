import { Fragment, useState, useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchHistory } from "./lib/asignacion/history";
import { nombreDepartamento } from "./lib/informeJamar";
import { sumarDias } from "./lib/cierreExtreme";
import { hoyLocal } from "./lib/finalizarDia";
import * as D from "./lib/dimensionamiento";

/* ============================================================================
   DIMENSIONAMIENTO (Reportes)
   Tiempo Jamar de la carga enviada ÷ 420 min = técnicos necesarios, por departamento y día, frente a los técnicos que nos pidieron en el mes (solicitados × 420 min).
   Un día anterior sale del histórico de asignación; el día de hoy (y lo que siga sin finalizar) sale de Carga. Alerta donde se envía más o menos carga de la solicitada.
   Los técnicos solicitados de cada mes, la jornada (420) y la tolerancia los cambia el administrador en la pestaña Técnicos solicitados.
============================================================================ */

const COLOR = { "Más carga": "#e0435c", "En línea": "#12a166", "Menos carga": "#ff9540", "Sin solicitados": "#7d8799" };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString("es-CO");
const fmtPct = (p) => (p === null || p === undefined || !isFinite(p) ? "–" : `${Number(p).toFixed(0)}%`);
const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "–");
const horas = (min) => `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
const TABS = [["depto", "Por departamento"], ["dia", "Por día"], ["detalle", "Detalle"], ["config", "Técnicos solicitados"]];
const PRESETS = [["hoy", "Hoy"], ["ayer", "Ayer"], ["7", "7 días"], ["30", "30 días"], ["mes", "Este mes"]];
const PAGINA = 100;

const Estado = ({ e }) => <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, color: "#fff", background: COLOR[e] || "#7d8799", whiteSpace: "nowrap" }}>{e}</span>;

export default function ReporteDimensionamiento({ db, session, ui }) {
  const hoy = hoyLocal();
  const [from, setFrom] = useState(sumarDias(hoy, -1));
  const [to, setTo] = useState(hoy);
  const [preset, setPreset] = useState("");
  const mesRef = (to || hoy).slice(0, 7); // mes con el que se listan los departamentos sin carga y se muestran los técnicos solicitados
  const [hist, setHist] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("depto");
  const [depto, setDepto] = useState("");
  const [cancelados, setCancelados] = useState(false);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [edit, setEdit] = useState(null);
  const [nuevoDepto, setNuevoDepto] = useState("");
  const [mesCfg, setMesCfg] = useState("");
  const [nuevoMes, setNuevoMes] = useState("");
  const [guardando, setGuardando] = useState(false);
  const esAdmin = session && session.role === "admin";

  const aplicarPreset = (p) => {
    setPreset(p);
    const d = (n) => sumarDias(hoy, n);
    if (p === "hoy") { setFrom(hoy); setTo(hoy); } else if (p === "ayer") { setFrom(d(-1)); setTo(d(-1)); } else if (p === "7") { setFrom(d(-6)); setTo(hoy); }
    else if (p === "30") { setFrom(d(-29)); setTo(hoy); } else if (p === "mes") { setFrom(`${hoy.slice(0, 7)}-01`); setTo(hoy); }
  };

  useEffect(() => { D.cargarCfg().then(setCfg).catch((e) => { setCfg(JSON.parse(JSON.stringify(D.CONFIG_DEFAULT))); setError(e.message); }); }, []);
  useEffect(() => {
    let alive = true;
    setHist(null); setError("");
    // Los días anteriores salen del histórico; el de hoy está en Carga (db.services), así que el histórico se pide solo hasta ayer.
    fetchHistory({ from: from || undefined, to: to && to >= hoy ? sumarDias(hoy, -1) : to || undefined })
      .then((r) => { if (alive) setHist(r); }).catch((e) => { if (alive) { setHist([]); setError(e.message); } });
    return () => { alive = false; };
  }, [from, to]);

  const registros = useMemo(() => (hist ? D.registrosDeCarga({ from, to, history: hist, services: db.services }) : null), [hist, from, to, db.services]);
  const todos = useMemo(() => (registros && cfg ? D.resumirPorDepto({ registros, cfg, incluirCancelados: cancelados, nombreDepto: nombreDepartamento, mesRef }) : null), [registros, cfg, cancelados]);
  const deptos = useMemo(() => (todos ? todos.filter((d) => !depto || d.key === depto) : []), [todos, depto]);
  const tot = useMemo(() => (todos && cfg ? D.totales(deptos, cfg) : null), [deptos, cfg]);
  const jornada = (cfg && Number(cfg.jornada)) || 420;
  const nombreMesCorto = (() => { const [a, n] = mesRef.split("-"); return `${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][Number(n) - 1]} ${a}`; })();
  const detalle = useMemo(() => {
    if (!registros) return [];
    const q = String(busca || "").toUpperCase();
    return registros.filter((r) => (cancelados || !r.cancelado) && (!depto || D.plano(nombreDepartamento(r.depto)) === depto) && (!q || `${r.servicio} ${r.depto} ${r.ciudad} ${r.producto}`.toUpperCase().includes(q)))
      .sort((a, b) => String(b.day).localeCompare(String(a.day)) || a.depto.localeCompare(b.depto, "es") || String(a.servicio).localeCompare(String(b.servicio)));
  }, [registros, busca, cancelados, depto]);
  useEffect(() => { setPagina(0); }, [busca, registros, tab, depto, cancelados]);
  const diasLista = useMemo(() => [...new Set(deptos.flatMap((d) => d.dias.map((x) => x.day)))].sort().reverse(), [deptos]);

  const guardar = async () => {
    setGuardando(true); setError("");
    try { await D.guardarCfg(edit, session.id); setCfg(edit); setEdit(null); } catch (e) { setError(e.message); }
    setGuardando(false);
  };
  const alternar = (k) => setAbiertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const exportarDeptos = () => ui.downloadCSV(`dimensionamiento_departamentos_${from}_${to}.csv`, ["Departamento", "Ciudad", "Técnicos solicitados", "Capacidad solicitada (min)", "Tiempo Jamar total (min)", "Días con carga", "Promedio diario (min)", "Técnicos necesarios (promedio)", "Técnicos necesarios día pico", "Día pico", "Solicitados menos necesarios", "% de la capacidad solicitada", "Días con más carga", "Días con menos carga", "Alerta"],
    deptos.flatMap((d) => [
      [d.nombre, "TOTAL", String(d.solicitados).replace(".", ","), d.capacidad, Math.round(d.total), d.dias.length, String(d.promMin).replace(".", ","), String(d.necesarios).replace(".", ","), d.picoNecesarios, fechaCorta(d.picoDia), String(d.diferencia).replace(".", ","), d.uso === null ? "" : Math.round(d.uso), d.diasMas, d.diasMenos, d.estado],
      ...d.ciudades.map((c) => [d.nombre, c.nombre, "", "", Math.round(c.min), c.dias, String(c.promMin).replace(".", ","), String(c.necesarios).replace(".", ","), "", "", "", "", "", "", ""]),
    ]));
  const exportarDias = () => ui.downloadCSV(`dimensionamiento_por_dia_${from}_${to}.csv`, ["Fecha", "Departamento", "Técnicos solicitados (del mes)", "Tiempo Jamar (min)", "Técnicos necesarios", "Solicitados menos necesarios", "Alerta"],
    deptos.flatMap((d) => d.dias.map((x) => [fechaCorta(x.day), d.nombre, x.solicitados, Math.round(x.min), String(x.necesarios).replace(".", ","), String(Math.round((x.solicitados - x.necesarios) * 10) / 10).replace(".", ","), x.estado])).sort((a, b) => String(b[0]).localeCompare(String(a[0]))));
  const exportarDetalle = () => ui.downloadCSV(`dimensionamiento_detalle_${from}_${to}.csv`, ["Fecha", "Servicio", "Departamento", "Ciudad", "Producto", "Tiempo Jamar (min)", "Tiempo usado (min)", "Origen", "Cancelado"],
    detalle.map((r) => [fechaCorta(r.day), r.servicio, nombreDepartamento(r.depto) || r.depto, r.ciudad, r.producto, Math.round(r.jamar), Math.round(r.usado), r.origen, r.cancelado ? "Sí" : "No"]));

  const cargando = hist === null || !cfg || !todos;

  return (
    <div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginRight: 6 }}>Dimensionamiento</div>
          {PRESETS.map(([k, t]) => <button key={k} className="amg-btn" style={preset === k ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : undefined} onClick={() => aplicarPreset(k)}>{t}</button>)}
          <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => { if (!e.target.value) return; setFrom(e.target.value); setPreset(""); if (to && e.target.value > to) setTo(e.target.value); }} />
          <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => { if (!e.target.value) return; setTo(e.target.value); setPreset(""); if (from && e.target.value < from) setFrom(e.target.value); }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <select className="amg-select" style={{ width: 190 }} value={depto} onChange={(e) => setDepto(e.target.value)}>
            <option value="">Todos los departamentos</option>{(todos || []).map((d) => <option key={d.key} value={d.key}>{d.nombre}</option>)}
          </select>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }} title="Por defecto no cuentan los registros cancelados (cliente cancela, preventiva, Jamar...)"><input type="checkbox" checked={cancelados} onChange={(e) => setCancelados(e.target.checked)} /> Incluir cancelados</label>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)", marginLeft: "auto" }}>Jornada: <b>{jornada} min</b> por técnico · hoy sale de Carga, los días anteriores del histórico</span>
        </div>
        {error && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {error}</div>}
      </div>

      {cargando && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Calculando la carga...</div>}

      {!cargando && (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{TABS.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}</button>)}</div>

          {tab !== "config" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 12, marginBottom: 14 }}>
              <ui.StatCard label="Tiempo Jamar" value={fmtInt(tot.total)} sub={`min · ${horas(tot.total)} en ${tot.dias} día(s)`} />
              <ui.StatCard label="Técnicos necesarios" value={fmt1(tot.necesarios)} accent sub={`promedio por día (${fmtInt(tot.promMin)} min ÷ ${jornada})`} />
              <ui.StatCard label="Técnicos solicitados" value={fmt1(tot.solicitados)} sub={`${fmtInt(tot.solicitados * jornada)} min por día (${nombreMesCorto})`} />
              <ui.StatCard label="Uso de lo solicitado" value={fmtPct(tot.uso)} sub={tot.estado} />
              <ui.StatCard label="Con más carga" value={fmtInt(tot.mas)} sub="departamentos sobre lo solicitado" />
              <ui.StatCard label="Con menos carga" value={fmtInt(tot.menos)} sub="departamentos bajo lo solicitado" />
            </div>
          )}

          {tab === "depto" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <button className="amg-btn" onClick={() => setAbiertos(new Set(deptos.map((d) => d.key)))}>Desplegar todo</button>
                <button className="amg-btn" onClick={() => setAbiertos(new Set())}>Contraer todo</button>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Haz clic en un departamento para ver sus ciudades.</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!deptos.length} onClick={exportarDeptos}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Departamento / ciudad</th><th title="Técnicos que nos pidieron en el mes (promedio de los días con carga si el rango cruza meses)">Técnicos solicitados</th><th title="Técnicos solicitados × jornada, por día">Capacidad (min)</th><th title="Tiempo Jamar promedio de los días con carga">Carga prom. (min)</th><th title="Carga promedio ÷ jornada">Técnicos necesarios</th><th title="Técnicos necesarios del día de mayor carga (redondeado hacia arriba)">Día pico</th><th title="Técnicos solicitados menos técnicos necesarios (negativo = falta gente)">Solicitados − necesarios</th><th>% de lo solicitado</th><th>Días +/−</th><th>Alerta</th></tr></thead>
                  <tbody>
                    {deptos.map((d) => (
                      <Fragment key={d.key}>
                        <tr style={{ background: "var(--panel-2)", cursor: "pointer" }} onClick={() => alternar(d.key)}>
                          <td style={{ fontWeight: 700 }}>{abiertos.has(d.key) ? "▾" : "▸"} {d.nombre}</td>
                          <td className="amg-mono">{fmt1(d.solicitados)}</td><td className="amg-mono">{fmtInt(d.capacidad)}</td><td className="amg-mono">{fmtInt(d.promMin)}</td>
                          <td className="amg-mono" style={{ fontWeight: 700 }}>{fmt1(d.necesarios)}</td><td className="amg-mono">{d.dias.length ? `${d.picoNecesarios} (${fechaCorta(d.picoDia).slice(0, 5)})` : "–"}</td>
                          <td className="amg-mono" style={{ fontWeight: 700, color: d.diferencia < 0 ? COLOR["Más carga"] : undefined }}>{d.diferencia > 0 ? "+" : ""}{fmt1(d.diferencia)}</td>
                          <td className="amg-mono">{fmtPct(d.uso)}</td><td className="amg-mono">{d.diasMas ? <span style={{ color: COLOR["Más carga"] }}>+{d.diasMas}</span> : "0"} / {d.diasMenos ? <span style={{ color: COLOR["Menos carga"] }}>−{d.diasMenos}</span> : "0"}</td>
                          <td><Estado e={d.estado} /></td>
                        </tr>
                        {abiertos.has(d.key) && d.ciudades.map((c) => (
                          <tr key={`${d.key}|${c.nombre}`}><td style={{ paddingLeft: 28, color: "var(--text-dim)" }}>{c.nombre}</td><td /><td /><td className="amg-mono">{fmtInt(c.promMin)}</td><td className="amg-mono">{fmt1(c.necesarios)}</td><td /><td /><td /><td className="amg-mono" style={{ color: "var(--text-faint)" }}>{c.registros} reg.</td><td /></tr>
                        ))}
                      </Fragment>
                    ))}
                    {deptos.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay carga en este rango.</td></tr>}
                    {deptos.length > 0 && (
                      <tr style={{ fontWeight: 700 }}><td>Total</td><td className="amg-mono">{fmt1(tot.solicitados)}</td><td className="amg-mono">{fmtInt(tot.solicitados * jornada)}</td><td className="amg-mono">{fmtInt(tot.promMin)}</td><td className="amg-mono">{fmt1(tot.necesarios)}</td><td /><td className="amg-mono">{fmt1(tot.solicitados - tot.necesarios)}</td><td className="amg-mono">{fmtPct(tot.uso)}</td><td /><td><Estado e={tot.estado} /></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === "dia" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Técnicos necesarios por día y departamento (Tiempo Jamar ÷ {jornada}). El color compara con los técnicos solicitados de ese mes: rojo más carga, naranja menos carga, verde en línea.</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!diasLista.length} onClick={exportarDias}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Fecha</th>{deptos.filter((d) => d.dias.length).map((d) => <th key={d.key} title={`Solicitados ${fmt1(d.solicitados)}`}>{d.nombre}<div style={{ fontWeight: 400, fontSize: 10.5, color: "var(--text-faint)" }}>solicitados {fmt1(d.solicitados)}</div></th>)}<th>Total</th></tr></thead>
                  <tbody>
                    {diasLista.map((day) => {
                      const celdas = deptos.filter((d) => d.dias.length).map((d) => d.dias.find((x) => x.day === day) || null);
                      const totalMin = celdas.reduce((s, x) => s + (x ? x.min : 0), 0);
                      return (
                        <tr key={day}><td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{fechaCorta(day)}{day === hoy ? <span style={{ marginLeft: 6, fontSize: 10.5, color: "var(--text-faint)" }}>(Carga)</span> : null}</td>
                          {celdas.map((x, i) => <td key={i} className="amg-mono" style={x ? { color: COLOR[x.estado], fontWeight: 700 } : { color: "var(--text-faint)" }} title={x ? `${fmtInt(x.min)} min · ${x.estado}` : ""}>{x ? fmt1(x.necesarios) : "–"}</td>)}
                          <td className="amg-mono" style={{ fontWeight: 700 }}>{fmt1(totalMin / jornada)}</td></tr>
                      );
                    })}
                    {diasLista.length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay carga en este rango.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === "detalle" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <input className="amg-input" style={{ width: 260 }} placeholder="Buscar servicio, departamento, ciudad, producto..." value={busca} onChange={(e) => setBusca(e.target.value)} />
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{fmtInt(detalle.length)} registro(s)</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!detalle.length} onClick={exportarDetalle}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Fecha</th><th>Servicio</th><th>Departamento</th><th>Ciudad</th><th>Producto</th><th title="El mayor entre el tiempo de Jamar y el del maestro de Biver">Tiempo Jamar</th><th title="El tiempo que usa Carga (maestro de Biver, o el de Jamar si el producto no está en el maestro)">Tiempo usado</th><th>Origen</th></tr></thead>
                  <tbody>
                    {detalle.slice(pagina * PAGINA, pagina * PAGINA + PAGINA).map((r, i) => (
                      <tr key={`${r.id}-${r.day}-${i}`} style={r.cancelado ? { opacity: 0.55 } : undefined}>
                        <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{fechaCorta(r.day)}</td><td className="amg-mono">{r.servicio}{r.cancelado ? <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>cancelado</div> : null}</td>
                        <td>{nombreDepartamento(r.depto) || r.depto}</td><td>{r.ciudad}</td><td><ui.HoverText text={r.producto} maxChars={36} /></td>
                        <td className="amg-mono" style={{ fontWeight: 700 }}>{fmtInt(r.jamar)}</td><td className="amg-mono">{fmtInt(r.usado)}</td><td>{r.origen}</td>
                      </tr>
                    ))}
                    {detalle.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay registros en este rango.</td></tr>}
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

          {tab === "config" && (() => {
            const v = edit || cfg;
            const meses = Object.keys(v.solicitados).sort();
            const sel = mesCfg && v.solicitados[mesCfg] ? mesCfg : D.mesVigente(v, mesRef);
            const tabla = v.solicitados[sel] || {};
            const filas = Object.entries(tabla).sort((a, b) => b[1] - a[1]);
            const nombreMes = (m) => { const [a, n] = m.split("-"); return `${["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][Number(n) - 1]} ${a}`; };
            const total = filas.reduce((s, [, n]) => s + n, 0);
            const poner = (k, n) => setEdit({ ...edit, solicitados: { ...edit.solicitados, [sel]: { ...edit.solicitados[sel], [k]: n } } });
            return (
              <div className="amg-card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Técnicos solicitados por mes</div>
                <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 10 }}>
                  Técnicos que nos pidieron por departamento en cada mes (columnas "Técnicos" del dimensionamiento). Cada día se compara con los del mes al que pertenece; un mes sin dato usa el último mes anterior que tenga. La capacidad de cada departamento es técnicos solicitados × {v.jornada} min por día. Alerta "Más carga" si los técnicos necesarios superan los solicitados en más de {v.tolerancia} %, y "Menos carga" si quedan más de {v.tolerancia} % por debajo.
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {meses.map((m) => <button key={m} className={`amg-btn ${m === sel ? "primary" : ""}`} onClick={() => setMesCfg(m)}>{nombreMes(m)}</button>)}
                </div>
                <table className="amg-table compact" style={{ fontSize: 12.5, maxWidth: 460 }}>
                  <thead><tr><th>Departamento</th><th>Técnicos solicitados</th><th>Capacidad por día (min)</th>{edit && <th />}</tr></thead>
                  <tbody>
                    {filas.map(([k, n]) => (
                      <tr key={k}><td>{nombreDepartamento(k) || k}</td>
                        <td>{edit ? <input type="number" min={0} className="amg-input" style={{ width: 80 }} value={n} onChange={(e) => poner(k, Math.max(0, Math.round(Number(e.target.value) || 0)))} /> : <span className="amg-mono" style={{ fontWeight: 700 }}>{n}</span>}</td>
                        <td className="amg-mono">{fmtInt(n * v.jornada)}</td>
                        {edit && <td><button className="amg-btn ghost" title="Quitar de este mes" onClick={() => { const p = { ...edit.solicitados[sel] }; delete p[k]; setEdit({ ...edit, solicitados: { ...edit.solicitados, [sel]: p } }); }}>✕</button></td>}</tr>
                    ))}
                    <tr style={{ fontWeight: 700 }}><td>Total</td><td className="amg-mono">{total}</td><td className="amg-mono">{fmtInt(total * v.jornada)}</td>{edit && <td />}</tr>
                  </tbody>
                </table>
                {esAdmin && !edit && <button className="amg-btn" style={{ marginTop: 12 }} onClick={() => setEdit(JSON.parse(JSON.stringify(cfg)))}>Cambiar técnicos solicitados</button>}
                {esAdmin && edit && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
                      <label style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 3 }}>Jornada (min)<input type="number" min={1} className="amg-input" style={{ width: 100 }} value={edit.jornada} onChange={(e) => setEdit({ ...edit, jornada: Math.max(1, Number(e.target.value) || 1) })} /></label>
                      <label style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 3 }}>Tolerancia (%)<input type="number" min={0} className="amg-input" style={{ width: 100 }} value={edit.tolerancia} onChange={(e) => setEdit({ ...edit, tolerancia: Math.max(0, Number(e.target.value) || 0) })} /></label>
                      <label style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 3 }}>Agregar mes (copia el mes elegido)
                        <span style={{ display: "flex", gap: 6 }}><input type="month" className="amg-input" style={{ width: 160 }} value={nuevoMes} onChange={(e) => setNuevoMes(e.target.value)} />
                          <button className="amg-btn" disabled={!nuevoMes || !!edit.solicitados[nuevoMes]} onClick={() => { setEdit({ ...edit, solicitados: { ...edit.solicitados, [nuevoMes]: { ...tabla } } }); setMesCfg(nuevoMes); setNuevoMes(""); }}>Agregar mes</button></span></label>
                      <label style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 3 }}>Agregar departamento a {nombreMes(sel)}
                        <span style={{ display: "flex", gap: 6 }}><input className="amg-input" style={{ width: 170 }} placeholder="Ej. Boyacá" value={nuevoDepto} onChange={(e) => setNuevoDepto(e.target.value)} />
                          <button className="amg-btn" disabled={!nuevoDepto.trim()} onClick={() => { const k = D.plano(nuevoDepto); if (!(k in tabla)) poner(k, 0); setNuevoDepto(""); }}>Agregar</button></span></label>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="amg-btn primary" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Guardar"}</button>
                      <button className="amg-btn" disabled={guardando} onClick={() => setEdit(null)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.5 }}>
            <b>Tiempo Jamar</b>: de cada registro, el mayor entre el tiempo de Jamar y el del maestro de Biver. <b>Técnicos necesarios</b> = Tiempo Jamar del día ÷ {jornada} min; el promedio cuenta solo los días con carga. El departamento es el del servicio (donde está la carga), no el del técnico.
            Los días anteriores salen del histórico de asignación; hoy, de Carga. Un día que aún no se ha finalizado se toma de Carga. Los cancelados no cuentan salvo que marques "Incluir cancelados".
          </div>
        </>
      )}
    </div>
  );
}
