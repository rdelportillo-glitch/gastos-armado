import { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell } from "recharts";
import { Upload, Check, AlertTriangle } from "lucide-react";
import * as C from "./lib/csat";
import { leerPptxCsat } from "./lib/csatPptx";

/* ============================================================================
   CSAT DEL CLIENTE (Reportes)
   Satisfacción de los clientes de Jamar por técnico y por departamento, a partir del informe mensual en PowerPoint ("INFORME CSAT ARMADO"), que se sube aquí cada mes.
   Al cargarlo, los nombres de los técnicos se homologan con Personal (los dudosos se confirman a mano, y la decisión queda guardada para los meses siguientes).
   Cada técnico se cuenta en el departamento de su ficha de Personal. El PowerPoint no trae cuántas encuestas tuvo cada técnico: el CSAT de un departamento es el promedio de sus técnicos.
============================================================================ */

const TIP = { background: "#fff", border: "1px solid #e2e7f1", borderRadius: 8, fontSize: 12 };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmtPct = (v, d = 1) => (v === null || v === undefined ? "–" : `${Number(v).toFixed(d).replace(".", ",")}%`);
const TABS = [["resumen", "Resumen y tendencia"], ["departamentos", "Por departamento"], ["tecnicos", "Por técnico"]];
const NINGUNA = "__ninguna__";

const Celda = ({ c, meta }) => {
  if (!c || c.csat === null || c.csat === undefined) return <span style={{ color: "var(--text-faint)" }}>–</span>;
  const n = C.nivel(c.csat, meta);
  return (
    <div style={{ minWidth: 150 }}>
      <span className="amg-mono" style={{ fontWeight: 700, color: n.color }}>{fmtPct(c.csat, c.csat % 1 ? 1 : 0)}</span>
      {c.deptos && new Set(c.deptos).size > 1 && <span title={`Promedio de ${new Set(c.deptos).size} departamentos: ${[...new Set(c.deptos)].join(", ")}`} style={{ fontSize: 10.5, color: "var(--text-faint)", marginLeft: 6 }}>prom. {new Set(c.deptos).size} deptos</span>}
      {c.motivos ? <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.3 }}>{c.motivos}</div> : <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Sin insatisfechos</div>}
    </div>
  );
};

export default function ReporteCsat({ db, session, ui }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [tab, setTab] = useState("resumen");
  const [mesSel, setMesSel] = useState("");
  const [f, setF] = useState({ depto: "", busca: "", soloInsat: false });
  const [carga, setCarga] = useState(null);   // { archivo, leido, hom, decisiones, busy, error }
  const [msg, setMsg] = useState("");
  const puedeCargar = session.role === "admin" || session.role === "operador";

  useEffect(() => {
    let alive = true;
    setError("");
    C.cargarCsat().then((d) => { if (alive) setDatos(d); })
      .catch((e) => { if (alive) { setDatos({ resumen: [], departamentos: [], tecnicos: [], alias: [] }); setError(`${e.message}. Si es la primera vez, falta correr el SQL del CSAT (sql/57) en Supabase.`); } });
    return () => { alive = false; };
  }, [recarga]);

  const meses = useMemo(() => {
    if (!datos) return [];
    const s = new Set(); datos.resumen.forEach((r) => s.add(String(r.mes).slice(0, 7))); datos.tecnicos.forEach((r) => s.add(String(r.mes).slice(0, 7))); datos.departamentos.forEach((r) => s.add(String(r.mes).slice(0, 7)));
    return [...s].sort();
  }, [datos]);
  useEffect(() => { if (meses.length && !meses.includes(mesSel)) setMesSel(meses[meses.length - 1]); }, [meses]);
  const cols = useMemo(() => (mesSel ? [C.mesAnterior(mesSel, 2), C.mesAnterior(mesSel, 1), mesSel] : []), [mesSel]);

  const resumenDe = (mes, ambito) => (datos ? datos.resumen.find((r) => String(r.mes).slice(0, 7) === mes && r.ambito === ambito) : null) || null;
  const general = resumenDe(mesSel, "general"), asc = resumenDe(mesSel, "asc");
  const meta = (general && Number(general.meta)) || (asc && Number(asc.meta)) || 90;

  const tecnicos = useMemo(() => (datos ? C.armarTecnicos(datos.tecnicos, db.technicians) : []), [datos, db.technicians]);
  const tecMes = (t, mes) => t.porMes[mes];
  const deptos = useMemo(() => [...new Set(tecnicos.map((t) => t.depto).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [tecnicos]);
  const porDepto = useMemo(() => C.resumenPorDepto(tecnicos, cols, meta), [tecnicos, cols, meta]);
  const oficial = useMemo(() => (datos ? datos.departamentos.filter((d) => String(d.mes).slice(0, 7) === mesSel).sort((a, b) => Number(b.csat) - Number(a.csat)) : []), [datos, mesSel]);
  const bajoMeta = tecnicos.filter((t) => { const c = tecMes(t, mesSel); return c && c.csat !== null && c.csat < meta; }).length;
  const conDato = tecnicos.filter((t) => { const c = tecMes(t, mesSel); return c && c.csat !== null; }).length;

  const serie = useMemo(() => {
    if (!datos) return [];
    const ms = [...new Set(datos.resumen.map((r) => String(r.mes).slice(0, 7)))].sort();
    return ms.map((m) => ({ mes: C.mesLabel(m), General: resumenDe(m, "general") ? Number(resumenDe(m, "general").csat) : null, "Asc - Biver": resumenDe(m, "asc") ? Number(resumenDe(m, "asc").csat) : null }));
  }, [datos]);

  const filas = useMemo(() => {
    const q = C.plano(f.busca);
    return tecnicos
      .filter((t) => cols.some((m) => tecMes(t, m)))
      .filter((t) => (!f.depto || t.depto === f.depto) && (!q || C.plano(t.nombre).includes(q)) && (!f.soloInsat || (tecMes(t, mesSel) && (tecMes(t, mesSel).motivos || tecMes(t, mesSel).csat < 100))))
      .sort((a, b) => { const x = tecMes(a, mesSel), y = tecMes(b, mesSel); const vx = x && x.csat !== null ? x.csat : 999, vy = y && y.csat !== null ? y.csat : 999; return vx - vy || a.nombre.localeCompare(b.nombre, "es"); });
  }, [tecnicos, f, cols, mesSel]);

  const tendencia = (t) => { const a = tecMes(t, cols[1]), b = tecMes(t, cols[2]); if (!a || !b || a.csat === null || b.csat === null) return null; return b.csat - a.csat; };

  /* ----------------------------- Carga del PowerPoint ----------------------------- */
  const abrirArchivo = async (file) => {
    if (!file) return;
    setMsg(""); setCarga({ archivo: file.name, busy: true });
    try {
      const leido = leerPptxCsat(await file.arrayBuffer());
      const hom = C.homologar(leido.tecnicos.map((t) => t.tecnico), db.technicians, datos ? datos.alias : []);
      const decisiones = new Map();
      hom.forEach((h, k) => { if (h.via === "sinIdentificar") return; decisiones.set(k, h.via === "alias" ? (h.tecnico ? h.tecnico.id : null) : h.via === "exacto" || h.via === "probable" ? h.tecnico.id : null); });
      setCarga({ archivo: file.name, leido, hom, decisiones });
    } catch (e) { setCarga({ archivo: file.name, error: e.message }); }
  };
  const decidir = (k, v) => setCarga((c) => { const d = new Map(c.decisiones); d.set(k, v === NINGUNA ? null : v); return { ...c, decisiones: d }; });
  const guardar = async () => {
    setCarga((c) => ({ ...c, busy: true, error: "" }));
    try {
      const r = await C.guardarCsat({ datos: carga.leido, decisiones: carga.decisiones, archivo: carga.archivo, userId: session.id });
      setMsg(`CSAT de ${C.mesLargo(carga.leido.mes)} guardado: ${r.tecnicos} filas de técnicos y ${r.departamentos} departamentos.`);
      setCarga(null); setMesSel(carga.leido.mes); setRecarga((n) => n + 1);
    } catch (e) { setCarga((c) => ({ ...c, busy: false, error: `No se pudo guardar: ${e.message}` })); }
  };

  const tecnicosPersonal = useMemo(() => (db.technicians || []).filter((t) => t.category !== "Administrativo").sort((a, b) => a.name.localeCompare(b.name, "es")), [db.technicians]);
  const revisar = carga && carga.hom ? [...carga.hom.entries()].filter(([, h]) => h.via === "probable" || h.via === "ninguno") : [];
  const cuenta = carga && carga.hom ? { alias: 0, exacto: 0, probable: 0, ninguno: 0, sinIdentificar: 0, sinFicha: 0 } : null;
  if (cuenta) carga.hom.forEach((h) => { cuenta[h.via]++; if (h.via === "alias" && h.sinFicha) cuenta.sinFicha++; });

  const exportarTecnicos = () => ui.downloadCSV(`csat_tecnicos_${mesSel}.csv`, ["Técnico", "Departamento (Personal)", "En Personal", ...cols.flatMap((m) => [`CSAT ${C.mesLabel(m)} (%)`, `Motivos ${C.mesLabel(m)}`])],
    filas.map((t) => [t.nombre, t.depto, t.ficha ? "Sí" : "No", ...cols.flatMap((m) => { const c = tecMes(t, m); return [c && c.csat !== null ? c.csat : "", c ? c.motivos : ""]; })]));

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 600, marginRight: 4 }}>CSAT del cliente (satisfacción)</div>
          {meses.length > 0 && <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>Mes <select className="amg-select" style={{ width: 130 }} value={mesSel} onChange={(e) => setMesSel(e.target.value)}>{[...meses].reverse().map((m) => <option key={m} value={m}>{C.mesLargo(m)}</option>)}</select></label>}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{TABS.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}</button>)}</div>
          {puedeCargar && (
            <label className="amg-btn" style={{ marginLeft: "auto", cursor: "pointer" }} title="Sube el PowerPoint del informe CSAT del mes: se leen los resultados y se homologan los técnicos con Personal">
              <Upload size={14} /> Cargar PowerPoint del CSAT<input type="file" accept=".pptx" style={{ display: "none" }} onChange={(e) => { abrirArchivo(e.target.files[0]); e.target.value = ""; }} /></label>
          )}
        </div>
        {error && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {error}</div>}
        {msg && <div className="amg-alert" style={{ marginTop: 8, background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      </div>

      {carga && (
        <div className="amg-card" style={{ padding: 14, marginBottom: 12, borderLeft: "4px solid var(--accent)" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Revisión de la carga: {carga.archivo}</div>
          {carga.busy && !carga.leido && <div style={{ color: "var(--text-dim)" }}>Leyendo el PowerPoint...</div>}
          {carga.error && <div className="amg-alert danger"><AlertTriangle size={14} /> {carga.error}</div>}
          {carga.leido && (
            <>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, marginBottom: 8 }}>
                <span><b>{C.mesLargo(carga.leido.mes)}</b></span>
                {carga.leido.general && <span>General: <b>{fmtPct(carga.leido.general.csat)}</b> ({fmtInt(carga.leido.general.satisfechos)} sat. / {fmtInt(carga.leido.general.insatisfechos)} insat. / {fmtInt(carga.leido.general.total)})</span>}
                {carga.leido.asc && <span>Asc - Biver: <b>{fmtPct(carga.leido.asc.csat)}</b> ({fmtInt(carga.leido.asc.satisfechos)} / {fmtInt(carga.leido.asc.insatisfechos)} / {fmtInt(carga.leido.asc.total)})</span>}
                <span><b>{carga.leido.departamentos.length}</b> departamentos</span><span><b>{carga.leido.tecnicos.length}</b> filas técnico-mes</span>
                <span>Meses: {[...new Set(carga.leido.tecnicos.map((t) => t.mes))].sort().map(C.mesLabel).join(", ")}</span>
              </div>
              {carga.leido.avisos.map((a, i) => <div key={i} className="amg-alert danger"><AlertTriangle size={14} /> {a}</div>)}
              <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 8 }}>
                Homologación con Personal: <b>{cuenta.exacto + cuenta.alias - cuenta.sinFicha}</b> reconocidos solos (mismo nombre o ya confirmados antes), <b>{cuenta.probable}</b> por confirmar, <b>{cuenta.ninguno}</b> sin coincidencia{cuenta.sinIdentificar ? <>, y las encuestas <b>«Sin identificar»</b> se guardan sin técnico</> : null}.
              </div>
              {revisar.length > 0 && (
                <div style={{ overflowX: "auto", marginBottom: 8 }}>
                  <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                    <thead><tr><th>Nombre en el PowerPoint</th><th>Estado</th><th>Corresponde en Personal a</th></tr></thead>
                    <tbody>
                      {revisar.map(([k, h]) => {
                        const v = carga.decisiones.get(k);
                        const ids = new Set((h.candidatos || []).map((t) => t.id));
                        return (
                          <tr key={k}>
                            <td><b>{h.nombre}</b></td>
                            <td>{h.via === "probable" ? <ui.Badge text="Por confirmar" color="amber" /> : <ui.Badge text="Sin coincidencia" color="red" />}</td>
                            <td>
                              <select className="amg-select" style={{ minWidth: 260 }} value={v || NINGUNA} onChange={(e) => decidir(k, e.target.value)}>
                                <option value={NINGUNA}>— No tiene ficha en Personal —</option>
                                {(h.candidatos || []).map((t) => <option key={t.id} value={t.id}>{t.name.replace(/_/g, " ")} · {t.department || "sin depto"} · {t.status} (sugerido)</option>)}
                                {tecnicosPersonal.filter((t) => !ids.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name.replace(/_/g, " ")} · {t.department || "sin depto"} · {t.status}</option>)}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button className="amg-btn primary" disabled={carga.busy} onClick={guardar}>{carga.busy ? "Guardando..." : `Guardar CSAT de ${C.mesLargo(carga.leido.mes)}`}</button>
                <button className="amg-btn" disabled={carga.busy} onClick={() => setCarga(null)}>Cancelar</button>
                <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Se guardan también los meses anteriores que trae el informe. Si ya estaban, se actualizan; nada se duplica.</span>
              </div>
            </>
          )}
          {!carga.leido && carga.error && <button className="amg-btn" style={{ marginTop: 8 }} onClick={() => setCarga(null)}>Cerrar</button>}
        </div>
      )}

      {datos && meses.length === 0 && !error && (
        <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>
          Aún no hay CSAT cargado. {puedeCargar ? "Usa «Cargar PowerPoint del CSAT» para subir el informe del mes." : "Pídele a un administrador u operador que cargue el informe."}
        </div>
      )}

      {datos && meses.length > 0 && tab === "resumen" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 12, marginBottom: 12 }}>
            <ui.StatCard label={`CSAT general · ${C.mesLabel(mesSel)}`} value={general ? fmtPct(general.csat) : "–"} accent sub={general ? `Meta ${fmtPct(meta, 0)} · ${Number(general.csat) >= meta ? "superada" : "por debajo"}` : "sin dato del mes"} />
            <ui.StatCard label="CSAT Asc - Biver" value={asc ? fmtPct(asc.csat) : "–"} accent sub={asc ? `${fmtInt(asc.satisfechos)} sat. · ${fmtInt(asc.insatisfechos)} insat. · ${fmtInt(asc.total)} respuestas` : "sin dato del mes"} />
            {general && general.total ? <ui.StatCard label="Respuestas (general)" value={fmtInt(general.total)} sub={`${fmtInt(general.satisfechos)} satisfechos · ${fmtInt(general.insatisfechos)} insatisfechos`} /> : null}
            <ui.StatCard label="Técnicos con encuestas" value={fmtInt(conDato)} sub={`${fmtInt(bajoMeta)} bajo la meta del mes`} />
          </div>

          <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tendencia del CSAT (meta {fmtPct(meta, 0)})</div>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={serie} margin={{ left: 0, right: 20, top: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="mes" tick={{ fontSize: 11 }} /><YAxis domain={[80, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v) => fmtPct(v)} contentStyle={TIP} /><Legend />
                <ReferenceLine y={meta} stroke="#e0435c" strokeDasharray="5 4" label={{ value: "Meta", fontSize: 11, fill: "#e0435c", position: "insideTopRight" }} />
                <Line type="monotone" dataKey="General" isAnimationActive={false} stroke="#2f6fed" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                <Line type="monotone" dataKey="Asc - Biver" isAnimationActive={false} stroke="#12a166" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>El informe de cada mes trae el CSAT general de los 3 últimos meses; el de Asc - Biver se va completando mes a mes con cada informe cargado.</div>
          </div>

          {oficial.length > 0 && (
            <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Asc - Biver por departamento · {C.mesLargo(mesSel)} (cifras del informe)</div>
              <ResponsiveContainer width="100%" height={Math.max(180, oficial.length * 32 + 40)}>
                <BarChart data={oficial.map((d) => ({ d: d.departamento, csat: Number(d.csat) }))} layout="vertical" margin={{ left: 20, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis type="number" domain={[80, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} /><YAxis type="category" dataKey="d" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmtPct(v)} contentStyle={TIP} /><ReferenceLine x={meta} stroke="#e0435c" strokeDasharray="5 4" />
                  <Bar dataKey="csat" isAnimationActive={false} radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 11, formatter: (v) => fmtPct(v, 0) }}>{oficial.map((d) => <Cell key={d.departamento} fill={Number(d.csat) >= meta ? "#12a166" : Number(d.csat) >= meta - 10 ? "#ff9540" : "#e0435c"} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ overflowX: "auto" }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Departamento</th><th>Satisfechos</th><th>Insatisfechos</th><th>Total</th><th>CSAT</th></tr></thead>
                  <tbody>{oficial.map((d) => <tr key={d.departamento}><td>{d.departamento}</td><td className="amg-mono">{fmtInt(d.satisfechos)}</td><td className="amg-mono" style={{ color: d.insatisfechos ? "var(--red)" : undefined }}>{fmtInt(d.insatisfechos)}</td><td className="amg-mono">{fmtInt(d.satisfechos + d.insatisfechos)}</td><td className="amg-mono" style={{ fontWeight: 700, color: C.nivel(Number(d.csat), meta).color }}>{fmtPct(d.csat, 0)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {datos && meses.length > 0 && tab === "departamentos" && (
        <div className="amg-card" style={{ overflowX: "auto" }}>
          <table className="amg-table compact" style={{ fontSize: 12.5 }}>
            <thead>
              <tr><th rowSpan={2}>Departamento (Personal)</th><th rowSpan={2}>Técnicos con CSAT</th>{cols.map((m) => <th key={m} colSpan={2} style={{ textAlign: "center" }}>{C.mesLabel(m)}</th>)}</tr>
              <tr>{cols.map((m) => [<th key={`${m}p`} title="Promedio del CSAT de los técnicos del departamento">Promedio</th>, <th key={`${m}b`} title="Técnicos con CSAT por debajo de la meta">Bajo meta</th>])}</tr>
            </thead>
            <tbody>
              {porDepto.map((r) => (
                <tr key={r.depto}>
                  <td style={{ fontWeight: 600 }}><button className="amg-btn ghost" style={{ padding: 0, fontWeight: 600 }} title="Ver sus técnicos" onClick={() => { setF({ ...f, depto: r.depto }); setTab("tecnicos"); }}>{r.depto}</button></td>
                  <td className="amg-mono">{r.n}</td>
                  {cols.map((m) => { const c = r.porMes[m]; return [<td key={`${m}p`} className="amg-mono" style={{ fontWeight: 700, color: C.nivel(c.prom, meta).color }}>{c.n ? fmtPct(c.prom) : "–"}</td>, <td key={`${m}b`} className="amg-mono" style={{ color: c.bajo ? "var(--red)" : undefined }}>{c.n ? `${c.bajo} de ${c.n}` : "–"}</td>]; })}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", padding: 10 }}>
            Cada técnico se cuenta en el departamento de su ficha de Personal (si no tiene ficha, en el que trae el informe). El informe no trae cuántas encuestas tuvo cada técnico, por eso el <b>promedio</b> es el de los % de sus técnicos y puede diferir del CSAT oficial del departamento, que está en «Resumen y tendencia».
          </div>
        </div>
      )}

      {datos && meses.length > 0 && tab === "tecnicos" && (
        <>
          <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input className="amg-input" style={{ width: 200 }} placeholder="Buscar técnico..." value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} />
            <select className="amg-select" style={{ width: 180 }} value={f.depto} onChange={(e) => setF({ ...f, depto: e.target.value })}><option value="">Todos los departamentos</option>{deptos.map((d) => <option key={d} value={d}>{d}</option>)}</select>
            <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.soloInsat} onChange={(e) => setF({ ...f, soloInsat: e.target.checked })} /> Solo con insatisfechos en {C.mesLabel(mesSel)}</label>
            <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{filas.length} técnico(s)</span>
            <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!filas.length} onClick={exportarTecnicos}>Exportar CSV</button>
          </div>
          <div className="amg-card" style={{ overflowX: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Técnico</th><th>Departamento</th>{cols.map((m) => <th key={m}>{C.mesLabel(m)}</th>)}<th title={`Cambio frente a ${C.mesLabel(cols[1] || "")}`}>Cambio</th></tr></thead>
              <tbody>
                {filas.map((t) => {
                  const d = tendencia(t);
                  return (
                    <tr key={t.key} style={{ opacity: t.estado && t.estado !== "Activo" ? 0.6 : 1 }}>
                      <td style={{ fontWeight: 600 }}>{t.nombre}{!t.ficha && !t.sinIdentificar && <span title="No está enlazado a una ficha de Personal" style={{ marginLeft: 6 }}><ui.Badge text="Sin ficha" color="amber" /></span>}{t.estado && t.estado !== "Activo" && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-faint)" }}>({t.estado})</span>}</td>
                      <td>{t.depto || "-"}</td>
                      {cols.map((m) => <td key={m}><Celda c={tecMes(t, m)} meta={meta} /></td>)}
                      <td className="amg-mono" style={{ whiteSpace: "nowrap", color: d === null ? "var(--text-faint)" : d > 0 ? "var(--green)" : d < 0 ? "var(--red)" : undefined, fontWeight: 600 }}>{d === null ? "–" : d === 0 ? "=" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1).replace(".", ",")}`}</td>
                    </tr>
                  );
                })}
                {filas.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay técnicos con esos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
            Ordenado del CSAT más bajo al más alto del mes elegido. Verde: cumple la meta ({fmtPct(meta, 0)}); naranja: hasta 10 puntos por debajo; rojo: más bajo. Si un técnico atendió en varios departamentos, su % del mes es el promedio de ellos. «Sin identificar» son encuestas sin técnico.
          </div>
        </>
      )}
    </div>
  );
}
