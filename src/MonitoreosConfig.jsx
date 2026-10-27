import { useState, useEffect } from "react";
import { Check, AlertTriangle, Plus, ArrowUp, ArrowDown, RotateCcw } from "lucide-react";
import * as M from "./lib/monitoreos/monData";

/* Configuración de los monitoreos (Maestros → Monitoreos): componentes y subcomponentes de cada canal con su peso y su descripción (que ve el usuario
   al llenar el formulario), semáforo y tipos de error crítico. Nada se borra: lo que ya no se use se desactiva, para no alterar los monitoreos anteriores. */

const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };
const nuevoId = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
const mover = (lista, i, d) => { const j = i + d; if (j < 0 || j >= lista.length) return lista; const n = [...lista]; [n[i], n[j]] = [n[j], n[i]]; return n; };

export default function MonitoreosConfig({ db, persist, addAudit, session, ui }) {
  const isAdmin = session.role === "admin";
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState("Digital");
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { M.loadMonConfig().then(setCfg).catch((e) => { setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL de Monitoreos (sql/36).`); setCfg(M.configInicial()); }); }, []);
  if (!cfg) return <div style={{ color: "var(--text-faint)" }}>Cargando...</div>;

  const cambiar = (n) => { setCfg(n); setDirty(true); setMsg(""); setError(""); };
  const comps = (canal) => ((cfg.canales[canal] || {}).componentes) || [];
  const setComps = (canal, lista) => cambiar({ ...cfg, canales: { ...cfg.canales, [canal]: { ...cfg.canales[canal], componentes: lista } } });
  const setComp = (canal, i, patch) => setComps(canal, comps(canal).map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const setSub = (canal, i, j, patch) => setComp(canal, i, { subs: comps(canal)[i].subs.map((s, k) => (k === j ? { ...s, ...patch } : s)) });

  const sumaOk = (canal) => M.sumaPesos(cfg, canal) === 100;
  const todoOk = M.CANALES.every(sumaOk);

  const guardar = async () => {
    setError("");
    if (!todoOk) { setError("Los pesos de los componentes activos de cada canal deben sumar exactamente 100."); return; }
    try {
      await M.saveMonConfig(cfg, session.id);
      setDirty(false); setMsg("Configuración guardada para todo el equipo.");
      persist(addAudit(db, { userId: session.id, action: "Cambio de la configuración de monitoreos", record: "monitoreos_config", oldValue: "-", newValue: "Actualizada" }));
    } catch (e) { setError(e.message); }
  };

  const TABS = [...M.CANALES.map((c) => [c, M.NOMBRE_CANAL[c]]), ["semaforo", "Semáforo"], ["errores", "Errores críticos"]];

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.6 }}>
        Aquí se define cómo se califica cada monitoreo: los <b>componentes</b> con su <b>peso</b> (deben sumar 100 por canal), los <b>subcomponentes</b> que el usuario responde (Cumple, No Cumple o N/A) y la <b>descripción</b> que le ayuda a decidir. Un componente es NEGATIVO si algún subcomponente es "No Cumple" y suma su peso solo si es POSITIVO.
        Los monitoreos ya registrados conservan el resultado con el que se calcularon; lo que ya no se use, desactívalo en vez de borrarlo.
      </div>
      {msg && <div className="amg-alert" style={{ ...okBox, marginBottom: 12 }}><Check size={14} /> {msg}</div>}
      {error && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> {error}</div>}

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 14, flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => <div key={k} className={`amg-tab ${tab === k ? "active" : ""}`} onClick={() => setTab(k)}>{l}{M.CANALES.includes(k) && !sumaOk(k) && <span style={{ color: "var(--red)" }}> ⚠</span>}</div>)}
      </div>

      {M.CANALES.includes(tab) && (
        <div>
          <div style={{ marginBottom: 10, fontSize: 13 }}>Suma de pesos activos: <b style={{ color: sumaOk(tab) ? "var(--green)" : "var(--red)" }}>{M.sumaPesos(cfg, tab)}%</b> {sumaOk(tab) ? "✓" : "(debe ser 100)"}</div>
          {comps(tab).map((c, i) => (
            <div key={c.id} className="amg-card" style={{ padding: 12, marginBottom: 12, opacity: c.activo === false ? 0.6 : 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <input className="amg-input amg-mono" style={{ width: 64 }} disabled={!isAdmin} value={c.codigo} onChange={(e) => setComp(tab, i, { codigo: e.target.value })} title="Código (ej. C1)" />
                <input className="amg-input" style={{ flex: "1 1 240px", fontWeight: 600 }} disabled={!isAdmin} value={c.nombre} onChange={(e) => setComp(tab, i, { nombre: e.target.value })} placeholder="Nombre del componente" />
                <label style={{ fontSize: 12.5 }}>Peso <input type="number" min="0" max="100" className="amg-input amg-mono" style={{ width: 72 }} disabled={!isAdmin} value={c.peso} onChange={(e) => setComp(tab, i, { peso: e.target.value === "" ? "" : Number(e.target.value) })} /> %</label>
                <label style={{ fontSize: 12.5, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" disabled={!isAdmin} checked={c.activo !== false} onChange={(e) => setComp(tab, i, { activo: e.target.checked })} /> Activo</label>
                {isAdmin && <><button className="amg-btn ghost" style={{ padding: 4 }} title="Subir" onClick={() => setComps(tab, mover(comps(tab), i, -1))}><ArrowUp size={13} /></button>
                  <button className="amg-btn ghost" style={{ padding: 4 }} title="Bajar" onClick={() => setComps(tab, mover(comps(tab), i, 1))}><ArrowDown size={13} /></button></>}
              </div>
              {c.subs.map((s, j) => (
                <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr auto", gap: 8, alignItems: "start", padding: "8px 0", borderTop: "1px solid var(--border)", opacity: s.activo === false ? 0.55 : 1 }}>
                  <div>
                    <input className="amg-input" disabled={!isAdmin} value={s.nombre} onChange={(e) => setSub(tab, i, j, { nombre: e.target.value })} placeholder="Subcomponente" />
                    <input className="amg-input" style={{ marginTop: 4, fontSize: 12 }} disabled={!isAdmin} value={s.regla || ""} onChange={(e) => setSub(tab, i, j, { regla: e.target.value })} placeholder="Regla o advertencia (opcional, ej. posible error crítico)" />
                  </div>
                  <textarea className="amg-textarea" rows={3} disabled={!isAdmin} value={s.descripcion || ""} onChange={(e) => setSub(tab, i, j, { descripcion: e.target.value })} placeholder="Descripción que verá el usuario para apoyarse al responder" />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                    <label style={{ fontSize: 12, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" disabled={!isAdmin} checked={s.activo !== false} onChange={(e) => setSub(tab, i, j, { activo: e.target.checked })} /> Activo</label>
                    {isAdmin && <span style={{ display: "flex", gap: 2 }}>
                      <button className="amg-btn ghost" style={{ padding: 3 }} onClick={() => setComp(tab, i, { subs: mover(c.subs, j, -1) })}><ArrowUp size={12} /></button>
                      <button className="amg-btn ghost" style={{ padding: 3 }} onClick={() => setComp(tab, i, { subs: mover(c.subs, j, 1) })}><ArrowDown size={12} /></button>
                    </span>}
                  </div>
                </div>
              ))}
              {isAdmin && <button className="amg-btn" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setComp(tab, i, { subs: [...c.subs, { id: nuevoId(c.id), nombre: "", descripcion: "", regla: "", activo: true }] })}><Plus size={12} /> Agregar subcomponente</button>}
            </div>
          ))}
          {isAdmin && <button className="amg-btn" onClick={() => setComps(tab, [...comps(tab), { id: nuevoId(tab === "Digital" ? "dig" : "pre"), codigo: `C${comps(tab).length + 1}`, nombre: "", peso: 0, activo: true, subs: [] }])}><Plus size={13} /> Agregar componente</button>}
        </div>
      )}

      {tab === "semaforo" && (
        <div className="amg-card" style={{ padding: 12 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 8 }}>La calificación cae en el primer nivel (de mayor a menor) cuyo mínimo alcanza. El último nivel debería tener mínimo 0.</div>
          <table className="amg-table compact">
            <thead><tr><th>Nivel</th><th>Desde (%)</th><th>Color</th><th>Qué significa</th><th>Qué hacer</th></tr></thead>
            <tbody>{cfg.semaforo.map((s, i) => {
              const set = (p) => cambiar({ ...cfg, semaforo: cfg.semaforo.map((x, k) => (k === i ? { ...x, ...p } : x)) });
              return <tr key={s.nombre + i}>
                <td><input className="amg-input" style={{ width: 110 }} disabled={!isAdmin} value={s.nombre} onChange={(e) => set({ nombre: e.target.value })} /></td>
                <td><input type="number" min="0" max="100" className="amg-input amg-mono" style={{ width: 80 }} disabled={!isAdmin} value={s.min} onChange={(e) => set({ min: Number(e.target.value) })} /></td>
                <td><input type="color" disabled={!isAdmin} value={s.color} onChange={(e) => set({ color: e.target.value })} /></td>
                <td><input className="amg-input" disabled={!isAdmin} value={s.descripcion || ""} onChange={(e) => set({ descripcion: e.target.value })} /></td>
                <td><input className="amg-input" disabled={!isAdmin} value={s.accion || ""} onChange={(e) => set({ accion: e.target.value })} /></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}

      {tab === "errores" && (
        <div className="amg-card" style={{ padding: 12 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 8 }}>Tipos de error crítico que se pueden elegir al registrar un monitoreo. Cualquiera lleva la calificación final a 0%.</div>
          {cfg.erroresCriticos.map((e, i) => {
            const set = (p) => cambiar({ ...cfg, erroresCriticos: cfg.erroresCriticos.map((x, k) => (k === i ? { ...x, ...p } : x)) });
            return <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8, marginBottom: 6 }}>
              <input className="amg-input" disabled={!isAdmin} value={e.nombre} onChange={(ev) => set({ nombre: ev.target.value })} placeholder="Nombre" />
              <input className="amg-input" disabled={!isAdmin} value={e.descripcion || ""} onChange={(ev) => set({ descripcion: ev.target.value })} placeholder="Descripción" />
              {isAdmin && <button className="amg-btn ghost" style={{ padding: 4 }} title="Quitar de la lista" onClick={() => cambiar({ ...cfg, erroresCriticos: cfg.erroresCriticos.filter((_, k) => k !== i) })}>✕</button>}
            </div>;
          })}
          {isAdmin && <button className="amg-btn" onClick={() => cambiar({ ...cfg, erroresCriticos: [...cfg.erroresCriticos, { nombre: "", descripcion: "" }] })}><Plus size={13} /> Agregar tipo de error crítico</button>}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
        <button className="amg-btn primary" disabled={!isAdmin || !dirty || !todoOk} onClick={guardar}><Check size={14} /> Guardar configuración</button>
        <button className="amg-btn" disabled={!isAdmin} onClick={() => { if (window.confirm("Se reemplaza lo que ves por la configuración inicial del Excel (aún no se guarda). ¿Continuar?")) cambiar(M.configInicial()); }}><RotateCcw size={13} /> Restablecer a la del Excel</button>
        {dirty && <span style={{ fontSize: 12, color: "var(--accent)" }}>Hay cambios sin guardar.</span>}
        {!isAdmin && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Solo el administrador puede modificar la configuración.</span>}
      </div>
    </div>
  );
}
