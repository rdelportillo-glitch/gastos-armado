import { useState, useMemo } from "react";
import { Check, AlertTriangle, MessageCircle } from "lucide-react";
import { telefonoWsp, mensajeCancelacion, urlWsp } from "./lib/whatsapp";

export const CAUSAL_CANCELA = "CLIENTE CANCELA";
const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

// Números de servicio dentro de un texto pegado (de un correo o de Excel): cualquier número de 5 o más dígitos; lo demás (consecutivos de fila,
// agencia, etc.) se ignora. Sin repetidos y en el orden en que vienen.
export function numerosDeServicio(texto) {
  return [...new Set(String(texto || "").match(/\d{5,}/g) || [])];
}

// Cancelación masiva: Jamar avisa por la mañana qué servicios se cancelaron. Se pegan los números, se revisa qué técnico lleva cada uno,
// se cancelan juntos (causal CLIENTE CANCELA) y se avisa a cada técnico por WhatsApp.
export default function CancelarMasivoModal({ Modal, db, registros, causalActiva, onConfirm, onClose }) {
  const [texto, setTexto] = useState("");
  const [revisado, setRevisado] = useState(null); // { numeros } tras pulsar Revisar
  const [hecho, setHecho] = useState(null); // grupos por técnico, tras cancelar
  const [aviso, setAviso] = useState("");

  const techById = useMemo(() => Object.fromEntries(db.technicians.map((t) => [t.id, t])), [db.technicians]);
  const techPorNombre = (n) => (n ? db.technicians.find((t) => plano(t.name) === plano(n)) : null);

  // Qué hay en Carga para cada número: coincide con el servicio o con el número de PQR (armados en almacén).
  const filas = useMemo(() => (revisado ? revisado.numeros.map((n) => {
    const regs = registros.filter((s) => String(s.servicioExterno) === n || String((s.asig && s.asig.pqrNumero) || "") === n);
    const hechos = regs.filter((s) => (s.estadoGestion || "Realizado") === "Realizado" || s.estadoExtreme === "Realizado");
    const yaCanceladas = regs.filter((s) => s.asig && s.asig.cancelada);
    const porCancelar = regs.filter((s) => !hechos.includes(s) && !yaCanceladas.includes(s));
    const tecnicos = [...new Set(regs.map((s) => (techById[s.technicianId] || {}).name || s.tecnico2Nombre).filter(Boolean))];
    const estado = !regs.length ? "No está en Carga" : porCancelar.length ? "Se cancela" : yaCanceladas.length ? "Ya estaba cancelado" : "Ya realizado: no se cancela";
    return { n, regs, porCancelar, tecnicos, cliente: (regs[0] || {}).clienteNombre || "", estado };
  }) : []), [revisado, registros, techById]);

  const aCancelar = filas.filter((f) => f.porCancelar.length);
  const idsCancelar = aCancelar.flatMap((f) => f.porCancelar.map((s) => s.id));

  const revisar = () => { setAviso(""); setHecho(null); const numeros = numerosDeServicio(texto); setRevisado(numeros.length ? { numeros } : null); if (!numeros.length) setAviso("No encontré números de servicio en el texto. Pega los números (de 5 o más dígitos)."); };

  const confirmar = () => {
    // Técnico (titular y apoyo) → servicios que cancelaron, para avisarle por WhatsApp.
    const porTecnico = new Map();
    const agregar = (t, f) => { if (!t) return; const g = porTecnico.get(t.id) || { t, servicios: [] }; if (!g.servicios.some((x) => x.n === f.n)) g.servicios.push({ n: f.n, regs: f.porCancelar }); porTecnico.set(t.id, g); };
    const sinTecnico = [];
    aCancelar.forEach((f) => {
      let tuvo = false;
      f.porCancelar.forEach((s) => { const t = techById[s.technicianId]; if (t) { agregar(t, f); tuvo = true; } const ap = techPorNombre(s.tecnico3Nombre); if (ap) { agregar(ap, f); tuvo = true; } });
      if (!tuvo) sinTecnico.push(f.n);
    });
    onConfirm(idsCancelar, aCancelar.map((f) => f.n));
    setHecho({ grupos: [...porTecnico.values()], sinTecnico });
  };

  const wsp = (g) => {
    const tel = telefonoWsp(g.t.phone);
    if (!tel) { setAviso(`${g.t.name} no tiene un teléfono válido en Personal (${g.t.phone || "vacío"}).`); return; }
    setAviso("");
    window.open(urlWsp(tel, mensajeCancelacion(g.t.name, g.servicios)), "_blank", "noopener");
  };

  return (
    <Modal title="Cancelar servicios en masa (Jamar)" onClose={onClose} width={820}
      footer={hecho ? <button className="amg-btn primary" onClick={onClose}>Cerrar</button> : <>
        <button className="amg-btn" onClick={onClose}>Cancelar</button>
        <button className="amg-btn primary" disabled={!idsCancelar.length} onClick={confirmar}>{idsCancelar.length ? `Cancelar ${aCancelar.length} servicio(s) · ${idsCancelar.length} registro(s)` : "Cancelar servicios"}</button>
      </>}>
      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
        {!hecho && (
          <>
            <label className="amg-label">Servicios que Jamar canceló (pega los números, uno por línea o como vengan)</label>
            <textarea className="amg-textarea" rows={5} value={texto} onChange={(e) => { setTexto(e.target.value); setRevisado(null); }} placeholder={"5275075\n5273975\n5273363"} />
            <div style={{ marginTop: 8 }}><button className="amg-btn" disabled={!texto.trim()} onClick={revisar}>Revisar</button></div>
            {aviso && <div className="amg-alert danger" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {aviso}</div>}
            {revisado && (
              <div style={{ marginTop: 12 }}>
                <div style={{ overflowX: "auto", maxHeight: 300, overflowY: "auto" }}>
                  <table className="amg-table" style={{ fontSize: 12.5 }}>
                    <thead><tr><th>Servicio</th><th>Cliente</th><th>Productos</th><th>Técnico</th><th>Resultado</th></tr></thead>
                    <tbody>{filas.map((f) => (
                      <tr key={f.n}>
                        <td className="amg-mono">{f.n}</td><td>{f.cliente || "-"}</td><td className="amg-mono">{f.regs.length}</td><td>{f.tecnicos.join(", ") || "-"}</td>
                        <td style={{ color: f.estado === "Se cancela" ? "var(--red)" : "var(--text-dim)", fontWeight: f.estado === "Se cancela" ? 600 : 400 }}>{f.estado}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 8 }}>
                  {revisado.numeros.length} número(s): {aCancelar.length} se cancelan, {filas.filter((f) => !f.regs.length).length} no están en Carga (pueden estar pendientes en Asignación o ya finalizados), {filas.filter((f) => f.regs.length && !f.porCancelar.length).length} ya estaban cancelados o realizados.
                </div>
                {aCancelar.length > 0 && !causalActiva && <div className="amg-alert danger" style={{ marginTop: 8 }}><AlertTriangle size={14} /> La causal "{CAUSAL_CANCELA}" no está activa en Maestros → Causales; se guarda igual, pero conviene activarla.</div>}
                {aCancelar.length > 0 && <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 6 }}>Al cancelar: Estado Extreme "No realizado", causal auditada "{CAUSAL_CANCELA}" y el registro queda marcado como cancelado (no vuelve a Asignación). Al finalizar el día se archiva en el histórico como no realizado.</div>}
              </div>
            )}
          </>
        )}
        {hecho && (
          <div>
            <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> Se cancelaron {aCancelar.length} servicio(s) ({idsCancelar.length} registros).</div>
            {aviso && <div className="amg-alert danger" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {aviso}</div>}
            <div style={{ fontWeight: 600, margin: "12px 0 6px" }}>Avisar a los técnicos por WhatsApp</div>
            {hecho.grupos.length === 0 && <div style={{ color: "var(--text-dim)" }}>Ninguno de estos servicios tenía técnico asignado.</div>}
            {hecho.grupos.map((g) => (
              <div key={g.t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ flex: 1 }}><b>{g.t.name}</b> <span style={{ color: "var(--text-dim)", fontSize: 12.5 }}>· {g.servicios.length} servicio(s): {g.servicios.map((s) => s.n).join(", ")}</span></div>
                <button className="amg-btn" onClick={() => wsp(g)}><MessageCircle size={14} color="#25a244" /> WhatsApp</button>
              </div>
            ))}
            {hecho.sinTecnico.length > 0 && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 8 }}>Sin técnico asignado (no hay a quién avisar): {hecho.sinTecnico.join(", ")}.</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}
