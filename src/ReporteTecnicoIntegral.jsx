import { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { AlertTriangle } from "lucide-react";
import { fetchHistory, loadRegionInfo } from "./lib/asignacion/history";
import { filasCsvDeHistorico } from "./lib/asignacion/csvCarga";
import { gestionDeCausal } from "./lib/asignacion/cierreColumnas";
import { useZonaCoord } from "./lib/useCoordinadores";
import { cargarCierres, soloBiver, HORA_LIMITE, sumarDias } from "./lib/cierreExtreme";
import { loadOffersRange } from "./lib/tv/tvData";
import * as Q from "./lib/quejas";
import { cargarCsat, claveNombre } from "./lib/csat";
import * as G from "./lib/garantias";
import * as TI from "./lib/tecnicoIntegral";

/* ============================================================================
   TÉCNICO INTEGRAL (Reportes)
   Todos los indicadores de cada técnico en una sola tabla con semáforo: cierre en línea (Extreme), garantías, concreción de Instalación de TV, quejas por incumplimiento y CSAT.
   Tablero por técnico, por departamento y por coordinador; al elegir un técnico se abre su ficha con la tendencia de cada indicador (por día, semana o mes).
   Cada grupo se calcula con los registros de todos sus técnicos (no promediando porcentajes). Las metas son de referencia y solo colorean.
============================================================================ */

const TIP = { background: "#fff", border: "1px solid #e2e7f1", borderRadius: 8, fontSize: 12 };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmtPct = (p, d = 1) => (p === null || p === undefined || !isFinite(p) ? "–" : `${Number(p).toFixed(d).replace(".", ",")}%`);
const fechaCorta = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "–");
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const TABS = [["tablero", "Tablero por técnico"], ["departamento", "Por departamento"], ["coordinador", "Por coordinador"], ["ficha", "Ficha del técnico"]];
const PRESETS = [["7", "7 días"], ["30", "30 días"], ["90", "90 días"], ["mes", "Este mes"], ["mesAnt", "Mes anterior"]];
const CLAVE_METAS = "amg_metas_tecnico_integral";
const leerMetas = () => { try { return { ...TI.METAS_DEFECTO, ...JSON.parse(localStorage.getItem(CLAVE_METAS) || "{}") }; } catch (e) { return { ...TI.METAS_DEFECTO }; } };
const nombreLindo = (s) => String(s || "").replace(/_/g, " ");

// Una promesa que no debe tumbar todo el reporte: si falla, se avisa y se sigue con lo demás.
const seguro = (p, nombre, avisos, vacio) => p.catch((e) => { avisos.push(`${nombre}: ${e.message}`); return vacio; });

export default function ReporteTecnicoIntegral({ db, session, ui }) {
  const hoy = ui.todayISO();
  const [from, setFrom] = useState(sumarDias(hoy, -29));
  const [to, setTo] = useState(hoy);
  const [preset, setPreset] = useState("30");
  const [datos, setDatos] = useState(null);
  const [regionInfo, setRegionInfo] = useState(null);
  const [tab, setTab] = useState("tablero");
  const [empresa, setEmpresa] = useState("");
  const [f, setF] = useState({ dept: "", coord: "", busca: "" });
  const [tecId, setTecId] = useState("");
  const [gran, setGran] = useState("semana");
  const [metas, setMetas] = useState(leerMetas);
  const [verMetas, setVerMetas] = useState(false);
  const [orden, setOrden] = useState({ k: "alertas", dir: "desc" });
  const zona = useZonaCoord(db);

  const aplicarPreset = (p) => {
    setPreset(p);
    const d = (n) => sumarDias(hoy, n);
    if (p === "7") { setFrom(d(-6)); setTo(hoy); } else if (p === "30") { setFrom(d(-29)); setTo(hoy); } else if (p === "90") { setFrom(d(-89)); setTo(hoy); } else if (p === "mes") { setFrom(`${hoy.slice(0, 7)}-01`); setTo(hoy); }
    else if (p === "mesAnt") { const ult = sumarDias(`${hoy.slice(0, 7)}-01`, -1); setFrom(`${ult.slice(0, 7)}-01`); setTo(ult); }
  };
  const cambiarMeta = (k, v) => { const n = { ...metas, [k]: v }; setMetas(n); try { localStorage.setItem(CLAVE_METAS, JSON.stringify(n)); } catch (e) { /* sin almacenamiento: queda solo en pantalla */ } };

  useEffect(() => { loadRegionInfo().then(setRegionInfo).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    setDatos(null);
    (async () => {
      const avisos = [];
      const [rows, cierres, ofertas, quejas, csat] = await Promise.all([
        seguro(fetchHistory({ from, to }), "Histórico de asignación", avisos, []),
        seguro(cargarCierres({ from, to }), "Cierre en línea", avisos, []),
        seguro(loadOffersRange({ from, to }), "Instalación de TV", avisos, []),
        seguro(Q.cargarQuejas(), "Quejas", avisos, []),
        seguro(cargarCsat(), "CSAT", avisos, { tecnicos: [] }),
      ]);
      const quejasRango = quejas.filter((q) => q.fecha >= from && q.fecha <= to);
      const ctx = quejasRango.length ? await seguro(Q.cargarContexto(quejasRango), "Cruce de quejas", avisos, { extreme: new Map(), historia: new Map() }) : { extreme: new Map(), historia: new Map() };
      if (alive) setDatos({ rows, cierres, ofertas, quejas: quejasRango, ctx, csat: csat.tecnicos || [], avisos });
    })();
    return () => { alive = false; };
  }, [from, to]);

  const gestionDe = useMemo(() => gestionDeCausal(db.causales), [db.causales]);
  const tecnicos = useMemo(() => (db.technicians || []).filter((t) => t.category !== "Administrativo"), [db.technicians]);
  const tecById = useMemo(() => new Map(tecnicos.map((t) => [t.id, t])), [tecnicos]);
  const coordDe = (t) => (t && ((t.department && zona.coordDe(t.department)) || t.coordinator)) || "Sin coordinador";

  // Datos agrupados por técnico (id de Personal)
  const porTec = useMemo(() => {
    if (!datos) return null;
    const idPorNombre = new Map(); tecnicos.forEach((t) => { const k = claveNombre(t.name); idPorNombre.set(k, idPorNombre.has(k) ? null : t.id); });
    const m = new Map(); const dato = (id) => { if (!m.has(id)) m.set(id, TI.datosVacios()); return m.get(id); };
    // Histórico → garantías y servicios armados
    const filas = filasCsvDeHistorico({ rows: datos.rows, services: db.services, technicians: db.technicians, causales: db.causales, regionLabel: (r) => (regionInfo ? regionInfo.label(r) : ""), coordDe: (d) => zona.coordDe(d), empresaDe: regionInfo ? regionInfo.empresaDe : undefined });
    const regs = G.registrosDeFilas(filas, gestionDe);
    const vistos = new Set(); const emps = new Set();
    regs.forEach((r, i) => {
      emps.add(r.empresa);
      if (empresa && r.empresa !== empresa) return;
      const h = datos.rows[i];
      const id = h.technician_id || idPorNombre.get(claveNombre(h.technician_name)) || null;
      if (!id || !tecById.has(id)) return;
      dato(id).regs.push({ ...r, tecnicoId: id });
      const k = `${id}|${h.day}|${h.servicio}`;
      if (h.resultado === "Realizado" && !vistos.has(k)) { vistos.add(k); dato(id).servicios.push({ dia: h.day, servicio: h.servicio }); }
    });
    // Cierre en línea (solo personal de Biver)
    soloBiver(datos.cierres, tecnicos).filas.forEach((c) => { if (c.technician_id && tecById.has(c.technician_id)) dato(c.technician_id).cierres.push(c); });
    // Concreción de TV (si la oferta no trae técnico, el del servicio de armado)
    const tecDeServicio = {}; (db.services || []).forEach((s) => { if (s.technicianId && s.servicioExterno) tecDeServicio[String(s.servicioExterno)] = s.technicianId; });
    datos.ofertas.forEach((o) => { const id = o.tecnico_id || tecDeServicio[String(o.servicio)]; if (id && tecById.has(id)) dato(id).ofertas.push({ ...o, tecnico_id: id }); });
    // Quejas (análisis automático + lo decidido a mano)
    datos.quejas.filter((q) => !empresa || Q.plano(q.empresa) === Q.plano(empresa)).forEach((q) => { const a = Q.analizarQueja(q, datos.ctx, { tecnicos: db.technicians }); if (a.tecnico.id && tecById.has(a.tecnico.id)) dato(a.tecnico.id).quejas.push({ q, a }); });
    // CSAT: meses que tocan el rango
    const mesDesde = from.slice(0, 7), mesHasta = to.slice(0, 7);
    datos.csat.forEach((c) => { const mes = String(c.mes).slice(0, 7); if (c.technician_id && tecById.has(c.technician_id) && mes >= mesDesde && mes <= mesHasta && c.csat !== null) dato(c.technician_id).csat.push(c); });
    m.empresas = [...emps];
    return m;
  }, [datos, tecnicos, tecById, db.services, db.technicians, db.causales, regionInfo, zona.nombres, gestionDe, empresa, from, to]);

  const empresasLista = useMemo(() => { const s = new Set(["JAMAR"]); if (empresa) s.add(empresa); (datos ? datos.quejas : []).forEach((q) => q.empresa && s.add(String(q.empresa).toUpperCase())); ((porTec && porTec.empresas) || []).forEach((e) => s.add(e)); return [...s].sort(); }, [datos, porTec, empresa]);

  const filaDe = (t) => { const d = (porTec && porTec.get(t.id)) || TI.datosVacios(); return { key: t.id, nombre: nombreLindo(t.name), depto: t.department || "Sin departamento", coord: coordDe(t), estado: t.status, d, ind: TI.indicadoresDe(d, HORA_LIMITE) }; };
  const pasa = (t) => (!f.dept || (t.department || "Sin departamento") === f.dept) && (!f.coord || coordDe(t) === f.coord) && (!f.busca || nombreLindo(t.name).toUpperCase().includes(f.busca.toUpperCase()));
  const filasTec = useMemo(() => (porTec ? tecnicos.filter(pasa).map(filaDe).filter((x) => x.ind.hayDatos) : []), [porTec, tecnicos, f, zona.nombres]);
  const valorOrden = (x) => (orden.k === "alertas" ? TI.alertasDe(x.ind, metas) : orden.k === "nombre" ? x.nombre : orden.k === "armados" ? x.ind.armados : x.ind[orden.k] ? (x.ind[orden.k].valor ?? -1) : 0);
  const ordenadas = useMemo(() => [...filasTec].sort((a, b) => { const va = valorOrden(a), vb = valorOrden(b); const c = typeof va === "string" ? va.localeCompare(vb, "es") : va - vb; return (orden.dir === "asc" ? c : -c) || a.nombre.localeCompare(b.nombre, "es"); }), [filasTec, orden, metas]);

  const grupo = (clave) => {
    const m = new Map();
    filasTec.forEach((x) => { const k = clave(x) || "Sin dato"; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return [...m.entries()].map(([nombre, xs]) => ({ key: nombre, nombre, tecnicos: xs.length, ind: TI.indicadoresDe(TI.unir(xs.map((x) => x.d)), HORA_LIMITE) })).sort((a, b) => b.ind.armados - a.ind.armados);
  };
  const porDepto = useMemo(() => grupo((x) => x.depto), [filasTec]);
  const porCoord = useMemo(() => grupo((x) => x.coord), [filasTec]);
  const totales = useMemo(() => TI.indicadoresDe(TI.unir(filasTec.map((x) => x.d)), HORA_LIMITE), [filasTec]);

  const deptos = useMemo(() => [...new Set(tecnicos.map((t) => t.department || "Sin departamento"))].sort((a, b) => a.localeCompare(b, "es")), [tecnicos]);
  const coords = useMemo(() => [...new Set(tecnicos.filter((t) => !f.dept || (t.department || "Sin departamento") === f.dept).map(coordDe))].sort((a, b) => a.localeCompare(b, "es")), [tecnicos, f.dept, zona.nombres]);
  const tecSel = tecId ? tecById.get(tecId) : null;
  const fichaDatos = useMemo(() => (tecId && porTec ? porTec.get(tecId) || TI.datosVacios() : TI.datosVacios()), [tecId, porTec]);
  const fichaInd = useMemo(() => TI.indicadoresDe(fichaDatos, HORA_LIMITE), [fichaDatos]);
  const serie = useMemo(() => TI.serieDe(fichaDatos, HORA_LIMITE, gran), [fichaDatos, gran]);

  /* ----------------------------- piezas de pantalla ----------------------------- */
  const Celda = ({ ind, k, sub }) => {
    const v = ind[k].valor, s = TI.semaforo(k, v, metas);
    return (
      <td style={{ whiteSpace: "nowrap" }}>
        {v === null ? <span style={{ color: "var(--text-faint)" }}>–</span> : <><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, background: TI.COLOR_SEMAFORO[s], marginRight: 6 }} /><span className="amg-mono" style={{ fontWeight: 700 }}>{fmtPct(v, k === "quejas" ? 2 : 1)}</span></>}
        <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{sub(ind)}</div>
      </td>
    );
  };
  const SUBS = {
    cierre: (i) => (i.cierre.n ? `${i.cierre.dentro} de ${i.cierre.n} a tiempo` : "sin cierres"),
    garantias: (i) => (i.armados ? `${i.garantias.n} de ${i.armados} armados` : "sin armados"),
    concrecion: (i) => (i.concrecion.base ? `${i.concrecion.n} de ${i.concrecion.base} programadas` : "sin instalaciones"),
    quejas: (i) => `${i.quejas.n} de ${i.quejas.total} quejas · ${fmtInt(i.servicios)} servicios`,
    csat: (i) => (i.csat.n ? `${i.csat.n} mes(es)` : "sin CSAT"),
  };
  const filaIndicadores = (x, extra) => (
    <>
      {extra}<td className="amg-mono">{fmtInt(x.ind.armados)}</td>
      {TI.INDICADORES.map((i) => <Celda key={i.k} ind={x.ind} k={i.k} sub={SUBS[i.k]} />)}
      <td className="amg-mono" style={{ fontWeight: 700, color: TI.alertasDe(x.ind, metas) ? "#e0435c" : "var(--text-faint)" }}>{TI.alertasDe(x.ind, metas) || "–"}</td>
    </>
  );
  const Cab = ({ k, children }) => <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => setOrden((o) => ({ k, dir: o.k === k && o.dir === "desc" ? "asc" : "desc" }))}>{children}{orden.k === k ? (orden.dir === "desc" ? " ▼" : " ▲") : ""}</th>;
  const exportar = (nombre, lista, extraCols, extraVals) => ui.downloadCSV(`tecnico_integral_${nombre}_${from}_${to}.csv`,
    [...extraCols, "Productos armados", "Cierre en línea %", "Cierres a tiempo", "Cierres evaluados", "Garantías %", "Garantías", "Concreción TV %", "TV realizadas", "TV programadas", "Quejas que aplican %", "Quejas que aplican", "Quejas recibidas", "Servicios armados", "CSAT %", "Indicadores en rojo"],
    lista.map((x) => [...extraVals(x), x.ind.armados, ...["cierre"].map((k) => (x.ind[k].valor === null ? "" : x.ind[k].valor.toFixed(1).replace(".", ","))), x.ind.cierre.dentro, x.ind.cierre.n, x.ind.garantias.valor === null ? "" : x.ind.garantias.valor.toFixed(2).replace(".", ","), x.ind.garantias.n,
      x.ind.concrecion.valor === null ? "" : x.ind.concrecion.valor.toFixed(1).replace(".", ","), x.ind.concrecion.n, x.ind.concrecion.base, x.ind.quejas.valor === null ? "" : x.ind.quejas.valor.toFixed(2).replace(".", ","), x.ind.quejas.n, x.ind.quejas.total, x.ind.servicios,
      x.ind.csat.valor === null ? "" : x.ind.csat.valor.toFixed(1).replace(".", ","), TI.alertasDe(x.ind, metas)]));

  const Cabeceras = ({ extra }) => (
    <tr>{extra}<Cab k="armados">Armados</Cab>{TI.INDICADORES.map((i) => <Cab key={i.k} k={i.k}>{i.t}</Cab>)}<Cab k="alertas"><span title="Cantidad de indicadores en rojo frente a la meta">Alertas</span></Cab></tr>
  );

  const Mini = ({ titulo, clave, meta, color, formato = (v) => `${v}%`, dominio }) => {
    const dts = serie.map((p) => ({ p: gran === "dia" ? `${p.periodo.slice(8, 10)}/${p.periodo.slice(5, 7)}` : gran === "mes" ? `${MESES[Number(p.periodo.slice(5, 7)) - 1]} ${p.periodo.slice(2, 4)}` : p.periodo.slice(2), v: clave(p) })).filter((x) => x.v !== null && x.v !== undefined);
    return (
      <div className="amg-card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{titulo}</div>
        {dts.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 12.5, padding: "30px 0", textAlign: "center" }}>Sin datos en el periodo.</div> : (
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={dts} margin={{ left: 0, right: 10, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis dataKey="p" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formato(v)} domain={dominio || ["auto", "auto"]} />
              <Tooltip contentStyle={TIP} formatter={(v) => formato(Math.round(v * 100) / 100)} />
              {meta !== undefined && <ReferenceLine y={meta} stroke="#e0435c" strokeDasharray="5 4" />}
              <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    );
  };

  const cargando = datos === null || porTec === null;

  return (
    <div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginRight: 6 }}>Técnico integral</div>
          {PRESETS.map(([k, t]) => <button key={k} className="amg-btn" style={preset === k ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : undefined} onClick={() => aplicarPreset(k)}>{t}</button>)}
          <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => { if (!e.target.value) return; setFrom(e.target.value); setPreset(""); if (e.target.value > to) setTo(e.target.value); }} />
          <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => { if (!e.target.value) return; setTo(e.target.value); setPreset(""); if (e.target.value < from) setFrom(e.target.value); }} />
          <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={() => setVerMetas(!verMetas)}>{verMetas ? "Ocultar metas" : "Metas de referencia"}</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select className="amg-select" style={{ width: 170 }} value={f.dept} onChange={(e) => setF({ ...f, dept: e.target.value, coord: "" })}><option value="">Todos los departamentos</option>{deptos.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className="amg-select" style={{ width: 180 }} value={f.coord} onChange={(e) => setF({ ...f, coord: e.target.value })}><option value="">Todos los coordinadores</option>{coords.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <select className="amg-select" style={{ width: 160 }} value={empresa} onChange={(e) => setEmpresa(e.target.value)} title="Aplica a garantías, servicios armados y quejas. El cierre en línea, la concreción de TV y el CSAT no se separan por empresa."><option value="">Todas las empresas</option>{empresasLista.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          <input className="amg-input" style={{ width: 190 }} placeholder="Buscar técnico..." value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} />
          {(f.dept || f.coord || f.busca || empresa) && <button className="amg-btn" onClick={() => { setF({ dept: "", coord: "", busca: "" }); setEmpresa(""); }}>✕ Quitar filtros</button>}
        </div>
        {verMetas && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10, fontSize: 12.5, alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            {[["cierre", "Cierre en línea mín. %"], ["garantias", "Garantías máx. %"], ["concrecion", "Concreción TV mín. %"], ["quejas", "Quejas que aplican máx. %"], ["csat", "CSAT mín. %"]].map(([k, t]) => (
              <label key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>{t} <input type="number" min={0} step={k === "quejas" || k === "garantias" ? 0.1 : 1} className="amg-input" style={{ width: 80 }} value={metas[k]} onChange={(e) => cambiarMeta(k, Math.max(0, Number(e.target.value) || 0))} /></label>
            ))}
            <button className="amg-btn ghost" onClick={() => { setMetas({ ...TI.METAS_DEFECTO }); try { localStorage.removeItem(CLAVE_METAS); } catch (e) { /* nada */ } }}>Restablecer</button>
            <span style={{ color: "var(--text-faint)" }}>Solo colorean: verde cumple, naranja cerca (5 puntos o 1,5 veces la meta), rojo fuera. Se guardan en este navegador.</span>
          </div>
        )}
        {datos && datos.avisos.length > 0 && datos.avisos.map((a, i) => <div key={i} className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> No se pudo leer {a}</div>)}
      </div>

      {cargando && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Reuniendo los indicadores (histórico, cierre en línea, TV, quejas y CSAT)...</div>}

      {!cargando && (
        <>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>{TABS.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}</button>)}</div>

          {tab !== "ficha" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px,1fr))", gap: 10, marginBottom: 12 }}>
              {TI.INDICADORES.map((i) => { const v = totales[i.k].valor, s = TI.semaforo(i.k, v, metas); return <ui.StatCard key={i.k} label={`${i.t} (total)`} value={<span style={{ color: s ? TI.COLOR_SEMAFORO[s] : undefined }}>{fmtPct(v, i.k === "quejas" ? 2 : 1)}</span>} sub={SUBS[i.k](totales)} />; })}
              <ui.StatCard label="Técnicos con datos" value={fmtInt(filasTec.length)} sub={`${fmtInt(totales.armados)} productos armados`} />
            </div>
          )}

          {tab === "tablero" && (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{ordenadas.length} técnico(s). Pulsa el nombre para abrir su ficha; pulsa una columna para ordenar.</span>
                <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!ordenadas.length} onClick={() => exportar("tecnicos", ordenadas, ["Técnico", "Departamento", "Coordinador"], (x) => [x.nombre, x.depto, x.coord])}>Exportar CSV</button>
              </div>
              <div className="amg-card" style={{ overflow: "auto", maxHeight: 640 }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><Cabeceras extra={<><Cab k="nombre">Técnico</Cab><th>Departamento</th><th>Coordinador</th></>} /></thead>
                  <tbody>
                    {ordenadas.map((x) => (
                      <tr key={x.key} style={{ opacity: x.estado && x.estado !== "Activo" ? 0.6 : 1 }}>
                        {filaIndicadores(x, <><td><button className="amg-btn ghost" style={{ padding: 0, fontWeight: 600 }} onClick={() => { setTecId(x.key); setTab("ficha"); }}>{x.nombre}</button>{x.estado && x.estado !== "Activo" && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-faint)" }}>({x.estado})</span>}</td><td>{x.depto}</td><td>{x.coord}</td></>)}
                      </tr>
                    ))}
                    {ordenadas.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay técnicos con datos en este rango y filtros.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {(tab === "departamento" || tab === "coordinador") && (() => {
            const lista = tab === "departamento" ? porDepto : porCoord, titulo = tab === "departamento" ? "Departamento" : "Coordinador";
            return (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Cada fila reúne los registros de todos sus técnicos. Pulsa el nombre para ver sus técnicos en el tablero.</span>
                  <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!lista.length} onClick={() => exportar(tab === "departamento" ? "departamentos" : "coordinadores", lista, [titulo, "Técnicos"], (x) => [x.nombre, x.tecnicos])}>Exportar CSV</button>
                </div>
                <div className="amg-card" style={{ overflow: "auto" }}>
                  <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                    <thead><Cabeceras extra={<><th>{titulo}</th><th>Técnicos</th></>} /></thead>
                    <tbody>
                      {lista.map((x) => <tr key={x.key}>{filaIndicadores(x, <><td><button className="amg-btn ghost" style={{ padding: 0, fontWeight: 600 }} onClick={() => { setF(tab === "departamento" ? { ...f, dept: x.nombre, coord: "" } : { ...f, coord: x.nombre }); setTab("tablero"); }}>{x.nombre}</button></td><td className="amg-mono">{x.tecnicos}</td></>)}</tr>)}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}

          {tab === "ficha" && (
            <>
              <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select className="amg-select" style={{ width: 280 }} value={tecId} onChange={(e) => setTecId(e.target.value)}>
                  <option value="">Elige un técnico...</option>
                  {[...tecnicos].sort((a, b) => a.name.localeCompare(b.name, "es")).filter((t) => (porTec.get(t.id) && TI.indicadoresDe(porTec.get(t.id), HORA_LIMITE).hayDatos) || t.id === tecId).map((t) => <option key={t.id} value={t.id}>{nombreLindo(t.name)} · {t.department || "sin depto"}</option>)}
                </select>
                {tecSel && <span style={{ fontSize: 13 }}><b>{nombreLindo(tecSel.name)}</b> · {tecSel.department || "sin departamento"} · coordinador: {coordDe(tecSel)} · {tecSel.status}</span>}
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>{[["dia", "Por día"], ["semana", "Por semana"], ["mes", "Por mes"]].map(([k, t]) => <button key={k} className={`amg-btn ${gran === k ? "primary" : ""}`} onClick={() => setGran(k)}>{t}</button>)}</div>
              </div>
              {!tecSel && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Elige un técnico (o pulsa su nombre en el tablero) para ver todos sus indicadores y su tendencia.</div>}
              {tecSel && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 10, marginBottom: 14 }}>
                    {TI.INDICADORES.map((i) => { const v = fichaInd[i.k].valor, s = TI.semaforo(i.k, v, metas); return (
                      <div key={i.k} className="amg-card" style={{ padding: "12px 14px", borderTop: `4px solid ${s ? TI.COLOR_SEMAFORO[s] : "var(--border)"}` }}>
                        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{i.t}</div>
                        <div style={{ fontSize: 26, fontWeight: 700, color: s ? TI.COLOR_SEMAFORO[s] : "var(--text-faint)" }}>{fmtPct(v, i.k === "quejas" ? 2 : 1)}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{SUBS[i.k](fichaInd)} · meta {i.mejor === "alto" ? "≥" : "≤"} {metas[i.k]}%</div>
                      </div>); })}
                    <ui.StatCard label="Productos armados" value={fmtInt(fichaInd.armados)} sub={`${fmtInt(fichaInd.servicios)} servicios`} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12, marginBottom: 14 }}>
                    <Mini titulo="Cierre en línea (% a tiempo)" clave={(p) => p.cierre.valor} meta={metas.cierre} color="#2f6fed" dominio={[0, 100]} />
                    <Mini titulo="Garantías (% sobre armados)" clave={(p) => p.garantias.valor} meta={metas.garantias} color="#ff9540" dominio={[0, "auto"]} />
                    <Mini titulo="Concreción de TV (% realizadas)" clave={(p) => p.concrecion.valor} meta={metas.concrecion} color="#12a166" dominio={[0, 100]} />
                    <Mini titulo="Quejas que aplican (% sobre servicios)" clave={(p) => p.quejas.valor} meta={metas.quejas} color="#e0435c" dominio={[0, "auto"]} />
                    <Mini titulo="CSAT (mensual)" clave={(p) => p.csat.valor} meta={metas.csat} color="#7b5cff" dominio={[0, 100]} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 14 }}>
                    <div className="amg-card" style={{ overflow: "auto", maxHeight: 360 }}>
                      <div style={{ padding: "10px 12px 0", fontWeight: 600, fontSize: 13 }}>Quejas del periodo ({fichaDatos.quejas.length})</div>
                      <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                        <thead><tr><th>Fecha</th><th>Caso / servicio</th><th>Aplica</th><th>Motivo</th></tr></thead>
                        <tbody>
                          {fichaDatos.quejas.map(({ q, a }) => <tr key={q.id}><td className="amg-mono">{fechaCorta(q.fecha)}</td><td className="amg-mono">{q.caso}<div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{q.servicio}</div></td><td>{a.aplica === "si" ? "Aplica" : a.aplica === "no" ? "No aplica" : "Por revisar"}</td><td style={{ maxWidth: 300 }}>{a.motivo}</td></tr>)}
                          {fichaDatos.quejas.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-faint)", padding: 14 }}>Sin quejas en el periodo.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    <div className="amg-card" style={{ overflow: "auto", maxHeight: 360 }}>
                      <div style={{ padding: "10px 12px 0", fontWeight: 600, fontSize: 13 }}>Productos con garantía ({fichaDatos.regs.filter((r) => r.garantia).length})</div>
                      <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                        <thead><tr><th>Fecha</th><th>Servicio</th><th>Producto</th><th>Notas</th></tr></thead>
                        <tbody>
                          {fichaDatos.regs.filter((r) => r.garantia).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map((r, i) => <tr key={i}><td className="amg-mono">{fechaCorta(r.fecha)}</td><td className="amg-mono">{r.servicio}</td><td>{r.producto}</td><td style={{ maxWidth: 240 }}>{r.notas || "–"}</td></tr>)}
                          {fichaDatos.regs.filter((r) => r.garantia).length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-faint)", padding: 14 }}>Sin garantías en el periodo.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.5 }}>
            <b>Cierre en línea</b>: productos con hora fin de trabajo antes de las {HORA_LIMITE}:00 ÷ productos con hora (reporte de Extreme, solo personal de Biver). <b>Garantías</b>: productos con garantía ÷ productos armados (histórico). <b>Concreción TV</b>: instalaciones realizadas ÷ programadas con el técnico.
            {" "}<b>Quejas</b>: las que aplican al técnico (las «por revisar» no cuentan) ÷ servicios que armó. <b>CSAT</b>: promedio de los meses del rango en el informe mensual. Alertas = indicadores en rojo frente a las metas de referencia.
          </div>
        </>
      )}
    </div>
  );
}
