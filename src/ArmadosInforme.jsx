import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AlertTriangle, Download } from "lucide-react";
import * as XLSX from "xlsx";
import * as A from "./lib/armados/armadosData";
import { useZonaCoord, SIN_COORD } from "./lib/useCoordinadores";

/* ============================================================================
   INFORME DE ARMADOS EN ALMACÉN (Resumen)
   Histórico de solicitudes y armados: unidades solicitadas vs armadas, PQR legalizados, por mes, almacén, línea,
   producto y técnico. Cada cliente (Jamar...) solo ve lo suyo: lo garantiza la base de datos.
============================================================================ */

const fmt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const pctDe = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (k) => { const [y, m] = k.split("-"); return `${MESES[+m - 1]} ${String(y).slice(2)}`; };
const top = (m, n) => [...m.entries()].map(([name, valor]) => ({ name, valor })).sort((a, b) => b.valor - a.valor).slice(0, n);
const sumaEn = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

function Grafico({ titulo, datos, alto = 240, color = "var(--accent)", ancho = 110 }) {
  return (
    <div className="amg-card" style={{ padding: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{titulo}</div>
      {datos.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 12.5, padding: 20, textAlign: "center" }}>Sin datos</div> : (
        <ResponsiveContainer width="100%" height={alto}>
          <BarChart data={datos} layout="vertical" margin={{ left: 0, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={ancho} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => [fmt(v), "Unidades"]} />
            <Bar dataKey="valor" fill={color} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default function ArmadosInforme({ db, session, ui }) {
  const [warehouses, setWarehouses] = useState([]);
  const [requests, setRequests] = useState([]);
  const [assemblies, setAssemblies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [f, setF] = useState({ desde: "", hasta: "", almacen: "", coord: "", estado: "" });
  const zona = useZonaCoord(db, session.role !== "cliente"); // el cliente no ve la configuración de coordinadores

  useEffect(() => {
    (async () => {
      try { const [w, r, a] = await Promise.all([A.listWarehouses(), A.listRequests(), A.listAssemblies()]); setWarehouses(w); setRequests(r); setAssemblies(a); }
      catch (e) { setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL de Armados en almacén (sql/27).`); }
      setLoading(false);
    })();
  }, []);

  const almacen = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  const reqs = useMemo(() => requests.filter((r) => r.status !== "Cancelada" || f.estado === "Cancelada")
    .filter((r) => (!f.desde || r.requested_date >= f.desde) && (!f.hasta || r.requested_date <= f.hasta) && (!f.almacen || r.warehouse_id === f.almacen) && (!f.estado || r.status === f.estado)
      && (!f.coord || zona.pasa((almacen[r.warehouse_id] || {}).department, "", f.coord))), [requests, f, almacen, zona.nombres]);
  const ids = useMemo(() => new Set(reqs.map((r) => r.id)), [reqs]);
  const asm = useMemo(() => assemblies.filter((a) => A.suma(a) && ids.has(a.request_id)), [assemblies, ids]); // solo lo que suma como armado
  const asmTodos = useMemo(() => assemblies.filter((a) => !a.voided && ids.has(a.request_id)), [assemblies, ids]); // incluye los de causal negativa

  const d = useMemo(() => {
    const solicitadas = reqs.reduce((s, r) => s + A.unidades(r.items || []), 0);
    const armadas = A.unidades(asm);
    const porMes = new Map(), porAlm = new Map(), porLinea = new Map(), porProd = new Map(), porTec = new Map();
    asm.forEach((a) => {
      sumaEn(porMes, String(a.assembled_on).slice(0, 7), a.quantity);
      const r = reqs.find((x) => x.id === a.request_id);
      sumaEn(porAlm, (almacen[r && r.warehouse_id] || {}).name || "-", a.quantity);
      sumaEn(porLinea, a.product_line || "Sin línea", a.quantity);
      sumaEn(porProd, a.product_name, a.quantity);
      sumaEn(porTec, a.technician_name || "-", a.quantity);
    });
    const filasAlm = new Map();
    reqs.forEach((r) => {
      const n = (almacen[r.warehouse_id] || {}).name || "-";
      const e = filasAlm.get(n) || { almacen: n, solicitudes: 0, abiertas: 0, cerradas: 0, solicitadas: 0, armadas: 0, noArmadas: 0, sinPqr: 0 };
      e.solicitudes++; if (r.status === "Abierta") e.abiertas++; if (r.status === "Cerrada") e.cerradas++;
      e.solicitadas += A.unidades(r.items || []); e.armadas += A.unidades(A.contables(assemblies, r.id)); e.noArmadas += A.unidadesNoArmadas(assemblies, r.id); if (!r.pqr_number) e.sinPqr++;
      filasAlm.set(n, e);
    });
    return {
      solicitadas, armadas, cerradas: reqs.filter((r) => r.status === "Cerrada").length, abiertas: reqs.filter((r) => r.status === "Abierta").length, sinPqr: reqs.filter((r) => !r.pqr_number).length,
      meses: [...porMes.entries()].sort().map(([k, v]) => ({ name: mesLabel(k), valor: v })), almacenes: top(porAlm, 10), lineas: top(porLinea, 8), productos: top(porProd, 10), tecnicos: top(porTec, 10),
      tabla: [...filasAlm.values()].sort((a, b) => b.armadas - a.armadas),
    };
  }, [reqs, asm, almacen, assemblies]);

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["ALMACÉN", "SOLICITUDES", "ABIERTAS", "CERRADAS", "SIN PQR", "UNIDADES SOLICITADAS", "UNIDADES ARMADAS", "UNIDADES NO ARMADAS", "% CUMPLIMIENTO"],
      ...d.tabla.map((e) => [e.almacen, e.solicitudes, e.abiertas, e.cerradas, e.sinPqr, e.solicitadas, e.armadas, e.noArmadas, pctDe(e.armadas, e.solicitadas) / 100])]), "Por almacén");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["MES", "UNIDADES ARMADAS"], ...d.meses.map((m) => [m.name, m.valor])]), "Por mes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["FECHA", "SOLICITUD", "PQR", "ALMACÉN", "CÓDIGO", "PRODUCTO", "LÍNEA", "CANTIDAD", "CAUSAL", "¿SUMA AL ARMADO?", "TÉCNICO"],
      ...asmTodos.map((a) => { const r = requests.find((x) => x.id === a.request_id) || {}; return [a.assembled_on, r.request_no, r.pqr_number || "", (almacen[r.warehouse_id] || {}).name || "", a.product_code, a.product_name, a.product_line || "", a.quantity, a.cause || "", A.suma(a) ? "Sí" : "No", a.technician_name || ""]; })]), "Detalle de armados");
    XLSX.writeFile(wb, `informe_armados_almacen_${ui.todayISO()}.xlsx`);
  };

  return (
    <div>
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      <div className="amg-card" style={{ padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>Desde <input type="date" className="amg-input" style={{ width: 145 }} value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>hasta <input type="date" className="amg-input" style={{ width: 145 }} value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} /></label>
        <select className="amg-select" style={{ width: 210 }} value={f.almacen} onChange={(e) => setF({ ...f, almacen: e.target.value })}><option value="">Todos los almacenes</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        {session.role !== "cliente" && <select className="amg-select" style={{ width: 190 }} value={f.coord} title="Filtra por los departamentos que tiene a cargo cada coordinador (Maestros → Coordinadores)" onChange={(e) => setF({ ...f, coord: e.target.value })}><option value="">Todos los coordinadores</option>{zona.nombres.map((n) => <option key={n} value={n}>{n}</option>)}<option value={SIN_COORD}>Sin coordinador</option></select>}
        <select className="amg-select" style={{ width: 160 }} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Sin canceladas</option><option>Abierta</option><option>Cerrada</option><option>Cancelada</option></select>
        <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={exportar} disabled={loading}><Download size={14} /> Exportar a Excel</button>
      </div>

      {loading ? <div style={{ color: "var(--text-faint)" }}>Cargando...</div> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px,1fr))", gap: 12, marginBottom: 14 }}>
            <ui.StatCard label="Solicitudes" value={fmt(reqs.length)} sub={`${fmt(d.abiertas)} abiertas · ${fmt(d.cerradas)} cerradas`} accent />
            <ui.StatCard label="Unidades solicitadas" value={fmt(d.solicitadas)} sub="en los PQR" />
            <ui.StatCard label="Unidades armadas" value={fmt(d.armadas)} sub={`${pctDe(d.armadas, d.solicitadas)}% de lo solicitado`} />
            <ui.StatCard label="Legalizadas" value={`${pctDe(d.cerradas, reqs.length)}%`} sub={`${fmt(d.cerradas)} cerradas con PQR`} />
            <ui.StatCard label="Sin PQR" value={fmt(d.sinPqr)} sub="por legalizar" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 12, marginBottom: 14 }}>
            <div className="amg-card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Unidades armadas por mes</div>
              {d.meses.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 12.5, padding: 20, textAlign: "center" }}>Sin datos</div> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={d.meses} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip formatter={(v) => [fmt(v), "Unidades"]} /><Bar dataKey="valor" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <Grafico titulo="Por almacén (top 10)" datos={d.almacenes} ancho={130} />
            <Grafico titulo="Por línea de producto" datos={d.lineas} />
            <Grafico titulo="Productos más armados (top 10)" datos={d.productos} ancho={170} />
            <Grafico titulo="Por técnico (top 10)" datos={d.tecnicos} ancho={130} />
          </div>

          <div className="amg-card" style={{ overflow: "auto" }}>
            <table className="amg-table compact">
              <thead><tr><th>Almacén</th><th>Solicitudes</th><th>Abiertas</th><th>Cerradas</th><th>Sin PQR</th><th>Solicitado</th><th>Armado</th><th>No armado</th><th>Cumplimiento</th></tr></thead>
              <tbody>
                {d.tabla.map((e) => <tr key={e.almacen}><td>{e.almacen}</td><td className="amg-mono">{e.solicitudes}</td><td className="amg-mono">{e.abiertas}</td><td className="amg-mono">{e.cerradas}</td><td className="amg-mono">{e.sinPqr}</td><td className="amg-mono">{fmt(e.solicitadas)}</td><td className="amg-mono">{fmt(e.armadas)}</td><td className="amg-mono">{fmt(e.noArmadas)}</td><td className="amg-mono">{pctDe(e.armadas, e.solicitadas)}%</td></tr>)}
                {d.tabla.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin solicitudes para estos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>Solo cuentan los armados no anulados. "Sin canceladas" es el filtro por defecto. Cumplimiento = unidades armadas ÷ unidades solicitadas.</div>
        </>
      )}
    </div>
  );
}
