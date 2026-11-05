import { useState, useEffect, useMemo } from "react";
import { Check, AlertTriangle, Upload, Plus, X } from "lucide-react";
import * as B from "./lib/banco";

/* ============================================================================
   BANCO (pestaña de Pagos)
   - Carga el archivo de movimientos de Davivienda: los costos financieros (comisiones, IVA, gravamen) pasan a Gastos; los pagos y transferencias que ya están
     como gasto de cada persona y los abonos solo mueven el saldo. La fecha del gasto y del saldo diario es la fecha de sistema del banco + 1 día.
   - Saldo: se escribe el saldo del banco en una fecha y se mueve con los movimientos cargados; además descuenta lo enviado al banco en la Plantilla de pago que aún no aparece en el archivo.
============================================================================ */

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };
const uid = () => crypto.randomUUID();

export default function BancoTab({ db, persist, addAudit, session, ui }) {
  const canEdit = session.role === "admin" || session.role === "operador";
  const isAdmin = session.role === "admin";
  const hoy = ui.todayISO();
  const [cfg, setCfg] = useState(B.BANCO_DEFAULT);
  const [reglas, setReglas] = useState(B.REGLAS_DEFAULT);
  const [movs, setMovs] = useState([]);
  const [recarga, setRecarga] = useState(0);
  const [desde, setDesde] = useState(B.sumarDias(hoy, -30));
  const [hasta, setHasta] = useState("");
  const [prev, setPrev] = useState(null); // vista previa del archivo cargado
  const [archivo, setArchivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saldoTxt, setSaldoTxt] = useState("");
  const [fechaRef, setFechaRef] = useState("");

  useEffect(() => {
    B.loadBancoConfig().then((c) => { setCfg(c); setReglas(c.reglas); setSaldoTxt(c.saldoReferencia === "" ? "" : String(c.saldoReferencia).replace(".", ",")); setFechaRef(c.fechaReferencia || ""); })
      .catch((e) => setError(`${e.message}. Si es la primera vez, falta correr el SQL sql/47.`));
  }, []);
  // Se leen los movimientos desde antes de la fecha de referencia para poder calcular el saldo hacia atrás.
  const desdeCarga = useMemo(() => [desde, cfg.fechaReferencia ? B.sumarDias(cfg.fechaReferencia, -1) : "", B.sumarDias(hoy, -120)].filter(Boolean).sort()[0], [desde, cfg.fechaReferencia]);
  useEffect(() => {
    let alive = true;
    B.loadMovimientos({ from: desdeCarga }).then((r) => { if (alive) setMovs(r); }).catch((e) => { if (alive) setError(`${e.message}. Si es la primera vez, falta correr el SQL sql/47.`); });
    return () => { alive = false; };
  }, [recarga, desdeCarga]);

  const subOpts = useMemo(() => db.subcategories.filter((s) => s.active).map((s) => ({ id: s.id, label: `${(db.categories.find((c) => c.id === s.categoryId) || {}).name || "?"} › ${s.name}` })).sort((a, b) => a.label.localeCompare(b.label, "es")), [db.subcategories, db.categories]);
  const gastoDe = useMemo(() => new Map((db.expenses || []).filter((e) => e.bankMovementId).map((e) => [e.bankMovementId, e])), [db.expenses]);

  const saldo = B.saldoActual(cfg, movs);
  const pend = useMemo(() => B.pendientesPorDebitar(db.expenses, cfg, movs), [db.expenses, cfg, movs]);
  const ultimaFecha = movs.length ? movs.map((m) => m.fecha_sistema).sort().slice(-1)[0] : "";

  /* ----------------------------- saldo de referencia ----------------------------- */
  const guardarSaldo = async () => {
    setError(""); setMsg("");
    const n = B.parseValor(saldoTxt);
    if (saldoTxt.trim() === "" || !Number.isFinite(n)) { setError("Escribe el saldo del banco."); return; }
    if (!fechaRef) { setError("Elige la fecha de sistema a la que corresponde ese saldo."); return; }
    try {
      const next = { ...cfg, saldoReferencia: Math.round(n * 100) / 100, fechaReferencia: fechaRef };
      await B.saveBancoConfig({ ...next, reglas }, session.id);
      setCfg(next);
      persist(addAudit(db, { userId: session.id, action: "Saldo del banco (referencia)", record: "banco_config", oldValue: cfg.saldoReferencia === "" ? "-" : B.fmtSaldo(cfg.saldoReferencia), newValue: `${B.fmtSaldo(next.saldoReferencia)} al ${fechaRef}` }));
      setMsg("Saldo de referencia guardado.");
    } catch (e) { setError(e.message); }
  };

  /* ----------------------------- cargar el archivo ----------------------------- */
  const elegirArchivo = async (file) => {
    if (!file) return;
    setError(""); setMsg(""); setPrev(null);
    try {
      const filas = await B.leerArchivoBanco(file);
      if (!filas.length) { setError("El archivo no tiene movimientos."); return; }
      const fs = filas.map((m) => m.fechaSistema).sort();
      const ya = new Set((await B.loadMovimientos({ from: fs[0], to: fs[fs.length - 1] })).map((m) => m.dedupe_key));
      setArchivo(file.name);
      setPrev(filas.map((m) => {
        const regla = B.reglaDe(m.descripcion, reglas), tipo = B.tipoDe(m, reglas), s = tipo === "Gasto" ? B.subDeRegla(regla, db) : null;
        return { ...m, existe: ya.has(m.key), excluir: false, tipo, regla, accion: tipo === "Gasto" ? "Gasto" : "Solo saldo", subId: s ? s.sub.id : "" };
      }));
    } catch (e) { setError(e.message); }
  };
  const setFila = (key, patch) => setPrev((p) => p.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const disponibles = (prev || []).filter((f) => !f.existe); // movimientos que aún no están cargados
  const nuevos = disponibles.filter((f) => !f.excluir); // los excluidos no se registran
  const excluidos = disponibles.length - nuevos.length;
  const todosIncluidos = disponibles.length > 0 && excluidos === 0;
  const gastos = nuevos.filter((f) => f.accion === "Gasto");
  const sinSub = gastos.filter((f) => !f.subId);

  const registrar = async () => {
    setError(""); setMsg(""); setBusy(true);
    try {
      const rows = nuevos.map((f) => ({
        dedupe_key: f.key, fecha_sistema: f.fechaSistema, fecha: f.fecha, documento: f.documento || null, descripcion: f.descripcion, transaccion: f.transaccion, oficina: f.oficina || null, valor: f.valor,
        tipo: f.accion === "Gasto" ? "Gasto" : f.transaccion === "Nota Crédito" ? "Abono" : f.tipo === "Pago" ? "Pago" : "Otro", created_by: session.id,
      }));
      const insertados = await B.guardarMovimientos(rows);
      const porKey = new Map(nuevos.map((f) => [f.key, f]));
      const ahora = new Date().toISOString();
      const exps = insertados.filter((m) => m.tipo === "Gasto").map((m) => {
        const f = porKey.get(m.dedupe_key), sub = db.subcategories.find((s) => s.id === f.subId);
        return { id: uid(), date: m.fecha, technicianId: null, supplierId: null, categoryId: sub.categoryId, subcategoryId: sub.id, productId: null, conceptManual: (f.regla && f.regla.concepto) || f.descripcion,
          quantity: 1, unitValue: Number(m.valor), totalValue: Number(m.valor), observation: `Banco: ${f.descripcion} · doc ${f.documento || "-"} · fecha de sistema ${ui.fmtDate(m.fecha_sistema)}`,
          responsibleUserId: session.id, status: "Activo", annulReason: "", annulUserId: "", annulDate: "", createdAt: ahora, attachmentName: "", bankSentAt: null, bankSentBy: null, bankMovementId: m.id };
      });
      let txt = `${insertados.length} movimiento(s) cargados${nuevos.length - insertados.length ? ` (${nuevos.length - insertados.length} ya estaban)` : ""}`;
      if (exps.length) {
        const ok = await persist(addAudit({ ...db, expenses: [...exps, ...db.expenses] }, { userId: session.id, action: "Gastos del banco", record: archivo, oldValue: "-", newValue: `${exps.length} gastos por ${B.fmtSaldo(exps.reduce((s, e) => s + e.totalValue, 0))} (${archivo})` }));
        if (ok === false) { setError("Los movimientos se guardaron, pero no se pudieron crear los gastos. Usa \"Crear gasto\" en la tabla de movimientos."); }
        else txt += ` y ${exps.length} gasto(s) creados`;
      }
      setMsg(`${txt}.`); setPrev(null); setArchivo(""); setRecarga((n) => n + 1);
    } catch (e) { setError(`${e.message}. Si es la primera vez, falta correr el SQL sql/47.`); }
    setBusy(false);
  };

  // Movimiento de tipo Gasto sin gasto (falló la creación): crea el gasto con la regla.
  const crearGasto = async (m) => {
    setError(""); setMsg("");
    const regla = B.reglaDe(m.descripcion, reglas), s = B.subDeRegla(regla, db);
    if (!s) { setError("Esa regla no tiene subcategoría: elígela en Reglas."); return; }
    const e = { id: uid(), date: m.fecha, technicianId: null, supplierId: null, categoryId: s.sub.categoryId, subcategoryId: s.sub.id, productId: null, conceptManual: (regla && regla.concepto) || m.descripcion,
      quantity: 1, unitValue: Number(m.valor), totalValue: Number(m.valor), observation: `Banco: ${m.descripcion} · doc ${m.documento || "-"} · fecha de sistema ${ui.fmtDate(m.fecha_sistema)}`,
      responsibleUserId: session.id, status: "Activo", annulReason: "", annulUserId: "", annulDate: "", createdAt: new Date().toISOString(), attachmentName: "", bankSentAt: null, bankSentBy: null, bankMovementId: m.id };
    const ok = await persist(addAudit({ ...db, expenses: [e, ...db.expenses] }, { userId: session.id, action: "Gasto del banco", record: m.id, oldValue: "-", newValue: `${m.descripcion}: ${B.fmtSaldo(m.valor)}` }));
    if (ok === false) setError("No se pudo crear el gasto."); else setMsg("Gasto creado.");
  };

  /* ----------------------------- reglas ----------------------------- */
  const setRegla = (id, patch) => setReglas((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const guardarReglas = async () => {
    setError(""); setMsg("");
    if (reglas.some((r) => !r.patron.trim())) { setError("Todas las reglas necesitan el texto que busca en la descripción."); return; }
    try {
      await B.saveBancoConfig({ ...cfg, reglas }, session.id);
      setCfg({ ...cfg, reglas });
      persist(addAudit(db, { userId: session.id, action: "Reglas del banco", record: "banco_config", oldValue: "-", newValue: `${reglas.length} reglas` }));
      setMsg("Reglas guardadas.");
    } catch (e) { setError(e.message); }
  };

  /* ----------------------------- tabla de movimientos ----------------------------- */
  const lista = movs.filter((m) => m.fecha_sistema >= desde && (!hasta || m.fecha_sistema <= hasta));
  const cierres = new Set(); // el saldo del día se muestra en la primera fila de cada fecha de sistema
  const TIPO_COLOR = { Gasto: "amber", Pago: "blue", Abono: "green", Otro: "gray" };
  const n2 = (n) => Number(n).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Saldo actual (estimado)" value={saldo === null ? "Sin configurar" : B.fmtSaldo(saldo - pend.total)} sub={saldo === null ? "Escribe el saldo abajo" : pend.total > 0 ? `descuenta ${pend.gastos.length} pago(s) enviados al banco que aún no están en el archivo; las comisiones del banco se ajustan al cargar el archivo` : "sin pagos enviados pendientes: es el saldo del banco"} accent />
        <ui.StatCard label="Saldo del banco (último archivo)" value={saldo === null ? "-" : B.fmtSaldo(saldo)} sub={saldo === null ? "-" : `con movimientos hasta el ${ui.fmtDate(ultimaFecha > cfg.fechaReferencia ? ultimaFecha : cfg.fechaReferencia)}`} />
        <ui.StatCard label="Enviado al banco sin reflejar" value={B.fmtSaldo(pend.total)} sub={saldo === null ? "-" : `${pend.gastos.length} gasto(s) de la plantilla con fecha de pago posterior al ${ui.fmtDate(pend.corte)} (marcados como enviados al banco)`} />
      </div>

      <div className="amg-card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Saldo del banco de referencia</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div><label className="amg-label">Saldo del banco</label><input className="amg-input amg-mono" style={{ width: 170 }} disabled={!isAdmin} value={saldoTxt} onChange={(e) => setSaldoTxt(e.target.value)} placeholder="3.239.148,21" /></div>
          <div><label className="amg-label">A la fecha de sistema del banco</label><input type="date" className="amg-input" style={{ width: 160 }} disabled={!isAdmin} value={fechaRef} onChange={(e) => setFechaRef(e.target.value)} /></div>
          {isAdmin && <button className="amg-btn primary" onClick={guardarSaldo}><Check size={14} /> Guardar saldo</button>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
          {isAdmin ? "Escribe lo que muestra el banco a esa fecha (por ejemplo, el saldo de hoy tras cargar el último archivo). " : "Solo el administrador cambia el saldo de referencia. "}
          Desde ahí el saldo se mueve con los movimientos que se carguen: suma los abonos y resta los débitos (pagos, comisiones, IVA, gravamen). Si al cargar un archivo el saldo no coincide con el del banco, vuelve a escribir el saldo del banco.
        </div>
      </div>

      {canEdit && (
        <div className="amg-card" style={{ padding: 12, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Cargar archivo de movimientos del banco</div>
          <label className="amg-btn" style={{ cursor: "pointer", display: "inline-flex", gap: 6 }}><Upload size={14} /> Elegir archivo (.xlsx)
            <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { elegirArchivo(e.target.files[0]); e.target.value = ""; }} />
          </label>
          {archivo && <span style={{ marginLeft: 10, fontSize: 12.5, color: "var(--text-dim)" }}>{archivo}</span>}
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Los movimientos que ya se cargaron antes se reconocen y no se duplican, aunque dos archivos se traslapen. La fecha del gasto es la fecha de sistema del banco + 1 día.</div>

          {prev && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                <b>{prev.length}</b> movimientos en el archivo: <b>{nuevos.length}</b> por registrar ({gastos.length} como gasto por <b className="amg-mono">{B.fmtSaldo(gastos.reduce((s, f) => s + f.valor, 0))}</b>), {prev.length - disponibles.length} ya cargados{excluidos > 0 ? <> y <b>{excluidos}</b> excluidos</> : null}.
              </div>
              <div style={{ overflowX: "auto", maxHeight: 420 }}>
                <table className="amg-table" style={{ fontSize: 12.5 }}>
                  <thead><tr><th title="Quita la marca de los movimientos que no quieres cargar"><input type="checkbox" checked={todosIncluidos} disabled={disponibles.length === 0} onChange={(e) => setPrev((p) => p.map((x) => (x.existe ? x : { ...x, excluir: !e.target.checked })))} /> Incluir</th><th>Fecha sistema</th><th>Se causa</th><th>Descripción</th><th>Débito</th><th>Crédito</th><th>Estado</th><th>Tratamiento</th><th>Categoría › subcategoría</th></tr></thead>
                  <tbody>
                    {prev.map((f) => (
                      <tr key={f.key} style={f.existe ? { opacity: 0.5 } : f.excluir ? { opacity: 0.4, textDecoration: "line-through" } : undefined}>
                        <td><input type="checkbox" disabled={f.existe} checked={!f.existe && !f.excluir} onChange={(e) => setFila(f.key, { excluir: !e.target.checked })} /></td>
                        <td className="amg-mono">{ui.fmtDate(f.fechaSistema)}</td><td className="amg-mono">{ui.fmtDate(f.fecha)}</td><td style={{ maxWidth: 300, whiteSpace: "normal" }}>{f.descripcion}</td>
                        <td className="amg-mono">{f.transaccion === "Nota Débito" ? n2(f.valor) : ""}</td><td className="amg-mono" style={{ color: "var(--green)" }}>{f.transaccion === "Nota Crédito" ? n2(f.valor) : ""}</td>
                        <td>{f.existe ? <ui.Badge text="Ya cargado" color="gray" /> : f.excluir ? <ui.Badge text="Excluido" color="red" /> : <ui.Badge text="Nuevo" color="green" />}</td>
                        <td>{f.existe || f.excluir ? "-" : f.transaccion === "Nota Crédito" ? <ui.Badge text="Abono" color="green" />
                          : <select className="amg-select" style={{ width: 120 }} value={f.accion} onChange={(e) => setFila(f.key, { accion: e.target.value })}><option value="Gasto">Gasto</option><option value="Solo saldo">{f.tipo === "Pago" ? "Pago (solo saldo)" : "Solo saldo"}</option></select>}</td>
                        <td>{!f.existe && !f.excluir && f.accion === "Gasto"
                          ? <select className="amg-select" style={{ width: 240, borderColor: f.subId ? undefined : "var(--red)" }} value={f.subId} onChange={(e) => setFila(f.key, { subId: e.target.value })}><option value="">Elegir subcategoría...</option>{subOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                          : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {excluidos > 0 && <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>Los {excluidos} movimiento(s) excluidos no se guardan: no mueven el saldo ni se crean como gasto. Si cargas el archivo otra vez, volverán a aparecer.</div>}
              {sinSub.length > 0 && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 8 }}><AlertTriangle size={13} /> {sinSub.length} gasto(s) sin subcategoría: elígela en la tabla, o crea la que falta en Categorías y subcategorías y vuelve a cargar el archivo.</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="amg-btn primary" disabled={busy || nuevos.length === 0 || sinSub.length > 0} onClick={registrar}><Check size={14} /> {busy ? "Registrando..." : `Registrar ${nuevos.length} movimiento(s)${gastos.length ? ` y ${gastos.length} gasto(s)` : ""}`}</button>
                <button className="amg-btn" disabled={busy} onClick={() => { setPrev(null); setArchivo(""); }}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="amg-card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Movimientos</div>
          <label style={{ fontSize: 12.5 }}>Fecha de sistema desde <input type="date" className="amg-input" style={{ width: 150 }} value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label style={{ fontSize: 12.5 }}>hasta <input type="date" className="amg-input" style={{ width: 150 }} value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{lista.length} movimiento(s)</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="amg-table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>Fecha sistema</th><th>Se causa</th><th>Descripción</th><th>Tipo</th><th>Débito</th><th>Crédito</th><th>Gasto</th><th>Saldo al cierre del día</th></tr></thead>
            <tbody>
              {lista.map((m) => {
                const primero = !cierres.has(m.fecha_sistema); cierres.add(m.fecha_sistema);
                const g = gastoDe.get(m.id), cierre = primero ? B.saldoAl(m.fecha_sistema, cfg, movs) : null;
                return (
                  <tr key={m.id}>
                    <td className="amg-mono">{ui.fmtDate(m.fecha_sistema)}</td><td className="amg-mono">{ui.fmtDate(m.fecha)}</td><td style={{ maxWidth: 320, whiteSpace: "normal" }}>{m.descripcion}</td>
                    <td><ui.Badge text={m.tipo} color={TIPO_COLOR[m.tipo]} /></td>
                    <td className="amg-mono">{m.transaccion === "Nota Débito" ? n2(m.valor) : ""}</td><td className="amg-mono" style={{ color: "var(--green)" }}>{m.transaccion === "Nota Crédito" ? n2(m.valor) : ""}</td>
                    <td>{m.tipo !== "Gasto" ? "" : g ? <ui.Badge text={g.status === "Activo" ? "Registrado" : "Anulado"} color={g.status === "Activo" ? "green" : "gray"} />
                      : canEdit ? <button className="amg-btn" style={{ padding: "2px 8px" }} onClick={() => crearGasto(m)}>Crear gasto</button> : <span style={{ color: "var(--red)" }}>Sin gasto</span>}</td>
                    <td className="amg-mono" style={{ fontWeight: 600 }}>{cierre === null ? "" : B.fmtSaldo(cierre)}</td>
                  </tr>
                );
              })}
              {lista.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 18 }}>No hay movimientos cargados en estas fechas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="amg-card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Reglas de clasificación</div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>
          Si la descripción del banco contiene el texto de la regla, el movimiento se trata como <b>Gasto</b> (costo financiero, va a Gastos con su categoría y subcategoría) o como <b>Pago</b> (ya está como gasto de cada persona: solo mueve el saldo). Un abono siempre suma al saldo; un débito sin regla queda "Solo saldo" y lo decides al cargar.
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="amg-table" style={{ fontSize: 12.5 }}>
            <thead><tr><th>La descripción contiene</th><th>Tratamiento</th><th>Concepto del gasto</th><th>Categoría › subcategoría</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {reglas.map((r) => {
                const s = r.tipo === "Gasto" ? B.subDeRegla(r, db) : null;
                return (
                  <tr key={r.id}>
                    <td><input className="amg-input" style={{ padding: "4px 6px", width: 250 }} disabled={!isAdmin} value={r.patron} onChange={(e) => setRegla(r.id, { patron: e.target.value })} /></td>
                    <td><select className="amg-select" style={{ width: 90 }} disabled={!isAdmin} value={r.tipo} onChange={(e) => setRegla(r.id, { tipo: e.target.value })}><option>Gasto</option><option>Pago</option></select></td>
                    <td>{r.tipo === "Gasto" ? <input className="amg-input" style={{ padding: "4px 6px", width: 260 }} disabled={!isAdmin} value={r.concepto} onChange={(e) => setRegla(r.id, { concepto: e.target.value })} /> : <span style={{ color: "var(--text-faint)" }}>-</span>}</td>
                    <td>{r.tipo === "Gasto"
                      ? <><select className="amg-select" style={{ width: 250, borderColor: s ? undefined : "var(--red)" }} disabled={!isAdmin} value={r.subcategoryId || ""} onChange={(e) => setRegla(r.id, { subcategoryId: e.target.value })}>
                          <option value="">{s && s.sugerida ? `Sugerida: ${(db.categories.find((c) => c.id === s.sub.categoryId) || {}).name || "?"} › ${s.sub.name}` : "Elegir subcategoría..."}</option>{subOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                        {!s && <div style={{ color: "var(--red)", fontSize: 11 }}>Falta crear la subcategoría</div>}</>
                      : <span style={{ color: "var(--text-faint)" }}>-</span>}</td>
                    {isAdmin && <td><button className="amg-btn ghost" style={{ padding: 4 }} title="Quitar la regla" onClick={() => setReglas((rs) => rs.filter((x) => x.id !== r.id))}><X size={13} color="var(--red)" /></button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="amg-btn" onClick={() => setReglas((rs) => [...rs, { id: uid(), patron: "", tipo: "Gasto", concepto: "", claves: [], subcategoryId: "" }])}><Plus size={14} /> Agregar regla</button>
            <button className="amg-btn primary" onClick={guardarReglas}><Check size={14} /> Guardar reglas</button>
          </div>
        )}
      </div>
    </div>
  );
}
