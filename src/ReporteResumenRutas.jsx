import { useState, useEffect, useMemo } from "react";
import { Download, ChevronDown, ChevronRight } from "lucide-react";
import { fetchHistory, loadRegionInfo } from "./lib/asignacion/history";
import { filasCsvDeHistorico, filasCsvCarga } from "./lib/asignacion/csvCarga";
import { downloadBlob } from "./lib/asignacion/outputs";
import { useZonaCoord } from "./lib/useCoordinadores";
import * as R from "./lib/resumenRutas";

/* ============================================================================
   RESUMEN DE RUTAS DEL DÍA (Reportes)
   Por región: el resumen por técnico (servicios armados, no armados, parciales, cancelados y hallazgos de auditoría) y el detalle de los productos de cada técnico.
   Por defecto muestra el día anterior. Sale del histórico del día (lo finalizado) y de lo que todavía está en Carga. Se descarga en PDF por región, con los filtros puestos.
============================================================================ */

const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ESTADOS = { armado: "Armado", noArmado: "No armado", parcial: "Parcial", cancelado: "Cancelado" };
const COLOR_ESTADO = { armado: "var(--green)", noArmado: "var(--red)", parcial: "#d9a400", cancelado: "var(--text-faint)" };
const bonito = (s) => String(s || "").charAt(0) + String(s || "").slice(1).toLowerCase();

export default function ReporteResumenRutas({ db, ui }) {
  const hoy = ui.todayISO();
  const [from, setFrom] = useState(sumarDias(hoy, -1));
  const [to, setTo] = useState(sumarDias(hoy, -1));
  const [f, setF] = useState({ region: "", depto: "", coord: "", empresa: "", tec: "", res: "" });
  const [rows, setRows] = useState([]);
  const [regionInfo, setRegionInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [abiertos, setAbiertos] = useState(() => new Set());
  const zona = useZonaCoord(db);

  useEffect(() => { loadRegionInfo().then(setRegionInfo).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    fetchHistory({ from, to }).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) { setRows([]); setError(e.message); } }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to]);

  // Productos del periodo: los del histórico (días finalizados) y los que siguen en Carga (día sin finalizar), con las columnas del CSV de Carga.
  const items = useMemo(() => {
    if (!regionInfo) return [];
    const coordDe = (d) => zona.coordDe(d);
    const filasH = filasCsvDeHistorico({ rows, services: db.services, technicians: db.technicians, causales: db.causales, regionLabel: (r) => regionInfo.label(r), coordDe });
    const hist = rows.map((r, i) => ({ fila: filasH[i], region: r.region, orden: r.ruta_orden, fuente: "histórico" }));
    const regs = (db.services || []).filter((s) => s.servicioExterno && !s.finalizedAt && (s.estadoGestion || "Realizado") !== "Pendiente" && !(s.asig && s.asig.anulada) && s.date >= from && s.date <= to);
    const filasC = filasCsvCarga({ registros: regs, technicians: db.technicians, causales: db.causales, regionLabelDe: (s) => regionInfo.label(regionInfo.regionOfService(s)), coordDe });
    const carga = regs.map((s, i) => ({ fila: filasC[i], region: regionInfo.regionOfService(s), orden: s.rutaOrden, fuente: "Carga" }));
    return R.itemsDeFilas([...hist, ...carga]);
  }, [rows, regionInfo, db.services, db.technicians, db.causales, zona.nombres, from, to]);

  const opciones = useMemo(() => {
    const u = (fn) => [...new Set(items.map(fn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));
    return { region: u((i) => i.region).sort((a, b) => a - b), depto: u((i) => i.depto), coord: u((i) => i.coord), empresa: u((i) => i.empresa), tec: u((i) => i.tecnico) };
  }, [items]);

  // Filtros: los de producto y, al final, el resultado del servicio (armado / no armado / parcial / cancelado).
  const filtrados = useMemo(() => {
    const base = items.filter((i) => (!f.region || String(i.region) === f.region) && (!f.depto || i.depto === f.depto) && (!f.coord || i.coord === f.coord) && (!f.empresa || i.empresa === f.empresa) && (!f.tec || i.tecnico === f.tec));
    if (!f.res) return base;
    return R.resumirPorTecnico(base).flatMap((r) => r.items.filter((i) => i.estadoServicio === f.res));
  }, [items, f]);

  // Un bloque por región, con lo que va al PDF (título, nombre y etiqueta del técnico).
  const regiones = useMemo(() => {
    const m = new Map();
    filtrados.forEach((i) => { const k = i.region ?? "sin"; if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
    return [...m.entries()].sort((a, b) => (a[0] === "sin" ? 1 : b[0] === "sin" ? -1 : a[0] - b[0])).map(([k, its]) => {
      const deptos = [...new Set(its.map((i) => R.plano(i.depto)).filter(Boolean))];
      const nombreRegion = k === "sin" ? "SIN REGIÓN" : (regionInfo && regionInfo.nameOf[k] ? R.plano(regionInfo.nameOf[k]) : `REGIÓN ${k}`);
      const nombre = deptos.length === 1 ? deptos[0] : nombreRegion;
      const resumen = R.resumirPorTecnico(its);
      return { key: String(k), region: k, label: k === "sin" ? "Sin región" : regionInfo.label(k), nombre, titulo: deptos.length === 1 ? `DEPARTAMENTO: ${deptos[0]}` : `REGIÓN ${k}: ${nombreRegion}`, etiquetaTec: nombre, items: its, resumen, tot: R.totales(resumen), servicios: new Set(its.map((i) => i.servicio)).size };
    });
  }, [filtrados, regionInfo]);

  const total = useMemo(() => ({ productos: filtrados.length, servicios: new Set(filtrados.map((i) => i.servicio)).size, tecnicos: new Set(filtrados.map((i) => i.tecnico)).size, enCarga: filtrados.filter((i) => i.fuente === "Carga").length }), [filtrados]);
  const hayFiltros = Object.values(f).some(Boolean);
  const periodo = { from, to };

  const descargar = async (lista, nombre, clave) => {
    setBusy(clave); setError("");
    try { const blob = await R.buildResumenRutasPdf({ regiones: lista, periodo }); downloadBlob(blob, R.nombreArchivoResumen(nombre, from, to)); }
    catch (e) { setError(`No se pudo generar el PDF: ${e.message}`); }
    setBusy("");
  };
  const descargarCadaUna = async () => { for (const g of regiones) await descargar([g], g.nombre, "cada"); };
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const alternar = (k) => setAbiertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 600, marginRight: 4 }}>Resumen de rutas del día</div>
          <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); } }} title="Desde" />
          <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => { if (e.target.value) { setTo(e.target.value); if (e.target.value < from) setFrom(e.target.value); } }} title="Hasta" />
          <button className="amg-btn" onClick={() => { const y = sumarDias(hoy, -1); setFrom(y); setTo(y); }}>Ayer</button>
          <button className="amg-btn" onClick={() => { const y = sumarDias(hoy, -2); setFrom(y); setTo(y); }}>Antier</button>
          <button className="amg-btn" onClick={() => { setFrom(hoy); setTo(hoy); }}>Hoy</button>
          <button className="amg-btn" onClick={() => { setFrom(sumarDias(hoy, -7)); setTo(sumarDias(hoy, -1)); }}>Últimos 7 días</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select className="amg-select" style={{ width: 200 }} value={f.region} onChange={(e) => set("region", e.target.value)}><option value="">Todas las regiones</option>{opciones.region.map((r) => <option key={r} value={String(r)}>{regionInfo ? regionInfo.label(r) : `Región ${r}`}</option>)}</select>
          <select className="amg-select" style={{ width: 170 }} value={f.depto} onChange={(e) => set("depto", e.target.value)}><option value="">Todos los departamentos</option>{opciones.depto.map((d) => <option key={d} value={d}>{bonito(d)}</option>)}</select>
          <select className="amg-select" style={{ width: 170 }} value={f.coord} onChange={(e) => set("coord", e.target.value)}><option value="">Todos los coordinadores</option>{opciones.coord.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          {opciones.empresa.length > 1 && <select className="amg-select" style={{ width: 150 }} value={f.empresa} onChange={(e) => set("empresa", e.target.value)}><option value="">Todas las empresas</option>{opciones.empresa.map((d) => <option key={d} value={d}>{d}</option>)}</select>}
          <select className="amg-select" style={{ width: 200 }} value={f.tec} onChange={(e) => set("tec", e.target.value)}><option value="">Todos los técnicos</option>{opciones.tec.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          <select className="amg-select" style={{ width: 170 }} value={f.res} onChange={(e) => set("res", e.target.value)} title="Filtra los servicios por su resultado"><option value="">Todos los resultados</option>{Object.entries({ armado: "armados", noArmado: "no armados", parcial: "parciales", cancelado: "cancelados" }).map(([k, t]) => <option key={k} value={k}>Solo {t}</option>)}</select>
          {hayFiltros && <button className="amg-btn" onClick={() => setF({ region: "", depto: "", coord: "", empresa: "", tec: "", res: "" })}>✕ Quitar filtros</button>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
          <button className="amg-btn primary" disabled={!regiones.length || !!busy} onClick={() => descargar(regiones, regiones.length === 1 ? regiones[0].nombre : "TODAS LAS REGIONES", "todas")}><Download size={14} /> {busy === "todas" ? "Generando..." : regiones.length === 1 ? "Descargar PDF" : "Descargar PDF (todas las regiones en un archivo)"}</button>
          {regiones.length > 1 && <button className="amg-btn" disabled={!!busy} onClick={descargarCadaUna}><Download size={14} /> {busy === "cada" ? "Generando..." : `Un PDF por región (${regiones.length})`}</button>}
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>El PDF respeta el periodo y los filtros de arriba.</span>
        </div>
      </div>

      {error && <div className="amg-alert danger" style={{ marginBottom: 10 }}>{error}</div>}
      {(loading || !regionInfo) && <div style={{ color: "var(--text-faint)", marginBottom: 10 }}>Leyendo el histórico...</div>}
      {!loading && regionInfo && !items.length && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>No hay productos para {ui.fmtDate(from)}{from !== to ? ` al ${ui.fmtDate(to)}` : ""}. Sale del histórico (días finalizados en Carga) y de lo que sigue en Carga.</div>}

      {filtrados.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12, marginBottom: 12 }}>
            <ui.StatCard label="Servicios" value={total.servicios} accent sub={`${total.productos} productos`} />
            <ui.StatCard label="Técnicos" value={total.tecnicos} />
            <ui.StatCard label="Regiones" value={regiones.length} />
            {total.enCarga > 0 && <ui.StatCard label="Aún en Carga" value={total.enCarga} sub="productos del día sin finalizar" />}
          </div>
          {regiones.map((g) => (
            <div key={g.key} className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{g.label}</div>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{g.servicios} servicios · {g.items.length} productos · {g.resumen.length} técnicos</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!!busy} onClick={() => descargar([g], g.nombre, g.key)}><Download size={14} /> {busy === g.key ? "Generando..." : "Descargar PDF"}</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 8, marginBottom: 10 }}>
                {[["Servicios", g.servicios, ""], ["Armados", g.tot.armados, "var(--green)"], ["No armados", g.tot.noArmados, "var(--red)"], ["Parciales", g.tot.parciales, "#d9a400"], ["Cancelados", g.tot.cancelados, ""], ["Hallazgos auditoría", g.tot.hallazgos, g.tot.hallazgos ? "var(--red)" : ""]].map(([t, v, c]) => (
                  <div key={t} style={{ textAlign: "center", padding: "8px 4px", background: "var(--panel-2)", borderRadius: 8 }}><div style={{ fontSize: 22, fontWeight: 700, color: c || undefined }}>{v}</div><div style={{ fontSize: 10.5, color: "var(--text-faint)", textTransform: "uppercase" }}>{t}</div></div>
                ))}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Técnico</th><th>Servicios</th><th>Armados</th><th>No armados</th><th>Parciales</th><th>Cancelados</th><th>Hallazgos</th></tr></thead>
                  <tbody>
                    {g.resumen.map((r) => {
                      const k = `${g.key}|${r.tecnico}`, abierto = abiertos.has(k);
                      return [
                        <tr key={k}>
                          <td><button className="amg-btn ghost" style={{ padding: 0, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }} onClick={() => alternar(k)}>{abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{r.tecnico}</button></td>
                          <td className="amg-mono">{r.servicios}</td><td className="amg-mono" style={{ color: "var(--green)" }}>{r.armados}</td><td className="amg-mono" style={{ color: r.noArmados ? "var(--red)" : undefined }}>{r.noArmados}</td>
                          <td className="amg-mono">{r.parciales}</td><td className="amg-mono">{r.cancelados}</td><td className="amg-mono" style={{ color: r.hallazgos ? "var(--red)" : undefined }}>{r.hallazgos}</td>
                        </tr>,
                        abierto && (
                          <tr key={`${k}|d`}><td colSpan={7} style={{ padding: 0 }}>
                            <div style={{ overflowX: "auto", background: "var(--panel-2)", padding: 8 }}>
                              <table className="amg-table compact" style={{ fontSize: 12 }}>
                                <thead><tr><th>Servicio</th><th>Fecha</th><th>Cliente</th><th>Ciudad</th><th>Barrio</th><th>Producto</th><th>Observación</th><th>¿Armado?</th><th>Causales</th><th>Auditoría</th><th>Resultado del servicio</th></tr></thead>
                                <tbody>{r.items.map((i, n) => (
                                  <tr key={n}><td className="amg-mono">{i.servicio}</td><td className="amg-mono">{i.fecha}</td><td>{i.cliente}</td><td>{i.ciudad}</td><td>{i.barrio}</td><td>{i.producto}</td><td>{i.observacion}</td><td>{i.armado || "-"}</td><td>{i.causales}</td><td style={{ color: i.auditoria ? "var(--red)" : undefined }}>{i.auditoria}</td>
                                    <td style={{ color: COLOR_ESTADO[i.estadoServicio], fontWeight: 600 }}>{ESTADOS[i.estadoServicio]}</td></tr>
                                ))}</tbody>
                              </table>
                            </div>
                          </td></tr>
                        ),
                      ];
                    })}
                    <tr style={{ fontWeight: 700 }}><td>TOTAL</td><td className="amg-mono">{g.servicios}</td><td className="amg-mono">{g.tot.armados}</td><td className="amg-mono">{g.tot.noArmados}</td><td className="amg-mono">{g.tot.parciales}</td><td className="amg-mono">{g.tot.cancelados}</td><td className="amg-mono">{g.tot.hallazgos}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
            Cada servicio de un técnico cuenta según el "ARMADO?" de sus productos: todos SI = armado, todos NO = no armado, mezcla = parcial, todos cancelados = cancelado. Hallazgo de auditoría = servicio con algo en la columna AUDITORIA. Pulsa un técnico para ver sus productos.
          </div>
        </>
      )}
    </div>
  );
}
