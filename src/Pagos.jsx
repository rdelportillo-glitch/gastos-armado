import { useState } from "react";
import { PagoViaticos, PlantillaPago } from "./ViaticosPago";
import BancoTab from "./Banco";

/* ============================================================================
   PAGOS (categoría Gastos)
   Pestaña Pagos: viáticos del día anterior y pico y placa del día (con el check de pagado, que crea los gastos) y los gastos registrados de la fecha de pago.
   Pestaña Planilla de pago: suma de los gastos de la fecha de pago por persona o proveedor, en el formato del archivo de pagos al banco.
   Pestaña Banco: carga del archivo de movimientos del banco (costos financieros a Gastos) y saldo del banco.
============================================================================ */

export default function PagosModule({ db, persist, addAudit, session, ui }) {
  const [tab, setTab] = useState("pagos");
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap" }}>
        <div className={`amg-tab ${tab === "pagos" ? "active" : ""}`} onClick={() => setTab("pagos")}>Pagos</div>
        <div className={`amg-tab ${tab === "planilla" ? "active" : ""}`} onClick={() => setTab("planilla")}>Planilla de pago</div>
        <div className={`amg-tab ${tab === "banco" ? "active" : ""}`} onClick={() => setTab("banco")}>Banco</div>
      </div>
      {tab === "pagos" && <PagoViaticos db={db} persist={persist} addAudit={addAudit} session={session} ui={ui} />}
      {tab === "planilla" && <PlantillaPago db={db} persist={persist} addAudit={addAudit} session={session} ui={ui} />}
      {tab === "banco" && <BancoTab db={db} persist={persist} addAudit={addAudit} session={session} ui={ui} />}
    </div>
  );
}
