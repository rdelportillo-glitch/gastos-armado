import { useState, useEffect, useMemo } from "react";
import { Upload, Check, AlertTriangle, Download, RotateCcw, Lock, Unlock, Save } from "lucide-react";
import * as D from "./lib/asignacion/data";
import * as E from "./lib/asignacion/engine";
import * as maestrosApi from "./lib/maestrosApi";
import { regionsOfPlan, buildRegionPdf, buildSummaryWorkbook, downloadBlob, downloadWorkbook } from "./lib/asignacion/outputs";

/* ============================================================================
   ASIGNACIÓN DE SERVICIOS
   Pasos: 1 Carga del día · 2 Técnicos del día · 3 Asignación · 4 Criterios.
   El plan en pantalla se conserva mientras no se recargue la página (es un borrador);
   lo que queda guardado son los servicios en Carga (Pendiente / En gestión).
============================================================================ */

const draft = { step: "carga", fecha: null, excluded: new Set(), plan: null, locks: {}, desde: null, incluirAsignados: false, techNames: [] };

const fmt = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? "–" : Number(n).toLocaleString("es-CO"));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };

export default function AsignacionModule({ db, persist, addAudit, session, ui }) {
  const canEdit = session.role === "admin" || session.role === "operador";
  const isAdmin = session.role === "admin";
  const [step, setStepRaw] = useState(draft.step);
  const [fecha, setFechaRaw] = useState(draft.fecha || ui.todayISO());
  const [desde, setDesdeRaw] = useState(draft.desde || addDays(draft.fecha || ui.todayISO(), -7));
  const [incluirAsignados, setIncluirAsignadosRaw] = useState(draft.incluirAsignados);
  const [excluded, setExcludedRaw] = useState(draft.excluded);
  const [masters, setMasters] = useState({ status: "loading" });
  const [rules, setRules] = useState(null);
  const [availability, setAvailability] = useState({});
  const [availDirty, setAvailDirty] = useState(false);

  const setStep = (s) => { draft.step = s; setStepRaw(s); };
  const setFecha = (f) => { draft.fecha = f; setFechaRaw(f); setDesdeRaw(addDays(f, -7)); draft.desde = addDays(f, -7); };
  const setDesde = (v) => { draft.desde = v; setDesdeRaw(v); };
  const setIncluirAsignados = (v) => { draft.incluirAsignados = v; setIncluirAsignadosRaw(v); };
  const setExcluded = (s) => { draft.excluded = s; setExcludedRaw(s); };

  const loadMasters = () => {
    setMasters({ status: "loading" });
    D.loadMasters().then((m) => setMasters({ status: "ready", ...m })).catch((e) => setMasters({ status: "error", error: e.message }));
  };
  useEffect(() => { loadMasters(); D.loadRules().then(setRules).catch(() => setRules(D.DEFAULT_RULES)); }, []);
  useEffect(() => { D.loadAvailability(fecha).then((a) => { setAvailability(a); setAvailDirty(false); }).catch(() => {}); }, [fecha]);

  const techs = useMemo(() => (masters.status === "ready" ? D.engineTechs(db.technicians, availability, masters.abbreviations, masters) : []), [db.technicians, availability, masters]);
  const regionName = useMemo(() => {
    const m = {};
    (masters.abbreviations || []).filter((a) => a.level === "MUNICIPIO").forEach((a) => { m[a.region_id] = a.name; });
    return m;
  }, [masters]);

  const pool = useMemo(() => D.poolServices(db.services, { fecha, desde, incluirAsignados }), [db.services, fecha, desde, incluirAsignados]);
  const selectedPool = useMemo(() => pool.filter((s) => !excluded.has(s.servicioExterno)), [pool, excluded]);

  const ctx = { db, persist, addAudit, session, ui, canEdit, isAdmin, masters, rules, setRules, fecha, setFecha, desde, setDesde, incluirAsignados, setIncluirAsignados, excluded, setExcluded, techs, regionName, availability, setAvailability, availDirty, setAvailDirty, pool, selectedPool, reloadMasters: loadMasters };

  const STEPS = [{ key: "carga", label: "1 · Carga del día" }, { key: "tecnicos", label: "2 · Técnicos" }, { key: "asignacion", label: "3 · Asignación" }, { key: "criterios", label: "Criterios" }];
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {STEPS.map((s) => <div key={s.key} className={`amg-tab ${step === s.key ? "active" : ""}`} onClick={() => setStep(s.key)}>{s.label}</div>)}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, paddingBottom: 6 }}>
          <label className="amg-label" style={{ margin: 0 }}>Fecha a programar</label>
          <input type="date" className="amg-input" style={{ width: 150 }} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        </div>
      </div>

      {masters.status === "loading" && <div className="amg-alert" style={{ background: "var(--panel-2)" }}>Cargando maestros de zonas, barrios y productos...</div>}
      {masters.status === "error" && (
        <div className="amg-alert danger"><AlertTriangle size={14} /> No se pudieron cargar los maestros: {masters.error}. Verifica que corriste el SQL de Asignación en Supabase y que importaste los maestros.
          <button className="amg-btn" style={{ marginLeft: 10 }} onClick={loadMasters}>Reintentar</button></div>
      )}
      {masters.status === "ready" && (masters.counts.zonas === 0 || masters.counts.productos === 0) && (
        <div className="amg-alert danger"><AlertTriangle size={14} /> Los maestros están vacíos ({fmt(masters.counts.zonas)} zonas, {fmt(masters.counts.productos)} productos). Impórtalos en Administración → Maestros.</div>
      )}

      {masters.status === "ready" && rules && (
        <>
          {step === "carga" && <StepCarga {...ctx} />}
          {step === "tecnicos" && <StepTecnicos {...ctx} />}
          {step === "asignacion" && <StepAsignacion {...ctx} />}
          {step === "criterios" && <StepCriterios {...ctx} />}
        </>
      )}
    </div>
  );
}

/* ----------------------------- 1 · Carga del día ----------------------------- */

function StepCarga({ db, persist, addAudit, session, ui, canEdit, isAdmin, masters, fecha, setFecha, desde, setDesde, incluirAsignados, setIncluirAsignados, excluded, setExcluded, pool, reloadMasters }) {
  const [byKind, setByKind] = useState({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const rows = useMemo(() => [...(byKind.jamar || []), ...(byKind.tugo || [])], [byKind]);
  const val = useMemo(() => (rows.length ? D.validateRows(rows) : null), [rows, tick]);

  const onFile = async (kind, file) => {
    if (!file) return;
    setError(""); setMsg("");
    try {
      const parsed = D.parseBaseFile(await file.arrayBuffer(), kind, masters);
      setByKind((b) => ({ ...b, [kind]: parsed }));
      const f = parsed.find((r) => r.fecha)?.fecha;
      if (f) setFecha(f);
    } catch (e) { setError(e.message); }
  };

  const fixTime = (key, minutes) => {
    const n = Math.round(Number(minutes));
    if (!n || n <= 0) return;
    rows.forEach((r) => { if ((r.codigo || r.producto) === key) { r.tiempo = n; r.tiempoFuente = "MANUAL"; } });
    setTick((t) => t + 1);
  };
  const saveTimeMaster = async (key, minutes) => {
    const r = rows.find((x) => (x.codigo || x.producto) === key);
    if (!r || !r.codigo) { setError("Este producto no tiene código: no se puede guardar en el maestro."); return; }
    try {
      await maestrosApi.upsertInBatches("assembly_products", [{ code: String(r.codigo), name: r.producto, minutes: Math.round(Number(minutes)), persons: r.personas || 1 }], "code");
      D.invalidateMasters(); setMsg(`Tiempo de ${r.codigo} guardado en el maestro de productos.`);
    } catch (e) { setError(e.message); }
  };
  const fixZone = (key, z) => {
    rows.forEach((r) => { if (`${r.depto}|${r.ciudad}|${r.barrio}` === key) D.applyZoneToRow(r, z.name, masters); });
    setTick((t) => t + 1);
  };
  const saveZoneMaster = async (key, z) => {
    const r = rows.find((x) => `${x.depto}|${x.ciudad}|${x.barrio}` === key);
    if (!r) return;
    if (!r.ciudad) { setError("Esta fila no trae ciudad en la base: corrígela en el archivo; no se puede guardar en el maestro sin ciudad."); return; }
    try {
      await maestrosApi.insertRow("geo_neighborhoods", { city: r.ciudad, neighborhood: r.barrio || "TODOS", zone_id: z.id, region: z.region, zone_type: r.barrio ? "BARRIO" : "MUNICIPIO" });
      D.invalidateMasters(); setMsg(`${r.ciudad} · ${r.barrio || "TODOS"} guardado en el maestro de barrios.`);
    } catch (e) { setError(e.message); }
  };

  const guardar = () => {
    const records = D.rowsToServiceRecords(rows, session);
    const byKey = new Map();
    (db.services || []).filter((s) => s.servicioExterno).forEach((s) => { const k = `${s.servicioExterno}|${s.productoExternoCodigo || ""}`; byKey.set(k, [...(byKey.get(k) || []), s]); });
    let services = [...(db.services || [])];
    const created = [];
    let nuevos = 0, actualizados = 0, omitidos = 0;
    records.forEach((rec) => {
      const ex = D.existingForUnit(byKey.get(`${rec.servicioExterno}|${rec.productoExternoCodigo}`) || [], rec.asig.unidad);
      if (!ex) {
        created.push({ id: ui.uid("srv"), productId: null, observacionTrabajo: null, armado: null, observation: "", createdAt: new Date().toISOString(), ...rec });
        nuevos++;
      } else if (ex.estadoGestion === "Pendiente" && ex.asig && Math.round(ex.quantity || 1) === 1) {
        const { technicianId, tecnico2Nombre, tecnico3Nombre, rutaOrden, responsibleUserId, ...fields } = rec;
        services = services.map((s) => (s.id === ex.id ? { ...s, ...fields } : s));
        actualizados++;
      } else omitidos++;
    });
    let next = { ...db, services: [...created, ...services] };
    next = addAudit(next, { userId: session.id, action: "Carga de servicios para asignación", record: fecha, oldValue: "-", newValue: `${nuevos} nuevos, ${actualizados} actualizados, ${omitidos} ya gestionados (omitidos)` });
    persist(next);
    setMsg(`Carga guardada como pendiente: ${nuevos} nuevos, ${actualizados} actualizados, ${omitidos} omitidos por estar ya en gestión o realizados.`);
    setByKind({});
  };

  // Pendientes agrupados por servicio
  const grupos = useMemo(() => {
    const m = new Map();
    pool.forEach((s) => {
      const g = m.get(s.servicioExterno) || { servicio: s.servicioExterno, cliente: s.clienteNombre, ciudad: s.ciudadExterna, fecha: s.date, productos: 0, min: 0, prio: false, estado: s.estadoGestion, region: s.asig?.region };
      g.productos += s.quantity || 1; g.min += s.tiempoMin || 0; if (s.asig?.prioridad === "Prioridad 1") g.prio = true; if (s.date < g.fecha) g.fecha = s.date;
      m.set(s.servicioExterno, g);
    });
    return [...m.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.servicio).localeCompare(String(b.servicio)));
  }, [pool]);
  const sel = grupos.filter((g) => !excluded.has(g.servicio));
  const toggle = (servicio) => { const s = new Set(excluded); if (s.has(servicio)) s.delete(servicio); else s.add(servicio); setExcluded(s); };

  const bloqueos = val ? val.sinZona.length + val.sinTiempo.length + val.sinRegion : 0;

  return (
    <div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

      <div className="amg-card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Subir las bases del día</div>
        <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.6 }}>
          Sube la <b>Base de Asignación</b> (Jamar, hoja <i>Hoja139</i>) y/o la <b>Base TUGO</b>. Cada producto se cruza con los maestros (zona, tiempo, complejidad) y, al guardar, queda en Carga como <b>Pendiente</b>.
          Los pendientes de días anteriores y los servicios programados para esta fecha entran solos a la asignación (abajo).
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label className={`amg-btn ${canEdit ? "primary" : ""}`} style={{ cursor: canEdit ? "pointer" : "not-allowed" }}>
            <Upload size={14} /> Base de Asignación (Jamar){byKind.jamar ? ` · ${byKind.jamar.length} productos` : ""}
            <input type="file" accept=".xlsx,.xls" disabled={!canEdit} style={{ display: "none" }} onChange={(e) => { onFile("jamar", e.target.files[0]); e.target.value = ""; }} />
          </label>
          <label className="amg-btn" style={{ cursor: canEdit ? "pointer" : "not-allowed" }}>
            <Upload size={14} /> Base TUGO{byKind.tugo ? ` · ${byKind.tugo.length} productos` : ""}
            <input type="file" accept=".xlsx,.xls" disabled={!canEdit} style={{ display: "none" }} onChange={(e) => { onFile("tugo", e.target.files[0]); e.target.value = ""; }} />
          </label>
          <button className="amg-btn" onClick={reloadMasters} title="Vuelve a leer zonas, barrios y productos"><RotateCcw size={14} /> Recargar maestros</button>
        </div>
      </div>

      {val && (
        <div className="amg-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Revisión de la carga ({fmt(rows.length)} productos · {fmt(new Set(rows.map((r) => r.servicio)).size)} servicios · {fmt(rows.reduce((s, r) => s + (r.tiempo || 0), 0))} min)</div>
          {val.sinZona.length === 0 && val.sinTiempo.length === 0 && val.sinRegion === 0 && <div style={{ color: "var(--green)", fontSize: 13 }}>✓ Todos los productos tienen zona, región y tiempo.</div>}

          {val.sinZona.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--red)" }}>{val.sinZona.length} barrio(s) sin zona equivalente</div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 6 }}>Elige la zona para esta carga{isAdmin ? " y, si quieres, guárdala en el maestro de barrios" : ""}.</div>
              {val.sinZona.map(([key, list]) => <ZoneFixRow key={key} label={`${list[0].ciudad || `código de municipio "${list[0].deptoCod}|${list[0].ciudadCod}" sin nombre (agrégalo en Maestros → Códigos de municipio y sube la base otra vez)`} · ${list[0].barrio || "(sin barrio)"} (${list[0].depto}) — ${list.length} producto(s)`} ui={ui} isAdmin={isAdmin} onPick={(z) => fixZone(key, z)} onSave={(z) => saveZoneMaster(key, z)} />)}
            </div>
          )}
          {val.sinTiempo.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--red)" }}>{val.sinTiempo.length} producto(s) sin tiempo de armado</div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 6 }}>Escribe los minutos para esta carga{isAdmin ? " y, si quieres, guárdalos en el maestro de productos" : ""}.</div>
              {val.sinTiempo.map(([key, list]) => <TimeFixRow key={key} label={`${list[0].codigo || "(sin código)"} · ${list[0].producto} — ${list.length} unidad(es)`} isAdmin={isAdmin} onApply={(m) => fixTime(key, m)} onSave={(m) => saveTimeMaster(key, m)} />)}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)", display: "flex", gap: 16, flexWrap: "wrap" }}>
            {val.tiempoJamar > 0 && <span>{val.tiempoJamar} producto(s) con tiempo de Jamar (sin tiempo BIVER)</span>}
            {val.sinComplejidad > 0 && <span>{val.sinComplejidad} sin complejidad (se tratan como Aprendiz)</span>}
            {val.sinTelefono > 0 && <span>{val.sinTelefono} sin teléfono del cliente</span>}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="amg-btn primary" disabled={!canEdit || bloqueos > 0} onClick={guardar}><Save size={14} /> Guardar carga como pendiente</button>
            {bloqueos > 0 && <span style={{ fontSize: 12, color: "var(--red)" }}>Resuelve los {bloqueos} puntos en rojo para poder guardar.</span>}
          </div>
        </div>
      )}

      <div className="amg-card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Servicios que entran a la asignación del {ui.fmtDate(fecha)}</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 10, fontSize: 13 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>Pendientes desde <input type="date" className="amg-input" style={{ width: 150 }} value={desde} onChange={(e) => e.target.value && setDesde(e.target.value)} /></label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={incluirAsignados} onChange={(e) => setIncluirAsignados(e.target.checked)} /> Incluir los ya asignados de esta fecha (para reasignar)</label>
          <span style={{ color: "var(--text-dim)" }}>Seleccionados: <b>{fmt(sel.length)}</b> de {fmt(grupos.length)} servicios · {fmt(sel.reduce((s, g) => s + g.productos, 0))} productos · {fmt(sel.reduce((s, g) => s + g.min, 0))} min</span>
        </div>
        <div style={{ maxHeight: 360, overflow: "auto" }}>
          <table className="amg-table">
            <thead><tr><th></th><th>Servicio</th><th>Cliente</th><th>Ciudad</th><th>Fecha</th><th>Prod.</th><th>Min</th><th>Estado</th></tr></thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.servicio} style={excluded.has(g.servicio) ? { opacity: 0.45 } : undefined}>
                  <td><input type="checkbox" checked={!excluded.has(g.servicio)} onChange={() => toggle(g.servicio)} /></td>
                  <td className="amg-mono">{g.servicio}{g.prio && <span style={{ marginLeft: 6 }}><ui.Badge text="P1" color="red" /></span>}</td>
                  <td>{g.cliente}</td><td>{g.ciudad}</td><td className="amg-mono">{ui.fmtDate(g.fecha)}</td><td className="amg-mono">{g.productos}</td><td className="amg-mono">{fmt(g.min)}</td>
                  <td><ui.Badge text={g.estado} color={g.estado === "Pendiente" ? "amber" : "blue"} /></td>
                </tr>
              ))}
              {grupos.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay servicios pendientes para esta fecha. Sube una base arriba.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ZoneFixRow({ label, ui, isAdmin, onPick, onSave }) {
  const [z, setZ] = useState(null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(200px,1fr) minmax(220px,1fr) auto", gap: 8, alignItems: "start", marginBottom: 8, fontSize: 12.5 }}>
      <div style={{ paddingTop: 8 }}>{label}</div>
      <ui.ZonaPicker value={z?.id} valueName={z?.name} onPick={(zz) => { setZ(zz); onPick(zz); }} />
      {isAdmin && <button className="amg-btn" disabled={!z} onClick={() => onSave(z)}>Guardar en maestro</button>}
    </div>
  );
}

function TimeFixRow({ label, isAdmin, onApply, onSave }) {
  const [m, setM] = useState("");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(240px,1fr) 110px auto auto", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 12.5 }}>
      <div>{label}</div>
      <input type="number" min="1" className="amg-input" placeholder="minutos" value={m} onChange={(e) => setM(e.target.value)} />
      <button className="amg-btn" disabled={!m} onClick={() => onApply(m)}>Aplicar</button>
      {isAdmin && <button className="amg-btn" disabled={!m} onClick={() => onSave(m)}>Guardar en maestro</button>}
    </div>
  );
}

/* --------------------------- 2 · Técnicos del día --------------------------- */

// Celda editable que escribe en Personal al salir del campo (no en cada tecla).
function EditCell({ value, type = "text", options, disabled, onCommit, width = 90 }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  const commit = (nv) => { if (String(nv) !== String(value ?? "")) onCommit(nv); };
  if (options) {
    return <select className="amg-select" style={{ width, padding: "3px 4px", fontSize: 12.5 }} disabled={disabled} value={v} onChange={(e) => { setV(e.target.value); commit(e.target.value); }}>
      <option value="">-</option>{options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>;
  }
  return <input className="amg-input" style={{ width, padding: "3px 6px", fontSize: 12.5 }} type={type} disabled={disabled} value={v}
    onChange={(e) => setV(e.target.value)} onBlur={() => commit(v)} onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} />;
}

function StepTecnicos({ db, persist, addAudit, session, ui, canEdit, techs, regionName, availability, setAvailability, availDirty, setAvailDirty, fecha, selectedPool }) {
  const [q, setQ] = useState("");
  const [dep, setDep] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const techById = Object.fromEntries(db.technicians.map((t) => [t.id, t]));
  const deps = [...new Set(techs.map((t) => t.dep))].sort();
  const rows = techs.filter((t) => (!dep || t.dep === dep) && (!q.trim() || (t.n + t.code).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.dep || "").localeCompare(b.dep || "") || (a.ord ?? 999) - (b.ord ?? 999) || a.n.localeCompare(b.n));

  const commit = (t, field, value, label) => {
    const before = techById[t.id];
    const nv = field === "assignOrder" || field === "capacityMinutes" ? (value === "" ? null : Number(value)) : value;
    let next = { ...db, technicians: db.technicians.map((x) => (x.id === t.id ? { ...x, [field]: nv } : x)) };
    next = addAudit(next, { userId: session.id, action: "Edición de personal (Asignación)", record: t.id, oldValue: `${label}: ${before?.[field] ?? "-"}`, newValue: `${label}: ${nv ?? "-"}` });
    persist(next);
  };
  const setAv = (t, patch) => {
    setAvailability({ ...availability, [t.id]: { state: t.estado, novelty: t.nov, ...(availability[t.id] || {}), ...patch } });
    setAvailDirty(true); setMsg("");
  };
  const saveAv = async () => {
    setError("");
    try {
      await D.saveAvailability(fecha, techs.filter((t) => availability[t.id]).map((t) => ({ technicianId: t.id, state: availability[t.id].state ?? t.estado, novelty: availability[t.id].novelty ?? t.nov })), session.id);
      setAvailDirty(false); setMsg(`Disponibilidad del ${ui.fmtDate(fecha)} guardada.`);
    } catch (e) { setError(`${e.message}. ¿Corriste el SQL de la Fase 2 en Supabase?`); }
  };

  // Demanda vs capacidad por región
  const resumen = useMemo(() => {
    const m = {};
    selectedPool.forEach((s) => { const r = s.asig?.region ?? "?"; m[r] = m[r] || { dem: 0, cap: 0, tec: 0 }; m[r].dem += s.tiempoMin || 0; });
    techs.filter((t) => t.activo).forEach((t) => { const r = t.reg ?? "?"; m[r] = m[r] || { dem: 0, cap: 0, tec: 0 }; m[r].cap += t.capEff; m[r].tec++; });
    return Object.entries(m).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [selectedPool, techs]);

  const TIPOS = ["Técnico junior", "Técnico senior"];
  return (
    <div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.6 }}>
        La matriz está conectada a <b>Personal</b>: orden, capacidad, cargo, ubicación, transporte, pico y placa y coordinador se guardan en la ficha de cada persona. El <b>estado del día</b> y la <b>novedad</b> solo aplican a la fecha {ui.fmtDate(fecha)}.
        Cargo Senior = Maestro, Junior = Aprendiz. Capacidad del día = capacidad − minutos de novedad (en sede, descanso o vacaciones no sale a ruta).
      </div>

      {resumen.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {resumen.map(([r, v]) => (
            <div key={r} className="amg-card" style={{ padding: "8px 12px", fontSize: 12.5, borderColor: v.dem > v.cap ? "var(--red)" : undefined }}>
              <div style={{ fontWeight: 600 }}>{regionName[r] ? `${regionName[r]} (R${r})` : `Región ${r}`}</div>
              <div>Demanda <b className="amg-mono">{fmt(v.dem)}</b> min · Capacidad <b className="amg-mono">{fmt(v.cap)}</b> min · {v.tec} técnicos</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <input className="amg-input" style={{ width: 220 }} placeholder="Buscar técnico..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="amg-select" style={{ width: 180 }} value={dep} onChange={(e) => setDep(e.target.value)}><option value="">Todos los departamentos</option>{deps.map((d) => <option key={d}>{d}</option>)}</select>
        <button className="amg-btn primary" disabled={!canEdit || !availDirty} onClick={saveAv}><Save size={14} /> Guardar disponibilidad del día</button>
        {availDirty && <span style={{ fontSize: 12, color: "var(--amber, #b86a00)" }}>Hay cambios de estado sin guardar.</span>}
      </div>

      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr>
            <th>Orden</th><th>Técnico</th><th>Depto.</th><th>Cargo</th><th>Ubicación</th><th>Capacidad base</th><th>Estado del día</th><th>Novedad (min)</th><th>Cap. del día</th><th>Transporte</th><th>Pico y placa</th><th>Coordinador</th><th>Vivienda (zona)</th>
          </tr></thead>
          <tbody>
            {rows.map((t) => {
              const p = techById[t.id];
              return (
                <tr key={t.id} style={!t.activo ? { opacity: 0.6 } : undefined}>
                  <td><EditCell width={56} type="number" value={p.assignOrder} disabled={!canEdit} onCommit={(v) => commit(t, "assignOrder", v, "Orden")} /></td>
                  <td><b>{t.n}</b><div style={{ fontSize: 11, color: "var(--text-faint)" }}>{t.code}{t.reg === null && " · sin región (revisa el departamento)"}</div></td>
                  <td>{t.dep || "-"}</td>
                  <td><EditCell width={120} options={TIPOS} value={p.type} disabled={!canEdit} onCommit={(v) => commit(t, "type", v, "Cargo")} /></td>
                  <td><EditCell width={110} options={[{ value: "Disponible", label: "Disponible" }, { value: "Sede", label: "En sede" }]} value={p.operationSite || "Disponible"} disabled={!canEdit} onCommit={(v) => commit(t, "operationSite", v, "Ubicación")} /></td>
                  <td><EditCell width={70} type="number" value={p.capacityMinutes} disabled={!canEdit} onCommit={(v) => commit(t, "capacityMinutes", v, "Capacidad")} /></td>
                  <td>
                    <select className="amg-select" style={{ width: 120, padding: "3px 4px", fontSize: 12.5 }} disabled={!canEdit} value={t.estado} onChange={(e) => setAv(t, { state: e.target.value })}>
                      {D.ESTADOS_DIA.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td><input type="number" min="0" className="amg-input" style={{ width: 70, padding: "3px 6px", fontSize: 12.5 }} disabled={!canEdit} value={t.nov} onChange={(e) => setAv(t, { novelty: e.target.value })} /></td>
                  <td className="amg-mono" style={{ fontWeight: 600, color: t.activo ? "var(--text)" : "var(--red)" }}>{fmt(t.capEff)}</td>
                  <td><EditCell width={110} options={["Moto", "Servicio público", "Bicicleta", "Carro", "Otros"]} value={p.transportMode} disabled={!canEdit} onCommit={(v) => commit(t, "transportMode", v, "Transporte")} /></td>
                  <td><EditCell width={100} options={["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"]} value={p.picoPlacaDay} disabled={!canEdit} onCommit={(v) => commit(t, "picoPlacaDay", v, "Pico y placa")} /></td>
                  <td><EditCell width={130} value={p.coordinator} disabled={!canEdit} onCommit={(v) => commit(t, "coordinator", v, "Coordinador")} /></td>
                  <td style={{ fontSize: 11.5, maxWidth: 170 }}>
                    {t.homeEstado === "ok" && <span style={{ color: "var(--green)" }}>✓ {t.residence}</span>}
                    {t.homeEstado === "sin" && <span style={{ color: "var(--text-faint)" }}>sin definir (se edita en Personal)</span>}
                    {t.homeEstado === "noZona" && <span style={{ color: "var(--red)" }}>"{t.residence}" no es una zona equivalente</span>}
                    {t.homeEstado === "sinCoord" && <span style={{ color: "var(--amber, #b86a00)" }}>{t.residence}: zona sin coordenadas</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={13} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay técnicos activos de campo (junior o senior) en Personal.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>{techs.filter((t) => t.activo).length} técnicos disponibles de {techs.length}. Los supervisores y el personal administrativo no entran en la asignación.</div>
    </div>
  );
}

/* ------------------------------- 3 · Asignación ------------------------------- */

const occClass = (p, rules) => { const r = p.used / (p.cap || 1); return r > 1 + (rules.tolerancia || 0) + 0.001 ? "over" : r < 0.6 ? "low" : ""; };

function StepAsignacion({ db, persist, addAudit, session, ui, canEdit, masters, rules, fecha, techs, selectedPool, regionName }) {
  const [plan, setPlanRaw] = useState(draft.plan);
  const [locks, setLocksRaw] = useState(draft.locks);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [fd, setFd] = useState("Todos");
  const [confirm, setConfirm] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(null);
  const setPlan = (p) => { draft.plan = p; draft.techNames = techs; setPlanRaw(p); };
  const setLocks = (l) => { draft.locks = l; setLocksRaw(l); };

  const run = (keepLocks) => {
    setError(""); setMsg("");
    const rows = D.poolToEngineRows(selectedPool, fecha);
    if (!rows.length) { setError("No hay servicios seleccionados. Ve al paso 1 y revisa los pendientes."); return; }
    if (!techs.some((t) => t.activo)) { setError("No hay técnicos disponibles ese día. Revisa el paso 2."); return; }
    try {
      const L = keepLocks ? { ...locks } : {};
      if (!keepLocks) setLocks({});
      const P = E.assign(rows, techs.map((t) => ({ ...t })), { ...rules, M: masters.M, sector: masters.M.sector }, L);
      setPlan(P);
    } catch (e) { setError(`El motor falló: ${e.message}`); }
  };

  const svcById = (id) => plan.services.find((s) => s.id === id);
  const moveService = (id, to) => {
    if (!to) return;
    const s = svcById(id);
    s.tech = to === "__none" ? null : to;
    const L = { ...locks };
    if (!s.tech) { s.reason = "Quitado manualmente"; delete L[s.servicio]; }
    else { s.reason = null; s.helpers = (s.helpers || []).filter((h) => h !== s.tech); L[s.servicio] = { tech: s.tech, helpers: s.helpers }; }
    setLocks(L);
    setPlan(Object.assign({}, E.recompute(plan, techs)));
  };
  const setHelper = (id, n) => {
    const s = svcById(id);
    s.helpers = n ? [n] : []; s.helperAviso = false;
    if (locks[s.servicio]) locks[s.servicio].helpers = s.helpers;
    setPlan(Object.assign({}, E.recompute(plan, techs)));
  };
  const toggleLock = (id) => {
    const s = svcById(id); const L = { ...locks };
    if (L[s.servicio]) delete L[s.servicio]; else L[s.servicio] = { tech: s.tech, helpers: s.helpers };
    setLocks(L);
  };

  const confirmar = () => {
    const r = D.applyPlanToServices(db.services, plan, techs, fecha);
    let next = { ...db, services: r.services };
    next = addAudit(next, { userId: session.id, action: "Asignación de servicios", record: fecha, oldValue: "-", newValue: `${r.asignados} registros asignados a ${new Set(plan.services.filter((s) => s.tech).map((s) => s.tech)).size} técnicos${r.liberados ? `, ${r.liberados} liberados` : ""}` });
    persist(next);
    setConfirm(false);
    setMsg(`Asignación enviada a Carga: ${r.asignados} registros quedaron "En gestión" con fecha ${ui.fmtDate(fecha)}${r.liberados ? ` y ${r.liberados} volvieron a Pendiente` : ""}.`);
  };

  if (!plan) {
    return (
      <div>
        {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
        <div className="amg-card" style={{ padding: 24, textAlign: "center" }}>
          <div style={{ marginBottom: 12, color: "var(--text-dim)" }}>{selectedPool.length ? `${new Set(selectedPool.map((s) => s.servicioExterno)).size} servicios listos para asignar el ${ui.fmtDate(fecha)} con ${techs.filter((t) => t.activo).length} técnicos disponibles.` : "No hay servicios seleccionados. Ve al paso 1."}</div>
          <button className="amg-btn primary" disabled={!canEdit || !selectedPool.length} onClick={() => run(false)}>Asignar automáticamente</button>
        </div>
      </div>
    );
  }

  const P = plan;
  const asg = P.services.filter((s) => s.tech);
  const minT = P.services.reduce((a, s) => a + s.min, 0), minA = asg.reduce((a, s) => a + s.min, 0);
  const over = P.techs.filter((p) => occClass(p, rules) === "over");
  const tooMany = P.techs.filter((p) => p.svcIds.length + p.help.length > rules.maxServicios);
  const deps = [...new Set(P.services.map((s) => s.depto))].sort();
  const cards = P.techs.filter((p) => (p.svcIds.length || p.help.length) && (fd === "Todos" || p.t.dep === fd)).sort((a, b) => (a.t.dep || "").localeCompare(b.t.dep || "") || (a.t.ord ?? 99) - (b.t.ord ?? 99));
  const UN = P.unassigned.filter((s) => fd === "Todos" || s.depto === fd);
  const elegibles = (s, excl) => techs.filter((t) => t.activo && t.reg === s.region && t.n !== excl);
  const summary = D.summaryByTech(P);

  const regiones = regionsOfPlan(P, regionName);
  // Regiones con servicios pero sin ningún técnico disponible, con la causa más probable.
  const sinCobertura = regiones.filter((g) => !techs.some((t) => t.activo && t.reg === g.region)).map((g) => {
    const delaRegion = techs.filter((t) => t.reg === g.region);
    return { ...g, enPersonal: delaRegion.length, sinCap: delaRegion.filter((t) => !t.cap).length, otroEstado: delaRegion.filter((t) => t.cap && t.estado !== "Disponible").length };
  });
  const sinRegion = techs.filter((t) => t.reg === null);
  const descargarPdf = async (g) => {
    setError(""); setPdfBusy(g.region);
    try {
      const blob = await buildRegionPdf({ plan: P, techs, region: g.region, regionName, fecha });
      downloadBlob(blob, `Region_${g.region}_${String(g.nombre).replace(/\s+/g, "_")}_Plan_de_Rutas_${fecha}.pdf`);
    } catch (e) { setError(`No se pudo generar el PDF: ${e.message}`); }
    setPdfBusy(null);
  };
  const descargarResumen = () => { const { wb, name } = buildSummaryWorkbook({ plan: P, techs, fecha }); downloadWorkbook(wb, name); };

  const exportCSV = () => ui.downloadCSV(`asignacion_${fecha}.csv`,
    ["Técnico", "Orden", "Servicio", "Cliente", "Dirección", "Ciudad", "Zona", "Producto", "Min", "Apoyo"],
    P.services.filter((s) => s.tech).flatMap((s) => s.rows.map((r) => [s.tech, s.orden, s.servicio, s.cliente, s.direccion, s.ciudad, r.zona || "", r.producto, r.tiempo, (s.helpers || []).join(", ")])));

  const MoveSel = ({ s }) => (
    <select className="amg-select" style={{ width: 150, padding: "3px 4px", fontSize: 12 }} disabled={!canEdit} value="" onChange={(e) => moveService(s.id, e.target.value)}>
      <option value="">Mover a…</option>
      {s.tech && <option value="__none">— Dejar sin asignar</option>}
      {elegibles(s, s.tech).map((t) => <option key={t.n} value={t.n}>{t.n} ({fmt(t.capEff)})</option>)}
    </select>
  );

  return (
    <div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <button className="amg-btn" disabled={!canEdit} onClick={() => run(true)}><RotateCcw size={14} /> Volver a asignar (respeta los fijados)</button>
        <button className="amg-btn" disabled={!canEdit} onClick={() => run(false)}>Reiniciar y quitar fijados</button>
        <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
        <button className="amg-btn primary" disabled={!canEdit} onClick={() => setConfirm(true)}><Save size={14} /> Confirmar y enviar a Carga</button>
      </div>

      {sinCobertura.map((g) => (
        <div key={g.region} className="amg-alert danger" style={{ marginBottom: 8 }}><AlertTriangle size={14} /> {g.nombre} (R{g.region}): {g.servicios} servicios sin ningún técnico disponible.
          {g.enPersonal === 0 ? " No hay técnicos de esa región en Personal (revisa el departamento de cada persona)." : ` En Personal hay ${g.enPersonal} técnicos de la región: ${g.sinCap} sin capacidad en minutos y ${g.otroEstado} con otro estado ese día (sede, descanso…). Revisa el paso 2.`}</div>
      ))}
      {sinRegion.length > 0 && <div className="amg-alert danger" style={{ marginBottom: 8 }}><AlertTriangle size={14} /> {sinRegion.length} técnico(s) sin región, no reciben servicios: {sinRegion.map((t) => t.n).join(", ")}. Revisa su departamento en Personal.</div>}

      <div className="amg-card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Salidas: rutas por técnico (PDF por región) y resumen</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {regiones.map((g) => (
            <button key={g.region} className="amg-btn" disabled={pdfBusy !== null} onClick={() => descargarPdf(g)}>
              <Download size={14} /> {pdfBusy === g.region ? "Generando..." : `PDF · ${g.nombre} (R${g.region})`} <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{g.asignados}/{g.servicios} serv.</span>
            </button>
          ))}
          <button className="amg-btn" onClick={descargarResumen}><Download size={14} /> Resumen en Excel</button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Los PDF reflejan lo que ves en pantalla, incluidos tus movimientos manuales. Si cambias algo, vuelve a descargarlos.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Servicios asignados" value={`${fmt(asg.length)} / ${fmt(P.services.length)}`} sub={`${pct(minA, minT)}% de los minutos`} accent />
        <ui.StatCard label="Sin asignar" value={fmt(P.unassigned.length)} sub={P.unassigned.filter((s) => s.prio).length ? `${P.unassigned.filter((s) => s.prio).length} Prioridad 1` : "ninguna Prioridad 1"} />
        <ui.StatCard label="Técnicos con ruta" value={fmt(P.techs.filter((p) => p.svcIds.length).length)} sub={`${techs.filter((t) => t.activo).length} disponibles`} />
        <ui.StatCard label="Ocupación" value={`${pct(minA, P.techs.filter((p) => p.svcIds.length).reduce((a, p) => a + p.cap, 0))}%`} sub="de técnicos con ruta" />
        <ui.StatCard label="Sobrecargados" value={fmt(over.length + tooMany.length)} sub={`capacidad o más de ${rules.maxServicios} servicios`} />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {["Todos", ...deps].map((d) => <button key={d} className={`amg-btn ${fd === d ? "primary" : ""}`} onClick={() => setFd(d)}>{d}{d !== "Todos" && P.unassigned.some((s) => s.depto === d) ? ` · ${P.unassigned.filter((s) => s.depto === d).length} sin asignar` : ""}</button>)}
      </div>

      {UN.length > 0 && (
        <div className="amg-card" style={{ padding: 14, marginBottom: 14, borderColor: "var(--red)" }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--red)" }}>Sin asignar ({UN.length})</div>
          <div style={{ overflowX: "auto" }}>
            <table className="amg-table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Servicio</th><th>Ciudad / zona</th><th>Min</th><th>Motivo</th><th>Asignar a</th></tr></thead>
              <tbody>{UN.map((s) => (
                <tr key={s.id}>
                  <td className="amg-mono">{s.servicio}{s.prio ? <span style={{ marginLeft: 6 }}><ui.Badge text="P1" color="red" /></span> : null}</td>
                  <td>{s.ciudad} · {s.zona || "sin zona"}</td><td className="amg-mono">{fmt(s.min)}</td>
                  <td style={{ color: "var(--text-dim)" }}>{s.reason}</td><td><MoveSel s={s} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {cards.map((p) => {
        const sv = p.svcIds.map(svcById).filter(Boolean);
        const oc = occClass(p, rules);
        return (
          <details key={p.n} className="amg-card" style={{ padding: 0, marginBottom: 10 }} open={sv.length <= 6}>
            <summary style={{ padding: "10px 14px", cursor: "pointer", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <b>{p.n}</b>
              <ui.Badge text={p.t.perf} color={p.t.perf === "Maestro" ? "blue" : "gray"} />
              <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{p.t.dep} · {sv.length} serv. · {fmt(p.used)} / {fmt(p.cap)} min ({pct(p.used, p.cap)}%)</span>
              <div style={{ flex: "1 1 120px", maxWidth: 220, height: 7, background: "var(--panel-2)", borderRadius: 4 }}>
                <div style={{ width: `${Math.min(100, pct(p.used, p.cap))}%`, height: "100%", borderRadius: 4, background: oc === "over" ? "var(--red)" : oc === "low" ? "var(--text-faint)" : "var(--green)" }} />
              </div>
              {p.geoCruces && p.geoCruces.length > 0 && <span style={{ fontSize: 11.5, color: "var(--red)" }}>⚠ ruta con zonas distantes: {p.geoCruces.join("; ")}</span>}
            </summary>
            <div style={{ overflowX: "auto", padding: "0 6px 8px" }}>
              <table className="amg-table" style={{ fontSize: 12.5 }}>
                <thead><tr><th>#</th><th>Servicio</th><th>Cliente / dirección</th><th>Zona</th><th>Productos</th><th>Min</th><th>Apoyo</th><th></th><th></th></tr></thead>
                <tbody>
                  {sv.map((s) => (
                    <tr key={s.id}>
                      <td className="amg-mono">{s.orden}</td>
                      <td className="amg-mono">{s.servicio}<div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                        {s.prio ? <ui.Badge text="P1" color="red" /> : null}{s.needM ? <ui.Badge text="Maestro" color="blue" /> : null}{s.team ? <ui.Badge text="Equipo" color="amber" /> : null}{s.cruce ? <ui.Badge text="Cruce" color="red" /> : null}
                      </div></td>
                      <td>{s.cliente}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{s.direccion} · {s.ciudad}</div></td>
                      <td style={{ maxWidth: 150 }}>{s.zona || <span style={{ color: "var(--red)" }}>sin zona</span>}</td>
                      <td style={{ maxWidth: 260 }}><ui.HoverText text={s.rows.map((r) => r.producto).join(" · ")} maxChars={60} /></td>
                      <td className="amg-mono">{fmt(s.min)}</td>
                      <td>
                        {s.need2 ? (
                          <select className="amg-select" style={{ width: 140, padding: "3px 4px", fontSize: 12 }} disabled={!canEdit} value={(s.helpers || [])[0] || ""} onChange={(e) => setHelper(s.id, e.target.value)}>
                            <option value="">{s.helperAviso ? "⚠ Sin apoyo" : "Sin apoyo"}</option>
                            {elegibles(s, s.tech).map((t) => <option key={t.n} value={t.n}>{t.n}</option>)}
                          </select>
                        ) : "-"}
                      </td>
                      <td><MoveSel s={s} /></td>
                      <td><button className="amg-btn ghost" style={{ padding: 4 }} title={locks[s.servicio] ? "Fijado a este técnico (clic para soltar)" : "Fijar a este técnico"} onClick={() => toggleLock(s.id)}>{locks[s.servicio] ? <Lock size={13} color="var(--accent)" /> : <Unlock size={13} color="var(--text-faint)" />}</button></td>
                    </tr>
                  ))}
                  {p.help.map((h) => { const s = svcById(h.id); return s ? (
                    <tr key={"h" + h.id} style={{ background: "var(--panel-2)" }}><td>—</td><td className="amg-mono">{s.servicio}</td><td colSpan={3}>Apoya a <b>{s.tech}</b> · {s.cliente}</td><td className="amg-mono">{fmt(h.min)}</td><td colSpan={3}></td></tr>
                  ) : null; })}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
      {cards.length === 0 && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>Ningún técnico con ruta en este departamento.</div>}

      <details className="amg-card" style={{ padding: "10px 14px", marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Resumen por técnico (servicios, movimientos y tiempo)</summary>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table className="amg-table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Técnico</th><th>Depto.</th><th>Perfil</th><th>Servicios</th><th>Productos</th><th>Movimientos (direcciones)</th><th>Minutos</th><th>Capacidad</th><th>Ocupación</th></tr></thead>
            <tbody>{summary.sort((a, b) => a.dep.localeCompare(b.dep) || b.minutos - a.minutos).map((r) => (
              <tr key={r.n}><td>{r.n}</td><td>{r.dep}</td><td>{r.perf}</td><td className="amg-mono">{r.servicios}</td><td className="amg-mono">{r.productos}</td><td className="amg-mono">{r.movimientos}</td><td className="amg-mono">{fmt(r.minutos)}</td><td className="amg-mono">{fmt(r.capacidad)}</td><td className="amg-mono">{pct(r.minutos, r.capacidad)}%</td></tr>
            ))}</tbody>
          </table>
        </div>
      </details>

      {confirm && (
        <ui.ConfirmModal title="Enviar la asignación a Carga" confirmLabel="Confirmar y enviar" onConfirm={confirmar} onClose={() => setConfirm(false)}
          message={`Se asignarán ${asg.length} servicios a ${new Set(asg.map((s) => s.tech)).size} técnicos para el ${ui.fmtDate(fecha)}. Quedarán en Carga como "En gestión", con su técnico, apoyo y orden de ruta. ${P.unassigned.length ? `${P.unassigned.length} servicios sin asignar seguirán como Pendientes.` : ""}`} />
      )}
    </div>
  );
}

/* --------------------------------- Criterios --------------------------------- */

function StepCriterios({ session, ui, isAdmin, rules, setRules, addAudit, db, persist }) {
  const [f, setF] = useState(rules);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const set = (k, v) => setF({ ...f, [k]: v });
  const num = (k, scale = 1) => (e) => set(k, e.target.value === "" ? "" : Number(e.target.value) / scale);
  const save = async () => {
    setError(""); setMsg("");
    try {
      const clean = { ...f, v: undefined };
      await D.saveRules(clean, session.id);
      setRules(clean);
      persist(addAudit(db, { userId: session.id, action: "Cambio de criterios de asignación", record: "rules", oldValue: "-", newValue: "Actualizados" }));
      setMsg("Criterios guardados para todo el equipo.");
    } catch (e) { setError(`${e.message}. ¿Corriste el SQL de la Fase 2 en Supabase?`); }
  };
  const Field = ({ label, children, hint }) => <div><label className="amg-label">{label}</label>{children}{hint && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{hint}</div>}</div>;
  const Check2 = ({ k, label }) => <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}><input type="checkbox" disabled={!isAdmin} checked={f[k] !== false && !!f[k]} onChange={(e) => set(k, e.target.checked)} style={{ marginTop: 3 }} /> {label}</label>;
  return (
    <div style={{ maxWidth: 820 }}>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {!isAdmin && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10 }}>Solo el administrador puede cambiar los criterios. Estos son los que se están usando.</div>}
      <div className="amg-card" style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Forma de repartir"><select className="amg-select" disabled={!isAdmin} value={f.modo} onChange={(e) => set("modo", e.target.value)}><option value="orden">Por orden de técnico (Orden 1 se llena primero)</option><option value="balance">Balancear entre técnicos disponibles</option></select></Field>
        <Field label="Máximo de servicios por técnico"><input type="number" min="1" max="30" className="amg-input" disabled={!isAdmin} value={f.maxServicios} onChange={num("maxServicios")} /></Field>
        <Field label="Holgura sobre la capacidad (%)" hint="Tope que nunca se pasa en la asignación automática."><input type="number" min="0" max="30" className="amg-input" disabled={!isAdmin} value={Math.round((f.tolerancia || 0) * 100)} onChange={num("tolerancia", 100)} /></Field>
        <Field label="Municipios lejanos a partir de (km)" hint="Más lejos de esto solo va con técnico en moto."><input type="number" min="0" step="5" className="amg-input" disabled={!isAdmin} value={f.kmLejano} onChange={num("kmLejano")} /></Field>
        <Field label="Salto máximo de IDZona en ciudad" hint="1 = solo sectores consecutivos; 2 = puede saltar un sector."><input type="number" min="1" max="10" className="amg-input" disabled={!isAdmin} value={f.saltoIdZona} onChange={num("saltoIdZona")} /></Field>
        <Field label="Diámetro máximo de una ruta en ciudad (km)" hint="Evita mezclar norte y sur."><input type="number" min="2" max="20" step="0.5" className="amg-input" disabled={!isAdmin} value={f.spanUrbano} onChange={num("spanUrbano")} /></Field>
        <div style={{ gridColumn: "1 / -1" }}><Field label="IDZona vecinos adicionales" hint="Formato región:IDZona-IDZona, separados por coma. Ej. 1:76-40, 1:76-41"><input className="amg-input" disabled={!isAdmin} value={f.vecinos ?? ""} onChange={(e) => set("vecinos", e.target.value)} /></Field></div>
        <div style={{ gridColumn: "1 / -1", display: "grid", gap: 10 }}>
          <Check2 k="agruparZonas" label="Agrupar por IDZona y corredores de municipios (todos los departamentos menos Bogotá–Cundinamarca)" />
          <Check2 k="mismoMunicipio" label="Si se apaga la agrupación por IDZona: una ruta no mezcla municipios" />
          <Check2 k="usarVivienda" label="Cercanía a la vivienda: cada técnico arranca su ruta por los servicios más cercanos a su zona de vivienda (se define en Personal)" />
          <Check2 k="geoCUN" label="Bogotá y Cundinamarca: agrupar por corredores y continuidad geográfica antes de asignar" />
          <Check2 k="picoPlaca" label="Aplicar pico y placa a las motos (Medellín, Cartagena, Bucaramanga)" />
          <Check2 k="asistenteTiempoCompleto" label="Productos de 2 personas: el apoyo ocupa el tiempo completo (apagado = el tiempo se divide entre titular y apoyo)" />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="amg-btn primary" disabled={!isAdmin} onClick={save}><Save size={14} /> Guardar criterios</button>
        <button className="amg-btn" disabled={!isAdmin} onClick={() => setF({ ...D.DEFAULT_RULES })}>Restablecer valores por defecto</button>
      </div>
      <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-faint)", lineHeight: 1.6 }}>
        Siempre se cumplen: nadie pasa su capacidad más la holgura ni el máximo de servicios · un servicio va completo a un solo técnico (o a un equipo si no cabe en ninguno) · solo técnicos de la misma región · Prioridad 1 antes que Normal ·
        complejidad Alta o empotrables solo a un técnico Senior (Maestro) · apoyo para productos de 2 personas.
      </div>
    </div>
  );
}
