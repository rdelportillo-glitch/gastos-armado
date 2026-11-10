import { useState } from "react";
import { Search, AlertTriangle, Phone, MapPin } from "lucide-react";
import * as K from "./lib/cliente";
import { fmtCOP } from "./lib/ventas";

/* ============================================================================
   COMERCIAL → CONSULTA DE CLIENTE
   Se escribe la cédula (o NIT / documento) y salen todos los servicios del cliente: armados (con su resultado), instalaciones de TV y ventas.
   El documento viene de la base de Jamar (columna CLIENTE de cada servicio) y de lo que el técnico escribe en cada venta; las ofertas de TV se ligan por el número de servicio.
   Solo lectura. Es información personal: la ven el administrador, el operador y la consulta.
============================================================================ */

const colorResultado = (r) => (/^Realizado$/.test(r) ? "green" : /Realizado/.test(r) && !/No realizado/.test(r) ? "green" : /No realizado|Cancelado|Anulado/.test(r) ? "red" : "amber");
const colorTv = (e) => (e === "Aceptó" ? "green" : e === "Indeciso" ? "amber" : e === "No aceptó" || e === "No contactado" ? "red" : "gray");

export default function Clientes({ db, ui }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [busc, setBusc] = useState("");

  const buscar = async () => {
    setBusy(true); setError(""); setRes(null); setBusc(q.trim());
    try { setRes(await K.buscarCliente(q, db.services, db.technicians)); } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const hayAlgo = res && (res.servicios.length || res.tv.length || res.ventas.length);
  const ventasActivas = res ? res.ventas.filter((v) => v.estado === "Activa") : [];
  const totalVentas = ventasActivas.reduce((s, v) => s + v.total, 0);
  const tvAceptadas = res ? res.tv.filter((o) => o.estado === "Aceptó").length : 0;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Consulta de cliente por cédula</div>
        <form onSubmit={(e) => { e.preventDefault(); if (!busy) buscar(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="amg-input amg-mono" style={{ width: 260 }} inputMode="text" placeholder="Cédula, NIT o documento..." value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <button type="submit" className="amg-btn primary" disabled={busy || K.normDoc(q).length < 5}><Search size={14} /> {busy ? "Buscando..." : "Buscar"}</button>
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Sin puntos ni espacios; también sirve con ellos. Busca servicios de armado, instalaciones de TV y ventas.</span>
        </form>
        {error && <div className="amg-alert danger" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {error}</div>}
      </div>

      {res && !hayAlgo && (
        <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>
          No hay servicios, instalaciones de TV ni ventas con el documento <b className="amg-mono">{busc}</b>. El documento sale de la base de Jamar y de las ventas de los técnicos; si el cliente nunca lo trajo, no aparece.
        </div>
      )}

      {res && hayAlgo && (
        <>
          <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "baseline" }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{res.nombres[0] || "Cliente"}</div>
              <div className="amg-mono" style={{ color: "var(--text-dim)" }}>Documento {busc}</div>
            </div>
            {res.nombres.length > 1 && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 4 }}>También registrado como: {res.nombres.slice(1).join(" · ")}</div>}
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8, fontSize: 13 }}>
              {res.telefonos.length > 0 && <span><Phone size={12} /> {res.telefonos.join(" · ")}</span>}
              {res.direcciones.length > 0 && <span><MapPin size={12} /> {res.direcciones.slice(0, 3).join(" | ")}{res.direcciones.length > 3 ? ` (+${res.direcciones.length - 3})` : ""}</span>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
            <ui.StatCard label="Servicios de armado" value={new Set(res.servicios.map((s) => s.servicio)).size} sub={`${res.servicios.reduce((s, x) => s + x.unidades, 0)} producto(s)`} accent />
            <ui.StatCard label="Instalaciones de TV" value={res.tv.length} sub={`${tvAceptadas} aceptada(s)`} />
            <ui.StatCard label="Ventas" value={ventasActivas.length} sub={`${fmtCOP(totalVentas)} comprados`} accent />
          </div>

          <div className="amg-card" style={{ overflowX: "auto", marginBottom: 14 }}>
            <div style={{ padding: "10px 12px", fontWeight: 600 }}>Servicios de armado ({res.servicios.length})</div>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Fecha</th><th>Servicio</th><th>Productos</th><th>Dirección</th><th>Técnico</th><th>Resultado</th><th>Causal</th></tr></thead>
              <tbody>
                {res.servicios.map((s) => (
                  <tr key={`${s.servicio}|${s.fecha}`}>
                    <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{s.fecha ? ui.fmtDate(s.fecha) : "-"}</td>
                    <td className="amg-mono" style={{ fontWeight: 600 }}>{s.servicio}{s.empresa && s.empresa !== "JAMAR" ? <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{s.empresa}</div> : null}</td>
                    <td>{s.productos.map((p) => `${p.nombre}${p.cantidad > 1 ? ` ×${p.cantidad}` : ""}`).join(", ")}</td>
                    <td>{[s.direccion, s.barrio, s.ciudad].filter(Boolean).join(", ") || "-"}</td>
                    <td>{s.tecnico || "-"}</td>
                    <td><ui.Badge text={s.resultado} color={colorResultado(s.resultado)} /></td>
                    <td style={{ fontSize: 11.5 }}>{s.causal || "-"}</td>
                  </tr>
                ))}
                {res.servicios.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-faint)", padding: 16 }}>Sin servicios de armado con este documento.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="amg-card" style={{ overflowX: "auto", marginBottom: 14 }}>
            <div style={{ padding: "10px 12px", fontWeight: 600 }}>Instalaciones de TV ({res.tv.length})</div>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Fecha</th><th>Servicio</th><th>Panel / producto</th><th>Oferta</th><th>Ejecución</th><th>Valor</th><th>Cobro</th><th>Técnico</th></tr></thead>
              <tbody>
                {res.tv.map((o) => (
                  <tr key={o.id}>
                    <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{o.fecha ? ui.fmtDate(String(o.fecha).slice(0, 10)) : "-"}</td><td className="amg-mono">{o.servicio}</td><td>{o.productos || "-"}{o.pulgadas ? ` · ${o.pulgadas}"` : ""}</td>
                    <td><ui.Badge text={o.estado} color={colorTv(o.estado)} />{o.objecion ? <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{o.objecion}</div> : null}</td>
                    <td>{o.ejecucion || "-"}</td>
                    <td className="amg-mono">{o.valorTotal !== null && o.valorTotal !== undefined ? fmtCOP(o.valorTotal) : "-"}</td>
                    <td className="amg-mono">{o.valorCobrado !== null && o.valorCobrado !== undefined ? fmtCOP(o.valorCobrado) : "-"}{o.forma ? <div style={{ fontSize: 10.5 }}>{o.forma}</div> : null}</td>
                    <td>{o.tecnico || "-"}</td>
                  </tr>
                ))}
                {res.tv.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 16 }}>Sin ofertas ni instalaciones de TV en sus servicios.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="amg-card" style={{ overflowX: "auto" }}>
            <div style={{ padding: "10px 12px", fontWeight: 600 }}>Ventas ({res.ventas.length})</div>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Venta</th><th>Fecha</th><th>Productos</th><th>Total</th><th>Pago</th><th>Servicio</th><th>Técnico</th><th>Estado</th></tr></thead>
              <tbody>
                {res.ventas.map((v) => (
                  <tr key={v.id} style={{ opacity: v.estado === "Anulada" ? 0.55 : 1 }}>
                    <td className="amg-mono" style={{ fontWeight: 700 }}>{v.consecutivo}</td><td className="amg-mono">{ui.fmtDate(v.fecha)}</td>
                    <td>{v.items.map((i) => `${i.nombre} ×${i.cantidad}`).join(", ")}</td>
                    <td className="amg-mono" style={{ fontWeight: 700 }}>{fmtCOP(v.total)}</td><td>{v.pago}</td><td className="amg-mono">{v.origen === "servicio" ? (v.servicio || "-") : "Particular"}</td>
                    <td>{((db.technicians || []).find((t) => t.id === v.technicianId) || {}).name?.replace(/_/g, " ") || "-"}</td>
                    <td>{v.estado === "Anulada" ? <ui.Badge text="Anulada" color="red" /> : <ui.Badge text="Activa" color="green" />}</td>
                  </tr>
                ))}
                {res.ventas.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 16 }}>Sin ventas con este documento.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
            El resultado de los servicios cerrados es el del histórico de asignación (sin los registros anulados); lo que aún está en Carga o Asignación sale con su estado actual. Las instalaciones de TV se ligan por número de servicio.
          </div>
        </>
      )}
    </div>
  );
}
