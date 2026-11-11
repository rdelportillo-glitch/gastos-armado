import { useState } from "react";
import { Check, Copy } from "lucide-react";

// Cuenta y llave para la transferencia del cliente, con botón de copiar (el técnico las copia y las pega en el chat o en su app del banco).
// Salen de Instalación de TV → Configuración → «Datos de pago para copiar» (cfg.datosPago). La usan Instalación de TV y Ventas.
export default function DatosTransferencia({ cfg, compacto }) {
  const d = (cfg && cfg.datosPago) || {};
  const [copiado, setCopiado] = useState("");
  if (!d.cuenta && !d.llave) return null;
  const copiar = async (texto, clave) => {
    try { await navigator.clipboard.writeText(texto); }
    catch (e) { // sin permiso del portapapeles (por ejemplo en algunos celulares): se copia con el método antiguo
      const ta = document.createElement("textarea"); ta.value = texto; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, texto.length);
      try { document.execCommand("copy"); } catch (e2) { /* queda seleccionable: se puede copiar a mano */ }
      document.body.removeChild(ta);
    }
    setCopiado(clave); setTimeout(() => setCopiado(""), 2000);
  };
  const fila = (titulo, valor, clave) => (valor ? (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
      <span style={{ fontSize: 12, color: "var(--text-dim)", minWidth: 96 }}>{titulo}</span>
      <b className="amg-mono" style={{ fontSize: compacto ? 13 : 15, userSelect: "all" }}>{valor}</b>
      <button type="button" className="amg-btn" style={{ padding: "2px 10px" }} onClick={() => copiar(valor, clave)}>{copiado === clave ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}</button>
    </div>
  ) : null);
  return (
    <div className="amg-card" style={{ padding: compacto ? 10 : 12, marginBottom: compacto ? 0 : 12, borderLeft: "4px solid var(--accent)" }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>Datos para la transferencia del cliente</div>
      {fila(`Cuenta${d.banco ? ` ${d.banco}` : ""}`, d.cuenta, "cuenta")}
      {fila("Llave", d.llave, "llave")}
      {d.titular && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>A nombre de {d.titular}</div>}
    </div>
  );
}
