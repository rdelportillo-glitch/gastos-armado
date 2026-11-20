import { useState, useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchHistory } from "./lib/asignacion/history";
import { nombreDepartamento } from "./lib/informeJamar";
import { sumarDias } from "./lib/cierreExtreme";
import { hoyLocal } from "./lib/finalizarDia";
import * as D from "./lib/dimensionamiento";
import * as M from "./lib/dimensionamientoMinutos";

/* ============================================================================
   DIMENSIONAMIENTO EN MINUTOS (Reportes)
   Por departamento y en minutos por día: la CARGA (Tiempo Jamar, el mayor entre Jamar y el maestro de Biver), el DIMENSIONAMIENTO (técnicos solicitados del mes × 420)
   y la CAPACIDAD BIVER con sus técnicos activos; y las mismas cifras convertidas a técnicos (minutos ÷ 420). Un día anterior sale del histórico de asignación; hoy, de Carga.
============================================================================ */

const ROJO = "#e0435c", VERDE = "#12a166", NARANJA = "#ff9540";
const COLOR_ESTADO = { "Más carga": ROJO, "En línea": VERDE, "Menos carga": NARANJA, "Sin solicitados": "#7d8799" };
const fmtInt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const fmt1 = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString("es-CO");
const signo = (n, f = fmtInt) => `${n > 0 ? "+" : ""}${f(n)}`;
const dec = (n) => String(Math.round((n || 0) * 10) / 10).replace(".", ",");
const PRESETS = [["hoy", "Hoy"], ["ayer", "Ayer"], ["7", "7 días"], ["30", "30 días"], ["mes", "Este mes"], ["mesAnt", "Mes anterior"]];

export default function ReporteDimensionamientoMinutos({ db, ui }) {
  const hoy = hoyLocal();
  const [from, setFrom] = useState(`${hoy.slice(0, 7)}-01`);
  const [to, setTo] = useState(hoy);
  const [preset, setPreset] = useState("mes");
  const [hist, setHist] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [cancelados, setCancelados] = useState(false);
  const [error, setError] = useState("");

  const aplicarPreset = (p) => {
    setPreset(p);
    const d = (n) => sumarDias(hoy, n);
    if (p === "hoy") { setFrom(hoy); setTo(hoy); } else if (p === "ayer") { setFrom(d(-1)); setTo(d(-1)); } else if (p === "7") { setFrom(d(-6)); setTo(hoy); } else if (p === "30") { setFrom(d(-29)); setTo(hoy); }
    else if (p === "mes") { setFrom(`${hoy.slice(0, 7)}-01`); setTo(hoy); } else if (p === "mesAnt") { const ult = sumarDias(`${hoy.slice(0, 7)}-01`, -1); setFrom(`${ult.slice(0, 7)}-01`); setTo(ult); }
  };
  useEffect(() => { D.cargarCfg().then(setCfg).catch((e) => { setCfg(JSON.parse(JSON.stringify(D.CONFIG_DEFAULT))); setError(e.message); }); }, []);
  useEffect(() => {
    let alive = true;
    setHist(null);
    fetchHistory({ from: from || undefined, to: to && to >= hoy ? sumarDias(hoy, -1) : to || undefined })
      .then((r) => { if (alive) setHist(r); }).catch((e) => { if (alive) { setHist([]); setError(e.message); } });
    return () => { alive = false; };
  }, [from, to]);

  const jornada = (cfg && Number(cfg.jornada)) || 420;
  const mesRef = (to || hoy).slice(0, 7);
  const registros = useMemo(() => (hist ? D.registrosDeCarga({ from, to, history: hist, services: db.services }) : null), [hist, from, to, db.services]);
  const deptos = useMemo(() => (registros && cfg ? D.resumirPorDepto({ registros, cfg, incluirCancelados: cancelados, nombreDepto: nombreDepartamento, mesRef }) : null), [registros, cfg, cancelados, mesRef]);
  const activos = useMemo(() => M.tecnicosActivos(db.technicians, jornada, nombreDepartamento), [db.technicians, jornada]);
  const filas = useMemo(() => (deptos ? M.filasMinutos({ deptos, activos, jornada }) : null), [deptos, activos, jornada]);
  const tot = useMemo(() => (filas ? M.totalMinutos(filas, jornada) : null), [filas, jornada]);
  const nombreMes = (() => { const [a, n] = mesRef.split("-"); return `${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][Number(n) - 1]} ${a}`; })();

  const exportar = () => ui.downloadCSV(`dimensionamiento_minutos_${from}_${to}.csv`,
    ["Departamento", "Días con carga", "Carga Tiempo Jamar (min/día)", "Dimensionamiento solicitado (min/día)", "Capacidad Biver técnicos activos (min/día)", "Carga − dimensionamiento (devolver a Jamar)", "Capacidad Biver − carga (holgura / déficit)", "Dimensionamiento − capacidad Biver",
      "Técnicos necesarios (carga ÷ jornada)", "Técnicos solicitados", "Técnicos activos", "Capacidad Biver en técnicos", "Técnicos a devolver", "Técnicos de holgura / déficit", "Solicitados − activos", "Alerta carga vs dimensionamiento"],
    filas.map((f) => [f.nombre, f.dias, dec(f.carga), f.dim, f.cap, dec(f.devolver), dec(f.holgura), dec(f.faltaActivos), dec(f.necesarios), dec(f.solicitados), f.activos, dec(f.capTecnicos), dec(f.tecDevolver), dec(f.tecHolgura), dec(f.tecFaltan), f.estado]));

  const cargando = !filas || !cfg;
  const th = (txt, tip) => <th title={tip} style={{ whiteSpace: "normal", minWidth: 96 }}>{txt}</th>;

  return (
    <div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, marginRight: 6 }}>Dimensionamiento en minutos</div>
          {PRESETS.map(([k, t]) => <button key={k} className="amg-btn" style={preset === k ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : undefined} onClick={() => aplicarPreset(k)}>{t}</button>)}
          <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => { if (!e.target.value) return; setFrom(e.target.value); setPreset(""); if (to && e.target.value > to) setTo(e.target.value); }} />
          <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => { if (!e.target.value) return; setTo(e.target.value); setPreset(""); if (from && e.target.value < from) setFrom(e.target.value); }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }} title="Por defecto no cuentan los registros cancelados"><input type="checkbox" checked={cancelados} onChange={(e) => setCancelados(e.target.checked)} /> Incluir cancelados</label>
          <button className="amg-btn" disabled={!filas || !filas.length} onClick={exportar}>Exportar CSV</button>
          <span style={{ fontSize: 12.5, color: "var(--text-dim)", marginLeft: "auto" }}>Técnicos solicitados de <b>{nombreMes}</b> · jornada <b>{jornada} min</b> · minutos por día</span>
        </div>
        {error && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> {error}</div>}
      </div>

      {cargando && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Calculando...</div>}

      {!cargando && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: 12, marginBottom: 14 }}>
            <ui.StatCard label="Carga (min/día)" value={fmtInt(tot.carga)} sub={`${fmt1(tot.necesarios)} técnicos necesarios`} />
            <ui.StatCard label="Dimensionamiento (min/día)" value={fmtInt(tot.dim)} sub={`${fmt1(tot.solicitados)} técnicos solicitados`} />
            <ui.StatCard label="Capacidad Biver (min/día)" value={fmtInt(tot.cap)} sub={`${fmtInt(tot.activos)} técnicos activos (${fmt1(tot.capTecnicos)} equiv.)`} />
            <ui.StatCard label="A devolver a Jamar" value={<span style={{ color: tot.devolverBruto > 0 ? ROJO : VERDE }}>{fmtInt(tot.devolverBruto)}</span>} accent sub={`min/día en ${tot.deptosDevolver} departamento(s) con sobrecarga (${fmt1(tot.devolverBruto / jornada)} técnicos)`} />
            <ui.StatCard label="Déficit Biver" value={<span style={{ color: tot.deficitBruto > 0 ? ROJO : VERDE }}>{fmtInt(tot.deficitBruto)}</span>} sub={`min/día en ${tot.deptosDeficit} departamento(s) donde los activos no alcanzan (${fmt1(tot.deficitBruto / jornada)} técnicos)`} />
            </div>

          <div className="amg-card" style={{ overflow: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead>
                <tr><th rowSpan={2} style={{ verticalAlign: "bottom" }}>Departamento</th><th colSpan={6} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>En minutos por día</th><th colSpan={7} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>En técnicos (minutos ÷ {jornada})</th><th rowSpan={2} style={{ verticalAlign: "bottom" }}>Alerta</th></tr>
                <tr>
                  {th("Carga", "Tiempo Jamar promedio por día con carga (el mayor entre Jamar y el maestro de Biver)")}{th("Dimensio-namiento", `Técnicos solicitados en ${nombreMes} × ${jornada}`)}{th("Capacidad Biver", "Capacidad en minutos de los técnicos activos del departamento (ficha de Personal)")}
                  {th("Carga − dimens.", "Positivo: sobrecarga que hay que devolver a Jamar")}{th("Cap. Biver − carga", "Positivo: holgura propia. Negativo: Biver no alcanza con sus técnicos activos")}{th("Dimens. − cap. Biver", "Positivo: lo solicitado supera lo que Biver tiene activo")}
                  {th("Necesarios", "Carga ÷ jornada")}{th("Solicitados", `Técnicos solicitados en ${nombreMes}`)}{th("Activos", "Técnicos activos de campo en Personal")}{th("Cap. Biver equiv.", "Capacidad Biver ÷ jornada")}
                  {th("A devolver", "Carga − dimensionamiento, en técnicos")}{th("Holgura / déficit", "Capacidad Biver − carga, en técnicos")}{th("Solicit. − activos", "Técnicos solicitados menos técnicos activos")}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.key}>
                    <td style={{ fontWeight: 700 }}>{f.nombre}{f.dias ? <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 400 }}>{f.dias} día(s) con carga</div> : null}</td>
                    <td className="amg-mono" style={{ borderLeft: "1px solid var(--border)" }}>{fmtInt(f.carga)}</td><td className="amg-mono">{fmtInt(f.dim)}</td><td className="amg-mono">{fmtInt(f.cap)}</td>
                    <td className="amg-mono" style={{ fontWeight: 700, color: f.devolver > 0 ? ROJO : undefined }}>{signo(f.devolver)}</td>
                    <td className="amg-mono" style={{ fontWeight: 700, color: f.holgura < 0 ? ROJO : VERDE }}>{signo(f.holgura)}</td>
                    <td className="amg-mono">{signo(f.faltaActivos)}</td>
                    <td className="amg-mono" style={{ borderLeft: "1px solid var(--border)" }}>{fmt1(f.necesarios)}</td><td className="amg-mono">{fmt1(f.solicitados)}</td><td className="amg-mono">{fmtInt(f.activos)}</td><td className="amg-mono">{fmt1(f.capTecnicos)}</td>
                    <td className="amg-mono" style={{ fontWeight: 700, color: f.tecDevolver > 0 ? ROJO : undefined }}>{signo(f.tecDevolver, fmt1)}</td>
                    <td className="amg-mono" style={{ fontWeight: 700, color: f.tecHolgura < 0 ? ROJO : VERDE }}>{signo(f.tecHolgura, fmt1)}</td>
                    <td className="amg-mono">{signo(f.tecFaltan, fmt1)}</td>
                    <td><span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 10, fontSize: 11.5, fontWeight: 600, color: "#fff", background: COLOR_ESTADO[f.estado] || "#7d8799", whiteSpace: "nowrap" }}>{f.estado}</span></td>
                  </tr>
                ))}
                {filas.length === 0 && <tr><td colSpan={15} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay datos en este rango.</td></tr>}
                {filas.length > 0 && (
                  <tr style={{ fontWeight: 700 }}>
                    <td>Total</td><td className="amg-mono" style={{ borderLeft: "1px solid var(--border)" }}>{fmtInt(tot.carga)}</td><td className="amg-mono">{fmtInt(tot.dim)}</td><td className="amg-mono">{fmtInt(tot.cap)}</td>
                    <td className="amg-mono" style={{ color: tot.devolver > 0 ? ROJO : undefined }}>{signo(tot.devolver)}</td><td className="amg-mono" style={{ color: tot.holgura < 0 ? ROJO : VERDE }}>{signo(tot.holgura)}</td><td className="amg-mono">{signo(tot.faltaActivos)}</td>
                    <td className="amg-mono" style={{ borderLeft: "1px solid var(--border)" }}>{fmt1(tot.necesarios)}</td><td className="amg-mono">{fmt1(tot.solicitados)}</td><td className="amg-mono">{fmtInt(tot.activos)}</td><td className="amg-mono">{fmt1(tot.capTecnicos)}</td>
                    <td className="amg-mono" style={{ color: tot.tecDevolver > 0 ? ROJO : undefined }}>{signo(tot.tecDevolver, fmt1)}</td><td className="amg-mono" style={{ color: tot.tecHolgura < 0 ? ROJO : VERDE }}>{signo(tot.tecHolgura, fmt1)}</td><td className="amg-mono">{signo(tot.tecFaltan, fmt1)}</td><td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.55 }}>
            <b>Carga</b>: Tiempo Jamar promedio por día con carga (por registro, el mayor entre el tiempo de Jamar y el del maestro de Biver); un día anterior sale del histórico de asignación y hoy de Carga. <b>Dimensionamiento</b>: técnicos que nos pidieron en {nombreMes} × {jornada} min.
            <b> Capacidad Biver</b>: suma de la capacidad en minutos (Personal; si no tiene, {jornada}) de los técnicos <b>activos hoy</b> de cada departamento (técnicos de campo junior o senior): es la plantilla actual, no la de cada día del rango. <b>Carga − dimensionamiento</b> positivo = sobrecarga a devolver a Jamar;
            <b> capacidad Biver − carga</b> negativo = Biver no alcanza con sus activos. En técnicos = minutos ÷ {jornada}. Los totales de las diferencias de la tabla son netos; las tarjetas "A devolver a Jamar" y "Déficit Biver" suman solo los departamentos con sobrecarga o con déficit (la holgura de un departamento no cubre el de otro). Un departamento sin técnicos solicitados en el mes muestra dimensionamiento 0. El departamento de la carga es el del servicio; el de los técnicos, el de su ficha en Personal.
          </div>
        </>
      )}
    </div>
  );
}
