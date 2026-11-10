import { useState, useEffect, useMemo, useRef } from "react";
import { Check, AlertTriangle, Plus, X, History as HistoryIcon, Ban, Paperclip, FileText } from "lucide-react";
import * as V from "./lib/ventas";
import { cargarServiciosDelDia, agruparPorServicio } from "./lib/ruta";

/* ============================================================================
   COMERCIAL → VENTAS
   Los técnicos venden productos (Full Fresh diluido, forros, protectores...) durante el servicio o a clientes particulares.
   Su inventario es lo que se les ENTREGÓ en Inventario menos lo que vendieron: cada venta lo descuenta, y anular una venta lo devuelve.
   El precio y la comisión salen de la lista de precios (solo el administrador la cambia); cada venta guarda los vigentes al vender. Cada venta tiene su consecutivo (VEN-000001).
   Técnico: ve su inventario y sus ventas, y registra. Administrador y operador: todo, registran a nombre de un técnico y anulan. Consulta: solo ve.
============================================================================ */

const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const TABS_EQUIPO = [["ventas", "Ventas"], ["inventario", "Inventario por técnico"], ["resumen", "Resumen"], ["precios", "Precios y comisiones"]];

/* ------------------------------- Registrar venta ------------------------------- */
function VentaModal({ db, session, ui, inv, esTecnico, onClose, onGuardada }) {
  const hoy = ui.todayISO();
  const tecnicosConStock = useMemo(() => {
    const ids = [...new Set(inv.filter((r) => r.stock > 0 && r.enVenta).map((r) => r.technicianId))];
    return ids.map((id) => (db.technicians || []).find((t) => t.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [inv, db.technicians]);
  const [tecId, setTecId] = useState(esTecnico ? session.technicianId : (tecnicosConStock[0] || {}).id || "");
  const [fecha, setFecha] = useState(hoy);
  const [origen, setOrigen] = useState("servicio");
  const [servicio, setServicio] = useState("");
  const [cliente, setCliente] = useState("");
  const [tipoDoc, setTipoDoc] = useState("CC");
  const [doc, setDoc] = useState("");
  const [pago, setPago] = useState("Efectivo");
  const [nota, setNota] = useState("");
  const [ref, setRef] = useState("");
  const [archivo, setArchivo] = useState(null);   // soporte de la transferencia
  const subido = useRef(null);                     // soporte ya subido (si el registro falla y se reintenta, no se sube otra vez)
  const auto = useRef({ cliente: false, doc: false }); // lo que se llenó solo desde el servicio (se puede corregir)
  const [docDeServicio, setDocDeServicio] = useState(false);
  const [lineas, setLineas] = useState([{ productId: "", cantidad: 1 }]);
  const [ruta, setRuta] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Productos que ese técnico puede vender: los que tiene en stock y están en venta
  const disponibles = useMemo(() => inv.filter((r) => r.technicianId === tecId && r.enVenta && r.stock > 0), [inv, tecId]);
  // Servicios de su ruta de hoy: sirven para elegir el número de servicio y traer el nombre del cliente
  useEffect(() => {
    if (!tecId || origen !== "servicio") { setRuta([]); return; }
    let alive = true;
    cargarServiciosDelDia(tecId, fecha).then((s) => { if (alive) setRuta(agruparPorServicio(s)); }).catch(() => { if (alive) setRuta([]); });
    return () => { alive = false; };
  }, [tecId, origen, fecha]);

  // Al elegir un servicio de la ruta se llenan solos el nombre y el documento del cliente (los trae la base de Jamar); si el servicio no trae el documento, se escribe a mano.
  const elegirServicio = (v) => {
    setServicio(v);
    const g = ruta.find((x) => x.servicio === v.trim());
    if (!g) return;
    if (g.cliente && (!cliente.trim() || auto.current.cliente)) { setCliente(g.cliente); auto.current.cliente = true; }
    if (g.documento && (!doc.trim() || auto.current.doc)) { setDoc(g.documento); auto.current.doc = true; setDocDeServicio(true); } else if (!g.documento && auto.current.doc) { setDoc(""); auto.current.doc = false; setDocDeServicio(false); }
  };
  const lin = lineas.map((l) => { const p = disponibles.find((r) => r.productId === l.productId); const cant = Math.floor(Number(l.cantidad) || 0); return { ...l, p, cant, valor: p ? p.precio * cant : 0, comision: p ? p.comision * cant : 0 }; });
  const usado = (pid, excepto) => lin.reduce((s, l, i) => s + (l.productId === pid && i !== excepto ? l.cant : 0), 0);
  const total = lin.reduce((s, l) => s + l.valor, 0), comisionTotal = lin.reduce((s, l) => s + l.comision, 0);
  const problemas = [];
  if (!tecId) problemas.push("Falta el técnico.");
  if (!cliente.trim()) problemas.push("Escribe el nombre del cliente.");
  if (!doc.trim()) problemas.push("Escribe el documento del cliente (se necesita para facturar).");
  if (!lin.some((l) => l.p && l.cant > 0)) problemas.push("Agrega al menos un producto.");
  if (pago === "Transferencia" && !archivo) problemas.push("Adjunta el soporte de la transferencia.");
  lin.forEach((l, i) => { if (l.productId && l.p && l.cant + usado(l.productId, i) > l.p.stock) problemas.push(`De ${l.p.nombre} solo tienes ${l.p.stock}.`); });

  const guardar = async () => {
    setBusy(true); setError("");
    try {
      let soporte = null;
      if (pago === "Transferencia") {
        const clave = `${tecId}|${archivo.name}|${archivo.size}`;
        if (!subido.current || subido.current.clave !== clave) subido.current = { clave, ...(await V.subirSoporteVenta(tecId, archivo)) };
        soporte = subido.current;
      }
      const v = await V.registrarVenta({
        ...(esTecnico ? {} : { technician_id: tecId, sale_date: fecha }), origin: origen, service_no: servicio.trim(), customer_name: cliente.trim(), doc_type: tipoDoc, doc_number: doc.trim().replace(/[.\s,]/g, ""),
        payment_method: pago, payment_ref: pago === "Transferencia" ? ref.trim() : "", payment_proof_path: soporte ? soporte.path : "", payment_proof_name: soporte ? soporte.nombre : "", notes: nota.trim(), items: lin.filter((l) => l.p && l.cant > 0).map((l) => ({ product_id: l.productId, quantity: l.cant })),
      });
      onGuardada(v);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <ui.Modal title="Registrar venta" onClose={onClose} width={640}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={busy || problemas.length > 0} onClick={guardar}>{busy ? "Guardando..." : `Registrar venta · ${V.fmtCOP(total)}`}</button></>}>
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        {!esTecnico && (
          <>
            <div><label className="amg-label">Técnico</label>
              <select className="amg-select" value={tecId} onChange={(e) => { setTecId(e.target.value); setLineas([{ productId: "", cantidad: 1 }]); }}><option value="">Elegir...</option>{tecnicosConStock.map((t) => <option key={t.id} value={t.id}>{t.name.replace(/_/g, " ")}</option>)}</select></div>
            <div><label className="amg-label">Fecha de la venta</label><input type="date" className="amg-input" value={fecha} max={hoy} onChange={(e) => e.target.value && setFecha(e.target.value)} /></div>
          </>
        )}
        <div style={{ gridColumn: "1 / -1" }}>
          <label className="amg-label">¿Dónde se hizo la venta?</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={`amg-btn ${origen === "servicio" ? "primary" : ""}`} onClick={() => setOrigen("servicio")}>Durante un servicio</button>
            <button className={`amg-btn ${origen === "particular" ? "primary" : ""}`} onClick={() => { setOrigen("particular"); setServicio(""); }}>Cliente particular (sin servicio)</button>
          </div>
        </div>
        {origen === "servicio" && (
          <div style={{ gridColumn: "1 / -1" }}><label className="amg-label">Número de servicio</label>
            <input className="amg-input" list="ventas-rutas" placeholder={ruta.length ? "Elige de tu ruta o escribe el número" : "Escribe el número de servicio"} value={servicio} onChange={(e) => elegirServicio(e.target.value)} />
            <datalist id="ventas-rutas">{ruta.map((g) => <option key={g.servicio} value={g.servicio}>{g.cliente}</option>)}</datalist></div>
        )}
        <div style={{ gridColumn: "1 / -1" }}><label className="amg-label">Nombre del cliente</label><input className="amg-input" value={cliente} onChange={(e) => { setCliente(e.target.value); auto.current.cliente = false; }} /></div>
        <div><label className="amg-label">Tipo de documento</label><select className="amg-select" value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)}>{V.TIPOS_DOC.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        <div><label className="amg-label">Número de documento</label><input className="amg-input amg-mono" inputMode="numeric" value={doc} onChange={(e) => { setDoc(e.target.value); auto.current.doc = false; setDocDeServicio(false); }} />
          <div style={{ fontSize: 11, color: docDeServicio ? "var(--green)" : "var(--text-faint)", marginTop: 3 }}>{docDeServicio ? "Viene del servicio; corrígelo si no es." : "Escríbelo si el servicio no lo trae."}</div></div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="amg-label">Productos</label>
        {disponibles.length === 0 && <div className="amg-alert danger"><AlertTriangle size={14} /> {tecId ? "Ese técnico no tiene productos con stock para vender." : "Elige un técnico."}</div>}
        {lin.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
            <select className="amg-select" style={{ flex: "2 1 200px" }} value={l.productId} onChange={(e) => setLineas(lineas.map((x, k) => (k === i ? { ...x, productId: e.target.value } : x)))}>
              <option value="">Elegir producto...</option>
              {disponibles.map((r) => <option key={r.productId} value={r.productId}>{r.nombre} · {V.fmtCOP(r.precio)} · stock {r.stock}</option>)}
            </select>
            <input type="number" min="1" className="amg-input" style={{ width: 80 }} value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))} />
            <span className="amg-mono" style={{ minWidth: 90, textAlign: "right" }}>{V.fmtCOP(l.valor)}</span>
            {lineas.length > 1 && <button className="amg-btn ghost" title="Quitar" onClick={() => setLineas(lineas.filter((_, k) => k !== i))}><X size={14} /></button>}
          </div>
        ))}
        <button className="amg-btn" onClick={() => setLineas([...lineas, { productId: "", cantidad: 1 }])}><Plus size={14} /> Agregar otro producto</button>
        <div style={{ marginTop: 8, fontSize: 13 }}>Total: <b>{V.fmtCOP(total)}</b> · tu comisión: <b style={{ color: "var(--green)" }}>{V.fmtCOP(comisionTotal)}</b></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 14 }}>
        <div><label className="amg-label">Forma de pago</label><select className="amg-select" value={pago} onChange={(e) => setPago(e.target.value)}>{V.PAGOS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
        {pago === "Transferencia" && (
          <div style={{ gridColumn: "1 / -1", padding: 10, background: "var(--panel-2)", borderRadius: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>Transferencia: registra el pago</div>
            <label className="amg-label">Referencia o número de aprobación (opcional)</label>
            <input className="amg-input amg-mono" value={ref} onChange={(e) => setRef(e.target.value)} />
            <label className="amg-label" style={{ marginTop: 8 }}>Soporte de la transferencia (foto o PDF del comprobante) · obligatorio</label>
            <label className="amg-btn" style={{ cursor: "pointer" }}><Paperclip size={14} /> {archivo ? "Cambiar soporte" : "Adjuntar soporte"}
              <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => { setArchivo(e.target.files[0] || null); e.target.value = ""; }} /></label>
            {archivo && <span style={{ marginLeft: 8, fontSize: 12.5 }}><FileText size={13} /> {archivo.name}</span>}
          </div>
        )}
        <div style={{ gridColumn: "1 / -1" }}><label className="amg-label">Observación (opcional)</label><input className="amg-input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
      </div>
      {problemas.length > 0 && <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-faint)" }}>{problemas[0]}</div>}
    </ui.Modal>
  );
}

/* ------------------------------- Módulo ------------------------------- */
export default function Ventas({ db, session, ui, persist, addAudit }) {
  const esTecnico = session.role === "tecnico";
  const puedeRegistrar = esTecnico || session.role === "admin" || session.role === "operador";
  const puedeAnular = session.role === "admin" || session.role === "operador";
  const puedePrecios = session.role === "admin";
  const hoy = ui.todayISO();
  const [tab, setTab] = useState("ventas");
  const [from, setFrom] = useState(`${hoy.slice(0, 7)}-01`);
  const [to, setTo] = useState(hoy);
  const [ventas, setVentas] = useState(null);
  const [inv, setInv] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [modal, setModal] = useState(false);
  const [anulando, setAnulando] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [abierta, setAbierta] = useState(null);
  const [f, setF] = useState({ tec: "", estado: "", busca: "" });
  const [catalogo, setCatalogo] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [edit, setEdit] = useState({}); // productId → { precio, comision, activo }
  const [verHist, setVerHist] = useState(null);
  const [busy, setBusy] = useState("");
  // El técnico puede cambiar el soporte de su venta hasta 2 horas después de registrarla; administrador y operador, siempre.
  const puedeCambiarSoporte = (v) => v.estado === "Activa" && v.pago === "Transferencia" && (puedeAnular || (esTecnico && Date.now() - new Date(v.creadaEn).getTime() < 2 * 3600 * 1000));
  const verSoporte = async (v) => { setError(""); try { window.open(await V.urlSoporteVenta(v.soportePath), "_blank", "noopener"); } catch (e) { setError(`No se pudo abrir el soporte: ${e.message}`); } };
  const cambiarSoporte = async (v, file) => {
    if (!file) return;
    setBusy(`sop-${v.id}`); setError(""); setMsg("");
    try { await V.adjuntarSoporteVenta(v, file); setMsg(`Soporte de la venta ${v.consecutivo} guardado.`); setRecarga((n) => n + 1); } catch (e) { setError(e.message); }
    setBusy("");
  };

  useEffect(() => {
    let alive = true;
    setError("");
    Promise.all([V.cargarVentas({ from, to }), V.inventarioVentas()])
      .then(([v, i]) => { if (alive) { setVentas(v); setInv(i); } })
      .catch((e) => { if (alive) { setVentas([]); setInv([]); setError(`${e.message}. Si es la primera vez, falta correr el SQL de Comercial / Ventas (sql/58) en Supabase.`); } });
    return () => { alive = false; };
  }, [from, to, recarga]);
  useEffect(() => {
    if (esTecnico) return;
    let alive = true;
    Promise.all([V.cargarCatalogo(), V.cargarHistorialPrecios()]).then(([c, h]) => { if (alive) { setCatalogo(c); setHistorial(h); } }).catch(() => { if (alive) { setCatalogo([]); setHistorial([]); } });
    return () => { alive = false; };
  }, [recarga]);

  const nombreTec = (id) => ((db.technicians || []).find((t) => t.id === id) || {}).name?.replace(/_/g, " ") || "-";
  const filas = useMemo(() => {
    const q = V.plano(f.busca);
    return (ventas || []).filter((v) => (!f.tec || v.technicianId === f.tec) && (!f.estado || v.estado === f.estado)
      && (!q || V.plano(`${v.consecutivo} ${v.cliente} ${v.documento} ${v.servicio} ${nombreTec(v.technicianId)}`).includes(q)));
  }, [ventas, f, db.technicians]);
  const R = useMemo(() => V.resumirVentas(filas), [filas]);
  const tecnicosConVentas = useMemo(() => [...new Set((ventas || []).map((v) => v.technicianId))].map((id) => ({ id, name: nombreTec(id) })).sort((a, b) => a.name.localeCompare(b.name, "es")), [ventas, db.technicians]);
  const misProductos = (inv || []).filter((r) => r.enVenta || r.stock > 0);

  const productosStock = (db.products || []).filter((p) => p.trackStock && p.active).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const filaCat = (pid) => (catalogo || []).find((c) => c.product_id === pid);
  const valorEdit = (p) => { const c = filaCat(p.id), e = edit[p.id] || {}; return { precio: e.precio ?? (c ? c.unit_price : ""), comision: e.comision ?? (c ? c.commission : ""), activo: e.activo ?? (c ? c.active : true) }; };
  const guardarPrecio = async (p) => {
    const v = valorEdit(p); const c = filaCat(p.id);
    if (v.precio === "" || Number(v.precio) < 0) { setError("Escribe el precio de venta."); return; }
    setBusy(p.id); setError(""); setMsg("");
    try {
      await V.guardarPrecio({ productId: p.id, unitPrice: v.precio, commission: v.comision === "" ? 0 : v.comision, active: v.activo, userId: session.id });
      persist(addAudit(db, { userId: session.id, action: c ? "Cambio de precio de venta" : "Producto puesto en venta", record: p.name, oldValue: c ? `${V.fmtCOP(c.unit_price)} · comisión ${V.fmtCOP(c.commission)}${c.active ? "" : " (fuera de venta)"}` : "-", newValue: `${V.fmtCOP(v.precio)} · comisión ${V.fmtCOP(v.comision || 0)}${v.activo ? "" : " (fuera de venta)"}` }));
      setEdit((x) => { const n = { ...x }; delete n[p.id]; return n; }); setMsg(`Precio de ${p.name} guardado.`); setRecarga((n) => n + 1);
    } catch (e) { setError(`No se pudo guardar: ${e.message}`); }
    setBusy("");
  };
  const anular = async () => {
    setBusy("anular"); setError("");
    try {
      await V.anularVenta(anulando.id, motivo);
      persist(addAudit(db, { userId: session.id, action: "Venta anulada", record: anulando.consecutivo, oldValue: V.fmtCOP(anulando.total), newValue: motivo.trim() }));
      setMsg(`Venta ${anulando.consecutivo} anulada: las unidades volvieron al inventario del técnico.`); setAnulando(null); setMotivo(""); setRecarga((n) => n + 1);
    } catch (e) { setError(e.message); }
    setBusy("");
  };

  const exportarVentas = () => ui.downloadCSV(`ventas_${from}_${to}.csv`,
    ["Consecutivo", "Fecha", "Técnico", "Origen", "Servicio", "Cliente", "Tipo doc.", "Documento", "Producto", "Cantidad", "Precio unitario", "Total línea", "Comisión línea", "Forma de pago", "Referencia de la transferencia", "Soporte adjunto", "Estado", "Observación"],
    filas.flatMap((v) => v.items.map((i) => [v.consecutivo, v.fecha, nombreTec(v.technicianId), v.origen === "servicio" ? "Servicio" : "Particular", v.servicio, v.cliente, v.tipoDoc, v.documento, i.nombre, i.cantidad, i.precio, i.total, i.comisionTotal, v.pago, v.referencia, v.pago === "Transferencia" ? (v.soportePath ? "Sí" : "No") : "", v.estado, v.nota])));
  const exportarInventario = () => ui.downloadCSV(`inventario_ventas_por_tecnico.csv`, ["Técnico", "Producto", "Entregado", "Vendido", "Stock", "Precio", "Comisión por unidad", "En venta"],
    (inv || []).map((r) => [nombreTec(r.technicianId), r.nombre, r.entregado, r.vendido, r.stock, r.precio, r.comision, r.enVenta ? "Sí" : "No"]));
  const exportarResumen = () => ui.downloadCSV(`resumen_ventas_${from}_${to}.csv`, ["Técnico", "Ventas", "Unidades", "Valor vendido", "Comisión"],
    [...R.porTec.map((t) => [nombreTec(t.technicianId), t.ventas, t.unidades, t.valor, t.comision]), ["TOTAL", R.total.ventas, R.total.unidades, R.total.valor, R.total.comision]]);

  const tabs = esTecnico ? [] : TABS_EQUIPO;
  const filtroFechas = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="date" className="amg-input" style={{ width: 140 }} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
      <span style={{ color: "var(--text-faint)" }}>a</span>
      <input type="date" className="amg-input" style={{ width: 140 }} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
      <button className="amg-btn" onClick={() => { setFrom(`${hoy.slice(0, 7)}-01`); setTo(hoy); }}>Este mes</button>
      <button className="amg-btn" onClick={() => { const u = sumarDias(`${hoy.slice(0, 7)}-01`, -1); setFrom(`${u.slice(0, 7)}-01`); setTo(u); }}>Mes anterior</button>
      <button className="amg-btn" onClick={() => { setFrom(hoy); setTo(hoy); }}>Hoy</button>
    </div>
  );

  const tablaVentas = (
    <div className="amg-card" style={{ overflowX: "auto" }}>
      <table className="amg-table compact" style={{ fontSize: 12.5 }}>
        <thead><tr><th>Venta</th><th>Fecha</th>{!esTecnico && <th>Técnico</th>}<th>Cliente</th><th>Servicio</th><th>Productos</th><th>Total</th><th>Comisión</th><th>Pago</th><th>Estado</th></tr></thead>
        <tbody>
          {filas.map((v) => [
            <tr key={v.id} style={{ cursor: "pointer", opacity: v.estado === "Anulada" ? 0.55 : 1 }} onClick={() => setAbierta(abierta === v.id ? null : v.id)}>
              <td className="amg-mono" style={{ fontWeight: 700 }}>{v.consecutivo}</td><td>{ui.fmtDate(v.fecha)}</td>{!esTecnico && <td>{nombreTec(v.technicianId)}</td>}
              <td>{v.cliente}</td><td className="amg-mono">{v.origen === "servicio" ? (v.servicio || "-") : "Particular"}</td>
              <td>{v.items.map((i) => `${i.nombre} ×${i.cantidad}`).join(", ")}</td>
              <td className="amg-mono" style={{ fontWeight: 700 }}>{V.fmtCOP(v.total)}</td><td className="amg-mono" style={{ color: "var(--green)" }}>{V.fmtCOP(v.comision)}</td><td>{v.pago}{v.pago === "Transferencia" && v.estado === "Activa" && !v.soportePath && <div><ui.Badge text="Sin soporte" color="amber" /></div>}</td>
              <td>{v.estado === "Anulada" ? <ui.Badge text="Anulada" color="red" /> : <ui.Badge text="Activa" color="green" />}</td>
            </tr>,
            abierta === v.id && (
              <tr key={`${v.id}|d`}><td colSpan={esTecnico ? 9 : 10} style={{ padding: 0 }}>
                <div style={{ background: "var(--panel-2)", padding: 10, fontSize: 12.5, lineHeight: 1.6 }}>
                  <div><b>Cliente:</b> {v.cliente} · <b>{v.tipoDoc || "Documento"}:</b> <span className="amg-mono">{v.documento || "-"}</span>{v.nota ? <> · <b>Observación:</b> {v.nota}</> : null}</div>
                  <table className="amg-table compact" style={{ fontSize: 12, marginTop: 6 }}>
                    <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Total</th><th>Comisión</th></tr></thead>
                    <tbody>{v.items.map((i, k) => <tr key={k}><td>{i.nombre}</td><td className="amg-mono">{i.cantidad}</td><td className="amg-mono">{V.fmtCOP(i.precio)}</td><td className="amg-mono">{V.fmtCOP(i.total)}</td><td className="amg-mono">{V.fmtCOP(i.comisionTotal)}</td></tr>)}</tbody>
                  </table>
                  {v.pago === "Transferencia" && (
                    <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span><b>Transferencia</b>{v.referencia ? <> · referencia <span className="amg-mono">{v.referencia}</span></> : null}</span>
                      {v.soportePath ? <button className="amg-btn" onClick={(e) => { e.stopPropagation(); verSoporte(v); }}><FileText size={13} /> Ver soporte</button> : <ui.Badge text="Sin soporte" color="amber" />}
                      {puedeCambiarSoporte(v) && (
                        <label className="amg-btn ghost" style={{ cursor: "pointer" }} onClick={(e) => e.stopPropagation()}><Paperclip size={13} /> {busy === `sop-${v.id}` ? "Subiendo..." : v.soportePath ? "Reemplazar soporte" : "Adjuntar soporte"}
                          <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => { cambiarSoporte(v, e.target.files[0]); e.target.value = ""; }} /></label>
                      )}
                    </div>
                  )}
                  {v.estado === "Anulada" && <div style={{ color: "var(--red)", marginTop: 6 }}>Anulada: {v.motivoAnulacion}</div>}
                  {puedeAnular && v.estado === "Activa" && <button className="amg-btn danger" style={{ marginTop: 8 }} onClick={(e) => { e.stopPropagation(); setAnulando(v); setMotivo(""); }}><Ban size={13} /> Anular venta</button>}
                </div>
              </td></tr>
            ),
          ])}
          {ventas !== null && filas.length === 0 && <tr><td colSpan={esTecnico ? 9 : 10} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay ventas en este rango.</td></tr>}
          {ventas === null && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Cargando...</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <div style={{ fontWeight: 600, marginRight: 4 }}>{esTecnico ? "Mis ventas" : "Ventas"}</div>
        {tabs.map(([k, n]) => <button key={k} className={`amg-btn ${tab === k ? "primary" : ""}`} onClick={() => setTab(k)}>{n}</button>)}
        {puedeRegistrar && <button className="amg-btn primary" style={{ marginLeft: "auto" }} onClick={() => setModal(true)}><Plus size={14} /> Registrar venta</button>}
      </div>
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}

      {esTecnico && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
            {misProductos.map((r) => <ui.StatCard key={r.productId} label={r.nombre} value={`${fmtInt(r.stock)} und`} accent={r.stock > 0} sub={`${V.fmtCOP(r.precio)} · entregado ${fmtInt(r.entregado)} · vendido ${fmtInt(r.vendido)}`} />)}
            {inv !== null && misProductos.length === 0 && <div className="amg-card" style={{ padding: 16, color: "var(--text-dim)" }}>Aún no tienes productos para vender en tu inventario.</div>}
          </div>
          <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>{filtroFechas}
            <span style={{ fontSize: 13 }}><b>{R.total.ventas}</b> venta(s) · <b>{fmtInt(R.total.unidades)}</b> und · <b>{V.fmtCOP(R.total.valor)}</b> · comisión <b style={{ color: "var(--green)" }}>{V.fmtCOP(R.total.comision)}</b></span></div>
          {tablaVentas}
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>Tu inventario es lo que se te entregó menos lo que has vendido. Cada venta lo descuenta. El precio y tu comisión los define Biver: no se pueden cambiar al vender. Las ventas anuladas no cuentan.</div>
        </>
      )}

      {!esTecnico && tab === "ventas" && (
        <>
          <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {filtroFechas}
            <select className="amg-select" style={{ width: 180 }} value={f.tec} onChange={(e) => setF({ ...f, tec: e.target.value })}><option value="">Todos los técnicos</option>{tecnicosConVentas.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <select className="amg-select" style={{ width: 130 }} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todas</option><option>Activa</option><option>Anulada</option></select>
            <input className="amg-input" style={{ width: 200 }} placeholder="Buscar venta, cliente, documento..." value={f.busca} onChange={(e) => setF({ ...f, busca: e.target.value })} />
            <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!filas.length} onClick={exportarVentas}>Exportar CSV</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 12 }}>
            <ui.StatCard label="Ventas activas" value={fmtInt(R.total.ventas)} accent /><ui.StatCard label="Unidades vendidas" value={fmtInt(R.total.unidades)} />
            <ui.StatCard label="Valor vendido" value={V.fmtCOP(R.total.valor)} accent /><ui.StatCard label="Comisión de técnicos" value={V.fmtCOP(R.total.comision)} />
          </div>
          {tablaVentas}
        </>
      )}

      {!esTecnico && tab === "inventario" && (
        <div className="amg-card" style={{ overflowX: "auto" }}>
          <div style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Lo entregado a cada técnico (Inventario → Entrega) menos lo que ha vendido, de los productos que están en venta.</span>
            <button className="amg-btn" disabled={!(inv || []).length} onClick={exportarInventario}>Exportar CSV</button>
          </div>
          <table className="amg-table compact" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Técnico</th><th>Producto</th><th>Entregado</th><th>Vendido</th><th>Stock del técnico</th><th>Precio</th></tr></thead>
            <tbody>
              {(inv || []).slice().sort((a, b) => nombreTec(a.technicianId).localeCompare(nombreTec(b.technicianId), "es") || a.nombre.localeCompare(b.nombre, "es")).map((r) => (
                <tr key={`${r.technicianId}|${r.productId}`}>
                  <td style={{ fontWeight: 600 }}>{nombreTec(r.technicianId)}</td><td>{r.nombre}{!r.enVenta && <span style={{ marginLeft: 6 }}><ui.Badge text="Fuera de venta" color="amber" /></span>}</td>
                  <td className="amg-mono">{fmtInt(r.entregado)}</td><td className="amg-mono">{fmtInt(r.vendido)}</td><td className="amg-mono" style={{ fontWeight: 700, color: r.stock > 0 ? "var(--green)" : "var(--text-faint)" }}>{fmtInt(r.stock)}</td><td className="amg-mono">{V.fmtCOP(r.precio)}</td>
                </tr>
              ))}
              {inv !== null && inv.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Ningún técnico tiene productos en venta en su inventario. Pon un producto en venta en «Precios y comisiones» y entrégalo a los técnicos en Inventario.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!esTecnico && tab === "resumen" && (
        <>
          <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>{filtroFechas}<button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!R.porTec.length} onClick={exportarResumen}>Exportar CSV</button></div>
          <div className="amg-card" style={{ overflowX: "auto", marginBottom: 12 }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Técnico</th><th>Ventas</th><th>Unidades</th><th>Valor vendido</th><th>Comisión</th></tr></thead>
              <tbody>
                {R.porTec.slice().sort((a, b) => b.valor - a.valor).map((t) => <tr key={t.technicianId}><td style={{ fontWeight: 600 }}>{nombreTec(t.technicianId)}</td><td className="amg-mono">{t.ventas}</td><td className="amg-mono">{fmtInt(t.unidades)}</td><td className="amg-mono">{V.fmtCOP(t.valor)}</td><td className="amg-mono" style={{ color: "var(--green)", fontWeight: 700 }}>{V.fmtCOP(t.comision)}</td></tr>)}
                {R.porTec.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay ventas activas en este rango.</td></tr>}
                {R.porTec.length > 0 && <tr style={{ fontWeight: 700, background: "var(--panel-2)" }}><td>TOTAL</td><td className="amg-mono">{R.total.ventas}</td><td className="amg-mono">{fmtInt(R.total.unidades)}</td><td className="amg-mono">{V.fmtCOP(R.total.valor)}</td><td className="amg-mono">{V.fmtCOP(R.total.comision)}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="amg-card" style={{ overflowX: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Producto</th><th>Unidades</th><th>Valor vendido</th><th>Comisión</th></tr></thead>
              <tbody>{R.porProd.map((p) => <tr key={p.productId}><td style={{ fontWeight: 600 }}>{p.nombre}</td><td className="amg-mono">{fmtInt(p.unidades)}</td><td className="amg-mono">{V.fmtCOP(p.valor)}</td><td className="amg-mono">{V.fmtCOP(p.comision)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      {!esTecnico && tab === "precios" && (
        <div className="amg-card" style={{ overflowX: "auto" }}>
          <div style={{ padding: 10, fontSize: 12.5, color: "var(--text-dim)" }}>
            Aquí defines qué productos se venden, a qué precio y cuánta comisión recibe el técnico por unidad. Solo salen los insumos que <b>controlan inventario</b> (Insumos / elementos → «Controla inventario»). Cada venta guarda el precio y la comisión vigentes al venderla: cambiarlos aquí no altera las ventas anteriores.
            {!puedePrecios && " Solo el administrador puede modificarlos."}
          </div>
          <table className="amg-table compact" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Producto</th><th>Precio de venta</th><th>Comisión por unidad</th><th>En venta</th><th></th></tr></thead>
            <tbody>
              {productosStock.map((p) => {
                const c = filaCat(p.id), v = valorEdit(p), cambiado = !!edit[p.id];
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}{!c && <span style={{ marginLeft: 6 }}><ui.Badge text="No está en venta" color="gray" /></span>}</td>
                    <td><input type="number" min="0" className="amg-input amg-mono" style={{ width: 120 }} disabled={!puedePrecios} value={v.precio} onChange={(e) => setEdit({ ...edit, [p.id]: { ...edit[p.id], precio: e.target.value } })} /></td>
                    <td><input type="number" min="0" className="amg-input amg-mono" style={{ width: 120 }} disabled={!puedePrecios} value={v.comision} onChange={(e) => setEdit({ ...edit, [p.id]: { ...edit[p.id], comision: e.target.value } })} /></td>
                    <td><input type="checkbox" disabled={!puedePrecios} checked={!!v.activo} onChange={(e) => setEdit({ ...edit, [p.id]: { ...edit[p.id], activo: e.target.checked } })} /></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {puedePrecios && <button className="amg-btn primary" disabled={busy === p.id || (c && !cambiado) || (!c && v.precio === "")} onClick={() => guardarPrecio(p)}>{busy === p.id ? "Guardando..." : c ? "Guardar" : "Poner en venta"}</button>}
                      {c && <button className="amg-btn ghost" title="Historial de cambios" onClick={() => setVerHist(p)}><HistoryIcon size={14} /></button>}
                    </td>
                  </tr>
                );
              })}
              {catalogo !== null && productosStock.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay insumos con inventario. Crea el producto en Insumos / elementos marcando «Controla inventario», regístrale la compra y entrégalo a los técnicos en Inventario.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal && <VentaModal db={db} session={session} ui={ui} inv={inv || []} esTecnico={esTecnico} onClose={() => setModal(false)} onGuardada={(v) => { setModal(false); setMsg(`Venta ${v.consecutive} registrada por ${V.fmtCOP(v.total)}.`); setRecarga((n) => n + 1); }} />}

      {anulando && (
        <ui.ConfirmModal title={`Anular la venta ${anulando.consecutivo}`} confirmLabel={busy === "anular" ? "Anulando..." : "Anular venta"} danger onConfirm={() => motivo.trim() && anular()} onClose={() => setAnulando(null)}
          message="La venta no se borra: queda anulada con su motivo y las unidades vuelven al inventario del técnico.">
          <label className="amg-label">Motivo de la anulación</label><input className="amg-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </ui.ConfirmModal>
      )}

      {verHist && (
        <ui.Modal title={`Historial de precios · ${verHist.name}`} onClose={() => setVerHist(null)} width={520} footer={<button className="amg-btn" onClick={() => setVerHist(null)}>Cerrar</button>}>
          <table className="amg-table compact" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Fecha</th><th>Precio</th><th>Comisión</th><th>Estado</th><th>Cambió</th></tr></thead>
            <tbody>{historial.filter((h) => h.product_id === verHist.id).map((h, i) => (
              <tr key={i}><td>{ui.fmtDate(String(h.changed_at).slice(0, 10))} {String(h.changed_at).slice(11, 16)}</td><td className="amg-mono">{V.fmtCOP(h.unit_price)}</td><td className="amg-mono">{V.fmtCOP(h.commission)}</td><td>{h.active ? "En venta" : "Fuera de venta"}</td><td>{((db.users || []).find((u) => u.id === h.changed_by) || {}).name || "-"}</td></tr>
            ))}</tbody>
          </table>
        </ui.Modal>
      )}
    </div>
  );
}
