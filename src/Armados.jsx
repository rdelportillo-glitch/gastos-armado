import { useState, useEffect, useMemo } from "react";
import { Check, AlertTriangle, Plus, Paperclip, Download, Eye, Pencil, Ban, X, Upload, RotateCcw, Camera, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import * as A from "./lib/armados/armadosData";
import * as Meta from "./lib/armados/armadosMeta";
import { buildSolicitudPdf } from "./lib/armados/armadosPdf";
import { sincronizar } from "./lib/armados/armadosSync";
import * as D from "./lib/asignacion/data";
import { useZonaCoord, SIN_COORD } from "./lib/useCoordinadores";

/* ============================================================================
   ARMADOS EN ALMACÉN
   Solicitud (con consecutivo AA-000001, número de PQR y lista de productos) → armados que registra el técnico en el almacén,
   con fotos → cierre validado (PQR, técnico y fotos) con Excel de soporte.
   Roles: Jamar (cliente) carga y edita las solicitudes PQR; el técnico registra sus armados; el equipo administra y cierra.
============================================================================ */

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };
const fmt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const ESTADO_COLOR = { Abierta: "amber", Cerrada: "green", Cancelada: "gray" };
const COMP_COLOR = { Completo: "green", Parcial: "amber", Pendiente: "red", Excede: "blue", "No solicitado": "gray", "No armado": "red", "Con no armado": "amber" };

export default function ArmadosModule({ db, persist, addAudit, session, ui }) {
  const internal = session.role === "admin" || session.role === "operador";
  const esCliente = session.role === "cliente";
  const esTecnico = session.role === "tecnico";
  const [warehouses, setWarehouses] = useState([]);
  const [requests, setRequests] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [f, setF] = useState({ q: "", estado: "", almacen: "", coord: "", desde: "", hasta: "" });
  const zona = useZonaCoord(db, !esCliente && !esTecnico); // filtro por coordinador (según el departamento del almacén)
  const [form, setForm] = useState(null); // { request? }
  const [importar, setImportar] = useState(false);
  const [detalleId, setDetalleId] = useState(null);
  const [abrirCancelar, setAbrirCancelar] = useState(false); // abre el detalle directamente en el cuadro de cancelación
  const [armadoDe, setArmadoDe] = useState(null); // solicitud a la que se registra un armado

  const recargar = async () => {
    setLoading(true); setError("");
    try {
      const [w, r, a] = await Promise.all([A.listWarehouses(), A.listRequests(), A.listAssemblies()]);
      setWarehouses(w); setRequests(r.reverse()); setAssemblies(a);
    } catch (e) { setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL de Armados en almacén (sql/27).`); }
    setLoading(false);
  };
  useEffect(() => { recargar(); }, []);

  // Sincronización con Asignación (solo el equipo): las unidades pendientes de cada solicitud abierta entran a la asignación de cada día
  // y bajan a medida que se registran armados. Se ejecuta después de cada cambio y con el botón de la barra.
  const [masters, setMasters] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  useEffect(() => { if (internal) D.loadMasters().then(setMasters).catch(() => {}); }, []);
  const sincronizarAsignacion = async (avisar) => {
    if (!internal || !masters) return;
    setSincronizando(true);
    try {
      const r = await sincronizar({ db, persist, addAudit, session, masters, uid: ui.uid, hoy: ui.todayISO() });
      if (r.problemas.length) setError(r.problemas.join(" · "));
      if (r.hayCambios) setMsg((m) => `${m ? `${m} ` : ""}Asignación actualizada: ${r.nuevos} unidad(es) nuevas, ${r.completados} armadas, ${r.retirados} retiradas.`);
      else if (avisar) setMsg("Asignación al día: no hay cambios por sincronizar.");
    } catch (e) { setError(`No se pudo sincronizar con Asignación: ${e.message}`); }
    setSincronizando(false);
  };
  const refrescar = async () => { await recargar(); await sincronizarAsignacion(false); };

  const almacen = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  const tecnicosCampo = useMemo(() => (db.technicians || []).filter((t) => (t.category || "Técnico de campo") !== "Administrativo" && t.status === "Activo").sort((a, b) => a.name.localeCompare(b.name, "es")), [db.technicians]);

  const filas = useMemo(() => requests.filter((r) => {
    const q = f.q.trim().toLowerCase();
    const w = almacen[r.warehouse_id];
    return (!q || `${r.request_no} ${r.pqr_number || ""} ${w ? w.name : ""} ${r.requester_name || ""}`.toLowerCase().includes(q))
      && (!f.estado || r.status === f.estado) && (!f.almacen || r.warehouse_id === f.almacen) && (!f.coord || zona.pasa((w || {}).department, "", f.coord))
      && (!f.desde || r.requested_date >= f.desde) && (!f.hasta || r.requested_date <= f.hasta);
  }), [requests, f, almacen, zona.nombres]);

  const canEditReq = (r) => r.status === "Abierta" && (internal || esCliente);
  const canArmar = (r) => r.status === "Abierta" && (internal || esTecnico);
  const detalle = requests.find((r) => r.id === detalleId) || null;
  const stat = (est) => requests.filter((r) => r.status === est).length;

  // Excel de lo que se ve en pantalla (según los filtros): solicitudes, detalle por producto y armados, con enlaces a las fotos y soportes.
  const [exportando, setExportando] = useState(false);
  const exportar = async () => {
    setExportando(true); setError("");
    try {
      const paths = filas.flatMap((r) => [...(r.attachments || []), ...A.activos(assemblies, r.id).flatMap((a) => a.photos || [])]).map((x) => x.path);
      let urls = new Map();
      try { urls = await A.firmarUrls(paths); } catch (e) { setError(`El Excel salió sin enlaces a los soportes: ${e.message}`); }
      XLSX.writeFile(A.buildDetalleWorkbook({ requests: filas, warehouses, assemblies, urls }), `armados_almacen_${ui.todayISO()}.xlsx`);
    } catch (e) { setError(`No se pudo generar el Excel: ${e.message}`); }
    setExportando(false);
  };
  // Informe PDF de una solicitud (PQR) con sus armados y soportes.
  const [pdfDe, setPdfDe] = useState(null); // { id, avance }
  const informePdf = async (r) => {
    setPdfDe({ id: r.id, avance: "" }); setError("");
    try {
      const blob = await buildSolicitudPdf({ request: r, warehouse: almacen[r.warehouse_id], assemblies: assemblies.filter((a) => a.request_id === r.id), onProgress: (n, t) => setPdfDe({ id: r.id, avance: `${n}/${t}` }) });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `Informe_${r.request_no}${r.pqr_number ? `_PQR${r.pqr_number}` : ""}.pdf`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setError(`No se pudo generar el informe PDF: ${e.message}`); }
    setPdfDe(null);
  };

  return (
    <div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

      {!esTecnico && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Solicitudes abiertas" value={fmt(stat("Abierta"))} sub="en ejecución" accent />
        <ui.StatCard label="Cerradas" value={fmt(stat("Cerrada"))} sub="legalizadas" />
        <ui.StatCard label="Unidades armadas" value={fmt(A.unidades(assemblies.filter((a) => A.suma(a))))} sub="en total (no suman las causales de no armado)" />
        <ui.StatCard label="Sin PQR" value={fmt(requests.filter((r) => r.status !== "Cancelada" && !r.pqr_number).length)} sub="por legalizar" />
      </div>}

      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input className="amg-input" style={{ width: 210 }} placeholder="Buscar solicitud, PQR, almacén..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className="amg-select" style={{ width: 150 }} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todos los estados</option><option>Abierta</option><option>Cerrada</option><option>Cancelada</option></select>
        <select className="amg-select" style={{ width: 200 }} value={f.almacen} onChange={(e) => setF({ ...f, almacen: e.target.value })}><option value="">Todos los almacenes</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        {!esCliente && !esTecnico && <select className="amg-select" style={{ width: 190 }} value={f.coord} title="Filtra por los departamentos que tiene a cargo cada coordinador (Maestros → Coordinadores)" onChange={(e) => setF({ ...f, coord: e.target.value })}><option value="">Todos los coordinadores</option>{zona.nombres.map((n) => <option key={n} value={n}>{n}</option>)}<option value={SIN_COORD}>Sin coordinador</option></select>}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>Desde <input type="date" className="amg-input" style={{ width: 145 }} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>hasta <input type="date" className="amg-input" style={{ width: 145 }} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
        {!esTecnico && <button className="amg-btn" disabled={exportando} title="Excel con el detalle por producto y enlaces a las fotos y soportes (según los filtros)" onClick={exportar}><Download size={14} /> {exportando ? "Preparando..." : "Exportar Excel"}</button>}
        {internal && <button className="amg-btn" disabled={!masters || sincronizando} title="Pone en Asignación las unidades que faltan por armar de las solicitudes abiertas y retira las ya armadas" onClick={() => sincronizarAsignacion(true)}><RotateCcw size={14} /> {sincronizando ? "Sincronizando..." : "Sincronizar con Asignación"}</button>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(esCliente || internal) && <button className="amg-btn" onClick={() => setImportar(true)} disabled={warehouses.length === 0}><Upload size={14} /> Cargar PQR desde Excel</button>}
          <button className="amg-btn primary" onClick={() => setForm({})} disabled={warehouses.length === 0}><Plus size={14} /> {esTecnico ? "Nueva solicitud directa" : "Nueva solicitud"}</button>
        </span>
      </div>
      {!loading && warehouses.length === 0 && !error && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> Aún no hay almacenes. El administrador debe cargarlos en Maestros → Almacenes.</div>}

      <div className="amg-card" style={{ overflow: "auto", maxHeight: "calc(100vh - 380px)" }}>
        <table className="amg-table compact">
          <thead><tr><th>Solicitud</th><th>Fecha</th><th>Meta</th><th>Almacén</th><th>PQR</th><th>Origen</th><th>Solicitado</th><th>Armado</th><th>Estado</th><th>Técnicos</th><th></th></tr></thead>
          <tbody>
            {filas.slice(0, 300).map((r) => {
              const w = almacen[r.warehouse_id] || {};
              const mios = A.activos(assemblies, r.id);
              const sol = A.unidades(r.items || []), arm = A.unidades(A.contables(assemblies, r.id));
              const tecnicos = [...new Set(mios.map((a) => a.technician_name).filter(Boolean))];
              return (
                <tr key={r.id} style={r.status === "Cancelada" ? { opacity: 0.55 } : undefined}>
                  <td className="amg-mono" style={{ whiteSpace: "nowrap" }}><b>{r.request_no}</b></td>
                  <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{ui.fmtDate(r.requested_date)}{r.commitment_date && <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>comp. {ui.fmtDate(r.commitment_date)}</div>}</td>
                  <td className="amg-mono" style={{ whiteSpace: "nowrap", color: r.status === "Abierta" && Meta.metaDe(r) && Meta.metaDe(r) < ui.todayISO() ? "var(--red)" : undefined }} title={r.suggested_days ? `${r.suggested_days} día(s) sugeridos` : "Fecha de compromiso"}>{Meta.metaDe(r) ? ui.fmtDate(Meta.metaDe(r)) : "-"}</td>
                  <td>{w.name || "-"}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{w.city}</div></td>
                  <td className="amg-mono">{r.pqr_number || <span style={{ color: "var(--red)" }}>sin PQR</span>}</td>
                  <td style={{ fontSize: 12 }}>{A.ORIGEN_TXT[r.origin]}</td>
                  <td className="amg-mono">{fmt(sol)}</td>
                  <td className="amg-mono">{fmt(arm)}{sol > 0 && <span style={{ color: "var(--text-faint)", fontSize: 11 }}> ({Math.round((arm / sol) * 100)}%)</span>}{A.unidadesNoArmadas(assemblies, r.id) > 0 && <div style={{ fontSize: 10.5, color: "var(--red)" }}>+{fmt(A.unidadesNoArmadas(assemblies, r.id))} no armada(s)</div>}</td>
                  <td><ui.Badge text={r.status} color={ESTADO_COLOR[r.status]} /></td>
                  <td style={{ fontSize: 12 }}>{tecnicos.join(", ") || "-"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="amg-btn ghost" style={{ padding: 4 }} title="Ver detalle" onClick={() => { setAbrirCancelar(false); setDetalleId(r.id); }}><Eye size={13} /></button>
                    {!esTecnico && <button className="amg-btn ghost" style={{ padding: 4 }} disabled={pdfDe !== null} title="Informe en PDF de esta solicitud (PQR) con sus armados y soportes" onClick={() => informePdf(r)}>{pdfDe && pdfDe.id === r.id ? <span style={{ fontSize: 10.5 }}>{pdfDe.avance || "..."}</span> : <FileText size={13} />}</button>}
                    {canArmar(r) && <button className="amg-btn ghost" style={{ padding: "2px 6px", fontSize: 11.5 }} title="Registrar un armado" onClick={() => setArmadoDe(r)}><Camera size={12} /> Registrar armado</button>}
                    {session.role === "admin" && r.status !== "Cancelada" && <button className="amg-btn ghost" style={{ padding: 4 }} title="Cancelar o anular la solicitud" onClick={() => { setAbrirCancelar(true); setDetalleId(r.id); }}><Ban size={13} color="var(--red)" /></button>}
                    {canEditReq(r) && <button className="amg-btn ghost" style={{ padding: 4 }} title="Editar la solicitud (agregar productos, PQR...)" onClick={() => setForm({ request: r })}><Pencil size={13} /></button>}
                  </td>
                </tr>
              );
            })}
            {!loading && filas.length === 0 && <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{requests.length ? "Ninguna solicitud coincide con los filtros." : "Aún no hay solicitudes."}</td></tr>}
            {loading && <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Cargando...</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>{filas.length} solicitud(es){filas.length > 300 ? " (se muestran las 300 más recientes; usa los filtros)" : ""}. Nada se borra: las solicitudes se cancelan y los armados se anulan.</div>

      {form && <SolicitudModal ui={ui} session={session} internal={internal} esCliente={esCliente} esTecnico={esTecnico} warehouses={warehouses} request={form.request || null}
        onClose={() => setForm(null)} onSaved={async (txt) => { setForm(null); setMsg(txt); await refrescar(); }} />}
      {importar && <ImportarPqrModal ui={ui} session={session} warehouses={warehouses} requests={requests} onClose={() => setImportar(false)} onDone={async (txt) => { setImportar(false); setMsg(txt); await refrescar(); }} />}
      {armadoDe && <ArmadoModal ui={ui} session={session} internal={internal} request={armadoDe} tecnicos={tecnicosCampo} onClose={() => setArmadoDe(null)} onSaved={async (txt) => { setArmadoDe(null); setMsg(txt); await refrescar(); }} />}
      {detalle && <DetalleModal abrirCancelar={abrirCancelar} ui={ui} session={session} internal={internal} esCliente={esCliente} esTecnico={esTecnico} request={detalle} warehouse={almacen[detalle.warehouse_id]}
        assemblies={assemblies.filter((a) => a.request_id === detalle.id)} canEditReq={canEditReq(detalle)} canArmar={canArmar(detalle)}
        onEdit={() => { setDetalleId(null); setForm({ request: detalle }); }} onArmar={() => { setDetalleId(null); setArmadoDe(detalle); }}
        reload={refrescar} setMsg={setMsg} onClose={() => setDetalleId(null)} onPdf={() => informePdf(detalle)} pdfBusy={pdfDe !== null} />}
    </div>
  );
}

/* ------------------------------ Buscador de producto ------------------------------ */

function ProductoBuscador({ onPick, placeholder }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setRes([]); return undefined; }
    let alive = true;
    const t = setTimeout(() => { A.buscarProductos(q).then((r) => { if (alive) setRes(r); }).catch(() => {}); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);
  return (
    <div style={{ position: "relative" }}>
      <input className="amg-input" value={q} placeholder={placeholder || "Busca por código o nombre (mín. 2 letras) y elige de la lista..."} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && res.length > 0 && (
        <div className="amg-searchselect-panel" style={{ position: "absolute", left: 0, right: 0, zIndex: 30, maxHeight: 260, overflow: "auto" }}>
          {res.map((p) => (
            <div key={p.code} className="amg-searchselect-opt" onClick={() => { onPick(p); setQ(""); setOpen(false); setRes([]); }}>
              <div>{p.name}</div><div style={{ fontSize: 11, color: "var(--text-faint)" }}>{p.code}{p.line ? ` · ${p.line}${p.subline ? ` / ${p.subline}` : ""}` : ""}</div>
            </div>
          ))}
        </div>
      )}
      {open && q.trim().length >= 2 && res.length === 0 && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 3 }}>Sin resultados en el maestro de productos.</div>}
    </div>
  );
}

/* ------------------------------------ Solicitud ------------------------------------ */

function SolicitudModal({ ui, session, internal, esCliente, esTecnico, warehouses, request, onClose, onSaved }) {
  const editando = !!request;
  const origenFijo = esCliente ? "PQR" : esTecnico ? "Directo" : null;
  const [f, setF] = useState(() => ({
    warehouse_id: request?.warehouse_id || (warehouses.length === 1 ? warehouses[0].id : ""), origin: request?.origin || origenFijo || "PQR", pqr_number: request?.pqr_number || "",
    commitment_date: request?.commitment_date || "", requested_date: request?.requested_date || ui.todayISO(), requester_name: request?.requester_name || "", notes: request?.notes || "",
    suggested_days: request?.suggested_days || "",
  }));
  const meta = Meta.calcularMeta(f.requested_date, f.suggested_days, f.commitment_date);
  const [items, setItems] = useState(() => (request?.items || []).map((i) => ({ ...i })));
  const [nuevos, setNuevos] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const addItem = (p) => setItems((l) => (l.some((x) => x.code === p.code) ? l.map((x) => (x.code === p.code ? { ...x, quantity: (Number(x.quantity) || 1) + 1 } : x)) : [...l, { code: p.code, name: p.name, line: p.line || "", quantity: 1 }]));
  const setItem = (code, patch) => setItems((l) => l.map((x) => (x.code === code ? { ...x, ...patch } : x)));

  const guardar = async () => {
    setError("");
    if (!f.warehouse_id) { setError("Elige el almacén."); return; }
    if (items.length === 0) { setError("Agrega al menos un producto."); return; }
    if (f.origin === "PQR" && !f.pqr_number.trim()) { setError("Escribe el número de PQR."); return; }
    setBusy(true);
    try {
      const subidos = [];
      const fallos = [];
      for (const file of nuevos) { try { subidos.push(await A.subirArchivo(editando ? request.id : `nuevas/${crypto.randomUUID()}`, file)); } catch (e) { fallos.push(e.message); } }
      const base = {
        warehouse_id: f.warehouse_id, pqr_number: f.pqr_number.trim() || null, commitment_date: f.commitment_date || null, requested_date: f.requested_date,
        requester_name: f.requester_name.trim() || null, notes: f.notes.trim() || null,
        suggested_days: Math.round(Number(f.suggested_days)) > 0 ? Math.round(Number(f.suggested_days)) : null, target_date: meta,
        items: items.map((i) => ({ ...i, quantity: Math.max(1, Math.round(Number(i.quantity)) || 1) })), attachments: [...(request?.attachments || []), ...subidos],
      };
      const r = editando ? await A.updateRequest(request.id, base) : await A.createRequest({ ...base, origin: f.origin, status: "Abierta" });
      await onSaved(`${editando ? "Solicitud actualizada" : "Solicitud registrada"}: ${r.request_no}.${fallos.length ? ` Algunos archivos no se subieron: ${fallos.join(" ")}` : ""}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const lbl = (t, req) => <label className="amg-label">{t}{req ? " *" : ""}</label>;
  return (
    <ui.Modal title={editando ? `Editar ${request.request_no}` : "Nueva solicitud de armado en almacén"} onClose={onClose} width={860}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={busy} onClick={guardar}>{busy ? "Guardando..." : editando ? "Guardar cambios" : "Registrar solicitud"}</button></>}>
      {editando && <div className="amg-alert" style={{ marginBottom: 12, background: "var(--panel-2)" }}>Puedes agregar o quitar productos mientras la solicitud esté abierta, por ejemplo si el administrador del almacén pide más con el técnico en sitio. Cada cambio queda en el historial.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>{lbl("Solicitud")}<div className="amg-input amg-mono" style={{ background: "var(--panel)", color: "var(--text-faint)" }}>{request ? request.request_no : "Se genera sola (AA-000001...)"}</div></div>
        <div>{lbl("Almacén", true)}
          <select className="amg-select" value={f.warehouse_id} disabled={editando && !internal} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            <option value="">Seleccionar...</option>{warehouses.filter((w) => w.active || w.id === f.warehouse_id).map((w) => <option key={w.id} value={w.id}>{w.name}{w.city ? ` · ${w.city}` : ""}</option>)}
          </select></div>
        <div>{lbl("Origen", true)}
          <select className="amg-select" value={origenFijo || f.origin} disabled={!!origenFijo || editando} onChange={(e) => setF({ ...f, origin: e.target.value })}><option value="PQR">PQR de Jamar</option><option value="Directo">Directo (almacén)</option></select></div>
        <div>{lbl("Número de PQR", f.origin === "PQR")}<input className="amg-input" value={f.pqr_number} onChange={(e) => setF({ ...f, pqr_number: e.target.value })} placeholder={f.origin === "Directo" ? "Se asocia al legalizar (puede quedar vacío)" : ""} /></div>
        <div>{lbl("Fecha de solicitud")}<input type="date" className="amg-input" value={f.requested_date} onChange={(e) => setF({ ...f, requested_date: e.target.value })} /></div>
        <div>{lbl("Fecha de compromiso")}<input type="date" className="amg-input" value={f.commitment_date} onChange={(e) => setF({ ...f, commitment_date: e.target.value })} /></div>
        <div>{lbl("Días sugeridos para terminar")}<input type="number" min="1" className="amg-input" value={f.suggested_days} onChange={(e) => setF({ ...f, suggested_days: e.target.value })} placeholder="Ej. 5" />
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{meta ? `Se sugiere terminar antes del ${ui.fmtDate(meta)}.` : "Sin días ni fecha de compromiso: no hay meta."} Un PQR puede llevar varios días.</div></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Quién solicita (administrador del almacén o contacto)")}<input className="amg-input" value={f.requester_name} onChange={(e) => setF({ ...f, requester_name: e.target.value })} /></div>
      </div>

      <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-dim)", margin: "16px 0 8px", borderTop: "1px solid var(--border)", paddingTop: 12 }}>Productos a armar (del maestro) *</div>
      <ProductoBuscador onPick={addItem} />
      {items.length > 0 && (
        <table className="amg-table compact" style={{ marginTop: 8 }}>
          <thead><tr><th>Código</th><th>Producto</th><th>Cant.</th><th></th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.code}><td className="amg-mono">{i.code}</td><td>{i.name}</td>
              <td><input type="number" min="1" className="amg-input" style={{ width: 70 }} value={i.quantity} onChange={(e) => setItem(i.code, { quantity: e.target.value })} /></td>
              <td><button className="amg-btn ghost" style={{ padding: 4 }} title="Quitar" onClick={() => setItems((l) => l.filter((x) => x.code !== i.code))}><X size={13} /></button></td></tr>
          ))}</tbody>
        </table>
      )}
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>{items.length} producto(s) · {fmt(A.unidades(items, (x) => Number(x.quantity) || 1))} unidad(es). Para cargar una lista larga usa "Cargar PQR desde Excel" en la pantalla principal.</div>

      <div style={{ marginTop: 14 }}>{lbl("Notas")}<textarea className="amg-textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <div style={{ marginTop: 12 }}>{lbl("Soportes del PQR (correo, PDF, Excel o fotos)")}
        {(request?.attachments || []).length > 0 && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>Ya adjuntos: {request.attachments.map((x) => x.name).join(", ")}</div>}
        <label className="amg-btn" style={{ cursor: "pointer" }}><Paperclip size={14} /> {nuevos.length ? `${nuevos.length} archivo(s) por subir` : "Adjuntar archivos"}
          <input type="file" multiple accept={A.ARCHIVO_ACCEPT} style={{ display: "none" }} onChange={(e) => { setNuevos([...nuevos, ...Array.from(e.target.files)]); e.target.value = ""; }} /></label>
        {nuevos.length > 0 && <span style={{ marginLeft: 8, fontSize: 12 }}>{nuevos.map((x) => x.name).join(", ")} <button className="amg-btn ghost" style={{ padding: 2 }} onClick={() => setNuevos([])}>Quitar</button></span>}
      </div>
      {error && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {error}</div>}
    </ui.Modal>
  );
}

/* ---------------------------- Carga del PQR desde Excel ---------------------------- */

function ImportarPqrModal({ ui, session, warehouses, requests, onClose, onDone }) {
  const [grupos, setGrupos] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const leer = async (file) => {
    setError(""); setGrupos(null); setArchivo(null);
    if (!file) return;
    try {
      const { grupos: g, avisos: av } = A.parsePqrExcel(await file.arrayBuffer());
      // Se validan los códigos contra el maestro de productos (el nombre del maestro manda; los que no están se marcan).
      const codes = [...new Set(g.flatMap((x) => x.items.map((i) => i.code)))];
      const conocidos = new Map((await A.productosPorCodigo(codes)).map((p) => [p.code, p]));
      const lista = g.map((x) => {
        const w = A.emparejarAlmacen(x.almacen, warehouses);
        const yaExiste = x.pqr && requests.some((r) => r.pqr_number === x.pqr && r.status !== "Cancelada" && (!w || r.warehouse_id === w.id));
        return { ...x, warehouse_id: w ? w.id : "", yaExiste: !!yaExiste, crear: !yaExiste,
          items: x.items.map((i) => { const p = conocidos.get(i.code); return { code: i.code, name: p ? p.name : i.name, line: p ? p.line || "" : "", quantity: i.quantity, enMaestro: !!p }; }) };
      });
      setGrupos(lista); setAvisos(av); setArchivo(file);
    } catch (e) { setError(e.message); }
  };
  const set = (i, patch) => setGrupos((l) => l.map((g, k) => (k === i ? { ...g, ...patch } : g)));

  const crear = async () => {
    const sel = grupos.filter((g) => g.crear);
    if (sel.some((g) => !g.warehouse_id)) { setError("Elige el almacén de cada PQR que vas a crear."); return; }
    setBusy(true); setError("");
    try {
      // El Excel original queda como soporte de cada solicitud.
      const carpeta = `nuevas/${crypto.randomUUID()}`;
      let soporte = [];
      try { soporte = [await A.subirArchivo(carpeta, archivo)]; } catch (e) { /* si no se puede subir el soporte, las solicitudes se crean igual */ }
      let n = 0;
      for (const g of sel) {
        const hoy = ui.todayISO();
        await A.createRequest({ warehouse_id: g.warehouse_id, origin: "PQR", status: "Abierta", pqr_number: g.pqr || null, commitment_date: g.fecha || null, requested_date: hoy,
          suggested_days: g.dias || null, target_date: Meta.calcularMeta(hoy, g.dias, g.fecha), items: g.items.map(({ enMaestro, ...i }) => i), attachments: soporte });
        n++;
      }
      await onDone(`${n} solicitud(es) creada(s) desde el Excel.`);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <ui.Modal title="Cargar PQR desde Excel" onClose={onClose} width={900}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button>
        <button className="amg-btn primary" disabled={busy || !grupos || grupos.every((g) => !g.crear)} onClick={crear}>{busy ? "Creando..." : `Crear ${grupos ? grupos.filter((g) => g.crear).length : 0} solicitud(es)`}</button></>}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.6 }}>
        Sube el Excel del PQR con las columnas <b>CODIGO</b>, <b>NOMBRE DEL PRODUCTO</b>, <b>PQR</b> y <b>ALMACEN</b> (y opcionalmente <b>FECHA DE COMPROMISO</b> y <b>CANTIDAD</b>). Si el archivo trae varios PQR, se crea una solicitud por cada uno; las filas repetidas de un producto suman cantidad.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="amg-btn" onClick={() => XLSX.writeFile(A.buildPlantillaPqr(), "Plantilla_PQR_armado_almacen.xlsx")}><Download size={14} /> Descargar plantilla de muestra</button>
        <label className="amg-btn primary" style={{ cursor: "pointer" }}><Upload size={14} /> {archivo ? archivo.name : "Elegir archivo Excel"}
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { leer(e.target.files[0]); e.target.value = ""; }} /></label>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>La plantilla trae las columnas esperadas, ejemplos y una hoja de instrucciones. Un PQR puede llevar varios días: se sugiere cuántos en la columna DIAS SUGERIDOS (o por la fecha de compromiso).</div>
      {avisos.map((a) => <div key={a} className="amg-alert" style={{ marginTop: 10, background: "var(--panel-2)" }}><AlertTriangle size={13} /> {a}</div>)}
      {error && <div className="amg-alert danger" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {error}</div>}
      {grupos && (
        <table className="amg-table compact" style={{ marginTop: 12 }}>
          <thead><tr><th></th><th>PQR</th><th>Almacén (Excel)</th><th>Almacén del maestro</th><th>Compromiso</th><th>Días sug.</th><th>Productos</th><th>Unidades</th><th></th></tr></thead>
          <tbody>{grupos.map((g, i) => (
            <tr key={i} style={g.crear ? undefined : { opacity: 0.5 }}>
              <td><input type="checkbox" checked={g.crear} onChange={(e) => set(i, { crear: e.target.checked })} /></td>
              <td className="amg-mono">{g.pqr || <span style={{ color: "var(--red)" }}>sin PQR</span>}</td>
              <td>{g.almacen || "-"}</td>
              <td><select className="amg-select" style={{ width: 200 }} value={g.warehouse_id} onChange={(e) => set(i, { warehouse_id: e.target.value })}><option value="">Seleccionar...</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></td>
              <td className="amg-mono">{g.fecha ? ui.fmtDate(g.fecha) : "-"}</td>
              <td><input type="number" min="1" className="amg-input" style={{ width: 64 }} value={g.dias || ""} placeholder="-" onChange={(e) => set(i, { dias: Math.round(Number(e.target.value)) || null })} /></td>
              <td className="amg-mono">{g.items.length}{g.items.some((x) => !x.enMaestro) && <span title="Códigos que no están en el maestro de productos" style={{ color: "var(--accent)", marginLeft: 4 }}>⚠ {g.items.filter((x) => !x.enMaestro).length}</span>}</td>
              <td className="amg-mono">{fmt(A.unidades(g.items))}</td>
              <td style={{ fontSize: 11.5, color: "var(--accent)" }}>{g.yaExiste ? "Ya existe una solicitud con este PQR" : ""}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </ui.Modal>
  );
}

/* ----------------------------------- Armado ----------------------------------- */

function ArmadoModal({ ui, session, internal, request, tecnicos, onClose, onSaved }) {
  const [prod, setProd] = useState(null); // { code, name, line }
  const [cantidad, setCantidad] = useState(1);
  const [tecnicoId, setTecnicoId] = useState(internal ? "" : session.technicianId || "");
  const [fecha, setFecha] = useState(ui.todayISO());
  const [notas, setNotas] = useState("");
  const [fotos, setFotos] = useState([]);
  const [causal, setCausal] = useState("");
  // La foto es obligatoria, salvo con las causales negativas (el producto no quedó armado).
  const fotoObligatoria = !A.esNegativa(causal);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const guardar = async () => {
    setError("");
    if (!prod) { setError("Elige el producto armado."); return; }
    if (!causal) { setError("Elige la causal del producto."); return; }
    if (!tecnicoId) { setError(internal ? "Elige el técnico que hizo el armado." : "Tu usuario no está vinculado a una ficha de técnico. Avisa al administrador."); return; }
    if (!(Number(cantidad) > 0)) { setError("La cantidad debe ser mayor a cero."); return; }
    if (fotoObligatoria && !fotos.length) { setError("La foto es obligatoria: adjunta al menos una foto del producto armado."); return; }
    setBusy(true);
    try {
      const subidas = [], fallos = [];
      for (const file of fotos) { try { subidas.push(await A.subirArchivo(request.id, file)); } catch (e) { fallos.push(e.message); } }
      // Si ninguna foto se pudo subir, el armado no se registra (no puede quedar sin foto).
      if (fotos.length && !subidas.length && fotoObligatoria) { setError(`No se pudo subir ninguna foto, así que el armado no se registró. ${fallos.join(" ")}`); setBusy(false); return; }
      await A.createAssembly({ request_id: request.id, product_code: prod.code, product_name: prod.name, product_line: prod.line || null, quantity: Math.round(Number(cantidad)), technician_id: tecnicoId, assembled_on: fecha, photos: subidas, notes: notas.trim() || null, cause: causal });
      await onSaved(`Armado registrado en ${request.request_no}: ${prod.name} x${Math.round(Number(cantidad))}.${fallos.length ? ` Algunas fotos no se subieron: ${fallos.join(" ")}` : ""}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const pendientes = (request.items || []);
  return (
    <ui.Modal title={`Registrar armado · ${request.request_no}`} onClose={onClose} width={680}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={busy || (fotoObligatoria && !fotos.length)} title={fotoObligatoria && !fotos.length ? "Adjunta al menos una foto para poder registrar el armado" : ""} onClick={guardar}>{busy ? "Guardando..." : "Registrar armado"}</button></>}>
      <label className="amg-label">Producto armado *</label>
      {pendientes.length > 0 && (
        <select className="amg-select" style={{ marginBottom: 8 }} value={prod && pendientes.some((i) => i.code === prod.code) ? prod.code : ""} onChange={(e) => { const i = pendientes.find((x) => x.code === e.target.value); setProd(i ? { code: i.code, name: i.name, line: i.line || "" } : null); }}>
          <option value="">De la lista solicitada...</option>{pendientes.map((i) => <option key={i.code} value={i.code}>{i.code} · {i.name} (x{i.quantity})</option>)}
        </select>
      )}
      <ProductoBuscador onPick={(p) => setProd({ code: p.code, name: p.name, line: p.line || "" })} placeholder="...o busca otro producto del maestro por código o nombre" />
      {prod && <div style={{ marginTop: 8, padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}><b>{prod.name}</b> <span className="amg-mono" style={{ color: "var(--text-faint)" }}>{prod.code}</span></div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12 }}>
        <div><label className="amg-label">Cantidad *</label><input type="number" min="1" className="amg-input" value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></div>
        <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div><label className="amg-label">Técnico *</label>
          {internal
            ? <select className="amg-select" value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}><option value="">Seleccionar...</option>{tecnicos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            : <div className="amg-input" style={{ background: "var(--panel)", color: "var(--text-dim)" }}>{session.name}</div>}
        </div>
      </div>
      <div style={{ marginTop: 12 }}><label className="amg-label">{fotoObligatoria ? "Fotos del armado * (obligatoria, mínimo una)" : "Fotos (opcional con esta causal)"}</label>
        <label className="amg-btn" style={{ cursor: "pointer" }}><Camera size={14} /> {fotos.length ? `${fotos.length} foto(s) por subir` : "Tomar o adjuntar fotos"}
          <input type="file" multiple accept="image/*,.pdf" capture="environment" style={{ display: "none" }} onChange={(e) => { setFotos([...fotos, ...Array.from(e.target.files)]); e.target.value = ""; }} /></label>
        {fotos.length > 0 && <span style={{ marginLeft: 8, fontSize: 12 }}>{fotos.map((x) => x.name).join(", ")} <button className="amg-btn ghost" style={{ padding: 2 }} onClick={() => setFotos([])}>Quitar</button></span>}
        <div style={{ fontSize: 11, marginTop: 3, color: fotos.length ? "var(--text-faint)" : "var(--red)" }}>{fotos.length ? "Puedes agregar más fotos." : fotoObligatoria ? "Sin foto no se puede registrar el armado." : "Esta causal es de \"no armado\": la foto es opcional."}</div>
      </div>
      <div style={{ marginTop: 12 }}><label className="amg-label">Causal del producto *</label>
        <select className="amg-select" value={causal} onChange={(e) => setCausal(e.target.value)}><option value="">Seleccionar...</option>{A.CAUSALES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
      <div style={{ marginTop: 12 }}><label className="amg-label">Observación</label><textarea className="amg-textarea" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
      {error && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {error}</div>}
    </ui.Modal>
  );
}

/* ---------------------------------- Detalle y cierre ---------------------------------- */

function DetalleModal({ ui, session, internal, esCliente, esTecnico, abrirCancelar, request: r, warehouse, assemblies, canEditReq, canArmar, onEdit, onArmar, reload, setMsg, onClose, onPdf, pdfBusy }) {
  const [eventos, setEventos] = useState([]);
  const [error, setError] = useState("");
  const [cierre, setCierre] = useState(false);
  const [cancelar, setCancelar] = useState(!!abrirCancelar);
  // El administrador puede cancelar o anular una solicitud en cualquier estado (abierta o ya cerrada, con o sin armados); el equipo y el cliente, solo si sigue abierta.
  const puedeCancelar = r.status !== "Cancelada" && (session.role === "admin" || ((internal || esCliente) && r.status === "Abierta"));
  const [anular, setAnular] = useState(null);
  const mios = A.activos(assemblies, r.id); // todos los registros no anulados (los de causal negativa se listan pero no suman)
  const contab = A.contables(assemblies, r.id);
  const comp = A.comparativo(r, assemblies);
  const puedeAnular = (a) => !a.voided && r.status === "Abierta" && (internal || (esTecnico && a.technician_id === session.technicianId));

  useEffect(() => { A.listEvents(r.id).then(setEventos).catch(() => {}); }, [r.id, r.status, r.items]);

  const abrir = async (ph) => {
    const w = window.open("", "_blank");
    try { const url = await A.urlArchivo(ph.path); if (w) w.location.href = url; else window.location.href = url; }
    catch (e) { if (w) w.close(); setError(e.message); }
  };
  const descargarCierre = () => XLSX.writeFile(A.buildCierreWorkbook(r, warehouse, assemblies), `Cierre_${r.request_no}${r.pqr_number ? `_PQR${r.pqr_number}` : ""}.xlsx`);
  const cambiar = async (patch, texto) => {
    setError("");
    try { await A.updateRequest(r.id, patch); setMsg(texto); await reload(); onClose(); } catch (e) { setError(e.message); }
  };

  return (
    <ui.Modal title={`${r.request_no} · ${warehouse ? warehouse.name : ""}`} onClose={onClose} width={980}
      footer={<>
        <button className="amg-btn" onClick={onClose}>Cerrar</button>
        {!esTecnico && <button className="amg-btn" disabled={pdfBusy} onClick={onPdf} title="PDF con los datos del PQR, los armados y los soportes (fotos)"><FileText size={14} /> {pdfBusy ? "Generando informe..." : "Informe PDF"}</button>}
        {r.status === "Cerrada" && !esTecnico && <button className="amg-btn" onClick={descargarCierre}><Download size={14} /> Descargar cierre (Excel)</button>}
        {session.role === "admin" && (r.status === "Cerrada" || r.status === "Cancelada") && <button className="amg-btn" onClick={() => cambiar({ status: "Abierta", closed_at: null, closed_by: null, cancel_reason: null }, `${r.request_no} reabierta.`)}><RotateCcw size={14} /> {r.status === "Cancelada" ? "Reactivar" : "Reabrir"}</button>}
        {puedeCancelar && <button className="amg-btn" onClick={() => setCancelar(true)}><Ban size={14} color="var(--red)" /> Cancelar / anular solicitud</button>}
        {canEditReq && <button className="amg-btn" onClick={onEdit}><Pencil size={14} /> Editar solicitud</button>}
        {canArmar && <button className="amg-btn" onClick={onArmar}><Camera size={14} /> Registrar armado</button>}
        {internal && r.status === "Abierta" && <button className="amg-btn primary" onClick={() => setCierre(true)}><Check size={14} /> Cerrar solicitud</button>}
      </>}>
      {error && <div className="amg-alert danger" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> {error}</div>}
      {r.status === "Cancelada" && <div className="amg-alert danger" style={{ marginBottom: 10 }}><Ban size={14} /> Cancelada{r.cancel_reason ? `: ${r.cancel_reason}` : ""}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
        {[["Estado", <ui.Badge key="e" text={r.status} color={ESTADO_COLOR[r.status]} />], ["PQR", r.pqr_number || "— sin PQR —"], ["Origen", A.ORIGEN_TXT[r.origin]], ["Almacén", warehouse ? `${warehouse.name}${warehouse.city ? ` · ${warehouse.city}` : ""}` : "-"],
          ["Fecha de solicitud", ui.fmtDate(r.requested_date)], ["Fecha de compromiso", r.commitment_date ? ui.fmtDate(r.commitment_date) : "-"], ["Solicita", r.requester_name || "-"], ["Cliente", r.client],
          ["Días sugeridos", r.suggested_days ? `${r.suggested_days} día(s)` : "-"], ["Meta (terminar antes del)", Meta.metaDe(r) ? ui.fmtDate(Meta.metaDe(r)) : "-"],
          ["Pendientes", fmt(A.unidadesPendientes(r, assemblies.filter((x) => x.request_id === r.id)))], ["Meta diaria sugerida", (() => { const pend = A.unidadesPendientes(r, assemblies.filter((x) => x.request_id === r.id)); const md = r.status === "Abierta" ? Meta.metaDiaria(pend, Meta.metaDe(r), ui.todayISO()) : null; return md != null ? `${md} unidad(es) por día` : "-"; })()]]
          .map(([t, v]) => <div key={t}><div className="amg-label">{t}</div><div style={{ fontSize: 13 }}>{v}</div></div>)}
      </div>
      {r.notes && <div style={{ marginBottom: 10, fontSize: 13 }}><div className="amg-label">Notas</div>{r.notes}</div>}
      {(r.attachments || []).length > 0 && <div style={{ marginBottom: 10 }}><div className="amg-label">Soportes del PQR</div>{r.attachments.map((x) => <button key={x.path} className="amg-btn ghost" style={{ marginRight: 6, fontSize: 12 }} onClick={() => abrir(x)}><Paperclip size={12} /> {x.name}</button>)}</div>}

      <div style={{ fontWeight: 600, fontSize: 13, margin: "12px 0 6px" }}>Solicitado vs armado ({fmt(A.unidades(r.items || []))} solicitadas · {fmt(A.unidades(contab))} armadas · {fmt(A.unidades(mios) - A.unidades(contab))} no armadas · {fmt(A.unidadesPendientes(r, assemblies.filter((x) => x.request_id === r.id)))} pendientes)</div>
      <table className="amg-table compact">
        <thead><tr><th>Código</th><th>Producto</th><th>Solicitado</th><th>Armado</th><th>No armado</th><th>Pendiente</th><th>Estado</th></tr></thead>
        <tbody>{comp.map((c) => <tr key={c.code}><td className="amg-mono">{c.code}</td><td>{c.name}</td><td className="amg-mono">{c.solicitado}</td><td className="amg-mono">{c.armado}</td><td className="amg-mono">{c.noArmado || "-"}</td><td className="amg-mono">{c.pendiente || "-"}</td><td><ui.Badge text={c.estado} color={COMP_COLOR[c.estado]} /></td></tr>)}
          {comp.length === 0 && <tr><td colSpan={7} style={{ color: "var(--text-faint)" }}>Sin productos.</td></tr>}</tbody>
      </table>

      <div style={{ fontWeight: 600, fontSize: 13, margin: "16px 0 6px" }}>Armados registrados ({assemblies.length})</div>
      <table className="amg-table compact">
        <thead><tr><th>Fecha</th><th>Producto</th><th>Cant.</th><th>Causal</th><th>Técnico</th><th>Fotos</th><th>Observación</th><th></th></tr></thead>
        <tbody>{assemblies.map((a) => (
          <tr key={a.id} style={a.voided ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
            <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{ui.fmtDate(a.assembled_on)}</td><td>{a.product_name}<div className="amg-mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{a.product_code}</div></td>
            <td className="amg-mono">{a.quantity}</td><td style={{ fontSize: 12 }}>{a.cause || <span style={{ color: "var(--text-faint)" }}>-</span>}{a.cause && !A.suma(a) && !a.voided && <div style={{ fontSize: 10.5, color: "var(--red)" }}>no suma al armado</div>}</td><td>{a.technician_name || "-"}</td>
            <td>{(a.photos || []).length ? (a.photos || []).map((p, i) => <button key={p.path} className="amg-btn ghost" style={{ padding: "1px 6px", fontSize: 11 }} title={p.name} onClick={() => abrir(p)}><Camera size={11} /> {i + 1}</button>) : <span style={{ color: "var(--red)", fontSize: 12 }}>sin foto</span>}</td>
            <td style={{ fontSize: 12 }}>{a.voided ? `Anulado${a.void_reason ? `: ${a.void_reason}` : ""}` : a.notes}</td>
            <td>{puedeAnular(a) && <button className="amg-btn ghost" style={{ padding: 4 }} title="Anular este registro" onClick={() => setAnular(a)}><Ban size={13} color="var(--red)" /></button>}</td>
          </tr>
        ))}
          {assemblies.length === 0 && <tr><td colSpan={8} style={{ color: "var(--text-faint)" }}>Aún no se han registrado armados.</td></tr>}</tbody>
      </table>

      {eventos.length > 0 && <>
        <div style={{ fontWeight: 600, fontSize: 13, margin: "16px 0 6px" }}>Historial</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.7 }}>
          {eventos.map((e) => <div key={e.id}><span className="amg-mono">{String(e.at).slice(0, 16).replace("T", " ")}</span> · {e.user_name || "-"} · <b>{e.action}</b>{e.detail ? ` — ${e.detail}` : ""}</div>)}
        </div>
      </>}

      {cierre && <CierreModal ui={ui} session={session} request={r} assemblies={assemblies} onClose={() => setCierre(false)} onDone={async (txt) => { setCierre(false); setMsg(txt); await reload(); onClose(); }} />}
      {cancelar && <MotivoModal ui={ui} titulo={`Cancelar / anular ${r.request_no}`} texto={`La solicitud queda registrada como cancelada (no se borra) y sus unidades pendientes salen de Asignación.${r.status === "Cerrada" ? " Estaba CERRADA: se anula también el cierre." : ""}${mios.length ? ` Tiene ${mios.length} armado(s) registrados: quedan en el historial, pero la solicitud deja de contar en el informe.` : ""}`} boton="Cancelar / anular la solicitud" onConfirm={(m) => { setCancelar(false); cambiar({ status: "Cancelada", cancel_reason: m }, `${r.request_no} cancelada.`); }} onClose={() => setCancelar(false)} />}
      {anular && <MotivoModal ui={ui} titulo="Anular armado" texto={`${anular.product_name} x${anular.quantity}. No se borra: queda anulado y no cuenta.`} boton="Anular" onConfirm={async (m) => {
        try { await A.updateAssembly(anular.id, { voided: true, void_reason: m }); setAnular(null); setMsg("Armado anulado."); await reload(); onClose(); } catch (e) { setError(e.message); setAnular(null); }
      }} onClose={() => setAnular(null)} />}
    </ui.Modal>
  );
}

function MotivoModal({ ui, titulo, texto, boton, onConfirm, onClose }) {
  const [motivo, setMotivo] = useState("");
  return (
    <ui.Modal title={titulo} onClose={onClose} footer={<><button className="amg-btn" onClick={onClose}>Volver</button><button className="amg-btn primary" disabled={!motivo.trim()} onClick={() => onConfirm(motivo.trim())}>{boton}</button></>}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>{texto}</div>
      <label className="amg-label">Motivo *</label>
      <textarea className="amg-textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
    </ui.Modal>
  );
}

function CierreModal({ ui, session, request: r, assemblies, onClose, onDone }) {
  const [pqr, setPqr] = useState(r.pqr_number || "");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const faltas = A.validarCierre(r, assemblies, pqr);
  const comp = A.comparativo(r, assemblies);
  const dif = comp.filter((c) => c.estado !== "Completo");

  const cerrar = async () => {
    setBusy(true); setError("");
    try {
      await A.updateRequest(r.id, { pqr_number: pqr.trim(), status: "Cerrada", closed_at: new Date().toISOString(), closed_by: session.id, close_notes: notas.trim() || null });
      await onDone(`${r.request_no} cerrada con el PQR ${pqr.trim()}. Ya puedes descargar el Excel del cierre.`);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <ui.Modal title={`Cerrar ${r.request_no}`} onClose={onClose} width={720}
      footer={<><button className="amg-btn" onClick={onClose}>Volver</button><button className="amg-btn primary" disabled={busy || faltas.length > 0} onClick={cerrar}>{busy ? "Cerrando..." : "Cerrar solicitud"}</button></>}>
      <label className="amg-label">Número de PQR que legaliza la solicitud *</label>
      <input className="amg-input" style={{ maxWidth: 260 }} value={pqr} onChange={(e) => setPqr(e.target.value)} />
      <div style={{ marginTop: 12 }}>
        {faltas.length === 0
          ? <div className="amg-alert" style={okBox}><Check size={14} /> Todo listo para cerrar: PQR, técnico y fotos de cada armado.</div>
          : faltas.map((x) => <div key={x} className="amg-alert danger" style={{ marginBottom: 6 }}><AlertTriangle size={14} /> {x}</div>)}
      </div>
      {dif.length > 0 && <div style={{ marginTop: 10, fontSize: 12.5 }}><b>Diferencias con lo solicitado</b> (no impiden cerrar, quedan en el Excel):
        <ul style={{ margin: "4px 0 0 18px" }}>{dif.slice(0, 12).map((c) => <li key={c.code}>{c.name}: solicitado {c.solicitado}, armado {c.armado} ({c.estado})</li>)}{dif.length > 12 && <li>y {dif.length - 12} más…</li>}</ul></div>}
      <div style={{ marginTop: 12 }}><label className="amg-label">Observaciones del cierre</label><textarea className="amg-textarea" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
      {error && <div className="amg-alert danger" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {error}</div>}
    </ui.Modal>
  );
}
