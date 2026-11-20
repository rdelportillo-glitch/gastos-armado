import { useState, useEffect, useMemo } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { nombreDepartamento } from "./lib/informeJamar";
import * as D from "./lib/dimensionamiento";
import * as S from "./lib/sobrecarga";

/* ============================================================================
   SOBRECARGA DE LA ASIGNACIÓN (paso 1 y paso 3 de Asignación)
   Compara la carga de la fecha (Tiempo Jamar = el mayor entre el tiempo de Jamar y el del maestro de Biver) con los técnicos que nos pidieron en el mes × 420 min,
   por departamento, y dice cuántos minutos hay que devolver a Jamar por sobrecarga. En el paso 3 también descuenta lo ya marcado como devuelto por SOBRECARGA.
============================================================================ */

const COLOR = { "Más carga": "#e0435c", "En línea": "#12a166", "Menos carga": "#ff9540", "Sin solicitados": "#7d8799" };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString("es-CO");

export default function SobrecargaAsignacion({ items, fecha, ui, conPlan = false }) {
  const [cfg, setCfg] = useState(null);
  const [abierto, setAbierto] = useState(true);
  useEffect(() => { D.cargarCfg().then(setCfg).catch(() => setCfg(JSON.parse(JSON.stringify(D.CONFIG_DEFAULT)))); }, []);
  const r = useMemo(() => (cfg ? S.resumenSobrecarga({ items, cfg, fecha, nombreDepto: nombreDepartamento }) : null), [items, cfg, fecha]);
  if (!r || r.filas.length === 0) return null;
  const t = r.total;
  const hayCero = r.filas.some((f) => f.sinSolicitados);

  const exportarResumen = () => ui.downloadCSV(`sobrecarga_asignacion_${fecha}.csv`,
    ["Departamento", "Servicios", "Carga Tiempo Jamar (min)", "Técnicos necesarios", "Técnicos solicitados", "Capacidad (min)", "Minutos a devolver a Jamar", "Técnicos equivalentes a devolver", ...(conPlan ? ["Ya marcado SOBRECARGA (min)", "Falta devolver (min)"] : []), "Alerta"],
    r.filas.map((f) => [f.nombre, f.servicios, Math.round(f.carga), String(f.necesarios).replace(".", ","), f.solicitados, Math.round(f.capacidad), Math.round(f.devolver), String(f.tecnicosDevolver).replace(".", ","), ...(conPlan ? [Math.round(f.devuelto), Math.round(f.falta)] : []), f.estado]));
  const exportarDetalle = () => ui.downloadCSV(`sobrecarga_asignacion_detalle_${fecha}.csv`, ["Departamento", "Servicio", "Ciudad", "Tiempo Jamar (min)", "Prioridad 1", ...(conPlan ? ["Marcado SOBRECARGA"] : []), "Minutos a devolver del departamento"],
    r.filas.filter((f) => f.devolver > 0).flatMap((f) => [...f.items].sort((a, b) => Number(a.prio) - Number(b.prio) || b.jamar - a.jamar).map((x) => [f.nombre, x.servicio, x.ciudad, Math.round(x.jamar), x.prio ? "Sí" : "No", ...(conPlan ? [x.devuelto ? "Sí" : "No"] : []), Math.round(f.devolver)])));

  return (
    <div className="amg-card" style={{ padding: 14, marginBottom: 14, borderLeft: `5px solid ${t.devolver > 0 ? COLOR["Más carga"] : COLOR["En línea"]}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", cursor: "pointer" }} onClick={() => setAbierto(!abierto)}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{abierto ? "▾" : "▸"} Sobrecarga frente a los técnicos solicitados · {ui.fmtDate(fecha)}</div>
        {t.devolver > 0
          ? <span style={{ color: COLOR["Más carga"], fontWeight: 700, fontSize: 13 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> Devolver a Jamar: {fmtInt(t.devolver)} min ({fmt1(t.tecnicosDevolver)} técnicos) en {t.conSobrecarga} departamento(s){conPlan ? ` · ya marcado SOBRECARGA ${fmtInt(t.devuelto)} min · falta ${fmtInt(t.falta)} min` : ""}</span>
          : <span style={{ color: COLOR["En línea"], fontWeight: 700, fontSize: 13 }}>Sin sobrecarga: la carga cabe en los técnicos solicitados</span>}
      </div>
      {abierto && (
        <>
          <div style={{ fontSize: 12, color: "var(--text-dim)", margin: "6px 0 8px", lineHeight: 1.5 }}>
            Carga = Tiempo Jamar de los servicios que entran a esta asignación (por registro, el mayor entre Jamar y el maestro de Biver). Capacidad = técnicos solicitados de {r.mes} × {r.jornada} min. <b>Minutos a devolver = carga − capacidad</b> (departamentos que pasan de su capacidad).
            {conPlan ? " Lo que dejes sin asignar con el motivo SOBRECARGA se descuenta y queda lo que falta por devolver." : ""}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Departamento</th><th>Servicios</th><th title="Tiempo Jamar de lo que entra a la asignación">Carga (min)</th><th title="Carga ÷ jornada">Técnicos necesarios</th><th title={`Técnicos que nos pidieron en ${r.mes}`}>Solicitados</th><th title="Solicitados × jornada">Capacidad (min)</th>
                <th title="Carga − capacidad (solo si es positivo)">Devolver a Jamar (min)</th><th title="Minutos a devolver ÷ jornada">Equiv. técnicos</th>{conPlan && <><th title="Servicios sin asignar con el motivo SOBRECARGA">Ya marcado SOBRECARGA</th><th>Falta devolver</th></>}<th>Alerta</th></tr></thead>
              <tbody>
                {r.filas.map((f) => (
                  <tr key={f.key}>
                    <td style={{ fontWeight: 700 }}>{f.nombre}</td><td className="amg-mono">{fmtInt(f.servicios)}</td><td className="amg-mono">{fmtInt(f.carga)}</td><td className="amg-mono">{fmt1(f.necesarios)}</td>
                    <td className="amg-mono">{f.sinSolicitados ? "–" : fmtInt(f.solicitados)}</td><td className="amg-mono">{f.sinSolicitados ? "–" : fmtInt(f.capacidad)}</td>
                    <td className="amg-mono" style={{ fontWeight: 700, color: f.devolver > 0 ? COLOR["Más carga"] : undefined }}>{f.devolver > 0 ? fmtInt(f.devolver) : "0"}</td><td className="amg-mono">{f.devolver > 0 ? fmt1(f.tecnicosDevolver) : "–"}</td>
                    {conPlan && <><td className="amg-mono">{f.devuelto > 0 ? fmtInt(f.devuelto) : "–"}</td><td className="amg-mono" style={{ fontWeight: 700, color: f.falta > 0 ? COLOR["Más carga"] : f.devolver > 0 ? COLOR["En línea"] : undefined }}>{f.devolver > 0 ? fmtInt(f.falta) : "–"}</td></>}
                    <td><span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, color: "#fff", background: COLOR[f.estado] || "#7d8799", whiteSpace: "nowrap" }}>{f.estado}</span></td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}><td>Total</td><td /><td className="amg-mono">{fmtInt(t.carga)}</td><td className="amg-mono">{fmt1(t.carga / r.jornada)}</td><td className="amg-mono">{fmtInt(t.solicitados)}</td><td className="amg-mono">{fmtInt(t.capacidad)}</td>
                  <td className="amg-mono" style={{ color: t.devolver > 0 ? COLOR["Más carga"] : undefined }}>{fmtInt(t.devolver)}</td><td className="amg-mono">{t.devolver > 0 ? fmt1(t.tecnicosDevolver) : "–"}</td>{conPlan && <><td className="amg-mono">{fmtInt(t.devuelto)}</td><td className="amg-mono">{t.devolver > 0 ? fmtInt(t.falta) : "–"}</td></>}<td /></tr>
              </tbody>
            </table>
          </div>
          {hayCero && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>Un departamento sin técnicos solicitados en {r.mes} se muestra sin capacidad y no genera minutos a devolver; revisa Reportes → Dimensionamiento → Técnicos solicitados.</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="amg-btn" onClick={exportarResumen}><Download size={14} /> Exportar resumen</button>
            <button className="amg-btn" disabled={t.devolver <= 0} title="Los servicios de los departamentos con sobrecarga, para decidir cuáles devolver (los de prioridad normal primero)" onClick={exportarDetalle}><Download size={14} /> Exportar detalle de servicios</button>
          </div>
        </>
      )}
    </div>
  );
}
