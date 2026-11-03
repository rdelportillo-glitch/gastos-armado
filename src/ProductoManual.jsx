import { useState } from "react";
import { Plus } from "lucide-react";
import * as A from "./lib/armados/armadosData";

// Usado en Armados en almacén, Programación de servicios y Agregar/Editar servicio de Carga.
// Producto que no está en el maestro (totalmente nuevo): se escribe el nombre y, si se tiene, el código. Solo sirve para completar la solicitud, el armado
// o el servicio; NO se crea en el maestro. Si el código escrito ya existe en el maestro, se usa el del maestro.
export default function ProductoManual({ onAdd }) {
  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [aviso, setAviso] = useState("");
  const [busy, setBusy] = useState(false);
  const agregar = async () => {
    const name = nombre.trim().replace(/\s+/g, " ");
    const code = codigo.trim();
    if (!name) { setAviso("Escribe el nombre del producto."); return; }
    setBusy(true); setAviso("");
    let p = null;
    if (code) { try { const r = await A.productosPorCodigo([code]); if (r && r[0]) p = { code: r[0].code, name: r[0].name, line: r[0].line || "" }; } catch (e) { /* sin consulta: se trata como nuevo */ } }
    if (p) setAviso(`El código ${code} ya está en el maestro: se agregó "${p.name}".`);
    else p = { code: code || A.codigoManual(name), name, line: "", manual: true };
    onAdd(p);
    setCodigo(""); setNombre(""); setBusy(false);
  };
  if (!abierto) return <button type="button" className="amg-btn ghost" style={{ fontSize: 12, marginTop: 6, padding: "2px 6px" }} onClick={() => setAbierto(true)}><Plus size={12} /> ¿El producto no está en el maestro? Escribirlo a mano</button>;
  return (
    <div style={{ marginTop: 8, padding: 10, border: "1px dashed var(--border)", borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Producto nuevo (fuera del maestro)</div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 8, alignItems: "end" }}>
        <div><label className="amg-label">Código (opcional)</label><input className="amg-input" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Si lo tienes" /></div>
        <div><label className="amg-label">Nombre del producto *</label><input className="amg-input" value={nombre} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); agregar(); } }} /></div>
        <button type="button" className="amg-btn primary" disabled={busy} onClick={agregar}><Plus size={13} /> Agregar</button>
      </div>
      <div style={{ fontSize: 11, color: aviso ? "var(--accent)" : "var(--text-faint)", marginTop: 5 }}>{aviso || "No se crea en el maestro de productos: solo completa este registro. Sin código, el sistema le asigna uno interno (NUEVO-...)."}</div>
      <button type="button" className="amg-btn ghost" style={{ fontSize: 11.5, padding: "1px 6px", marginTop: 4 }} onClick={() => setAbierto(false)}>Cerrar</button>
    </div>
  );
}
