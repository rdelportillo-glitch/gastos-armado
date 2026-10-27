import { useState, useEffect } from "react";
import { Check, AlertTriangle, Plus } from "lucide-react";
import * as C from "./lib/monitoreos/cronogramaData";
import { NOMBRE_CANAL, CANALES } from "./lib/monitoreos/monData";

/* Maestros → Monitoreos → Cronograma: qué personas administrativas son auditores y cuántos monitoreos hacen al mes, y los parámetros con los que se calcula
   a qué técnicos monitorear (antigüedad, cargo y resultado del mes anterior). */

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };

export default function MonitoreosCronConfig({ db, persist, addAudit, session }) {
  const isAdmin = session.role === "admin";
  const [cfg, setCfg] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { C.loadCronConfig().then(setCfg).catch((e) => { setError(`${e.message}.`); setCfg(JSON.parse(JSON.stringify(C.CRON_DEFAULT))); }); }, []);
  if (!cfg) return <div style={{ color: "var(--text-faint)" }}>Cargando...</div>;

  const cambiar = (n) => { setCfg(n); setDirty(true); setMsg(""); setError(""); };
  const p = cfg.params;
  const setP = (patch) => cambiar({ ...cfg, params: { ...p, ...patch } });
  const setSub = (k, patch) => setP({ [k]: { ...p[k], ...patch } });
  const num = (v) => (v === "" ? "" : Number(v));

  const personas = db.technicians.filter((t) => (t.category || "") === "Administrativo" && t.status === "Activo").sort((a, b) => a.name.localeCompare(b.name, "es"));
  const nombreDe = (id) => (db.technicians.find((t) => t.id === id) || {}).name || "(persona no encontrada)";
  const disponibles = personas.filter((t) => !cfg.auditores.some((a) => a.personId === t.id));
  const capacidad = cfg.auditores.filter((a) => a.activo !== false).reduce((s, a) => s + (Number(a.monitoreosMes) || 0), 0);
  const sumaPesos = (Number(p.pesos.antiguedad) || 0) + (Number(p.pesos.cargo) || 0) + (Number(p.pesos.resultado) || 0);

  const guardar = async () => {
    setError("");
    if (sumaPesos <= 0) { setError("Los pesos de la prioridad deben sumar más de 0."); return; }
    try {
      const limpio = { ...cfg, params: { ...p, diasNoHabiles: (p.diasNoHabiles || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) } };
      await C.saveCronConfig(limpio, session.id);
      setCfg(limpio); setDirty(false); setMsg("Configuración del cronograma guardada para todo el equipo.");
      persist(addAudit(db, { userId: session.id, action: "Cambio de la configuración del cronograma de monitoreos", record: "monitoreos_cronograma", oldValue: "-", newValue: `${cfg.auditores.filter((a) => a.activo !== false).length} auditores · ${capacidad} monitoreos/mes` }));
    } catch (e) { setError(e.message); }
  };

  const Num = ({ v, on, w = 76, step = 1, min = 0 }) => <input type="number" min={min} step={step} className="amg-input amg-mono" style={{ width: w }} disabled={!isAdmin} value={v} onChange={(e) => on(num(e.target.value))} />;

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.6 }}>
        Define <b>quiénes auditan</b> (personas administrativas de Personal) y <b>cuántos monitoreos hace cada uno al mes</b>. El cronograma mensual reparte esa capacidad entre los técnicos según su prioridad, que se calcula con la <b>antigüedad</b>, el <b>cargo</b> (técnico junior = Aprendiz, técnico senior = Maestro) y el <b>resultado de los monitoreos del mes anterior</b>.
      </div>
      {msg && <div className="amg-alert" style={{ ...okBox, marginBottom: 12 }}><Check size={14} /> {msg}</div>}
      {error && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> {error}</div>}

      <div className="amg-card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Auditores y monitoreos por mes</div>
        <table className="amg-table compact">
          <thead><tr><th>Persona (Personal → Administrativo)</th><th>Monitoreos al mes</th><th>Activo</th></tr></thead>
          <tbody>
            {cfg.auditores.map((a, i) => (
              <tr key={a.personId} style={a.activo === false ? { opacity: 0.55 } : undefined}>
                <td>{nombreDe(a.personId)}</td>
                <td><Num v={a.monitoreosMes} on={(v) => cambiar({ ...cfg, auditores: cfg.auditores.map((x, k) => (k === i ? { ...x, monitoreosMes: v } : x)) })} w={96} /></td>
                <td><input type="checkbox" disabled={!isAdmin} checked={a.activo !== false} onChange={(e) => cambiar({ ...cfg, auditores: cfg.auditores.map((x, k) => (k === i ? { ...x, activo: e.target.checked } : x)) })} /></td>
              </tr>
            ))}
            {cfg.auditores.length === 0 && <tr><td colSpan={3} style={{ color: "var(--text-faint)", textAlign: "center", padding: 14 }}>Aún no hay auditores. Agrega a la persona administrativa que hará los monitoreos.</td></tr>}
          </tbody>
          <tfoot><tr style={{ fontWeight: 700 }}><td>Capacidad total del mes</td><td className="amg-mono">{capacidad}</td><td></td></tr></tfoot>
        </table>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <select className="amg-select" style={{ width: 280 }} value={nuevo} onChange={(e) => setNuevo(e.target.value)}><option value="">Agregar persona administrativa...</option>{disponibles.map((t) => <option key={t.id} value={t.id}>{t.name}{t.department ? ` · ${t.department}` : ""}</option>)}</select>
            <button className="amg-btn" disabled={!nuevo} onClick={() => { cambiar({ ...cfg, auditores: [...cfg.auditores, { personId: nuevo, activo: true, monitoreosMes: 100 }] }); setNuevo(""); }}><Plus size={13} /> Agregar auditor</button>
          </div>
        )}
        {personas.length === 0 && <div style={{ fontSize: 11.5, color: "var(--red)", marginTop: 6 }}>No hay personas con categoría Administrativo activas en Personal.</div>}
      </div>

      <div className="amg-card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Cómo se calcula la prioridad de cada técnico</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          <div>
            <div className="amg-label">Peso de cada criterio (suman {sumaPesos})</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 8px", alignItems: "center", fontSize: 12.5 }}>
              <span>Antigüedad</span><Num v={p.pesos.antiguedad} on={(v) => setP({ pesos: { ...p.pesos, antiguedad: v } })} />
              <span>Cargo</span><Num v={p.pesos.cargo} on={(v) => setP({ pesos: { ...p.pesos, cargo: v } })} />
              <span>Resultado del mes anterior</span><Num v={p.pesos.resultado} on={(v) => setP({ pesos: { ...p.pesos, resultado: v } })} />
            </div>
          </div>
          <div>
            <div className="amg-label">Antigüedad (puntos)</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 8px", alignItems: "center", fontSize: 12.5 }}>
              <span>Nuevo (menos de <Num v={p.mesesNuevo} on={(v) => setP({ mesesNuevo: v })} w={56} /> meses)</span><Num v={p.puntosAntiguedad.nuevo} on={(v) => setSub("puntosAntiguedad", { nuevo: v })} />
              <span>Intermedio</span><Num v={p.puntosAntiguedad.intermedio} on={(v) => setSub("puntosAntiguedad", { intermedio: v })} />
              <span>Antiguo (desde <Num v={p.mesesAntiguo} on={(v) => setP({ mesesAntiguo: v })} w={56} /> meses)</span><Num v={p.puntosAntiguedad.antiguo} on={(v) => setSub("puntosAntiguedad", { antiguo: v })} />
              <span>Sin fecha de ingreso</span><Num v={p.puntosAntiguedad.sinFecha} on={(v) => setSub("puntosAntiguedad", { sinFecha: v })} />
            </div>
          </div>
          <div>
            <div className="amg-label">Cargo (puntos)</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 8px", alignItems: "center", fontSize: 12.5 }}>
              <span>Aprendiz (técnico junior)</span><Num v={p.puntosCargo.aprendiz} on={(v) => setSub("puntosCargo", { aprendiz: v })} />
              <span>Maestro (técnico senior)</span><Num v={p.puntosCargo.maestro} on={(v) => setSub("puntosCargo", { maestro: v })} />
              <span>Otro (supervisor)</span><Num v={p.puntosCargo.otro} on={(v) => setSub("puntosCargo", { otro: v })} />
            </div>
            <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}><input type="checkbox" disabled={!isAdmin} checked={!!p.incluirSupervisores} onChange={(e) => setP({ incluirSupervisores: e.target.checked })} /> Incluir supervisores de campo</label>
          </div>
          <div>
            <div className="amg-label">Resultado del mes anterior (puntos)</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 8px", alignItems: "center", fontSize: 12.5 }}>
              {["Rojo", "Naranja", "Amarillo", "Verde"].map((s) => <><span key={s}>Semáforo {s.toLowerCase()}</span><Num key={s + "n"} v={p.puntosResultado[s]} on={(v) => setSub("puntosResultado", { [s]: v })} /></>)}
              <span>Sin monitoreo previo</span><Num v={p.puntosResultado.sinDato} on={(v) => setSub("puntosResultado", { sinDato: v })} />
              <span>Tuvo error crítico</span><Num v={p.puntosResultado.errorCritico} on={(v) => setSub("puntosResultado", { errorCritico: v })} />
            </div>
          </div>
        </div>
      </div>

      <div className="amg-card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Reparto y calendario</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, fontSize: 12.5 }}>
          <div><div className="amg-label">Monitoreos por técnico en el mes</div>Mínimo <Num v={p.minPorTecnico} on={(v) => setP({ minPorTecnico: v })} w={64} /> · máximo <Num v={p.maxPorTecnico} on={(v) => setP({ maxPorTecnico: v })} w={64} />
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>Todos reciben el mínimo (si alcanza la capacidad) y el resto va a los de mayor prioridad, sin pasar del máximo.</div></div>
          <div><div className="amg-label">Niveles de prioridad (0 a 1)</div>Alta desde <Num v={p.nivelAlta} on={(v) => setP({ nivelAlta: v })} w={70} step={0.05} /> · Media desde <Num v={p.nivelMedia} on={(v) => setP({ nivelMedia: v })} w={70} step={0.05} /></div>
          <div><div className="amg-label">Canal con el que se programa</div>
            <select className="amg-select" disabled={!isAdmin} value={p.canalDefecto} onChange={(e) => setP({ canalDefecto: e.target.value })}>{CANALES.map((c) => <option key={c} value={c}>{NOMBRE_CANAL[c]}</option>)}</select></div>
          <div><div className="amg-label">Días no hábiles extra (uno por línea, AAAA-MM-DD)</div>
            <textarea className="amg-textarea" rows={3} disabled={!isAdmin} value={(p.diasNoHabiles || []).join("\n")} onChange={(e) => setP({ diasNoHabiles: e.target.value.split(/\s+/).filter(Boolean) })} />
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>Ya se excluyen fines de semana y festivos de Colombia.</div></div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="amg-btn primary" disabled={!isAdmin || !dirty} onClick={guardar}><Check size={14} /> Guardar configuración</button>
        {dirty && <span style={{ fontSize: 12, color: "var(--accent)" }}>Hay cambios sin guardar.</span>}
        {!isAdmin && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Solo el administrador puede modificar la configuración.</span>}
      </div>
    </div>
  );
}
