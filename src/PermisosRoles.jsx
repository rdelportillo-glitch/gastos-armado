import { useState, useMemo, Fragment } from "react";
import { Check, AlertTriangle, RotateCcw } from "lucide-react";
import { ROLES_CONFIGURABLES, ROL_NOMBRE, savePermisos } from "./lib/permisosRoles";

// Maestros → Permisos por rol: qué categorías y módulos del menú ve cada rol. Cada fila es un módulo, agrupado por categoría; la casilla del encabezado de la categoría marca o desmarca todos.
// Los módulos solo de administrador no se abren a otros roles; cliente y técnico solo pueden tener los módulos pensados para ellos (externos).

export default function PermisosRoles({ items, groups, externas, config, onSaved, db, persist, addAudit, session }) {
  const defecto = (rol, n) => n.roles.includes(rol);
  const bloqueado = (rol, n) => (n.roles.length === 1 && n.roles[0] === "admin") || (externas[rol] ? !externas[rol].includes(n.key) : false);
  const valorGuardado = (rol, n) => { const o = config.roles && config.roles[rol]; return o && typeof o[n.key] === "boolean" ? o[n.key] : defecto(rol, n); };
  const [draft, setDraft] = useState(() => Object.fromEntries(ROLES_CONFIGURABLES.map((r) => [r, Object.fromEntries(items.map((n) => [n.key, bloqueado(r, n) ? false : valorGuardado(r, n)]))])));
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const categorias = useMemo(() => {
    const agrupados = new Set(groups.flatMap((g) => g.keys));
    const lista = groups.map((g) => ({ label: g.label, items: g.keys.map((k) => items.find((n) => n.key === k)).filter(Boolean) }));
    const otros = items.filter((n) => !agrupados.has(n.key));
    return [...lista, ...(otros.length ? [{ label: "Otros", items: otros }] : [])].filter((g) => g.items.length);
  }, [items, groups]);

  const set = (rol, key, v) => { setDraft((d) => ({ ...d, [rol]: { ...d[rol], [key]: v } })); setMsg(""); };
  const setCategoria = (rol, cat, v) => { setDraft((d) => ({ ...d, [rol]: { ...d[rol], ...Object.fromEntries(cat.items.filter((n) => !bloqueado(rol, n)).map((n) => [n.key, v])) } })); setMsg(""); };
  const restaurar = () => { setDraft(Object.fromEntries(ROLES_CONFIGURABLES.map((r) => [r, Object.fromEntries(items.map((n) => [n.key, bloqueado(r, n) ? false : defecto(r, n)]))]))); setMsg(""); };

  // Solo se guarda lo que difiere del valor por defecto.
  const nuevoCfg = () => {
    const roles = {};
    ROLES_CONFIGURABLES.forEach((r) => {
      const o = Object.fromEntries(items.filter((n) => !bloqueado(r, n) && draft[r][n.key] !== defecto(r, n)).map((n) => [n.key, draft[r][n.key]]));
      if (Object.keys(o).length) roles[r] = o;
    });
    return { roles };
  };
  const cambios = ROLES_CONFIGURABLES.reduce((s, r) => s + items.filter((n) => !bloqueado(r, n) && draft[r][n.key] !== valorGuardado(r, n)).length, 0);

  const guardar = async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      const cfg = nuevoCfg();
      await savePermisos(cfg, session.id);
      onSaved(cfg);
      persist(addAudit({ ...db }, { userId: session.id, action: "Cambio de permisos por rol", record: "permisos_roles", oldValue: "-", newValue: `${cambios} cambio(s)` }));
      setMsg("Permisos guardados. Cada persona los ve al recargar la plataforma (Ctrl+F5).");
    } catch (e) { setError(e.message || String(e)); }
    setBusy(false);
  };

  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.5 }}>
        Marca qué categorías y módulos ve cada rol. El <b>administrador</b> siempre tiene todo. Los módulos de Administración (Usuarios, Maestros, Configuración) son solo del administrador. <b>Cliente</b> y <b>Técnico</b> solo pueden tener los módulos pensados para ellos.
        Esto controla lo que aparece en el menú y se puede abrir; la seguridad de los datos sigue en la base de datos.
      </div>
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {msg && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={14} /> {msg}</div>}
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Categoría / módulo</th><th style={{ textAlign: "center" }}>{ROL_NOMBRE.admin}</th>{ROLES_CONFIGURABLES.map((r) => <th key={r} style={{ textAlign: "center" }}>{ROL_NOMBRE[r]}</th>)}</tr></thead>
          <tbody>
            {categorias.map((cat) => (
              <Fragment key={cat.label}>
                <tr style={{ background: "var(--panel-2)" }}>
                  <td style={{ fontWeight: 700 }}>{cat.label}</td>
                  <td></td>
                  {ROLES_CONFIGURABLES.map((r) => {
                    const habilitados = cat.items.filter((n) => !bloqueado(r, n));
                    const todos = habilitados.length > 0 && habilitados.every((n) => draft[r][n.key]);
                    return (
                      <td key={r} style={{ textAlign: "center" }}>
                        {habilitados.length > 0
                          ? <input type="checkbox" title="Marcar o desmarcar toda la categoría" checked={todos} ref={(el) => { if (el) el.indeterminate = !todos && habilitados.some((n) => draft[r][n.key]); }} onChange={(e) => setCategoria(r, cat, e.target.checked)} />
                          : <span style={{ color: "var(--text-faint)" }}>—</span>}
                      </td>
                    );
                  })}
                </tr>
                {cat.items.map((n) => (
                  <tr key={n.key}>
                    <td style={{ paddingLeft: 24 }}>{n.label}</td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked disabled readOnly /></td>
                    {ROLES_CONFIGURABLES.map((r) => (
                      <td key={r} style={{ textAlign: "center" }}>
                        {bloqueado(r, n) ? <span style={{ color: "var(--text-faint)" }} title="No disponible para este rol">—</span>
                          : <input type="checkbox" checked={!!draft[r][n.key]} onChange={(e) => set(r, n.key, e.target.checked)} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="amg-btn primary" disabled={busy || cambios === 0} onClick={guardar}>{busy ? "Guardando..." : `Guardar permisos${cambios ? ` (${cambios} cambio${cambios === 1 ? "" : "s"})` : ""}`}</button>
        <button className="amg-btn" disabled={busy} onClick={restaurar} title="Vuelve a los permisos de fábrica de cada módulo (hay que guardar para aplicarlos)"><RotateCcw size={13} /> Restaurar valores por defecto</button>
      </div>
    </div>
  );
}
