import { useState, useEffect, useMemo } from "react";
import { Check, AlertTriangle, Plus, Paperclip, Download, Eye, Pencil, Ban, Send, X } from "lucide-react";
import * as D from "./lib/asignacion/data";
import * as P from "./lib/programacion/progData";
import * as maestrosApi from "./lib/maestrosApi";

/* ============================================================================
   PROGRAMACIÓN DE SERVICIOS
   Reemplaza el formulario "Servicios Particulares": se programa una orden con el cliente, la ubicación (desde el
   maestro de barrios y zonas), los productos (desde el maestro de productos), la fecha y el tipo de solicitud.
   El consecutivo de la orden (PS-000001...) lo genera la base de datos. Al guardar, cada producto queda como servicio
   Pendiente y entra solo a la Asignación de esa fecha.
============================================================================ */

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };
const fmt = (n) => Math.round(n || 0).toLocaleString("es-CO");

export default function ProgramacionModule({ db, session, persist, addAudit, ui }) {
  const canEdit = session.role === "admin" || session.role === "operador";
  const esCliente = session.role === "cliente"; // Jamar y otros clientes: solo crean solicitudes "Ruta Critica" y ven las suyas
  const canCreate = canEdit || esCliente;
  const [orders, setOrders] = useState([]);
  const [masters, setMasters] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState(null); // null | { order? }
  const [detail, setDetail] = useState(null);
  const [cancelar, setCancelar] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [f, setF] = useState({ q: "", desde: "", hasta: "", tipo: "", estado: "" });

  const recargar = async () => {
    setLoading(true); setError("");
    try { setOrders((await P.listOrders()).reverse()); }
    catch (e) { setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL de Programación (sql/25).`); }
    setLoading(false);
  };
  useEffect(() => {
    recargar();
    (esCliente ? P.cargarGeoCliente() : D.loadMasters()).then(setMasters).catch((e) => setError(`No se pudieron cargar las listas: ${e.message}`));
  }, []);

  const usuarios = useMemo(() => Object.fromEntries((db.users || []).map((u) => [u.id, u.name])), [db.users]);
  const usuariosRol = useMemo(() => Object.fromEntries((db.users || []).map((u) => [u.id, u.role])), [db.users]);
  const tecnicos = useMemo(() => Object.fromEntries((db.technicians || []).map((t) => [t.id, t.name])), [db.technicians]);
  const serviciosDe = (o) => (db.services || []).filter((s) => P.esDeOrden(s, o) && !(s.asig && s.asig.cancelada));
  const tecnicosDe = (o) => [...new Set(serviciosDe(o).map((s) => (s.technicianId ? tecnicos[s.technicianId] : s.tecnico2Nombre)).filter(Boolean))];

  const rows = useMemo(() => orders.filter((o) => {
    const est = P.estadoOrden(o, db.services).texto;
    const q = f.q.trim().toLowerCase();
    return (!q || `${o.order_no} ${o.service_number || ""} ${o.customer_name} ${o.phone || ""} ${o.address} ${o.city}`.toLowerCase().includes(q))
      && (!f.desde || o.scheduled_date >= f.desde) && (!f.hasta || o.scheduled_date <= f.hasta)
      && (!f.tipo || o.request_type === f.tipo) && (!f.estado || est === f.estado);
  }), [orders, db.services, f]);

  const hoy = ui.todayISO();
  const estados = ["Pendiente de asignar", "En gestión", "Realizada", "Sin enviar a Asignación", "Cancelada"];
  const stat = (t) => orders.filter((o) => P.estadoOrden(o, db.services).texto === t).length;

  // Pasa los productos de la orden a Asignación (crea o actualiza los servicios Pendientes) y guarda con la auditoría.
  // Varias órdenes en un solo guardado. Devuelve cuántas se enviaron y los errores por orden (las que fallan no frenan a las demás).
  const enviarOrdenes = async (lista, accion) => {
    let services = db.services, next = { ...db };
    let enviadas = 0; const fallos = [];
    for (const o0 of lista) {
      try {
        let order = o0;
        // Orden creada por un cliente: los tiempos se toman del maestro de productos (una sola vez).
        const creador = (db.users || []).find((u) => u.id === order.created_by);
        if (creador && creador.role === "cliente" && (order.products || []).some((p) => !p.verificado)) {
          const v = P.verificarTiempos(order, masters);
          order = await P.updateOrder(order.id, { products: v.products, total_minutes: v.total_minutes, updated_by: session.id, updated_at: new Date().toISOString() });
        }
        const filas = P.ordenAFilas(order, masters);
        if (P.filasSinZona(filas).length) throw new Error(`No se pudo ubicar la zona de ${order.city}${order.neighborhood ? ` · ${order.neighborhood}` : ""}. Edita la orden y elige otro barrio.`);
        if (filas.some((r) => !r.tiempo)) throw new Error("Hay productos sin tiempo de armado. Corrígelos en la orden.");
        const r = P.sincronizarServicios(services, order, filas, session, ui.uid);
        services = r.services;
        next = addAudit({ ...next, services }, { userId: session.id, action: accion, record: order.order_no, oldValue: "-", newValue: `${r.nuevos} nuevos, ${r.actualizados} actualizados${r.cancelados ? `, ${r.cancelados} cancelados` : ""}${r.omitidos ? `, ${r.omitidos} ya en gestión` : ""}` });
        enviadas++;
      } catch (e) { fallos.push(`${o0.order_no}: ${e.message}`); }
    }
    if (enviadas) {
      const ok = await persist(next);
      if (!ok) throw new Error("Las órdenes quedaron guardadas pero no se pudieron enviar a Asignación. Pulsa \"Enviar a Asignación\" en la lista.");
    }
    return { enviadas, fallos };
  };
  const enviarAAsignacion = async (o, accion) => {
    const r = await enviarOrdenes([o], accion);
    if (r.fallos.length) throw new Error(r.fallos[0].replace(`${o.order_no}: `, ""));
    return r;
  };

  const reenviar = async (o) => {
    setBusyId(o.id); setError(""); setMsg("");
    try { await enviarAAsignacion(o, "Programación de servicio enviada a Asignación"); setMsg(`${o.order_no} enviada a Asignación.`); }
    catch (e) { setError(e.message); }
    setBusyId(null);
  };

  // Solicitudes de clientes (o envíos que fallaron) que aún no están en Asignación.
  const sinEnviar = orders.filter((o) => o.status !== "Cancelada" && P.estadoOrden(o, db.services).texto === "Sin enviar a Asignación");
  const enviarTodas = async () => {
    setBusyId("todas"); setError(""); setMsg("");
    try {
      const r = await enviarOrdenes(sinEnviar, "Programación de servicio enviada a Asignación");
      if (r.enviadas) setMsg(`${r.enviadas} orden(es) enviadas a Asignación.`);
      if (r.fallos.length) setError(r.fallos.join(" · "));
    } catch (e) { setError(e.message); }
    await recargar(); setBusyId(null);
  };

  const cancelarOrden = async (o, motivo) => {
    setError(""); setMsg("");
    const sv = serviciosDe(o);
    if (sv.some((s) => s.estadoGestion !== "Pendiente")) { setError("Esta orden ya está en gestión o realizada: no se puede cancelar. Si hace falta, devuélvela a Asignación desde Carga."); setCancelar(null); return; }
    try {
      await P.updateOrder(o.id, { status: "Cancelada", cancel_reason: motivo, updated_by: session.id, updated_at: new Date().toISOString() });
      const r = P.cancelarServicios(db.services, o);
      let next = addAudit({ ...db, services: r.services }, { userId: session.id, action: "Cancelación de servicio programado", record: o.order_no, oldValue: "Programada", newValue: `Cancelada: ${motivo}` });
      await persist(next);
      setMsg(`${o.order_no} cancelada.`); await recargar();
    } catch (e) { setError(e.message); }
    setCancelar(null);
  };

  const exportar = () => ui.downloadCSV(`programacion_${hoy}.csv`,
    ["Orden de servicio", "Número de servicio", "Fecha de programación", "Cliente", "Teléfono", "Departamento", "Ciudad", "Barrio", "Dirección", "Señas", "Productos", "Minutos", "Tipo de solicitud", "Cliente reporta", "Estado", "Técnico", "Creada por", "Creada"],
    rows.map((o) => [o.order_no, o.service_number || "", ui.fmtDate(o.scheduled_date), o.customer_name, o.phone || "", o.department, o.city, o.neighborhood || "", o.address, o.notes || "",
      (o.products || []).map((p) => `${p.quantity > 1 ? `${p.quantity}x ` : ""}${p.code} ${p.name}`).join(" | "), o.total_minutes, o.request_type, o.customer_report || "",
      esCliente ? o.status : P.estadoOrden(o, db.services).texto, tecnicosDe(o).join(", "), usuarios[o.created_by] || "", String(o.created_at).slice(0, 16).replace("T", " ")]));

  return (
    <div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

      {canEdit && sinEnviar.length > 0 && (
        <div className="amg-alert" style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "rgba(217,141,52,0.12)", border: "1px solid rgba(217,141,52,0.4)" }}>
          <AlertTriangle size={14} /> {sinEnviar.length} orden(es) sin enviar a Asignación (solicitudes de clientes o envíos que fallaron). Revísalas y envíalas para que entren a la asignación de su fecha.
          <button className="amg-btn primary" disabled={!masters || busyId === "todas"} onClick={enviarTodas}><Send size={13} /> {busyId === "todas" ? "Enviando..." : `Enviar ${sinEnviar.length} a Asignación`}</button>
        </div>
      )}

      {!esCliente && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Órdenes programadas" value={fmt(orders.filter((o) => o.status !== "Cancelada").length)} sub="en total" accent />
        <ui.StatCard label="Pendientes de asignar" value={fmt(stat("Pendiente de asignar"))} sub="esperan técnico" />
        <ui.StatCard label="En gestión" value={fmt(stat("En gestión"))} sub="ya asignadas" />
        <ui.StatCard label="Para hoy" value={fmt(orders.filter((o) => o.status !== "Cancelada" && o.scheduled_date === hoy).length)} sub={ui.fmtDate(hoy)} />
      </div>}

      {esCliente && <div className="amg-alert" style={{ marginBottom: 12, background: "var(--panel-2)" }}>Aquí registras tus solicitudes de servicio de <b>Ruta Crítica</b> y consultas las que has enviado. Cada solicitud recibe un número de orden (PS-000001...) y queda a cargo de Biver para su programación.</div>}

      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input className="amg-input" style={{ width: 220 }} placeholder="Buscar orden, cliente, teléfono..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>Programadas desde <input type="date" className="amg-input" style={{ width: 150 }} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>hasta <input type="date" className="amg-input" style={{ width: 150 }} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
        {!esCliente && <select className="amg-select" style={{ width: 170 }} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos los tipos</option>{P.TIPOS_SOLICITUD.map((t) => <option key={t}>{t}</option>)}</select>}
        {!esCliente && <select className="amg-select" style={{ width: 190 }} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todos los estados</option>{estados.map((t) => <option key={t}>{t}</option>)}</select>}
        <button className="amg-btn" onClick={exportar}><Download size={14} /> Exportar CSV</button>
        <button className="amg-btn primary" style={{ marginLeft: "auto" }} disabled={!canCreate || !masters} onClick={() => setForm({})}><Plus size={14} /> {esCliente ? "Nueva solicitud (Ruta Crítica)" : "Programar servicio"}</button>
      </div>

      <div className="amg-card" style={{ overflow: "auto", maxHeight: "calc(100vh - 360px)" }}>
        <table className="amg-table compact">
          <thead><tr><th>Orden</th><th>Programada</th><th>Cliente</th><th>Ubicación</th><th>Productos</th>{!esCliente && <th>Min</th>}{!esCliente && <th>Tipo</th>}<th>Estado</th>{!esCliente && <th>Técnico</th>}<th></th></tr></thead>
          <tbody>
            {rows.slice(0, 300).map((o) => {
              const est = esCliente ? { texto: o.status === "Cancelada" ? "Cancelada" : "Programada", color: o.status === "Cancelada" ? "gray" : "green" } : P.estadoOrden(o, db.services);
              return (
                <tr key={o.id} style={o.status === "Cancelada" ? { opacity: 0.55 } : undefined}>
                  <td className="amg-mono" style={{ whiteSpace: "nowrap" }}><b>{o.order_no}</b>{o.service_number && <div style={{ fontSize: 10.5, color: "var(--text-faint)" }} title="Número de servicio">Serv. {o.service_number}</div>}{(usuariosRol[o.created_by] === "cliente") && <span style={{ marginLeft: 6 }}><ui.Badge text="Cliente" color="blue" /></span>}</td>
                  <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{ui.fmtDate(o.scheduled_date)}</td>
                  <td>{o.customer_name}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{o.phone}</div></td>
                  <td><ui.HoverText text={`${o.city}${o.neighborhood ? ` · ${o.neighborhood}` : ""} — ${o.address}`} maxChars={34} /><div style={{ fontSize: 11, color: "var(--text-faint)" }}>{o.department}</div></td>
                  <td><ui.HoverText text={(o.products || []).map((p) => `${p.quantity > 1 ? `${p.quantity}x ` : ""}${p.name}`).join(" · ")} maxChars={34} /></td>
                  {!esCliente && <td className="amg-mono">{fmt(o.total_minutes)}</td>}
                  {!esCliente && <td><ui.Badge text={o.request_type} color={o.request_type === "Ruta Critica" ? "red" : o.request_type === "Instalación de Tv" ? "blue" : "gray"} /></td>}
                  <td><ui.Badge text={est.texto} color={est.color} /></td>
                  {!esCliente && <td style={{ fontSize: 12 }}>{tecnicosDe(o).join(", ") || "-"}</td>}
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="amg-btn ghost" style={{ padding: 4 }} title="Ver detalle" onClick={() => setDetail(o)}><Eye size={13} /></button>
                    {canEdit && o.status !== "Cancelada" && <button className="amg-btn ghost" style={{ padding: 4 }} title="Editar" onClick={() => setForm({ order: o })}><Pencil size={13} /></button>}
                    {canEdit && est.texto === "Sin enviar a Asignación" && <button className="amg-btn ghost" style={{ padding: "2px 6px", fontSize: 11 }} disabled={busyId === o.id} title="Crea los servicios pendientes de esta orden en Asignación" onClick={() => reenviar(o)}><Send size={12} /> Enviar a Asignación</button>}
                    {canEdit && o.status !== "Cancelada" && <button className="amg-btn ghost" style={{ padding: 4 }} title="Cancelar la orden" onClick={() => setCancelar(o)}><Ban size={13} color="var(--red)" /></button>}
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{orders.length ? "Ninguna orden coincide con los filtros." : "Aún no hay servicios programados. Usa \"Programar servicio\"."}</td></tr>}
            {loading && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Cargando...</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>{rows.length} orden(es){rows.length > 300 ? " (se muestran las 300 más recientes; usa los filtros)" : ""}. Las órdenes no se borran: se cancelan. Los servicios programados aparecen solos en Asignación, en el paso 1, para su fecha.</div>

      {form && masters && (
        <OrdenModal ui={ui} masters={masters} session={session} esCliente={esCliente} ordenes={orders} order={form.order || null} servicios={form.order ? serviciosDe(form.order) : []}
          onClose={() => setForm(null)} enviar={enviarAAsignacion} reload={recargar} setMsg={setMsg} />
      )}
      {detail && <DetalleModal ui={ui} esCliente={esCliente} order={detail} servicios={serviciosDe(detail)} tecnicos={tecnicosDe(detail)} creador={usuarios[detail.created_by]} onClose={() => setDetail(null)} />}
      {cancelar && <CancelarModal ui={ui} order={cancelar} onConfirm={(m) => cancelarOrden(cancelar, m)} onClose={() => setCancelar(null)} />}
    </div>
  );
}

/* ----------------------------- Buscador de producto (maestro) ----------------------------- */

function ProductoPicker({ onPick, esCliente }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setRes([]); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      // El cliente busca con una función que no devuelve precios; el equipo consulta el maestro directamente.
      const buscar = esCliente
        ? P.buscarProductos(q)
        : maestrosApi.listPage("assembly_products", { select: "code,name,minutes,persons,line,subline", search: q, searchCols: ["code", "name"], filters: { active: true }, orderBy: "name", pageSize: 12 }).then((r) => r.rows);
      buscar.then((rows) => { if (alive) setRes(rows); }).catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);
  return (
    <div style={{ position: "relative" }}>
      <input className="amg-input" value={q} placeholder="Busca el producto por código o nombre (mín. 2 letras) y elígelo de la lista..." onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && res.length > 0 && (
        <div className="amg-searchselect-panel" style={{ position: "absolute", left: 0, right: 0, zIndex: 30, maxHeight: 280, overflow: "auto" }}>
          {res.map((p) => (
            <div key={p.code} className="amg-searchselect-opt" onClick={() => { onPick(p); setQ(""); setOpen(false); setRes([]); }}>
              <div>{p.name}</div><div style={{ fontSize: 11, color: "var(--text-faint)" }}>{p.code}{esCliente ? "" : ` · ${p.minutes ? `${p.minutes} min` : "sin tiempo"} · ${p.persons === 2 ? "2 personas" : "1 persona"}`}{p.line ? ` · ${p.line}${p.subline ? ` / ${p.subline}` : ""}` : ""}</div>
            </div>
          ))}
        </div>
      )}
      {open && q.trim().length >= 2 && res.length === 0 && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 3 }}>Sin resultados en el maestro de productos.</div>}
    </div>
  );
}

/* ----------------------------------- Formulario ----------------------------------- */

function OrdenModal({ ui, masters, session, esCliente, order, ordenes, servicios, onClose, enviar, reload, setMsg }) {
  const geo = useMemo(() => P.listasGeo(masters), [masters]);
  const editando = !!order;
  const [f, setF] = useState(() => ({
    customer_name: order?.customer_name || "", phone: order?.phone || "", department: order?.department || "", city: order?.city || "", neighborhood: order?.neighborhood || "",
    address: order?.address || "", notes: order?.notes || "", customer_report: order?.customer_report || "", service_number: order?.service_number || "",
    scheduled_date: order?.scheduled_date || ui.todayISO(), request_type: esCliente ? "Ruta Critica" : order?.request_type || "Particular",
  }));
  const [products, setProducts] = useState(() => (order?.products || []).map((p) => ({ ...p })));
  const [nuevas, setNuevas] = useState([]); // fotos por subir
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const region = (geo.deptos.find((d) => d.name === f.department) || {}).region;
  const ciudades = region != null ? geo.ciudades(region) : [];
  const barrios = region != null && f.city ? geo.barrios(region, f.city) : [];
  const total = products.reduce((s, p) => s + (Number(p.minutes) || 0) * (Number(p.quantity) || 1), 0);
  const bloqueada = editando && servicios.some((s) => s.estadoGestion !== "Pendiente");

  const addProduct = (p) => setProducts((l) => (l.some((x) => x.code === p.code) ? l.map((x) => (x.code === p.code ? { ...x, quantity: (x.quantity || 1) + 1 } : x)) : [...l, { code: p.code, name: p.name, minutes: p.minutes || 0, quantity: 1, persons: p.persons || 1, line: p.line || "", subline: p.subline || "" }]));
  const setProd = (code, patch) => setProducts((l) => l.map((x) => (x.code === code ? { ...x, ...patch } : x)));

  const guardar = async () => {
    setError("");
    const falta = [["customer_name", "Nombre del cliente"], ["phone", "Teléfono"], ["department", "Departamento"], ["city", "Ciudad"], ["address", "Dirección"], ["scheduled_date", "Fecha de programación"], ["request_type", "Tipo de solicitud"]].find(([k]) => !String(f[k] || "").trim());
    if (falta) { setError(`Falta: ${falta[1]}`); return; }
    const critica = esCliente || f.request_type === "Ruta Critica";
    if (critica && !f.service_number.trim()) { setError("Falta el número de servicio (obligatorio en Ruta Crítica)."); return; }
    const repetida = f.service_number.trim() && (ordenes || []).find((x) => x.id !== order?.id && x.status !== "Cancelada" && String(x.service_number || "").trim().toLowerCase() === f.service_number.trim().toLowerCase());
    if (repetida) { setError(`Ya existe la orden ${repetida.order_no} con el número de servicio ${f.service_number.trim()}.`); return; }
    if (barrios.length > 0 && !f.neighborhood) { setError("Elige el barrio (la ciudad tiene barrios en el maestro)."); return; }
    if (products.length === 0) { setError("Agrega al menos un producto."); return; }
    if (!esCliente && products.some((p) => !(Number(p.minutes) > 0))) { setError("Todos los productos deben tener tiempo de armado (minutos)."); return; }
    setBusy(true);
    try {
      const base = { ...f, service_number: f.service_number.trim() || null, request_type: esCliente ? "Ruta Critica" : f.request_type, customer_name: f.customer_name.trim(), phone: f.phone.trim(), address: f.address.trim(), neighborhood: f.neighborhood || null, notes: f.notes.trim() || null, customer_report: f.customer_report.trim() || null,
        products: products.map((p) => ({ ...p, minutes: Number(p.minutes) || 0, quantity: Math.max(1, Number(p.quantity) || 1) })), total_minutes: Math.round(total) };
      // El equipo valida que la dirección se ubique en una zona antes de crear el número de orden (el cliente no tiene los maestros de zonas).
      if (!esCliente) {
        const previa = P.ordenAFilas({ ...base, order_no: order?.order_no || "PREVIA" }, masters);
        if (P.filasSinZona(previa).length) throw new Error(`No se pudo ubicar la zona de ${f.city}${f.neighborhood ? ` · ${f.neighborhood}` : ""}. Elige otro barrio o revisa el maestro de zonas.`);
      }
      // Las fotos se suben antes de guardar la orden (en una carpeta temporal si es nueva) y quedan registradas en ella.
      const carpeta = editando ? order.order_no : `nuevas/${crypto.randomUUID()}`;
      const subidas = [], fallos = [];
      for (const file of nuevas) { try { subidas.push(await P.subirFoto(carpeta, file)); } catch (e) { fallos.push(e.message); } }
      const photos = [...(order?.photos || []), ...subidas];
      let o;
      if (editando) o = await P.updateOrder(order.id, { ...base, photos, updated_by: session.id, updated_at: new Date().toISOString() });
      else o = await P.createOrder({ ...base, photos, requester_email: session.email || null, created_by: session.id });
      let aviso = "";
      if (!esCliente) { try { await enviar(o, editando ? "Programación de servicio editada" : "Programación de servicio creada"); } catch (e) { aviso = e.message; } }
      await reload();
      setMsg(`${esCliente ? "Solicitud registrada" : editando ? "Orden actualizada" : "Servicio programado"}: ${o.order_no}.${fallos.length ? ` Algunas fotos no se subieron: ${fallos.join(" ")}` : ""}${aviso ? ` ${aviso}` : ""}`);
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const lbl = (t, req) => <label className="amg-label">{t}{req ? " *" : ""}</label>;
  return (
    <ui.Modal title={editando ? `Editar ${order.order_no}` : esCliente ? "Nueva solicitud · Ruta Crítica" : "Programar servicio"} onClose={onClose} width={860}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={busy || bloqueada} onClick={guardar}>{busy ? "Guardando..." : editando ? "Guardar cambios" : esCliente ? "Enviar solicitud" : "Programar"}</button></>}>
      {bloqueada && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> Esta orden ya está en gestión o realizada en Asignación: no se puede editar.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>{lbl("Orden de servicio")}<div className="amg-input amg-mono" style={{ background: "var(--panel)", color: "var(--text-faint)" }}>{order ? order.order_no : "Se genera sola al programar (PS-000001...)"}</div></div>
        <div>{lbl("Número de servicio", esCliente || f.request_type === "Ruta Critica")}<input className="amg-input amg-mono" value={f.service_number} onChange={(e) => setF({ ...f, service_number: e.target.value })} placeholder="El de Jamar / Extreme, ej. 5263760" /></div>
        <div>{lbl("Fecha de programación", true)}<input type="date" className="amg-input" value={f.scheduled_date} onChange={(e) => setF({ ...f, scheduled_date: e.target.value })} /></div>
        <div>{lbl("Nombre del cliente", true)}<input className="amg-input" value={f.customer_name} onChange={(e) => setF({ ...f, customer_name: e.target.value })} /></div>
        <div>{lbl("Teléfono", true)}<input className="amg-input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div>{lbl("Departamento", true)}
          <select className="amg-select" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value, city: "", neighborhood: "" })}>
            <option value="">Seleccionar...</option>{geo.deptos.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select></div>
        <div>{lbl("Ciudad", true)}
          <select className="amg-select" value={f.city} disabled={!f.department} onChange={(e) => setF({ ...f, city: e.target.value, neighborhood: "" })}>
            <option value="">{f.department ? "Seleccionar..." : "Elige primero el departamento"}</option>{ciudades.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div>{lbl("Barrio", barrios.length > 0)}
          <select className="amg-select" value={f.neighborhood} disabled={!f.city} onChange={(e) => setF({ ...f, neighborhood: e.target.value })}>
            <option value="">{!f.city ? "Elige primero la ciudad" : barrios.length ? "Seleccionar..." : "(Esta ciudad no tiene barrios en el maestro)"}</option>{barrios.map((b) => <option key={b} value={b}>{b}</option>)}
          </select></div>
        <div>{lbl("Tipo de solicitud", true)}
          <select className="amg-select" value={esCliente ? "Ruta Critica" : f.request_type} disabled={esCliente} onChange={(e) => setF({ ...f, request_type: e.target.value })}>{(esCliente ? ["Ruta Critica"] : P.TIPOS_SOLICITUD).map((t) => <option key={t}>{t}</option>)}</select></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Dirección", true)}<input className="amg-input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Señas")}<input className="amg-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Conjunto, torre, referencia..." /></div>
      </div>

      <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-dim)", margin: "16px 0 8px", borderTop: "1px solid var(--border)", paddingTop: 12 }}>Productos (del maestro) *</div>
      <ProductoPicker onPick={addProduct} esCliente={esCliente} />
      {products.length > 0 && (
        <table className="amg-table compact" style={{ marginTop: 8 }}>
          <thead><tr><th>Código</th><th>Producto</th><th>Cant.</th>{!esCliente && <th>Min c/u</th>}<th></th></tr></thead>
          <tbody>{products.map((p) => (
            <tr key={p.code}>
              <td className="amg-mono">{p.code}</td><td>{p.name}{!esCliente && p.persons === 2 && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-faint)" }}>· 2 personas</span>}</td>
              <td><input type="number" min="1" className="amg-input" style={{ width: 64 }} value={p.quantity} onChange={(e) => setProd(p.code, { quantity: e.target.value })} /></td>
              {!esCliente && <td><input type="number" min="1" className="amg-input" style={{ width: 80 }} value={p.minutes} onChange={(e) => setProd(p.code, { minutes: e.target.value })} /></td>}
              <td><button className="amg-btn ghost" style={{ padding: 4 }} title="Quitar" onClick={() => setProducts((l) => l.filter((x) => x.code !== p.code))}><X size={13} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {!esCliente && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>Tiempo total de armado: <b>{fmt(total)} min</b>. El tiempo sale del maestro de productos; puedes ajustarlo si esta orden lo requiere.</div>}

      <div style={{ marginTop: 14 }}>{lbl("Cliente reporta")}<textarea className="amg-textarea" rows={2} value={f.customer_report} onChange={(e) => setF({ ...f, customer_report: e.target.value })} placeholder="Ej. Armado del producto, desarme y empaque, jornada AM..." /></div>

      <div style={{ marginTop: 12 }}>{lbl("Fotos o PDF de la solicitud")}
        {(order?.photos || []).length > 0 && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>Ya adjuntas: {order.photos.map((x) => x.name).join(", ")}</div>}
        <label className="amg-btn" style={{ cursor: "pointer" }}><Paperclip size={14} /> {nuevas.length ? `${nuevas.length} archivo(s) por subir` : "Adjuntar archivos"}
          <input type="file" multiple accept="image/*,.pdf" style={{ display: "none" }} onChange={(e) => { setNuevas([...nuevas, ...Array.from(e.target.files)]); e.target.value = ""; }} /></label>
        {nuevas.length > 0 && <span style={{ marginLeft: 8, fontSize: 12 }}>{nuevas.map((x) => x.name).join(", ")} <button className="amg-btn ghost" style={{ padding: 2 }} onClick={() => setNuevas([])}>Quitar</button></span>}
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>Imágenes o PDF, hasta 10 MB cada uno.</div>
      </div>
      {error && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {error}</div>}
    </ui.Modal>
  );
}

/* ----------------------------------- Detalle y cancelación ----------------------------------- */

function DetalleModal({ ui, esCliente, order: o, servicios, tecnicos, creador, onClose }) {
  const [error, setError] = useState("");
  const abrir = async (ph) => {
    const w = window.open("", "_blank");
    try { const url = await P.urlFoto(ph.path); if (w) w.location.href = url; else window.location.href = url; }
    catch (e) { if (w) w.close(); setError(e.message); }
  };
  const fila = (t, v) => <div><div className="amg-label">{t}</div><div style={{ fontSize: 13 }}>{v || "-"}</div></div>;
  return (
    <ui.Modal title={`Orden ${o.order_no}`} onClose={onClose} width={760} footer={<button className="amg-btn" onClick={onClose}>Cerrar</button>}>
      {o.status === "Cancelada" && <div className="amg-alert danger" style={{ marginBottom: 12 }}><Ban size={14} /> Cancelada{o.cancel_reason ? `: ${o.cancel_reason}` : ""}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        {fila("Número de servicio", o.service_number)}{fila("Fecha de programación", ui.fmtDate(o.scheduled_date))}{fila("Tipo de solicitud", o.request_type)}{fila("Estado", esCliente ? o.status : P.estadoOrden(o, servicios).texto)}
        {fila("Cliente", o.customer_name)}{fila("Teléfono", o.phone)}{esCliente ? <div /> : fila("Técnico", tecnicos.join(", "))}
        {fila("Departamento", o.department)}{fila("Ciudad", o.city)}{fila("Barrio", o.neighborhood)}
      </div>
      <div style={{ marginBottom: 12 }}>{fila("Dirección", o.address)}</div>
      <div style={{ marginBottom: 12 }}>{fila("Señas", o.notes)}</div>
      <div style={{ marginBottom: 12 }}>{fila("Cliente reporta", o.customer_report)}</div>
      <table className="amg-table compact">
        <thead><tr><th>Código</th><th>Producto</th><th>Cant.</th>{!esCliente && <th>Min c/u</th>}</tr></thead>
        <tbody>{(o.products || []).map((p) => <tr key={p.code}><td className="amg-mono">{p.code}</td><td>{p.name}</td><td className="amg-mono">{p.quantity}</td>{!esCliente && <td className="amg-mono">{p.minutes}</td>}</tr>)}</tbody>
      </table>
      {!esCliente && <div style={{ fontSize: 12.5, margin: "6px 0 12px" }}>Tiempo total: <b>{fmt(o.total_minutes)} min</b></div>}
      {(o.photos || []).length > 0 && <div style={{ marginBottom: 12 }}><div className="amg-label">Fotos / PDF adjuntos</div>
        {o.photos.map((ph) => <button key={ph.path} className="amg-btn ghost" style={{ marginRight: 6, fontSize: 12 }} onClick={() => abrir(ph)}><Paperclip size={12} /> {ph.name}</button>)}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Creada por {creador || "-"} el {String(o.created_at).slice(0, 16).replace("T", " ")}{o.requester_email ? ` · ${o.requester_email}` : ""}</div>
    </ui.Modal>
  );
}

function CancelarModal({ ui, order, onConfirm, onClose }) {
  const [motivo, setMotivo] = useState("");
  return (
    <ui.Modal title={`Cancelar ${order.order_no}`} onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Volver</button><button className="amg-btn primary" disabled={!motivo.trim()} onClick={() => onConfirm(motivo.trim())}>Cancelar la orden</button></>}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>La orden dejará de aparecer en Asignación. No se borra: queda registrada como cancelada.</div>
      <label className="amg-label">Motivo *</label>
      <textarea className="amg-textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
    </ui.Modal>
  );
}
