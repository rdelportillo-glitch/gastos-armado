import { useState, useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { productosParaTecnico } from "./lib/productosArmado";

/* ============================================================================
   PRODUCTOS DE ARMADO (técnicos con contrato Producción) — SOLO CONSULTA
   El mismo catálogo del Maestro (código, producto, línea, sublínea, tiempo, personas y precio de armado), sin ningún botón para crear, editar, importar ni adjuntar.
   Lo entrega una función de la base de datos que solo responde a técnicos con contrato Producción (sql/68).
============================================================================ */

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const cop = (n) => (n === null || n === undefined ? "-" : `$ ${Math.round(Number(n)).toLocaleString("es-CO")}`);

export default function ProductosArmadoTecnico() {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [linea, setLinea] = useState("");
  const [pagina, setPagina] = useState(0);
  const PAGINA = 100;

  useEffect(() => {
    let alive = true;
    productosParaTecnico().then((r) => { if (alive) setLista(r); }).catch((e) => { if (alive) { setLista([]); setError(`${e.message}. Si es la primera vez, falta correr el SQL sql/68 en Supabase.`); } });
    return () => { alive = false; };
  }, []);

  const lineas = useMemo(() => [...new Set((lista || []).map((p) => p.line).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [lista]);
  const filtrados = useMemo(() => {
    const b = plano(q);
    return (lista || []).filter((p) => (!linea || p.line === linea) && (!b || plano(`${p.code} ${p.name}`).includes(b)));
  }, [lista, q, linea]);
  useEffect(() => { setPagina(0); }, [q, linea]);

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input className="amg-input" style={{ width: 280 }} placeholder="Buscar por código o producto..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="amg-select" style={{ width: 200 }} value={linea} onChange={(e) => setLinea(e.target.value)}><option value="">Todas las líneas</option>{lineas.map((l) => <option key={l} value={l}>{l}</option>)}</select>
        <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{lista === null ? "Cargando..." : `${filtrados.length} producto(s)`}</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-faint)" }}>Solo consulta</span>
      </div>
      {error && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> {error}</div>}
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table compact" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Código</th><th>Producto</th><th>Línea</th><th>Sublínea</th><th>Min</th><th>Personas</th><th>Armado individual</th><th>Armado entre dos</th></tr></thead>
          <tbody>
            {filtrados.slice(pagina * PAGINA, pagina * PAGINA + PAGINA).map((p) => (
              <tr key={p.code}>
                <td className="amg-mono">{p.code}</td><td style={{ fontWeight: 600 }}>{p.name}</td><td>{p.line || "-"}</td><td>{p.subline || "-"}</td>
                <td className="amg-mono">{p.minutes ?? "-"}</td><td className="amg-mono">{p.persons ?? "-"}</td>
                <td className="amg-mono">{cop(p.individual)}</td><td className="amg-mono">{cop(p.pareja)}</td>
              </tr>
            ))}
            {lista !== null && filtrados.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay productos con esa búsqueda.</td></tr>}
          </tbody>
        </table>
      </div>
      {filtrados.length > PAGINA && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12.5 }}>
          <button className="amg-btn" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <span>{pagina * PAGINA + 1}–{Math.min(filtrados.length, pagina * PAGINA + PAGINA)} de {filtrados.length}</span>
          <button className="amg-btn" disabled={(pagina + 1) * PAGINA >= filtrados.length} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>Catálogo de productos de armado activos, con el tiempo y el precio de armado. «Armado entre dos» es lo que corresponde cuando el producto lo arman dos personas.</div>
    </div>
  );
}
