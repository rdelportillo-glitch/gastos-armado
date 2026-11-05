import { useState, useMemo } from "react";

/* ============================================================================
   CAMBIOS DE REGISTROS (Carga e Histórico de asignación) — solo administrador
   Muestra quién modificó qué y cuándo, a partir de la auditoría: usuario, fecha y hora, acción, registro (servicio y producto), valor anterior y nuevo.
   La auditoría solo la puede leer el administrador y guarda los últimos 500 movimientos.
============================================================================ */

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// Acciones de la auditoría que son cambios de registros de cada módulo.
const ES_CARGA = (a) => /\(Carga\)/.test(a) || a === "Auditoría de causal" || a === "Importación de reporte Extreme" || /cambio de técnico/i.test(a);
const ES_HISTORICO = (a) => /histórico de asignación/i.test(a) || a === "Finalización del día (Carga)";

export default function CambiosRegistros({ db, ui, modulo, initialQ = "", onClose }) {
  const [q, setQ] = useState(initialQ);
  const [usuario, setUsuario] = useState("");
  const [accion, setAccion] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const esDelModulo = modulo === "historico" ? ES_HISTORICO : ES_CARGA;
  const nombreDe = useMemo(() => Object.fromEntries((db.users || []).map((u) => [u.id, u.name])), [db.users]);
  const servicioDe = useMemo(() => new Map((db.services || []).map((s) => [s.id, s])), [db.services]);

  // El registro de la auditoría de Carga es el id interno del servicio: se muestra como "servicio · producto".
  const etiquetaDe = (l) => { const s = servicioDe.get(l.record); return s ? `${s.servicioExterno} · ${s.productoExternoNombre || "-"}` : String(l.record || "-"); };

  const base = useMemo(() => (db.auditLog || []).filter((l) => esDelModulo(String(l.action || ""))), [db.auditLog, modulo]);
  const usuarios = useMemo(() => [...new Set(base.map((l) => l.userId).filter(Boolean))].map((id) => ({ id, name: nombreDe[id] || "Usuario" })).sort((a, b) => a.name.localeCompare(b.name, "es")), [base, nombreDe]);
  const acciones = useMemo(() => [...new Set(base.map((l) => l.action))].sort((a, b) => a.localeCompare(b, "es")), [base]);

  const terminos = q.split(/[\s,;]+/).map((x) => plano(x)).filter(Boolean);
  const filas = base.filter((l) => (!usuario || l.userId === usuario) && (!accion || l.action === accion) && (!desde || l.date >= desde) && (!hasta || l.date <= hasta)
    && (!terminos.length || terminos.some((t) => plano(`${etiquetaDe(l)} ${l.oldValue} ${l.newValue} ${l.action} ${nombreDe[l.userId] || ""}`).includes(t))));

  return (
    <ui.Modal title={modulo === "historico" ? "Cambios en el histórico de asignación" : "Cambios en Carga"} onClose={onClose} width={1080}
      footer={<button className="amg-btn" onClick={onClose}>Cerrar</button>}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10 }}>
        Quién modificó cada registro y cuándo. Sale de la auditoría (los últimos {db.auditLog ? Math.min(500, db.auditLog.length) : 0} movimientos de toda la plataforma; solo la ve el administrador).
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <input className="amg-input" style={{ width: 240 }} placeholder="Buscar servicio, usuario o detalle..." value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <select className="amg-select" style={{ width: 190 }} value={usuario} onChange={(e) => setUsuario(e.target.value)}>
          <option value="">Todos los usuarios</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="amg-select" style={{ width: 240 }} value={accion} onChange={(e) => setAccion(e.target.value)}>
          <option value="">Todas las acciones</option>{acciones.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <label style={{ fontSize: 12.5 }}>Desde <input type="date" className="amg-input" style={{ width: 145 }} value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label style={{ fontSize: 12.5 }}>hasta <input type="date" className="amg-input" style={{ width: 145 }} value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <span style={{ fontSize: 12.5, color: "var(--text-dim)", marginLeft: "auto" }}>{filas.length} cambio(s)</span>
      </div>
      <div style={{ overflow: "auto", maxHeight: 460 }}>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Antes</th><th>Después / detalle</th></tr></thead>
          <tbody>
            {filas.map((l) => (
              <tr key={l.id}>
                <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{ui.fmtDate(l.date)} {l.time}</td>
                <td style={{ whiteSpace: "nowrap" }}>{nombreDe[l.userId] || <span style={{ color: "var(--text-faint)" }}>-</span>}</td>
                <td>{l.action}</td>
                <td style={{ maxWidth: 220, whiteSpace: "normal", wordBreak: "break-word" }}>{etiquetaDe(l)}</td>
                <td style={{ maxWidth: 220, whiteSpace: "normal", wordBreak: "break-word" }}>{l.oldValue || "-"}</td>
                <td style={{ maxWidth: 340, whiteSpace: "normal", wordBreak: "break-word" }}>{l.newValue || "-"}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{base.length === 0 ? "Todavía no hay cambios registrados en la auditoría." : "Ningún cambio coincide con los filtros."}</td></tr>}
          </tbody>
        </table>
      </div>
    </ui.Modal>
  );
}
