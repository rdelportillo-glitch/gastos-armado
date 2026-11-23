import { useState } from "react";
import { Upload, Check, AlertTriangle } from "lucide-react";
import { leerCsvAsignacion, planAsignacionCsv } from "./lib/asignacionCsv";

/* ============================================================================
   CARGAR LA ASIGNACIÓN (CSV) A CARGA
   Cuando "Enviar a Carga" no se hizo pero sí se descargó el CSV de la asignación, aquí se sube ese CSV: a los servicios que siguen Pendientes se les pone el técnico, el apoyo,
   el orden de ruta y el estado En gestión, igual que lo hace Enviar a Carga. Lo que ya está en Carga o ya se finalizó no se toca, y no se crea nada.
============================================================================ */

const ESTADO = {
  ok: ["Se asigna", "green"], parcial: ["Se asigna una parte", "amber"], ya: ["Ya está en Carga", "gray"], falta: ["No está en la base", "red"], "sin-tecnico": ["Sin técnico en el CSV", "gray"], error: ["Con error", "red"],
};

export default function AsignacionCsvModal({ ui, db, onConfirm, onClose }) {
  const [archivo, setArchivo] = useState("");
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");

  const elegir = async (file) => {
    if (!file) return;
    setError(""); setPlan(null); setHecho("");
    try {
      const buf = await file.arrayBuffer();
      let texto = new TextDecoder("utf-8").decode(buf);
      if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf); // CSV guardado con otra codificación
      const { filas } = leerCsvAsignacion(texto);
      setArchivo(file.name);
      setPlan(planAsignacionCsv({ filas, services: db.services, technicians: db.technicians }));
    } catch (e) { setError(e.message); setArchivo(""); }
  };
  const confirmar = async () => {
    setBusy(true); setError("");
    try { setHecho(await onConfirm(plan, archivo)); setPlan(null); } catch (e) { setError(e.message || String(e)); }
    setBusy(false);
  };

  const R = plan && plan.resumen;
  const detalle = (x) => {
    if (x.estado === "error") return x.errores.join(" ");
    const partes = [];
    if (x.estado === "ok" || x.estado === "parcial") partes.push(`${x.asignar.length} registro(s)${x.orden ? ` · ruta ${x.orden}` : ""}`);
    if (x.ya.length) partes.push(`ya en Carga/finalizado: ${x.ya.length} (${[...new Set(x.ya.map((y) => y.estado))].join(", ")})`);
    if (x.faltan) partes.push(`${x.faltan} sin registro en la base`);
    if (x.estado === "falta") partes.push("no está en Carga ni en Asignación");
    if (x.estado === "sin-tecnico") partes.push("se deja como está");
    return [...partes, ...x.avisos].join(" · ");
  };

  return (
    <ui.Modal title="Cargar la asignación (CSV) a Carga" onClose={busy ? () => {} : onClose} width={1000}
      footer={hecho ? <button className="amg-btn primary" onClick={onClose}>Cerrar</button> : <>
        <button className="amg-btn" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="amg-btn primary" disabled={busy || !R || R.registrosPorAsignar === 0} onClick={confirmar}><Check size={14} /> {busy ? "Cargando..." : R && R.registrosPorAsignar ? `Cargar ${R.porAsignar} servicio(s) a Carga` : "Cargar"}</button>
      </>}>
      {hecho ? (
        <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> {hecho}</div>
      ) : (
        <div style={{ fontSize: 13 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <label className="amg-btn" style={{ cursor: "pointer", display: "inline-flex", gap: 6, alignItems: "center" }}><Upload size={14} /> Subir el CSV de la asignación
              <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={(e) => { elegir(e.target.files[0]); e.target.value = ""; }} /></label>
            {archivo && <span className="amg-mono" style={{ fontSize: 12 }}>{archivo}</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.5 }}>
            Es el CSV que se descarga en Asignación. A los servicios que siguen <b>Pendientes</b> se les pone el técnico, el apoyo, el orden de ruta y el estado <b>En gestión</b>, igual que con «Enviar a Carga». Lo que ya está en Carga o ya se finalizó no se toca y no se crea ningún servicio: si alguno no está en la base, se avisa.
          </div>
          {error && <div className="amg-alert danger" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> {error}</div>}
          {R && (
            <>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
                <span><b className="amg-mono">{R.servicios}</b> servicios · <b className="amg-mono">{R.productos}</b> productos en el archivo</span>
                <span style={{ color: "var(--green)" }}><b className="amg-mono">{R.porAsignar}</b> se asignan ({R.registrosPorAsignar} registros, {R.tecnicos} técnicos)</span>
                {R.yaEnCarga > 0 && <span>{R.yaEnCarga} ya en Carga</span>}
                {R.noEncontrados > 0 && <span style={{ color: "var(--red)" }}>{R.noEncontrados} no están en la base</span>}
                {R.sinTecnico > 0 && <span>{R.sinTecnico} sin técnico (se dejan)</span>}
                {R.conError > 0 && <span style={{ color: "var(--red)" }}>{R.conError} con error</span>}
              </div>
              <div className="amg-card" style={{ overflow: "auto", maxHeight: 380 }}>
                <table className="amg-table compact">
                  <thead><tr><th>Servicio</th><th>Técnico</th><th>Apoyo</th><th>Prod.</th><th>Resultado</th><th>Detalle</th></tr></thead>
                  <tbody>
                    {[...plan.items].sort((a, b) => ({ error: 0, falta: 1, parcial: 2, ya: 3, "sin-tecnico": 4, ok: 5 }[a.estado] - { error: 0, falta: 1, parcial: 2, ya: 3, "sin-tecnico": 4, ok: 5 }[b.estado])).map((x) => (
                      <tr key={x.servicio}>
                        <td className="amg-mono">{x.servicio}</td>
                        <td>{x.tecnico ? x.tecnico.name : x.tecnicoTxt || <span style={{ color: "var(--text-faint)" }}>-</span>}</td>
                        <td>{x.apoyo ? x.apoyo.name : x.apoyoTxt || "-"}</td>
                        <td className="amg-mono">{x.unidades}</td>
                        <td><ui.Badge text={ESTADO[x.estado][0]} color={ESTADO[x.estado][1]} /></td>
                        <td style={{ fontSize: 11.5, color: x.estado === "error" ? "var(--red)" : "var(--text-dim)" }}>{detalle(x)}</td>
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
