import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { Check, AlertTriangle, Download, Plus, X } from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import { fetchHistory } from "./lib/asignacion/history";
import { loadRules as loadAsignacionRules, DEFAULT_RULES as DEFAULT_ASIG_RULES } from "./lib/asignacion/data";
import { loadAuxilio, AUXILIO_DEFAULT } from "./lib/auxilioMovilidad";
import { calcularPicoPlaca } from "./lib/picoPlaca";
import {
  plano, VIATICOS_DEFAULT, loadViaticosConfig, saveViaticosConfig, loadMunicipiosViatico, loadPagosViatico, calcularViaticos, lineasDePago,
  COLUMNAS_PAGO, beneficiariosDelDia, filaPlantilla,
} from "./lib/viaticos";

/* ============================================================================
   PAGO DE VIÁTICOS Y PLANTILLA DE PAGO (pestañas de Histórico de asignación) + configuración (Maestros → Viáticos por municipio)
============================================================================ */

const uid = () => crypto.randomUUID();
const fmtCOP = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CO")}`;
const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/* ------------------------------- Pago de viáticos ------------------------------- */

// Auxilio mensual de planes de datos: un gasto por persona (categoría Comunicaciones › Auxilio planes de datos, concepto "Planes de datos mensual") con la fecha de pago.
// La lista de personas y el valor se recuerdan para el mes siguiente. Avisa y deja sin marcar a quien ya lo recibió ese mes.
function PlanesDatosModal({ db, persist, addAudit, session, ui, fecha, cfg, onCfg, onClose }) {
  const pd = cfg.planesDatos || {};
  // Categoría y subcategoría se toman solas: la subcategoría "Auxilio planes de datos" (de preferencia la de la categoría Comunicaciones).
  const subsDatos = db.subcategories.filter((s) => s.active && /PLAN(ES)? DE DATOS/.test(plano(s.name)));
  const catDe = (s) => db.categories.find((c) => c.id === s.categoryId);
  const subAuto = subsDatos.find((s) => plano((catDe(s) || {}).name).includes("COMUNICACION")) || subsDatos[0] || null;
  const subId = subAuto ? subAuto.id : "";
  const [valor, setValor] = useState(pd.valor || 31000);
  const [sel, setSel] = useState(() => new Set(pd.personas || []));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sub = db.subcategories.find((s) => s.id === subId);
  const mes = fecha.slice(0, 7);
  const yaRecibio = useMemo(() => {
    const set = new Set();
    (db.expenses || []).filter((e) => e.status === "Activo" && e.subcategoryId === subId && e.date.slice(0, 7) === mes && e.technicianId).forEach((e) => set.add(e.technicianId));
    return set;
  }, [db.expenses, subId, mes]);
  const personas = db.technicians.filter((t) => t.status === "Activo" && (!q.trim() || plano(`${t.name} ${t.code}`).includes(plano(q)))).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const marcados = db.technicians.filter((t) => sel.has(t.id) && t.status === "Activo" && !yaRecibio.has(t.id));
  const todosMarcados = personas.length > 0 && personas.every((t) => sel.has(t.id));
  const NOMBRE_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const mesTxt = `${NOMBRE_MES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

  const registrar = async () => {
    setError("");
    if (!sub) { setError("No encuentro la subcategoría \"Auxilio plan de datos\" (categoría Comunicaciones) en Categorías y subcategorías."); return; }
    if (!(Number(valor) > 0)) { setError("El valor debe ser mayor que cero."); return; }
    setBusy(true);
    const ahora = new Date().toISOString();
    const exps = marcados.map((t) => ({
      id: uid(), date: fecha, technicianId: t.id, supplierId: null, categoryId: sub.categoryId, subcategoryId: sub.id, productId: null, conceptManual: "Planes de datos mensual",
      quantity: 1, unitValue: Number(valor), totalValue: Number(valor), observation: `Auxilio de planes de datos de ${mesTxt}`, responsibleUserId: session.id, status: "Activo", annulReason: "", annulUserId: "", annulDate: "", createdAt: ahora, attachmentName: "",
    }));
    try {
      const ok = await persist(addAudit({ ...db, expenses: [...exps, ...db.expenses] }, { userId: session.id, action: "Pago de planes de datos", record: `pago ${fecha}`, oldValue: "-", newValue: `${exps.length} gastos de ${fmtCOP(Number(valor))} (${mesTxt}): ${marcados.map((t) => t.name).join(", ").slice(0, 300)}` }));
      if (!ok) { setError("No se pudieron guardar los gastos. Vuelve a intentarlo."); setBusy(false); return; }
      // Se recuerda la lista y el valor para el mes siguiente.
      const nuevo = { ...cfg, planesDatos: { valor: Number(valor), subcategoria: subId, personas: [...sel] } };
      try { await saveViaticosConfig(nuevo, session.id); onCfg(nuevo); } catch (e) { /* los gastos ya quedaron; la lista se podrá marcar de nuevo */ }
      onClose(`Se registraron ${exps.length} pago(s) de planes de datos por ${fmtCOP(Number(valor))} (${mesTxt}).`);
    } catch (e) { setError(e.message || String(e)); setBusy(false); }
  };

  return (
    <ui.Modal title="Planes de datos" onClose={busy ? () => {} : () => onClose("")} width={620}
      footer={<><button className="amg-btn" disabled={busy} onClick={() => onClose("")}>Cancelar</button><button className="amg-btn primary" disabled={busy || !marcados.length} onClick={registrar}>{busy ? "Registrando..." : `Registrar ${marcados.length} pago(s) · ${fmtCOP(marcados.length * (Number(valor) || 0))}`}</button></>}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>Registra el auxilio mensual de planes de datos de <b>{mesTxt}</b>: un gasto por persona con la fecha de pago <b>{ui.fmtDate(fecha)}</b>, concepto "Planes de datos mensual".</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 12, marginBottom: 10 }}>
        <div><label className="amg-label">Categoría › subcategoría</label>
          <div className="amg-input" style={{ background: "var(--panel)", color: sub ? "var(--text)" : "var(--red)" }}>{sub ? `${(catDe(sub) || {}).name || "?"} › ${sub.name}` : "No encontrada: falta crear la subcategoría Auxilio plan de datos"}</div></div>
        <div><label className="amg-label">Valor por persona</label><input type="number" min="0" className="amg-input" value={valor} onChange={(e) => setValor(e.target.value)} /></div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
        <input className="amg-input" style={{ width: 200 }} placeholder="Buscar persona..." value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          <input type="checkbox" checked={todosMarcados} ref={(el) => { if (el) el.indeterminate = !todosMarcados && personas.some((t) => sel.has(t.id)); }}
            onChange={(e) => setSel((s) => { const n = new Set(s); personas.forEach((t) => { if (e.target.checked) n.add(t.id); else n.delete(t.id); }); return n; })} /> Marcar todo
        </label>
        <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{marcados.length} por registrar{yaRecibio.size ? ` · ${[...yaRecibio].filter((id) => sel.has(id)).length} ya lo recibieron este mes` : ""}</span>
      </div>
      <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 6 }}>
        {personas.map((t) => (
          <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "2px 0", opacity: yaRecibio.has(t.id) ? 0.55 : 1 }}>
            <input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} />
            <span>{t.name} <span style={{ color: "var(--text-faint)" }}>· {t.code}</span></span>
            {yaRecibio.has(t.id) && <span style={{ marginLeft: "auto", color: "var(--accent)" }}>ya registrado este mes</span>}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Incluye a todo el personal activo, también el administrativo. La lista de personas y el valor se recuerdan para el mes siguiente. A quien ya tiene un gasto de esta subcategoría en el mes no se le vuelve a registrar.</div>
      {error && <div className="amg-alert danger" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {error}</div>}
    </ui.Modal>
  );
}

export function PagoViaticos({ db, persist, addAudit, session, ui }) {
  const canEdit = session.role === "admin" || session.role === "operador";
  const hoy = ui.todayISO();
  // Fecha de pago: el viático se paga día vencido (el del día anterior a la fecha de pago); el pico y placa se paga el mismo día (el de la fecha de pago).
  const [fecha, setFecha] = useState(hoy);
  const diaViatico = sumarDias(fecha, -1);
  const [cfg, setCfg] = useState(VIATICOS_DEFAULT);
  const [municipios, setMunicipios] = useState([]);
  const [auxCfg, setAuxCfg] = useState(AUXILIO_DEFAULT);
  const [rules, setRules] = useState(DEFAULT_ASIG_RULES);
  const [hist, setHist] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [planesOpen, setPlanesOpen] = useState(false);

  useEffect(() => {
    loadViaticosConfig().then(setCfg).catch(() => {});
    loadMunicipiosViatico().then(setMunicipios).catch((e) => setError(`No se pudieron leer los viáticos por municipio: ${e.message}. Si es la primera vez, falta correr el SQL sql/43.`));
    loadAuxilio().then(setAuxCfg).catch(() => {});
    loadAsignacionRules().then(setRules).catch(() => {});
  }, []);
  useEffect(() => {
    let alive = true;
    setSel(new Set());
    fetchHistory({ from: diaViatico, to: fecha }).then((r) => { if (alive) setHist(r); }).catch((e) => { if (alive) setError(e.message); });
    loadPagosViatico(diaViatico, fecha).then((r) => { if (alive) setPagos(r); }).catch((e) => { if (alive) setError(`${e.message}. Si es la primera vez, falta correr el SQL sql/44.`); });
    return () => { alive = false; };
  }, [fecha, recarga]);

  const lineas = useMemo(() => {
    // Viáticos: lo ya finalizado (histórico) del día anterior. Pico y placa: la ruta de la fecha de pago (histórico y lo enviado a Carga sin finalizar).
    const viaticos = calcularViaticos({ rows: hist.filter((r) => r.day === diaViatico), municipios, causales: db.causales, cfg });
    const rowsPyp = calcularPicoPlaca({ hist: hist.filter((r) => r.day === fecha), services: db.services, technicians: db.technicians, from: fecha, to: fecha, rules, auxCfg });
    return lineasDePago({ viaticos, rowsPyp });
  }, [hist, municipios, db.causales, db.services, db.technicians, cfg, fecha, diaViatico, rules, auxCfg]);
  const histAyer = hist.filter((r) => r.day === diaViatico).length;

  // Gastos registrados para la fecha de pago (Registrar gasto, a una persona de Personal o a un proveedor), incluidos los que se crean al marcar un viático como pagado.
  const gastosDelDia = useMemo(() => {
    const tec = Object.fromEntries(db.technicians.map((t) => [t.id, t.name])), sup = Object.fromEntries((db.suppliers || []).map((s) => [s.id, s.name]));
    const cat = Object.fromEntries(db.categories.map((c) => [c.id, c.name])), sub = Object.fromEntries(db.subcategories.map((s) => [s.id, s.name]));
    const prod = Object.fromEntries(db.products.map((p) => [p.id, p.name]));
    return (db.expenses || []).filter((e) => e.status === "Activo" && e.date === fecha)
      .map((e) => ({ e, pagadoA: e.technicianId ? tec[e.technicianId] || "-" : e.supplierId ? sup[e.supplierId] || "Proveedor" : "Compra de stock", tipo: e.technicianId ? "Personal" : e.supplierId ? "Proveedor" : "Stock",
        categoria: `${cat[e.categoryId] || "-"} › ${sub[e.subcategoryId] || "-"}`, concepto: (e.productId && prod[e.productId]) || e.conceptManual || "-" }))
      .sort((a, b) => a.pagadoA.localeCompare(b.pagadoA, "es"));
  }, [db.expenses, db.technicians, db.suppliers, db.categories, db.subcategories, db.products, fecha]);
  const totalGastos = gastosDelDia.reduce((s, g) => s + (g.e.totalValue || 0), 0);

  const clave = (l) => `${l.day}|${l.technicianId}|${l.kind}`;
  // Pagado = hay un pago marcado cuyo gasto sigue activo (si se anuló el gasto, la línea vuelve a pendiente).
  const pagoDe = (l) => pagos.find((p) => p.day === l.day && p.technician_id === l.technicianId && p.kind === l.kind && p.status === "Pagado" && (db.expenses || []).some((e) => e.id === p.expense_id && e.status === "Activo"));
  const pendientes = lineas.filter((l) => !pagoDe(l));
  const marcados = pendientes.filter((l) => sel.has(clave(l)));
  const total = (list) => list.reduce((s, l) => s + l.valor, 0);

  const marcarPagados = async () => {
    setError(""); setMsg("");
    const subDe = (id) => db.subcategories.find((s) => s.id === id);
    const subV = subDe(cfg.subViatico), subP = subDe(cfg.subPyp);
    if (marcados.some((l) => l.kind === "Viático") && !subV) { setError("Falta configurar la categoría y subcategoría del gasto de viático en Maestros → Viáticos por municipio."); return; }
    if (marcados.some((l) => l.kind === "Pico y placa") && !subP) { setError("Falta configurar la categoría y subcategoría del gasto de pico y placa en Maestros → Viáticos por municipio."); return; }
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      const exps = marcados.map((l) => {
        const sub = l.kind === "Viático" ? subV : subP;
        return {
          // La fecha del gasto es la de pago (la plantilla de pago toma los gastos de esa fecha); el concepto dice de qué día es el servicio.
          id: uid(), date: fecha, technicianId: l.technicianId, supplierId: null, categoryId: sub.categoryId, subcategoryId: sub.id, productId: null, conceptManual: `${l.kind} del ${ui.fmtDate(l.day)}`,
          quantity: 1, unitValue: l.valor, totalValue: l.valor, observation: l.detalle, responsibleUserId: session.id, status: "Activo", annulReason: "", annulUserId: "", annulDate: "", createdAt: ahora, attachmentName: "",
        };
      });
      // 1) se registran los pagos (uno por día, persona y tipo); 2) se crean los gastos. Si los gastos no se guardan, los pagos se anulan.
      const filas = marcados.map((l, i) => ({ day: l.day, technician_id: l.technicianId, kind: l.kind, amount: l.valor, detail: l.detalle, expense_id: exps[i].id, status: "Pagado", paid_by: session.id, paid_at: ahora }));
      const { error: e1 } = await supabase.from("viatico_pagos").upsert(filas, { onConflict: "day,technician_id,kind" });
      if (e1) throw new Error(e1.message);
      const ok = await persist(addAudit({ ...db, expenses: [...exps, ...db.expenses] }, { userId: session.id, action: "Pago de viáticos marcado", record: `pago ${fecha}`, oldValue: "-", newValue: `${exps.length} gastos (${fmtCOP(total(marcados))}): ${marcados.map((l) => `${l.nombre} ${l.kind}`).join(", ").slice(0, 300)}` }));
      if (!ok) {
        await supabase.from("viatico_pagos").update({ status: "Anulado" }).in("expense_id", exps.map((x) => x.id));
        setError("No se pudieron crear los gastos; los pagos no quedaron marcados. Vuelve a intentarlo.");
      } else setMsg(`Se marcaron ${exps.length} pago(s) y se crearon sus gastos (${fmtCOP(total(marcados))}).`);
      setSel(new Set()); setRecarga((n) => n + 1);
    } catch (e) { setError(e.message || String(e)); }
    setBusy(false);
  };

  const exportar = () => ui.downloadCSV(`viaticos_pago_${fecha}.csv`, ["Fecha de pago", "Día del servicio", "Técnico", "Departamento", "Tipo", "Valor", "Detalle del gasto", "Estado"],
    lineas.map((l) => [ui.fmtDate(fecha), ui.fmtDate(l.day), l.nombre, l.departamento, l.kind, l.valor, l.detalle, pagoDe(l) ? "Pagado" : "Pendiente"]));

  return (
    <div>
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label className="amg-label" style={{ margin: 0 }}>Fecha de pago</label>
        <input type="date" className="amg-input" style={{ width: 150 }} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <button className="amg-btn" onClick={() => setFecha(sumarDias(hoy, -1))}>Ayer</button>
        <button className="amg-btn" onClick={() => setFecha(hoy)}>Hoy</button>
        <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Viáticos del <b>{ui.fmtDate(diaViatico)}</b> · pico y placa del <b>{ui.fmtDate(fecha)}</b> · {lineas.length} línea(s) · {fmtCOP(total(lineas))} · pendientes {fmtCOP(total(pendientes))}</span>
        <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={exportar}><Download size={14} /> Exportar CSV</button>
        {canEdit && <button className="amg-btn" title="Registra el auxilio mensual de planes de datos (Comunicaciones › Auxilio planes de datos)" onClick={() => setPlanesOpen(true)}>Planes de datos</button>}
        {canEdit && <button className="amg-btn primary" disabled={busy || !marcados.length} onClick={marcarPagados}><Check size={14} /> {busy ? "Marcando..." : `Marcar como pagado (${marcados.length})`}</button>}
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr>
            {canEdit && <th style={{ width: 28 }}><input type="checkbox" title="Marcar todos los pendientes" checked={pendientes.length > 0 && marcados.length === pendientes.length} onChange={() => setSel(marcados.length === pendientes.length ? new Set() : new Set(pendientes.map(clave)))} /></th>}
            <th>Técnico</th><th>Departamento</th><th>Tipo</th><th>Día del servicio</th><th>Valor</th><th>Detalle del gasto</th><th>Estado</th>
          </tr></thead>
          <tbody>
            {lineas.map((l) => {
              const pagado = !!pagoDe(l);
              return (
                <tr key={clave(l)} style={pagado ? { opacity: 0.65 } : undefined}>
                  {canEdit && <td><input type="checkbox" disabled={pagado} checked={pagado || sel.has(clave(l))} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(clave(l))) n.delete(clave(l)); else n.add(clave(l)); return n; })} /></td>}
                  <td>{l.nombre}</td><td>{l.departamento || "-"}</td><td><ui.Badge text={l.kind} color={l.kind === "Viático" ? "blue" : "amber"} /></td><td className="amg-mono">{ui.fmtDate(l.day)}</td>
                  <td className="amg-mono" style={{ fontWeight: 600 }}>{fmtCOP(l.valor)}</td><td style={{ maxWidth: 360, whiteSpace: "normal", wordBreak: "break-word" }}>{l.detalle}</td>
                  <td><ui.Badge text={pagado ? "Pagado" : "Pendiente"} color={pagado ? "green" : "gray"} /></td>
                </tr>
              );
            })}
            {lineas.length === 0 && <tr><td colSpan={canEdit ? 8 : 7} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay viáticos ni pico y placa por pagar para esta fecha de pago.{histAyer === 0 ? ` El histórico del ${ui.fmtDate(diaViatico)} está vacío: finaliza ese día en Carga para ver sus viáticos.` : ""}</td></tr>}
          </tbody>
        </table>
      </div>
      {planesOpen && <PlanesDatosModal db={db} persist={persist} addAudit={addAudit} session={session} ui={ui} fecha={fecha} cfg={cfg} onCfg={setCfg} onClose={(m) => { setPlanesOpen(false); if (m) setMsg(m); }} />}
      <div className="amg-card" style={{ padding: 12, marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Gastos registrados para el {ui.fmtDate(fecha)}</div>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{gastosDelDia.length} gasto(s) · {fmtCOP(totalGastos)}</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="amg-table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Pagado a</th><th>Tipo</th><th>Categoría › subcategoría</th><th>Concepto</th><th>Valor</th><th>Observación</th><th>Banco</th></tr></thead>
            <tbody>
              {gastosDelDia.map((g) => (
                <tr key={g.e.id}>
                  <td>{g.pagadoA}</td><td><ui.Badge text={g.tipo} color={g.tipo === "Personal" ? "amber" : g.tipo === "Proveedor" ? "blue" : "gray"} /></td><td>{g.categoria}</td><td>{g.concepto}</td>
                  <td className="amg-mono" style={{ fontWeight: 600 }}>{fmtCOP(g.e.totalValue)}</td><td style={{ maxWidth: 280, whiteSpace: "normal", wordBreak: "break-word" }}>{g.e.observation || "-"}</td>
                  <td><ui.Badge text={g.e.bankSentAt ? "Enviado" : "Sin enviar"} color={g.e.bankSentAt ? "green" : "gray"} /></td>
                </tr>
              ))}
              {gastosDelDia.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-faint)", padding: 16 }}>No hay gastos registrados con esta fecha.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Son los gastos de Registrar gasto con la fecha de pago, a una persona de Personal o a un proveedor, y los que se crean al marcar un viático o pico y placa como pagado. En la pestaña Plantilla de pago se suman por beneficiario para enviarlos al banco.</div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
        <b>Fecha de pago:</b> el viático se paga día vencido (el del día anterior a la fecha de pago, tomado del histórico) y el pico y placa se paga el mismo día (la ruta de hoy, de Carga). Los gastos se crean con la fecha de pago.
        Viático = el mayor valor de municipio del día + (ciudades distintas − 1) × el adicional del departamento, solo con servicios realizados o que generaron desplazamiento en municipios con viático ENVIAR (Maestros → Viáticos por municipio).
        Si la persona tiene viático y pico y placa el mismo día, solo se paga el viático. Al marcar como pagado se crea el gasto (Registrar gasto) a nombre de la persona, con el detalle como observación; si ese gasto se anula en el historial de gastos, la línea vuelve a pendiente.
      </div>
    </div>
  );
}

/* ------------------------------- Plantilla de pago ------------------------------- */

export function PlantillaPago({ db, persist, addAudit, session, ui }) {
  const canEdit = session.role === "admin" || session.role === "operador";
  const hoy = ui.todayISO();
  const [fecha, setFecha] = useState(hoy); // fecha de pago: los gastos (viáticos y pico y placa marcados como pagados, y los de Registrar gasto) llevan la fecha de pago
  const [incluirEnviados, setIncluirEnviados] = useState(false);
  const [quitados, setQuitados] = useState(() => new Set());
  const [msg, setMsg] = useState("");

  const benef = useMemo(() => beneficiariosDelDia({ expenses: db.expenses || [], technicians: db.technicians, suppliers: db.suppliers, fecha, incluirEnviados }), [db.expenses, db.technicians, db.suppliers, fecha, incluirEnviados]);
  useEffect(() => { setQuitados(new Set()); }, [fecha, incluirEnviados]);
  const elegidos = benef.filter((b) => !quitados.has(b.key));
  const total = elegidos.reduce((s, b) => s + b.total, 0);

  const descargar = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLUMNAS_PAGO, ...elegidos.map(filaPlantilla)]);
    ws["!cols"] = [10, 16, 20, 22, 10, 10, 18, 14].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "archivo proveedores");
    const [y, m, d] = fecha.split("-");
    XLSX.writeFile(wb, `ENVIOS DE DINERO ${d}-${m}-${y}.xlsx`);
  };
  const marcarEnviados = () => {
    const ids = new Set(elegidos.flatMap((b) => b.expenses.map((e) => e.id)));
    const ahora = new Date().toISOString();
    persist(addAudit({ ...db, expenses: db.expenses.map((e) => (ids.has(e.id) ? { ...e, bankSentAt: ahora, bankSentBy: session.id } : e)) },
      { userId: session.id, action: "Gastos enviados al banco", record: fecha, oldValue: "-", newValue: `${ids.size} gastos de ${elegidos.length} beneficiarios (${fmtCOP(total)})` }));
    setMsg(`${ids.size} gasto(s) marcados como enviados al banco.`);
  };

  return (
    <div>
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label className="amg-label" style={{ margin: 0 }}>Fecha de pago</label>
        <input type="date" className="amg-input" style={{ width: 150 }} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <button className="amg-btn" onClick={() => setFecha(sumarDias(hoy, -1))}>Ayer</button>
        <button className="amg-btn" onClick={() => setFecha(hoy)}>Hoy</button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={incluirEnviados} onChange={(e) => setIncluirEnviados(e.target.checked)} /> Incluir los ya enviados al banco</label>
        <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{elegidos.length} beneficiario(s) · {fmtCOP(total)}</span>
        <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!elegidos.length} onClick={descargar}><Download size={14} /> Descargar plantilla</button>
        {canEdit && <button className="amg-btn primary" disabled={!elegidos.length} title="Marca los gastos de estos beneficiarios como enviados al banco, para no volver a pagarlos" onClick={marcarEnviados}><Check size={14} /> Marcar como enviados al banco</button>}
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr><th style={{ width: 28 }}></th><th>Beneficiario</th><th>Tipo</th><th>Gastos</th><th>Valor del pago</th><th>Datos bancarios</th></tr></thead>
          <tbody>
            {benef.map((b) => (
              <tr key={b.key}>
                <td><input type="checkbox" checked={!quitados.has(b.key)} onChange={() => setQuitados((s) => { const n = new Set(s); if (n.has(b.key)) n.delete(b.key); else n.add(b.key); return n; })} /></td>
                <td>{b.nombre}</td><td><ui.Badge text={b.tipo} color={b.tipo === "Personal" ? "amber" : "blue"} /></td>
                <td className="amg-mono" title={b.expenses.map((e) => `${e.conceptManual || ""} ${fmtCOP(e.totalValue)}`).join("\n")}>{b.expenses.length}{b.expenses.some((e) => e.bankSentAt) ? " · ya enviados" : ""}</td>
                <td className="amg-mono" style={{ fontWeight: 600 }}>{fmtCOP(b.total)}</td>
                <td style={{ color: b.faltan.length ? "var(--red)" : "var(--green)" }}>{b.faltan.length ? `Falta: ${b.faltan.join(", ")}` : "Completos"}</td>
              </tr>
            ))}
            {benef.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay gastos {incluirEnviados ? "" : "pendientes de enviar "}para esa fecha.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
        Fecha de pago = la fecha de los gastos (los de Registrar gasto y los viáticos y pico y placa marcados como pagados ese día). Suma todos los gastos activos de la fecha por persona de Personal o por proveedor. Los datos bancarios salen de Personal (identificación = Documento, banco, tipo y número de cuenta, titular) y de Proveedores; los que falten salen vacíos en la plantilla.
        Descargar no marca nada: cuando envíes el archivo al banco, usa "Marcar como enviados" para que no se paguen dos veces.
      </div>
    </div>
  );
}

/* ----------------------------- Configuración (Maestros) ----------------------------- */

export function ViaticosConfigPanel({ db, session, ui }) {
  const esAdmin = session.role === "admin";
  const [cfg, setCfg] = useState(VIATICOS_DEFAULT);
  const [tiposPago, setTiposPago] = useState(["No Pago", "Tarifa", "Desplazamiento", "Diagnóstico"]);
  const [nuevoTec, setNuevoTec] = useState("");
  const [nuevoDepto, setNuevoDepto] = useState({ depto: "", valor: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    loadViaticosConfig().then(setCfg).catch(() => {});
    (async () => { try { const { data } = await supabase.from("assignment_settings").select("value").eq("key", "tipos_pago_causal").maybeSingle(); if (data && Array.isArray(data.value) && data.value.length) setTiposPago(data.value); } catch (e) { /* lista base */ } })();
  }, []);
  const guardar = async () => {
    setError(""); setMsg("");
    try { await saveViaticosConfig(cfg, session.id); setMsg("Configuración guardada."); } catch (e) { setError(e.message); }
  };
  const subOpts = db.subcategories.filter((s) => s.active).map((s) => ({ id: s.id, txt: `${(db.categories.find((c) => c.id === s.categoryId) || {}).name || "?"} › ${s.name}` })).sort((a, b) => a.txt.localeCompare(b.txt, "es"));
  const techOpts = db.technicians.filter((t) => !(cfg.excluidos || []).includes(t.id)).map((t) => ({ value: t.id, label: t.name, sublabel: `${t.code} · ${t.status}` }));
  const set = (k, v) => setCfg({ ...cfg, [k]: v });
  const lbl = (t) => <label className="amg-label">{t}</label>;
  return (
    <div className="amg-card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Pago de viáticos (Histórico de asignación → Pago de viáticos)</div>
      <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 12 }}>Reglas con las que se calcula el viático de cada persona por día y gastos que se crean al marcarlo como pagado. {esAdmin ? "" : "Solo el administrador puede cambiarlas."}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <div>
          {lbl("Personal excluido del viático")}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
            {(cfg.excluidos || []).map((id) => {
              const t = db.technicians.find((x) => x.id === id);
              return <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 10px", border: "1px solid var(--border)", borderRadius: 14, fontSize: 12.5 }}>{t ? t.name : id}
                {esAdmin && <button className="amg-btn ghost" style={{ padding: 0 }} onClick={() => set("excluidos", cfg.excluidos.filter((x) => x !== id))}><X size={12} /></button>}</span>;
            })}
            {!(cfg.excluidos || []).length && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Nadie excluido</span>}
          </div>
          {esAdmin && <ui.SearchSelect options={techOpts} value={nuevoTec} onChange={(v) => { if (v) { set("excluidos", [...(cfg.excluidos || []), v]); setNuevoTec(""); } }} placeholder="Agregar persona..." />}
        </div>
        <div>
          {lbl("Adicional por cada ciudad extra el mismo día")}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12.5 }}>Por defecto</span>
            <input type="number" min="0" className="amg-input" style={{ width: 110 }} disabled={!esAdmin} value={cfg.adicionalDefault} onChange={(e) => set("adicionalDefault", Number(e.target.value) || 0)} />
          </div>
          {Object.entries(cfg.adicionalPorDepto || {}).map(([d, v]) => (
            <div key={d} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <span style={{ width: 130, fontSize: 12.5 }}>{d}</span>
              <input type="number" min="0" className="amg-input" style={{ width: 110 }} disabled={!esAdmin} value={v} onChange={(e) => set("adicionalPorDepto", { ...cfg.adicionalPorDepto, [d]: Number(e.target.value) || 0 })} />
              {esAdmin && <button className="amg-btn ghost" style={{ padding: 2 }} onClick={() => { const n = { ...cfg.adicionalPorDepto }; delete n[d]; set("adicionalPorDepto", n); }}><X size={12} /></button>}
            </div>
          ))}
          {esAdmin && (
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <input className="amg-input" style={{ width: 130 }} placeholder="Departamento" value={nuevoDepto.depto} onChange={(e) => setNuevoDepto({ ...nuevoDepto, depto: e.target.value })} />
              <input type="number" min="0" className="amg-input" style={{ width: 100 }} placeholder="Valor" value={nuevoDepto.valor} onChange={(e) => setNuevoDepto({ ...nuevoDepto, valor: e.target.value })} />
              <button className="amg-btn" disabled={!nuevoDepto.depto.trim() || nuevoDepto.valor === ""} onClick={() => { set("adicionalPorDepto", { ...cfg.adicionalPorDepto, [plano(nuevoDepto.depto)]: Number(nuevoDepto.valor) || 0 }); setNuevoDepto({ depto: "", valor: "" }); }}><Plus size={12} /></button>
            </div>
          )}
        </div>
        <div>
          {lbl("Tipos de pago de la causal que cuentan como desplazamiento")}
          {tiposPago.map((t) => (
            <label key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginBottom: 2 }}>
              <input type="checkbox" disabled={!esAdmin} checked={(cfg.tiposDesplazamiento || []).includes(t)} onChange={(e) => set("tiposDesplazamiento", e.target.checked ? [...(cfg.tiposDesplazamiento || []), t] : cfg.tiposDesplazamiento.filter((x) => x !== t))} /> {t}
            </label>
          ))}
          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Además de los servicios realizados. Los tipos salen de Maestros → Causales.</div>
        </div>
        <div>
          {lbl("Gasto del viático (categoría › subcategoría)")}
          <select className="amg-select" disabled={!esAdmin} value={cfg.subViatico} onChange={(e) => set("subViatico", e.target.value)}><option value="">Seleccionar...</option>{subOpts.map((o) => <option key={o.id} value={o.id}>{o.txt}</option>)}</select>
          <div style={{ height: 8 }} />
          {lbl("Gasto del pico y placa (categoría › subcategoría)")}
          <select className="amg-select" disabled={!esAdmin} value={cfg.subPyp} onChange={(e) => set("subPyp", e.target.value)}><option value="">Seleccionar...</option>{subOpts.map((o) => <option key={o.id} value={o.id}>{o.txt}</option>)}</select>
        </div>
      </div>
      {error && <div className="amg-alert danger" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="amg-alert" style={{ marginTop: 10, background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={14} /> {msg}</div>}
      {esAdmin && <div style={{ marginTop: 12 }}><button className="amg-btn primary" onClick={guardar}>Guardar configuración</button></div>}
    </div>
  );
}
