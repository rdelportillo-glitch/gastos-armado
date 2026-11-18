import { useState, useEffect, useMemo, useCallback } from "react";
import { Check, AlertTriangle, Download, RotateCcw, Phone, MessageCircle, Undo2 } from "lucide-react";
import * as P from "./lib/preventiva";
import { urlLlamada, urlWsp, telefonoWsp } from "./lib/whatsapp";

/* ============================================================================
   GESTIÓN PREVENTIVA · llamar a los clientes para confirmar su cita del día siguiente
   La lista sale de Carga (servicios asignados a la fecha). No incluye los servicios que se gestionan en Instalación de TV.
   Cancela / Cliente arma / Reprogramado retiran el servicio de la asignación (queda cancelado en Carga con una causal PREVENTIVA)
   y generan un aviso para quienes asignan (campana de la barra superior).
============================================================================ */

const horaLocal = (iso) => { try { return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", hour12: true }); } catch (e) { return ""; } };
const okBox = { background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" };

export default function GestionPreventivaModule({ db, session, persist, addAudit, ui }) {
  const canEdit = session.role === "admin" || session.role === "operador";
  const hoy = P.hoyLocal();
  const [fecha, setFecha] = useState(P.fechaPorDefecto(hoy));
  const [llamadas, setLlamadas] = useState([]);
  const [ctxTv, setCtxTv] = useState({ tvCfg: null, servicioConOferta: new Set() });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [modal, setModal] = useState(null); // { g, resultado }
  const [f, setF] = useState({ q: "", tecnico: "", depto: "", estado: "" });

  const recargar = useCallback(async () => {
    setLoading(true);
    try { setLlamadas(await P.cargarLlamadas({ fecha })); setError(""); }
    catch (e) { setError(`${e.message}. Si es la primera vez, falta correr en Supabase el SQL de Gestión preventiva (sql/72).`); }
    setLoading(false);
  }, [fecha]);
  useEffect(() => { recargar(); const t = setInterval(recargar, 30000); return () => clearInterval(t); }, [recargar]);

  // Servicios de la fecha en Carga (sin filtrar TV) para consultar las ofertas de TV de esos servicios.
  const serviciosFecha = useMemo(() => [...new Set((db.services || []).filter((s) => s.servicioExterno && s.date === fecha && !s.finalizedAt).map((s) => String(s.servicioExterno)))], [db.services, fecha]);
  useEffect(() => { let vivo = true; P.cargarContextoTv(serviciosFecha).then((c) => { if (vivo) setCtxTv(c); }); return () => { vivo = false; }; }, [serviciosFecha.join("|")]);

  const { lista, excluidosTv } = useMemo(() => P.construirLista(db.services, fecha, ctxTv), [db.services, fecha, ctxTv]);
  const porServicio = useMemo(() => { const m = new Map(); llamadas.forEach((c) => { if (!m.has(c.servicio)) m.set(c.servicio, []); m.get(c.servicio).push(c); }); return m; }, [llamadas]);
  const techById = useMemo(() => Object.fromEntries((db.technicians || []).map((t) => [t.id, t])), [db.technicians]);
  const nombreTec = (g) => (g.tecnicoId && (techById[g.tecnicoId] || {}).name) || g.tecnicoNombre || "";

  const filas = useMemo(() => lista.map((g) => ({ g, est: P.estadoDe(porServicio.get(g.servicio)), tec: nombreTec(g) })).filter(({ g, est, tec }) => {
    const q = f.q.trim().toLowerCase();
    return (!q || `${g.servicio} ${g.cliente} ${g.telefonoTxt} ${g.ciudad} ${tec}`.toLowerCase().includes(q))
      && (!f.tecnico || (f.tecnico === "__sin" ? !tec : tec === f.tecnico)) && (!f.depto || g.departamento === f.depto) && (!f.estado || est.estado === f.estado);
  }).sort((a, b) => (a.tec || "~").localeCompare(b.tec || "~", "es") || (a.g.rutaOrden ?? 999) - (b.g.rutaOrden ?? 999) || String(a.g.servicio).localeCompare(String(b.g.servicio))), [lista, porServicio, f, techById]);

  const conteo = useMemo(() => { const c = { "Por llamar": 0, Confirmado: 0, "No contesta": 0, Cancela: 0, "Cliente arma": 0, Reprogramado: 0 };
    lista.forEach((g) => { const e = P.estadoDe(porServicio.get(g.servicio)).estado; c[e] = (c[e] || 0) + 1; }); return c; }, [lista, porServicio]);
  const tecnicos = useMemo(() => [...new Set(lista.map((g) => nombreTec(g)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [lista, techById]);
  const deptos = useMemo(() => [...new Set(lista.map((g) => g.departamento).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [lista]);

  // Registra la llamada; si retira el servicio de la asignación, también deja sus registros de Carga cancelados con la causal PREVENTIVA.
  const registrar = async (g, resultado, { nota = "", nuevaFecha = "" } = {}) => {
    setBusy(g.servicio); setError(""); setMsg("");
    try {
      const ids = new Set(g.registros.map((r) => r.id));
      if (P.RETIRA(resultado)) {
        const actuales = db.services.filter((s) => ids.has(s.id));
        if (actuales.some((s) => s.finalizedAt)) throw new Error("Ese servicio ya se finalizó en Carga: no se puede retirar.");
        const nuevos = new Map(P.retirarRegistros(actuales, { resultado, nuevaFecha, nota, usuario: session.name }).map((s) => [s.id, s]));
        const ok = await persist(addAudit({ ...db, services: db.services.map((s) => nuevos.get(s.id) || s) }, { userId: session.id, action: `Gestión preventiva: ${P.TEXTO_RESULTADO[resultado]}`, record: g.servicio, oldValue: "En asignación", newValue: `${P.CAUSAL_PREVENTIVA[resultado]}${nuevaFecha ? ` · nueva fecha ${ui.fmtDate(nuevaFecha)}` : ""}` }));
        if (!ok) throw new Error("No se pudo retirar el servicio de la asignación. Intenta de nuevo.");
      }
      const fila = { servicio: String(g.servicio), fecha_servicio: fecha, resultado, causal: P.CAUSAL_PREVENTIVA[resultado] || null, nueva_fecha: nuevaFecha || null, nota: nota.trim() || null, cliente: g.cliente || null, telefono: g.telefonoTxt || null,
        technician_id: g.tecnicoId || null, technician_name: nombreTec(g) || null, departamento: g.departamento || null, ciudad: g.ciudad || null, productos: g.productos.join(" | ").slice(0, 500), alerta: P.RETIRA(resultado), created_by_name: session.name };
      try { await P.registrarLlamada(fila); }
      catch (e) { throw new Error(`${P.RETIRA(resultado) ? "El servicio ya se retiró de la asignación, pero no se pudo registrar el aviso" : "No se pudo registrar la llamada"}: ${e.message}`); }
      setMsg(P.RETIRA(resultado) ? `Servicio ${g.servicio}: ${P.TEXTO_RESULTADO[resultado].toLowerCase()}. Se retiró de la asignación y se avisó a quienes asignan.` : `Servicio ${g.servicio}: ${P.TEXTO_RESULTADO[resultado].toLowerCase()}.`);
      await recargar();
    } catch (e) { setError(e.message); }
    setBusy(""); setModal(null);
  };

  const deshacer = async (g) => {
    setBusy(g.servicio); setError(""); setMsg("");
    try {
      const ids = new Set(g.registros.map((r) => r.id));
      const nuevos = new Map(P.devolverRegistros(db.services.filter((s) => ids.has(s.id))).map((s) => [s.id, s]));
      const ok = await persist(addAudit({ ...db, services: db.services.map((s) => nuevos.get(s.id) || s) }, { userId: session.id, action: "Gestión preventiva: devuelto a la asignación", record: g.servicio, oldValue: (g.retirado && g.retirado.resultado) || "-", newValue: "En asignación" }));
      if (!ok) throw new Error("No se pudo devolver el servicio a la asignación. Intenta de nuevo.");
      await P.registrarLlamada({ servicio: String(g.servicio), fecha_servicio: fecha, resultado: "Revertido", nota: "Se deshizo la gestión preventiva anterior", cliente: g.cliente || null, telefono: g.telefonoTxt || null, technician_id: g.tecnicoId || null, technician_name: nombreTec(g) || null,
        departamento: g.departamento || null, ciudad: g.ciudad || null, productos: g.productos.join(" | ").slice(0, 500), alerta: true, created_by_name: session.name });
      setMsg(`Servicio ${g.servicio} devuelto a la asignación.`);
      await recargar();
    } catch (e) { setError(e.message); }
    setBusy("");
  };

  const exportar = () => ui.downloadCSV(`gestion_preventiva_${fecha}.csv`, P.CSV_ENCABEZADOS, P.csvFilas(filas.map((x) => ({ ...x.g, tecnicoNombre: x.tec })), porServicio));

  const BtnR = ({ g, r, label, color }) => (
    <button className="amg-btn" disabled={!!busy} style={{ padding: "3px 8px", fontSize: 12, ...(color ? { color, borderColor: color } : {}) }} onClick={() => (r === "Confirmado" || r === "No contesta") ? registrar(g, r) : setModal({ g, resultado: r })}>{label}</button>
  );

  return (
    <div>
      {msg && <div className="amg-alert" style={okBox}><Check size={15} /> {msg}</div>}
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 12, marginBottom: 14 }}>
        <ui.StatCard label="Servicios por gestionar" value={lista.length} sub={`para el ${ui.fmtDate(fecha)}`} accent />
        <ui.StatCard label="Por llamar" value={conteo["Por llamar"]} sub={lista.length ? `${Math.round((conteo["Por llamar"] / lista.length) * 100)}% pendiente` : ""} />
        <ui.StatCard label="Confirmados" value={conteo.Confirmado} />
        <ui.StatCard label="No contestan" value={conteo["No contesta"]} />
        <ui.StatCard label="Cliente cancela" value={conteo.Cancela} />
        <ui.StatCard label="Cliente arma" value={conteo["Cliente arma"]} />
        <ui.StatCard label="Reprogramados" value={conteo.Reprogramado} />
      </div>

      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label style={{ fontSize: 12.5 }}>Fecha del servicio <input type="date" className="amg-input" style={{ width: 150 }} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} /></label>
        <input className="amg-input" style={{ width: 210 }} placeholder="Buscar servicio, cliente, teléfono..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <select className="amg-select" style={{ width: 190 }} value={f.tecnico} onChange={(e) => setF({ ...f, tecnico: e.target.value })}><option value="">Todos los técnicos</option><option value="__sin">Sin técnico</option>{tecnicos.map((t) => <option key={t}>{t}</option>)}</select>
        <select className="amg-select" style={{ width: 180 }} value={f.depto} onChange={(e) => setF({ ...f, depto: e.target.value })}><option value="">Todos los departamentos</option>{deptos.map((d) => <option key={d}>{d}</option>)}</select>
        <select className="amg-select" style={{ width: 160 }} value={f.estado} onChange={(e) => setF({ ...f, estado: e.target.value })}><option value="">Todo estado</option>{["Por llamar", ...P.RESULTADOS].map((x) => <option key={x}>{x}</option>)}</select>
        <button className="amg-btn" onClick={recargar} disabled={loading}><RotateCcw size={13} /> {loading ? "Actualizando..." : "Actualizar"}</button>
        <button className="amg-btn" onClick={exportar}><Download size={14} /> Exportar CSV</button>
      </div>
      {excluidosTv > 0 && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>{excluidosTv} servicio(s) con TV no aparecen aquí: se gestionan en Instalación de TV.</div>}

      <div className="amg-card" style={{ overflow: "auto", maxHeight: "calc(100vh - 400px)" }}>
        <table className="amg-table compact">
          <thead><tr><th>Técnico</th><th>Servicio</th><th>Cliente y teléfonos</th><th>Dirección</th><th>Productos</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {filas.map(({ g, est, tec }) => {
              const retirado = !!g.retirado;
              return (
                <tr key={g.servicio} style={retirado ? { background: "rgba(192,70,58,0.06)" } : undefined}>
                  <td style={{ fontSize: 12.5 }}>{tec || <span style={{ color: "var(--text-faint)" }}>Sin técnico</span>}{g.rutaOrden ? <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Parada {g.rutaOrden}</div> : null}</td>
                  <td className="amg-mono"><b>{g.servicio}</b></td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{g.cliente || "-"}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                      {g.telefonos.length === 0 && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{g.telefonoTxt || "Sin teléfono"}</span>}
                      {g.telefonos.map((n) => (
                        <span key={n} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5 }}>
                          <a href={urlLlamada(n)} style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)" }}><Phone size={12} /> {n}</a>
                          {telefonoWsp(n) && <a href={urlWsp(telefonoWsp(n), "")} target="_blank" rel="noreferrer" title="Abrir WhatsApp" style={{ color: "var(--green)", display: "inline-flex" }}><MessageCircle size={13} /></a>}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{g.direccion}<div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{[g.barrio, g.ciudad].filter(Boolean).join(" · ")}{g.senas ? ` · ${g.senas}` : ""}</div></td>
                  <td style={{ fontSize: 12.5 }}>{g.productos.map((p, i) => <div key={i}>{p}</div>)}</td>
                  <td style={{ minWidth: 150 }}>
                    <ui.Badge text={est.estado === "No contesta" ? `No contesta (${est.intentos})` : est.estado} color={est.estado === "Por llamar" ? "gray" : P.COLOR_RESULTADO[est.estado] || "gray"} />
                    {est.ultima && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>{est.ultima.created_by_name || ""} · {horaLocal(est.ultima.created_at)}{est.ultima.nueva_fecha ? ` · nueva fecha ${ui.fmtDate(est.ultima.nueva_fecha)}` : ""}</div>}
                    {est.ultima && est.ultima.nota && <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{est.ultima.nota}</div>}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {canEdit && (retirado
                      ? <button className="amg-btn" disabled={!!busy} style={{ padding: "3px 8px", fontSize: 12 }} title="Devolver el servicio a la asignación" onClick={() => deshacer(g)}><Undo2 size={12} /> Deshacer</button>
                      : <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", maxWidth: 330 }}>
                          <BtnR g={g} r="Confirmado" label="Confirmó" color="var(--green)" />
                          <BtnR g={g} r="No contesta" label="No contesta" />
                          <BtnR g={g} r="Cancela" label="Cancela" color="var(--red)" />
                          <BtnR g={g} r="Cliente arma" label="Cliente arma" color="var(--red)" />
                          <BtnR g={g} r="Reprogramado" label="Reprogramar" color="var(--red)" />
                        </span>)}
                  </td>
                </tr>
              );
            })}
            {!loading && filas.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{lista.length ? "Ningún servicio coincide con los filtros." : `No hay servicios asignados para el ${ui.fmtDate(fecha)}. Aparecen cuando se envía la asignación a Carga.`}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>{filas.length} servicio(s). Cancela, Cliente arma y Reprogramar sacan el servicio de la asignación (queda cancelado en Carga con la causal PREVENTIVA) y avisan a quienes asignan. Se actualiza solo cada 30 segundos.</div>

      {modal && <ResultadoModal ui={ui} hoy={hoy} fecha={fecha} g={modal.g} resultado={modal.resultado} tec={nombreTec(modal.g)} busy={!!busy} onClose={() => setModal(null)} onConfirm={(datos) => registrar(modal.g, modal.resultado, datos)} />}
    </div>
  );
}

function ResultadoModal({ ui, hoy, fecha, g, resultado, tec, busy, onClose, onConfirm }) {
  const [nota, setNota] = useState("");
  const [nuevaFecha, setNuevaFecha] = useState("");
  const repro = resultado === "Reprogramado";
  const valido = !repro || (nuevaFecha && nuevaFecha > hoy);
  return (
    <ui.Modal title={`${P.TEXTO_RESULTADO[resultado]}: servicio ${g.servicio}`} onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Volver</button><button className="amg-btn primary" disabled={!valido || busy} onClick={() => onConfirm({ nota, nuevaFecha })}>{busy ? "Guardando..." : "Confirmar"}</button></>}>
      <div style={{ fontSize: 13, marginBottom: 10 }}><b>{g.cliente}</b> · {g.productos.join(", ")}{tec ? ` · técnico ${tec}` : ""}</div>
      <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> Al confirmar, el servicio sale de la asignación del {ui.fmtDate(fecha)} (queda cancelado en Carga con la causal <b>{P.CAUSAL_PREVENTIVA[resultado]}</b>) y se avisa a quienes asignan.</div>
      {repro && <div style={{ marginBottom: 10 }}><label className="amg-label">Nueva fecha acordada con el cliente *</label><input type="date" className="amg-input" min={P.sumarDias(hoy, 1)} value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} /></div>}
      <label className="amg-label">Nota (opcional)</label>
      <textarea className="amg-textarea" rows={3} value={nota} onChange={(e) => setNota(e.target.value)} placeholder={repro ? "Motivo de la reprogramación..." : "Qué dijo el cliente..."} />
    </ui.Modal>
  );
}
