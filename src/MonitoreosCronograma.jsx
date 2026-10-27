import { useState, useEffect, useMemo } from "react";
import { Check, AlertTriangle, Plus, Download, RotateCcw, ChevronLeft, ChevronRight, Ban, Eye } from "lucide-react";
import * as M from "./lib/monitoreos/monData";
import * as C from "./lib/monitoreos/cronogramaData";
import { useZonaCoord, SIN_COORD } from "./lib/useCoordinadores";

/* ============================================================================
   CRONOGRAMA DE MONITOREOS (mensual)
   El sistema calcula qué técnicos requieren monitoreo en el mes y cuántos, según su antigüedad, su cargo y su resultado en los monitoreos del mes anterior, y
   reparte esos monitoreos entre los auditores configurados en Maestros (cada uno con su cuota mensual) a lo largo de los días hábiles. Todo se puede editar:
   fecha, auditor, técnico y canal de cada monitoreo, agregar uno a mano o cancelarlo. Si el monitoreo ya se hizo se deduce de los monitoreos registrados.
============================================================================ */

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };
const COLOR_NIVEL = { Alta: "red", Media: "amber", Baja: "green" };
const COLOR_ESTADO = { Realizado: "green", Pendiente: "gray", Vencido: "red" };

export default function MonitoreosCronograma({ db, session, persist, addAudit, ui, onRegistrar }) {
  const canEdit = session.role === "admin" || session.role === "operador";
  const hoy = ui.todayISO();
  const [mes, setMes] = useState(hoy.slice(0, 7));
  const [cron, setCron] = useState(null);
  const [monCfg, setMonCfg] = useState(null);
  const [entradas, setEntradas] = useState([]);
  const [recPrev, setRecPrev] = useState([]);
  const [recMes, setRecMes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState("calendario");
  const [f, setF] = useState({ auditor: "", depto: "", coord: "", estado: "", q: "" });
  const [manual, setManual] = useState(null);
  const [busy, setBusy] = useState(false);
  const zona = useZonaCoord(db, true);

  const cargar = async () => {
    setLoading(true); setError("");
    try {
      const prev = C.rangoMes(C.mesAnterior(mes)), actual = C.rangoMes(mes);
      const [c, m, e, r] = await Promise.all([C.loadCronConfig(), M.loadMonConfig(), C.listSchedule(mes), M.listRecords({ desde: prev.desde, hasta: actual.hasta })]);
      setCron(c); setMonCfg(m); setEntradas(e);
      setRecPrev(r.filter((x) => x.audit_date <= prev.hasta)); setRecMes(r.filter((x) => x.audit_date >= actual.desde));
    } catch (e) { setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL del cronograma de monitoreos (sql/37).`); if (!cron) { setCron(JSON.parse(JSON.stringify(C.CRON_DEFAULT))); setMonCfg(M.configInicial()); } }
    setLoading(false);
  };
  useEffect(() => { cargar(); }, [mes]);

  const nombreDe = (id) => (db.technicians.find((t) => t.id === id) || {}).name || "-";
  const tecById = useMemo(() => Object.fromEntries(db.technicians.map((t) => [t.id, t])), [db.technicians]);

  const dias = useMemo(() => C.diasHabiles(mes, (cron && cron.params.diasNoHabiles) || []), [mes, cron]);
  const analisis = useMemo(() => (cron && monCfg ? C.analizarTecnicos({ mes, tecnicos: db.technicians, recordsPrev: recPrev, monCfg, cron }) : []), [mes, db.technicians, recPrev, monCfg, cron]);
  const capacidad = cron ? cron.auditores.filter((a) => a.activo !== false).reduce((s, a) => s + (Number(a.monitoreosMes) || 0), 0) : 0;
  const propuesta = useMemo(() => (cron ? C.repartirCantidades(analisis, capacidad, cron.params) : []), [analisis, capacidad, cron]);

  const vivas = useMemo(() => entradas.filter((e) => e.status !== "Cancelado"), [entradas]);
  const estados = useMemo(() => C.estadoEntradas(entradas, recMes, hoy), [entradas, recMes, hoy]);
  const nRealizados = vivas.filter((e) => (estados.get(e.id) || {}).estado === "Realizado").length;
  const nVencidos = vivas.filter((e) => (estados.get(e.id) || {}).estado === "Vencido").length;
  const nPendientes = vivas.length - nRealizados - nVencidos;
  const sinCronograma = vivas.length === 0;

  const progPorTec = useMemo(() => { const m = new Map(); vivas.forEach((e) => m.set(e.technician_id, (m.get(e.technician_id) || 0) + 1)); return m; }, [vivas]);
  const realPorTec = useMemo(() => { const m = new Map(); vivas.forEach((e) => { if ((estados.get(e.id) || {}).estado === "Realizado") m.set(e.technician_id, (m.get(e.technician_id) || 0) + 1); }); return m; }, [vivas, estados]);

  const audit = (accion, detalle) => persist(addAudit(db, { userId: session.id, action: accion, record: mes, oldValue: "-", newValue: detalle }));

  // Calcula y guarda el cronograma. Si ya había uno, lo que no se ha hecho se cancela y se reprograma (lo ya realizado se conserva).
  const generar = async () => {
    if (!cron || !cron.auditores.some((a) => a.activo !== false && Number(a.monitoreosMes) > 0)) { setError("Primero configura los auditores y sus monitoreos al mes en Maestros → Monitoreos → Cronograma y auditores."); return; }
    const restantes = dias.filter((d) => d >= hoy);
    if (!restantes.length) { setError("Ya no quedan días hábiles en este mes para programar."); return; }
    if (!sinCronograma && !window.confirm("Ya hay un cronograma para este mes. Se cancelan los monitoreos que no se han hecho y se vuelven a calcular y programar (los realizados se conservan). ¿Continuar?")) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const pendientesViejos = vivas.filter((e) => (estados.get(e.id) || {}).estado !== "Realizado").map((e) => e.id);
      if (pendientesViejos.length) await C.cancelEntries(pendientesViejos, "Recalculado");
      const faltan = propuesta.map((p) => ({ ...p, cantidad: Math.max(0, p.cantidad - (realPorTec.get(p.tecnico.id) || 0)) }));
      const nuevas = C.programar({ filas: faltan, auditores: cron.auditores, dias: restantes, canal: cron.params.canalDefecto }).map((e) => ({ ...e, month: mes }));
      if (nuevas.length) await C.insertEntries(nuevas);
      await audit("Cálculo del cronograma de monitoreos", `${nuevas.length} monitoreos programados para ${C.nombreMes(mes)}`);
      setMsg(`Cronograma de ${C.nombreMes(mes)} calculado: ${nuevas.length} monitoreos programados.${nuevas.length < faltan.reduce((s, x) => s + x.cantidad, 0) ? " Algunos no entraron por falta de capacidad diaria." : ""}`);
      await cargar();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const cambiar = async (e, patch) => {
    setError("");
    try { const n = await C.updateEntry(e.id, patch); setEntradas((l) => l.map((x) => (x.id === e.id ? n : x))); } catch (er) { setError(er.message); }
  };
  const cancelar = async (e) => {
    if (!window.confirm(`Se cancela el monitoreo programado de ${nombreDe(e.technician_id)} del ${ui.fmtDate(e.planned_date)}. No se borra. ¿Continuar?`)) return;
    try { await C.cancelEntries([e.id], "Cancelado manualmente"); setEntradas((l) => l.map((x) => (x.id === e.id ? { ...x, status: "Cancelado" } : x))); } catch (er) { setError(er.message); }
  };
  const agregar = async (v) => {
    setError("");
    try {
      const t = tecById[v.technician_id];
      const fila = analisis.find((a) => a.tecnico.id === v.technician_id);
      const [n] = await C.insertEntries([{ month: mes, planned_date: v.planned_date, auditor_person_id: v.auditor_person_id || null, technician_id: v.technician_id, channel: v.channel, origin: "Manual", score: fila ? fila.score : null, level: fila ? fila.nivel : null }]);
      setEntradas((l) => [...l, n]); setManual(null); setMsg(`Monitoreo agregado: ${t ? t.name : ""} el ${ui.fmtDate(v.planned_date)}.`);
    } catch (er) { setError(er.message); }
  };

  const deptos = useMemo(() => [...new Set(db.technicians.map((t) => t.department).filter(Boolean))].sort(), [db.technicians]);
  const filasCal = useMemo(() => vivas.map((e) => ({ e, t: tecById[e.technician_id] || {}, est: estados.get(e.id) || { estado: "Pendiente" } }))
    .filter(({ e, t, est }) => (!f.auditor || e.auditor_person_id === f.auditor) && zona.pasa(t.department, f.depto, f.coord) && (!f.estado || est.estado === f.estado)
      && (!f.q.trim() || (t.name || "").toLowerCase().includes(f.q.trim().toLowerCase()))), [vivas, tecById, estados, f, zona.nombres]);
  const filasTec = useMemo(() => propuesta.map((p) => ({ ...p, prog: progPorTec.get(p.tecnico.id) || 0, real: realPorTec.get(p.tecnico.id) || 0 }))
    .filter((p) => zona.pasa(p.tecnico.department, f.depto, f.coord) && (!f.q.trim() || p.tecnico.name.toLowerCase().includes(f.q.trim().toLowerCase()))), [propuesta, progPorTec, realPorTec, f, zona.nombres]);

  const exportar = () => ui.downloadCSV(`cronograma_monitoreos_${mes}.csv`, ["Fecha", "Día", "Auditor", "Técnico", "Departamento", "Coordinador", "Canal", "Prioridad", "Estado", "Monitoreo registrado"],
    filasCal.map(({ e, t, est }) => [ui.fmtDate(e.planned_date), C.diaSemana(e.planned_date), nombreDe(e.auditor_person_id), t.name || "", t.department || "", zona.coordDe(t.department) || "", M.NOMBRE_CANAL[e.channel], e.level || "", est.estado, est.record ? est.record.record_no : ""]));

  if (!cron || !monCfg) return <div style={{ color: "var(--text-faint)" }}>{error ? <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div> : "Cargando..."}</div>;

  const cumpl = vivas.length ? (nRealizados / vivas.length) * 100 : 0;
  const sinAuditores = !cron.auditores.some((a) => a.activo !== false && Number(a.monitoreosMes) > 0);

  return (
    <div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {sinAuditores && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> No hay auditores configurados. En Maestros → Monitoreos → "Cronograma y auditores" elige a las personas administrativas que harán los monitoreos y cuántos hacen al mes.</div>}

      <div className="amg-card" style={{ padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button className="amg-btn" onClick={() => setMes(C.mesAnterior(mes))}><ChevronLeft size={14} /></button>
        <div style={{ fontWeight: 700, minWidth: 140, textAlign: "center", textTransform: "capitalize" }}>{C.nombreMes(mes)}</div>
        <button className="amg-btn" onClick={() => setMes(C.mesSiguiente(mes))}><ChevronRight size={14} /></button>
        <button className="amg-btn" onClick={() => setMes(hoy.slice(0, 7))}>Este mes</button>
        <button className="amg-btn" onClick={() => setMes(C.mesSiguiente(hoy.slice(0, 7)))}>Mes siguiente</button>
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{dias.length} días hábiles</span>
        <button className="amg-btn" onClick={cargar} disabled={loading}><RotateCcw size={13} /> {loading ? "Actualizando..." : "Actualizar"}</button>
        {canEdit && <button className="amg-btn primary" style={{ marginLeft: "auto" }} disabled={busy || sinAuditores} onClick={generar}>{busy ? "Calculando..." : sinCronograma ? "Calcular cronograma del mes" : "Recalcular cronograma"}</button>}
        {canEdit && <button className="amg-btn" onClick={() => setManual({ technician_id: "", planned_date: dias.find((d) => d >= hoy) || dias[0] || `${mes}-01`, auditor_person_id: "", channel: cron.params.canalDefecto })}><Plus size={14} /> Agregar monitoreo</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Técnicos a monitorear" value={propuesta.filter((p) => p.cantidad > 0).length} sub={`de ${analisis.length} técnicos activos`} accent />
        <ui.StatCard label="Capacidad del mes" value={capacidad} sub={`${cron.auditores.filter((a) => a.activo !== false).length} auditor(es)`} />
        <ui.StatCard label="Programados" value={vivas.length} sub={sinCronograma ? "aún sin calcular" : `${propuesta.reduce((s, p) => s + p.cantidad, 0)} propuestos`} />
        <ui.StatCard label="Realizados" value={nRealizados} sub={vivas.length ? M.fmtPct(cumpl) : ""} />
        <ui.StatCard label="Pendientes" value={nPendientes} />
        <ui.StatCard label="Vencidos" value={nVencidos} sub="fecha pasada sin monitoreo" />
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 12 }}>
        <div className={`amg-tab ${tab === "calendario" ? "active" : ""}`} onClick={() => setTab("calendario")}>Calendario de monitoreos</div>
        <div className={`amg-tab ${tab === "tecnicos" ? "active" : ""}`} onClick={() => setTab("tecnicos")}>Técnicos que requieren monitoreo</div>
      </div>

      <div className="amg-card" style={{ padding: 10, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input className="amg-input" style={{ width: 200 }} placeholder="Buscar técnico..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        {tab === "calendario" && <select className="amg-select" style={{ width: 190 }} value={f.auditor} onChange={(e) => setF({ ...f, auditor: e.target.value })}><option value="">Todos los auditores</option>{cron.auditores.map((a) => <option key={a.personId} value={a.personId}>{nombreDe(a.personId)}</option>)}</select>}
        <select className="amg-select" style={{ width: 170 }} value={f.depto} onChange={(e) => setF({ ...f, depto: e.target.value })}><option value="">Todos los departamentos</option>{deptos.map((d) => <option key={d}>{d}</option>)}</select>
        <select className="amg-select" style={{ width: 190 }} value={f.coord} onChange={(e) => setF({ ...f, coord: e.target.value })}><option value="">Todos los coordinadores</option>{zona.nombres.map((n) => <option key={n} value={n}>{n}</option>)}<option value={SIN_COORD}>Sin coordinador</option></select>
        {tab === "calendario" && <select className="amg-select" style={{ width: 150 }} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todos los estados</option><option>Pendiente</option><option>Realizado</option><option>Vencido</option></select>}
        {tab === "calendario" && <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={exportar} disabled={!filasCal.length}><Download size={14} /> Exportar CSV</button>}
      </div>

      {tab === "calendario" && (
        <div className="amg-card" style={{ overflow: "auto", maxHeight: "calc(100vh - 460px)" }}>
          <table className="amg-table compact">
            <thead><tr><th>Fecha</th><th>Día</th><th>Auditor</th><th>Técnico</th><th>Canal</th><th>Prioridad</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {filasCal.map(({ e, t, est }) => (
                <tr key={e.id}>
                  <td><input type="date" className="amg-input" style={{ width: 138 }} disabled={!canEdit || est.estado === "Realizado"} value={e.planned_date} onChange={(ev) => ev.target.value && cambiar(e, { planned_date: ev.target.value })} /></td>
                  <td style={{ textTransform: "capitalize", fontSize: 12 }}>{C.diaSemana(e.planned_date)}</td>
                  <td><select className="amg-select" style={{ width: 170 }} disabled={!canEdit || est.estado === "Realizado"} value={e.auditor_person_id || ""} onChange={(ev) => cambiar(e, { auditor_person_id: ev.target.value || null })}><option value="">Sin auditor</option>{cron.auditores.map((a) => <option key={a.personId} value={a.personId}>{nombreDe(a.personId)}</option>)}</select></td>
                  <td>{t.name}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{t.department || ""}{zona.coordDe(t.department) ? ` · ${zona.coordDe(t.department)}` : ""}</div></td>
                  <td><select className="amg-select" style={{ width: 130 }} disabled={!canEdit || est.estado === "Realizado"} value={e.channel} onChange={(ev) => cambiar(e, { channel: ev.target.value })}>{M.CANALES.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                  <td>{e.level ? <ui.Badge text={e.level} color={COLOR_NIVEL[e.level]} /> : <span style={{ color: "var(--text-faint)" }}>manual</span>}</td>
                  <td><ui.Badge text={est.estado} color={COLOR_ESTADO[est.estado]} />{est.record && <div className="amg-mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{est.record.record_no} · {M.fmtPct(est.record.score)}</div>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canEdit && est.estado !== "Realizado" && <button className="amg-btn ghost" style={{ padding: "2px 8px", fontSize: 12 }} title="Abre el formulario de monitoreo con este técnico" onClick={() => onRegistrar(e.channel, e.technician_id, e.auditor_person_id)}><Eye size={12} /> Registrar</button>}
                    {canEdit && est.estado !== "Realizado" && <button className="amg-btn ghost" style={{ padding: 4 }} title="Cancelar (no se borra)" onClick={() => cancelar(e)}><Ban size={13} color="var(--red)" /></button>}
                  </td>
                </tr>
              ))}
              {!loading && filasCal.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{sinCronograma ? `Aún no hay cronograma para ${C.nombreMes(mes)}. Pulsa "Calcular cronograma del mes".` : "Ningún monitoreo coincide con los filtros."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "tecnicos" && (
        <div className="amg-card" style={{ overflow: "auto", maxHeight: "calc(100vh - 460px)" }}>
          <table className="amg-table compact">
            <thead><tr><th>Técnico</th><th>Cargo</th><th>Antigüedad</th><th>Mes anterior</th><th>Prioridad</th><th>Propuestos</th><th>Programados</th><th>Realizados</th><th>Faltan</th></tr></thead>
            <tbody>
              {filasTec.map((p) => (
                <tr key={p.tecnico.id}>
                  <td>{p.tecnico.name}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{p.tecnico.department || ""}{zona.coordDe(p.tecnico.department) ? ` · ${zona.coordDe(p.tecnico.department)}` : ""}</div></td>
                  <td>{C.NOMBRE_CARGO[p.cargo]}</td>
                  <td>{C.NOMBRE_ANTIG[p.antig]}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{p.meses === null ? "sin fecha de ingreso" : `${p.meses} mes(es)`}</div></td>
                  <td>{p.promPrev === null ? <span style={{ color: "var(--text-faint)" }}>sin monitoreo</span> : <><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 9, background: M.colorSemaforo(monCfg, p.semPrev) }} /><b className="amg-mono">{M.fmtPct(p.promPrev)}</b></span>{p.critPrev && <div style={{ fontSize: 10.5, color: "var(--red)" }}>error crítico</div>}<div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{p.nMonPrev} monitoreo(s)</div></>}</td>
                  <td><ui.Badge text={p.nivel} color={COLOR_NIVEL[p.nivel]} /> <span className="amg-mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{p.score.toFixed(2)}</span></td>
                  <td className="amg-mono"><b>{p.cantidad}</b></td>
                  <td className="amg-mono">{p.prog}</td><td className="amg-mono">{p.real}</td>
                  <td className="amg-mono" style={{ color: p.prog - p.real > 0 ? "var(--accent)" : undefined }}>{Math.max(0, (sinCronograma ? p.cantidad : p.prog) - p.real)}</td>
                </tr>
              ))}
              {!loading && filasTec.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay técnicos activos para calcular.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-faint)" }}>
        La prioridad combina antigüedad, cargo y resultado del mes anterior (los pesos y puntos se ajustan en Maestros → Monitoreos → Cronograma y auditores). Los monitoreos propuestos salen de repartir la capacidad de los auditores entre los técnicos según su prioridad.
        Un monitoreo programado pasa a "Realizado" cuando se registra un monitoreo de ese técnico en el mes; si la fecha pasó y no se ha hecho, queda "Vencido".
      </div>

      {manual && <ManualModal ui={ui} v={manual} setV={setManual} cron={cron} tecnicos={db.technicians.filter((t) => (t.category || "") !== "Administrativo" && t.status === "Activo").sort((a, b) => a.name.localeCompare(b.name, "es"))} nombreDe={nombreDe} onSave={agregar} onClose={() => setManual(null)} />}
    </div>
  );
}

function ManualModal({ ui, v, setV, cron, tecnicos, nombreDe, onSave, onClose }) {
  return (
    <ui.Modal title="Agregar monitoreo al cronograma" onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!v.technician_id || !v.planned_date} onClick={() => onSave(v)}>Agregar</button></>}>
      <div style={{ display: "grid", gap: 10 }}>
        <div><label className="amg-label">Técnico *</label><ui.SearchSelect options={tecnicos.map((t) => ({ value: t.id, label: t.name, sublabel: t.department || "" }))} value={v.technician_id} onChange={(x) => setV({ ...v, technician_id: x })} placeholder="Buscar técnico..." /></div>
        <div><label className="amg-label">Fecha *</label><input type="date" className="amg-input" value={v.planned_date} onChange={(e) => setV({ ...v, planned_date: e.target.value })} /></div>
        <div><label className="amg-label">Auditor</label><select className="amg-select" value={v.auditor_person_id} onChange={(e) => setV({ ...v, auditor_person_id: e.target.value })}><option value="">Sin auditor</option>{cron.auditores.map((a) => <option key={a.personId} value={a.personId}>{nombreDe(a.personId)}</option>)}</select></div>
        <div><label className="amg-label">Canal</label><select className="amg-select" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>{M.CANALES.map((c) => <option key={c} value={c}>{M.NOMBRE_CANAL[c]}</option>)}</select></div>
      </div>
    </ui.Modal>
  );
}
