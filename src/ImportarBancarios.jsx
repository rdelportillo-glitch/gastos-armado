import { useState, useMemo } from "react";
import { Upload, AlertTriangle, Check } from "lucide-react";
import { leerHojaPagos, plano } from "./lib/hojaPagos";

// Importar los datos bancarios de Personal desde la hoja de pagos (el mismo Excel de proveedores): tipo de identificación, banco destino, tipo y número de cuenta, nombre y apellido del
// titular y, si falta, el número de identificación (Documento). Cada fila se cruza con Personal por nombre (sin tildes; el guion bajo cuenta como espacio), por usuario Extreme o, si el número
// de identificación no se repite en la hoja, por Documento. Solo se llena lo que está vacío; lo que ya tiene un valor distinto se marca como conflicto y solo se cambia si se pide.
// Los datos viajan del Excel directo a la base: no se guardan en el código ni en el repositorio.

const nombreN = (s) => plano(String(s || "").replace(/_/g, " "));
const digitos = (s) => String(s || "").replace(/\D/g, "");
const TIPO_CUENTA = { CA: "Ahorros", CC: "Corriente", DP: "Daviplata" };
const CAMPOS = [
  ["idType", "Tipo de identificación"], ["document", "Documento"], ["bankCode", "Banco destino"], ["bankAccountType", "Tipo de cuenta"], ["bankAccount", "Número de cuenta"],
  ["holderFirstName", "Nombre del titular"], ["holderLastName", "Apellido del titular"],
];

export default function ImportarBancarios({ ui, db, persist, addAudit, session, onClose }) {
  const [filas, setFilas] = useState(null);
  const [sobrescribir, setSobrescribir] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");

  const leer = async (file) => {
    setError(""); setHecho("");
    try {
      const todas = leerHojaPagos(await file.arrayBuffer());
      if (!todas.length) { setError("El archivo no trae filas."); return; }
      setFilas(todas);
    } catch (e) { setError(e.message || String(e)); }
  };

  const analisis = useMemo(() => {
    if (!filas) return null;
    const vistos = new Set();
    const base = filas.filter((f) => { const k = [f.name, f.idNumber, f.accountNumber].map(plano).join("|"); if (vistos.has(k)) return false; vistos.add(k); return true; });
    const contDoc = {}; base.forEach((f) => { const d = digitos(f.idNumber); if (d) contDoc[d] = (contDoc[d] || 0) + 1; });
    return base.map((f) => {
      const n = nombreN(f.name), d = digitos(f.idNumber);
      const cand = new Map();
      db.technicians.forEach((t) => {
        if (nombreN(t.name) === n) cand.set(t.id, { t, por: "nombre" });
        else if (t.extremeUser && nombreN(t.extremeUser) === n) cand.set(t.id, { t, por: "usuario Extreme" });
        else if (d && contDoc[d] === 1 && digitos(t.document) === d) cand.set(t.id, { t, por: "documento" });
      });
      if (cand.size !== 1) return { f, estado: cand.size === 0 ? "Sin coincidencia" : "Varias coincidencias", llena: [], conflictos: [] };
      const { t, por } = [...cand.values()][0];
      const nuevo = {
        idType: f.idType, document: f.idNumber, bankCode: f.bankCode, bankAccountType: TIPO_CUENTA[f.accountType] || "", bankAccount: f.accountNumber,
        holderFirstName: f.holderFirstName.toUpperCase(), holderLastName: f.holderLastName.toUpperCase(),
      };
      const llena = [], conflictos = [];
      CAMPOS.forEach(([k, label]) => {
        const nv = String(nuevo[k] || "").trim(), ev = String(t[k] || "").trim();
        if (!nv || nv === ev) return;
        if (!ev) llena.push([k, label, nv]); else conflictos.push([k, label, nv]);
      });
      return { f, estado: "Coincide", t, por, llena, conflictos, nuevo };
    });
  }, [filas, db.technicians]);

  const aplicables = (analisis || []).filter((a) => a.t && (a.llena.length || (sobrescribir && a.conflictos.length)));
  const sinCoincidencia = (analisis || []).filter((a) => !a.t);
  const conConflicto = (analisis || []).filter((a) => a.t && a.conflictos.length);

  const aplicar = () => {
    const cambios = new Map(aplicables.map((a) => [a.t.id, [...a.llena, ...(sobrescribir ? a.conflictos : [])]]));
    const technicians = db.technicians.map((t) => (cambios.has(t.id) ? { ...t, ...Object.fromEntries(cambios.get(t.id).map(([k, , v]) => [k, v])) } : t));
    // En la auditoría solo van conteos y nombres; los números de cuenta y de identificación no se copian.
    persist(addAudit({ ...db, technicians }, { userId: session.id, action: "Importación de datos bancarios de Personal", record: `${cambios.size} personas`, oldValue: "-", newValue: [...cambios.keys()].map((id) => (db.technicians.find((t) => t.id === id) || {}).name).join(", ").slice(0, 300) }));
    setHecho(`Se actualizaron los datos bancarios de ${cambios.size} persona(s).`);
    setFilas(null);
  };

  return (
    <ui.Modal title="Importar datos bancarios de Personal" onClose={onClose} width={860}
      footer={<><button className="amg-btn" onClick={onClose}>Cerrar</button>{analisis && <button className="amg-btn primary" disabled={!aplicables.length} onClick={aplicar}>Actualizar {aplicables.length} persona(s)</button>}</>}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        Sube la hoja de pagos (la misma de proveedores: ID, TIPO DE IDENTIFICACION, NUMERO IDENTIFICACION, NOMBRE DEL TITULAR, APELLIDO DEL TITULAR, BANCO DESTINO, TIPO DE CUENTA, NUMERO CUENTA).
        Cada fila se cruza con Personal por nombre, usuario Extreme o documento y solo se llena lo que está vacío.
      </div>
      <label className="amg-btn" style={{ cursor: "pointer" }}><Upload size={14} /> Elegir archivo<input type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) leer(f); }} /></label>
      {error && <div className="amg-alert danger" style={{ marginTop: 10 }}><AlertTriangle size={14} /> {error}</div>}
      {hecho && <div className="amg-alert" style={{ marginTop: 10, background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={14} /> {hecho}</div>}
      {analisis && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            {analisis.length} fila(s): <b>{analisis.filter((a) => a.t).length}</b> coinciden con alguien de Personal, <b>{sinCoincidencia.length}</b> sin coincidencia, <b>{aplicables.length}</b> con datos por llenar
            {conConflicto.length > 0 && <>, <span style={{ color: "var(--accent)" }}>{conConflicto.length} con valores distintos a los que ya tienen</span></>}.
          </div>
          {conConflicto.length > 0 && <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginBottom: 8 }}><input type="checkbox" checked={sobrescribir} onChange={(e) => setSobrescribir(e.target.checked)} /> Reemplazar también lo que ya tienen (los valores distintos)</label>}
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            <table className="amg-table compact" style={{ fontSize: 12 }}>
              <thead><tr><th>Fila de la hoja</th><th>Persona de Personal</th><th>Se llena</th><th>Distinto al actual</th></tr></thead>
              <tbody>{analisis.map((a, i) => (
                <tr key={i}>
                  <td>{a.f.name}</td>
                  <td>{a.t ? <>{a.t.name} <span style={{ color: "var(--text-faint)" }}>· por {a.por}</span></> : <span style={{ color: "var(--red)" }}>{a.estado}</span>}</td>
                  <td>{a.t ? (a.llena.length ? a.llena.map(([, l]) => l).join(", ") : <span style={{ color: "var(--text-faint)" }}>nada (ya está completo)</span>) : ""}</td>
                  <td style={{ color: "var(--accent)" }}>{a.conflictos.map(([, l]) => l).join(", ")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {sinCoincidencia.length > 0 && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>Las filas sin coincidencia pueden ser proveedores (se importan en el módulo Proveedores) o personas cuyo nombre en Personal es distinto: corrígelo en Personal y vuelve a importar.</div>}
        </div>
      )}
    </ui.Modal>
  );
}
