import { useState, useEffect, useMemo } from "react";
import { cargarDesempeno } from "./lib/desempeno";
import { COLOR_SEMAFORO } from "./lib/tecnicoIntegral";

/* ============================================================================
   MI DESEMPEÑO (usuario técnico)
   Los indicadores del reporte Técnico integral del propio técnico, su posición en su departamento y a nivel nacional, y el detalle de sus quejas, cierres fuera de horario,
   garantías y monitoreos por debajo del objetivo. Muestra por defecto el mes actual. Lo que ve lo publica el administrador u operador desde el reporte (sql/78): cada técnico
   lee solo su fila y del ranking solo ve su posición, no datos de otros técnicos. El administrador puede elegir un técnico para ver lo mismo que él ve.
============================================================================ */

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const nombreMes = (p) => (p ? `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}` : "");
const fechaCorta = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : "–");
const fmtPct = (v, d = 1) => (v === null || v === undefined || !isFinite(v) ? "–" : `${Number(v).toFixed(d).replace(".", ",")}%`);
const bonito = (s) => String(s || "").replace(/_/g, " ");
const APLICA = { si: ["Aplica", "red"], no: ["No aplica", "green"], revisar: ["En revisión", "amber"] };

export default function MiDesempeno({ db, session, ui }) {
  const esTecnico = session.role === "tecnico";
  const hoyMes = ui.todayISO().slice(0, 7);
  const [tecAdmin, setTecAdmin] = useState(""); // solo administrador: técnico cuyo desempeño se quiere ver
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState("");
  const [periodo, setPeriodo] = useState("");

  const tecId = esTecnico ? session.technicianId : tecAdmin;
  useEffect(() => {
    if (!esTecnico && !tecAdmin) { setFilas([]); return undefined; }
    let alive = true;
    setFilas(null); setError("");
    cargarDesempeno(esTecnico ? {} : { technicianId: tecAdmin })
      .then((r) => { if (alive) setFilas(r); })
      .catch((e) => { if (alive) { setFilas([]); setError(`${e.message}. Si es la primera vez, falta correr el SQL de «Mi desempeño» (sql/78) en Supabase.`); } });
    return () => { alive = false; };
  }, [esTecnico, tecAdmin]);

  const periodos = useMemo(() => (filas || []).map((f) => f.periodo), [filas]);
  // Mes elegido: el actual por defecto; si todavía no se ha publicado, el más reciente que sí.
  const periodoVer = periodo && periodos.includes(periodo) ? periodo : periodos.includes(hoyMes) ? hoyMes : periodos[0] || "";
  const d = (filas || []).find((f) => f.periodo === periodoVer) || null;
  const tecnicosAdmin = useMemo(() => (db.technicians || []).filter((t) => t.category !== "Administrativo").sort((a, b) => a.name.localeCompare(b.name, "es")), [db.technicians]);
  const nombre = esTecnico ? session.name : ((db.technicians || []).find((t) => t.id === tecAdmin) || {}).name;

  const posTxt = (pos, total, donde) => (pos ? <span><b className="amg-mono" style={{ fontSize: 15 }}>#{pos}</b> de {total} {donde}</span> : <span style={{ color: "var(--text-faint)" }}>sin posición (sin dato)</span>);
  const Tabla = ({ titulo, sub, cols, filas: fs, vacio, fila }) => (
    <div className="amg-card" style={{ overflow: "auto", maxHeight: 380 }}>
      <div style={{ padding: "10px 12px 0", fontWeight: 600, fontSize: 13 }}>{titulo} ({fs.length})</div>
      {sub && <div style={{ padding: "2px 12px 6px", fontSize: 11.5, color: "var(--text-faint)" }}>{sub}</div>}
      <table className="amg-table compact" style={{ fontSize: 12.5 }}>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{fs.map(fila)}{fs.length === 0 && <tr><td colSpan={cols.length} style={{ textAlign: "center", color: "var(--text-faint)", padding: 14 }}>{vacio}</td></tr>}</tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="amg-card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Mi desempeño{nombre ? ` · ${bonito(nombre)}` : ""}</div>
          {d && <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{d.departamento || "Sin departamento"} · {nombreMes(d.periodo)} · datos del {fechaCorta(d.desde)} al {fechaCorta(d.hasta)} · actualizado el {new Date(d.publicado_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</div>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {!esTecnico && (
            <select className="amg-select" style={{ width: 260 }} value={tecAdmin} onChange={(e) => { setTecAdmin(e.target.value); setPeriodo(""); }}>
              <option value="">Ver el desempeño de...</option>{tecnicosAdmin.map((t) => <option key={t.id} value={t.id}>{bonito(t.name)} · {t.department || "sin depto"}</option>)}
            </select>
          )}
          {periodos.length > 0 && (
            <select className="amg-select" style={{ width: 170 }} value={periodoVer} onChange={(e) => setPeriodo(e.target.value)}>
              {periodos.map((p) => <option key={p} value={p}>{nombreMes(p)}{p === hoyMes ? " (actual)" : ""}</option>)}
            </select>
          )}
        </div>
      </div>

      {esTecnico && !session.technicianId && <div className="amg-alert warn"><span>Tu usuario no está enlazado a una ficha de Personal, por eso no se puede mostrar tu desempeño. Avisa al administrador.</span></div>}
      {error && <div className="amg-alert danger">{error}</div>}
      {filas === null && <div className="amg-card" style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>Cargando...</div>}
      {filas !== null && !error && !d && (esTecnico ? !!session.technicianId : !!tecAdmin) && (
        <div className="amg-card" style={{ padding: 24, textAlign: "center", color: "var(--text-dim)" }}>
          Todavía no hay información publicada de {nombreMes(hoyMes)}. Aparecerá aquí cuando la administración la publique; mientras tanto puedes ver los meses anteriores si hay.
        </div>
      )}
      {!esTecnico && !tecAdmin && <div className="amg-card" style={{ padding: 24, textAlign: "center", color: "var(--text-dim)" }}>Elige un técnico para ver lo mismo que él ve en «Mi desempeño».</div>}

      {d && (
        <>
          {periodoVer !== hoyMes && <div className="amg-alert warn" style={{ marginBottom: 10 }}><span>Todavía no hay información publicada de {nombreMes(hoyMes)}; estás viendo {nombreMes(periodoVer)}.</span></div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 14 }}>
            <div className="amg-card" style={{ padding: "14px 16px", borderTop: "4px solid var(--accent)" }}>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Puntaje general</div>
              <div style={{ fontSize: 34, fontWeight: 700 }} className="amg-mono">{d.puntaje === null ? "–" : Math.round(Number(d.puntaje))}<span style={{ fontSize: 14, color: "var(--text-faint)", fontWeight: 400 }}> / 100</span></div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>100 = en la meta de todos tus indicadores</div>
            </div>
            <div className="amg-card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Tu posición en {d.departamento || "tu departamento"}</div>
              <div style={{ marginTop: 6, fontSize: 14 }}>{posTxt(d.rank_depto, d.total_depto, "técnicos")}</div>
            </div>
            <div className="amg-card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Tu posición a nivel nacional</div>
              <div style={{ marginTop: 6, fontSize: 14 }}>{posTxt(d.rank_nacional, d.total_nacional, "técnicos")}</div>
            </div>
            <div className="amg-card" style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Tu trabajo del mes</div>
              <div style={{ marginTop: 6, fontSize: 13 }}><b className="amg-mono">{Number((d.detalle.resumen || {}).armados || 0).toLocaleString("es-CO")}</b> productos armados · <b className="amg-mono">{Number((d.detalle.resumen || {}).servicios || 0).toLocaleString("es-CO")}</b> servicios</div>
            </div>
          </div>

          <div style={{ fontWeight: 600, fontSize: 13, margin: "4px 0 8px" }}>Tus indicadores frente a la meta</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px,1fr))", gap: 10, marginBottom: 16 }}>
            {(d.indicadores || []).map((i) => {
              const color = i.semaforo ? COLOR_SEMAFORO[i.semaforo] : "var(--text-faint)";
              return (
                <div key={i.k} className="amg-card" style={{ padding: "12px 14px", borderTop: `4px solid ${i.semaforo ? COLOR_SEMAFORO[i.semaforo] : "var(--border)"}` }}>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{i.t}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color }}>{fmtPct(i.valor, i.k === "quejas" ? 2 : 1)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{i.texto} · meta {i.mejor === "alto" ? "≥" : "≤"} {i.meta}%</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.5 }}>
                    {i.rank_depto ? <div>En tu departamento: <b className="amg-mono">#{i.rank_depto}</b> de {i.total_depto}</div> : null}
                    {i.rank_nacional ? <div>A nivel nacional: <b className="amg-mono">#{i.rank_nacional}</b> de {i.total_nacional}</div> : <div style={{ color: "var(--text-faint)" }}>Sin posición (sin dato este mes)</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))", gap: 14 }}>
            <Tabla titulo="Mis quejas" sub="Cada queja se revisa: «Aplica» cuenta contra el indicador, «No aplica» no." cols={["Fecha", "Caso / servicio", "Resultado", "Motivo"]} filas={d.detalle.quejas || []} vacio="Sin quejas este mes."
              fila={(q, i) => <tr key={i}><td className="amg-mono">{fechaCorta(q.fecha)}</td><td className="amg-mono">{q.caso}<div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{q.servicio}</div></td>
                <td><ui.Badge text={(APLICA[q.aplica] || ["–", "gray"])[0]} color={(APLICA[q.aplica] || ["–", "gray"])[1]} /></td><td style={{ maxWidth: 280 }}>{q.motivo || (q.aplica === "revisar" ? "La están revisando." : "–")}</td></tr>} />
            <Tabla titulo="Servicios cerrados fuera del horario" sub={`Cierres en Extreme con hora fin de trabajo después de la hora límite${(d.detalle.resumen || {}).cierres_sin_hora ? ` (además tienes ${d.detalle.resumen.cierres_sin_hora} sin hora de cierre)` : ""}.`} cols={["Día", "Servicio", "Hora de cierre", "Causal"]} filas={d.detalle.cierres_fuera || []} vacio="Todos tus cierres fueron dentro del horario."
              fila={(c, i) => <tr key={i}><td className="amg-mono">{fechaCorta(c.dia)}</td><td className="amg-mono">{c.servicio}<div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{c.clave}</div></td><td className="amg-mono" style={{ color: "var(--red)", fontWeight: 700 }}>{c.hora !== null && c.hora !== undefined ? `${String(c.hora).padStart(2, "0")}:00` : "–"}</td><td>{c.causal || "–"}</td></tr>} />
            <Tabla titulo="Garantías que cerré" sub="Productos cerrados como NO ARMADO POR NOVEDAD (no se pudo armar por un problema del producto)." cols={["Fecha", "Servicio", "Producto", "Notas"]} filas={d.detalle.garantias || []} vacio="Sin garantías este mes."
              fila={(g, i) => <tr key={i}><td className="amg-mono">{fechaCorta(g.fecha)}</td><td className="amg-mono">{g.servicio}</td><td>{g.producto}</td><td style={{ maxWidth: 260 }}>{g.notas || g.diagnostico || "–"}</td></tr>} />
            <Tabla titulo="Monitoreos por debajo del objetivo" sub={`Calificación menor a la meta (${(d.metas || {}).monitoreos ?? ""}%) o con error crítico.`} cols={["Fecha", "Monitoreo", "Servicio", "Calificación"]} filas={d.detalle.monitoreos_bajo || []} vacio="Ningún monitoreo por debajo del objetivo este mes."
              fila={(m, i) => <tr key={i}><td className="amg-mono">{fechaCorta(m.fecha)}</td><td className="amg-mono">{m.no}<div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{m.canal}</div></td><td className="amg-mono">{m.servicio || "–"}</td>
                <td className="amg-mono" style={{ fontWeight: 700 }}>{fmtPct(m.score, 1)}{m.luz ? <span style={{ fontWeight: 400, color: "var(--text-faint)" }}> · {m.luz}</span> : null}{m.critico ? <div style={{ fontSize: 10.5, color: "#e0435c", fontWeight: 400 }}>Error crítico{m.tipo_critico ? `: ${m.tipo_critico}` : ""}</div> : null}</td></tr>} />
          </div>

          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 12, lineHeight: 1.5 }}>
            La información la actualiza la administración y se muestra tal como estaba en la fecha de actualización. Las posiciones comparan tu puntaje (o ese indicador) con el de los técnicos que tuvieron datos en el mes; si empatas con alguien, comparten el mismo puesto. Las metas son: cierre en línea ≥ {(d.metas || {}).cierre}%, garantías ≤ {(d.metas || {}).garantias}%, concreción de TV ≥ {(d.metas || {}).concrecion}%, quejas que aplican ≤ {(d.metas || {}).quejas}%, CSAT ≥ {(d.metas || {}).csat}%, productividad ≥ {(d.metas || {}).productividad}% y monitoreos ≥ {(d.metas || {}).monitoreos}%.
          </div>
        </>
      )}
    </div>
  );
}
