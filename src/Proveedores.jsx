import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { Plus, Pencil, Ban, RotateCcw, Search, Download, Upload, Check, AlertTriangle } from "lucide-react";
import { leerHojaPagos as leerHoja } from "./lib/hojaPagos";

/* ============================================================================
   PROVEEDORES (categoría Gastos)
   Proveedores a los que se les paga un gasto, con sus datos de pago (identificación, titular, banco, tipo y número de cuenta). Se pueden importar y exportar con las
   columnas de la hoja de pagos. No se borran: se inactivan. En "Registrar gasto" se elige a quién se paga: una persona de Personal o un proveedor.
============================================================================ */

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const uid = () => crypto.randomUUID();
const TIPOS_CUENTA = ["CA", "CC"]; // ahorros / corriente, como en la hoja de pagos

// Columnas de la hoja de pagos, en su orden.
const COLUMNAS = ["ID", "TIPO DE IDENTIFICACION", "NUMERO IDENTIFICACION", "NOMBRE DEL TITULAR", "APELLIDO DEL TITULAR", "BANCO DESTINO", "TIPO DE CUENTA", "NUMERO CUENTA", "OBSERVACIONES"];

// Número si es solo dígitos sin cero a la izquierda (como en la hoja); si no, texto (conserva los ceros de un número de cuenta).
const numOTexto = (v) => { const t = String(v ?? "").trim(); return t !== "" && /^[1-9]\d{0,14}$/.test(t) ? Number(t) : t; };

const filaDeProveedor = (p) => [p.name, p.idType, numOTexto(p.idNumber), p.holderFirstName, p.holderLastName, numOTexto(p.bankCode), p.accountType, numOTexto(p.accountNumber), p.observations];

function ProveedorModal({ ui, data, proveedores, onSave, onClose }) {
  const [f, setF] = useState({
    name: data.name || "", idType: data.idType || "", idNumber: data.idNumber || "", holderFirstName: data.holderFirstName || "", holderLastName: data.holderLastName || "",
    bankCode: data.bankCode || "", accountType: data.accountType || "", accountNumber: data.accountNumber || "", observations: data.observations || "",
  });
  const [error, setError] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const guardar = () => {
    const name = f.name.trim().replace(/\s+/g, " ");
    if (!name) { setError("El nombre (ID) es obligatorio."); return; }
    if (proveedores.some((p) => p.id !== data.id && plano(p.name) === plano(name))) { setError("Ya existe un proveedor con ese nombre."); return; }
    onSave({ ...data, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])), name });
  };
  const lbl = (t) => <label className="amg-label">{t}</label>;
  return (
    <ui.Modal title={data.id ? "Editar proveedor" : "Nuevo proveedor"} onClose={onClose} width={640}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" onClick={guardar}>Guardar</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Nombre del proveedor (ID) *")}<input className="amg-input" value={f.name} onChange={set("name")} placeholder="Como se conoce, por ejemplo MUEBLES JAMAR" /></div>
        <div>{lbl("Tipo de identificación")}<input className="amg-input" value={f.idType} onChange={set("idType")} placeholder="1, 2, 3..." /></div>
        <div>{lbl("Número de identificación")}<input className="amg-input amg-mono" value={f.idNumber} onChange={set("idNumber")} /></div>
        <div>{lbl("Nombre del titular")}<input className="amg-input" value={f.holderFirstName} onChange={set("holderFirstName")} /></div>
        <div>{lbl("Apellido del titular")}<input className="amg-input" value={f.holderLastName} onChange={set("holderLastName")} /></div>
        <div>{lbl("Banco destino (código)")}<input className="amg-input amg-mono" value={f.bankCode} onChange={set("bankCode")} /></div>
        <div>{lbl("Tipo de cuenta")}
          <select className="amg-select" value={f.accountType} onChange={set("accountType")}><option value="">-</option>{TIPOS_CUENTA.map((t) => <option key={t}>{t}</option>)}{f.accountType && !TIPOS_CUENTA.includes(f.accountType) && <option>{f.accountType}</option>}</select></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Número de cuenta")}<input className="amg-input amg-mono" value={f.accountNumber} onChange={set("accountNumber")} /></div>
        <div style={{ gridColumn: "1 / -1" }}>{lbl("Observaciones")}<textarea className="amg-textarea" rows={2} value={f.observations} onChange={set("observations")} /></div>
      </div>
      {error && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {error}</div>}
    </ui.Modal>
  );
}

export default function ProveedoresModule({ db, persist, addAudit, session, ui }) {
  const proveedores = db.suppliers || [];
  const canEdit = session.role === "admin" || session.role === "operador";
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("Activo");
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [importar, setImportar] = useState(null); // { filas: [{ p, estado }] }
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // Gastos pagados a cada proveedor (activos).
  const gastos = useMemo(() => {
    const m = {};
    (db.expenses || []).filter((e) => e.supplierId && e.status === "Activo").forEach((e) => { const g = (m[e.supplierId] = m[e.supplierId] || { n: 0, total: 0 }); g.n++; g.total += e.totalValue || 0; });
    return m;
  }, [db.expenses]);

  const rows = proveedores.filter((p) => (!estado || p.status === estado)
    && (!q.trim() || plano(`${p.name} ${p.idNumber} ${p.holderFirstName} ${p.holderLastName} ${p.accountNumber}`).includes(plano(q)))).sort((a, b) => a.name.localeCompare(b.name, "es"));

  const guardar = (data) => {
    let next;
    if (data.id) {
      const antes = proveedores.find((p) => p.id === data.id);
      next = { ...db, suppliers: proveedores.map((p) => (p.id === data.id ? { ...p, ...data } : p)) };
      next = addAudit(next, { userId: session.id, action: "Edición de proveedor", record: data.id, oldValue: antes.name, newValue: data.name });
    } else {
      const nuevo = { ...data, id: uid(), status: "Activo" };
      next = { ...db, suppliers: [...proveedores, nuevo] };
      next = addAudit(next, { userId: session.id, action: "Creación de proveedor", record: nuevo.id, oldValue: "-", newValue: nuevo.name });
    }
    persist(next);
    setModal(null);
  };
  const cambiarEstado = (p, status) => {
    persist(addAudit({ ...db, suppliers: proveedores.map((x) => (x.id === p.id ? { ...x, status } : x)) }, { userId: session.id, action: status === "Activo" ? "Reactivación de proveedor" : "Inactivación de proveedor", record: p.id, oldValue: p.name, newValue: status }));
    setConfirm(null);
  };

  const exportar = () => {
    const lista = sel.size ? proveedores.filter((p) => sel.has(p.id)) : rows;
    const ws = XLSX.utils.aoa_to_sheet([COLUMNAS, ...lista.map(filaDeProveedor)]);
    ws["!cols"] = [26, 12, 16, 20, 20, 12, 10, 18, 30].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Proveedores");
    XLSX.writeFile(wb, `proveedores_${ui.todayISO()}.xlsx`);
  };

  const leerArchivo = async (file) => {
    setError(""); setMsg("");
    try {
      const filas = leerHoja(await file.arrayBuffer());
      if (!filas.length) { setError("El archivo no trae proveedores."); return; }
      // Un proveedor ya existe si coincide el nombre o el número de identificación; el archivo puede repetir un nombre (se toma el primero).
      const vistosNombre = new Set(proveedores.map((p) => plano(p.name))), vistosId = new Set(proveedores.map((p) => plano(p.idNumber)).filter(Boolean));
      const res = filas.map((p) => {
        const n = plano(p.name), i = plano(p.idNumber);
        const existe = vistosNombre.has(n) || (i && vistosId.has(i));
        if (!existe) { vistosNombre.add(n); if (i) vistosId.add(i); }
        return { p, estado: existe ? "Ya existe" : !p.idNumber || !p.accountNumber ? "Nuevo (incompleto)" : "Nuevo" };
      });
      setImportar({ filas: res });
    } catch (e) { setError(e.message || String(e)); }
  };
  const confirmarImportar = () => {
    const nuevos = importar.filas.filter((x) => x.estado.startsWith("Nuevo")).map((x) => ({ ...x.p, id: uid(), status: "Activo" }));
    if (!nuevos.length) { setImportar(null); return; }
    persist(addAudit({ ...db, suppliers: [...proveedores, ...nuevos] }, { userId: session.id, action: "Importación de proveedores", record: `${nuevos.length} proveedores`, oldValue: "-", newValue: nuevos.map((p) => p.name).join(", ").slice(0, 300) }));
    setMsg(`Se importaron ${nuevos.length} proveedor(es).`);
    setImportar(null);
  };

  const todosMarcados = rows.length > 0 && rows.every((p) => sel.has(p.id));
  const fmt = (n) => Math.round(n || 0).toLocaleString("es-CO");

  return (
    <div>
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search size={14} style={{ position: "absolute", left: 8, top: 10, color: "var(--text-faint)" }} />
          <input className="amg-input" style={{ paddingLeft: 28 }} placeholder="Buscar por nombre, identificación, titular o cuenta..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="amg-select" style={{ width: 150 }} value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option><option>Activo</option><option>Inactivo</option></select>
        <button className="amg-btn" title="Excel con las columnas de la hoja de pagos (los seleccionados; si no hay, los que se ven)" onClick={exportar}><Download size={14} /> Exportar Excel{sel.size ? ` (${sel.size})` : ""}</button>
        {canEdit && (
          <label className="amg-btn" style={{ cursor: "pointer" }} title="Sube la hoja de pagos con las columnas ID, TIPO DE IDENTIFICACION, NUMERO IDENTIFICACION, NOMBRE DEL TITULAR, APELLIDO DEL TITULAR, BANCO DESTINO, TIPO DE CUENTA, NUMERO CUENTA, OBSERVACIONES">
            <Upload size={14} /> Importar Excel<input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) leerArchivo(f); }} />
          </label>
        )}
        {canEdit && <button className="amg-btn primary" onClick={() => setModal({})}><Plus size={14} /> Nuevo proveedor</button>}
      </div>

      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr>
            <th style={{ width: 28 }}><input type="checkbox" title="Seleccionar todos los que se ven" checked={todosMarcados} onChange={() => setSel(todosMarcados ? new Set() : new Set(rows.map((p) => p.id)))} /></th>
            <th>Proveedor (ID)</th><th>Tipo id.</th><th>N° identificación</th><th>Titular</th><th>Banco</th><th>Tipo cuenta</th><th>N° cuenta</th><th>Gastos pagados</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} style={p.status === "Activo" ? undefined : { opacity: 0.6 }}>
                <td><input type="checkbox" checked={sel.has(p.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} /></td>
                <td><b>{p.name}</b>{p.observations && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{p.observations}</div>}</td>
                <td className="amg-mono">{p.idType || "-"}</td><td className="amg-mono">{p.idNumber || "-"}</td><td>{[p.holderFirstName, p.holderLastName].filter(Boolean).join(" ") || "-"}</td>
                <td className="amg-mono">{p.bankCode || "-"}</td><td className="amg-mono">{p.accountType || "-"}</td><td className="amg-mono">{p.accountNumber || "-"}</td>
                <td className="amg-mono">{gastos[p.id] ? `${gastos[p.id].n} · $${fmt(gastos[p.id].total)}` : "-"}</td>
                <td><ui.Badge text={p.status} color={p.status === "Activo" ? "green" : "gray"} /></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} title="Editar" onClick={() => setModal(p)}><Pencil size={13} /></button>}
                  {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} title={p.status === "Activo" ? "Inactivar" : "Reactivar"} onClick={() => setConfirm({ p, to: p.status === "Activo" ? "Inactivo" : "Activo" })}>
                    {p.status === "Activo" ? <Ban size={13} color="var(--red)" /> : <RotateCcw size={13} color="var(--green)" />}</button>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{proveedores.length ? "Ningún proveedor coincide con los filtros." : "Aún no hay proveedores. Créalos con \"Nuevo proveedor\" o impórtalos desde Excel. Si es la primera vez, falta correr el SQL de proveedores (sql/42) en Supabase."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>{rows.length} proveedor(es). No se borran: al inactivarlos dejan de ofrecerse en Registrar gasto, pero sus gastos se conservan. En <b>Registrar gasto</b> eliges si se paga a una persona de Personal o a un proveedor.</div>

      {modal !== null && <ProveedorModal ui={ui} data={modal} proveedores={proveedores} onSave={guardar} onClose={() => setModal(null)} />}
      {confirm && (
        <ui.ConfirmModal title={confirm.to === "Inactivo" ? "Inactivar proveedor" : "Reactivar proveedor"} danger={confirm.to === "Inactivo"} confirmLabel={confirm.to === "Inactivo" ? "Inactivar" : "Reactivar"}
          message={confirm.to === "Inactivo" ? `"${confirm.p.name}" dejará de ofrecerse al registrar gastos. Sus gastos se conservan.` : `"${confirm.p.name}" volverá a ofrecerse al registrar gastos.`}
          onConfirm={() => cambiarEstado(confirm.p, confirm.to)} onClose={() => setConfirm(null)} />
      )}
      {importar && (
        <ui.Modal title="Importar proveedores" onClose={() => setImportar(null)} width={760}
          footer={<><button className="amg-btn" onClick={() => setImportar(null)}>Cancelar</button><button className="amg-btn primary" disabled={!importar.filas.some((x) => x.estado.startsWith("Nuevo"))} onClick={confirmarImportar}>Importar {importar.filas.filter((x) => x.estado.startsWith("Nuevo")).length} proveedor(es)</button></>}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{importar.filas.length} fila(s) en el archivo: {importar.filas.filter((x) => x.estado.startsWith("Nuevo")).length} nuevas y {importar.filas.filter((x) => x.estado === "Ya existe").length} que ya existen (no se duplican).</div>
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12 }}>
              <thead><tr><th>ID</th><th>N° identificación</th><th>Banco</th><th>Tipo</th><th>N° cuenta</th><th>Resultado</th></tr></thead>
              <tbody>{importar.filas.map((x, i) => (
                <tr key={i}><td>{x.p.name}</td><td className="amg-mono">{x.p.idNumber || "-"}</td><td className="amg-mono">{x.p.bankCode || "-"}</td><td>{x.p.accountType || "-"}</td><td className="amg-mono">{x.p.accountNumber || "-"}</td>
                  <td style={{ color: x.estado === "Ya existe" ? "var(--text-faint)" : x.estado.includes("incompleto") ? "var(--accent)" : "var(--green)" }}>{x.estado}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>Un proveedor ya existe si coincide el nombre o el número de identificación. Los "incompletos" se importan sin número de identificación o de cuenta; puedes completarlos después.</div>
        </ui.Modal>
      )}
    </div>
  );
}
