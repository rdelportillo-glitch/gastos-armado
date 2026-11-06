import { useState, useEffect } from "react";
import { Download, Upload, Check, AlertTriangle } from "lucide-react";
import { loadMasters } from "./lib/asignacion/data";
import { descargarPlantilla, leerArchivo, validarYAgrupar, COLUMNAS } from "./lib/cargaMasiva";

/* ============================================================================
   CARGA MASIVA DE SERVICIOS (Carga y Programación)
   Una sola plantilla transversal (Jamar, Tugo, particulares...). Paso 1: descargar la plantilla (trae filas de ejemplo que sí cargan). Paso 2: subir el archivo y revisar
   qué servicios están listos, cuáles tienen errores y cuáles ya existen. Paso 3: cargar solo los que están listos.
============================================================================ */

export default function CargaMasivaModal({ ui, modulo, existentes, tecnicos, onConfirm, onClose }) {
  const prog = modulo === "programacion";
  const [masters, setMasters] = useState(null);
  const [archivo, setArchivo] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");

  useEffect(() => { loadMasters().then(setMasters).catch((e) => setError(`No se pudieron leer los maestros: ${e.message}`)); }, []);

  const bajar = async () => {
    setError("");
    try { await descargarPlantilla({ masters, tecnicos, hoy: ui.todayISO() }); } catch (e) { setError(`No se pudo generar la plantilla: ${e.message}`); }
  };
  const elegir = async (file) => {
    if (!file) return;
    setError(""); setRes(null); setHecho("");
    try {
      const filas = await leerArchivo(file);
      setArchivo(file.name);
      setRes(validarYAgrupar(filas, { modulo, masters, tecnicos, existentes, hoy: ui.todayISO() }));
    } catch (e) { setError(e.message); setArchivo(""); }
  };
  const confirmar = async () => {
    setBusy(true); setError("");
    try { setHecho(await onConfirm(res.listos, { masters })); setRes(null); }
    catch (e) { setError(e.message || String(e)); }
    setBusy(false);
  };

  const color = { ok: "green", error: "red", omitido: "gray" };
  const texto = { ok: "Listo", error: "Con errores", omitido: "Ya existe" };
  const productos = (g) => g.productos.map((p) => `${p.nombre}${p.cantidad > 1 ? ` ×${p.cantidad}` : ""}`).join(", ");

  return (
    <ui.Modal title={prog ? "Programar servicios en masa" : "Cargar servicios en masa (Carga)"} onClose={busy ? () => {} : onClose} width={1100}
      footer={hecho ? <button className="amg-btn primary" onClick={onClose}>Cerrar</button> : <>
        <button className="amg-btn" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="amg-btn primary" disabled={busy || !res || res.listos.length === 0} onClick={confirmar}><Check size={14} /> {busy ? "Cargando..." : res && res.listos.length ? `${prog ? "Programar" : "Cargar"} ${res.listos.length} servicio(s)` : "Cargar"}</button>
      </>}>
      {hecho ? (
        <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {hecho}</div>
      ) : (
        <div style={{ fontSize: 13 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <button className="amg-btn" disabled={!masters} onClick={bajar} title="Excel con las columnas, instrucciones y filas de ejemplo que cargan con los datos de los maestros"><Download size={14} /> 1. Descargar plantilla</button>
            <label className="amg-btn" style={{ cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}><Upload size={14} /> 2. Subir el archivo (.xlsx)
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} disabled={!masters} onChange={(e) => { elegir(e.target.files[0]); e.target.value = ""; }} />
            </label>
            {archivo && <span style={{ color: "var(--text-dim)" }}>{archivo}</span>}
            {!masters && !error && <span style={{ color: "var(--text-faint)" }}>Cargando maestros...</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.6 }}>
            Una sola plantilla para Jamar, Tugo, particulares y otras empresas: una fila por producto, y las filas con el mismo <b>SERVICIO</b> son un solo servicio con varios productos.
            {prog ? " Cada servicio se crea como orden (PS-000001...) y se envía a Asignación, igual que al programarlo uno por uno." : " Cada servicio entra a Carga En gestión con el TECNICO (y APOYO) indicado."}
            {" "}Obligatorias aquí: {COLUMNAS.filter((c) => (prog ? c.prog : c.carga).startsWith("Obligatoria")).map((c) => c.header).join(", ")}, y PRODUCTO o CÓDIGO.
          </div>
          {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}

          {res && (
            <>
              <div style={{ marginBottom: 8 }}>
                <b>{res.listos.length + res.conError.length + res.omitidos.length}</b> servicio(s) en el archivo:{" "}
                <span style={{ color: "var(--green)" }}><b>{res.listos.length}</b> listos</span> · <span style={{ color: res.conError.length ? "var(--red)" : undefined }}><b>{res.conError.length}</b> con errores</span> · <b>{res.omitidos.length}</b> ya existen.
                {res.conError.length > 0 && " Solo se cargan los listos; corrige los errores en el archivo y vuelve a subirlo para los demás."}
              </div>
              <div style={{ overflow: "auto", maxHeight: 380 }}>
                <table className="amg-table" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Servicio</th><th>Empresa</th><th>Fecha</th><th>Cliente</th><th>Ciudad · barrio</th><th>Productos</th><th>Min</th><th>{prog ? "Tipo" : "Técnico"}</th><th>Estado</th></tr></thead>
                  <tbody>
                    {res.grupos.map((g, i) => (
                      <tr key={i} style={g.estado === "omitido" ? { opacity: 0.6 } : undefined}>
                        <td className="amg-mono">{g.servicio || "-"}<div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>fila(s) {g.filas.join(", ")}</div></td>
                        <td>{g.empresa}</td><td className="amg-mono" style={{ whiteSpace: "nowrap" }}>{g.fecha ? ui.fmtDate(g.fecha) : "-"}</td>
                        <td style={{ maxWidth: 160, whiteSpace: "normal" }}>{g.cliente || "-"}</td>
                        <td style={{ maxWidth: 170, whiteSpace: "normal" }}>{g.ciudad || "-"}{g.barrio ? ` · ${g.barrio}` : ""}</td>
                        <td style={{ maxWidth: 230, whiteSpace: "normal" }} title={productos(g)}>{g.productos.length ? `${g.unidades} unid.: ${productos(g)}`.slice(0, 90) : "-"}</td>
                        <td className="amg-mono">{g.minutos || "-"}</td>
                        <td>{prog ? g.tipoSolicitud || "-" : (g.tecnico ? g.tecnico.name : g.tecnicoTxt || "-")}{!prog && g.apoyo ? <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>apoyo: {g.apoyo.name}</div> : null}</td>
                        <td style={{ maxWidth: 280, whiteSpace: "normal" }}>
                          <ui.Badge text={texto[g.estado]} color={color[g.estado]} />
                          {g.estado === "omitido" && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>ya está {prog ? "en una orden de Programación" : "en Carga o Asignación"}</div>}
                          {g.errores.map((e, k) => <div key={k} style={{ fontSize: 11, color: "var(--red)" }}>{e}</div>)}
                          {g.estado === "ok" && g.avisos.map((e, k) => <div key={k} style={{ fontSize: 11, color: "var(--accent)" }}>{e}</div>)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </ui.Modal>
  );
}
