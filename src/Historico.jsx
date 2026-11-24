import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download, AlertTriangle, Pencil, History, Ban, RotateCcw, CalendarClock, Check } from "lucide-react";
import { gestionDeCausal } from "./lib/asignacion/cierreColumnas";
import CambiosRegistros from "./CambiosRegistros";
import { fetchHistory, aggregateHistory, loadRegionInfo, updateHistoryRow, anularHistoryRow, restaurarHistoryRow } from "./lib/asignacion/history";
import { CSV_CARGA_HEADERS, filasCsvDeHistorico, camposCierreDeHistorico, parcharFilaCsv } from "./lib/asignacion/csvCarga";
import { ddmmyyyy } from "./lib/asignacion/outputs";
import { fechasDeArmado, pqrPorSolicitud, solicitudDeServicio } from "./lib/armados/armadosHistorico";
import { useZonaCoord } from "./lib/useCoordinadores";
import { cargarCierresParaHistorico, cargarCierresPorServicio, cierreMismoDia } from "./lib/cierreExtreme";

/* ============================================================================
   HISTÓRICO DE ASIGNACIÓN
   Todo lo que se finalizó con "Finalizar día" en Carga: qué se asignó a cada técnico,
   qué se realizó y qué no (con su causal). Sirve de base para el tablero y los reportes.
============================================================================ */

const GREEN = "#3F9D6E", RED = "#C0463A", ACCENT = "#D98D34", GRID = "#E3D8C4", AXIS = "#6B5D4D";
const fmt = (n) => Number(n || 0).toLocaleString("es-CO");
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const shortDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function Panel({ title, children }) {
  return <div className="amg-card" style={{ padding: 14 }}><div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{title}</div>{children}</div>;
}

// Editar un registro del histórico (solo administrador). Corrige lo que se cerró mal: técnico, resultado, causales, diagnóstico, datos del cliente y notas.
// Recalcula las columnas de cierre y la fila guardada del CSV, y deja la edición en la auditoría.
function EditarHistoricoModal({ ui, db, row, onClose, onSave }) {
  const apoyoMatch = row.helper_name ? db.technicians.find((t) => t.name === row.helper_name) : null;
  const [f, setF] = useState({
    technician_id: row.technician_id || "", apoyoId: apoyoMatch ? apoyoMatch.id : "", resultado: row.resultado, estado_extreme: row.estado_extreme || "", causal_extreme: row.causal_extreme || "",
    causal_auditada: row.causal_auditada || "", diagnostico: row.diagnostico || "", cliente: row.cliente || "", direccion: row.direccion || "", ciudad: row.ciudad || "", barrio: row.barrio || "",
    notas: row.notas || "", solucion: row.solucion || "", primer_piso: row.primer_piso || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const techOpts = db.technicians.map((t) => ({ value: t.id, label: t.name, sublabel: `${t.code} · ${t.status}` }));
  const causales = [...new Set([...(db.causales || []).filter((c) => c.active).map((c) => c.name), ...(f.causal_auditada ? [f.causal_auditada] : [])])].sort((a, b) => a.localeCompare(b, "es"));
  const guardar = async () => {
    setBusy(true); setError("");
    try {
      const tec = db.technicians.find((t) => t.id === f.technician_id);
      const apoyo = db.technicians.find((t) => t.id === f.apoyoId);
      const nuevo = {
        ...row, technician_id: tec ? tec.id : null, technician_name: tec ? tec.name : (f.technician_id === (row.technician_id || "") ? row.technician_name : null), helper_name: apoyo ? apoyo.name : null,
        resultado: f.resultado, estado_extreme: f.estado_extreme || null, causal_extreme: f.causal_extreme.trim() || null, causal_auditada: f.causal_auditada || null, diagnostico: f.diagnostico.trim() || null,
        cliente: f.cliente.trim() || null, direccion: f.direccion.trim() || null, ciudad: f.ciudad.trim() || null, barrio: f.barrio.trim() || null,
        notas: f.notas.trim() || null, solucion: f.solucion.trim() || null, primer_piso: f.primer_piso || null,
      };
      const patch = {
        technician_id: nuevo.technician_id, technician_name: nuevo.technician_name, helper_name: nuevo.helper_name, resultado: nuevo.resultado, estado_extreme: nuevo.estado_extreme,
        causal_extreme: nuevo.causal_extreme, causal_auditada: nuevo.causal_auditada, diagnostico: nuevo.diagnostico, cliente: nuevo.cliente, direccion: nuevo.direccion, ciudad: nuevo.ciudad, barrio: nuevo.barrio,
        notas: nuevo.notas, solucion: nuevo.solucion, primer_piso: nuevo.primer_piso, ...camposCierreDeHistorico(nuevo),
      };
      if (Array.isArray(row.fila_csv)) patch.fila_csv = parcharFilaCsv(row.fila_csv, { ...nuevo, ...patch }, row, { technicians: db.technicians, causales: db.causales });
      const guardado = await updateHistoryRow(row.id, patch);
      onSave(guardado, row);
    } catch (e) { setError(e.message || String(e)); setBusy(false); }
  };
  const lbl = (t) => <label className="amg-label">{t}</label>;
  return (
    <ui.Modal title={`Editar registro del histórico · ${row.servicio}`} onClose={busy ? () => {} : onClose} width={720}
      footer={<><button className="amg-btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={busy} onClick={guardar}>{busy ? "Guardando..." : "Guardar"}</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10 }}>{ui.fmtDate(row.day)} · {row.producto || "-"}. Corrige lo que se cerró mal; las columnas de cierre y el CSV del histórico se actualizan. Queda registrado en la auditoría.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>{lbl("Técnico")}<ui.SearchSelect options={[{ value: "", label: "Sin técnico" }, ...techOpts]} value={f.technician_id} onChange={(v) => setF({ ...f, technician_id: v })} placeholder="Buscar técnico..." /></div>
        <div>{lbl("Apoyo")}<ui.SearchSelect options={[{ value: "", label: "Sin apoyo" }, ...techOpts]} value={f.apoyoId} onChange={(v) => setF({ ...f, apoyoId: v })} placeholder="Buscar técnico..." /></div>
        <div>{lbl("Resultado")}<select className="amg-select" value={f.resultado} onChange={(e) => setF({ ...f, resultado: e.target.value })}><option>Realizado</option><option>No realizado</option></select></div>
        <div>{lbl("Estado Extreme")}<select className="amg-select" value={f.estado_extreme} onChange={(e) => setF({ ...f, estado_extreme: e.target.value })}><option value="">-</option><option>Realizado</option><option>No realizado</option></select></div>
        <div>{lbl("Causal Extreme")}<input className="amg-input" value={f.causal_extreme} onChange={(e) => setF({ ...f, causal_extreme: e.target.value })} /></div>
        <div>{lbl("Causal auditada")}<select className="amg-select" value={f.causal_auditada} onChange={(e) => setF({ ...f, causal_auditada: e.target.value })}><option value="">Sin auditar</option>{causales.map((n) => <option key={n}>{n}</option>)}</select></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Diagnóstico")}<textarea className="amg-textarea" rows={2} value={f.diagnostico} onChange={(e) => setF({ ...f, diagnostico: e.target.value })} /></div>
        <div>{lbl("Cliente")}<input className="amg-input" value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} /></div>
        <div>{lbl("Ciudad")}<input className="amg-input" value={f.ciudad} onChange={(e) => setF({ ...f, ciudad: e.target.value })} /></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Dirección")}<input className="amg-input" value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
        <div>{lbl("Barrio")}<input className="amg-input" value={f.barrio} onChange={(e) => setF({ ...f, barrio: e.target.value })} /></div>
        <div>{lbl("Primer piso")}<select className="amg-select" value={f.primer_piso} onChange={(e) => setF({ ...f, primer_piso: e.target.value })}><option value="">-</option><option>SI</option><option>NO</option></select></div>
        <div>{lbl("Solución")}<input className="amg-input" value={f.solucion} onChange={(e) => setF({ ...f, solucion: e.target.value })} /></div>
        <div>{lbl("Notas")}<input className="amg-input" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></div>
      </div>
      {error && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {error}</div>}
    </ui.Modal>
  );
}

export default function HistoricoModule({ db, ui, session, persist, addAudit }) {
  const esAdmin = !!session && session.role === "admin";
  const [editando, setEditando] = useState(null);
  const [cambiosOpen, setCambiosOpen] = useState(false); // quién modificó los registros del histórico (solo administrador)
  const hoy = ui.todayISO();
  const [from, setFrom] = useState(addDays(hoy, -2)); // por defecto los últimos 3 días (hoy y los 2 anteriores); los botones de la derecha amplían el rango
  const [to, setTo] = useState(hoy);
  const [regionQ, setRegionQ] = useState("");
  const [techQ, setTechQ] = useState("");
  const [resQ, setResQ] = useState("");
  const [rows, setRows] = useState([]);
  const [regionInfo, setRegionInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("tecnico");
  const [page, setPage] = useState(0);
  const [servicioQ, setServicioQ] = useState(""); // buscador de la pestaña Detalle de servicios
  const [verAnulados, setVerAnulados] = useState(false); // mostrar también los registros anulados en el detalle
  const [anulando, setAnulando] = useState(null); // registro por anular (solo administrador)
  const [motivo, setMotivo] = useState("");
  const [busyAnular, setBusyAnular] = useState(false);
  const [errAnular, setErrAnular] = useState("");
  const [cierres, setCierres] = useState(null); // cierres de Extreme del rango (null = sin leer)
  const [cierresError, setCierresError] = useState("");
  const [cierreQ, setCierreQ] = useState(""); // filtro del detalle: "" todos | mismo | otro | sin
  const [errCierre, setErrCierre] = useState("");
  const [recargaCierres, setRecargaCierres] = useState(0); // para volver a leer los cierres de Extreme (por ejemplo si se acaba de cargar el reporte en Carga)
  // Reprogramar un servicio auditado con una causal PENDIENTE: el servicio ya volvió a Pendientes (con toda su información); aquí solo se elige la fecha en que vuelve a Asignación.
  const puedeRepro = !!session && (session.role === "admin" || session.role === "operador");
  const [repro, setRepro] = useState(null); // { row, pendientes }
  const [reproFecha, setReproFecha] = useState("");
  const [reproTec, setReproTec] = useState(""); // técnico (opcional): si se elige, el servicio pasa directo a Carga con él; si no, vuelve a Asignación
  const [reproApoyo, setReproApoyo] = useState("");
  const [reproBusy, setReproBusy] = useState(false);
  const [reproError, setReproError] = useState("");
  const [reproMsg, setReproMsg] = useState("");

  useEffect(() => { loadRegionInfo().then(setRegionInfo); }, []);
  const [pqrDe, setPqrDe] = useState(() => new Map()); // código de solicitud → número de PQR, para buscar por PQR las filas que salieron de la Asignación
  useEffect(() => { pqrPorSolicitud().then(setPqrDe); }, []);
  const pqrDeFila = (r) => pqrDe.get(solicitudDeServicio(r.servicio)) || "";
  const zona = useZonaCoord(db); // coordinador del departamento, para el CSV
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    fetchHistory({ from, to, incluirAnulados: true }).then((r) => { if (alive) setRows(r); }).catch((e) => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to]);
  useEffect(() => { setPage(0); }, [regionQ, techQ, resQ, from, to, tab, servicioQ, cierreQ]);

  // Cierre en Extreme: solo se leen los cierres cuando se mira el detalle (la hoja cierre_extreme se llena al cargar el reporte de Extreme en Carga).
  // Primero los cierres del rango de fechas (más unos días de gracia) y después, por número de servicio, los de los servicios que no salieron ahí: un servicio de hace días que se cerró
  // en Extreme hoy queda fuera de esa ventana y, sin esto, aparecería "Sin dato".
  const serviciosClave = useMemo(() => [...new Set(rows.map((r) => String(r.servicio || "")).filter(Boolean))].sort().join("|"), [rows]);
  useEffect(() => {
    if (tab !== "detalle") return undefined;
    let alive = true;
    setCierres(null); setCierresError("");
    (async () => {
      const c = await cargarCierresParaHistorico({ from, to });
      const con = new Set(c.map((x) => String(x.servicio)));
      const faltan = serviciosClave ? serviciosClave.split("|").filter((s) => !con.has(s)) : [];
      const extra = faltan.length ? await cargarCierresPorServicio(faltan) : [];
      if (alive) setCierres([...c, ...extra]);
    })().catch((e) => { if (alive) setCierresError(e.message); });
    return () => { alive = false; };
  }, [tab, from, to, serviciosClave, recargaCierres]);
  const validacion = useMemo(() => (cierres ? cierreMismoDia(rows, cierres) : null), [rows, cierres]);
  // Estado de cada registro: lo que dice Extreme, o lo marcado a mano ("Cumplió" / "No cumplió") cuando el servicio no está en Extreme.
  const cierreDe = (r) => {
    if (!validacion) return null;
    const v = validacion.get(r.id) || { estado: "sin" };
    if (v.estado !== "sin") return { ...v, origen: "extreme" };
    return r.cierre_manual ? { estado: r.cierre_manual === "Cumplió" ? "mismo" : "otro", manual: r.cierre_manual, origen: "manual" } : { estado: "sin", origen: "sin" };
  };
  const completarCierre = async (r, valor) => {
    setErrCierre("");
    try {
      const guardado = await updateHistoryRow(r.id, { cierre_manual: valor });
      setRows((rs) => rs.map((x) => (x.id === guardado.id ? guardado : x)));
      if (persist && addAudit) persist(addAudit(db, { userId: session.id, action: valor ? "Cierre en Extreme completado a mano (histórico)" : "Cierre en Extreme a mano quitado (histórico)", record: `${r.servicio} · ${r.day}`, oldValue: r.cierre_manual || "-", newValue: valor || "-" }));
    } catch (e) { setErrCierre(`${e.message}. Si es la primera vez, falta correr el SQL del cierre en Extreme a mano (sql/77) en Supabase.`); }
  };

  // Servicios que siguen Pendientes (sin finalizar ni cancelar) por número de servicio, y qué causales son «Pendiente» (Maestros → Causales; también las que lo dicen en su nombre).
  const gestionDe = useMemo(() => gestionDeCausal(db.causales), [db.causales]);
  const pendientesPorServicio = useMemo(() => {
    const m = new Map();
    (db.services || []).forEach((s) => { if (s.servicioExterno && s.estadoGestion === "Pendiente" && !s.finalizedAt && !(s.asig && (s.asig.cancelada || s.asig.anulada))) { const k = String(s.servicioExterno); m.set(k, [...(m.get(k) || []), s]); } });
    return m;
  }, [db.services]);
  const esPendienteAuditado = (r) => !r.anulado && !!r.causal_auditada && gestionDe(r.causal_auditada) === "Pendiente";
  const proximoDiaHabil = () => { const d = new Date(`${hoy}T12:00:00`); d.setDate(d.getDate() + 1); if (d.getDay() === 0) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };
  const tecnicosCampo = useMemo(() => (db.technicians || []).filter((t) => t.status === "Activo" && t.category !== "Administrativo").sort((a, b) => a.name.localeCompare(b.name, "es")), [db.technicians]);
  const abrirRepro = (r, pendientes) => { setRepro({ row: r, pendientes }); setReproFecha(proximoDiaHabil()); setReproTec(""); setReproApoyo(""); setReproError(""); setReproMsg(""); };
  const confirmarRepro = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reproFecha) || reproFecha < hoy) { setReproError("Elige una fecha de hoy en adelante."); return; }
    const tec = reproTec ? tecnicosCampo.find((t) => t.id === reproTec) : null;
    const apoyo = tec && reproApoyo ? tecnicosCampo.find((t) => t.id === reproApoyo) : null;
    if (reproTec && !tec) { setReproError("El técnico elegido no está activo."); return; }
    if (tec && apoyo && tec.id === apoyo.id) { setReproError("El apoyo debe ser distinto del técnico."); return; }
    setReproBusy(true); setReproError("");
    try {
      const ids = new Set(repro.pendientes.map((s) => s.id));
      const antes = repro.pendientes.map((s) => s.date).sort()[0] || repro.row.day;
      const ahora = new Date().toISOString();
      // Con técnico: pasa directo a Carga En gestión con él, igual que lo hace Enviar a Carga (orden de ruta al final de la de ese técnico ese día; todos los productos del servicio comparten el orden).
      const orden = tec ? (db.services || []).filter((s) => s.technicianId === tec.id && s.date === reproFecha && s.estadoGestion === "En gestión").reduce((m, s) => Math.max(m, s.rutaOrden || 0), 0) + 1 : null;
      const services = (db.services || []).map((s) => {
        if (!ids.has(s.id)) return s;
        const { devueltoFecha, ...asigBase } = s.asig || {};
        const marca = { reprogramadoDe: s.date, reprogramadoEn: ahora, reprogramadoPor: session.id };
        if (!tec) return { ...s, date: reproFecha, fechaProg: reproFecha, asig: s.asig ? { ...s.asig, ...marca } : s.asig };
        return { ...s, date: reproFecha, fechaProg: reproFecha, technicianId: tec.id, tecnico2Nombre: tec.name, tecnico3Nombre: apoyo ? apoyo.name : "", rutaOrden: orden, estadoGestion: "En gestión",
          asig: s.asig ? { ...asigBase, ...marca, tecnicoOriginal: { id: tec.id, nombre: tec.name } } : s.asig };
      });
      const ok = await persist(addAudit({ ...db, services }, { userId: session.id, action: "Reprogramación desde el histórico de asignación", record: String(repro.row.servicio), oldValue: `pendiente desde ${ui.fmtDate(antes)}`,
        newValue: `reprogramado para ${ui.fmtDate(reproFecha)} (${ids.size} producto(s))${tec ? `, asignado a ${tec.name}${apoyo ? ` con apoyo ${apoyo.name}` : ""} y enviado a Carga` : ", pendiente en Asignación"}` }));
      if (ok === false) throw new Error("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
      setReproMsg(`Servicio ${repro.row.servicio} reprogramado para el ${ui.fmtDate(reproFecha)}: ${ids.size} producto(s) ${tec ? `pasaron a Carga En gestión con ${tec.name.replace(/_/g, " ")}.` : "quedan Pendientes en Asignación para esa fecha."}`);
      setRepro(null);
    } catch (e) { setReproError(e.message || String(e)); }
    setReproBusy(false);
  };

  const label = (r) => (regionInfo ? regionInfo.label(r) : r === null || r === undefined ? "Sin región" : `Región ${r}`);
  const orderOf = useMemo(() => Object.fromEntries(db.technicians.map((t) => [t.id, t.assignOrder ?? 9999])), [db.technicians]);

  // Los anulados no cuentan en nada (totales, graficos, por tecnico, CSV): solo se ven en el detalle si se pide.
  const activos = useMemo(() => rows.filter((r) => !r.anulado), [rows]);
  const regiones = useMemo(() => Array.from(new Set(activos.map((r) => r.region).filter((r) => r !== null))).sort((a, b) => a - b), [activos]);
  const tecnicos = useMemo(() => Array.from(new Set(activos.map((r) => r.technician_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es")), [activos]);
  const pasa = (r) => (!regionQ || String(r.region) === regionQ) && (!techQ || r.technician_name === techQ) && (!resQ || r.resultado === resQ);
  const f = useMemo(() => activos.filter(pasa), [activos, regionQ, techQ, resQ]);
  const anuladosVisibles = useMemo(() => rows.filter((r) => r.anulado && pasa(r)), [rows, regionQ, techQ, resQ]);

  const tot = useMemo(() => {
    const prod = f.reduce((s, r) => s + (Number(r.quantity) || 1), 0);
    const rea = f.filter((r) => r.resultado === "Realizado").reduce((s, r) => s + (Number(r.quantity) || 1), 0);
    return {
      dias: new Set(f.map((r) => r.day)).size, servicios: new Set(f.map((r) => `${r.day}|${r.servicio}`)).size,
      movimientos: new Set(f.map((r) => `${r.day}|${r.ciudad}|${r.direccion}`)).size, productos: prod, realizados: rea, noRealizados: prod - rea,
      minutos: f.reduce((s, r) => s + (r.tiempo_min || 0), 0),
    };
  }, [f]);

  const porDia = useMemo(() => {
    const m = {};
    f.forEach((r) => { const g = (m[r.day] = m[r.day] || { dia: r.day, Realizados: 0, "No realizados": 0 }); g[r.resultado === "Realizado" ? "Realizados" : "No realizados"] += Number(r.quantity) || 1; });
    return Object.values(m).sort((a, b) => a.dia.localeCompare(b.dia)).map((g) => ({ ...g, etiqueta: shortDay(g.dia) }));
  }, [f]);
  const porRegion = useMemo(() => {
    const m = {};
    f.forEach((r) => { const k = r.region ?? "?"; const g = (m[k] = m[k] || { region: k, Realizados: 0, "No realizados": 0 }); g[r.resultado === "Realizado" ? "Realizados" : "No realizados"] += Number(r.quantity) || 1; });
    return Object.values(m).sort((a, b) => Number(a.region) - Number(b.region)).map((g) => ({ ...g, etiqueta: label(g.region === "?" ? null : Number(g.region)) }));
  }, [f, regionInfo]);
  const porTecnico = useMemo(() => aggregateHistory(f).sort((a, b) => (a.region ?? 999) - (b.region ?? 999) || (orderOf[a.techId] ?? 9999) - (orderOf[b.techId] ?? 9999) || a.name.localeCompare(b.name, "es")), [f, orderOf]);
  const topTec = useMemo(() => [...porTecnico].sort((a, b) => b.realizados - a.realizados).slice(0, 10).map((g) => ({ name: g.name, Realizados: g.realizados, "No realizados": g.noRealizados })), [porTecnico]);
  const causales = useMemo(() => {
    const m = {};
    f.filter((r) => r.resultado === "No realizado").forEach((r) => { const k = r.causal_auditada || r.causal_extreme || "Sin causal"; m[k] = (m[k] || 0) + (Number(r.quantity) || 1); });
    return Object.entries(m).map(([name, value]) => ({ name: name.length > 34 ? name.slice(0, 34) + "…" : name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [f]);

  // Buscador por servicio: uno o varios números separados por espacio, coma o salto de línea (también encuentra por número de PQR o parte del número).
  const terminos = useMemo(() => servicioQ.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean), [servicioQ]);
  const detalle = useMemo(() => [...f, ...(verAnulados ? anuladosVisibles : [])].filter((r) => !terminos.length || terminos.some((x) => `${String(r.servicio || "").toUpperCase()} ${pqrDeFila(r)}`.includes(x))).filter((r) => { if (!cierreQ) return true; const c = cierreDe(r); return !!c && c.estado === cierreQ; }).sort((a, b) => b.day.localeCompare(a.day) || (a.region ?? 999) - (b.region ?? 999) || (orderOf[a.technician_id] ?? 9999) - (orderOf[b.technician_id] ?? 9999) || (a.ruta_orden ?? 999) - (b.ruta_orden ?? 999)), [f, anuladosVisibles, verAnulados, orderOf, terminos, pqrDe, cierreQ, validacion]);
  const PAGE = 50;

  const exportTec = () => ui.downloadCSV("historico_por_tecnico.csv",
    ["Región", "Técnico", "Servicios", "Movimientos (direcciones)", "Productos", "Minutos de producto", "Realizados", "No realizados", "% efectividad"],
    porTecnico.map((g) => [label(g.region), g.name, g.servicios, g.movimientos, g.productos, g.minutos, g.realizados, g.noRealizados, `${pct(g.realizados, g.productos)}%`]));
  // Usuarios de Extreme: del técnico (por su ficha en Personal) y del apoyo (por nombre), según Personal hoy.
  const extremeDeTecnico = (r) => { const t = db.technicians.find((x) => x.id === r.technician_id) || db.technicians.find((x) => plano(x.name) === plano(r.technician_name)); return (t && t.extremeUser) || ""; };
  const extremeDeApoyo = (r) => { const t = r.helper_name ? db.technicians.find((x) => plano(x.name) === plano(r.helper_name)) : null; return (t && t.extremeUser) || ""; };
  // Mismo CSV que el de Carga (mismas columnas y orden). Los días cerrados desde este cambio guardan la fila completa; los anteriores se arman con lo que se guardó.
  // Al final del CSV va FECHA DE ARMADO: en los armados en almacén, el día en que se armaron los productos (la columna FECHA es el día en que se cerró el PQR); en las demás filas es el mismo día de FECHA.
  const exportDet = async () => {
    const ctx = { technicians: db.technicians, regionLabel: label, coordDe: (d) => zona.coordDe(d) };
    const orden = [...detalle].filter((r) => !r.anulado).sort((a, b) => b.day.localeCompare(a.day) || (a.csv_orden ?? 1e9) - (b.csv_orden ?? 1e9));
    const filas = filasCsvDeHistorico({ rows: orden, services: db.services, technicians: db.technicians, causales: db.causales, regionLabel: label, coordDe: ctx.coordDe, empresaDe: regionInfo ? regionInfo.empresaDe : undefined });
    let armadoEn = new Map();
    try { armadoEn = await fechasDeArmado(orden); } catch (e) { /* sin leer los armados: la columna usa el día de la fila */ }
    // Al final: ¿el cierre en Extreme fue el mismo día? (lo que dice Extreme, o lo marcado a mano si el servicio no está en Extreme) y el día en que cerró.
    const cierreTxt = (r) => { const c = cierreDe(r); if (!c) return ["", ""]; if (c.origen === "extreme") return [c.estado === "mismo" ? "Mismo día" : "Otro día", ddmmyyyy(c.dia)]; if (c.origen === "manual") return [`${c.manual} (a mano)`, ""]; return ["Sin dato", ""]; };
    ui.downloadCSV("historico_detalle.csv", [...CSV_CARGA_HEADERS, "FECHA DE ARMADO", "CIERRE EXTREME", "FECHA CIERRE EXTREME"], filas.map((fila, i) => [...fila, ddmmyyyy(armadoEn.get(orden[i].service_id) || orden[i].day), ...cierreTxt(orden[i])]));
  };

  const confirmarAnular = async () => {
    setBusyAnular(true); setErrAnular("");
    try {
      const guardado = await anularHistoryRow(anulando.id, motivo);
      setRows((rs) => rs.map((x) => (x.id === guardado.id ? guardado : x)));
      if (persist && addAudit) persist(addAudit(db, { userId: session.id, action: "Anulación de registro del histórico de asignación", record: `${anulando.servicio} · ${anulando.day}`, oldValue: anulando.producto || "-", newValue: motivo.trim().slice(0, 480) }));
      setAnulando(null); setMotivo("");
    } catch (e) { setErrAnular(`${e.message}. Si es la primera vez, falta correr el SQL de anular histórico (sql/60) en Supabase.`); }
    setBusyAnular(false);
  };
  const restaurar = async (r) => {
    setErrAnular("");
    try {
      const guardado = await restaurarHistoryRow(r.id);
      setRows((rs) => rs.map((x) => (x.id === guardado.id ? guardado : x)));
      if (persist && addAudit) persist(addAudit(db, { userId: session.id, action: "Restauración de registro del histórico de asignación", record: `${r.servicio} · ${r.day}`, oldValue: r.producto || "-", newValue: `Estaba anulado: ${r.anulado_motivo || "-"}`.slice(0, 480) }));
    } catch (e) { setErrAnular(e.message); }
  };

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label className="amg-label" style={{ margin: 0 }}>Desde</label>
        <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <label className="amg-label" style={{ margin: 0 }}>Hasta</label>
        <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <select className="amg-select" style={{ width: 190 }} value={regionQ} onChange={(e) => setRegionQ(e.target.value)}>
          <option value="">Todas las regiones</option>{regiones.map((r) => <option key={r} value={String(r)}>{label(r)}</option>)}
        </select>
        <select className="amg-select" style={{ width: 200 }} value={techQ} onChange={(e) => setTechQ(e.target.value)}>
          <option value="">Todos los técnicos</option>{tecnicos.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="amg-select" style={{ width: 150 }} value={resQ} onChange={(e) => setResQ(e.target.value)}>
          <option value="">Todo resultado</option><option>Realizado</option><option>No realizado</option>
        </select>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[["3 días", 2], ["7 días", 6], ["30 días", 29], ["90 días", 89]].map(([t, n]) => <button key={t} className="amg-btn" onClick={() => { setFrom(addDays(hoy, -n)); setTo(hoy); }}>{t}</button>)}
        </div>
      </div>

      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}. Si es la primera vez, falta correr el SQL del histórico (sql/18) en Supabase.</div>}
      {loading && <div style={{ color: "var(--text-faint)", marginBottom: 10 }}>Cargando histórico...</div>}
      {errAnular && !anulando && <div className="amg-alert danger"><AlertTriangle size={14} /> {errAnular}</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="amg-card" style={{ padding: 24, textAlign: "center", color: "var(--text-dim)" }}>
          Aún no hay días finalizados en este rango. El histórico se llena cuando en <b>Carga → Auditoría / Edición</b> pulsas <b>Finalizar día</b>.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
            <ui.StatCard label="Días finalizados" value={fmt(tot.dias)} />
            <ui.StatCard label="Servicios" value={fmt(tot.servicios)} sub={`${fmt(tot.movimientos)} movimientos`} />
            <ui.StatCard label="Productos asignados" value={fmt(tot.productos)} sub={`${fmt(tot.minutos)} min de producto`} />
            <ui.StatCard label="Efectividad" value={`${pct(tot.realizados, tot.productos)}%`} sub={`${fmt(tot.realizados)} realizados`} accent />
            <ui.StatCard label="No realizados" value={fmt(tot.noRealizados)} sub="volvieron a pendientes" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px,1fr))", gap: 14, marginBottom: 16 }}>
            <Panel title="Productos por día (realizados vs. no realizados)">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={porDia}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="etiqueta" tick={{ fill: AXIS, fontSize: 10 }} /><YAxis tick={{ fill: AXIS, fontSize: 10 }} />
                  <Tooltip /><Legend /><Bar dataKey="Realizados" stackId="a" fill={GREEN} /><Bar dataKey="No realizados" stackId="a" fill={RED} /></BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Por región">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={porRegion}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="etiqueta" tick={{ fill: AXIS, fontSize: 10 }} /><YAxis tick={{ fill: AXIS, fontSize: 10 }} />
                  <Tooltip /><Legend /><Bar dataKey="Realizados" stackId="a" fill={GREEN} /><Bar dataKey="No realizados" stackId="a" fill={RED} /></BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Top 10 técnicos (productos realizados)">
              <ResponsiveContainer width="100%" height={Math.max(220, topTec.length * 26)}>
                <BarChart data={topTec} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis type="number" tick={{ fill: AXIS, fontSize: 10 }} /><YAxis type="category" dataKey="name" width={150} tick={{ fill: AXIS, fontSize: 10 }} />
                  <Tooltip /><Legend /><Bar dataKey="Realizados" stackId="a" fill={GREEN} /><Bar dataKey="No realizados" stackId="a" fill={RED} /></BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Causales de lo no realizado (top 8)">
              {causales.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 13, padding: 20 }}>No hay productos no realizados en este rango.</div> : (
                <ResponsiveContainer width="100%" height={Math.max(220, causales.length * 28)}>
                  <BarChart data={causales} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis type="number" tick={{ fill: AXIS, fontSize: 10 }} /><YAxis type="category" dataKey="name" width={190} tick={{ fill: AXIS, fontSize: 10 }} />
                    <Tooltip /><Bar dataKey="value" name="Productos" fill={ACCENT} /></BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 12 }}>
            <div className={`amg-tab ${tab === "tecnico" ? "active" : ""}`} onClick={() => setTab("tecnico")}>Por técnico</div>
            <div className={`amg-tab ${tab === "detalle" ? "active" : ""}`} onClick={() => setTab("detalle")}>Detalle de servicios</div>
            {tab === "detalle" && (
              <input className="amg-input" style={{ width: 260, marginLeft: 12, marginBottom: 6 }} placeholder="Buscar servicio (uno o varios números)..." value={servicioQ} onChange={(e) => setServicioQ(e.target.value)} />
            )}
            {tab === "detalle" && (
              <select className="amg-select" style={{ width: 200, marginLeft: 12, marginBottom: 6 }} value={cierreQ} onChange={(e) => setCierreQ(e.target.value)} title="Compara el día en que se cerró el producto en Extreme con el día del servicio">
                <option value="">Cierre Extreme: todos</option><option value="mismo">Cerró el mismo día</option><option value="otro">Cerró otro día / no cumplió</option><option value="sin">Sin dato (completar a mano)</option>
              </select>
            )}
            {tab === "detalle" && <button className="amg-btn" style={{ marginLeft: 6, marginBottom: 6 }} title="Vuelve a leer los cierres de Extreme (por ejemplo si acabas de cargar el reporte de Extreme en Carga)" onClick={() => setRecargaCierres((n) => n + 1)}>↻ Cierres</button>}
            {tab === "detalle" && esAdmin && rows.some((r) => r.anulado) && (
              <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center", marginLeft: 12, marginBottom: 6 }}><input type="checkbox" checked={verAnulados} onChange={(e) => setVerAnulados(e.target.checked)} /> Ver anulados ({anuladosVisibles.length})</label>
            )}
            {esAdmin && <button className="amg-btn" style={{ marginLeft: "auto", marginBottom: 6 }} title="Solo administrador: quién modificó los registros, qué cambió y cuándo (auditoría)" onClick={() => setCambiosOpen(true)}><History size={14} /> Ver cambios</button>}
            <button className="amg-btn" style={{ marginLeft: esAdmin ? 8 : "auto", marginBottom: 6 }} onClick={tab === "tecnico" ? exportTec : exportDet}><Download size={14} /> Exportar CSV</button>
          </div>

          {tab === "tecnico" && (
            <div className="amg-card" style={{ overflowX: "auto" }}>
              <table className="amg-table">
                <thead><tr><th>Región</th><th>Técnico</th><th>Servicios</th><th>Movimientos</th><th>Productos</th><th>Minutos</th><th>Realizados</th><th>No realizados</th><th>Efectividad</th></tr></thead>
                <tbody>{porTecnico.map((g) => (
                  <tr key={`${g.techId}|${g.name}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{label(g.region)}</td><td>{g.name}</td>
                    <td className="amg-mono">{g.servicios}</td><td className="amg-mono">{g.movimientos}</td><td className="amg-mono">{g.productos}</td><td className="amg-mono">{fmt(g.minutos)}</td>
                    <td className="amg-mono" style={{ color: "var(--green)" }}>{g.realizados}</td><td className="amg-mono" style={{ color: g.noRealizados ? "var(--red)" : undefined }}>{g.noRealizados}</td>
                    <td className="amg-mono">{pct(g.realizados, g.productos)}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {tab === "detalle" && (
            <div>
              {reproMsg && <div className="amg-alert" style={{ marginBottom: 10, background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {reproMsg}</div>}
              {errCierre && <div className="amg-alert danger" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> {errCierre}</div>}
              {cierresError && <div className="amg-alert warn" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> No se pudieron leer los cierres de Extreme ({cierresError}). Si es la primera vez, revisa que esté el SQL del cierre en línea (sql/54).</div>}
              <div className="amg-card" style={{ overflowX: "auto" }}>
                <table className="amg-table" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Día</th><th>Región</th><th>Técnico</th><th>#</th><th>Servicio</th><th>Producto</th><th>Ciudad</th><th>Barrio</th><th>Dirección</th><th>Resultado</th><th>Causal</th><th title="¿El cierre en Extreme se hizo el mismo día del servicio? Sale del reporte de Extreme cargado; lo que no está en Extreme se completa a mano (Cumplió / No cumplió)">Cierre Extreme</th>{puedeRepro && <th title="Solo para los servicios auditados con una causal PENDIENTE que siguen pendientes: elige la fecha y vuelven a Asignación">Reprogramar</th>}{esAdmin && <th></th>}</tr></thead>
                  <tbody>{detalle.length === 0 && <tr><td colSpan={12 + (esAdmin ? 1 : 0) + (puedeRepro ? 1 : 0)} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{terminos.length ? "Ningún servicio coincide con la búsqueda en este rango de fechas." : "Sin registros para estos filtros."}</td></tr>}{detalle.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                    <tr key={r.id} style={r.anulado ? { opacity: 0.55, textDecoration: "line-through" } : undefined} title={r.anulado ? `Anulado: ${r.anulado_motivo || "-"}` : undefined}>
                      <td className="amg-mono">{ui.fmtDate(r.day)}</td><td style={{ whiteSpace: "nowrap" }}>{label(r.region)}</td><td>{r.technician_name || "-"}</td><td className="amg-mono">{r.ruta_orden ?? "-"}</td>
                      <td className="amg-mono">{r.servicio}{pqrDeFila(r) && <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>PQR {pqrDeFila(r)}</div>}</td><td>{r.producto}</td><td>{r.ciudad || "-"}</td><td>{r.barrio || "-"}</td><td><ui.HoverText text={r.direccion} maxChars={30} /></td>
                      <td>{r.anulado ? <ui.Badge text="Anulado" color="amber" /> : <ui.Badge text={r.resultado} color={r.resultado === "Realizado" ? "green" : "red"} />}</td><td>{r.causal_auditada || r.causal_extreme || "-"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{(() => {
                        if (r.anulado) return "-";
                        const c = cierreDe(r);
                        if (!c) return <span style={{ color: "var(--text-faint)" }} title={cierresError || "Leyendo los cierres de Extreme..."}>{cierresError ? "sin leer" : "..."}</span>;
                        const quien = r.cierre_manual_por ? ((db.users || []).find((u) => u.id === r.cierre_manual_por) || {}).name : "";
                        if (c.origen === "extreme") return <span title={`Cerrado en Extreme el ${ui.fmtDate(c.dia)}${c.hora ? ` a las ${c.hora}` : ""}`}><ui.Badge text={c.estado === "mismo" ? "Mismo día" : "Otro día"} color={c.estado === "mismo" ? "green" : "red"} /><div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{c.estado === "mismo" ? (c.hora || "") : `cerró ${shortDay(c.dia)}${c.hora ? ` ${c.hora}` : ""}`}</div></span>;
                        if (c.origen === "manual") return <span title={`Completado a mano${quien ? ` por ${quien}` : ""}${r.cierre_manual_at ? ` el ${ui.fmtDate(String(r.cierre_manual_at).slice(0, 10))}` : ""}. No está en el reporte de Extreme.`}><ui.Badge text={c.manual} color={c.manual === "Cumplió" ? "green" : "red"} /><div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>a mano{esAdmin && <button className="amg-btn ghost" style={{ padding: "0 4px", marginLeft: 4, fontSize: 10.5 }} title="Quitar lo marcado a mano" onClick={() => completarCierre(r, null)}>✕</button>}</div></span>;
                        return <span title="Este servicio no aparece en el reporte de Extreme cargado"><ui.Badge text="Sin dato" color="amber" />{esAdmin && <div style={{ display: "flex", gap: 4, marginTop: 3 }}>
                          <button className="amg-btn" style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => completarCierre(r, "Cumplió")}>Cumplió</button>
                          <button className="amg-btn" style={{ padding: "1px 6px", fontSize: 11 }} onClick={() => completarCierre(r, "No cumplió")}>No cumplió</button></div>}</span>;
                      })()}</td>
                      {puedeRepro && <td style={{ whiteSpace: "nowrap" }}>{(() => {
                        if (!esPendienteAuditado(r)) return null;
                        const pend = pendientesPorServicio.get(String(r.servicio));
                        if (!pend || !pend.length) return <span style={{ fontSize: 11, color: "var(--text-faint)" }} title="Este servicio ya no está pendiente: se asignó de nuevo o ya se cerró">ya gestionado</span>;
                        const desde = pend.map((s) => s.date).sort()[0];
                        return <><button className="amg-btn" style={{ padding: "2px 8px", fontSize: 11.5 }} title="Reprogramar: elige solo la fecha, el servicio conserva toda su información" onClick={() => abrirRepro(r, pend)}><CalendarClock size={12} /> Reprogramar</button>
                          <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 }}>pendiente para {shortDay(desde)}</div></>;
                      })()}</td>}
                      {esAdmin && <td style={{ whiteSpace: "nowrap" }}>
                        {r.anulado
                          ? <button className="amg-btn ghost" style={{ padding: 4 }} title={`Restaurar este registro (anulado: ${r.anulado_motivo || "-"})`} onClick={() => restaurar(r)}><RotateCcw size={13} /></button>
                          : <><button className="amg-btn ghost" style={{ padding: 4 }} title="Editar este registro (solo administrador)" onClick={() => setEditando(r)}><Pencil size={13} /></button>
                            <button className="amg-btn ghost" style={{ padding: 4 }} title="Anular este registro (solo administrador): no cuenta en el histórico ni en los reportes, y se puede restaurar" onClick={() => { setAnulando(r); setMotivo(""); setErrAnular(""); }}><Ban size={13} /></button></>}
                      </td>}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>
                <span>Mostrando {detalle.length ? page * PAGE + 1 : 0}–{Math.min(detalle.length, page * PAGE + PAGE)} de {fmt(detalle.length)}{terminos.length ? ` (filtrado por servicio: ${terminos.join(", ")})` : ""}</span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="amg-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>← Anterior</button>
                  <button className="amg-btn" disabled={(page + 1) * PAGE >= detalle.length} onClick={() => setPage(page + 1)}>Siguiente →</button>
                </span>
              </div>
            </div>
          )}
          {anulando && (
            <ui.ConfirmModal title={`Anular el registro del servicio ${anulando.servicio}`} confirmLabel={busyAnular ? "Anulando..." : "Anular registro"} danger onConfirm={() => { if (motivo.trim() && !busyAnular) confirmarAnular(); }} onClose={() => setAnulando(null)}
              message={`${ui.fmtDate(anulando.day)} · ${anulando.producto || "-"} · ${anulando.technician_name || "sin técnico"}. El registro no se borra: queda anulado con su motivo y deja de contar en el histórico, el CSV, el informe de cierre, el resumen de rutas y los viáticos. Lo puedes restaurar cuando quieras.`}>
              <label className="amg-label">Motivo de la anulación</label><input className="amg-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              {errAnular && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {errAnular}</div>}
            </ui.ConfirmModal>
          )}
          {repro && (
            <ui.Modal title={`Reprogramar el servicio ${repro.row.servicio}`} width={620} onClose={reproBusy ? () => {} : () => setRepro(null)}
              footer={<><button className="amg-btn" disabled={reproBusy} onClick={() => setRepro(null)}>Cancelar</button><button className="amg-btn primary" disabled={reproBusy || !reproFecha} onClick={confirmarRepro}><Check size={14} /> {reproBusy ? "Reprogramando..." : `Reprogramar para el ${reproFecha ? ui.fmtDate(reproFecha) : "..."}${reproTec ? " y enviar a Carga" : ""}`}</button></>}>
              <div style={{ fontSize: 13 }}>
                <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: 12.5 }}>
                  <div><span style={{ color: "var(--text-faint)" }}>Cliente</span><br />{repro.row.cliente || (repro.pendientes[0] && repro.pendientes[0].clienteNombre) || "-"}</div>
                  <div><span style={{ color: "var(--text-faint)" }}>Dirección</span><br />{repro.row.direccion || (repro.pendientes[0] && repro.pendientes[0].direccion) || "-"}</div>
                  <div><span style={{ color: "var(--text-faint)" }}>Ciudad · barrio</span><br />{repro.row.ciudad || "-"} · {repro.row.barrio || "-"}</div>
                  <div><span style={{ color: "var(--text-faint)" }}>Departamento</span><br />{repro.row.departamento || "-"}</div>
                  <div><span style={{ color: "var(--text-faint)" }}>Último intento</span><br />{ui.fmtDate(repro.row.day)} · {repro.row.technician_name || "sin técnico"}</div>
                  <div><span style={{ color: "var(--text-faint)" }}>Causal auditada</span><br />{repro.row.causal_auditada}</div>
                </div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Productos que vuelven a Asignación ({repro.pendientes.length})</div>
                <div className="amg-card" style={{ overflow: "auto", maxHeight: 160, marginBottom: 12 }}>
                  <table className="amg-table compact" style={{ fontSize: 12.5 }}><thead><tr><th>Producto</th><th>Min</th><th>Pendiente para</th></tr></thead>
                    <tbody>{repro.pendientes.map((s) => <tr key={s.id}><td>{s.productoExternoNombre || "-"}</td><td className="amg-mono">{s.tiempoMin ? fmt(s.tiempoMin) : "-"}</td><td className="amg-mono">{ui.fmtDate(s.date)}</td></tr>)}</tbody></table>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 12, alignItems: "start" }}>
                  <div><label className="amg-label">Nueva fecha</label>
                    <input type="date" className="amg-input" min={hoy} value={reproFecha} onChange={(e) => setReproFecha(e.target.value)} autoFocus /></div>
                  <div><label className="amg-label">Técnico (opcional)</label>
                    <select className="amg-select" value={reproTec} onChange={(e) => { setReproTec(e.target.value); if (!e.target.value) setReproApoyo(""); }}>
                      <option value="">Sin técnico: vuelve a Asignación</option>
                      {tecnicosCampo.map((t) => <option key={t.id} value={t.id}>{t.name.replace(/_/g, " ")}{repro.row.technician_id === t.id ? " (el del último intento)" : ""}</option>)}
                    </select></div>
                </div>
                {reproTec && (
                  <div style={{ marginTop: 10 }}><label className="amg-label">Apoyo (opcional)</label>
                    <select className="amg-select" value={reproApoyo} onChange={(e) => setReproApoyo(e.target.value)}>
                      <option value="">Sin apoyo</option>
                      {tecnicosCampo.filter((t) => t.id !== reproTec).map((t) => <option key={t.id} value={t.id}>{t.name.replace(/_/g, " ")}</option>)}
                    </select></div>
                )}
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>El servicio conserva toda su información (cliente, dirección, zona, tiempos).
                  {reproTec ? " Con técnico, pasa directo a Carga En gestión para esa fecha, con su orden de ruta (no vuelve a Asignación). Si hace falta cambiar otro dato, usa el lápiz en Carga." : " Sin técnico, queda Pendiente en Asignación y entra a la asignación de ese día o de uno posterior; no aparece antes."}</div>
                {reproError && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {reproError}</div>}
              </div>
            </ui.Modal>
          )}
          {cambiosOpen && <CambiosRegistros db={db} ui={ui} modulo="historico" initialQ={servicioQ} onClose={() => setCambiosOpen(false)} />}
          {editando && <EditarHistoricoModal ui={ui} db={db} row={editando} onClose={() => setEditando(null)} onSave={(guardado, antes) => {
            setRows((rs) => rs.map((x) => (x.id === guardado.id ? guardado : x)));
            setEditando(null);
            const cambios = ["technician_name", "helper_name", "resultado", "estado_extreme", "causal_extreme", "causal_auditada", "diagnostico", "cliente", "direccion", "ciudad", "barrio", "notas", "solucion", "primer_piso"]
              .filter((k) => (antes[k] || "") !== (guardado[k] || "")).map((k) => `${k}: ${antes[k] || "-"} → ${guardado[k] || "-"}`).join("; ");
            if (persist && addAudit) persist(addAudit(db, { userId: session.id, action: "Edición de histórico de asignación", record: `${antes.servicio} · ${antes.day}`, oldValue: antes.producto || "-", newValue: cambios.slice(0, 480) || "sin cambios" }));
          }} />}
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>Efectividad = productos realizados sobre productos asignados. Movimientos = direcciones distintas atendidas el mismo día. Lo no realizado vuelve a pendientes para reasignarse; este histórico conserva el resultado de cada día tal como se cerró.</div>
        </>
      )}
    </div>
  );
}
