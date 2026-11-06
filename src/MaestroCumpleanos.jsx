import { useState, useEffect, useMemo } from "react";
import { Check, AlertTriangle } from "lucide-react";
import { loadViaticosConfig, saveViaticosConfig } from "./lib/viaticos";
import { completarCumple, CARGOS_ADMINISTRATIVOS } from "./lib/cumpleanos";

/* ============================================================================
   MAESTROS → BONO DE CUMPLEAÑOS
   Matriz del bono que aparece en Pagos para quien cumple años en la fecha de pago: técnicos según perfil (Aprendiz / Maestro) y antigüedad (Nuevo / Antiguo),
   administrativos según su cargo, y la subcategoría del gasto que se crea al marcarlo como pagado. Solo el administrador la cambia.
============================================================================ */

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

export default function MaestroCumpleanos({ db, persist, addAudit, session }) {
  const isAdmin = session.role === "admin";
  const [cfg, setCfg] = useState(null);
  const [c, setC] = useState(null); // configuración del bono en edición
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { loadViaticosConfig().then((x) => { setCfg(x); setC(completarCumple(x.cumpleanos)); }).catch((e) => setError(`No se pudo leer la configuración: ${e.message}`)); }, []);
  const subOpts = useMemo(() => db.subcategories.filter((s) => s.active).map((s) => ({ id: s.id, label: `${(db.categories.find((k) => k.id === s.categoryId) || {}).name || "?"} › ${s.name}` })).sort((a, b) => a.label.localeCompare(b.label, "es")), [db.subcategories, db.categories]);
  if (!c) return error ? <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div> : <div style={{ color: "var(--text-faint)" }}>Cargando...</div>;

  const sugerida = subOpts.find((o) => /CUMPLE/.test(plano(o.label)));
  const cambiar = (next) => { setC(next); setDirty(true); setMsg(""); };
  const num = (v) => (v === "" ? "" : Number(v));
  const setTec = (perfil, antig, v) => cambiar({ ...c, tecnicos: { ...c.tecnicos, [perfil]: { ...c.tecnicos[perfil], [antig]: num(v) } } });
  const setAdm = (cargo, v) => cambiar({ ...c, administrativos: { ...c.administrativos, [cargo]: num(v) } });

  const guardar = async () => {
    setError("");
    const valores = [...Object.values(c.tecnicos.Aprendiz), ...Object.values(c.tecnicos.Maestro), ...Object.values(c.administrativos), c.resto];
    if (valores.some((v) => v === "" || !(Number(v) >= 0))) { setError("Todos los valores deben ser números (cero o más)."); return; }
    if (!(Number(c.mesesNuevo) > 0)) { setError("El corte de antigüedad debe ser un número de meses mayor que cero."); return; }
    try {
      const nuevo = { ...cfg, cumpleanos: { ...c, mesesNuevo: Number(c.mesesNuevo), subcategoria: c.subcategoria || "" } };
      await saveViaticosConfig(nuevo, session.id);
      setCfg(nuevo);
      persist(addAudit(db, { userId: session.id, action: "Cambio de la matriz del bono de cumpleaños", record: "viaticos_config", oldValue: "-", newValue: `Nuevo < ${nuevo.cumpleanos.mesesNuevo} meses · Aprendiz ${c.tecnicos.Aprendiz.Nuevo}/${c.tecnicos.Aprendiz.Antiguo} · Maestro ${c.tecnicos.Maestro.Nuevo}/${c.tecnicos.Maestro.Antiguo}` }));
      setDirty(false); setMsg("Matriz guardada para todo el equipo.");
    } catch (e) { setError(e.message); }
  };
  const campo = (valor, onChange) => <input type="number" min="0" step="1000" className="amg-input amg-mono" style={{ width: 130 }} disabled={!isAdmin} value={valor} onChange={(e) => onChange(e.target.value)} />;

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.6 }}>
        Bono que aparece en <b>Pagos</b> para quien cumple años en la <b>fecha de pago</b> (la fecha de nacimiento está en Personal). Al marcarlo como pagado se crea su gasto, sin repetirse el mismo día. Aquí defines cuánto se paga.
      </div>
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

      <div className="amg-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Técnicos de campo: perfil × antigüedad</div>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Perfil</th><th>Nuevo</th><th>Antiguo</th></tr></thead>
          <tbody>
            <tr><td><b>Aprendiz</b><div style={{ fontSize: 11, color: "var(--text-faint)" }}>Técnico junior</div></td><td>{campo(c.tecnicos.Aprendiz.Nuevo, (v) => setTec("Aprendiz", "Nuevo", v))}</td><td>{campo(c.tecnicos.Aprendiz.Antiguo, (v) => setTec("Aprendiz", "Antiguo", v))}</td></tr>
            <tr><td><b>Maestro</b><div style={{ fontSize: 11, color: "var(--text-faint)" }}>Técnico senior, supervisor de campo y otros</div></td><td>{campo(c.tecnicos.Maestro.Nuevo, (v) => setTec("Maestro", "Nuevo", v))}</td><td>{campo(c.tecnicos.Maestro.Antiguo, (v) => setTec("Maestro", "Antiguo", v))}</td></tr>
          </tbody>
        </table>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
          Es <b>Nuevo</b> si lleva menos de <input type="number" min="1" className="amg-input amg-mono" style={{ width: 70 }} disabled={!isAdmin} value={c.mesesNuevo} onChange={(e) => cambiar({ ...c, mesesNuevo: num(e.target.value) })} /> meses desde su fecha de ingreso; después es <b>Antiguo</b>. Sin fecha de ingreso se trata como Nuevo.
        </div>
      </div>

      <div className="amg-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Administrativos: por cargo</div>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Cargo</th><th>Valor</th></tr></thead>
          <tbody>
            {CARGOS_ADMINISTRATIVOS.map((cargo) => <tr key={cargo}><td>{cargo}</td><td>{campo(c.administrativos[cargo], (v) => setAdm(cargo, v))}</td></tr>)}
            <tr><td><b>Resto de cargos</b><div style={{ fontSize: 11, color: "var(--text-faint)" }}>Cualquier cargo administrativo que no esté en la lista</div></td><td>{campo(c.resto, (v) => cambiar({ ...c, resto: num(v) }))}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="amg-card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Gasto que se crea al marcar el pago</div>
        <label className="amg-label">Categoría › subcategoría</label>
        <select className="amg-select" disabled={!isAdmin} value={c.subcategoria || ""} onChange={(e) => cambiar({ ...c, subcategoria: e.target.value })} style={{ borderColor: c.subcategoria ? undefined : "var(--red)" }}>
          <option value="">{sugerida ? `Elegir (sugerida: ${sugerida.label})` : "Elegir subcategoría..."}</option>{subOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {!c.subcategoria && <div style={{ color: "var(--red)", fontSize: 11.5, marginTop: 4 }}>Sin subcategoría no se puede marcar el bono como pagado. Si no existe, créala en Categorías y subcategorías (por ejemplo Beneficios empleados › Bono de cumpleaños).</div>}
      </div>

      {isAdmin ? <button className="amg-btn primary" disabled={!dirty} onClick={guardar}><Check size={14} /> Guardar matriz</button> : <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Solo el administrador cambia la matriz.</div>}
      {dirty && <span style={{ marginLeft: 10, fontSize: 12, color: "var(--accent)" }}>Hay cambios sin guardar.</span>}
    </div>
  );
}
