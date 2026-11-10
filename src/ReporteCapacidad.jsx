import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";
import * as D from "./lib/asignacion/data";
import { loadRegionInfo } from "./lib/asignacion/history";
import { useZonaCoord } from "./lib/useCoordinadores";
import { calcularCapacidad } from "./lib/capacidad";

/* ============================================================================
   CAPACIDAD INSTALADA POR DEPARTAMENTO (Reportes)
   Técnicos de campo activos, inactivos y total, y sus minutos: la capacidad instalada (todos los activos) y la disponible (los que ese día pueden salir a ruta).
   La disponibilidad del día es la de Asignación → paso 2 (sede, almacén, descanso, vacaciones, permisos con minutos...); si ese día no se ha registrado nada, cuenta lo de Personal.
============================================================================ */

const sumarDias = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmt = (n) => Math.round(n || 0).toLocaleString("es-CO");
const horas = (min) => (Math.round(((min || 0) / 60) * 10) / 10).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (p) => `${(Math.round((p || 0) * 10) / 10).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const tec1 = (n) => (Math.round((n || 0) * 10) / 10).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const tec2 = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const TIP = { background: "#fff", border: "1px solid #e2e7f1", borderRadius: 8, fontSize: 12 };

export default function ReporteCapacidad({ db, ui }) {
  const hoy = ui.todayISO();
  const [fecha, setFecha] = useState(hoy);
  const [incluirRetirados, setIncluirRetirados] = useState(false);
  const [perfil, setPerfil] = useState("");
  const [base, setBase] = useState(420); // minutos de un técnico para la Capacidad Jamar (se calcula sobre esto y no sobre la capacidad de cada técnico)
  const baseEf = Number(base) > 0 ? Number(base) : 420;
  const [coord, setCoord] = useState("");
  const [avail, setAvail] = useState({});
  const [regionInfo, setRegionInfo] = useState(null);
  const [error, setError] = useState("");
  const [abiertos, setAbiertos] = useState(() => new Set());
  const [vista, setVista] = useState("depto"); // depto | tecnico
  const [busca, setBusca] = useState("");
  const zona = useZonaCoord(db);

  useEffect(() => { loadRegionInfo().then(setRegionInfo).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    setError("");
    D.loadAvailability(fecha).then((a) => { if (alive) setAvail(a); }).catch((e) => { if (alive) { setAvail({}); setError(`No se pudo leer la disponibilidad del día: ${e.message}. Se usa lo de Personal.`); } });
    return () => { alive = false; };
  }, [fecha]);

  // Disponibilidad del día en el formato del motor (sede/almacén de Personal, estado del día y minutos de novedad).
  const engine = useMemo(() => new Map(D.engineTechs(db.technicians, avail, [], null).map((t) => [t.id, t])), [db.technicians, avail]);
  const R = useMemo(() => calcularCapacidad({
    technicians: db.technicians, engine, incluirRetirados, perfil,
    coordDe: (d) => zona.coordDe(d), regionDe: (d) => (regionInfo ? regionInfo.byDept[plano(d)] ?? null : null),
  }), [db.technicians, engine, incluirRetirados, perfil, zona.nombres, regionInfo]);

  const coords = useMemo(() => [...new Set(R.filas.map((f) => f.coord).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [R]);
  const filas = coord ? R.filas.filter((f) => f.coord === coord) : R.filas;
  const T = useMemo(() => {
    const s = (k) => filas.reduce((a, f) => a + f[k], 0);
    const t = { activos: s("activos"), inactivos: s("inactivos"), total: s("total"), maestros: s("maestros"), aprendices: s("aprendices"), disponibles: s("disponibles"), noDisponibles: s("noDisponibles"), capInstalada: s("capInstalada"), capDisponible: s("capDisponible") };
    t.pctDisponible = t.capInstalada ? (t.capDisponible / t.capInstalada) * 100 : 0; t.promDisponible = t.disponibles ? t.capDisponible / t.disponibles : 0;
    return t;
  }, [filas]);
  const alternar = (k) => setAbiertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const label = (f) => (f.region !== null && f.region !== undefined && regionInfo ? regionInfo.label(f.region) : "-");

  // Vista por técnico: una fila por persona (con los mismos filtros). La Capacidad Jamar FIJA es la capacidad de Personal de cada técnico ACTIVO ÷ los minutos por técnico de Jamar:
  // no cambia con el día ni con la disponibilidad (a diferencia de la Capacidad Jamar del día, que sale de la capacidad disponible).
  const tecnicosFilas = useMemo(() => {
    const q = plano(busca);
    return filas.flatMap((f) => f.tecnicos.map((t) => ({ ...t, depto: f.depto, region: label(f), coord: f.coord })))
      .filter((t) => !q || plano(t.nombre).includes(q));
  }, [filas, busca, regionInfo]);
  const jamarFija = (t) => (t.statusPersonal === "Activo" ? t.cap / baseEf : 0);
  const TT = useMemo(() => {
    const act = tecnicosFilas.filter((t) => t.statusPersonal === "Activo");
    return { n: tecnicosFilas.length, activos: act.length, cap: act.reduce((s, t) => s + t.cap, 0), capDisp: act.reduce((s, t) => s + t.capEff, 0), fija: act.reduce((s, t) => s + t.cap, 0) / baseEf, dia: act.reduce((s, t) => s + t.capEff, 0) / baseEf };
  }, [tecnicosFilas, baseEf]);

  const exportar = () => (vista === "tecnico"
    ? ui.downloadCSV(`capacidad_por_tecnico_${fecha}.csv`,
      ["Técnico", "Departamento", "Región", "Coordinador", "Perfil", "Estado en Personal", "Estado ese día", "Capacidad (min)", "Novedad (min)", "Capacidad disponible (min)", `Capacidad Jamar fija (técnicos sobre ${baseEf} min)`, `Capacidad Jamar del día (técnicos sobre ${baseEf} min)`],
      [...tecnicosFilas.map((t) => { const act = t.statusPersonal === "Activo"; return [t.nombre, t.depto, t.region, t.coord, t.perfil, t.statusPersonal, act ? t.estado : "", act ? t.cap : 0, act ? t.nov : "", act ? t.capEff : "", tec2(jamarFija(t)), act ? tec2(t.capEff / baseEf) : tec2(0)]; }),
        ["TOTAL", "", "", "", "", `${TT.activos} activos de ${TT.n}`, "", TT.cap, "", TT.capDisp, tec2(TT.fija), tec2(TT.dia)]])
    : ui.downloadCSV(`capacidad_instalada_${fecha}.csv`,
      ["Departamento", "Región", "Coordinador", "Técnicos activos", "Inactivos", "Total", "Maestros activos", "Aprendices activos", "Disponibles ese día", "No disponibles", "Capacidad instalada (min)", "Capacidad disponible (min)", "Capacidad disponible (horas)", "% disponible", "Promedio min por técnico disponible", `Capacidad Jamar (técnicos sobre ${baseEf} min)`, `Capacidad Jamar fija (técnicos activos sobre ${baseEf} min)`],
      [...filas.map((f) => [f.depto, label(f), f.coord, f.activos, f.inactivos, f.total, f.maestros, f.aprendices, f.disponibles, f.noDisponibles, f.capInstalada, f.capDisponible, horas(f.capDisponible), pct(f.pctDisponible), Math.round(f.promDisponible), tec1(f.capDisponible / baseEf), tec1(f.capInstalada / baseEf)]),
        ["TOTAL", "", "", T.activos, T.inactivos, T.total, T.maestros, T.aprendices, T.disponibles, T.noDisponibles, T.capInstalada, T.capDisponible, horas(T.capDisponible), pct(T.pctDisponible), Math.round(T.promDisponible), tec1(T.capDisponible / baseEf), tec1(T.capInstalada / baseEf)]]));

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 600, marginRight: 4 }}>Capacidad instalada</div>
          <div style={{ display: "flex", gap: 4 }}>
            <button className={`amg-btn ${vista === "depto" ? "primary" : ""}`} onClick={() => setVista("depto")}>Por departamento</button>
            <button className={`amg-btn ${vista === "tecnico" ? "primary" : ""}`} onClick={() => setVista("tecnico")}>Por técnico</button>
          </div>
          {vista === "tecnico" && <input className="amg-input" style={{ width: 170 }} placeholder="Buscar técnico..." value={busca} onChange={(e) => setBusca(e.target.value)} />}
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>Disponibilidad del día <input type="date" className="amg-input" style={{ width: 150 }} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} /></label>
          <button className="amg-btn" onClick={() => setFecha(hoy)}>Hoy</button>
          <button className="amg-btn" onClick={() => setFecha(sumarDias(hoy, 1))}>Mañana</button>
          <select className="amg-select" style={{ width: 150 }} value={perfil} onChange={(e) => setPerfil(e.target.value)}><option value="">Todos los perfiles</option><option value="Maestro">Maestros</option><option value="Aprendiz">Aprendices</option></select>
          {coords.length > 0 && <select className="amg-select" style={{ width: 180 }} value={coord} onChange={(e) => setCoord(e.target.value)}><option value="">Todos los coordinadores</option>{coords.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }} title="Con esto se calcula la Capacidad Jamar: capacidad disponible ÷ estos minutos = cantidad de técnicos">Minutos por técnico (Jamar) <input type="number" min="1" className="amg-input" style={{ width: 80 }} value={base} onChange={(e) => setBase(e.target.value)} /></label>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={incluirRetirados} onChange={(e) => setIncluirRetirados(e.target.checked)} /> Contar los retirados como inactivos</label>
          <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!filas.length} onClick={exportar}>Exportar CSV</button>
        </div>
        {error && <div className="amg-alert danger" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 12, marginBottom: 12 }}>
        <ui.StatCard label="Técnicos activos" value={fmt(T.activos)} accent sub={`${fmt(T.inactivos)} inactivos · ${fmt(T.total)} en total`} />
        <ui.StatCard label="Disponibles ese día" value={fmt(T.disponibles)} sub={`${fmt(T.noDisponibles)} no disponibles`} />
        <ui.StatCard label="Capacidad instalada" value={`${fmt(T.capInstalada)} min`} sub={`${horas(T.capInstalada)} horas`} />
        <ui.StatCard label="Capacidad disponible" value={`${fmt(T.capDisponible)} min`} sub={`${horas(T.capDisponible)} horas · ${pct(T.pctDisponible)} de la instalada`} accent />
        <ui.StatCard label="Promedio por técnico disponible" value={`${fmt(T.promDisponible)} min`} />
        <ui.StatCard label="Capacidad Jamar" value={`${tec1(T.capDisponible / baseEf)} técnicos`} accent sub={`capacidad disponible ÷ ${baseEf} min`} />
        <ui.StatCard label="Capacidad Jamar fija" value={`${tec1(T.capInstalada / baseEf)} técnicos`} accent sub={`capacidad instalada de los ${fmt(T.activos)} activos ÷ ${baseEf} min (no cambia con la disponibilidad)`} />
      </div>

      {vista === "tecnico" && (
        <>
          <div className="amg-card" style={{ overflowX: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Técnico</th><th>Departamento</th><th>Región</th><th>Coordinador</th><th>Perfil</th><th>Estado en Personal</th><th>Estado ese día</th><th>Capacidad (min)</th><th>Novedad (min)</th><th>Disponible (min)</th><th title={`Capacidad del técnico activo ÷ ${baseEf} min. No cambia con el día ni con la disponibilidad.`}>Capacidad Jamar fija (técnicos)</th><th title={`Capacidad disponible ese día ÷ ${baseEf} min`}>Capacidad Jamar del día (técnicos)</th></tr></thead>
              <tbody>
                {tecnicosFilas.map((t) => {
                  const act = t.statusPersonal === "Activo";
                  return (
                    <tr key={t.id} style={{ opacity: act ? 1 : 0.55 }}>
                      <td style={{ fontWeight: 600 }}>{t.nombre}</td><td>{t.depto}</td><td>{t.region}</td><td>{t.coord || "-"}</td><td>{t.perfil}</td><td>{t.statusPersonal}</td>
                      <td style={{ color: !act ? undefined : t.disponible ? "var(--green)" : "var(--red)" }}>{act ? t.estado : "-"}</td>
                      <td className="amg-mono">{fmt(t.cap)}</td><td className="amg-mono">{act && t.nov ? fmt(t.nov) : "-"}</td><td className="amg-mono">{act ? fmt(t.capEff) : "-"}</td>
                      <td className="amg-mono" style={{ fontWeight: 700 }}>{act ? tec2(jamarFija(t)) : "-"}</td><td className="amg-mono">{act ? tec2(t.capEff / baseEf) : "-"}</td>
                    </tr>
                  );
                })}
                {tecnicosFilas.length === 0 && <tr><td colSpan={12} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay técnicos con esos filtros.</td></tr>}
                {tecnicosFilas.length > 0 && (
                  <tr style={{ fontWeight: 700, background: "var(--panel-2)" }}>
                    <td>TOTAL</td><td colSpan={5}>{TT.activos} activos de {TT.n} técnicos</td><td></td><td className="amg-mono">{fmt(TT.cap)}</td><td></td><td className="amg-mono">{fmt(TT.capDisp)}</td><td className="amg-mono">{tec2(TT.fija)}</td><td className="amg-mono">{tec2(TT.dia)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
            Una fila por técnico de campo (junior y senior), con los filtros de arriba. <b>Capacidad Jamar fija</b> = la capacidad en minutos de la ficha de Personal de cada técnico <b>activo</b> ÷ los minutos por técnico de Jamar ({baseEf}): es fija, no cambia con el día ni con la disponibilidad, y los inactivos no cuentan. La <b>Capacidad Jamar del día</b> sí parte de la capacidad disponible de la fecha elegida (descuenta sede, almacén y novedades). El CSV descarga esta misma vista.
          </div>
        </>
      )}

      {vista === "depto" && filas.length > 0 && (
        <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Minutos por departamento: instalada y disponible</div>
          <ResponsiveContainer width="100%" height={Math.max(220, filas.length * 34 + 60)}>
            <BarChart data={filas.map((f) => ({ d: f.depto, "Capacidad instalada": f.capInstalada, "Capacidad disponible": f.capDisponible }))} layout="vertical" margin={{ left: 20, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e7f1" /><XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} /><YAxis type="category" dataKey="d" width={120} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `${fmt(v)} min`} contentStyle={TIP} /><Legend />
              <Bar dataKey="Capacidad instalada" fill="#4C7EC9" radius={[0, 3, 3, 0]} /><Bar dataKey="Capacidad disponible" fill="#12a166" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {vista === "depto" && (<>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table compact" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Departamento</th><th>Región</th><th>Coordinador</th><th>Activos</th><th>Inactivos</th><th>Total</th><th>Maestros</th><th>Aprendices</th><th>Disponibles</th><th>No disp.</th><th>Capacidad instalada (min)</th><th>Capacidad disponible (min)</th><th>Horas disp.</th><th>% disp.</th><th>Prom. min/técnico</th><th title="Capacidad disponible ÷ minutos por técnico de Jamar: cantidad de técnicos equivalentes">Capacidad Jamar (técnicos)</th><th title={`Capacidad instalada de los técnicos activos ÷ ${baseEf} min. Fija: no cambia con la disponibilidad del día.`}>Capacidad Jamar fija (técnicos)</th></tr></thead>
          <tbody>
            {filas.map((f) => {
              const k = plano(f.depto), abierto = abiertos.has(k);
              return [
                <tr key={k}>
                  <td><button className="amg-btn ghost" style={{ padding: 0, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }} onClick={() => alternar(k)}>{abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{f.depto}</button></td>
                  <td>{label(f)}</td><td>{f.coord || "-"}</td>
                  <td className="amg-mono" style={{ fontWeight: 700 }}>{f.activos}</td><td className="amg-mono">{f.inactivos}</td><td className="amg-mono">{f.total}</td><td className="amg-mono">{f.maestros}</td><td className="amg-mono">{f.aprendices}</td>
                  <td className="amg-mono" style={{ color: "var(--green)" }}>{f.disponibles}</td><td className="amg-mono" style={{ color: f.noDisponibles ? "var(--red)" : undefined }} title={`${f.enSede} en sede o almacén · ${f.conNovedad} con novedad`}>{f.noDisponibles}</td>
                  <td className="amg-mono">{fmt(f.capInstalada)}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{fmt(f.capDisponible)}</td><td className="amg-mono">{horas(f.capDisponible)}</td><td className="amg-mono">{pct(f.pctDisponible)}</td><td className="amg-mono">{fmt(f.promDisponible)}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{tec1(f.capDisponible / baseEf)}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{tec1(f.capInstalada / baseEf)}</td>
                </tr>,
                abierto && (
                  <tr key={`${k}|d`}><td colSpan={17} style={{ padding: 0 }}>
                    <div style={{ background: "var(--panel-2)", padding: 8, overflowX: "auto" }}>
                      <table className="amg-table compact" style={{ fontSize: 12 }}>
                        <thead><tr><th>Técnico</th><th>Perfil</th><th>Estado en Personal</th><th>Estado ese día</th><th>Capacidad (min)</th><th>Novedad (min)</th><th>Disponible (min)</th></tr></thead>
                        <tbody>{f.tecnicos.map((t) => (
                          <tr key={t.id} style={{ opacity: t.statusPersonal === "Activo" ? 1 : 0.55 }}>
                            <td>{t.nombre}</td><td>{t.perfil}</td><td>{t.statusPersonal}</td><td style={{ color: t.statusPersonal !== "Activo" ? undefined : t.disponible ? "var(--green)" : "var(--red)" }}>{t.statusPersonal === "Activo" ? t.estado : "-"}</td>
                            <td className="amg-mono">{fmt(t.cap)}</td><td className="amg-mono">{t.nov ? fmt(t.nov) : "-"}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{t.statusPersonal === "Activo" ? fmt(t.capEff) : "-"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </td></tr>
                ),
              ];
            })}
            {filas.length === 0 && <tr><td colSpan={17} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>No hay técnicos de campo con esos filtros.</td></tr>}
            {filas.length > 0 && (
              <tr style={{ fontWeight: 700, background: "var(--panel-2)" }}>
                <td>TOTAL</td><td></td><td></td><td className="amg-mono">{T.activos}</td><td className="amg-mono">{T.inactivos}</td><td className="amg-mono">{T.total}</td><td className="amg-mono">{T.maestros}</td><td className="amg-mono">{T.aprendices}</td>
                <td className="amg-mono">{T.disponibles}</td><td className="amg-mono">{T.noDisponibles}</td><td className="amg-mono">{fmt(T.capInstalada)}</td><td className="amg-mono">{fmt(T.capDisponible)}</td><td className="amg-mono">{horas(T.capDisponible)}</td><td className="amg-mono">{pct(T.pctDisponible)}</td><td className="amg-mono">{fmt(T.promDisponible)}</td><td className="amg-mono">{tec1(T.capDisponible / baseEf)}</td><td className="amg-mono">{tec1(T.capInstalada / baseEf)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
        Solo técnicos de campo (junior y senior); no incluye administrativos. <b>Activos / Inactivos / Total</b> salen del estado en Personal. <b>Capacidad instalada</b> = minutos de todos los activos. <b>Disponibles</b> = activos que ese día pueden salir a ruta (no están en sede o almacén ni con una novedad que los saque, según Asignación → paso 2); su <b>capacidad disponible</b> descuenta los minutos de novedad. <b>Capacidad Jamar</b> = capacidad disponible ÷ los minutos por técnico de Jamar (por defecto 420, no la capacidad de cada técnico): es la cantidad de técnicos equivalentes. <b>Capacidad Jamar fija</b> = capacidad instalada de los técnicos <b>activos</b> ÷ esos mismos minutos: no depende de la disponibilidad del día. Pulsa un departamento para ver sus técnicos, o usa «Por técnico» para verlos uno por uno.
      </div>
      </>)}
    </div>
  );
}
