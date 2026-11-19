import { Fragment, useState, useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchHistory } from "./lib/asignacion/history";
import { fetchAll } from "./lib/maestrosApi";
import { nombreDepartamento } from "./lib/informeJamar";
import { sumarDias } from "./lib/cierreExtreme";
import { hoyLocal } from "./lib/finalizarDia";
import * as D from "./lib/dimensionamiento";
import * as T from "./lib/diferenciaTiempos";

/* ============================================================================
   DIFERENCIA DE TIEMPOS (Reportes)
   Productos cuyo tiempo en Jamar es MENOR que el del maestro de Biver (Productos de armado), por línea, sublínea y producto. Diferencia = tiempo Biver − tiempo Jamar
   (por unidad × unidades) y su equivalente en técnicos (diferencia ÷ 420 min ÷ días con carga). Un día anterior sale del histórico de asignación; hoy, de Carga.
============================================================================ */

const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString("es-CO");
const fmtPct = (p) => (p === null || p === undefined || !isFinite(p) ? "–" : `${Number(p).toFixed(0)}%`);
const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "–");
const dec = (n) => String(Math.round((n || 0) * 10) / 10).replace(".", ",");
const fmt2 = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec2 = (n) => String(Math.round((n || 0) * 100) / 100).replace(".", ",");
const TABS = [["linea", "Por línea"], ["sublinea", "Por sublínea"], ["producto", "Por producto"], ["detalle", "Detalle"]];
const PRESETS = [["hoy", "Hoy"], ["ayer", "Ayer"], ["7", "7 días"], ["30", "30 días"], ["mes", "Este mes"]];
const PAGINA = 100;
const COLOR_ESTADO = { "Jamar inferior": "#e0435c", "Jamar superior": "#12a166", Igual: "#7d8799", "Sin tiempo Jamar": "#ff9540", "Sin maestro": "#ff9540" };

export default function ReporteDiferenciaTiempos({ db, ui }) {
  const hoy = hoyLocal();
  const [from, setFrom] = useState(sumarDias(hoy, -6));
  const [to, setTo] = useState(hoy);
  const [preset, setPreset] = useState("7");
  const [hist, setHist] = useState(null);
  const [maestro, setMaestro] = useState(null);
  const [jornada, setJornada] = useState(420);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("linea");
  const [depto, setDepto] = useState("");
  const [soloInferior, setSoloInferior] = useState(true);
  const [cancelados, setCancelados] = useState(false);
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);

  const aplicarPreset = (p) => {
    setPreset(p);
    const d = (n) => sumarDias(hoy, n);
    if (p === "hoy") { setFrom(hoy); setTo(hoy); } else if (p === "ayer") { setFrom(d(-1)); setTo(d(-1)); } else if (p === "7") { setFrom(d(-6)); setTo(hoy); }
    else if (p === "30") { setFrom(d(-29)); setTo(hoy); } else if (p === "mes") { setFrom(`${hoy.slice(0, 7)}-01`); setTo(hoy); }
  };

  useEffect(() => {
    D.cargarCfg().then((c) => setJornada(Number(c.jornada) || 420)).catch(() => {});
    fetchAll("assembly_products", "code,name,minutes,line,subline", "code").then((p) => setMaestro(T.maestroPorCodigo(p))).catch((e) => { setMaestro(new Map()); setError(`No se pudo leer el maestro de productos: ${e.message}`); });
  }, []);
  useEffect(() => {
    let alive = true;
    setHist(null);
    fetchHistory({ from: from || undefined, to: to && to >= hoy ? sumarDias(hoy, -1) : to || undefined })
      .then((r) => { if (alive) setHist(r); }).catch((e) => { if (alive) { setHist([]); setError(e.message); } });
    return () => { alive = false; };
  }, [from, to]);

  const registros = useMemo(() => (hist ? D.registrosDeCarga({ from, to, history: hist, services: db.services }) : null), [hist, from, to, db.services]);
  const deptos = useMemo(() => [...new Set((registros || []).map((r) => nombreDepartamento(r.depto) || "Sin departamento"))].sort((a, b) => a.localeCompare(b, "es")), [registros]);
  const filas = useMemo(() => (registros && maestro ? T.compararRegistros({ registros: registros.filter((r) => !depto || (nombreDepartamento(r.depto) || "Sin departamento") === depto), maestro, incluirCancelados: cancelados }) : null), [registros, maestro, depto, cancelados]);
  const dias = useMemo(() => new Set((filas || []).filter((x) => x.comparable && (!soloInferior || x.estado === "Jamar inferior")).map((x) => x.day)).size, [filas, soloInferior]);
  const opts = { soloInferior, jornada, dias };
  const tot = useMemo(() => (filas ? T.totalGeneral(filas, opts) : null), [filas, soloInferior, jornada, dias]);
  const porLinea = useMemo(() => (filas ? T.agrupar(filas, T.claveLinea, opts) : []), [filas, soloInferior, jornada, dias]);
  const porSub = useMemo(() => (filas ? T.agrupar(filas, T.claveSublinea, opts) : []), [filas, soloInferior, jornada, dias]);
  const porProd = useMemo(() => (filas ? T.agrupar(filas, T.claveProducto, opts) : []), [filas, soloInferior, jornada, dias]);
  const detalle = useMemo(() => {
    if (!filas) return [];
    const q = String(busca || "").toUpperCase();
    return filas.filter((x) => (soloInferior ? x.estado === "Jamar inferior" : true) && (!q || `${x.servicio} ${x.nombre} ${x.codigo} ${x.linea} ${x.sublinea}`.toUpperCase().includes(q)))
      .sort((a, b) => String(b.day).localeCompare(String(a.day)) || b.dif - a.dif || String(a.servicio).localeCompare(String(b.servicio)));
  }, [filas, soloInferior, busca]);
  useEffect(() => { setPagina(0); }, [busca, filas, tab, soloInferior]);
  const alternar = (k) => setAbiertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const cab = ["Unidades comparadas", "Unidades con Jamar inferior", "Tiempo Jamar (min)", "Tiempo Biver (min)", "Diferencia (min)", "Diferencia % de Biver", "Técnicos equivalentes por día"];
  const fila = (g) => [g.unidades, g.inferiores, Math.round(g.jamar), Math.round(g.biver), Math.round(g.dif), g.pct === null ? "" : Math.round(g.pct), dec2(g.tecnicos)];
  const csv = (nombre, cabecera, filasCsv) => ui.downloadCSV(`diferencia_tiempos_${nombre}_${from}_${to}.csv`, cabecera, filasCsv);
  const exportar = () => {
    if (tab === "linea") csv("lineas", ["Línea", "Sublínea", ...cab], porLinea.flatMap((l) => [[l.nombre, "TOTAL", ...fila(l)], ...T.agrupar(l.filas, T.claveSublinea, opts).map((s) => [l.nombre, s.nombre, ...fila(s)])]));
    else if (tab === "sublinea") csv("sublineas", ["Línea", "Sublínea", ...cab], porSub.map((s) => [s.linea, s.nombre, ...fila(s)]));
    else if (tab === "producto") csv("productos", ["Código", "Producto", "Línea", "Sublínea", "Tiempo Jamar por unidad", "Tiempo Biver por unidad", ...cab], porProd.map((p) => [p.codigo, p.nombre, p.linea, p.sublinea, dec(p.jamar / Math.max(1, soloInferior ? p.inferiores : p.unidades)), dec(p.biver / Math.max(1, soloInferior ? p.inferiores : p.unidades)), ...fila(p)]));
    else csv("detalle", ["Fecha", "Servicio", "Departamento", "Código", "Producto", "Línea", "Sublínea", "Unidades", "Tiempo Jamar (min)", "Tiempo Biver (min)", "Diferencia (min)", "Estado", "Origen"],
      detalle.map((x) => [fechaCorta(x.day), x.servicio, nombreDepartamento(x.depto) || x.depto, x.codigo, x.nombre, x.linea, x.sublinea, x.unidades, Math.round(x.jamarT), Math.round(x.biverT), Math.round(x.dif), x.estado, x.origen]));
  };

  const Tabla = ({ lista, extra = [], filaExtra = () => [], abrir = false }) => (
    <div className="amg-card" style={{ overflow: "auto" }}>
      <table className="amg-table compact" style={{ fontSize: 12.5 }}>
        <thead><tr><th>{tab === "linea" ? "Línea / sublínea" : tab === "sublinea" ? "Sublínea" : "Producto"}</th>{extra.map((e) => <th key={e}>{e}</th>)}<th title="Productos distintos">Productos</th><th title="Unidades que se pudieron comparar (Jamar y Biver con tiempo)">Unidades</th><th title="Unidades donde el tiempo de Jamar es menor que el del maestro de Biver">Jamar inferior</th>
          <th>Tiempo Jamar</th><th>Tiempo Biver</th><th title="Tiempo Biver − tiempo Jamar">Diferencia (min)</th><th>Dif. %</th><th title={`Diferencia ÷ ${jornada} min ÷ ${dias} día(s) con carga`}>Técnicos equiv./día</th></tr></thead>
        <tbody>
          {lista.map((g) => (
            <Fragment key={g.key}>
              <tr style={abrir ? { background: "var(--panel-2)", cursor: "pointer" } : undefined} onClick={abrir ? () => alternar(g.key) : undefined}>
                <td style={{ fontWeight: 700 }}>{abrir ? (abiertos.has(g.key) ? "▾ " : "▸ ") : ""}{g.nombre}</td>{filaExtra(g).map((c, i) => <td key={i} className="amg-mono">{c}</td>)}
                <td className="amg-mono">{fmtInt(g.productos)}</td><td className="amg-mono">{fmtInt(g.unidades)}</td><td className="amg-mono" style={{ color: g.inferiores ? COLOR_ESTADO["Jamar inferior"] : undefined, fontWeight: 700 }}>{fmtInt(g.inferiores)}</td>
                <td className="amg-mono">{fmtInt(g.jamar)}</td><td className="amg-mono">{fmtInt(g.biver)}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{g.dif > 0 ? "+" : ""}{fmtInt(g.dif)}</td><td className="amg-mono">{fmtPct(g.pct)}</td><td className="amg-mono">{fmt2(g.tecnicos)}</td>
              </tr>
              {abrir && abiertos.has(g.key) && T.agrupar(g.filas, T.claveSublinea, opts).map((s) => (
                <tr key={`${g.key}|${s.key}`}><td style={{ paddingLeft: 28, color: "var(--text-dim)" }}>{s.nombre}</td><td className="amg-mono">{fmtInt(s.productos)}</td><td className="amg-mono">{fmtInt(s.unidades)}</td><td className="amg-mono">{fmtInt(s.inferiores)}</td>
                  <td className="amg-mono">{fmtInt(s.jamar)}</td><td className="amg-mono">{fmtInt(s.biver)}</td><td className="amg-mono">{s.dif > 0 ? "+" : ""}{fmtInt(s.dif)}</td><td className="amg-mono">{fmtPct(s.pct)}</td><td className="amg-mono">{fmt2(s.tecnicos)}</td></tr>
              ))}
            </Fragment>
          ))}
          {lista.length === 0 && <tr><td colSpan={9 + extra.length} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{soloInferior ? "No hay productos con el tiempo de Jamar inferior al del maestro en este rango." : "No hay productos para comparar en este rango."}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  const cargando = !filas;

  return (
    <div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginRight: 6 }}>Diferencia de tiempos</div>
          {PRESETS.map(([k, t]) => <button key={k} className="amg-btn" style={preset === k ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : undefined} onClick={() => aplicarPreset(k)}>{t}</button>)}
          <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => { if (!e.target.value) return; setFrom(e.target.value); setPreset(""); if (to && e.target.value > to) setTo(e.target.value); }} />
          <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => { if (!e.target.value) return; setTo(e.target.value); setPreset(""); if (from && e.target.value < from) setFrom(e.target.value); }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <select className="amg-select" style={{ width: 190 }} value={depto} onChange={(e) => setDepto(e.target.value)}><option value="">Todos los departamentos</option>{deptos.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }} title="Activado: solo cuentan las unidades donde Jamar manda MENOS tiempo que el maestro de Biver. Desactivado: se comparan todas (la diferencia neta resta las que Jamar manda de más)."><input type="checkbox" checked={soloInferior} onChange={(e) => setSoloInferior(e.target.checked)} /> Solo Jamar inferior</label>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }} title="Por defecto no cuentan los registros cancelados"><input type="checkbox" checked={cancelados} onChange={(e) => setCancelados(e.target.checked)} /> Incluir cancelados</label>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)", marginLeft: "auto" }}>Jornada: <b>{jornada} min</b> por técnico · hoy sale de Carga, los días anteriores del histórico</span>
        </div>
        {error && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {error}</div>}
      </div>

      {cargando && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Comparando los tiempos...</div>}

      {!cargando && (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{TABS.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}</button>)}</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 12, marginBottom: 14 }}>
            <ui.StatCard label="Unidades comparadas" value={fmtInt(tot.unidades)} sub={`${fmtInt(tot.sinJamar)} sin tiempo en Jamar · ${fmtInt(tot.sinMaestro)} sin maestro`} />
            <ui.StatCard label="Con Jamar inferior" value={fmtInt(tot.inferiores)} accent sub={`${fmtPct(tot.unidades ? (tot.inferiores / tot.unidades) * 100 : null)} de las comparadas`} />
            <ui.StatCard label="Tiempo Jamar / Biver" value={`${fmtInt(tot.jamar)} / ${fmtInt(tot.biver)}`} sub={soloInferior ? "min, solo unidades con Jamar inferior" : "min, todas las comparadas"} />
            <ui.StatCard label="Diferencia" value={`${tot.dif > 0 ? "+" : ""}${fmtInt(tot.dif)}`} sub={`min de más en el maestro de Biver (${fmtPct(tot.pct)})`} />
            <ui.StatCard label="Técnicos equivalentes" value={fmt2(tot.tecnicos)} sub={`por día (${fmtInt(tot.dif)} min ÷ ${jornada} ÷ ${dias} día(s))`} />
          </div>

          {tab !== "detalle" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              {tab === "linea" && <><button className="amg-btn" onClick={() => setAbiertos(new Set(porLinea.map((l) => l.key)))}>Desplegar todo</button><button className="amg-btn" onClick={() => setAbiertos(new Set())}>Contraer todo</button>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Haz clic en una línea para ver sus sublíneas.</span></>}
              <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!(tab === "linea" ? porLinea : tab === "sublinea" ? porSub : porProd).length} onClick={exportar}>Exportar CSV</button>
            </div>
          )}

          {tab === "linea" && <Tabla lista={porLinea} abrir />}
          {tab === "sublinea" && <Tabla lista={porSub} extra={["Línea"]} filaExtra={(g) => [g.linea]} />}
          {tab === "producto" && <Tabla lista={porProd} extra={["Código", "Línea · sublínea", "Jamar / Biver por unidad"]} filaExtra={(g) => { const n = Math.max(1, soloInferior ? g.inferiores : g.unidades); return [g.codigo, `${g.linea} · ${g.sublinea}`, `${fmt1(g.jamar / n)} / ${fmt1(g.biver / n)}`]; }} />}

          {tab === "detalle" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                <input className="amg-input" style={{ width: 260 }} placeholder="Buscar servicio, producto, código, línea..." value={busca} onChange={(e) => setBusca(e.target.value)} />
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{fmtInt(detalle.length)} registro(s)</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!detalle.length} onClick={exportar}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Fecha</th><th>Servicio</th><th>Producto</th><th>Línea · sublínea</th><th>Unid.</th><th>Tiempo Jamar</th><th>Tiempo Biver</th><th>Diferencia</th><th>Estado</th></tr></thead>
                  <tbody>
                    {detalle.slice(pagina * PAGINA, pagina * PAGINA + PAGINA).map((x, i) => (
                      <tr key={`${x.id}-${x.day}-${i}`}><td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{fechaCorta(x.day)}</td><td className="amg-mono">{x.servicio}</td>
                        <td><ui.HoverText text={x.nombre} maxChars={36} /><div className="amg-mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{x.codigo}</div></td><td>{x.linea} · {x.sublinea}</td><td className="amg-mono">{x.unidades}</td>
                        <td className="amg-mono">{fmtInt(x.jamarT)}</td><td className="amg-mono">{x.biverT ? fmtInt(x.biverT) : "–"}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{x.comparable ? `${x.dif > 0 ? "+" : ""}${fmtInt(x.dif)}` : "–"}</td>
                        <td style={{ color: COLOR_ESTADO[x.estado], fontWeight: 600 }}>{x.estado}</td></tr>
                    ))}
                    {detalle.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay registros en este rango.</td></tr>}
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

          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.5 }}>
            <b>Tiempo Jamar</b>: el de la columna de tiempo del archivo de Jamar (por unidad × unidades). <b>Tiempo Biver</b>: el del maestro de Productos de armado. <b>Diferencia</b> = Biver − Jamar: positiva cuando Jamar manda menos tiempo del que Biver tiene en su maestro.
            <b> Técnicos equivalentes</b> = diferencia ÷ {jornada} min ÷ días con carga. Un producto sin tiempo en Jamar, o que no está en el maestro, no se compara (se cuenta aparte). El Tiempo Jamar de Carga y del Dimensionamiento es el mayor de los dos; aquí se muestra cada uno por separado.
            Los días anteriores salen del histórico de asignación; hoy, de Carga. Los cancelados no cuentan salvo que marques "Incluir cancelados".
          </div>
        </>
      )}
    </div>
  );
}
