import { useState, useEffect, useMemo } from "react";
import { Download, Mail, AlertTriangle, Check, Plus, RotateCcw, Ban } from "lucide-react";
import { fetchHistory, loadRegionInfo } from "./lib/asignacion/history";
import { filasCsvDeHistorico } from "./lib/asignacion/csvCarga";
import { useZonaCoord } from "./lib/useCoordinadores";
import { mailLinks, downloadBlob } from "./lib/asignacion/outputs";
import { gestionDeCausal } from "./lib/asignacion/cierreColumnas";
import { calcularInforme, agruparDetalle, empresaDeFilaCsv, nombreDepartamento, buildInformeJamarPdf, loadInformeEmailConfig, saveInformeEmailConfig, INFORME_EMAIL_DEFAULT, fechaCorta, fmtPct } from "./lib/informeJamar";

/* ============================================================================
   INFORME DE CIERRE (Reportes)
   Se arma con el histórico de asignación del día o del rango de fechas (la fila de cada producto del CSV de Carga) y de la empresa que se elija (o todas): resultado general,
   volumen por departamento, causas de lo no armado, tipo de servicio, cancelaciones, devueltos, pendientes y cierre operativo, más el detalle de devueltos, pendientes,
   garantías y primer piso (por departamento, técnico, fecha y motivo). Se descarga en PDF o se envía por correo (destinatarios y texto en Maestros → Informe de cierre).
============================================================================ */

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const COLOR = { armado: "#00b050", noArmado: "#ed7d31", cancelado: "#9b2c90", devuelto: "#0070c0", garantia: "#f5b800", primerPiso: "#6b7a90" };
const TABS = [["resumen", "Resumen del informe"], ["devueltos", "Devueltos"], ["pendientes", "Pendientes"], ["garantias", "Garantías"], ["primerpiso", "Primer piso"]];

// Detalle producto por producto (devueltos, pendientes, garantías, primer piso): resumen por departamento, técnico, fecha y motivo + listado + CSV.
function DetalleLista({ titulo, items, totalProductos, color, ui, csvNombre, nota, vacio }) {
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(0);
  const PAGINA = 100;
  useEffect(() => { setPagina(0); }, [q, items]);
  const filtrados = useMemo(() => { const b = plano(q); return !b ? items : items.filter((x) => plano(`${x.servicio} ${x.tecnico} ${x.cliente} ${x.depto} ${x.ciudad} ${x.producto} ${x.causal}`).includes(b)); }, [items, q]);
  const g = useMemo(() => agruparDetalle(filtrados), [filtrados]);
  const multiDia = new Set(items.map((x) => x.fecha)).size > 1;
  const orden = useMemo(() => [...filtrados].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || a.depto.localeCompare(b.depto, "es") || a.tecnico.localeCompare(b.tecnico, "es") || String(a.servicio).localeCompare(String(b.servicio))), [filtrados]);
  const exportar = () => ui.downloadCSV(csvNombre, ["Fecha", "Empresa", "Servicio", "Cliente", "Departamento", "Ciudad", "Técnico", "Coordinador", "Producto", "Tipo de servicio", "Causal / motivo", "Origen", "Diagnóstico"],
    orden.map((x) => [x.fecha ? fechaCorta(x.fecha) : "", x.empresa, x.servicio, x.cliente, x.depto, x.ciudad, x.tecnico, x.coordinador, x.producto, x.tipo, x.causal, x.fuente || "", x.diagnostico]));
  const Resumen = ({ tit, lista, formato }) => (
    <div className="amg-card" style={{ padding: 10, overflowX: "auto", maxHeight: 280, overflowY: "auto" }}>
      <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 4 }}>{tit}</div>
      <table className="amg-table compact" style={{ fontSize: 12 }}>
        <tbody>{lista.map((x) => <tr key={x.nombre}><td>{formato ? formato(x.nombre) : x.nombre}</td><td className="amg-mono" style={{ textAlign: "right", fontWeight: 600 }}>{x.n}</td></tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <div className="amg-card" style={{ padding: "8px 16px", borderTop: `3px solid ${color}` }}>
          <div style={{ fontSize: 24, fontWeight: 700, color }}>{items.length}</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{titulo}</div>
          {totalProductos > 0 && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{fmtPct((items.length / totalProductos) * 100)} de {totalProductos} productos</div>}
        </div>
        <input className="amg-input" style={{ width: 260 }} placeholder="Buscar servicio, técnico, cliente, producto..." value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{filtrados.length === items.length ? `${items.length} registro(s)` : `${filtrados.length} de ${items.length}`}</span>
        <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!filtrados.length} onClick={exportar}><Download size={14} /> Exportar CSV</button>
      </div>
      {items.length === 0 ? <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>{vacio}</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 12 }}>
            <Resumen tit="Por departamento" lista={g.porDepto} />
            <Resumen tit="Por técnico" lista={g.porTecnico} />
            {multiDia && <Resumen tit="Por fecha" lista={g.porFecha} formato={(f) => (f && f !== "Sin dato" ? fechaCorta(f) : f)} />}
            <Resumen tit="Por motivo (causal)" lista={g.porMotivo} />
          </div>
          <div className="amg-card" style={{ overflowX: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Fecha</th><th>Servicio</th><th>Cliente</th><th>Departamento</th><th>Técnico</th><th>Producto</th><th>Causal / motivo</th></tr></thead>
              <tbody>
                {orden.slice(pagina * PAGINA, pagina * PAGINA + PAGINA).map((x, i) => (
                  <tr key={`${x.servicio}-${x.fecha}-${i}`}>
                    <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{x.fecha ? fechaCorta(x.fecha) : "–"}</td>
                    <td className="amg-mono">{x.servicio}{x.empresa && x.empresa !== "JAMAR" ? <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{x.empresa}</div> : null}</td>
                    <td>{x.cliente || "–"}</td><td>{x.depto}{x.ciudad ? <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{x.ciudad}</div> : null}</td>
                    <td>{x.tecnico}</td><td><ui.HoverText text={x.producto} maxChars={44} /></td>
                    <td>{x.causal || "–"}{x.fuente ? <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{x.fuente}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {orden.length > PAGINA && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12.5 }}>
              <button className="amg-btn" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
              <span>{pagina * PAGINA + 1}–{Math.min(orden.length, pagina * PAGINA + PAGINA)} de {orden.length}</span>
              <button className="amg-btn" disabled={(pagina + 1) * PAGINA >= orden.length} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
            </div>
          )}
        </>
      )}
      {nota && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>{nota}</div>}
    </div>
  );
}

export function ReporteInformeJamar({ db, session, ui }) {
  const hoy = ui.todayISO();
  const [desde, setDesde] = useState(sumarDias(hoy, -1));
  const [hasta, setHasta] = useState(sumarDias(hoy, -1));
  const [empresa, setEmpresa] = useState(""); // "" = todas las empresas
  const [tab, setTab] = useState("resumen");
  const [rows, setRows] = useState([]);
  const [cfg, setCfg] = useState(INFORME_EMAIL_DEFAULT);
  const [regionInfo, setRegionInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const zona = useZonaCoord(db);
  const canEnviar = session.role === "admin" || session.role === "operador";
  const unDia = desde === hasta;
  const rangoTxt = unDia ? fechaCorta(desde) : `${fechaCorta(desde)} al ${fechaCorta(hasta)}`;
  const empresaTxt = empresa || "todas las empresas";

  useEffect(() => { loadRegionInfo().then(setRegionInfo).catch(() => {}); loadInformeEmailConfig().then(setCfg).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    fetchHistory({ from: desde, to: hasta }).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) { setRows([]); setError(e.message); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [desde, hasta]);
  const cambiarDesde = (v) => { if (!v) return; setDesde(v); if (v > hasta) setHasta(v); };
  const cambiarHasta = (v) => { if (!v) return; setHasta(v); if (v < desde) setDesde(v); };

  const filas = useMemo(() => filasCsvDeHistorico({ rows, services: db.services, technicians: db.technicians, causales: db.causales, regionLabel: (r) => (regionInfo ? regionInfo.label(r) : ""), coordDe: (d) => zona.coordDe(d), empresaDe: regionInfo ? regionInfo.empresaDe : undefined }),
    [rows, db.services, db.technicians, db.causales, regionInfo, zona.nombres]);
  const empresas = useMemo(() => [...new Set([...filas.map(empresaDeFilaCsv), ...(empresa ? [plano(empresa)] : [])])].sort(), [filas, empresa]);
  const gestionDe = useMemo(() => gestionDeCausal(db.causales), [db.causales]); // cancelados, devueltos y pendientes: las causales marcadas así en Maestros → Causales (Gestión)
  const info = useMemo(() => calcularInforme(filas, { empresa, gestionDe }), [filas, empresa, gestionDe]);

  // Pendientes: productos del rango que siguen en Carga sin causal (sin gestionar) y los que se cerraron con una causal de gestión Pendiente.
  const pendientes = useMemo(() => {
    const techById = Object.fromEntries((db.technicians || []).map((t) => [t.id, t]));
    const enCarga = (db.services || []).filter((s) => s.servicioExterno && s.date >= desde && s.date <= hasta && !s.finalizedAt && (s.estadoGestion || "Realizado") !== "Pendiente" && !s.causalAuditada && !s.causalExtreme && !(s.asig && (s.asig.cancelada || s.asig.anulada))
      && (!empresa || plano((s.asig && s.asig.empresa) || "JAMAR") === plano(empresa)))
      .map((s) => ({ fecha: s.date, empresa: plano((s.asig && s.asig.empresa) || "JAMAR"), servicio: String(s.servicioExterno), cliente: s.clienteNombre || "", depto: nombreDepartamento(s.departamentoExterno), ciudad: s.ciudadExterna || "", producto: s.productoExternoNombre || "-",
        tecnico: (techById[s.technicianId] && techById[s.technicianId].name) || s.tecnico2Nombre || "Sin técnico", coordinador: "", tipo: s.serviceType || "", causal: "Sin causal", diagnostico: "", fuente: "En Carga sin causal" }));
    return [...enCarga, ...info.pendientesCerrados].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }, [db.services, db.technicians, desde, hasta, empresa, info]);

  // Texto del correo con los datos del informe.
  const sub = (t) => String(t || "").replace(/\{fecha\}/g, rangoTxt).replace(/\{empresa\}/g, empresaTxt).replace(/–\s*Jamar\b/gi, `– ${empresaTxt}`).replace(/\{total\}/g, info.total).replace(/\{armados\}/g, info.armados).replace(/\{noArmados\}/g, info.noArmados)
    .replace(/\{cancelados\}/g, info.cancelados).replace(/\{devueltos\}/g, info.devueltos).replace(/\{efectividad\}/g, (Math.round(info.pctArmados * 10) / 10).toFixed(1));
  useEffect(() => { setAsunto(sub(cfg.asunto)); setMensaje(sub(cfg.mensaje)); }, [cfg, desde, hasta, empresa, info.total, info.armados, info.noArmados, info.cancelados]);

  const activos = (cfg.destinatarios || []).filter((d) => d.activo !== false && d.correo);
  const para = activos.filter((d) => d.tipo !== "CC").map((d) => d.correo), cc = activos.filter((d) => d.tipo === "CC").map((d) => d.correo);
  const vacio = info.total === 0;

  const nombreArchivo = () => {
    const f = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };
    return `Informe_Cierre${empresa ? `_${empresa.replace(/[^A-Za-z0-9]+/g, "_")}` : ""}_${unDia ? f(desde) : `${f(desde)}_al_${f(hasta)}`}.pdf`;
  };
  const pdf = async () => {
    const blob = await buildInformeJamarPdf({ info, desde, hasta, empresa, pendientes });
    downloadBlob(blob, nombreArchivo());
    return nombreArchivo();
  };
  const descargar = async () => { setBusy(true); setError(""); setMsg(""); try { const n = await pdf(); setMsg(`Se descargó ${n}.`); } catch (e) { setError(`No se pudo generar el PDF: ${e.message}`); } setBusy(false); };
  const enviar = async (via) => {
    setBusy(true); setError(""); setMsg("");
    try {
      const n = await pdf();
      const links = mailLinks({ para, cc, subject: asunto, body: mensaje });
      if (via === "gmail") window.open(links.gmail, "_blank", "noopener"); else window.location.href = links.mailto;
      setMsg(`Se descargó ${n}. Se abrió el correo con destinatarios, asunto y mensaje: adjunta ese archivo antes de enviar.`);
    } catch (e) { setError(`No se pudo generar el PDF: ${e.message}`); }
    setBusy(false);
  };
  const copiar = async () => { try { await navigator.clipboard.writeText([...para, ...cc].join(", ")); setMsg("Destinatarios copiados."); } catch (e) { setError("No se pudo copiar."); } };

  const Tarjeta = ({ valor, titulo, sub: subt, color }) => (
    <div style={{ textAlign: "center", padding: "10px 6px", borderRight: "1px solid var(--border)" }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{valor}</div><div style={{ fontSize: 12, fontWeight: 600 }}>{titulo}</div><div style={{ fontSize: 11, color: "var(--text-faint)" }}>{subt}</div>
    </div>
  );
  const contador = { devueltos: info.devueltosDet.length, pendientes: pendientes.length, garantias: info.garantiasDet.length, primerpiso: info.primerPisoDet.length };

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 600 }}>Informe de cierre{empresa ? ` – ${empresa}` : ""}</div>
        <label className="amg-label" style={{ margin: 0 }}>Desde</label>
        <input type="date" className="amg-input" style={{ width: 150 }} value={desde} onChange={(e) => cambiarDesde(e.target.value)} />
        <label className="amg-label" style={{ margin: 0 }}>Hasta</label>
        <input type="date" className="amg-input" style={{ width: 150 }} value={hasta} onChange={(e) => cambiarHasta(e.target.value)} />
        <button className="amg-btn" onClick={() => { const y = sumarDias(hoy, -1); setDesde(y); setHasta(y); }}>Ayer</button>
        <button className="amg-btn" onClick={() => { setDesde(hoy); setHasta(hoy); }}>Hoy</button>
        <button className="amg-btn" onClick={() => { setDesde(`${hoy.slice(0, 7)}-01`); setHasta(hoy); }}>Este mes</button>
        <select className="amg-select" style={{ width: 190 }} value={empresa} onChange={(e) => setEmpresa(e.target.value)} title="El informe se arma solo con los productos de la empresa elegida">
          <option value="">Todas las empresas</option>{empresas.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={busy || vacio} onClick={descargar}><Download size={14} /> {busy ? "Generando..." : "Descargar PDF"}</button>
        {canEnviar && <button className="amg-btn primary" disabled={busy || vacio || !activos.length} title={activos.length ? "Descarga el PDF y abre el correo con los destinatarios de Maestros → Informe de cierre" : "Agrega destinatarios en Maestros → Informe de cierre"} onClick={() => enviar("gmail")}><Mail size={14} /> Enviar por correo</button>}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}{contador[k] !== undefined && !vacio ? ` (${contador[k]})` : ""}</button>)}
      </div>
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      {loading && <div style={{ color: "var(--text-faint)", marginBottom: 10 }}>Leyendo el histórico...</div>}
      {!loading && vacio && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>No hay productos finalizados {unDia ? `el ${ui.fmtDate(desde)}` : `del ${ui.fmtDate(desde)} al ${ui.fmtDate(hasta)}`}{empresa ? ` de ${empresa}` : ""}. El informe sale del histórico: finaliza ese día en Carga.</div>}

      {!vacio && tab === "devueltos" && <DetalleLista titulo="Devueltos" items={info.devueltosDet} totalProductos={info.total} color={COLOR.devuelto} ui={ui} csvNombre={`devueltos_${desde}${unDia ? "" : `_${hasta}`}.csv`} vacio="No hay productos devueltos en el período." nota="Devuelto = el producto se cerró con una causal marcada como Devuelto en Maestros → Causales (por ejemplo ALMACEN, SOBRECARGA, EMPAQUE COLCHONES). El técnico de esas filas es el motivo de la devolución." />}
      {!vacio && tab === "pendientes" && <DetalleLista titulo="Pendientes" items={pendientes} totalProductos={info.total} color={COLOR.noArmado} ui={ui} csvNombre={`pendientes_${desde}${unDia ? "" : `_${hasta}`}.csv`} vacio="No hay productos pendientes: la operación quedó al día." nota="Pendiente = sigue en Carga sin causal (sin gestionar) o se cerró con una causal marcada como Pendiente en Maestros → Causales. La columna de motivo muestra de cuál de los dos casos viene." />}
      {!vacio && tab === "garantias" && <DetalleLista titulo="Garantías" items={info.garantiasDet} totalProductos={info.total} color={COLOR.garantia} ui={ui} csvNombre={`garantias_${desde}${unDia ? "" : `_${hasta}`}.csv`} vacio="No hay productos con garantía en el período." nota="Garantía = el producto quedó con GARANTIA = SI en las columnas de cierre." />}
      {!vacio && tab === "primerpiso" && <DetalleLista titulo="Primer piso" items={info.primerPisoDet} totalProductos={info.total} color={COLOR.primerPiso} ui={ui} csvNombre={`primer_piso_${desde}${unDia ? "" : `_${hasta}`}.csv`} vacio="No hay productos con Primer piso en el período." nota="Primer piso = PRIMER PISO = SI o un diagnóstico que indica que el producto se dejó en primer piso." />}

      {!vacio && tab === "resumen" && (
        <>
          <div className="amg-card" style={{ borderTop: "3px solid var(--accent)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", marginBottom: 12 }}>
            <Tarjeta valor={info.total} titulo="Total registros" sub="productos" color="var(--text)" />
            <Tarjeta valor={info.armados} titulo="Armados" sub={fmtPct(info.pctArmados)} color={COLOR.armado} />
            <Tarjeta valor={info.noArmados} titulo="No armados" sub={fmtPct(info.pctNoArmados)} color={COLOR.noArmado} />
            <Tarjeta valor={info.cancelados} titulo="Cancelados" sub={fmtPct(info.pctCancelados)} color={COLOR.cancelado} />
            <Tarjeta valor={info.devueltos} titulo="Devueltos" sub={fmtPct(info.pctDevueltos)} color={COLOR.devuelto} />
            <Tarjeta valor={pendientes.length} titulo="Pendientes" sub={pendientes.length ? "por gestionar" : "operación al día"} color={pendientes.length ? COLOR.noArmado : COLOR.armado} />
            <Tarjeta valor={info.garantias} titulo="Garantías" sub="con novedad" color={COLOR.garantia} />
          </div>
          <div style={{ display: "flex", height: 28, borderRadius: 4, overflow: "hidden", marginBottom: 14, color: "#fff", fontSize: 12.5, fontWeight: 600 }}>
            {[[info.armados, COLOR.armado, `Armado ${info.armados} · ${fmtPct(info.pctArmados)}`], [info.noArmados, COLOR.noArmado, `No armado ${info.noArmados} · ${fmtPct(info.pctNoArmados)}`], [info.cancelados, COLOR.cancelado, String(info.cancelados)], [info.devueltos, COLOR.devuelto, String(info.devueltos)]]
              .map(([n, c, t], i) => n ? <div key={i} style={{ width: `${(n / info.total) * 100}%`, background: c, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap" }}>{t}</div> : null)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 14 }}>
            <div className="amg-card" style={{ padding: 12, overflowX: "auto" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>2. Volumen por departamento</div>
              <table className="amg-table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Departamento</th><th>Total</th><th>Particip.</th><th>Armado</th><th>No armado</th><th>Cancelado</th><th>Devuelto</th><th>% Armado</th></tr></thead>
                <tbody>
                  {info.listaDeptos.map((d) => <tr key={d.nombre}><td>{d.nombre}</td><td className="amg-mono">{d.total}</td><td className="amg-mono">{fmtPct(d.particip)}</td><td className="amg-mono">{d.armado}</td><td className="amg-mono">{d.noArmado}</td><td className="amg-mono">{d.cancelado}</td><td className="amg-mono">{d.devuelto}</td><td className="amg-mono">{fmtPct(d.pctArmado)}</td></tr>)}
                  <tr style={{ fontWeight: 700, background: "var(--panel-2)" }}><td>Total</td><td className="amg-mono">{info.total}</td><td className="amg-mono">100%</td><td className="amg-mono">{info.armados}</td><td className="amg-mono">{info.noArmados}</td><td className="amg-mono">{info.cancelados}</td><td className="amg-mono">{info.devueltos}</td><td className="amg-mono">{fmtPct(info.pctArmados)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="amg-card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>3. Causas de productos no armados ({info.noArmados})</div>
              {info.listaCausas.map((c) => (
                <div key={c.nombre} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 3 }}>
                  <div style={{ width: 210, textAlign: "right" }}>{c.nombre}</div>
                  <div style={{ background: COLOR.noArmado, height: 12, width: `${Math.max(2, (c.n / info.listaCausas[0].n) * 55)}%` }} />
                  <b>{c.n} · {fmtPct(c.particip)}</b>
                </div>
              ))}
              {info.listaCausas.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 12.5 }}>No hay productos no armados.</div>}
              {info.sinCausal.length > 0 && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Sin causal registrada ({info.sinCausal.length}): servicios {[...new Set(info.sinCausal)].join(", ")}.</div>}
            </div>
            <div className="amg-card" style={{ padding: 12, overflowX: "auto" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>4. Desglose por tipo de servicio (observación)</div>
              <table className="amg-table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>Tipo</th><th>Total</th><th>Particip.</th><th>Armado</th><th>No armado</th><th>Cancelado</th><th>Devuelto</th></tr></thead>
                <tbody>{info.listaTipos.map((t) => <tr key={t.nombre}><td>{t.nombre}</td><td className="amg-mono">{t.total}</td><td className="amg-mono">{fmtPct(t.particip)}</td><td className="amg-mono">{t.armado}</td><td className="amg-mono">{t.noArmado}</td><td className="amg-mono">{t.cancelado}</td><td className="amg-mono">{t.devuelto}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="amg-card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>5. Cancelaciones por causal ({info.cancelados})</div>
              {info.listaCancelaciones.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 3 }}>
                  <div style={{ width: 250, textAlign: "right" }}>{c.causal || "Sin causal"}</div>
                  <div style={{ background: COLOR.cancelado, height: 12, width: `${Math.max(2, (c.n / info.listaCancelaciones[0].n) * 45)}%` }} /><b>{c.n} · {fmtPct(c.particip)}</b>
                </div>
              ))}
              {info.listaCancelaciones.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 12.5 }}>No hay productos cancelados. Son los de las causales marcadas como Cancelado en Maestros → Causales.</div>}
            </div>
            <div className="amg-card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>6. Devueltos por causal ({info.devueltos}) <button className="amg-btn ghost" style={{ padding: "0 6px", fontSize: 11.5 }} onClick={() => setTab("devueltos")}>Ver detalle →</button></div>
              {info.listaDevoluciones.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 3 }}>
                  <div style={{ width: 250, textAlign: "right" }}>{c.causal || "Sin causal"}</div>
                  <div style={{ background: COLOR.devuelto, height: 12, width: `${Math.max(2, (c.n / info.listaDevoluciones[0].n) * 45)}%` }} /><b>{c.n} · {fmtPct(c.particip)}</b>
                </div>
              ))}
              {info.listaDevoluciones.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 12.5 }}>No hay productos devueltos. Son los de las causales marcadas como Devuelto en Maestros → Causales.</div>}
            </div>
          </div>
          <div className="amg-card" style={{ padding: 12, marginTop: 14, fontSize: 12.5, lineHeight: 1.6 }}>
            <div><b>7. Productos pendientes ({pendientes.length}):</b> {pendientes.length ? [...new Set(pendientes.map((p) => p.servicio))].join(", ") : "sin productos pendientes: la operación quedó al día."} {pendientes.length > 0 && <button className="amg-btn ghost" style={{ padding: "0 6px", fontSize: 11.5 }} onClick={() => setTab("pendientes")}>Ver detalle →</button>}</div>
            <div><b>8. Primer piso:</b> {info.primerPiso.length ? `${info.primerPiso.length} registro(s): servicios ${[...new Set(info.primerPiso)].join(", ")}.` : "no se identifican registros con Primer piso = SI ni diagnósticos que indiquen primer piso."} {info.primerPiso.length > 0 && <button className="amg-btn ghost" style={{ padding: "0 6px", fontSize: 11.5 }} onClick={() => setTab("primerpiso")}>Ver detalle →</button>}</div>
            <div><b>Cierre:</b> la operación {unDia ? `del ${fechaCorta(desde).slice(0, 5)}` : `del ${fechaCorta(desde).slice(0, 5)} al ${fechaCorta(hasta).slice(0, 5)}`}{empresa ? ` de ${empresa}` : ""} cerró con <b>{fmtPct(info.pctArmados)}</b> de efectividad de armado sobre {info.total} productos.</div>
          </div>

          {canEnviar && (
            <div className="amg-card" style={{ padding: 12, marginTop: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Correo <span style={{ fontWeight: 400, color: "var(--text-faint)", fontSize: 12 }}>(destinatarios y texto en Maestros → Informe de cierre)</span></div>
              {activos.length === 0
                ? <div style={{ color: "var(--red)", fontSize: 12.5, marginBottom: 8 }}>No hay destinatarios activos. El administrador debe agregarlos en Maestros → Informe de cierre. Aun así puedes descargar el PDF.</div>
                : <div style={{ fontSize: 12.5, marginBottom: 8 }}><div><b>Para:</b> {para.length ? para.join(", ") : "—"}</div>{cc.length > 0 && <div><b>CC:</b> {cc.join(", ")}</div>}</div>}
              <label className="amg-label">Asunto</label>
              <input className="amg-input" value={asunto} onChange={(e) => setAsunto(e.target.value)} style={{ marginBottom: 8 }} />
              <label className="amg-label">Mensaje</label>
              <textarea className="amg-textarea" rows={5} value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Los enlaces de correo no pueden llevar archivos adjuntos: el PDF se descarga y lo adjuntas tú antes de enviar.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button className="amg-btn primary" disabled={busy || !activos.length} onClick={() => enviar("gmail")}>Descargar y abrir Gmail</button>
                <button className="amg-btn" disabled={busy || !activos.length} onClick={() => enviar("mailto")}>Descargar y abrir mi programa de correo</button>
                <button className="amg-btn" disabled={!activos.length} onClick={copiar}>Copiar destinatarios</button>
              </div>
            </div>
          )}
        </>
      )}
      {!vacio && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>La empresa de cada producto sale de la columna EMPRESA del CSV con que se cargó el servicio; si no la trae, se cuenta como JAMAR.</div>}
    </div>
  );
}

/* --------------------------- Maestros → Informe de cierre --------------------------- */

export function MaestroInformeJamar({ db, persist, addAudit, session, ui }) {
  const [cfg, setCfg] = useState(null);
  const [nuevo, setNuevo] = useState({ nombre: "", correo: "", tipo: "Para" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { loadInformeEmailConfig().then(setCfg).catch((e) => { setError(e.message); setCfg(INFORME_EMAIL_DEFAULT); }); }, []);
  if (!cfg) return <div style={{ color: "var(--text-faint)" }}>Cargando...</div>;

  const valido = (c) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(c || "").trim());
  const change = (next) => { setCfg(next); setDirty(true); setMsg(""); };
  const setDest = (id, patch) => change({ ...cfg, destinatarios: cfg.destinatarios.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const agregar = () => {
    const correo = nuevo.correo.trim().toLowerCase();
    if (!valido(correo)) { setError("Escribe un correo válido."); return; }
    if (cfg.destinatarios.some((d) => d.correo.toLowerCase() === correo)) { setError("Ese correo ya está en la lista."); return; }
    setError("");
    change({ ...cfg, destinatarios: [...cfg.destinatarios, { id: ui.uid("dst"), nombre: nuevo.nombre.trim(), correo, tipo: nuevo.tipo, activo: true }] });
    setNuevo({ nombre: "", correo: "", tipo: nuevo.tipo });
  };
  const guardar = async () => {
    const malos = cfg.destinatarios.filter((d) => !valido(d.correo));
    if (malos.length) { setError(`Hay correos inválidos: ${malos.map((d) => d.correo || "(vacío)").join(", ")}`); return; }
    setError("");
    try {
      await saveInformeEmailConfig(cfg, session.id);
      persist(addAudit(db, { userId: session.id, action: "Cambio de destinatarios (Informe de cierre)", record: "informe_jamar_email", oldValue: "-", newValue: `${cfg.destinatarios.filter((d) => d.activo !== false).length} destinatarios activos` }));
      setDirty(false); setMsg("Guardado para todo el equipo.");
    } catch (e) { setError(e.message); }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.6 }}>
        Personas a las que se envía el <b>Informe de cierre</b> (Reportes → Informe de cierre). El botón "Enviar por correo" descarga el PDF y abre el correo ya redactado con estos destinatarios; solo adjuntas el archivo.
      </div>
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      <div className="amg-card" style={{ overflowX: "auto", marginBottom: 12 }}>
        <table className="amg-table">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Envío</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {cfg.destinatarios.map((d) => (
              <tr key={d.id} style={d.activo === false ? { opacity: 0.55 } : undefined}>
                <td><input className="amg-input" style={{ padding: "4px 6px" }} value={d.nombre} onChange={(e) => setDest(d.id, { nombre: e.target.value })} /></td>
                <td><input className="amg-input" style={{ padding: "4px 6px", borderColor: valido(d.correo) ? undefined : "var(--red)" }} value={d.correo} onChange={(e) => setDest(d.id, { correo: e.target.value })} /></td>
                <td><select className="amg-select" style={{ width: 90 }} value={d.tipo || "Para"} onChange={(e) => setDest(d.id, { tipo: e.target.value })}><option>Para</option><option>CC</option></select></td>
                <td><ui.Badge text={d.activo === false ? "Inactivo" : "Activo"} color={d.activo === false ? "gray" : "green"} /></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="amg-btn ghost" style={{ padding: 4 }} title={d.activo === false ? "Reactivar" : "Inactivar (deja de recibir el correo)"} onClick={() => setDest(d.id, { activo: d.activo === false })}>{d.activo === false ? <RotateCcw size={13} color="var(--green)" /> : <Ban size={13} color="var(--red)" />}</button>
                  <button className="amg-btn ghost" style={{ padding: 4, fontSize: 11 }} title="Quitar de la lista" onClick={() => change({ ...cfg, destinatarios: cfg.destinatarios.filter((x) => x.id !== d.id) })}>Quitar</button>
                </td>
              </tr>
            ))}
            {cfg.destinatarios.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-faint)", padding: 16 }}>Aún no hay destinatarios. Agrega el primero abajo.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="amg-input" style={{ width: 200 }} placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        <input className="amg-input" style={{ width: 260 }} placeholder="correo@empresa.com" value={nuevo.correo} onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })} onKeyDown={(e) => e.key === "Enter" && agregar()} />
        <select className="amg-select" style={{ width: 90 }} value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}><option>Para</option><option>CC</option></select>
        <button className="amg-btn" onClick={agregar}><Plus size={14} /> Agregar</button>
      </div>
      <div className="amg-card" style={{ padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Texto del correo</div>
        <label className="amg-label">Asunto</label>
        <input className="amg-input" value={cfg.asunto} onChange={(e) => change({ ...cfg, asunto: e.target.value })} style={{ marginBottom: 10 }} />
        <label className="amg-label">Mensaje</label>
        <textarea className="amg-textarea" rows={6} value={cfg.mensaje} onChange={(e) => change({ ...cfg, mensaje: e.target.value })} />
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Se reemplazan solos: <code>{"{fecha}"}</code> (corte operativo), <code>{"{total}"}</code>, <code>{"{armados}"}</code>, <code>{"{noArmados}"}</code>, <code>{"{cancelados}"}</code>, <code>{"{devueltos}"}</code> y <code>{"{efectividad}"}</code> (% de armado).</div>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <button className="amg-btn primary" disabled={!dirty} onClick={guardar}><Check size={14} /> Guardar</button>
        {dirty && <span style={{ fontSize: 12, color: "var(--accent)" }}>Hay cambios sin guardar.</span>}
      </div>
    </div>
  );
}
