import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Phone, Check, AlertTriangle, Download, Save, Plus } from "lucide-react";
import * as T from "./lib/tv/tvData";

/* ============================================================================
   INSTALACIÓN DE TV (servicio adicional)
   Agenda de llamadas para los servicios con panel de TV o centro de entretenimiento cargados en
   Asignación: llamada guiada con el guion de la propuesta, resultado (aceptó / indeciso / no aceptó),
   datos de la instalación, indicadores de contactabilidad y aceptación, y configuración.
   La asignación lee las ofertas Aceptó / Indeciso para marcar el servicio, sumar tiempo y avisar al técnico.
============================================================================ */

const ESTADO_COLOR = { "Por llamar": "gray", Rellamar: "amber", "Aceptó": "green", Indeciso: "blue", "No aceptó": "red", "No contactado": "gray" };
const RESULTADOS_NO_CONTACTO = ["No contesta", "Ocupado", "Buzón", "Número errado"];
const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };
const warnBox = { background: "rgba(217,141,52,0.12)", border: "1px solid rgba(217,141,52,0.4)" };
const pct1 = (n) => `${(Number(n) || 0).toFixed(1)}%`;

const toLocalInput = (d) => { const x = new Date(d); const p = (n) => String(n).padStart(2, "0"); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };
const fmtHora = (iso) => (iso ? new Date(iso).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-");
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function InstalacionTVModule({ db, session, addAudit, persist, ui }) {
  const canEdit = session.role === "admin" || session.role === "operador";
  const isAdmin = session.role === "admin";
  const [tab, setTab] = useState("agenda");
  const [cfg, setCfg] = useState(null);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState(null);

  const usuarios = useMemo(() => Object.fromEntries(db.users.map((u) => [u.id, u.name])), [db.users]);

  const recargar = async () => {
    setLoading(true); setError("");
    try {
      const c = await T.loadTvConfig();
      setCfg(c);
      setOffers(await T.loadOffers({ since: new Date(Date.now() - 90 * 864e5).toISOString() }));
    } catch (e) { setError(`${e.message}. Si es la primera vez, falta correr el SQL de Instalación de TV (sql/19) en Supabase.`); setCfg((c) => c || T.TV_CONFIG_DEFAULT); }
    setLoading(false);
  };
  useEffect(() => { recargar(); }, []);

  const queue = useMemo(() => (cfg ? T.buildQueue(db.services, cfg) : []), [db.services, cfg]);
  const offerBy = useMemo(() => new Map(offers.map((o) => [String(o.servicio), o])), [offers]);

  const TABS = [{ key: "agenda", label: "Agenda de llamadas" }, { key: "indicadores", label: "Indicadores" }, { key: "config", label: "Configuración" }];
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => <div key={t.key} className={`amg-tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</div>)}
      </div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {loading && !cfg && <div style={{ color: "var(--text-faint)" }}>Cargando...</div>}

      {cfg && tab === "agenda" && <Agenda queue={queue} offerBy={offerBy} cfg={cfg} canEdit={canEdit} ui={ui} usuarios={usuarios} onOpen={setSel} onReload={recargar} loading={loading} />}
      {cfg && tab === "indicadores" && <Indicadores usuarios={usuarios} ui={ui} />}
      {cfg && tab === "config" && <Configuracion cfg={cfg} setCfg={setCfg} isAdmin={isAdmin} session={session} db={db} persist={persist} addAudit={addAudit} ui={ui} />}

      {sel && (
        <LlamadaModal cand={sel} offer={offerBy.get(String(sel.servicio)) || null} cfg={cfg} session={session} canEdit={canEdit} ui={ui} usuarios={usuarios}
          onClose={() => setSel(null)} onSaved={async (txt) => { setSel(null); setMsg(txt); await recargar(); }} />
      )}
    </div>
  );
}

/* ---------------------------------- Agenda ---------------------------------- */

function Agenda({ queue, offerBy, cfg, canEdit, ui, usuarios, onOpen, onReload, loading }) {
  const [estado, setEstado] = useState("");
  const [depto, setDepto] = useState("");
  const [q, setQ] = useState("");
  // Por defecto muestra los servicios del día (la fecha se toma al abrir la pantalla, así cambia cada día).
  const hoy = ui.todayISO();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [now] = useState(() => new Date());

  const filas = useMemo(() => queue.map((c) => ({ c, o: offerBy.get(String(c.servicio)) || null })), [queue, offerBy]);
  const estadoDe = (r) => (r.o ? r.o.estado : "Por llamar");
  const vencida = (r) => r.o && r.o.estado === "Rellamar" && r.o.proxima_llamada && new Date(r.o.proxima_llamada) <= now;
  const deptos = useMemo(() => [...new Set(queue.map((c) => c.departamento).filter(Boolean))].sort(), [queue]);

  // Los contadores siguen las fechas, el departamento y la búsqueda (no el filtro de estado); la tabla además filtra por estado.
  const enRango = filas.filter((r) => (!depto || r.c.departamento === depto)
    && (!desde || r.c.fechaProg >= desde) && (!hasta || r.c.fechaProg <= hasta)
    && (!q.trim() || `${r.c.servicio} ${r.c.cliente} ${r.c.telefonoTxt} ${r.c.direccion}`.toLowerCase().includes(q.toLowerCase())));
  const vis = enRango.filter((r) => !estado || estadoDe(r) === estado)
    .sort((a, b) => {
      const rank = (r) => (vencida(r) ? 0 : !r.o ? 1 : r.o.estado === "Rellamar" ? 2 : 3);
      return rank(a) - rank(b) || (rank(a) === 2 ? String(a.o.proxima_llamada).localeCompare(String(b.o.proxima_llamada)) : String(a.c.fechaProg).localeCompare(String(b.c.fechaProg))) || String(a.c.servicio).localeCompare(String(b.c.servicio));
    });

  const n = (f) => enRango.filter(f).length;
  const aceptados = enRango.filter((r) => r.o && r.o.estado === "Aceptó");
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Por llamar" value={n((r) => !r.o)} accent />
        <ui.StatCard label="Rellamar" value={n((r) => r.o && r.o.estado === "Rellamar")} sub={`${n(vencida)} ya vencidas`} />
        <ui.StatCard label="Aceptaron" value={aceptados.length} sub={T.fmtCOP(aceptados.reduce((s, r) => s + (Number(r.o.valor_total) || 0), 0))} />
        <ui.StatCard label="Indecisos" value={n((r) => r.o && r.o.estado === "Indeciso")} sub="los conversa el técnico" />
        <ui.StatCard label="No aceptaron" value={n((r) => r.o && r.o.estado === "No aceptó")} />
        <ui.StatCard label="No contactados" value={n((r) => r.o && r.o.estado === "No contactado")} />
      </div>

      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <input className="amg-input" style={{ width: 230 }} placeholder="Buscar servicio, cliente, teléfono..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="amg-select" style={{ width: 160 }} value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option>{["Por llamar", "Rellamar", "Aceptó", "Indeciso", "No aceptó", "No contactado"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="amg-select" style={{ width: 170 }} value={depto} onChange={(e) => setDepto(e.target.value)}>
          <option value="">Todos los departamentos</option>{deptos.map((d) => <option key={d}>{d}</option>)}
        </select>
        <label style={{ fontSize: 12.5 }}>Servicio desde <input type="date" className="amg-input" style={{ width: 145 }} value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label style={{ fontSize: 12.5 }}>hasta <input type="date" className="amg-input" style={{ width: 145 }} value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <button className="amg-btn" onClick={() => { setDesde(hoy); setHasta(hoy); }}>Hoy</button>
        <button className="amg-btn" onClick={() => { const m = addDays(hoy, 1); setDesde(m); setHasta(m); }}>Mañana</button>
        <button className="amg-btn" onClick={() => { setDesde(""); setHasta(""); }}>Todas las fechas</button>
        <button className="amg-btn" onClick={onReload} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</button>
      </div>

      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Servicio</th><th>Cliente</th><th>Teléfonos</th><th>Ciudad</th><th>Panel / centro</th><th>Fecha serv.</th><th>Técnico</th><th>Estado</th><th>Int.</th><th>Próxima llamada</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            {vis.map((r) => (
              <tr key={r.c.servicio} style={vencida(r) ? { background: "rgba(192,70,58,0.06)" } : undefined}>
                <td className="amg-mono">{r.c.servicio}</td>
                <td>{r.c.cliente}</td>
                <td className="amg-mono" style={{ fontSize: 11.5 }}>{r.c.telefonos.join(" · ") || "-"}</td>
                <td>{r.c.ciudad}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{r.c.departamento}</div></td>
                <td style={{ width: 240, minWidth: 200 }}><div style={{ whiteSpace: "normal", lineHeight: 1.3, wordBreak: "break-word" }}>{r.c.productos.join(" · ")}</div></td>
                <td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{ui.fmtDate(r.c.fechaProg)}</td>
                <td>{r.c.tecnicoNombre || <span style={{ color: "var(--text-faint)" }}>sin asignar</span>}</td>
                <td><ui.Badge text={estadoDe(r)} color={ESTADO_COLOR[estadoDe(r)]} />{vencida(r) && <div style={{ fontSize: 10.5, color: "var(--red)" }}>rellamada vencida</div>}</td>
                <td className="amg-mono">{r.o ? r.o.intentos : 0}</td>
                <td className="amg-mono" style={{ fontSize: 11.5 }}>{r.o && r.o.proxima_llamada ? fmtHora(r.o.proxima_llamada) : "-"}</td>
                <td className="amg-mono">{r.o && r.o.valor_total ? T.fmtCOP(r.o.valor_total) : "-"}</td>
                <td><button className="amg-btn primary" style={{ padding: "3px 10px" }} onClick={() => onOpen(r.c)}><Phone size={12} /> {r.o ? "Gestionar" : "Llamar"}</button></td>
              </tr>
            ))}
            {vis.length === 0 && <tr><td colSpan={12} style={{ textAlign: "center", color: "var(--text-faint)", padding: 24 }}>No hay servicios con panel de TV, centro de entretenimiento o mesa flotante para estos filtros. {desde || hasta ? "Por defecto se muestran los del día: usa \"Mañana\" o \"Todas las fechas\" para ver otros. " : ""}Aparecen cuando cargas la base en Asignación (paso 1) y quedan Pendientes o En gestión.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
        Primero van las rellamadas vencidas, luego los que faltan por llamar (por fecha de servicio) y después el resto. Entran los productos de la línea {cfg.linea} con sublínea {cfg.sublineas.join(" / ").toLowerCase()}.
      </div>
    </div>
  );
}

/* ------------------------------ Llamada guiada ------------------------------ */

function LlamadaModal({ cand, offer, cfg, session, canEdit, ui, usuarios, onClose, onSaved }) {
  const vacio = { telefono: cand.telefonos[0] || "", resultado: "", decision: "", pulgadas: offer && offer.pulgadas ? String(offer.pulgadas) : "",
    acciones: { desmonte_tv: !!(offer && offer.desmonte_tv), organizar_cables: !!(offer && offer.organizar_cables), mover_punto: !!(offer && offer.mover_punto) },
    valorEditado: null, formaPago: (offer && offer.forma_pago) || "", objecion: "", nota: "", proxima: "" };
  const [f, setF] = useState(vacio);
  const [paso, setPaso] = useState(0);
  const [historial, setHistorial] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (offer) T.loadCallsOfOffer(offer.id).then(setHistorial).catch(() => {}); }, [offer && offer.id]);

  const precio = T.calcPrecio(cfg, f.pulgadas, f.acciones);
  const valor = f.valorEditado === null ? precio.total : f.valorEditado;
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const sub = (t) => String(t || "").replace(/\{cliente\}/g, cand.cliente || "cliente").replace(/\{valorMenor\}/g, T.fmtCOP(cfg.valorMenor)).replace(/\{valorMayor\}/g, T.fmtCOP(cfg.valorMayor)).replace(/\{umbral\}/g, cfg.umbralPulgadas);
  const PASOS = [{ t: "1 · Apertura", txt: sub(cfg.guion.apertura) }, { t: "2 · Oferta del servicio", txt: sub(cfg.guion.oferta) }, { t: "3 · Cierre y pago", txt: sub(cfg.guion.cierre) + (cfg.cuenta ? `\n\nCuenta para transferencia: ${cfg.cuenta}` : "") }];
  const contacto = f.resultado === "Contactado";
  const respuesta = (cfg.objeciones.find((o) => o.objecion === f.objecion) || {}).respuesta;

  const setResultado = (r) => set({ resultado: r, decision: r === "Contactado" ? f.decision : "", proxima: r !== "Contactado" && !f.proxima ? toLocalInput(Date.now() + cfg.horasRellamada * 3600e3) : f.proxima });

  const guardar = async () => {
    setError("");
    if (!f.resultado) return setError("Elige el resultado de la llamada.");
    if (contacto && !f.decision) return setError("Elige qué respondió el cliente: Aceptó, Indeciso o No aceptó.");
    if (f.decision === "Aceptó" && !(Number(f.pulgadas) > 0)) return setError("Escribe las pulgadas del TV para calcular el valor.");
    if (f.decision === "Aceptó" && !f.formaPago) return setError("Elige la forma de pago (efectivo con el técnico o transferencia).");
    if (f.decision === "No aceptó" && !f.objecion) return setError("Elige la objeción principal del cliente.");
    setBusy(true);
    try {
      await T.registrarLlamada({
        cand, offer, cfg, session,
        llamada: { telefono: f.telefono, resultado: f.resultado, decision: contacto ? f.decision : null, objecion: f.objecion, nota: f.nota.trim(), proxima: f.proxima ? new Date(f.proxima).toISOString() : null },
        datos: contacto && (f.decision === "Aceptó" || f.decision === "Indeciso") ? { pulgadas: f.pulgadas, acciones: f.acciones, valorTotal: f.decision === "Aceptó" ? valor : (Number(f.pulgadas) > 0 ? valor : ""), formaPago: f.formaPago } : null,
      });
      onSaved(`Llamada registrada: ${cand.cliente} · ${contacto ? f.decision : f.resultado}.`);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <ui.Modal title={`Gestión de llamada · Servicio ${cand.servicio}`} onClose={busy ? () => {} : onClose} width={980}
      footer={<><button className="amg-btn" disabled={busy} onClick={onClose}>Cerrar</button>
        <button className="amg-btn primary" disabled={busy || !canEdit} onClick={guardar}><Save size={14} /> {busy ? "Guardando..." : "Guardar llamada"}</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(360px, 1.3fr)", gap: 16, fontSize: 13 }}>
        {/* Cliente */}
        <div>
          <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{cand.cliente}</div>
            <div style={{ color: "var(--text-dim)", margin: "4px 0 8px" }}>{cand.direccion} · {cand.barrio ? cand.barrio + " · " : ""}{cand.ciudad} ({cand.departamento})</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {cand.telefonos.length ? cand.telefonos.map((t) => <a key={t} className="amg-btn" style={{ textDecoration: "none", padding: "3px 10px" }} href={`tel:${t}`}><Phone size={12} /> {t}</a>) : <span style={{ color: "var(--red)" }}>Sin teléfono</span>}
            </div>
            <div><b>Producto:</b> {cand.productos.join(" · ")}</div>
            <div><b>Servicio de armado:</b> {ui.fmtDate(cand.fechaProg)} · {cand.tecnicoNombre ? `técnico ${cand.tecnicoNombre}` : "técnico sin asignar"}</div>
            {offer && <div style={{ marginTop: 6 }}><ui.Badge text={offer.estado} color={ESTADO_COLOR[offer.estado]} /> <span style={{ color: "var(--text-faint)", fontSize: 12 }}>{offer.intentos} intento(s){offer.gestor_id ? ` · último: ${usuarios[offer.gestor_id] || "-"}` : ""}</span></div>}
          </div>

          {historial.length > 0 && (
            <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Historial de llamadas</div>
              {historial.map((h) => (
                <div key={h.id} style={{ fontSize: 12, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
                  <span className="amg-mono">{fmtHora(h.called_at)}</span> · {usuarios[h.gestor_id] || "-"} · <b>{h.resultado}{h.decision ? ` → ${h.decision}` : ""}</b>{h.telefono ? ` · ${h.telefono}` : ""}
                  {h.objecion ? ` · objeción: ${h.objecion}` : ""}{h.nota ? <div style={{ color: "var(--text-dim)" }}>{h.nota}</div> : null}
                </div>
              ))}
            </div>
          )}

          <div className="amg-card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Manejo de objeciones</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {cfg.objeciones.map((o) => <button key={o.objecion} className={`amg-btn ${f.objecion === o.objecion ? "primary" : ""}`} style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => set({ objecion: f.objecion === o.objecion ? "" : o.objecion })}>{o.objecion}</button>)}
            </div>
            {respuesta ? <div style={{ ...warnBox, padding: 10, borderRadius: 6, lineHeight: 1.5 }}><b>Respuesta sugerida:</b> {respuesta}</div> : <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Toca la objeción que ponga el cliente para ver cómo responderla.</div>}
          </div>
        </div>

        {/* Guion + resultado */}
        <div>
          <div className="amg-card" style={{ padding: 12, marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              {PASOS.map((p, i) => <button key={p.t} className={`amg-btn ${paso === i ? "primary" : ""}`} style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setPaso(i)}>{p.t}</button>)}
            </div>
            <div style={{ lineHeight: 1.6, whiteSpace: "pre-wrap", background: "var(--panel-2)", padding: 12, borderRadius: 6 }}>«{PASOS[paso].txt}»</div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, gap: 6 }}>
              <button className="amg-btn" disabled={paso === 0} onClick={() => setPaso(paso - 1)}>← Anterior</button>
              <button className="amg-btn" disabled={paso === PASOS.length - 1} onClick={() => setPaso(paso + 1)}>Siguiente →</button>
            </div>
          </div>

          <div className="amg-card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Resultado de la llamada</div>
            {cand.telefonos.length > 1 && (
              <div style={{ marginBottom: 8 }}><label className="amg-label">Teléfono marcado</label>
                <select className="amg-select" style={{ width: 200 }} value={f.telefono} onChange={(e) => set({ telefono: e.target.value })}>{cand.telefonos.map((t) => <option key={t}>{t}</option>)}</select></div>
            )}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {[...RESULTADOS_NO_CONTACTO, "Contactado"].map((r) => <button key={r} className={`amg-btn ${f.resultado === r ? "primary" : ""}`} onClick={() => setResultado(r)}>{r}</button>)}
            </div>

            {f.resultado && !contacto && (
              <div>
                <label className="amg-label">Volver a llamar el {f.resultado === "Número errado" ? "(prueba con otro teléfono)" : ""}</label>
                <input type="datetime-local" className="amg-input" style={{ width: 230 }} value={f.proxima} onChange={(e) => set({ proxima: e.target.value })} />
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>Después de {cfg.maxIntentos} intentos sin contacto queda como "No contactado".</div>
              </div>
            )}

            {contacto && (
              <div>
                <label className="amg-label">¿Qué respondió el cliente?</label>
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                  {[["Aceptó", "green"], ["Indeciso", "blue"], ["No aceptó", "red"]].map(([d]) => <button key={d} className={`amg-btn ${f.decision === d ? "primary" : ""}`} onClick={() => set({ decision: d })}>{d === "Indeciso" ? "Indeciso (lo conversa el técnico en casa)" : d}</button>)}
                </div>

                {(f.decision === "Aceptó" || f.decision === "Indeciso") && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div><label className="amg-label">Pulgadas del TV{f.decision === "Aceptó" ? " *" : ""}</label>
                      <input type="number" min="1" className="amg-input" value={f.pulgadas} onChange={(e) => set({ pulgadas: e.target.value, valorEditado: null })} /></div>
                    <div><label className="amg-label">Valor a cobrar</label>
                      <input type="number" min="0" className="amg-input amg-mono" value={valor || ""} onChange={(e) => set({ valorEditado: e.target.value === "" ? "" : Number(e.target.value) })} />
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Calculado: {T.fmtCOP(precio.total)}{f.valorEditado !== null && f.valorEditado !== precio.total ? <span style={{ color: "var(--accent)", cursor: "pointer", marginLeft: 6 }} onClick={() => set({ valorEditado: null })}>restablecer</span> : null}</div></div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label className="amg-label">Acciones adicionales</label>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        {cfg.acciones.map((a) => (
                          <label key={a.key} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                            <input type="checkbox" checked={!!f.acciones[a.key]} onChange={(e) => set({ acciones: { ...f.acciones, [a.key]: e.target.checked }, valorEditado: null })} />
                            {a.nombre}{Number(a.valor) ? ` (+${T.fmtCOP(a.valor)})` : ""}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div><label className="amg-label">Forma de pago{f.decision === "Aceptó" ? " *" : ""}</label>
                      <select className="amg-select" value={f.formaPago} onChange={(e) => set({ formaPago: e.target.value })}><option value="">Seleccionar...</option><option>Efectivo</option><option>Transferencia</option></select>
                      {f.formaPago === "Transferencia" && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>Envía la cuenta: {cfg.cuenta}</div>}</div>
                    <div style={{ fontSize: 12, color: "var(--text-dim)", alignSelf: "end" }}>Suma <b>{f.decision === "Aceptó" ? precio.minutos : (cfg.sumarIndeciso ? cfg.minutosBase : 0)} min</b> a la ruta del técnico.</div>
                  </div>
                )}

                {f.decision === "No aceptó" && (
                  <div>
                    <label className="amg-label">Objeción principal *</label>
                    <select className="amg-select" value={f.objecion} onChange={(e) => set({ objecion: e.target.value })}>
                      <option value="">Seleccionar...</option>{cfg.objeciones.map((o) => <option key={o.objecion}>{o.objecion}</option>)}<option>Otra</option>
                    </select>
                  </div>
                )}
                {f.decision === "Indeciso" && (
                  <div style={{ marginTop: 10 }}><label className="amg-label">Volver a llamar (opcional)</label>
                    <input type="datetime-local" className="amg-input" style={{ width: 230 }} value={f.proxima} onChange={(e) => set({ proxima: e.target.value })} /></div>
                )}
              </div>
            )}

            <div style={{ marginTop: 10 }}><label className="amg-label">Observación</label>
              <textarea className="amg-textarea" rows={2} value={f.nota} onChange={(e) => set({ nota: e.target.value })} /></div>
            {error && <div className="amg-alert danger" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {error}</div>}
          </div>
        </div>
      </div>
    </ui.Modal>
  );
}

/* -------------------------------- Indicadores -------------------------------- */

function Indicadores({ usuarios, ui }) {
  const hoy = ui.todayISO();
  const [from, setFrom] = useState(addDays(hoy, -6));
  const [to, setTo] = useState(hoy);
  const [data, setData] = useState({ calls: [], offers: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    Promise.all([T.loadCalls({ from, to }), T.loadOffers({ since: new Date(new Date(from).getTime() - 45 * 864e5).toISOString() })])
      .then(([calls, offers]) => { if (alive) setData({ calls, offers }); })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [from, to]);

  const k = useMemo(() => T.calcIndicadores(data.calls, data.offers, usuarios), [data, usuarios]);
  const meta = (ok) => ({ color: ok ? "var(--green)" : "var(--red)" });

  const exportar = () => ui.downloadCSV("indicadores_instalacion_tv.csv",
    ["Gestor", "Clientes llamados", "Llamadas", "Contactados", "Aceptaron", "Indecisos", "No aceptaron", "% contactabilidad", "% aceptación (sobre contactados)", "% conversión (sobre llamados)", "Valor aceptado"],
    k.porGestor.map((g) => [g.clave, g.llamados, g.llamadas, g.contactados, g.aceptados, g.indecisos, g.noAcepto, pct1(g.contactabilidad), pct1(g.aceptacion), pct1(g.conversion), g.valor]));

  const Tabla = ({ titulo, filas, col }) => (
    <div className="amg-card" style={{ overflowX: "auto", marginBottom: 14 }}>
      <div style={{ padding: "10px 12px", fontWeight: 600, fontSize: 13 }}>{titulo}</div>
      <table className="amg-table" style={{ fontSize: 12.5 }}>
        <thead><tr><th>{col}</th><th>Llamados</th><th>Llamadas</th><th>Contactados</th><th>Aceptaron</th><th>Indecisos</th><th>No aceptaron</th><th>Contactabilidad</th><th>Aceptación</th><th>Conversión</th><th>Valor aceptado</th></tr></thead>
        <tbody>
          {filas.map((g) => (
            <tr key={g.clave}><td>{g.clave}</td><td className="amg-mono">{g.llamados}</td><td className="amg-mono">{g.llamadas}</td><td className="amg-mono">{g.contactados}</td>
              <td className="amg-mono" style={{ color: "var(--green)" }}>{g.aceptados}</td><td className="amg-mono">{g.indecisos}</td><td className="amg-mono">{g.noAcepto}</td>
              <td className="amg-mono">{pct1(g.contactabilidad)}</td><td className="amg-mono">{pct1(g.aceptacion)}</td><td className="amg-mono" style={meta(g.conversion >= 30)}>{pct1(g.conversion)}</td><td className="amg-mono">{T.fmtCOP(g.valor)}</td></tr>
          ))}
          {filas.length === 0 && <tr><td colSpan={11} style={{ textAlign: "center", color: "var(--text-faint)", padding: 16 }}>Sin llamadas en este rango.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label className="amg-label" style={{ margin: 0 }}>Desde</label><input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <label className="amg-label" style={{ margin: 0 }}>Hasta</label><input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
        {[["Hoy", 0], ["7 días", 6], ["30 días", 29]].map(([t, n]) => <button key={t} className="amg-btn" onClick={() => { setFrom(addDays(hoy, -n)); setTo(hoy); }}>{t}</button>)}
        <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={exportar}><Download size={14} /> Exportar CSV</button>
      </div>
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      {loading && <div style={{ color: "var(--text-faint)", marginBottom: 8 }}>Calculando...</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Clientes llamados" value={k.llamados} sub={`${k.llamadas} llamadas · ${k.intentosPromedio.toFixed(1)} por cliente`} />
        <ui.StatCard label="Contactabilidad" value={pct1(k.contactabilidad)} sub={`${k.contactados} contactados de ${k.llamados}`} accent />
        <ui.StatCard label="Aceptaron" value={k.aceptados} sub={`${pct1(k.aceptacion)} de los contactados`} />
        <ui.StatCard label="Tasa de conversión" value={<span style={meta(k.conversion >= 30)}>{pct1(k.conversion)}</span>} sub="aceptaron ÷ llamados · meta ≥ 30%" />
        <ui.StatCard label="Indecisos" value={k.indecisos} sub={`${pct1(k.contactados ? (k.indecisos / k.contactados) * 100 : 0)} de los contactados`} />
        <ui.StatCard label="No aceptaron" value={k.noAcepto} sub={`${pct1(k.contactados ? (k.noAcepto / k.contactados) * 100 : 0)} de los contactados`} />
        <ui.StatCard label="Valor aceptado" value={T.fmtCOP(k.valorAceptado)} />
        <ui.StatCard label="Hasta la 1ª llamada" value={k.tiempoPromedioMin === null ? "-" : `${Math.round(k.tiempoPromedioMin)} min`} sub={k.pctPrimeraHora === null ? "" : `${Math.round(k.pctPrimeraHora)}% en menos de 1 hora (meta)`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px,1fr))", gap: 14, marginBottom: 14 }}>
        <div className="amg-card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Llamadas y contactos por día</div>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={k.porDia.map((d) => ({ ...d, etiqueta: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}` }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E3D8C4" /><XAxis dataKey="etiqueta" tick={{ fill: "#6B5D4D", fontSize: 10 }} /><YAxis tick={{ fill: "#6B5D4D", fontSize: 10 }} allowDecimals={false} />
              <Tooltip /><Legend /><Bar dataKey="llamadas" name="Llamadas" fill="#D98D34" /><Bar dataKey="contactos" name="Contactos" fill="#3F9D6E" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="amg-card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Objeciones más frecuentes</div>
          {k.objeciones.length === 0 ? <div style={{ color: "var(--text-faint)", fontSize: 13 }}>Aún no hay clientes que no aceptaron en este rango.</div> : k.objeciones.map(([o, n]) => (
            <div key={o} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12.5 }}>
              <div style={{ width: 190 }}>{o}</div>
              <div style={{ flex: 1, height: 8, background: "var(--panel-2)", borderRadius: 4 }}><div style={{ width: `${(n / k.objeciones[0][1]) * 100}%`, height: "100%", background: "var(--red)", borderRadius: 4 }} /></div>
              <span className="amg-mono">{n}</span>
            </div>
          ))}
        </div>
      </div>

      <Tabla titulo="Por gestor" filas={k.porGestor} col="Gestor" />
      <Tabla titulo="Por departamento" filas={k.porDepartamento} col="Departamento" />
      <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
        Contactabilidad = clientes contactados ÷ clientes llamados. Aceptación = aceptaron ÷ contactados. Conversión (de la propuesta) = aceptaron ÷ llamados. Cada cliente cuenta una vez, con su última respuesta del rango.
        La concreción (instalaciones realizadas) llega con la ejecución y el cobro, en la siguiente fase.
      </div>
    </div>
  );
}

/* ------------------------------- Configuración ------------------------------- */

function Configuracion({ cfg, setCfg, isAdmin, session, db, persist, addAudit, ui }) {
  const [f, setF] = useState(cfg);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const upd = (patch) => { setF((x) => ({ ...x, ...patch })); setDirty(true); setMsg(""); };
  const num = (k) => (e) => upd({ [k]: e.target.value === "" ? "" : Number(e.target.value) });

  const guardar = async () => {
    setError("");
    const limpio = { ...f, sublineas: f.sublineas.map((s) => String(s).trim()).filter(Boolean) };
    if (!limpio.sublineas.length) return setError("Debe haber al menos una sublínea.");
    try {
      await T.saveTvConfig(limpio, session.id);
      setCfg(limpio); setDirty(false); setMsg("Configuración guardada para todo el equipo.");
      persist(addAudit(db, { userId: session.id, action: "Cambio de configuración (Instalación de TV)", record: "tv_config", oldValue: "-", newValue: "Actualizada" }));
    } catch (e) { setError(e.message); }
  };

  const Campo = ({ label, children, hint }) => <div><label className="amg-label">{label}</label>{children}{hint && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{hint}</div>}</div>;
  return (
    <div style={{ maxWidth: 900 }}>
      {!isAdmin && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 10 }}>Solo el administrador puede cambiar la configuración. Estos son los valores en uso.</div>}
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Tarifas y tiempos</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: 12 }}>
          <Campo label="Pulgadas límite"><input type="number" className="amg-input" disabled={!isAdmin} value={f.umbralPulgadas} onChange={num("umbralPulgadas")} /></Campo>
          <Campo label="Valor hasta el límite ($)"><input type="number" className="amg-input" disabled={!isAdmin} value={f.valorMenor} onChange={num("valorMenor")} /></Campo>
          <Campo label="Valor sobre el límite ($)"><input type="number" className="amg-input" disabled={!isAdmin} value={f.valorMayor} onChange={num("valorMayor")} /></Campo>
          <Campo label="Minutos base de la instalación" hint="Se suman a la ruta del técnico."><input type="number" className="amg-input" disabled={!isAdmin} value={f.minutosBase} onChange={num("minutosBase")} /></Campo>
          <Campo label="Intentos máximos sin contacto" hint="Después queda como No contactado."><input type="number" min="1" className="amg-input" disabled={!isAdmin} value={f.maxIntentos} onChange={num("maxIntentos")} /></Campo>
          <Campo label="Horas para rellamar (por defecto)"><input type="number" min="0" className="amg-input" disabled={!isAdmin} value={f.horasRellamada} onChange={num("horasRellamada")} /></Campo>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13 }}><input type="checkbox" disabled={!isAdmin} checked={!!f.sumarIndeciso} onChange={(e) => upd({ sumarIndeciso: e.target.checked })} /> Sumar los minutos base también a los clientes indecisos (el técnico llega preparado para instalar)</label>
      </div>

      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Acciones adicionales</div>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Acción</th><th>Valor adicional ($)</th><th>Minutos adicionales</th></tr></thead>
          <tbody>{f.acciones.map((a, i) => (
            <tr key={a.key}>
              <td><input className="amg-input" disabled={!isAdmin} value={a.nombre} onChange={(e) => upd({ acciones: f.acciones.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)) })} /></td>
              <td><input type="number" min="0" className="amg-input" style={{ width: 150 }} disabled={!isAdmin} value={a.valor} onChange={(e) => upd({ acciones: f.acciones.map((x, j) => (j === i ? { ...x, valor: e.target.value === "" ? "" : Number(e.target.value) } : x)) })} /></td>
              <td><input type="number" min="0" className="amg-input" style={{ width: 120 }} disabled={!isAdmin} value={a.minutos} onChange={(e) => upd({ acciones: f.acciones.map((x, j) => (j === i ? { ...x, minutos: e.target.value === "" ? "" : Number(e.target.value) } : x)) })} /></td>
            </tr>
          ))}</tbody>
        </table>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>El valor a cobrar = tarifa por pulgadas + el valor de cada acción elegida (el gestor puede ajustarlo). Los minutos de cada acción se suman a los minutos base.</div>
      </div>

      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Qué productos entran a la agenda</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <Campo label="Línea"><input className="amg-input" disabled={!isAdmin} value={f.linea} onChange={(e) => upd({ linea: e.target.value })} /></Campo>
          <Campo label="Sublíneas (separadas por coma)" hint="Basta una parte del nombre: CENTRO ENTRETEN cubre las dos escrituras que trae Jamar. Por defecto: panel de TV, centros de entretenimiento y mesa flotante; las mesas de TV no entran."><input className="amg-input" disabled={!isAdmin} value={f.sublineas.join(", ")} onChange={(e) => upd({ sublineas: e.target.value.split(",") })} /></Campo>
        </div>
        <Campo label="Cuenta para transferencias"><input className="amg-input" disabled={!isAdmin} value={f.cuenta} onChange={(e) => upd({ cuenta: e.target.value })} /></Campo>
      </div>

      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Guion de la llamada</div>
        {[["apertura", "Apertura"], ["oferta", "Oferta del servicio"], ["cierre", "Cierre y pago"]].map(([k, t]) => (
          <div key={k} style={{ marginBottom: 10 }}><label className="amg-label">{t}</label>
            <textarea className="amg-textarea" rows={3} disabled={!isAdmin} value={f.guion[k]} onChange={(e) => upd({ guion: { ...f.guion, [k]: e.target.value } })} /></div>
        ))}
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Se reemplazan solos: <code>{"{cliente}"}</code>, <code>{"{valorMenor}"}</code>, <code>{"{valorMayor}"}</code> y <code>{"{umbral}"}</code>.</div>
      </div>

      <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Objeciones y respuestas sugeridas</div>
        {f.objeciones.map((o, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 2.2fr", gap: 8, marginBottom: 8 }}>
            <input className="amg-input" disabled={!isAdmin} value={o.objecion} onChange={(e) => upd({ objeciones: f.objeciones.map((x, j) => (j === i ? { ...x, objecion: e.target.value } : x)) })} />
            <textarea className="amg-textarea" rows={2} disabled={!isAdmin} value={o.respuesta} onChange={(e) => upd({ objeciones: f.objeciones.map((x, j) => (j === i ? { ...x, respuesta: e.target.value } : x)) })} />
          </div>
        ))}
        {isAdmin && <button className="amg-btn" onClick={() => upd({ objeciones: [...f.objeciones, { objecion: "", respuesta: "" }] })}><Plus size={14} /> Agregar objeción</button>}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="amg-btn primary" disabled={!isAdmin || !dirty} onClick={guardar}><Save size={14} /> Guardar configuración</button>
        <button className="amg-btn" disabled={!isAdmin} onClick={() => { setF(T.TV_CONFIG_DEFAULT); setDirty(true); }}>Restablecer los valores de la propuesta</button>
        {dirty && <span style={{ fontSize: 12, color: "var(--accent)" }}>Hay cambios sin guardar.</span>}
      </div>
    </div>
  );
}
