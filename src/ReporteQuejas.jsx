import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import { Upload, Check, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import * as Q from "./lib/quejas";
import { fetchHistory, loadRegionInfo } from "./lib/asignacion/history";

/* ============================================================================
   QUEJAS POR INCUMPLIMIENTO (Reportes)
   Las quejas que envía el cliente (Excel semanal) se suben aquí y se acumulan. Cada una se cruza con el cierre de Extreme (hora fin de trabajo) y con el histórico de asignación
   para saber qué técnico fue el causante y si la queja le aplica o no. Regla clave: si el técnico llama tarde (desde las 4 p. m.) y cierra como «Cliente cancela», pero el cliente
   no canceló, la queja SÍ aplica. El % del mes = quejas que aplican ÷ servicios armados del mes de esa empresa (histórico de asignación, resultado Realizado).
============================================================================ */

const TIP = { background: "#fff", border: "1px solid #e2e7f1", borderRadius: 8, fontSize: 12 };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmtPct = (v, d = 2) => (v === null || v === undefined ? "–" : `${Number(v).toFixed(d).replace(".", ",")}%`);
const TABS = [["resumen", "Resumen del mes"], ["quejas", "Quejas y causante"], ["tecnicos", "Por técnico"]];
const APLICA = { si: ["Aplica", "red"], no: ["No aplica", "green"], revisar: ["Por revisar", "amber"] };
const mesDe = (f) => String(f).slice(0, 7);

export default function ReporteQuejas({ db, session, ui }) {
  const [quejas, setQuejas] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [hist, setHist] = useState([]);
  const [regionInfo, setRegionInfo] = useState(null);
  const [error, setError] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [tab, setTab] = useState("resumen");
  const [mesSel, setMesSel] = useState("");
  const [empresa, setEmpresa] = useState("JAMAR");
  const [f, setF] = useState({ aplica: "", depto: "", busca: "" });
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [carga, setCarga] = useState(null);   // { archivo, leido, empresa, busy, error }
  const [editar, setEditar] = useState(null); // { q, a, aplica, causante, technicianId, comentario, busy, error }
  const [quitar, setQuitar] = useState(null);
  const [msg, setMsg] = useState("");
  const puedeEditar = session.role === "admin" || session.role === "operador";

  useEffect(() => {
    let alive = true;
    setError("");
    (async () => {
      try {
        const lista = await Q.cargarQuejas();
        if (!alive) return;
        setQuejas(lista);
        if (!lista.length) { setCtx({ extreme: new Map(), historia: new Map() }); setHist([]); return; }
        const meses = lista.map((q) => mesDe(q.fecha)).sort();
        const [c, h, ri] = await Promise.all([Q.cargarContexto(lista), fetchHistory({ from: `${meses[0]}-01`, to: Q.finDeMes(meses[meses.length - 1]) }), loadRegionInfo().catch(() => null)]);
        if (!alive) return;
        setCtx(c); setHist(h); setRegionInfo(ri);
      } catch (e) {
        if (alive) { setQuejas([]); setCtx({ extreme: new Map(), historia: new Map() }); setError(`${e.message}. Si es la primera vez, falta correr el SQL de las quejas (sql/61) en Supabase.`); }
      }
    })();
    return () => { alive = false; };
  }, [recarga]);

  const meses = useMemo(() => [...new Set((quejas || []).map((q) => mesDe(q.fecha)))].sort(), [quejas]);
  useEffect(() => { if (meses.length && !meses.includes(mesSel)) setMesSel(meses[meses.length - 1]); }, [meses]);
  const empresas = useMemo(() => [...new Set(["JAMAR", ...(quejas || []).map((q) => q.empresa).filter(Boolean)])].sort(), [quejas]);

  const armados = useMemo(() => Q.serviciosArmados(hist, { empresa, services: db.services, empresaDe: regionInfo ? regionInfo.empresaDe : undefined }), [hist, empresa, db.services, regionInfo]);
  const cargaDelDia = (id, dia) => armados.cargaDia.get(`${id}|${dia}`) || 0;

  const items = useMemo(() => {
    if (!quejas || !ctx) return [];
    return quejas.filter((q) => Q.plano(q.empresa) === Q.plano(empresa))
      .map((q) => ({ q, a: Q.analizarQueja(q, ctx, { tecnicos: db.technicians, cargaDelDia }) }));
  }, [quejas, ctx, empresa, db.technicians, armados]);
  const delMes = useMemo(() => items.filter((x) => mesDe(x.q.fecha) === mesSel), [items, mesSel]);
  const totalMes = Q.cuenta(delMes);
  const servicios = armados.porMes.get(mesSel) || 0;
  const otrasEmpresas = [...armados.fuera.entries()].filter(([k]) => k.startsWith(`${mesSel}|`)).reduce((s, [, n]) => s + n, 0);

  const deptos = useMemo(() => {
    const m = new Map();
    const get = (k, nombre) => { if (!m.has(k)) m.set(k, { depto: nombre, items: [] }); return m.get(k); };
    delMes.forEach((x) => { const k = Q.plano(x.q.departamento) || "SIN DEPARTAMENTO"; get(k, x.q.departamento || "Sin departamento").items.push(x); });
    armados.porMesDepto.forEach((_, key) => { const [mes, k] = key.split("|"); if (mes === mesSel && k && !m.has(k)) get(k, k.charAt(0) + k.slice(1).toLowerCase()); });
    return [...m.entries()].map(([k, g]) => { const c = Q.cuenta(g.items); const s = armados.porMesDepto.get(`${mesSel}|${k}`) || 0; return { ...g, ...c, servicios: s, pct: Q.pct(c.aplican, s) }; })
      .filter((g) => g.total > 0 || g.servicios > 0).sort((a, b) => b.aplican - a.aplican || b.total - a.total || b.servicios - a.servicios);
  }, [delMes, armados, mesSel]);

  const origenes = useMemo(() => { const m = new Map(); delMes.forEach((x) => { const k = x.a.origen; if (!m.has(k)) m.set(k, { origen: k, total: 0, aplican: 0 }); const g = m.get(k); g.total++; if (x.a.aplica === "si") g.aplican++; }); return [...m.values()].sort((a, b) => b.total - a.total); }, [delMes]);

  const tecnicos = useMemo(() => {
    const m = new Map();
    delMes.forEach((x) => {
      const k = x.a.tecnico.id || Q.plano(x.a.tecnico.nombre) || "SIN";
      if (!m.has(k)) m.set(k, { key: k, id: x.a.tecnico.id, nombre: x.a.tecnico.nombre || "Sin identificar", items: [] });
      m.get(k).items.push(x);
    });
    const techById = new Map((db.technicians || []).map((t) => [t.id, t]));
    return [...m.values()].map((g) => { const c = Q.cuenta(g.items); const t = g.id && techById.get(g.id); const s = g.id ? armados.porMesTec.get(`${mesSel}|${g.id}`) || 0 : null; return { ...g, ...c, depto: (t && t.department) || "", estado: t ? t.status : "", servicios: s, pct: s ? Q.pct(c.aplican, s) : null }; })
      .sort((a, b) => b.aplican - a.aplican || b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
  }, [delMes, armados, mesSel, db.technicians]);

  const tendencia = useMemo(() => meses.map((m) => { const its = items.filter((x) => mesDe(x.q.fecha) === m); const c = Q.cuenta(its); const s = armados.porMes.get(m) || 0; return { mes: Q.mesLabel(m), pct: s ? Number(((c.aplican / s) * 100).toFixed(2)) : null, aplican: c.aplican, servicios: s }; }), [meses, items, armados]);

  const filtradas = useMemo(() => {
    const b = Q.plano(f.busca);
    return delMes.filter((x) => (!f.aplica || x.a.aplica === f.aplica) && (!f.depto || Q.plano(x.q.departamento) === Q.plano(f.depto))
      && (!b || Q.plano(`${x.q.caso} ${x.q.servicio} ${x.a.tecnico.nombre}`).includes(b)));
  }, [delMes, f]);
  const deptosQuejas = useMemo(() => [...new Set(delMes.map((x) => x.q.departamento).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [delMes]);

  const tecnicosPersonal = useMemo(() => (db.technicians || []).filter((t) => t.category !== "Administrativo").sort((a, b) => a.name.localeCompare(b.name, "es")), [db.technicians]);
  const nombreLindo = (s) => String(s || "").replace(/_/g, " ");

  /* ----------------------------- Cargar el Excel ----------------------------- */
  const abrirArchivo = async (file) => {
    if (!file) return;
    setMsg(""); setCarga({ archivo: file.name, busy: true, empresa: "JAMAR" });
    try { setCarga({ archivo: file.name, leido: Q.leerExcelQuejas(await file.arrayBuffer()), empresa: "JAMAR" }); }
    catch (e) { setCarga({ archivo: file.name, error: e.message }); }
  };
  const guardar = async () => {
    setCarga((c) => ({ ...c, busy: true, error: "" }));
    try {
      const n = await Q.guardarQuejas(carga.leido.filas, { archivo: carga.archivo, userId: session.id, empresa: carga.empresa });
      const m = carga.leido.filas.map((x) => mesDe(x.fecha)).sort().pop();
      setMsg(`${n} quejas guardadas (${carga.archivo}).`);
      setEmpresa(Q.plano(carga.empresa) || "JAMAR"); setMesSel(m); setCarga(null); setQuejas(null); setRecarga((k) => k + 1);
    } catch (e) { setCarga((c) => ({ ...c, busy: false, error: `No se pudo guardar: ${e.message}` })); }
  };

  /* ----------------------------- Decisión manual ----------------------------- */
  const abrirEditar = (x) => setEditar({ q: x.q, a: x.a, aplica: x.q.aplica_manual || "", causante: x.q.causante_manual || "", technicianId: x.q.technician_manual_id || "", comentario: x.q.comentario || "" });
  const guardarEditar = async () => {
    setEditar((e) => ({ ...e, busy: true, error: "" }));
    try {
      const fila = await Q.guardarDecision(editar.q.id, { aplica: editar.aplica, causante: editar.causante, technicianId: editar.technicianId, comentario: editar.comentario, userId: session.id });
      setQuejas((l) => l.map((q) => (q.id === fila.id ? { ...q, ...fila } : q))); setEditar(null);
    } catch (e) { setEditar((x) => ({ ...x, busy: false, error: e.message })); }
  };
  const confirmarQuitar = async () => {
    try { await Q.quitarQueja(quitar.q.id); setQuejas((l) => l.filter((q) => q.id !== quitar.q.id)); setQuitar(null); }
    catch (e) { setError(`No se pudo quitar: ${e.message}`); setQuitar(null); }
  };

  const toggle = (id) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const textoCierre = (a) => (a.cierre ? `${a.cierre.causal || "—"}${a.cierre.hora ? ` · ${Q.horaTxt(a.cierre.hora)}` : ""}` : "");

  const exportarQuejas = () => ui.downloadCSV(`quejas_incumplimiento_${mesSel}.csv`,
    ["Fecha", "Caso", "Servicio", "Departamento", "Técnico causante", "Origen", "Aplica", "Decisión manual", "Causal de cierre (Excel)", "Causal en Extreme", "Hora de cierre en Extreme", "Cierre tardío", "Subcausal", "Motivo", "Comentario", "Lo que dice el cliente", "Diagnóstico ASC"],
    filtradas.map(({ q, a }) => [ui.fmtDate(q.fecha), q.caso, q.servicio, q.departamento, nombreLindo(a.tecnico.nombre) || "Sin identificar", a.origen, APLICA[a.aplica][0], a.manual ? "Sí" : "No", q.causal_cierre, a.cierre ? a.cierre.causal : "", a.cierre && a.cierre.hora ? Q.horaTxt(a.cierre.hora) : "", a.tarde ? "Sí" : "No", q.subcausal, a.motivo + (a.extras.length ? ` ${a.extras.join(" ")}` : ""), a.comentario, q.informacion_caso, q.diagnostico]));
  const exportarTecnicos = () => ui.downloadCSV(`quejas_por_tecnico_${mesSel}.csv`, ["Técnico", "Departamento (Personal)", "Quejas", "Aplican", "No aplican", "Por revisar", `Servicios armados ${empresa} del mes`, "% aplican sobre servicios"],
    tecnicos.map((t) => [nombreLindo(t.nombre), t.depto, t.total, t.aplican, t.noAplican, t.revisar, t.servicios === null ? "" : t.servicios, t.pct === null ? "" : t.pct.toFixed(2)]));

  const cargando = quejas === null || ctx === null;

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 600, marginRight: 4 }}>Quejas por incumplimiento</div>
          {meses.length > 0 && <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>Mes <select className="amg-select" style={{ width: 170 }} value={mesSel} onChange={(e) => setMesSel(e.target.value)}>{[...meses].reverse().map((m) => <option key={m} value={m}>{Q.mesLargo(m)}</option>)}</select></label>}
          {empresas.length > 1 && <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>Empresa <select className="amg-select" style={{ width: 120 }} value={empresa} onChange={(e) => setEmpresa(e.target.value)}>{empresas.map((e) => <option key={e} value={e}>{e}</option>)}</select></label>}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{TABS.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}</button>)}</div>
          {puedeEditar && (
            <label className="amg-btn" style={{ marginLeft: "auto", cursor: "pointer" }} title="Sube el Excel de quejas de la semana: se suman a las ya cargadas del mes y no se duplican">
              <Upload size={14} /> Cargar Excel de quejas<input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { abrirArchivo(e.target.files[0]); e.target.value = ""; }} /></label>
          )}
        </div>
        {error && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {error}</div>}
        {msg && <div className="amg-alert" style={{ marginTop: 8, background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      </div>

      {carga && (
        <div className="amg-card" style={{ padding: 14, marginBottom: 12, borderLeft: "4px solid var(--accent)" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Revisión de la carga: {carga.archivo}</div>
          {carga.busy && !carga.leido && <div style={{ color: "var(--text-dim)" }}>Leyendo el Excel...</div>}
          {carga.error && <div className="amg-alert danger"><AlertTriangle size={14} /> {carga.error}</div>}
          {carga.leido && (() => {
            const existentes = new Set((quejas || []).map((q) => q.caso));
            const nuevas = carga.leido.filas.filter((x) => !existentes.has(x.caso)).length;
            const dias = carga.leido.filas.map((x) => x.fecha).sort();
            return (
              <>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, marginBottom: 8 }}>
                  <span><b>{carga.leido.filas.length}</b> quejas ({ui.fmtDate(dias[0])} a {ui.fmtDate(dias[dias.length - 1])})</span>
                  <span><b>{nuevas}</b> nuevas · <b>{carga.leido.filas.length - nuevas}</b> ya estaban cargadas (se actualiza lo del Excel, se respeta lo que decidiste a mano)</span>
                </div>
                {carga.leido.avisos.map((a, i) => <div key={i} className="amg-alert danger"><AlertTriangle size={14} /> {a}</div>)}
                <div style={{ overflowX: "auto", marginBottom: 8 }}>
                  <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                    <thead><tr><th>Fecha</th><th>Caso</th><th>Servicio</th><th>Departamento</th><th>Causal de cierre</th><th>Subcausal</th><th></th></tr></thead>
                    <tbody>{carga.leido.filas.map((x) => <tr key={x.caso}><td className="amg-mono">{ui.fmtDate(x.fecha)}</td><td className="amg-mono">{x.caso}</td><td className="amg-mono">{x.servicio || "–"}</td><td>{x.departamento}</td><td>{x.causal_cierre}</td><td>{x.subcausal}</td><td>{existentes.has(x.caso) ? <ui.Badge text="Ya cargada" color="gray" /> : <ui.Badge text="Nueva" color="blue" />}</td></tr>)}</tbody>
                  </table>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>Empresa de estas quejas <input className="amg-input" style={{ width: 120 }} value={carga.empresa} onChange={(e) => setCarga({ ...carga, empresa: e.target.value.toUpperCase() })} /></label>
                  <button className="amg-btn primary" disabled={carga.busy || !carga.empresa.trim()} onClick={guardar}>{carga.busy ? "Guardando..." : `Guardar ${carga.leido.filas.length} quejas`}</button>
                  <button className="amg-btn" disabled={carga.busy} onClick={() => setCarga(null)}>Cancelar</button>
                </div>
              </>
            );
          })()}
          {!carga.leido && carga.error && <button className="amg-btn" style={{ marginTop: 8 }} onClick={() => setCarga(null)}>Cerrar</button>}
        </div>
      )}

      {cargando && !error && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Cargando quejas y cruzando con Extreme y el histórico...</div>}
      {!cargando && meses.length === 0 && !error && (
        <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>
          Aún no hay quejas cargadas. {puedeEditar ? "Usa «Cargar Excel de quejas» para subir el archivo de la semana." : "Pídele a un administrador u operador que cargue el Excel."}
        </div>
      )}

      {!cargando && meses.length > 0 && tab === "resumen" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 12, marginBottom: 12 }}>
            <ui.StatCard label={`% de quejas que aplican · ${Q.mesLabel(mesSel)}`} value={servicios ? fmtPct(Q.pct(totalMes.aplican, servicios)) : "–"} accent
              sub={servicios ? `${fmtInt(totalMes.aplican)} de ${fmtInt(servicios)} servicios armados${totalMes.revisar ? ` · hasta ${fmtPct(Q.pct(totalMes.aplican + totalMes.revisar, servicios))} si las por revisar aplican` : ""}` : "sin servicios armados de esta empresa en el histórico"} />
            <ui.StatCard label="Quejas recibidas" value={fmtInt(totalMes.total)} sub={servicios ? `${fmtPct(Q.pct(totalMes.total, servicios))} de los servicios armados` : ""} />
            <ui.StatCard label="Aplican" value={fmtInt(totalMes.aplican)} sub="atribuibles al técnico" />
            <ui.StatCard label="No aplican" value={fmtInt(totalMes.noAplican)} />
            <ui.StatCard label="Por revisar" value={fmtInt(totalMes.revisar)} sub={totalMes.revisar ? "decide en «Quejas y causante»" : "todas decididas"} />
            <ui.StatCard label={`Servicios armados ${empresa}`} value={fmtInt(servicios)} sub={otrasEmpresas ? `no cuenta ${fmtInt(otrasEmpresas)} de otras empresas (Tugo, particulares, IGS...)` : "únicos, con resultado Realizado en el histórico"} />
          </div>

          {tendencia.length > 1 && (
            <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>% de quejas que aplican por mes ({empresa})</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={tendencia} margin={{ left: 0, right: 20, top: 18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="mes" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v, n, p) => [`${fmtPct(v)} (${p.payload.aplican} de ${fmtInt(p.payload.servicios)})`, "Quejas que aplican"]} contentStyle={TIP} />
                  <Bar dataKey="pct" fill="#e0435c" isAnimationActive={false} radius={[3, 3, 0, 0]}><LabelList dataKey="pct" position="top" fontSize={11} formatter={(v) => fmtPct(v)} /></Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="amg-card" style={{ overflowX: "auto", marginBottom: 14 }}>
            <div style={{ padding: "10px 12px 0", fontSize: 13, fontWeight: 600 }}>Por departamento · {Q.mesLargo(mesSel)}</div>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Departamento</th><th>Quejas</th><th>Aplican</th><th>No aplican</th><th>Por revisar</th><th>Servicios armados</th><th>% aplican</th></tr></thead>
              <tbody>
                {deptos.map((g) => <tr key={g.depto}><td style={{ fontWeight: 600 }}>{g.depto}</td><td className="amg-mono">{g.total}</td><td className="amg-mono" style={{ color: g.aplican ? "var(--red)" : undefined, fontWeight: 600 }}>{g.aplican}</td><td className="amg-mono">{g.noAplican}</td><td className="amg-mono">{g.revisar}</td><td className="amg-mono">{fmtInt(g.servicios)}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{g.servicios ? fmtPct(g.pct) : "–"}</td></tr>)}
                <tr style={{ fontWeight: 700, background: "var(--bg-soft, rgba(0,0,0,0.03))" }}><td>Total</td><td className="amg-mono">{totalMes.total}</td><td className="amg-mono">{totalMes.aplican}</td><td className="amg-mono">{totalMes.noAplican}</td><td className="amg-mono">{totalMes.revisar}</td><td className="amg-mono">{fmtInt(servicios)}</td><td className="amg-mono">{servicios ? fmtPct(Q.pct(totalMes.aplican, servicios)) : "–"}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="amg-card" style={{ overflowX: "auto" }}>
            <div style={{ padding: "10px 12px 0", fontSize: 13, fontWeight: 600 }}>¿De dónde vienen las quejas?</div>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Origen</th><th>Quejas</th><th>Aplican</th></tr></thead>
              <tbody>{origenes.map((o) => <tr key={o.origen}><td>{o.origen}</td><td className="amg-mono">{o.total}</td><td className="amg-mono">{o.aplican}</td></tr>)}</tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
            Los servicios armados son los únicos (día y número de servicio) con resultado Realizado en el histórico de asignación del mes, solo de la empresa {empresa}. Una queja «aplica» cuando se le puede atribuir al técnico; las «por revisar» no cuentan hasta que las decidas.
          </div>
        </>
      )}

      {!cargando && meses.length > 0 && tab === "quejas" && (
        <>
          <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input className="amg-input" style={{ width: 200 }} placeholder="Buscar caso, servicio o técnico..." value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} />
            <select className="amg-select" style={{ width: 150 }} value={f.aplica} onChange={(e) => setF({ ...f, aplica: e.target.value })}><option value="">Aplica: todas</option><option value="si">Aplican</option><option value="no">No aplican</option><option value="revisar">Por revisar</option></select>
            <select className="amg-select" style={{ width: 170 }} value={f.depto} onChange={(e) => setF({ ...f, depto: e.target.value })}><option value="">Todos los departamentos</option>{deptosQuejas.map((d) => <option key={d} value={d}>{d}</option>)}</select>
            <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{filtradas.length} queja(s)</span>
            <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!filtradas.length} onClick={exportarQuejas}>Exportar CSV</button>
          </div>
          <div className="amg-card" style={{ overflowX: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th></th><th>Fecha</th><th>Caso / servicio</th><th>Departamento</th><th>Técnico causante</th><th title="Causal y hora de fin de trabajo del reporte de Extreme">Cierre en Extreme</th><th>Aplica</th><th>Motivo</th>{puedeEditar && <th></th>}</tr></thead>
              <tbody>
                {filtradas.map(({ q, a }) => {
                  const abierto = abiertos.has(q.id);
                  return [
                    <tr key={q.id}>
                      <td><button className="amg-btn ghost" style={{ padding: 2 }} title="Ver lo que dice el cliente y el diagnóstico" onClick={() => toggle(q.id)}>{abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                      <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{ui.fmtDate(q.fecha)}</td>
                      <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{q.caso}<div style={{ fontSize: 11, color: "var(--text-dim)" }}>{q.servicio || "sin servicio"}</div></td>
                      <td>{q.departamento || "–"}</td>
                      <td style={{ fontWeight: 600 }}>{a.tecnico.nombre ? nombreLindo(a.tecnico.nombre) : <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>Sin identificar</span>}<div style={{ fontSize: 11, fontWeight: 400, color: "var(--text-faint)" }}>{a.origen}{a.tecnico.fuente ? ` · por ${a.tecnico.fuente}` : ""}</div></td>
                      <td style={{ whiteSpace: "nowrap" }}>{a.cierre ? <>{a.cierre.causal || "–"}<div className="amg-mono" style={{ fontSize: 11.5, color: a.tarde ? "var(--red)" : "var(--text-dim)", fontWeight: a.tarde ? 700 : 400 }}>{a.cierre.hora ? Q.horaTxt(a.cierre.hora) : "sin hora"}{a.tarde ? " · tarde" : ""}</div></> : <span style={{ color: "var(--text-faint)" }}>Sin dato en Extreme<div style={{ fontSize: 11 }}>{q.causal_cierre}</div></span>}</td>
                      <td style={{ whiteSpace: "nowrap" }}><ui.Badge text={APLICA[a.aplica][0]} color={APLICA[a.aplica][1]} />{a.manual && <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>decidido a mano</div>}</td>
                      <td style={{ minWidth: 260, maxWidth: 420, lineHeight: 1.35 }}>{a.motivo}{a.comentario && <div style={{ marginTop: 3, color: "var(--accent)" }}>💬 {a.comentario}</div>}</td>
                      {puedeEditar && <td><button className="amg-btn" onClick={() => abrirEditar({ q, a })}>Decidir</button></td>}
                    </tr>,
                    abierto && (
                      <tr key={`${q.id}-d`}>
                        <td></td>
                        <td colSpan={puedeEditar ? 8 : 7} style={{ background: "var(--bg-soft, rgba(0,0,0,0.03))", fontSize: 12.5, lineHeight: 1.45 }}>
                          <div><b>Lo que dice el cliente:</b> {q.informacion_caso || "–"}</div>
                          <div style={{ marginTop: 4 }}><b>Diagnóstico de ASC:</b> {q.diagnostico || "–"}</div>
                          <div style={{ marginTop: 4, color: "var(--text-dim)" }}>Subcausal: {q.subcausal || "–"} · Causal de cierre: {q.causal_cierre || "–"} · Proveedor: {q.proveedor || "–"}{a.hist ? ` · Histórico (${ui.fmtDate(a.hist.dia)}): ${a.hist.resultado}${a.hist.productos.length ? `, ${a.hist.productos.join(", ")}` : ""}` : ""}</div>
                          {a.extras.length > 0 && <div style={{ marginTop: 4, color: "var(--text-dim)" }}>{a.extras.join(" ")}</div>}
                          {session.role === "admin" && <div style={{ marginTop: 6 }}><button className="amg-btn danger" onClick={() => setQuitar({ q })}>Quitar esta queja (cargada por error)</button></div>}
                        </td>
                      </tr>
                    ),
                  ];
                })}
                {filtradas.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay quejas con esos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
            La hora sale del reporte de Extreme (hora fin de trabajo; carga el de cada día en Cierre en línea). Un cierre del cliente (Cliente cancela, Cliente arma, Dirección errada, Visita no efectiva...) desde las {Q.horaTxt(`${Q.HORA_TARDE}:00`)} cuenta como queja que aplica al técnico. «Decidir» te deja cambiar el resultado, el causante o el técnico, y escribir un comentario.
          </div>
        </>
      )}

      {!cargando && meses.length > 0 && tab === "tecnicos" && (
        <>
          <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{tecnicos.length} técnico(s) con quejas en {Q.mesLargo(mesSel)}</span>
            <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!tecnicos.length} onClick={exportarTecnicos}>Exportar CSV</button>
          </div>
          <div className="amg-card" style={{ overflowX: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Técnico</th><th>Departamento</th><th>Quejas</th><th>Aplican</th><th>No aplican</th><th>Por revisar</th><th>Servicios armados del mes</th><th title="Quejas que aplican ÷ servicios armados del técnico en el mes">% aplican</th></tr></thead>
              <tbody>
                {tecnicos.map((t) => (
                  <tr key={t.key} style={{ opacity: t.estado && t.estado !== "Activo" ? 0.65 : 1 }}>
                    <td style={{ fontWeight: 600 }}>{nombreLindo(t.nombre)}{t.estado && t.estado !== "Activo" && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-faint)" }}>({t.estado})</span>}</td>
                    <td>{t.depto || "–"}</td>
                    <td className="amg-mono">{t.total}</td>
                    <td className="amg-mono" style={{ fontWeight: 700, color: t.aplican ? "var(--red)" : undefined }}>{t.aplican}</td>
                    <td className="amg-mono">{t.noAplican}</td><td className="amg-mono">{t.revisar}</td>
                    <td className="amg-mono">{t.servicios === null ? "–" : fmtInt(t.servicios)}</td>
                    <td className="amg-mono" style={{ fontWeight: 700 }}>{t.pct === null ? "–" : fmtPct(t.pct)}</td>
                  </tr>
                ))}
                {tecnicos.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay quejas este mes.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>Ordenado por quejas que aplican. Los servicios armados son los del técnico en el histórico del mes (solo {empresa}). «Sin identificar» son quejas cuyo servicio no aparece en Extreme ni en el histórico.</div>
        </>
      )}

      {editar && (
        <ui.Modal title={`Decidir la queja ${editar.q.caso}`} onClose={() => setEditar(null)} width={560}
          footer={<><button className="amg-btn" disabled={editar.busy} onClick={() => setEditar(null)}>Cancelar</button><button className="amg-btn primary" disabled={editar.busy} onClick={guardarEditar}>{editar.busy ? "Guardando..." : "Guardar"}</button></>}>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.4 }}><b>Propuesta automática:</b> {APLICA[editar.a.aplicaAuto][0]} · {editar.a.motivo}</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div><label className="amg-label">¿Le aplica al técnico?</label>
              <select className="amg-select" value={editar.aplica} onChange={(e) => setEditar({ ...editar, aplica: e.target.value })}><option value="">Automático ({APLICA[editar.a.aplicaAuto][0]})</option><option value="si">Sí aplica</option><option value="no">No aplica</option></select></div>
            <div><label className="amg-label">Causante</label>
              <select className="amg-select" value={editar.causante} onChange={(e) => setEditar({ ...editar, causante: e.target.value })}><option value="">Automático ({editar.a.origen})</option>{Q.CAUSANTES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="amg-label">Técnico causante</label>
              <select className="amg-select" value={editar.technicianId} onChange={(e) => setEditar({ ...editar, technicianId: e.target.value })}><option value="">Automático ({editar.a.tecnico.nombre ? nombreLindo(editar.a.tecnico.nombre) : "sin identificar"})</option>{tecnicosPersonal.map((t) => <option key={t.id} value={t.id}>{nombreLindo(t.name)} · {t.department || "sin depto"} · {t.status}</option>)}</select></div>
            <div><label className="amg-label">Comentario (por qué se decidió así)</label>
              <textarea className="amg-input" rows={3} value={editar.comentario} onChange={(e) => setEditar({ ...editar, comentario: e.target.value })} /></div>
            {editar.error && <div className="amg-alert danger"><AlertTriangle size={14} /> {editar.error}</div>}
          </div>
        </ui.Modal>
      )}
      {quitar && <ui.ConfirmModal title="Quitar queja" danger confirmLabel="Quitar" message={`Se quitará la queja ${quitar.q.caso} (servicio ${quitar.q.servicio || "–"}) del reporte. No se puede deshacer; si fue un error, vuelve a cargar el Excel.`} onConfirm={confirmarQuitar} onClose={() => setQuitar(null)} />}
    </div>
  );
}
