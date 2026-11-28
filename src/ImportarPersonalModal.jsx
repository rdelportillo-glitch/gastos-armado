import { useState } from "react";
import * as XLSX from "xlsx";
import { Download, Upload, Check, AlertTriangle } from "lucide-react";
import { libroPlantilla, leerFilas, validarPersonal } from "./lib/importarPersonal";

/* ============================================================================
   IMPORTAR PERSONAS (Personal)
   Paso 1: descargar la plantilla (trae ejemplos que no se cargan, instrucciones y listas). Paso 2: subir el archivo y revisar.
   Paso 3: crear solo las que están listas; las que ya existen (por documento o nombre) y las que tienen errores no se tocan.
============================================================================ */

const TEXTO = { ok: "Lista", error: "Con errores", existe: "Ya existe", ejemplo: "Ejemplo" };
const COLOR = { ok: "green", error: "red", existe: "gray", ejemplo: "blue" };

export default function ImportarPersonalModal({ ui, listas, existentes, onConfirm, onClose }) {
  const [archivo, setArchivo] = useState("");
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");
  const [busy, setBusy] = useState(false);

  const bajar = () => { setError(""); try { XLSX.writeFile(libroPlantilla(listas, ui.todayISO()), "Plantilla_personal.xlsx"); } catch (e) { setError(`No se pudo generar la plantilla: ${e.message}`); } };
  const elegir = async (file) => {
    if (!file) return;
    setError(""); setRes(null); setHecho("");
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const filas = validarPersonal(leerFilas(wb, listas), { listas, existentes, hoy: ui.todayISO() });
      if (!filas.length) throw new Error("El archivo no tiene personas.");
      setArchivo(file.name); setRes(filas);
    } catch (e) { setError(e.message); setArchivo(""); }
  };
  const listas_ok = (res || []).filter((r) => r.estado === "ok");
  const cuenta = (k) => (res || []).filter((r) => r.estado === k).length;
  const confirmar = async () => {
    setBusy(true); setError("");
    try { setHecho(await onConfirm(listas_ok.map((r) => r.persona))); setRes(null); }
    catch (e) { setError(e.message || String(e)); }
    setBusy(false);
  };

  return (
    <ui.Modal title="Importar personas" onClose={busy ? () => {} : onClose} width={1000}
      footer={hecho ? <button className="amg-btn primary" onClick={onClose}>Cerrar</button> : <>
        <button className="amg-btn" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="amg-btn primary" disabled={busy || !listas_ok.length} onClick={confirmar}><Check size={14} /> {busy ? "Creando..." : listas_ok.length ? `Crear ${listas_ok.length} persona(s)` : "Crear"}</button>
      </>}>
      {hecho ? (
        <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {hecho}</div>
      ) : (
        <div style={{ fontSize: 13 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <button className="amg-btn" onClick={bajar} title="Excel con las columnas, dos ejemplos, instrucciones y las listas de valores válidos"><Download size={14} /> 1. Descargar plantilla</button>
            <label className="amg-btn" style={{ cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}><Upload size={14} /> 2. Subir el archivo (.xlsx)
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { elegir(e.target.files[0]); e.target.value = ""; }} />
            </label>
            {archivo && <span style={{ color: "var(--text-dim)" }}>{archivo}</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.6 }}>
            Una fila por persona. Solo es obligatorio el <b>NOMBRE COMPLETO</b>; el código lo pone la plataforma y las personas quedan <b>activas</b>. Las filas de ejemplo no se cargan.
            Si el documento o el nombre ya existen, esa fila no se crea ni modifica a la persona.
          </div>
          {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
          {res && (
            <>
              <div style={{ marginBottom: 8 }}>
                <b>{res.length}</b> fila(s): <span style={{ color: "var(--green)" }}><b>{cuenta("ok")}</b> listas</span> · <span style={{ color: cuenta("error") ? "var(--red)" : undefined }}><b>{cuenta("error")}</b> con errores</span> · <b>{cuenta("existe")}</b> ya existen{cuenta("ejemplo") ? ` · ${cuenta("ejemplo")} de ejemplo (no se cargan)` : ""}.
                {cuenta("error") > 0 && " Corrige los errores en el archivo y vuelve a subirlo para crear las demás."}
              </div>
              <div style={{ overflow: "auto", maxHeight: 380 }}>
                <table className="amg-table compact" style={{ fontSize: 12.5 }}>
                  <thead><tr><th>Fila</th><th>Nombre</th><th>Documento</th><th>Categoría</th><th>Cargo</th><th>Departamento · ciudad</th><th>Contrato</th><th>Estado</th></tr></thead>
                  <tbody>
                    {res.map((r) => (
                      <tr key={r.fila} style={r.estado === "ejemplo" || r.estado === "existe" ? { opacity: 0.6 } : undefined}>
                        <td className="amg-mono">{r.fila}</td><td style={{ fontWeight: 600 }}>{r.nombre || "-"}</td><td className="amg-mono">{r.persona.document || "-"}</td>
                        <td>{r.persona.category}</td><td>{r.persona.type}</td><td>{[r.persona.department, r.persona.city].filter(Boolean).join(" · ") || "-"}</td><td>{r.persona.contractType || "-"}</td>
                        <td style={{ maxWidth: 300, whiteSpace: "normal" }}>
                          <ui.Badge text={TEXTO[r.estado]} color={COLOR[r.estado]} />
                          {r.errores.map((e, k) => <div key={k} style={{ fontSize: 11, color: r.estado === "error" ? "var(--red)" : "var(--text-faint)" }}>{e}</div>)}
                          {r.estado === "ok" && r.avisos.map((e, k) => <div key={k} style={{ fontSize: 11, color: "var(--accent)" }}>{e}</div>)}
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
