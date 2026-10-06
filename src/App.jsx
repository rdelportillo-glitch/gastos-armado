import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  LayoutDashboard, FilePlus2, History, HardHat, FolderTree, Package,
  UserCog, BarChart3, Settings, LogOut, Menu, Search, X, Pencil, Check,
  AlertTriangle, ChevronDown, ChevronRight, Paperclip, Filter, Download,
  Wrench, Ban, RotateCcw, Plus, ShieldAlert, CircleDot, Upload, FileDown,
  ListChecks, Gauge, Boxes, PackagePlus, PackageMinus, Database, MapPin,
} from "lucide-react";
import AsignacionModule from "./Asignacion";
import { assignmentReport } from "./lib/asignacion/data";

import { supabase } from "./lib/supabaseClient";
import * as api from "./lib/api";
import * as maestrosApi from "./lib/maestrosApi";
import { readWorkbook as readMaestroWorkbook, parseZonasBarrios, parseProductos } from "./lib/maestrosParsers";
import { DEPARTAMENTOS_CO, CITIES_BY_DEPARTMENT } from "./lib/colombiaData";
import * as XLSX from "xlsx";

/* ============================================================================
   CONSTANTES Y UTILIDADES
============================================================================ */

const MESES_ES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const MESES_LARGO = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const uid = () => crypto.randomUUID();
const pad2 = (n) => String(n).padStart(2, "0");
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (dateStr) => (dateStr || "").slice(0, 7);
const yearOf = (dateStr) => (dateStr || "").slice(0, 4);
const fmtCOP = (n) => "$ " + Math.round(n || 0).toLocaleString("es-CO");
const fmtDate = (d) => {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return `${MESES_ES[parseInt(m, 10) - 1]} ${y.slice(2)}`;
};
const last12MonthKeys = () => {
  const arr = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  return arr;
};
const currentYearMonths = () => {
  const y = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, i) => `${y}-${pad2(i + 1)}`);
};

function downloadCSV(filename, headers, rows) {
  const esc = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(";"), ...rows.map((r) => r.map(esc).join(";"))];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const CHART_COLORS = ["#D98D34", "#4C7EC9", "#3F9D6E", "#A9744F", "#D9534F", "#4FB8AE", "#E0B84B", "#6B5D4D"];

/* ---- Inventario de insumos ----
   Un "insumo con inventario" es un insumo del catálogo marcado "Controla
   inventario" (clave "p:<id>") o, para lo que ya existía, una subcategoría
   completa con esa marca (clave "s:<id>"). Cada movimiento de stock cuenta en
   exactamente uno: en el insumo si el insumo del movimiento lleva inventario,
   y si no, en su subcategoría. */

function movementItemKeyFn(db) {
  const prods = Object.fromEntries((db.products || []).map((p) => [p.id, p]));
  return (m) => (m.productId && prods[m.productId]?.trackStock ? `p:${m.productId}` : `s:${m.subcategoryId}`);
}

function inventoryItems(db, includeInactive = false) {
  const subById = Object.fromEntries(db.subcategories.map((s) => [s.id, s]));
  const items = [];
  db.products.filter((p) => p.trackStock && (includeInactive || p.active)).forEach((p) => {
    items.push({ key: `p:${p.id}`, label: p.name, sublabel: subById[p.subcategoryId]?.name || "", subcategoryId: p.subcategoryId, productId: p.id });
  });
  db.subcategories.filter((s) => s.trackStock && (includeInactive || s.active)).forEach((s) => {
    items.push({ key: `s:${s.id}`, label: s.name, sublabel: "Subcategoría completa", subcategoryId: s.id, productId: null });
  });
  return items.sort((a, b) => a.label.localeCompare(b.label, "es"));
}

function stockOfItem(db, itemKey, excludeMovementId) {
  const keyOf = movementItemKeyFn(db);
  let total = 0;
  (db.stockMovements || []).forEach((m) => {
    if (m.status === "Anulado" || m.id === excludeMovementId || keyOf(m) !== itemKey) return;
    total += m.type === "Compra" ? m.quantity : m.type === "Entrega" ? -m.quantity : 0;
  });
  return total;
}

// Nombre con que se muestra el insumo de un movimiento (el insumo si lleva
// inventario por sí mismo; si no, su subcategoría).
function movementItemLabel(db, m) {
  const prod = m.productId ? db.products.find((p) => p.id === m.productId) : null;
  if (prod && prod.trackStock) return prod.name;
  return db.subcategories.find((s) => s.id === m.subcategoryId)?.name || "-";
}

// Consecutivo de cada compra (COM-0001) y entrega (ENT-0001).
function nextMovementConsecutive(movements, type) {
  const prefix = type === "Compra" ? "COM" : "ENT";
  const nums = (movements || [])
    .filter((m) => m.type === type && (m.consecutive || "").startsWith(prefix + "-"))
    .map((m) => parseInt(m.consecutive.slice(4), 10))
    .filter((n) => !isNaN(n));
  return `${prefix}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0")}`;
}

// Entregas activas valorizadas: cantidad × costo promedio ponderado de las
// compras activas del mismo insumo. Sirve para repartir el costo por técnico
// sin crear gastos nuevos (la compra sigue siendo el gasto general).
function valuedDeliveries(db) {
  const keyOf = movementItemKeyFn(db);
  const acc = {};
  (db.stockMovements || []).forEach((m) => {
    if (m.status === "Anulado" || m.type !== "Compra" || m.unitCost === null || m.unitCost === undefined) return;
    const a = acc[keyOf(m)] || (acc[keyOf(m)] = { qty: 0, cost: 0 });
    a.qty += m.quantity; a.cost += m.quantity * m.unitCost;
  });
  return (db.stockMovements || [])
    .filter((m) => m.status !== "Anulado" && m.type === "Entrega" && m.technicianId)
    .map((m) => {
      const a = acc[keyOf(m)];
      const unit = a && a.qty > 0 ? a.cost / a.qty : 0;
      return { ...m, itemKey: keyOf(m), valuedUnit: unit, value: m.quantity * unit };
    });
}

// Costo por técnico = gastos directos + insumos entregados (valorizados).
function costByTechnician(db, activeExpenses) {
  const m = {};
  const row = (id) => m[id] || (m[id] = { directo: 0, insumos: 0 });
  activeExpenses.filter((e) => e.technicianId).forEach((e) => { row(e.technicianId).directo += e.totalValue; });
  valuedDeliveries(db).forEach((d) => { row(d.technicianId).insumos += d.value; });
  return m;
}

/* ============================================================================
   IMPORTACIÓN MASIVA DE GASTOS
============================================================================ */

const IMPORT_TEMPLATE_HEADERS = ["Fecha (AAAA-MM-DD)", "Técnico", "Categoría", "Subcategoría", "Concepto", "Cantidad", "Valor unitario", "Observación"];

function downloadImportTemplate(db) {
  const t1 = db.technicians.find((t) => t.status === "Activo");
  const sample = [
    [todayISO(), t1?.name || "Nombre del técnico", "Insumos", "Vinipel", "Rollo Vinipel 300m", "2", "18000", "Reposición semanal"],
    [todayISO(), t1?.name || "Nombre del técnico", "Beneficios empleados", "Bono de cumpleaños", "Bono cumpleaños", "1", "80000", ""],
  ];
  downloadCSV("plantilla_importacion_gastos.csv", IMPORT_TEMPLATE_HEADERS, sample);
}

function parseDelimitedText(text) {
  const firstLine = (text.split(/\r?\n/)[0] || "");
  const delim = firstLine.includes(";") ? ";" : ",";
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const parseLine = (line) => {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === delim) { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  return lines.map(parseLine);
}

function normalize(s) { return (s || "").toString().trim().toLowerCase(); }

function buildImportRows(text, db) {
  const rows = parseDelimitedText(text);
  if (rows.length === 0) return [];
  const dataRows = rows.slice(1); // omitir encabezado
  return dataRows.map((cols, idx) => {
    const [fecha, tecnicoStr, catStr, subStr, concepto, cantidadStr, valorStr, observacion] = cols;
    const errors = [];
    let date = (fecha || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("Fecha inválida (use AAAA-MM-DD)");

    const tech = db.technicians.find((t) => normalize(t.name) === normalize(tecnicoStr));
    if (!tech) errors.push(`Técnico "${tecnicoStr}" no encontrado`);
    else if (tech.status !== "Activo") errors.push(`Técnico "${tecnicoStr}" está ${tech.status.toLowerCase()}`);

    const cat = db.categories.find((c) => normalize(c.name) === normalize(catStr));
    if (!cat) errors.push(`Categoría "${catStr}" no encontrada`);

    const sub = cat ? db.subcategories.find((s) => s.categoryId === cat.id && normalize(s.name) === normalize(subStr)) : null;
    if (cat && !sub) errors.push(`Subcategoría "${subStr}" no encontrada en "${catStr}"`);

    const cantidad = parseFloat(cantidadStr);
    if (!cantidad || cantidad <= 0) errors.push("Cantidad inválida");
    const valorUnitario = parseFloat(valorStr);
    if (isNaN(valorUnitario) || valorUnitario < 0) errors.push("Valor unitario inválido");

    let duplicado = false;
    if (tech && sub && !isNaN(cantidad) && !isNaN(valorUnitario) && date) {
      duplicado = db.expenses.some((e) =>
        e.status === "Activo" && e.date === date && e.technicianId === tech.id && e.subcategoryId === sub.id && e.totalValue === cantidad * valorUnitario
      );
    }

    return {
      rowNumber: idx + 2, raw: cols,
      date, technicianId: tech?.id, categoryId: cat?.id, subcategoryId: sub?.id,
      concepto: (concepto || "").trim() || sub?.name || "", cantidad, valorUnitario,
      observacion: (observacion || "").trim(),
      errors, duplicado,
    };
  });
}

function ImportGastosModal({ db, persist, addAudit, session, onClose }) {
  const [parsedRows, setParsedRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [fileError, setFileError] = useState("");
  const [done, setDone] = useState(0);

  const handleFile = (file) => {
    setFileError("");
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = buildImportRows(String(reader.result), db);
        setParsedRows(rows);
      } catch (e) {
        setFileError("No se pudo leer el archivo. Verifica que sea un CSV válido.");
      }
    };
    reader.onerror = () => setFileError("No se pudo leer el archivo.");
    reader.readAsText(file, "utf-8");
  };

  const validRows = (parsedRows || []).filter((r) => r.errors.length === 0 && (includeDuplicates || !r.duplicado));
  const errorRows = (parsedRows || []).filter((r) => r.errors.length > 0);
  const dupRows = (parsedRows || []).filter((r) => r.errors.length === 0 && r.duplicado);

  const confirmImport = () => {
    const newExpenses = validRows.map((r) => ({
      id: uid("e"), date: r.date, technicianId: r.technicianId, categoryId: r.categoryId, subcategoryId: r.subcategoryId,
      productId: null, conceptManual: r.concepto, quantity: r.cantidad, unitValue: r.valorUnitario, totalValue: r.cantidad * r.valorUnitario,
      observation: r.observacion, responsibleUserId: session.id, status: "Activo",
      annulReason: "", annulUserId: "", annulDate: "", createdAt: new Date().toISOString(),
    }));
    let next = { ...db, expenses: [...newExpenses, ...db.expenses] };
    next = addAudit(next, { userId: session.id, action: "Importación masiva de gastos", record: fileName, oldValue: "-", newValue: `${newExpenses.length} registros importados` });
    persist(next);
    setDone(newExpenses.length);
    setParsedRows(null);
  };

  return (
    <Modal title="Importar gastos en masa" onClose={onClose} width={760}
      footer={parsedRows ? (
        <>
          <button className="amg-btn" onClick={() => { setParsedRows(null); setFileName(""); }}>Elegir otro archivo</button>
          <button className="amg-btn primary" disabled={validRows.length === 0} onClick={confirmImport}>Importar {validRows.length} registro{validRows.length === 1 ? "" : "s"}</button>
        </>
      ) : (
        <button className="amg-btn" onClick={onClose}>Cerrar</button>
      )}>
      {done > 0 && !parsedRows && (
        <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}>
          <Check size={15} /> Se importaron {done} gastos correctamente. Puedes verlos en el Historial.
        </div>
      )}

      {!parsedRows && (
        <div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.6 }}>
            Sube un archivo CSV con las columnas: <b>Fecha, Técnico, Categoría, Subcategoría, Concepto, Cantidad, Valor unitario, Observación</b>.
            El nombre del técnico, la categoría y la subcategoría deben coincidir con los ya existentes en la plataforma.
            Antes de importar se validan errores y posibles duplicados.
          </div>
          <button className="amg-btn" style={{ marginBottom: 16 }} onClick={() => downloadImportTemplate(db)}>
            <FileDown size={14} /> Descargar plantilla de ejemplo
          </button>
          <div>
            <label className="amg-btn primary" style={{ cursor: "pointer", width: "fit-content" }}>
              <Upload size={14} /> Seleccionar archivo CSV
              <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
            </label>
          </div>
          {fileError && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {fileError}</div>}
        </div>
      )}

      {parsedRows && (
        <div>
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12.5 }}>
            <span style={{ color: "var(--green)" }}>{validRows.length} válidos</span>
            <span style={{ color: "var(--red)" }}>{errorRows.length} con error</span>
            <span style={{ color: "var(--accent)" }}>{dupRows.length} posibles duplicados</span>
          </div>
          {dupRows.length > 0 && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />
              Incluir posibles duplicados en la importación
            </label>
          )}
          <div style={{ maxHeight: 340, overflowY: "auto" }} className="amg-scroll">
            <table className="amg-table">
              <thead><tr><th>Fila</th><th>Fecha</th><th>Técnico</th><th>Categoría / Subcategoría</th><th>Cant.</th><th>V. unitario</th><th>Estado</th></tr></thead>
              <tbody>
                {parsedRows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="amg-mono">{r.rowNumber}</td>
                    <td className="amg-mono">{r.date || r.raw[0]}</td>
                    <td>{r.raw[1]}</td>
                    <td>{r.raw[2]} / {r.raw[3]}</td>
                    <td className="amg-mono">{r.raw[5]}</td>
                    <td className="amg-mono">{r.raw[6]}</td>
                    <td>
                      {r.errors.length > 0 ? <Badge text="Error" color="red" /> : r.duplicado ? <Badge text="Duplicado" color="amber" /> : <Badge text="OK" color="green" />}
                      {r.errors.length > 0 && <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 2 }}>{r.errors.join(" · ")}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================================
   IMPORTACIÓN MASIVA DE ENTREGAS DE INVENTARIO
============================================================================ */

const IMPORT_ENTREGAS_HEADERS = ["Fecha (DD/MM/AAAA)", "Técnico", "Insumo", "Cantidad", "Observación"];

// Acepta DD/MM/AAAA (o con "-") y lo convierte al formato interno AAAA-MM-DD.
// Devuelve null si la fecha no es válida.
function parseFechaDiaMesAnio(str) {
  const m = (str || "").trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = m[3];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function downloadImportEntregasTemplate(db) {
  const t1 = db.technicians.find((t) => t.status === "Activo");
  const item1 = inventoryItems(db)[0];
  const sample = [
    [fmtDate(todayISO()), t1?.name || "Nombre del técnico", item1?.label || "Vinipel", "2", "Reposición semanal"],
  ];
  downloadCSV("plantilla_importacion_entregas.csv", IMPORT_ENTREGAS_HEADERS, sample);
}

function buildImportEntregasRows(text, db) {
  const rows = parseDelimitedText(text);
  if (rows.length === 0) return [];
  const dataRows = rows.slice(1); // omitir encabezado
  const usadoPorInsumo = {}; // clave del insumo -> cantidad ya comprometida por filas previas válidas de este archivo
  const items = inventoryItems(db);
  const keyOf = movementItemKeyFn(db);
  return dataRows.map((cols, idx) => {
    const [fecha, tecnicoStr, insumoStr, cantidadStr, observacion] = cols;
    const errors = [];
    const date = parseFechaDiaMesAnio(fecha);
    if (!date) errors.push("Fecha inválida (use DD/MM/AAAA)");

    const tech = db.technicians.find((t) => normalize(t.name) === normalize(tecnicoStr));
    if (!tech) errors.push(`Técnico "${tecnicoStr}" no encontrado`);
    else if (tech.status !== "Activo") errors.push(`Técnico "${tecnicoStr}" está ${tech.status.toLowerCase()}`);

    const item = items.find((i) => normalize(i.label) === normalize(insumoStr));
    if (!item) errors.push(`Insumo "${insumoStr}" no encontrado o no controla inventario`);

    const cantidad = parseFloat(cantidadStr);
    if (!cantidad || cantidad <= 0) errors.push("Cantidad inválida");

    if (item && cantidad > 0) {
      const yaUsado = usadoPorInsumo[item.key] || 0;
      const disponible = stockOfItem(db, item.key) - yaUsado;
      if (cantidad > disponible) errors.push(`Supera el stock disponible de "${item.label}" (${disponible})`);
      else usadoPorInsumo[item.key] = yaUsado + cantidad;
    }

    let duplicado = false;
    if (tech && item && cantidad > 0 && date && errors.length === 0) {
      duplicado = (db.stockMovements || []).some((m) =>
        m.type === "Entrega" && m.status !== "Anulado" && m.date === date && m.technicianId === tech.id && keyOf(m) === item.key && m.quantity === cantidad
      );
    }

    return {
      rowNumber: idx + 2, raw: cols,
      date, technicianId: tech?.id, subcategoryId: item?.subcategoryId, productId: item?.productId || null, cantidad,
      observacion: (observacion || "").trim(),
      errors, duplicado,
    };
  });
}

function ImportEntregasModal({ db, persist, addAudit, session, onClose }) {
  const L = useLookups(db);
  const [parsedRows, setParsedRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [fileError, setFileError] = useState("");
  const [done, setDone] = useState(0);

  const handleFile = (file) => {
    setFileError("");
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = buildImportEntregasRows(String(reader.result), db);
        setParsedRows(rows);
      } catch (e) {
        setFileError("No se pudo leer el archivo. Verifica que sea un CSV válido.");
      }
    };
    reader.onerror = () => setFileError("No se pudo leer el archivo.");
    reader.readAsText(file, "utf-8");
  };

  const validRows = (parsedRows || []).filter((r) => r.errors.length === 0 && (includeDuplicates || !r.duplicado));
  const errorRows = (parsedRows || []).filter((r) => r.errors.length > 0);
  const dupRows = (parsedRows || []).filter((r) => r.errors.length === 0 && r.duplicado);

  const confirmImport = () => {
    // Cada entrega importada recibe su consecutivo, uno tras otro.
    let acumulados = [...(db.stockMovements || [])];
    const newMovs = validRows.map((r) => {
      const mov = {
        id: uid("stk"), type: "Entrega", date: r.date, subcategoryId: r.subcategoryId, productId: r.productId || null,
        quantity: r.cantidad, technicianId: r.technicianId, unitCost: null, supplier: "",
        observation: r.observacion, responsibleUserId: session.id, createdAt: new Date().toISOString(),
        status: "Activo", annulReason: "", annulUserId: "", annulDate: "", relatedExpenseId: null,
        consecutive: nextMovementConsecutive(acumulados, "Entrega"),
      };
      acumulados = [mov, ...acumulados];
      return mov;
    });
    let next = { ...db, stockMovements: [...newMovs, ...(db.stockMovements || [])] };
    next = addAudit(next, { userId: session.id, action: "Importación masiva de entregas", record: fileName, oldValue: "-", newValue: `${newMovs.length} registros importados` });
    persist(next);
    setDone(newMovs.length);
    setParsedRows(null);
  };

  return (
    <Modal title="Importar entregas en masa" onClose={onClose} width={760}
      footer={parsedRows ? (
        <>
          <button className="amg-btn" onClick={() => { setParsedRows(null); setFileName(""); }}>Elegir otro archivo</button>
          <button className="amg-btn primary" disabled={validRows.length === 0} onClick={confirmImport}>Importar {validRows.length} registro{validRows.length === 1 ? "" : "s"}</button>
        </>
      ) : (
        <button className="amg-btn" onClick={onClose}>Cerrar</button>
      )}>
      {done > 0 && !parsedRows && (
        <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}>
          <Check size={15} /> Se importaron {done} entregas correctamente. Puedes verlas en el historial.
        </div>
      )}

      {!parsedRows && (
        <div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.6 }}>
            Sube un archivo CSV con las columnas: <b>Fecha, Técnico, Insumo, Cantidad, Observación</b>.
            El nombre del técnico y del insumo (un insumo o subcategoría que "Controla inventario") deben coincidir con los ya existentes en la plataforma.
            Antes de importar se valida que no se supere el stock disponible y se detectan posibles duplicados.
          </div>
          <button className="amg-btn" style={{ marginBottom: 16 }} onClick={() => downloadImportEntregasTemplate(db)}>
            <FileDown size={14} /> Descargar plantilla de ejemplo
          </button>
          <div>
            <label className="amg-btn primary" style={{ cursor: "pointer", width: "fit-content" }}>
              <Upload size={14} /> Seleccionar archivo CSV
              <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
            </label>
          </div>
          {fileError && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {fileError}</div>}
        </div>
      )}

      {parsedRows && (
        <div>
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12.5 }}>
            <span style={{ color: "var(--green)" }}>{validRows.length} válidos</span>
            <span style={{ color: "var(--red)" }}>{errorRows.length} con error</span>
            <span style={{ color: "var(--accent)" }}>{dupRows.length} posibles duplicados</span>
          </div>
          {dupRows.length > 0 && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />
              Incluir posibles duplicados en la importación
            </label>
          )}
          <div style={{ maxHeight: 340, overflowY: "auto" }} className="amg-scroll">
            <table className="amg-table">
              <thead><tr><th>Fila</th><th>Fecha</th><th>Técnico</th><th>Insumo</th><th>Cantidad</th><th>Estado</th></tr></thead>
              <tbody>
                {parsedRows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="amg-mono">{r.rowNumber}</td>
                    <td className="amg-mono">{r.raw[0]}</td>
                    <td>{r.raw[1]}</td>
                    <td>{r.raw[2]}</td>
                    <td className="amg-mono">{r.raw[3]}</td>
                    <td>
                      {r.errors.length > 0 ? <Badge text="Error" color="red" /> : r.duplicado ? <Badge text="Duplicado" color="amber" /> : <Badge text="OK" color="green" />}
                      {r.errors.length > 0 && <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 2 }}>{r.errors.join(" · ")}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================================
   ESTILOS
============================================================================ */

const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

    .amg-app {
      --bg: #F3ECDF;
      --panel: #FFFFFF;
      --panel-2: #F7F1E4;
      --border: #E3D8C4;
      --text: #2E2620;
      --text-dim: #6B5D4D;
      --text-faint: #9C8C74;
      --accent: #D98D34;
      --accent-dim: rgba(217,141,52,0.15);
      --blue: #4C7EC9;
      --green: #3F9D6E;
      --red: #D9534F;
      --sidebar-bg: #2E2620;
      --sidebar-text: #F3ECDF;
      --sidebar-text-dim: #D9CBB0;
      --sidebar-text-faint: #A99677;
      --sidebar-border: #453A30;
      --sidebar-hover: #3A3129;
      font-family: 'IBM Plex Sans', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      width: 100%;
      display: flex;
      -webkit-font-smoothing: antialiased;
    }
    .amg-app * { box-sizing: border-box; }
    .amg-mono { font-family: 'IBM Plex Mono', monospace; }

    .amg-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
    .amg-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
    .amg-scroll::-webkit-scrollbar-track { background: transparent; }

    .amg-sidebar {
      width: 236px; flex-shrink: 0; background: var(--sidebar-bg); border-right: 1px solid var(--sidebar-border);
      display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; z-index: 40;
      transition: transform .2s ease;
      --text: var(--sidebar-text); --text-dim: var(--sidebar-text-dim); --text-faint: var(--sidebar-text-faint);
      --border: var(--sidebar-border); --panel-2: var(--sidebar-hover);
    }
    .amg-sidebar.closed { transform: translateX(-100%); }
    @media (min-width: 900px) { .amg-sidebar.closed { transform: none; } }

    .amg-nav-item {
      display: flex; align-items: center; gap: 10px; padding: 10px 16px; color: var(--text-dim);
      cursor: pointer; font-size: 13.5px; font-weight: 500; border-left: 2px solid transparent;
      transition: background .12s, color .12s;
    }
    .amg-nav-item:hover { background: var(--panel-2); color: var(--text); }
    .amg-nav-item.active { color: var(--accent); background: var(--accent-dim); border-left: 2px solid var(--accent); }

    .amg-main { flex: 1; min-width: 0; margin-left: 0; }
    @media (min-width: 900px) { .amg-main { margin-left: 236px; } }

    .amg-topbar {
      height: 56px; border-bottom: 1px solid var(--border); display: flex; align-items: center;
      justify-content: space-between; padding: 0 20px; position: sticky; top: 0; background: rgba(243,236,223,0.9);
      backdrop-filter: blur(6px); z-index: 30;
    }
    .amg-content { padding: 20px; max-width: 1400px; }

    .amg-card { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
    .amg-btn {
      display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px;
      font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--border); background: var(--panel-2);
      color: var(--text); white-space: nowrap;
    }
    .amg-btn:hover { border-color: var(--text-faint); }
    .amg-btn.primary { background: var(--accent); border-color: var(--accent); color: #FFFFFF; }
    .amg-btn.primary:hover { filter: brightness(1.08); }
    .amg-btn.danger { background: transparent; border-color: var(--red); color: var(--red); }
    .amg-btn.ghost { background: transparent; border-color: transparent; }
    .amg-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .amg-input, .amg-select, .amg-textarea {
      width: 100%; background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
      border-radius: 6px; padding: 8px 10px; font-size: 13.5px; font-family: inherit;
    }
    .amg-input:focus, .amg-select:focus, .amg-textarea:focus { outline: none; border-color: var(--accent); }
    .amg-label { font-size: 12px; color: var(--text-dim); margin-bottom: 4px; display: block; font-weight: 500; }

    .amg-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .amg-table th {
      text-align: left; padding: 8px 10px; color: var(--text-faint); font-weight: 600; font-size: 11.5px;
      border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; white-space: nowrap;
    }
    .amg-table td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    .amg-table tr:hover td { background: var(--panel-2); }

    .amg-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
    .amg-badge.green { background: rgba(63,157,110,0.15); color: var(--green); }
    .amg-badge.red { background: rgba(217,83,79,0.15); color: var(--red); }
    .amg-badge.gray { background: rgba(107,93,77,0.15); color: var(--text-dim); }
    .amg-badge.amber { background: var(--accent-dim); color: var(--accent); }
    .amg-badge.blue { background: rgba(76,126,201,0.15); color: var(--blue); }

    .amg-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 16px; }
    .amg-modal { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; max-width: 560px; width: 100%; max-height: 90vh; display: flex; flex-direction: column; }
    .amg-modal-head { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .amg-modal-body { padding: 20px; overflow-y: auto; }
    .amg-modal-foot { padding: 14px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }

    .amg-kpi-value { font-family: 'IBM Plex Mono', monospace; font-size: 22px; font-weight: 600; }
    .amg-alert { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 6px; font-size: 13px; margin-bottom: 10px; }
    .amg-alert.warn { background: rgba(217,141,52,0.1); border: 1px solid rgba(217,141,52,0.3); color: var(--accent); }
    .amg-alert.danger { background: rgba(217,83,79,0.1); border: 1px solid rgba(217,83,79,0.3); color: var(--red); }

    .amg-searchselect { position: relative; }
    .amg-searchselect-panel {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--panel-2);
      border: 1px solid var(--border); border-radius: 6px; z-index: 50; max-height: 320px; overflow-y: auto;
      box-shadow: 0 8px 24px rgba(46,38,32,0.15);
    }
    .amg-searchselect-opt { padding: 11px 12px; font-size: 13.5px; cursor: pointer; }
    .amg-searchselect-opt:hover { background: var(--panel); color: var(--accent); }

    .amg-tab { padding: 8px 4px; margin-right: 20px; color: var(--text-dim); font-size: 13px; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; }
    .amg-tab.active { color: var(--text); border-bottom: 2px solid var(--accent); }
  `}</style>
);

/* ============================================================================
   PRIMITIVOS DE UI
============================================================================ */

function Badge({ text, color = "gray" }) {
  return <span className={`amg-badge ${color}`}>{text}</span>;
}

// Texto largo recortado a los primeros caracteres; al pasar el mouse aparece el
// texto completo en un recuadro flotante (posición fija, para que no lo corte
// el scroll de la tabla), por encima de la fila si hay espacio.
function HoverText({ text, maxChars = 48, width = 440 }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  if (!text) return <span style={{ color: "var(--text-faint)" }}>-</span>;
  const truncated = text.length > maxChars;
  const short = truncated ? text.slice(0, maxChars).trimEnd() + "…" : text;
  const show = () => {
    if (!truncated || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    const above = r.top > 200;
    setPos({ left, w, top: above ? undefined : r.bottom + 6, bottom: above ? window.innerHeight - r.top + 6 : undefined });
  };
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} style={{ cursor: truncated ? "help" : "default", whiteSpace: "nowrap" }}>
      {short}
      {pos && (
        <span style={{
          position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.w, zIndex: 300, pointerEvents: "none",
          background: "var(--panel)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px",
          boxShadow: "0 8px 24px rgba(46,38,32,0.25)", fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: "60vh", overflow: "hidden",
        }}>{text}</span>
      )}
    </span>
  );
}

function statusColor(status) {
  if (status === "Activo" || status === "Disponible") return "green";
  if (status === "Inactivo" || status === "En reparación") return "gray";
  if (status === "Retirado" || status === "Dañado" || status === "Perdido" || status === "Anulado" || status === "Dado de baja") return "red";
  if (status === "Asignado") return "blue";
  return "gray";
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="amg-card" style={{ padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 6 }}>{label}</div>
      <div className="amg-kpi-value" style={{ color: accent ? "var(--accent)" : "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Modal({ title, onClose, children, footer, width }) {
  return (
    <div className="amg-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="amg-modal" style={width ? { maxWidth: width } : {}}>
        <div className="amg-modal-head">
          <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
          <X size={18} style={{ cursor: "pointer", color: "var(--text-dim)" }} onClick={onClose} />
        </div>
        <div className="amg-modal-body amg-scroll">{children}</div>
        {footer && <div className="amg-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

function SearchSelect({ options, value, onChange, placeholder = "Seleccionar...", disabled, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => { if (onOpenChange) onOpenChange(open); }, [open]);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) => (o.label + " " + (o.sublabel || "")).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="amg-searchselect" ref={ref}>
      <button type="button" className="amg-select" disabled={disabled}
        style={{ textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: disabled ? "not-allowed" : "pointer" }}
        onClick={() => setOpen((o) => !o)}>
        <span style={{ color: selected ? "var(--text)" : "var(--text-faint)" }}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {open && !disabled && (
        <div className="amg-searchselect-panel">
          <div style={{ padding: 6, borderBottom: "1px solid var(--border)" }}>
            <input autoFocus className="amg-input" placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {filtered.length === 0 && <div style={{ padding: 10, fontSize: 13, color: "var(--text-faint)" }}>Sin resultados</div>}
          {filtered.map((o) => (
            <div key={o.value} className="amg-searchselect-opt" onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}>
              <div>{o.label}</div>
              {o.sublabel && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{o.sublabel}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel = "Confirmar", danger, onConfirm, onClose, children }) {
  return (
    <Modal title={title} onClose={onClose} width={440}
      footer={<>
        <button className="amg-btn" onClick={onClose}>Cancelar</button>
        <button className={`amg-btn ${danger ? "danger" : "primary"}`} onClick={onConfirm}>{confirmLabel}</button>
      </>}>
      <div style={{ fontSize: 13.5, color: "var(--text-dim)", marginBottom: children ? 12 : 0 }}>{message}</div>
      {children}
    </Modal>
  );
}

function SortableTh({ label, field, sort, setSort }) {
  const active = sort.field === field;
  return (
    <th onClick={() => setSort({ field, dir: active && sort.dir === "asc" ? "desc" : "asc" })}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: active ? "var(--accent)" : undefined }}>
        {label} {active && (sort.dir === "asc" ? "▲" : "▼")}
      </span>
    </th>
  );
}

/* ============================================================================
   APP RAÍZ
============================================================================ */

// Piezas de interfaz que usa el módulo de Asignación (que vive en su propio archivo).
const ASIGNACION_UI = { Badge, Modal, ConfirmModal, StatCard, HoverText, ZonaPicker, fmtDate, downloadCSV, todayISO, uid };

const NAV_ITEMS = [
  { key: "dashboard", label: "Inicio / Dashboard", icon: LayoutDashboard, roles: ["admin", "operador", "consulta"] },
  { key: "registrar", label: "Registrar gasto", icon: FilePlus2, roles: ["admin", "operador"] },
  { key: "historial", label: "Historial de gastos", icon: History, roles: ["admin", "operador", "consulta"] },
  { key: "tecnicos", label: "Personal", icon: HardHat, roles: ["admin", "operador", "consulta"] },
  { key: "servicios", label: "Trabajos realizados", icon: ListChecks, roles: ["admin", "operador", "consulta"] },
  { key: "asignacion", label: "Asignación de servicios", icon: MapPin, roles: ["admin", "operador", "consulta"] },
  { key: "inventario", label: "Inventario", icon: Boxes, roles: ["admin", "operador", "consulta"] },
  { key: "categorias", label: "Categorías y subcategorías", icon: FolderTree, roles: ["admin", "operador", "consulta"] },
  { key: "productos", label: "Insumos / elementos", icon: Package, roles: ["admin", "operador", "consulta"] },
  { key: "usuarios", label: "Usuarios", icon: UserCog, roles: ["admin"] },
  { key: "carga", label: "Carga", icon: Upload, roles: ["admin", "operador"] },
  { key: "maestros", label: "Maestros", icon: Database, roles: ["admin"] },
  { key: "reportes", label: "Reportes", icon: BarChart3, roles: ["admin", "operador", "consulta"] },
  { key: "configuracion", label: "Configuración", icon: Settings, roles: ["admin"] },
];

// Agrupación del menú lateral. Si se agrega un módulo a NAV_ITEMS sin ponerlo
// aquí, aparece al final bajo "Otros" para que nunca quede fuera del menú.
const NAV_GROUPS = [
  { label: "Resumen", keys: ["dashboard", "reportes"] },
  { label: "Gastos", keys: ["registrar", "historial"] },
  { label: "Asignación", keys: ["asignacion"] },
  { label: "Operación", keys: ["tecnicos", "servicios", "carga"] },
  { label: "Inventario", keys: ["inventario", "productos"] },
  { label: "Administración", keys: ["categorias", "maestros", "usuarios", "configuracion"] },
];

export default function App() {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [view, setView] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [selectedTechId, setSelectedTechId] = useState(null);
  const [loadError, setLoadError] = useState("");
  const dbRef = useRef(null);

  // Restaurar sesión existente al abrir la app
  useEffect(() => {
    (async () => {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (authSession) {
        const profile = await api.getCurrentSessionProfile();
        if (profile && profile.active) setSession(profile);
      }
      setLoading(false);
    })();
  }, []);

  // Cargar todos los datos cuando hay una sesión activa
  useEffect(() => {
    if (!session) { setDb(null); dbRef.current = null; return; }
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const loaded = await api.loadAll();
        setDb(loaded);
        dbRef.current = loaded;
      } catch (e) {
        setLoadError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  const persist = useCallback(async (next) => {
    const prev = dbRef.current;
    setDb(next);
    dbRef.current = next;
    try {
      await api.syncDiff(prev, next, session);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error guardando en Supabase:", e);
      alert("No se pudo guardar el cambio en la base de datos:\n" + (e.message || e));
      setDb(prev);
      dbRef.current = prev;
    }
  }, [session]);

  const reloadAll = useCallback(async () => {
    const loaded = await api.loadAll();
    setDb(loaded);
    dbRef.current = loaded;
  }, []);

  const addAudit = useCallback((db_, entry) => {
    return {
      ...db_,
      auditLog: [{ id: uid("log"), userId: session?.id, date: todayISO(), time: new Date().toTimeString().slice(0, 5), ...entry }, ...db_.auditLog],
    };
  }, [session]);

  const handleLogout = async () => {
    await api.signOut();
    setSession(null);
    setView("dashboard");
  };

  if (loading) {
    return (
      <div className="amg-app" style={{ alignItems: "center", justifyContent: "center", width: "100%" }}>
        <GlobalStyles />
        <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Cargando plataforma...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="amg-app" style={{ width: "100%" }}>
        <GlobalStyles />
        <LoginScreen onLogin={setSession} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="amg-app" style={{ alignItems: "center", justifyContent: "center", width: "100%", flexDirection: "column", gap: 10 }}>
        <GlobalStyles />
        <div style={{ color: "var(--red)", fontSize: 13.5, maxWidth: 480, textAlign: "center" }}>
          No se pudieron cargar los datos desde Supabase: {loadError}
        </div>
        <button className="amg-btn" onClick={handleLogout}>Cerrar sesión</button>
      </div>
    );
  }

  if (!db) return null;

  const navAllowed = NAV_ITEMS.filter((n) => n.roles.includes(session.role));
  const agrupados = new Set(NAV_GROUPS.flatMap((g) => g.keys));
  const navGroups = [
    ...NAV_GROUPS.map((g) => ({ label: g.label, items: g.keys.map((k) => navAllowed.find((n) => n.key === k)).filter(Boolean) })),
    { label: "Otros", items: navAllowed.filter((n) => !agrupados.has(n.key)) },
  ].filter((g) => g.items.length > 0);
  const isNavActive = (n) => view === n.key || (n.key === "tecnicos" && view === "tecnico-perfil");
  const goToTech = (id) => { setSelectedTechId(id); setView("tecnico-perfil"); };

  return (
    <div className="amg-app" style={{ width: "100%" }}>
      <GlobalStyles />

      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 39 }} />}

      <div className={`amg-sidebar ${sidebarOpen ? "" : "closed"}`}>
        <div style={{ padding: "18px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 6, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <HardHat size={17} color="#FFFFFF" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.1 }}>Gastos Armado</div>
              <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>Control operativo</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 0" }} className="amg-scroll">
          {navGroups.map((g) => {
            const collapsed = !!collapsedGroups[g.label];
            // Con el grupo plegado se sigue mostrando la opción activa, para no perder dónde estás.
            const visibles = collapsed ? g.items.filter(isNavActive) : g.items;
            return (
              <div key={g.label}>
                <div onClick={() => setCollapsedGroups({ ...collapsedGroups, [g.label]: !collapsed })}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 5px", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.7, textTransform: "uppercase", color: "var(--text-faint)", cursor: "pointer", userSelect: "none" }}>
                  <span>{g.label}</span>
                  {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </div>
                {visibles.map((n) => (
                  <div key={n.key} className={`amg-nav-item ${isNavActive(n) ? "active" : ""}`}
                    onClick={() => { setView(n.key); setSidebarOpen(false); }}>
                    <n.icon size={16} /> {n.label}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{session.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8, textTransform: "capitalize" }}>{session.role}</div>
          <button className="amg-btn" style={{ width: "100%", justifyContent: "center" }} onClick={handleLogout}>
            <LogOut size={14} /> Cerrar sesión
          </button>
        </div>
      </div>

      <div className="amg-main">
        <div className="amg-topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Menu size={20} style={{ cursor: "pointer" }} className="amg-mobile-only" onClick={() => setSidebarOpen(true)} />
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>
              {NAV_ITEMS.find((n) => n.key === view)?.label || (view === "tecnico-perfil" ? "Perfil de persona" : "")}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-faint)" }} className="amg-mono">{fmtDate(todayISO())}</div>
        </div>

        <div className="amg-content">
          {view === "dashboard" && <Dashboard db={db} onGoTech={goToTech} />}
          {view === "registrar" && <RegistrarGasto db={db} persist={persist} addAudit={addAudit} session={session} onGoInventario={() => setView("inventario")} />}
          {view === "historial" && <Historial db={db} persist={persist} addAudit={addAudit} session={session} onGoTech={goToTech} />}
          {view === "tecnicos" && <Tecnicos db={db} persist={persist} addAudit={addAudit} session={session} onOpenProfile={goToTech} />}
          {view === "servicios" && <Servicios db={db} persist={persist} addAudit={addAudit} session={session} onGoTech={goToTech} />}
          {view === "inventario" && <Inventario db={db} persist={persist} addAudit={addAudit} session={session} />}
          {view === "tecnico-perfil" && <TecnicoPerfil db={db} techId={selectedTechId} onBack={() => setView("tecnicos")} />}
          {view === "categorias" && <Categorias db={db} persist={persist} session={session} />}
          {view === "productos" && <Productos db={db} persist={persist} addAudit={addAudit} session={session} onGoTech={goToTech} />}
          {view === "usuarios" && <UsuariosView db={db} persist={persist} reloadAll={reloadAll} session={session} />}
          {view === "maestros" && <Maestros db={db} persist={persist} addAudit={addAudit} session={session} />}
          {view === "asignacion" && <AsignacionModule db={db} persist={persist} addAudit={addAudit} session={session} ui={ASIGNACION_UI} />}
          {view === "carga" && <CargaModule db={db} persist={persist} addAudit={addAudit} session={session} onGoTech={goToTech} />}
          {view === "reportes" && <Reportes db={db} />}
          {view === "configuracion" && <Configuracion db={db} session={session} />}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   LOGIN
============================================================================ */

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.signIn(email.trim(), password);
      const profile = await api.getCurrentSessionProfile();
      if (!profile) {
        setError("Tu cuenta no tiene un perfil asociado. Contacta a un administrador.");
        await api.signOut();
      } else if (!profile.active) {
        setError("Tu usuario está inactivo. Contacta a un administrador.");
        await api.signOut();
      } else {
        onLogin(profile);
      }
    } catch (err) {
      setError(err.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : (err.message || "No se pudo iniciar sesión."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ width: "100%", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 26 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <HardHat size={22} color="#FFFFFF" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Gastos Operativos — Armado</div>
            <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Plataforma de control de técnicos</div>
          </div>
        </div>
        <form className="amg-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }} onSubmit={submit}>
          {error && <div className="amg-alert danger"><AlertTriangle size={14} style={{ marginTop: 1 }} /> {error}</div>}
          <div>
            <label className="amg-label">Correo electrónico</label>
            <input type="email" required className="amg-input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="amg-label">Contraseña</label>
            <input type="password" required className="amg-input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="amg-btn primary" style={{ justifyContent: "center", marginTop: 4 }} disabled={busy} type="submit">
            {busy ? "Ingresando..." : "Iniciar sesión"}
          </button>
        </form>
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 14, textAlign: "center" }}>
          ¿No tienes cuenta? Pide a un administrador que te cree un usuario desde el módulo Usuarios.
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   HELPERS DE DATOS COMPARTIDOS ENTRE VISTAS
============================================================================ */

function useLookups(db) {
  return useMemo(() => {
    const techById = Object.fromEntries(db.technicians.map((t) => [t.id, t]));
    const catById = Object.fromEntries(db.categories.map((c) => [c.id, c]));
    const subById = Object.fromEntries(db.subcategories.map((s) => [s.id, s]));
    const prodById = Object.fromEntries(db.products.map((p) => [p.id, p]));
    const userById = Object.fromEntries(db.users.map((u) => [u.id, u]));
    return { techById, catById, subById, prodById, userById };
  }, [db]);
}

function conceptOf(exp, L) {
  if (exp.productId && L.prodById[exp.productId]) return L.prodById[exp.productId].name;
  return exp.conceptManual || "-";
}

function applyDimFilters(expenses, f, technicians) {
  return expenses.filter((e) => {
    if (f.technicianId && e.technicianId !== f.technicianId) return false;
    if (f.categoryId && e.categoryId !== f.categoryId) return false;
    if (f.subcategoryId && e.subcategoryId !== f.subcategoryId) return false;
    if (f.techStatus || f.department) {
      const t = technicians.find((tt) => tt.id === e.technicianId);
      if (!t) return false;
      if (f.techStatus && t.status !== f.techStatus) return false;
      if (f.department && t.department !== f.department) return false;
    }
    return true;
  });
}

function applyAllFilters(expenses, f, technicians) {
  return applyDimFilters(expenses, f, technicians).filter((e) => {
    if (f.dateFrom && e.date < f.dateFrom) return false;
    if (f.dateTo && e.date > f.dateTo) return false;
    if (f.year && yearOf(e.date) !== f.year) return false;
    if (f.month && e.date.slice(5, 7) !== f.month) return false;
    return true;
  });
}

const EMPTY_FILTERS = { dateFrom: "", dateTo: "", year: "", month: "", technicianId: "", categoryId: "", subcategoryId: "", techStatus: "", department: "" };

function FiltersBar({ filters, setFilters, db, showTechStatus = true }) {
  const techOpts = db.technicians.map((t) => ({ value: t.id, label: t.name, sublabel: `${t.code} · ${t.status}` }));
  const catOpts = db.categories.map((c) => ({ value: c.id, label: c.name }));
  const subOpts = db.subcategories.filter((s) => !filters.categoryId || s.categoryId === filters.categoryId).map((s) => ({ value: s.id, label: s.name }));
  const deptoOpts = Array.from(new Set(db.technicians.map((t) => t.department).filter(Boolean))).sort();
  return (
    <div className="amg-card" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "var(--text-dim)", fontSize: 12, fontWeight: 600 }}>
        <Filter size={13} /> Filtros
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 10 }}>
        <div><label className="amg-label">Fecha desde</label><input type="date" className="amg-input" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} /></div>
        <div><label className="amg-label">Fecha hasta</label><input type="date" className="amg-input" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} /></div>
        <div><label className="amg-label">Año</label>
          <select className="amg-select" value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })}>
            <option value="">Todos</option>
            {[0, 1, 2].map((i) => { const y = new Date().getFullYear() - i; return <option key={y} value={String(y)}>{y}</option>; })}
          </select>
        </div>
        <div><label className="amg-label">Mes</label>
          <select className="amg-select" value={filters.month} onChange={(e) => setFilters({ ...filters, month: e.target.value })}>
            <option value="">Todos</option>
            {MESES_LARGO.map((m, i) => <option key={m} value={pad2(i + 1)}>{m}</option>)}
          </select>
        </div>
        <div><label className="amg-label">Técnico</label><SearchSelect options={[{ value: "", label: "Todos" }, ...techOpts]} value={filters.technicianId} onChange={(v) => setFilters({ ...filters, technicianId: v })} placeholder="Todos" /></div>
        <div><label className="amg-label">Departamento</label>
          <select className="amg-select" value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })}>
            <option value="">Todos</option>{deptoOpts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div><label className="amg-label">Categoría</label><SearchSelect options={[{ value: "", label: "Todas" }, ...catOpts]} value={filters.categoryId} onChange={(v) => setFilters({ ...filters, categoryId: v, subcategoryId: "" })} placeholder="Todas" /></div>
        <div><label className="amg-label">Subcategoría</label><SearchSelect options={[{ value: "", label: "Todas" }, ...subOpts]} value={filters.subcategoryId} onChange={(v) => setFilters({ ...filters, subcategoryId: v })} placeholder="Todas" /></div>
        {showTechStatus && (
          <div><label className="amg-label">Estado técnico</label>
            <select className="amg-select" value={filters.techStatus} onChange={(e) => setFilters({ ...filters, techStatus: e.target.value })}>
              <option value="">Todos</option><option value="Activo">Activo</option><option value="Inactivo">Inactivo</option><option value="Retirado">Retirado</option>
            </select>
          </div>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="amg-btn ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Limpiar filtros</button>
      </div>
    </div>
  );
}

/* ============================================================================
   DASHBOARD
============================================================================ */

function Dashboard({ db, onGoTech }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const L = useLookups(db);
  const activeExpenses = useMemo(() => db.expenses.filter((e) => e.status === "Activo"), [db.expenses]);
  const filteredAll = useMemo(() => applyAllFilters(activeExpenses, filters, db.technicians), [activeExpenses, filters, db.technicians]);
  const filteredDims = useMemo(() => applyDimFilters(activeExpenses, filters, db.technicians), [activeExpenses, filters, db.technicians]);

  const now = new Date();
  const refYear = filters.year ? parseInt(filters.year, 10) : now.getFullYear();
  const refMonth = filters.month ? parseInt(filters.month, 10) : now.getMonth() + 1;
  const refKey = `${refYear}-${pad2(refMonth)}`;
  const prevD = new Date(refYear, refMonth - 2, 1);
  const prevKey = `${prevD.getFullYear()}-${pad2(prevD.getMonth() + 1)}`;

  const gastoMes = filteredDims.filter((e) => monthKey(e.date) === refKey).reduce((s, e) => s + e.totalValue, 0);
  const gastoMesAnt = filteredDims.filter((e) => monthKey(e.date) === prevKey).reduce((s, e) => s + e.totalValue, 0);
  const gastoAnio = filteredDims.filter((e) => yearOf(e.date) === String(refYear)).reduce((s, e) => s + e.totalValue, 0);
  const variacion = gastoMesAnt > 0 ? ((gastoMes - gastoMesAnt) / gastoMesAnt) * 100 : (gastoMes > 0 ? 100 : 0);

  const numMovs = filteredAll.length;
  const filteredAllConTecnico = useMemo(() => filteredAll.filter((e) => e.technicianId), [filteredAll]);
  const techsConGasto = new Set(filteredAllConTecnico.map((e) => e.technicianId)).size;
  const totalFiltrado = filteredAll.reduce((s, e) => s + e.totalValue, 0);
  const promedioPorTecnico = techsConGasto ? filteredAllConTecnico.reduce((s, e) => s + e.totalValue, 0) / techsConGasto : 0;

  const porCategoria = useMemo(() => {
    const m = {};
    filteredAll.forEach((e) => { m[e.categoryId] = (m[e.categoryId] || 0) + e.totalValue; });
    return Object.entries(m).map(([id, val]) => ({ name: L.catById[id]?.name || id, value: val })).sort((a, b) => b.value - a.value);
  }, [filteredAll, L]);

  const porSubcategoria = useMemo(() => {
    const m = {};
    filteredAll.forEach((e) => { m[e.subcategoryId] = (m[e.subcategoryId] || 0) + e.totalValue; });
    return Object.entries(m).map(([id, val]) => ({ name: L.subById[id]?.name || id, value: val })).sort((a, b) => b.value - a.value);
  }, [filteredAll, L]);

  const porTecnico = useMemo(() => {
    const m = {};
    filteredAllConTecnico.forEach((e) => { m[e.technicianId] = (m[e.technicianId] || 0) + e.totalValue; });
    return Object.entries(m).map(([id, val]) => ({ name: L.techById[id]?.name || id, value: val })).sort((a, b) => b.value - a.value);
  }, [filteredAllConTecnico, L]);

  const evolucion12 = useMemo(() => {
    const keys = last12MonthKeys();
    const m = Object.fromEntries(keys.map((k) => [k, 0]));
    filteredDims.forEach((e) => { const k = monthKey(e.date); if (k in m) m[k] += e.totalValue; });
    return keys.map((k) => ({ mes: monthLabel(k), valor: m[k] }));
  }, [filteredDims]);

  const gastoMensualAnio = useMemo(() => {
    const keys = currentYearMonths().filter((k) => k.startsWith(String(refYear)));
    const m = Object.fromEntries(keys.map((k) => [k, 0]));
    filteredDims.forEach((e) => { const k = monthKey(e.date); if (k in m) m[k] += e.totalValue; });
    return keys.map((k) => ({ mes: monthLabel(k), valor: m[k] }));
  }, [filteredDims, refYear]);

  const catTop = porCategoria[0]?.name || "-";
  const subTop = porSubcategoria[0]?.name || "-";
  const techTopAll = useMemo(() => {
    const m = {};
    activeExpenses.filter((e) => e.technicianId).forEach((e) => { m[e.technicianId] = (m[e.technicianId] || 0) + e.totalValue; });
    let best = null, bv = -1;
    Object.entries(m).forEach(([id, v]) => { if (v > bv) { bv = v; best = id; } });
    return best ? { name: L.techById[best]?.name, id: best, value: bv } : null;
  }, [activeExpenses, L]);

  const promedioMensualCat = useMemo(() => {
    const keys = last12MonthKeys();
    const byMonth = {};
    keys.forEach((k) => (byMonth[k] = 0));
    activeExpenses.forEach((e) => { const k = monthKey(e.date); if (k in byMonth) byMonth[k] += e.totalValue; });
    const vals = Object.values(byMonth);
    return vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  }, [activeExpenses]);

  const alertaCategoria = gastoMes > promedioMensualCat * 1.3 && promedioMensualCat > 0;

  return (
    <div>
      <FiltersBar filters={filters} setFilters={setFilters} db={db} />

      {alertaCategoria && (
        <div className="amg-alert warn"><AlertTriangle size={15} style={{ marginTop: 1 }} />
          El gasto del mes de referencia ({fmtCOP(gastoMes)}) supera en más de 30% el promedio mensual de los últimos 12 meses ({fmtCOP(promedioMensualCat)}).
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px,1fr))", gap: 12, marginBottom: 18 }}>
        <StatCard label="Gasto total del mes" value={fmtCOP(gastoMes)} accent />
        <StatCard label="Gasto total del año" value={fmtCOP(gastoAnio)} />
        <StatCard label="Gasto mes anterior" value={fmtCOP(gastoMesAnt)} />
        <StatCard label="Variación vs. mes anterior" value={`${variacion >= 0 ? "+" : ""}${variacion.toFixed(1)}%`} sub={variacion >= 0 ? "Incremento" : "Disminución"} />
        <StatCard label="Movimientos (filtro)" value={numMovs} />
        <StatCard label="Técnicos con gasto" value={techsConGasto} />
        <StatCard label="Promedio por técnico" value={fmtCOP(promedioPorTecnico)} />
        <StatCard label="Categoría con mayor gasto" value={catTop} />
        <StatCard label="Subcategoría con mayor gasto" value={subTop} />
        <StatCard label="Técnico con mayor gasto acumulado" value={techTopAll?.name || "-"} sub={techTopAll ? fmtCOP(techTopAll.value) : ""} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px,1fr))", gap: 14 }}>
        <ChartPanel title="Gasto mensual (año de referencia)">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={gastoMensualAnio}><CartesianGrid strokeDasharray="3 3" stroke="#E3D8C4" /><XAxis dataKey="mes" tick={{ fill: "#6B5D4D", fontSize: 11 }} /><YAxis tick={{ fill: "#6B5D4D", fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} />
              <Bar dataKey="valor" fill="#D98D34" radius={[3, 3, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Evolución del gasto — últimos 12 meses">
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={evolucion12}><CartesianGrid strokeDasharray="3 3" stroke="#E3D8C4" /><XAxis dataKey="mes" tick={{ fill: "#6B5D4D", fontSize: 11 }} /><YAxis tick={{ fill: "#6B5D4D", fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} />
              <Line type="monotone" dataKey="valor" stroke="#4C7EC9" strokeWidth={2} dot={{ r: 3 }} /></LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Gastos por categoría">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={porCategoria} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#E3D8C4" /><XAxis type="number" tick={{ fill: "#6B5D4D", fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} /><YAxis type="category" dataKey="name" width={130} tick={{ fill: "#6B5D4D", fontSize: 11 }} />
              <Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} />
              <Bar dataKey="value" fill="#3F9D6E" radius={[0, 3, 3, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Participación % por categoría">
          <ResponsiveContainer width="100%" height={230}>
            <PieChart><Pie data={porCategoria} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => `${e.name} ${(e.percent * 100).toFixed(0)}%`} labelLine={false}>
              {porCategoria.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie><Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} /></PieChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Gastos por subcategoría (top 8)">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={porSubcategoria.slice(0, 8)}><CartesianGrid strokeDasharray="3 3" stroke="#E3D8C4" /><XAxis dataKey="name" tick={{ fill: "#6B5D4D", fontSize: 10 }} angle={-25} textAnchor="end" height={60} /><YAxis tick={{ fill: "#6B5D4D", fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} />
              <Bar dataKey="value" fill="#A9744F" radius={[3, 3, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Top 10 técnicos con mayor gasto">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={porTecnico.slice(0, 10)} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" stroke="#E3D8C4" /><XAxis type="number" tick={{ fill: "#6B5D4D", fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} /><YAxis type="category" dataKey="name" width={140} tick={{ fill: "#6B5D4D", fontSize: 10 }} />
              <Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} />
              <Bar dataKey="value" fill="#D98D34" radius={[0, 3, 3, 0]} onClick={(d) => { const t = db.technicians.find((tt) => tt.name === d.name); if (t) onGoTech(t.id); }} style={{ cursor: "pointer" }} /></BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Comparativo: mes de referencia vs. mes anterior">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={[{ name: monthLabel(prevKey), valor: gastoMesAnt }, { name: monthLabel(refKey), valor: gastoMes }]}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E3D8C4" /><XAxis dataKey="name" tick={{ fill: "#6B5D4D", fontSize: 11 }} /><YAxis tick={{ fill: "#6B5D4D", fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} />
              <Bar dataKey="valor" radius={[3, 3, 0, 0]}>
                <Cell fill="#4C7EC9" /><Cell fill="#D98D34" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </div>
  );
}

function ChartPanel({ title, children }) {
  return (
    <div className="amg-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

/* ============================================================================
   REGISTRAR GASTO
============================================================================ */

function RegistrarGasto({ db, persist, addAudit, session, onGoInventario }) {
  const L = useLookups(db);
  const blank = { date: todayISO(), technicianId: "", categoryId: "", subcategoryId: "", productId: "", conceptManual: "", manualMode: false, quantity: 1, unitValue: "", observation: "", attachment: "" };
  const [form, setForm] = useState(blank);
  const [showConfirm, setShowConfirm] = useState(false);
  const [includeRetired, setIncludeRetired] = useState(false);
  const [saved, setSaved] = useState(false);

  const techOptions = db.technicians.filter((t) => includeRetired || t.status === "Activo").map((t) => ({ value: t.id, label: t.name, sublabel: `${t.code} · ${t.status}` }));
  const catOptions = db.categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }));
  const subOptions = db.subcategories.filter((s) => s.active && s.categoryId === form.categoryId).map((s) => ({ value: s.id, label: `${s.name}${s.trackStock ? " · controla inventario" : ""} (${s.tipo})` }));
  const prodOptions = db.products.filter((p) => p.active && p.subcategoryId === form.subcategoryId).map((p) => ({ value: p.id, label: `${p.name}${p.trackStock ? " · controla inventario" : ""}` }));

  const total =(parseFloat(form.quantity) || 0) * (parseFloat(form.unitValue) || 0);
  const selectedTech = db.technicians.find((t) => t.id === form.technicianId);
  const selectedSub = db.subcategories.find((s) => s.id === form.subcategoryId);
  const selectedProd = db.products.find((p) => p.id === form.productId);
  const bloqueadoPorInventario = !!selectedSub?.trackStock || !!selectedProd?.trackStock;
  const nombreBloqueado = selectedProd?.trackStock ? selectedProd.name : selectedSub?.name;

  const yaRecibioActivo = useMemo(() => {
    if (!selectedSub || selectedSub.tipo !== "activo" || !form.technicianId) return false;
    return db.expenses.some((e) => e.status === "Activo" && e.technicianId === form.technicianId && e.subcategoryId === selectedSub.id);
  }, [selectedSub, form.technicianId, db.expenses]);

  const canSave = !bloqueadoPorInventario && form.technicianId && form.categoryId && form.subcategoryId && (form.productId || form.conceptManual.trim()) && form.quantity && form.unitValue && (!selectedTech || selectedTech.status === "Activo" || includeRetired);

  const reset = (keepDims) => {
    setForm(keepDims ? { ...blank, technicianId: form.technicianId, categoryId: form.categoryId, subcategoryId: form.subcategoryId, date: form.date } : blank);
    setSaved(false);
  };

  const doSave = (again) => {
    const exp = {
      id: uid("e"), date: form.date, technicianId: form.technicianId, categoryId: form.categoryId,
      subcategoryId: form.subcategoryId, productId: form.productId || null,
      conceptManual: form.productId ? "" : form.conceptManual.trim(),
      quantity: parseFloat(form.quantity), unitValue: parseFloat(form.unitValue), totalValue: total,
      observation: form.observation, responsibleUserId: session.id, status: "Activo",
      annulReason: "", annulUserId: "", annulDate: "", createdAt: new Date().toISOString(),
      attachmentName: form.attachment || "",
    };
    let next = { ...db, expenses: [exp, ...db.expenses] };
    next = addAudit(next, { userId: session.id, action: "Registro de gasto", record: exp.id, oldValue: "-", newValue: fmtCOP(exp.totalValue) });
    persist(next);
    setShowConfirm(false);
    reset(again);
    setSaved(true);
  };

  return (
    <div style={{ maxWidth: 640 }}>
      {saved && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> Gasto registrado correctamente.</div>}

      {selectedTech && selectedTech.status !== "Activo" && (
        <div className="amg-alert danger"><ShieldAlert size={15} style={{ marginTop: 1 }} /> El técnico está {selectedTech.status.toLowerCase()}. Solo un administrador puede autorizar este registro.
          {session.role === "admin" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} /> Autorizar
            </label>
          )}
        </div>
      )}
      {yaRecibioActivo && (
        <div className="amg-alert warn"><AlertTriangle size={15} style={{ marginTop: 1 }} /> Este técnico ya ha recibido "{selectedSub.name}" anteriormente.</div>
      )}
      {bloqueadoPorInventario && (
        <div className="amg-alert warn">
          <Boxes size={15} style={{ marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            "{nombreBloqueado}" controla inventario: la compra y la entrega a un técnico se registran por separado en el módulo Inventario, no aquí.
          </div>
          <button className="amg-btn" style={{ flexShrink: 0 }} onClick={onGoInventario}>Ir a Inventario</button>
        </div>
      )}

      <div className="amg-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div><label className="amg-label">Técnico</label><SearchSelect options={techOptions} value={form.technicianId} onChange={(v) => setForm({ ...form, technicianId: v })} placeholder="Buscar técnico..." /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div><label className="amg-label">Categoría</label><SearchSelect options={catOptions} value={form.categoryId} onChange={(v) => setForm({ ...form, categoryId: v, subcategoryId: "", productId: "" })} placeholder="Seleccionar categoría" /></div>
          <div><label className="amg-label">Subcategoría</label><SearchSelect options={subOptions} value={form.subcategoryId} onChange={(v) => setForm({ ...form, subcategoryId: v, productId: "" })} placeholder="Seleccionar subcategoría" disabled={!form.categoryId} /></div>
        </div>
        <div>
          <label className="amg-label">Insumo / concepto</label>
          {!form.manualMode ? (
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}><SearchSelect options={prodOptions} value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} placeholder="Seleccionar insumo" disabled={!form.subcategoryId} /></div>
              <button type="button" className="amg-btn" onClick={() => setForm({ ...form, manualMode: true, productId: "" })}>Concepto manual</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <input className="amg-input" placeholder="Escribir concepto manual" value={form.conceptManual} onChange={(e) => setForm({ ...form, conceptManual: e.target.value })} />
              <button type="button" className="amg-btn" onClick={() => setForm({ ...form, manualMode: false, conceptManual: "" })}>Usar lista</button>
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <div><label className="amg-label">Cantidad</label><input type="number" min="0" className="amg-input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
          <div><label className="amg-label">Valor unitario (COP)</label><input type="number" min="0" className="amg-input" value={form.unitValue} onChange={(e) => setForm({ ...form, unitValue: e.target.value })} /></div>
          <div><label className="amg-label">Valor total</label><div className="amg-input amg-mono" style={{ background: "var(--panel)", color: "var(--accent)", fontWeight: 600 }}>{fmtCOP(total)}</div></div>
        </div>
        <div><label className="amg-label">Observación (opcional)</label><textarea className="amg-textarea" rows={2} value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></div>
        <div>
          <label className="amg-label">Soporte (foto, factura, recibo o PDF)</label>
          <label className="amg-btn" style={{ cursor: "pointer", width: "fit-content" }}>
            <Paperclip size={14} /> {form.attachment || "Adjuntar archivo"}
            <input type="file" style={{ display: "none" }} onChange={(e) => setForm({ ...form, attachment: e.target.files[0]?.name || "" })} />
          </label>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Responsable del registro: <b style={{ color: "var(--text-dim)" }}>{session.name}</b></div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <button className="amg-btn" onClick={() => reset(false)}>Cancelar</button>
          <button className="amg-btn primary" disabled={!canSave} onClick={() => setShowConfirm(true)}>Guardar gasto</button>
        </div>
      </div>

      {showConfirm && (
        <ConfirmModal title="Confirmar registro de gasto" confirmLabel="Guardar" onConfirm={() => doSave(false)} onClose={() => setShowConfirm(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            <Row k="Fecha" v={fmtDate(form.date)} />
            <Row k="Técnico" v={selectedTech?.name} />
            <Row k="Categoría" v={L.catById[form.categoryId]?.name} />
            <Row k="Subcategoría" v={L.subById[form.subcategoryId]?.name} />
            <Row k="Concepto" v={selectedProd?.name || form.conceptManual} />
            <Row k="Cantidad × valor" v={`${form.quantity} × ${fmtCOP(form.unitValue)}`} />
            <Row k="Total" v={<b style={{ color: "var(--accent)" }}>{fmtCOP(total)}</b>} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="amg-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => doSave(true)}>Guardar y registrar otro</button>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

function Row({ k, v }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-faint)" }}>{k}</span><span>{v}</span></div>;
}

/* ============================================================================
   HISTORIAL
============================================================================ */

function Historial({ db, persist, addAudit, session, onGoTech }) {
  const L = useLookups(db);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const [usuario, setUsuario] = useState("");
  const [sort, setSort] = useState({ field: "date", dir: "desc" });
  const [annulTarget, setAnnulTarget] = useState(null);
  const [annulReason, setAnnulReason] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const canImport = session.role === "admin" || session.role === "operador";

  // Para cada gasto de compra de stock: a qué técnicos se ha entregado ese insumo.
  const entregadoA = useMemo(() => {
    const keyOf = movementItemKeyFn(db);
    const porInsumo = {};
    (db.stockMovements || []).forEach((m) => {
      if (m.status === "Anulado" || m.type !== "Entrega" || !m.technicianId) return;
      const k = keyOf(m);
      porInsumo[k] = porInsumo[k] || {};
      porInsumo[k][m.technicianId] = (porInsumo[k][m.technicianId] || 0) + m.quantity;
    });
    const out = {};
    (db.stockMovements || []).forEach((m) => {
      if (m.type !== "Compra" || !m.relatedExpenseId) return;
      out[m.relatedExpenseId] = Object.entries(porInsumo[keyOf(m)] || {})
        .map(([id, qty]) => ({ name: L.techById[id]?.name || "-", qty })).sort((a, b) => b.qty - a.qty);
    });
    return out;
  }, [db.stockMovements, db.products, L]);

  const rows = useMemo(() => {
    let r = applyAllFilters(db.expenses, filters, db.technicians);
    if (estado) r = r.filter((e) => e.status === estado);
    if (usuario) r = r.filter((e) => e.responsibleUserId === usuario);
    if (q.trim()) {
      const qq = q.toLowerCase();
      r = r.filter((e) => (L.techById[e.technicianId]?.name || "").toLowerCase().includes(qq) || conceptOf(e, L).toLowerCase().includes(qq) || (e.observation || "").toLowerCase().includes(qq));
    }
    r = [...r].sort((a, b) => {
      let av, bv;
      if (sort.field === "tecnico") { av = L.techById[a.technicianId]?.name || ""; bv = L.techById[b.technicianId]?.name || ""; }
      else if (sort.field === "total") { av = a.totalValue; bv = b.totalValue; }
      else { av = a[sort.field]; bv = b[sort.field]; }
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
    return r;
  }, [db.expenses, filters, estado, usuario, q, sort, L, db.technicians]);

  const linkedMovementOf = (e) => (db.stockMovements || []).find((sm) => sm.relatedExpenseId === e.id && sm.status === "Activo");
  // Un gasto vinculado a una compra de inventario solo lo puede anular un admin,
  // porque anularlo también anula el movimiento de stock (y eso requiere permiso de admin).
  const canAnnul = (e) => linkedMovementOf(e) ? session.role === "admin" : session.role === "admin" || (session.role === "operador" && e.responsibleUserId === session.id && e.status === "Activo");

  const confirmAnnul = () => {
    if (!annulReason.trim()) return;
    let next = { ...db, expenses: db.expenses.map((e) => e.id === annulTarget.id ? { ...e, status: "Anulado", annulReason, annulUserId: session.id, annulDate: todayISO() } : e) };
    next = addAudit(next, { userId: session.id, action: "Anulación de movimiento", record: annulTarget.id, oldValue: "Activo", newValue: `Anulado: ${annulReason}` });
    const linkedMov = linkedMovementOf(annulTarget);
    if (linkedMov) {
      next = { ...next, stockMovements: next.stockMovements.map((sm) => sm.id === linkedMov.id
        ? { ...sm, status: "Anulado", annulReason: `Anulado automáticamente: gasto vinculado anulado (${annulReason})`, annulUserId: session.id, annulDate: todayISO() } : sm) };
      next = addAudit(next, { userId: session.id, action: "Anulación automática de compra de inventario vinculada", record: linkedMov.id, oldValue: "Activo", newValue: `Anulado por anulación de gasto ${annulTarget.id}` });
    }
    persist(next);
    setAnnulTarget(null); setAnnulReason("");
  };

  const exportCSV = () => {
    downloadCSV("historial_gastos.csv",
      ["Fecha", "Técnico", "Categoría", "Subcategoría", "Concepto", "Cantidad", "Valor unitario", "Valor total", "Responsable", "Estado", "Observación"],
      rows.map((e) => [fmtDate(e.date), e.technicianId ? L.techById[e.technicianId]?.name : "Compra de stock", L.catById[e.categoryId]?.name, L.subById[e.subcategoryId]?.name, conceptOf(e, L), e.quantity, e.unitValue, e.totalValue, L.userById[e.responsibleUserId]?.name, e.status, e.observation])
    );
  };

  const totalRows = rows.reduce((s, e) => s + (e.status === "Activo" ? e.totalValue : 0), 0);

  return (
    <div>
      <FiltersBar filters={filters} setFilters={setFilters} db={db} />
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Search size={14} style={{ position: "absolute", left: 8, top: 10, color: "var(--text-faint)" }} />
          <input className="amg-input" style={{ paddingLeft: 28 }} placeholder="Buscar técnico, concepto u observación..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="amg-select" style={{ width: 150 }} value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todos los estados</option><option value="Activo">Activo</option><option value="Anulado">Anulado</option>
        </select>
        <select className="amg-select" style={{ width: 180 }} value={usuario} onChange={(e) => setUsuario(e.target.value)}>
          <option value="">Todos los usuarios</option>
          {db.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
        {canImport && <button className="amg-btn" onClick={() => downloadImportTemplate(db)}><FileDown size={14} /> Plantilla</button>}
        {canImport && <button className="amg-btn primary" onClick={() => setImportOpen(true)}><Upload size={14} /> Importar gastos</button>}
      </div>

      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr>
            <SortableTh label="Fecha" field="date" sort={sort} setSort={setSort} />
            <SortableTh label="Técnico" field="tecnico" sort={sort} setSort={setSort} />
            <th>Categoría</th><th>Subcategoría</th><th>Concepto</th>
            <th>Cant.</th><th>V. unitario</th>
            <SortableTh label="Total" field="total" sort={sort} setSort={setSort} />
            <th>Responsable</th><th>Estado</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="amg-mono">{fmtDate(e.date)}</td>
                <td>{e.technicianId
                  ? <span style={{ cursor: "pointer", color: "var(--accent)" }} onClick={() => onGoTech(e.technicianId)}>{L.techById[e.technicianId]?.name}</span>
                  : <div>
                      <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>Compra de stock</span>
                      {(entregadoA[e.id] || []).length > 0 && (
                        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }} title={entregadoA[e.id].map((x) => `${x.name}: ${x.qty}`).join("\n")}>
                          Entregado a: {entregadoA[e.id].slice(0, 2).map((x) => `${x.name} (${x.qty})`).join(", ")}{entregadoA[e.id].length > 2 ? ` y ${entregadoA[e.id].length - 2} más` : ""}
                        </div>
                      )}
                    </div>}</td>
                <td>{L.catById[e.categoryId]?.name}</td>
                <td>{L.subById[e.subcategoryId]?.name}</td>
                <td>{conceptOf(e, L)}</td>
                <td className="amg-mono">{e.quantity}</td>
                <td className="amg-mono">{fmtCOP(e.unitValue)}</td>
                <td className="amg-mono" style={{ fontWeight: 600 }}>{fmtCOP(e.totalValue)}</td>
                <td>{L.userById[e.responsibleUserId]?.name}</td>
                <td><Badge text={e.status} color={statusColor(e.status)} />{e.status === "Anulado" && <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{e.annulReason}</div>}</td>
                <td>{canAnnul(e) && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setAnnulTarget(e)}><Ban size={14} color="var(--red)" /></button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin resultados para los filtros aplicados.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>{rows.length} movimientos · Total activo: <b className="amg-mono" style={{ color: "var(--accent)" }}>{fmtCOP(totalRows)}</b></div>

      {annulTarget && (
        <ConfirmModal title="Anular movimiento" confirmLabel="Anular" danger onConfirm={confirmAnnul} onClose={() => { setAnnulTarget(null); setAnnulReason(""); }}
          message="El movimiento original se conserva; solo cambia su estado. Esta acción queda registrada en auditoría.">
          <label className="amg-label">Motivo de anulación (obligatorio)</label>
          <textarea className="amg-textarea" rows={2} value={annulReason} onChange={(e) => setAnnulReason(e.target.value)} autoFocus />
        </ConfirmModal>
      )}

      {importOpen && (
        <ImportGastosModal db={db} persist={persist} addAudit={addAudit} session={session} onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}

/* ============================================================================
   TÉCNICOS
============================================================================ */

const TIPOS_TECNICO_CAMPO = ["Técnico junior", "Técnico senior", "Supervisor de campo"];
const TIPOS_ADMINISTRATIVO = ["Auxiliar administrativo", "Coordinador administrativo", "Gerente administrativo"];
const CATEGORIAS_PERSONAL = ["Técnico de campo", "Administrativo"];
const TIPOS_CONTRATO = ["Biver", "Producción", "Temporal"];
const DIAS_PICO_PLACA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
const MEDIOS_TRANSPORTE = ["Moto", "Servicio público", "Bicicleta", "Carro", "Otros"];
const TIPOS_CUENTA_BANCARIA = ["Ahorros", "Corriente", "Daviplata"];

function nextPersonCode(technicians, category) {
  const prefix = category === "Administrativo" ? "ADM" : "TEC";
  const nums = (technicians || [])
    .filter((t) => (t.code || "").startsWith(prefix + "-"))
    .map((t) => parseInt(t.code.slice(prefix.length + 1), 10))
    .filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}-${pad2(next)}`;
}

function Tecnicos({ db, persist, addAudit, session, onOpenProfile }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [depto, setDepto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [editing, setEditing] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [sort, setSort] = useState({ field: "department", dir: "asc" });
  const canEdit = session.role === "admin" || session.role === "operador";
  const canChangeStatus = session.role === "admin";

  const gastoPorTecnico = useMemo(() => {
    const m = {};
    db.expenses.filter((e) => e.status === "Activo").forEach((e) => { m[e.technicianId] = (m[e.technicianId] || 0) + e.totalValue; });
    return m;
  }, [db.expenses]);

  const departamentos = useMemo(() => Array.from(new Set(db.technicians.map((t) => t.department).filter(Boolean))).sort(), [db.technicians]);

  const rows = db.technicians.filter((t) =>
    (!status || t.status === status) &&
    (!depto || t.department === depto) &&
    (!categoria || (t.category || "Técnico de campo") === categoria) &&
    (!q.trim() || (t.name + t.code + t.city + (t.department || "")).toLowerCase().includes(q.toLowerCase()))
  ).sort((a, b) => {
    const val = (t) => sort.field === "gasto" ? (gastoPorTecnico[t.id] || 0) : (t[sort.field] || "");
    const av = val(a), bv = val(b);
    let cmp = typeof av === "number" ? av - bv : String(av).localeCompare(String(bv), "es");
    if (cmp === 0) cmp = (a.code || "").localeCompare(b.code || "", "es"); // desempate estable por código
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const saveTech = (data) => {
    let next;
    if (data.id) {
      const before = db.technicians.find((t) => t.id === data.id);
      next = { ...db, technicians: db.technicians.map((t) => t.id === data.id ? data : t) };
      next = addAudit(next, { userId: session.id, action: "Edición de personal", record: data.id, oldValue: before.status, newValue: data.status });
    } else {
      const nt = { ...data, id: uid("t"), code: nextPersonCode(db.technicians, data.category) };
      next = { ...db, technicians: [nt, ...db.technicians] };
      next = addAudit(next, { userId: session.id, action: "Creación de personal", record: nt.id, oldValue: "-", newValue: `${nt.code} — ${nt.name}` });
    }
    persist(next);
    setEditing(null);
  };

  const changeStatus = (tech, newStatus) => {
    const next0 = { ...db, technicians: db.technicians.map((t) => t.id === tech.id ? { ...t, status: newStatus, exitDate: newStatus === "Retirado" ? todayISO() : t.exitDate } : t) };
    const next = addAudit(next0, { userId: session.id, action: `Cambio de estado de personal`, record: tech.id, oldValue: tech.status, newValue: newStatus });
    persist(next);
    setConfirmAction(null);
  };

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={14} style={{ position: "absolute", left: 8, top: 10, color: "var(--text-faint)" }} />
          <input className="amg-input" style={{ paddingLeft: 28 }} placeholder="Buscar por nombre, código, ciudad o departamento..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="amg-select" style={{ width: 170 }} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>{CATEGORIAS_PERSONAL.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="amg-select" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option><option value="Activo">Activo</option><option value="Inactivo">Inactivo</option><option value="Retirado">Retirado</option>
        </select>
        <select className="amg-select" style={{ width: 180 }} value={depto} onChange={(e) => setDepto(e.target.value)}>
          <option value="">Todos los departamentos</option>{departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {canEdit && <button className="amg-btn primary" onClick={() => setEditing({})}><Plus size={14} /> Nueva persona</button>}
      </div>

      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr>
            <SortableTh label="Código" field="code" sort={sort} setSort={setSort} />
            <SortableTh label="Nombre" field="name" sort={sort} setSort={setSort} />
            <SortableTh label="Categoría" field="category" sort={sort} setSort={setSort} />
            <SortableTh label="Departamento" field="department" sort={sort} setSort={setSort} />
            <SortableTh label="Ciudad" field="city" sort={sort} setSort={setSort} />
            <SortableTh label="Cargo" field="type" sort={sort} setSort={setSort} />
            <SortableTh label="Estado" field="status" sort={sort} setSort={setSort} />
            <SortableTh label="Gasto acumulado" field="gasto" sort={sort} setSort={setSort} />
            <th></th>
          </tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="amg-mono">{t.code}</td>
                <td><span style={{ cursor: "pointer", color: "var(--accent)", fontWeight: 500 }} onClick={() => onOpenProfile(t.id)}>{t.name}</span></td>
                <td><Badge text={t.category || "Técnico de campo"} color={t.category === "Administrativo" ? "blue" : "amber"} /></td>
                <td>{t.department || "-"}</td><td>{t.city}</td><td>{t.type}</td>
                <td><Badge text={t.status} color={statusColor(t.status)} /></td>
                <td className="amg-mono">{fmtCOP(gastoPorTecnico[t.id] || 0)}</td>
                <td style={{ display: "flex", gap: 4 }}>
                  {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setEditing(t)}><Pencil size={14} /></button>}
                  {canChangeStatus && t.status === "Activo" && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setConfirmAction({ tech: t, to: "Inactivo" })}><CircleDot size={14} color="var(--text-dim)" /></button>}
                  {canChangeStatus && t.status === "Inactivo" && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setConfirmAction({ tech: t, to: "Activo" })}><RotateCcw size={14} color="var(--green)" /></button>}
                  {canChangeStatus && t.status !== "Retirado" && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setConfirmAction({ tech: t, to: "Retirado" })}><Ban size={14} color="var(--red)" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== null && <TecnicoFormModal tech={editing} technicians={db.technicians} onClose={() => setEditing(null)} onSave={saveTech} />}
      {confirmAction && (
        <ConfirmModal title={`Cambiar estado a "${confirmAction.to}"`} message={`¿Confirmas cambiar el estado de ${confirmAction.tech.name} a ${confirmAction.to}? El historial de gastos se conserva.`}
          confirmLabel="Confirmar" danger={confirmAction.to === "Retirado"} onConfirm={() => changeStatus(confirmAction.tech, confirmAction.to)} onClose={() => setConfirmAction(null)} />
      )}
    </div>
  );
}

function TecnicoFormModal({ tech, technicians, onClose, onSave }) {
  const [f, setF] = useState({
    id: tech.id || null, code: tech.code || "", name: tech.name || "", document: tech.document || "",
    phone: tech.phone || "", department: tech.department || "", city: tech.city || "", entryDate: tech.entryDate || todayISO(),
    status: tech.status || "Activo", exitDate: tech.exitDate || "",
    category: tech.category || "Técnico de campo", type: tech.type || TIPOS_TECNICO_CAMPO[0], notes: tech.notes || "",
    plate: tech.plate || "", contractType: tech.contractType || "", picoPlacaDay: tech.picoPlacaDay || "",
    transportMode: tech.transportMode || "", capacityMinutes: tech.capacityMinutes ?? "", residence: tech.residence || "",
    bankAccount: tech.bankAccount || "", bankAccountType: tech.bankAccountType || "", extremeUser: tech.extremeUser || "",
    assignOrder: tech.assignOrder ?? "", coordinator: tech.coordinator || "", operationSite: tech.operationSite || "Disponible",
  });
  const optSelect = (value, onChange, options) => (
    <select className="amg-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Seleccionar...</option>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
  const tipoOptions = f.category === "Administrativo" ? TIPOS_ADMINISTRATIVO : TIPOS_TECNICO_CAMPO;
  // Si el cargo actual no está en la lista vigente para la categoría (ej. viene de datos
  // antiguos, como "Instalador"), se conserva como primera opción para no perder el dato.
  const tipoOptionsShown = f.type && !tipoOptions.includes(f.type) ? [f.type, ...tipoOptions] : tipoOptions;
  const ciudadesDepto = CITIES_BY_DEPARTMENT[f.department] || [];

  const setCategoria = (category) => {
    const opts = category === "Administrativo" ? TIPOS_ADMINISTRATIVO : TIPOS_TECNICO_CAMPO;
    setF({ ...f, category, type: opts.includes(f.type) ? f.type : opts[0] });
  };

  return (
    <Modal title={tech.id ? "Editar persona" : "Nueva persona"} onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!f.name} onClick={() => onSave(f)}>Guardar</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label className="amg-label">Código interno</label>
          <div className="amg-input amg-mono" style={{ background: "var(--panel)", color: "var(--text-faint)" }}>{f.code || "Se genera automáticamente al guardar"}</div>
        </div>
        <div><label className="amg-label">Categoría</label>
          <select className="amg-select" value={f.category} onChange={(e) => setCategoria(e.target.value)}>
            {CATEGORIAS_PERSONAL.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div><label className="amg-label">Nombre completo</label><input className="amg-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="amg-label">Documento</label><input className="amg-input" value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /></div>
        <div><label className="amg-label">Teléfono</label><input className="amg-input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div><label className="amg-label">Fecha de ingreso</label><input type="date" className="amg-input" value={f.entryDate} onChange={(e) => setF({ ...f, entryDate: e.target.value })} /></div>
        <div><label className="amg-label">Departamento</label>
          <input className="amg-input" list="amg-departamentos" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value, city: "" })} placeholder="Ej. Atlántico" />
          <datalist id="amg-departamentos">{DEPARTAMENTOS_CO.map((d) => <option key={d} value={d} />)}</datalist>
        </div>
        <div><label className="amg-label">Ciudad</label>
          <input className="amg-input" list="amg-ciudades" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder={f.department ? "Selecciona o escribe una ciudad" : "Elige primero el departamento"} />
          <datalist id="amg-ciudades">{ciudadesDepto.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div><label className="amg-label">{f.category === "Administrativo" ? "Cargo" : "Cargo (nivel)"}</label>
          <select className="amg-select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {tipoOptionsShown.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-dim)", margin: "18px 0 10px", borderTop: "1px solid var(--border)", paddingTop: 14 }}>Datos adicionales</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label className="amg-label">Tipo de contrato</label>{optSelect(f.contractType, (v) => setF({ ...f, contractType: v }), TIPOS_CONTRATO)}</div>
        <div><label className="amg-label">Medio de transporte</label>{optSelect(f.transportMode, (v) => setF({ ...f, transportMode: v }), MEDIOS_TRANSPORTE)}</div>
        <div><label className="amg-label">Placa</label><input className="amg-input" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} /></div>
        <div><label className="amg-label">Día de pico y placa</label>{optSelect(f.picoPlacaDay, (v) => setF({ ...f, picoPlacaDay: v }), DIAS_PICO_PLACA)}</div>
        <div><label className="amg-label">Capacidad (minutos)</label><input type="number" min="0" className="amg-input" value={f.capacityMinutes} onChange={(e) => setF({ ...f, capacityMinutes: e.target.value })} /></div>
        <div><label className="amg-label">Vivienda (zona equivalente)</label>
          <ZonaPicker value={f.residence} valueName={f.residence} placeholder="Busca la zona (barrio o municipio) donde vive..."
            onPick={(z) => setF({ ...f, residence: z.name })} onClear={() => setF({ ...f, residence: "" })} />
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>La asignación usa esta zona para dar al técnico los servicios más cercanos a su casa.</div>
        </div>
        <div><label className="amg-label">Número de cuenta bancaria</label><input className="amg-input" value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value })} /></div>
        <div><label className="amg-label">Tipo de cuenta bancaria</label>{optSelect(f.bankAccountType, (v) => setF({ ...f, bankAccountType: v }), TIPOS_CUENTA_BANCARIA)}</div>
        <div><label className="amg-label">Usuario Extreme</label><input className="amg-input" value={f.extremeUser} onChange={(e) => setF({ ...f, extremeUser: e.target.value })} /></div>
      </div>
      {f.category !== "Administrativo" && (
        <>
          <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--text-dim)", margin: "18px 0 10px", borderTop: "1px solid var(--border)", paddingTop: 14 }}>Asignación de servicios</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label className="amg-label">Ubicación operativa</label>
              <select className="amg-select" value={f.operationSite} onChange={(e) => setF({ ...f, operationSite: e.target.value })}>
                <option value="Disponible">Disponible para ruta</option><option value="Sede">En sede (no sale a ruta)</option>
              </select>
            </div>
            <div><label className="amg-label">Orden de llenado de rutas</label><input type="number" min="1" className="amg-input" value={f.assignOrder} onChange={(e) => setF({ ...f, assignOrder: e.target.value })} placeholder="1 = primero en recibir servicios" /></div>
            <div><label className="amg-label">Coordinador</label><input className="amg-input" value={f.coordinator} onChange={(e) => setF({ ...f, coordinator: e.target.value })} /></div>
          </div>
        </>
      )}
      <div style={{ marginTop: 12 }}><label className="amg-label">Comentarios</label><textarea className="amg-textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
    </Modal>
  );
}

function TecnicoPerfil({ db, techId, onBack }) {
  const L = useLookups(db);
  const tech = db.technicians.find((t) => t.id === techId);
  if (!tech) return <div>Técnico no encontrado. <button className="amg-btn" onClick={onBack}>Volver</button></div>;

  const expenses = db.expenses.filter((e) => e.technicianId === techId && e.status === "Activo").sort((a, b) => b.date.localeCompare(a.date));
  const now = new Date();
  const curMonthKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const gastoMes = expenses.filter((e) => monthKey(e.date) === curMonthKey).reduce((s, e) => s + e.totalValue, 0);
  const gastoAnio = expenses.filter((e) => yearOf(e.date) === String(now.getFullYear())).reduce((s, e) => s + e.totalValue, 0);
  const gastoTotal = expenses.reduce((s, e) => s + e.totalValue, 0);

  const evol = useMemo(() => {
    const keys = last12MonthKeys();
    const m = Object.fromEntries(keys.map((k) => [k, 0]));
    expenses.forEach((e) => { const k = monthKey(e.date); if (k in m) m[k] += e.totalValue; });
    return keys.map((k) => ({ mes: monthLabel(k), valor: m[k] }));
  }, [expenses]);

  const porCategoria = useMemo(() => {
    const m = {};
    expenses.forEach((e) => { m[e.categoryId] = (m[e.categoryId] || 0) + e.totalValue; });
    return Object.entries(m).map(([id, val]) => ({ name: L.catById[id]?.name || id, value: val }));
  }, [expenses, L]);

  const herramientas = db.assets.filter((a) => a.technicianId === techId);
  const insumos = expenses.filter((e) => L.subById[e.subcategoryId]?.tipo === "consumible");
  const auxilios = expenses.filter((e) => L.catById[e.categoryId]?.name === "Transporte y movilidad" || L.catById[e.categoryId]?.name === "Comunicaciones");

  const vinipelSub = db.subcategories.find((s) => normalize(s.name) === "vinipel");
  const rollosVinipel = vinipelSub ? (db.stockMovements || []).filter((m) => m.type === "Entrega" && m.technicianId === techId && m.subcategoryId === vinipelSub.id).reduce((s, m) => s + m.quantity, 0) : 0;
  const trabajosRealizados = (db.services || []).filter((s) => s.technicianId === techId && trabajoCuenta(s)).reduce((s, r) => s + r.quantity, 0);
  const tasaVinipel = trabajosRealizados > 0 ? rollosVinipel / trabajosRealizados : null;

  return (
    <div>
      <button className="amg-btn" style={{ marginBottom: 14 }} onClick={onBack}>← Volver a técnicos</button>
      <div className="amg-card" style={{ padding: 18, marginBottom: 16, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{tech.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{tech.code} · {tech.category || "Técnico de campo"} · {tech.city}{tech.department ? `, ${tech.department}` : ""} · {tech.type} · Ingreso {fmtDate(tech.entryDate)}</div>
        </div>
        <Badge text={tech.status} color={statusColor(tech.status)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard label="Gasto acumulado total" value={fmtCOP(gastoTotal)} accent />
        <StatCard label="Gasto del mes" value={fmtCOP(gastoMes)} />
        <StatCard label="Gasto del año" value={fmtCOP(gastoAnio)} />
        <StatCard label="Último gasto registrado" value={expenses[0] ? fmtDate(expenses[0].date) : "-"} sub={expenses[0] ? fmtCOP(expenses[0].totalValue) : ""} />
        {vinipelSub && (rollosVinipel > 0 || trabajosRealizados > 0) && (
          <StatCard label="Tasa de uso de vinipel" value={tasaVinipel === null ? "—" : `${tasaVinipel.toFixed(2)} rollos/trabajo`} sub={`${rollosVinipel} rollos · ${trabajosRealizados} trabajos`} />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px,1fr))", gap: 14, marginBottom: 16 }}>
        <ChartPanel title="Gasto mensual del técnico (12 meses)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={evol}><CartesianGrid strokeDasharray="3 3" stroke="#E3D8C4" /><XAxis dataKey="mes" tick={{ fill: "#6B5D4D", fontSize: 10 }} /><YAxis tick={{ fill: "#6B5D4D", fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} /><Bar dataKey="valor" fill="#D98D34" radius={[3, 3, 0, 0]} /></BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="Distribución de gastos por categoría">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart><Pie data={porCategoria} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => e.name}>
              {porCategoria.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie><Tooltip formatter={(v) => fmtCOP(v)} contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} /></PieChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      {herramientas.length > 0 && (
        <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Herramientas asignadas</div>
          <table className="amg-table"><thead><tr><th>Código</th><th>Tipo</th><th>Marca/Modelo</th><th>Entrega</th><th>Estado</th></tr></thead>
            <tbody>{herramientas.map((a) => <tr key={a.id}><td className="amg-mono">{a.code}</td><td>{a.type}</td><td>{a.brand} {a.model}</td><td>{fmtDate(a.deliveryDate)}</td><td><Badge text={a.status} color={statusColor(a.status)} /></td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div className="amg-card" style={{ padding: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Historial cronológico de gastos</div>
        <div style={{ overflowX: "auto" }}>
          <table className="amg-table"><thead><tr><th>Fecha</th><th>Categoría</th><th>Subcategoría</th><th>Concepto</th><th>Cant.</th><th>Valor</th><th>Responsable</th></tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}><td className="amg-mono">{fmtDate(e.date)}</td><td>{L.catById[e.categoryId]?.name}</td><td>{L.subById[e.subcategoryId]?.name}</td><td>{conceptOf(e, L)}</td><td className="amg-mono">{e.quantity}</td><td className="amg-mono">{fmtCOP(e.totalValue)}</td><td>{L.userById[e.responsibleUserId]?.name}</td></tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-faint)", padding: 16 }}>Sin movimientos registrados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {insumos.length > 0 || auxilios.length > 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>
          Insumos entregados: {insumos.length} movimientos · Auxilios recibidos: {auxilios.length} movimientos
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================================
   TRABAJOS REALIZADOS (un producto trabajado por un técnico; para calcular
   tasas de uso de insumos, p. ej. vinipel)
============================================================================ */

const OBSERVACIONES_TRABAJO = ["Desarme", "Empaque", "N.A.N"];
const OBSERVACION_TRABAJO_INFO = {
  "Desarme": "Cuenta para la tasa de vinipel solo si Armado = SI.",
  "Empaque": "Cuenta para la tasa de vinipel solo si Armado = SI.",
  "N.A.N": "No armado por novedad. Cuenta para la tasa de vinipel sin importar Armado.",
};

// Un registro antiguo (sin Observación clasificada) sigue contando igual que
// siempre. Uno nuevo cuenta según la regla del negocio: Desarme/Empaque solo
// si quedó armado; N.A.N (no armado por novedad) siempre cuenta.
function trabajoCuenta(s) {
  // Un servicio cargado en Asignación solo cuenta cuando ya está realizado (los antiguos son "Realizado").
  if (s.estadoGestion && s.estadoGestion !== "Realizado") return false;
  if (!s.observacionTrabajo) return true;
  if (s.observacionTrabajo === "N.A.N") return true;
  if (s.observacionTrabajo === "Desarme" || s.observacionTrabajo === "Empaque") return s.armado === "SI";
  return true;
}

function Servicios({ db, persist, addAudit, session, onGoTech }) {
  const [tab, setTab] = useState("registrar");
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        <div className={`amg-tab ${tab === "registrar" ? "active" : ""}`} onClick={() => setTab("registrar")}>Registrar trabajo</div>
        <div className={`amg-tab ${tab === "historial" ? "active" : ""}`} onClick={() => setTab("historial")}>Historial de trabajos</div>
      </div>
      {tab === "registrar"
        ? <RegistrarServicio db={db} persist={persist} addAudit={addAudit} session={session} />
        : <HistorialServicios db={db} onGoTech={onGoTech} />}
    </div>
  );
}

function RegistrarServicio({ db, persist, addAudit, session }) {
  const blank = { date: todayISO(), technicianId: "", productId: "", quantity: 1, observacionTrabajo: OBSERVACIONES_TRABAJO[0], armado: "SI", observation: "" };
  const [form, setForm] = useState(blank);
  const [saved, setSaved] = useState(false);
  const techOptions = db.technicians.filter((t) => t.status === "Activo").map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));
  const prodOptions = db.products.filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }));
  const canSave = form.technicianId && form.productId && form.quantity > 0;

  const save = (again) => {
    const prod = db.products.find((p) => p.id === form.productId);
    const rec = {
      id: uid("srv"), date: form.date, technicianId: form.technicianId, serviceType: null, productId: form.productId,
      observacionTrabajo: form.observacionTrabajo, armado: form.armado,
      quantity: parseFloat(form.quantity), observation: form.observation, responsibleUserId: session.id, createdAt: new Date().toISOString(),
    };
    let next = { ...db, services: [rec, ...(db.services || [])] };
    next = addAudit(next, { userId: session.id, action: "Registro de trabajo realizado", record: rec.id, oldValue: "-", newValue: `${rec.quantity} × ${prod?.name} — ${rec.observacionTrabajo}/${rec.armado}` });
    persist(next);
    setSaved(true);
    setForm(again ? { ...blank, technicianId: form.technicianId, date: form.date } : blank);
  };

  return (
    <div style={{ maxWidth: 560 }}>
      {saved && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> Trabajo registrado correctamente.</div>}
      <div className="amg-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div><label className="amg-label">Técnico</label><SearchSelect options={techOptions} value={form.technicianId} onChange={(v) => setForm({ ...form, technicianId: v })} placeholder="Buscar técnico..." /></div>
        </div>
        <div><label className="amg-label">Producto</label><SearchSelect options={prodOptions} value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} placeholder="Buscar producto..." /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <div><label className="amg-label">Observación</label>
            <select className="amg-select" value={form.observacionTrabajo} onChange={(e) => setForm({ ...form, observacionTrabajo: e.target.value })}>
              {OBSERVACIONES_TRABAJO.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div><label className="amg-label">Armado</label>
            <select className="amg-select" value={form.armado} onChange={(e) => setForm({ ...form, armado: e.target.value })}>
              <option>SI</option><option>NO</option>
            </select>
          </div>
          <div><label className="amg-label">Cantidad</label><input type="number" min="1" className="amg-input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{OBSERVACION_TRABAJO_INFO[form.observacionTrabajo]}</div>
        <div><label className="amg-label">Observación adicional (opcional)</label><textarea className="amg-textarea" rows={2} value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Responsable del registro: <b style={{ color: "var(--text-dim)" }}>{session.name}</b></div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <button className="amg-btn" onClick={() => setForm(blank)}>Cancelar</button>
          <button className="amg-btn primary" disabled={!canSave} onClick={() => save(false)}>Guardar trabajo</button>
          <button className="amg-btn" disabled={!canSave} onClick={() => save(true)}>Guardar y registrar otro</button>
        </div>
      </div>
    </div>
  );
}

function HistorialServicios({ db, onGoTech }) {
  const L = useLookups(db);
  const [techId, setTechId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const services = db.services || [];
  const prodById = Object.fromEntries(db.products.map((p) => [p.id, p]));

  const rows = services.filter((s) =>
    s.technicianId && (s.estadoGestion || "Realizado") === "Realizado" &&
    (!techId || s.technicianId === techId) &&
    (!dateFrom || s.date >= dateFrom) &&
    (!dateTo || s.date <= dateTo)
  ).sort((a, b) => b.date.localeCompare(a.date));

  const exportCSV = () => downloadCSV("historial_trabajos.csv",
    ["Fecha", "Técnico", "Producto", "Observación", "Armado", "Cantidad", "Cuenta para tasa", "Responsable", "Observación adicional"],
    rows.map((s) => [fmtDate(s.date), L.techById[s.technicianId]?.name, prodById[s.productId]?.name || "-", s.observacionTrabajo || "-", s.armado || "-", s.quantity, trabajoCuenta(s) ? "Sí" : "No", L.userById[s.responsibleUserId]?.name, s.observation])
  );

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ minWidth: 200 }}><SearchSelect options={[{ value: "", label: "Todos los técnicos" }, ...db.technicians.map((t) => ({ value: t.id, label: t.name, sublabel: t.code }))]} value={techId} onChange={setTechId} placeholder="Todos los técnicos" /></div>
        <input type="date" className="amg-input" style={{ width: 150 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" className="amg-input" style={{ width: 150 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Fecha</th><th>Técnico</th><th>Producto</th><th>Observación</th><th>Armado</th><th>Cantidad</th><th>Cuenta</th><th>Responsable</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="amg-mono">{fmtDate(s.date)}</td>
                <td><span style={{ cursor: "pointer", color: "var(--accent)" }} onClick={() => onGoTech(s.technicianId)}>{L.techById[s.technicianId]?.name}</span></td>
                <td>{prodById[s.productId]?.name || "-"}</td>
                <td>{s.observacionTrabajo || "-"}</td>
                <td>{s.armado || "-"}</td>
                <td className="amg-mono">{s.quantity}</td>
                <td>{trabajoCuenta(s) ? <Badge text="Sí" color="green" /> : <Badge text="No" color="gray" />}</td>
                <td>{L.userById[s.responsibleUserId]?.name}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin trabajos registrados para estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>{rows.length} registros · Trabajos que cuentan para la tasa: <b className="amg-mono">{rows.filter(trabajoCuenta).reduce((s, r) => s + r.quantity, 0)}</b></div>
    </div>
  );
}

/* ============================================================================
   MAESTROS (tablas de apoyo editables; por ahora solo Causales)
============================================================================ */

const cleanCausalName = (s) => (s || "").trim().replace(/\s+/g, " ").toUpperCase();

function Maestros({ db, persist, addAudit, session }) {
  const [tabla, setTabla] = useState("causales");
  const TABLAS = [
    { key: "causales", label: "Causales" },
    { key: "zonas", label: "Barrios y zonas equivalentes" },
    { key: "productos", label: "Productos de armado" },
  ];
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap" }}>
        {TABLAS.map((t) => <div key={t.key} className={`amg-tab ${tabla === t.key ? "active" : ""}`} onClick={() => setTabla(t.key)}>{t.label}</div>)}
      </div>
      {tabla === "causales" && <MaestroCausales db={db} persist={persist} addAudit={addAudit} session={session} />}
      {tabla === "zonas" && <MaestroZonasBarrios db={db} persist={persist} addAudit={addAudit} session={session} />}
      {tabla === "productos" && <MaestroProductosArmado db={db} persist={persist} addAudit={addAudit} session={session} />}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Maestros de Asignación (zonas, barrios, productos de armado, complejidad).
   Son tablas grandes: se consultan por páginas directamente en Supabase.
---------------------------------------------------------------------------- */

const SQL_ASIGNACION_AVISO = "Si es la primera vez, falta correr en Supabase el SQL de Asignación (archivos sql/14 y sql/15).";

function buildMaestroPayload(fields, f) {
  const o = {};
  fields.forEach((fd) => {
    let v = f[fd.key];
    if (fd.type === "number") v = v === "" || v === null || v === undefined ? null : Number(v);
    else if (fd.type === "check") v = !!v;
    else { v = (v ?? "").toString().trim(); if (fd.upper) v = v.toUpperCase(); if (v === "") v = null; }
    o[fd.key] = v;
  });
  return o;
}

// Buscador de zona equivalente que consulta Supabase mientras se escribe (son más de 4.000).
function ZonaPicker({ value, valueName, onPick, onClear, placeholder }) {
  const [q, setQ] = useState(valueName || "");
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || q.trim().length < 2) { setRes([]); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      maestrosApi.listPage("geo_zones", { select: "id,name,region,zone_type", search: q, searchCols: ["name"], pageSize: 12 })
        .then((r) => { if (alive) setRes(r.rows); }).catch(() => {});
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);
  return (
    <div style={{ position: "relative" }}>
      <input className="amg-input" value={q} placeholder={placeholder || "Escribe para buscar la zona (mín. 2 letras)..."} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {value && (
        <div style={{ fontSize: 11, color: "var(--green)", marginTop: 2 }}>
          Zona elegida ✓ {onClear && <span style={{ color: "var(--red)", cursor: "pointer", marginLeft: 8 }} onClick={() => { setQ(""); onClear(); }}>Quitar</span>}
        </div>
      )}
      {open && res.length > 0 && (
        <div className="amg-searchselect-panel" style={{ position: "absolute", left: 0, right: 0, zIndex: 20 }}>
          {res.map((z) => (
            <div key={z.id} className="amg-searchselect-opt" onClick={() => { setQ(z.name); setOpen(false); onPick(z); }}>
              <div>{z.name}</div><div style={{ fontSize: 11, color: "var(--text-faint)" }}>Región {z.region ?? "-"} · {z.zone_type || "-"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MaestroFormModal({ title, fields, initial, locked, onSave, onClose }) {
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const payload = buildMaestroPayload(fields, f);
    const falta = fields.find((fd) => fd.required && (payload[fd.key] === null || payload[fd.key] === ""));
    if (falta) { setErr(`Falta: ${falta.label}`); return; }
    setBusy(true); setErr("");
    try { await onSave(payload); } catch (e) { setErr(/duplicate|unique/i.test(e.message) ? "Ya existe un registro con esos datos." : e.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} width={640}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={busy} onClick={submit}>{busy ? "Guardando..." : "Guardar"}</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {fields.map((fd) => (
          <div key={fd.key} style={fd.wide ? { gridColumn: "1 / -1" } : undefined}>
            <label className="amg-label">{fd.label}{fd.required ? " *" : ""}</label>
            {fd.type === "select" ? (
              <select className="amg-select" value={f[fd.key] ?? ""} onChange={(e) => setF({ ...f, [fd.key]: e.target.value })}>
                <option value="">Seleccionar...</option>{fd.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : fd.type === "check" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, paddingTop: 6 }}>
                <input type="checkbox" checked={!!f[fd.key]} onChange={(e) => setF({ ...f, [fd.key]: e.target.checked })} /> {fd.checkLabel || "Sí"}
              </label>
            ) : fd.type === "zone" ? (
              <ZonaPicker value={f[fd.key]} valueName={f.zoneName} onPick={(z) => setF({ ...f, [fd.key]: z.id, zoneName: z.name, region: f.region ?? z.region, zone_type: f.zone_type || z.zone_type })} />
            ) : (
              <input className="amg-input" type={fd.type === "number" ? "number" : "text"} step={fd.type === "number" ? "any" : undefined}
                disabled={locked && fd.lockedOnEdit} value={f[fd.key] ?? ""} onChange={(e) => setF({ ...f, [fd.key]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      {err && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {err}</div>}
    </Modal>
  );
}

// Lista paginada de una tabla de maestros: búsqueda, filtros, crear, editar y activar/inactivar.
function MaestroLista({ entity, table, select = "*", pk = "id", columns, searchCols, searchPlaceholder, orderBy, filtersDef = [], fields, hasActive, newLabel, rowLabel, reloadSignal, db, persist, addAudit, session }) {
  const PAGE = 50;
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [filters, setFilters] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [tick, setTick] = useState(0);
  const filtersKey = JSON.stringify(filters);

  useEffect(() => { const t = setTimeout(() => { setQDeb(q); setPage(0); }, 350); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    maestrosApi.listPage(table, { select, search: qDeb, searchCols, filters, orderBy, page, pageSize: PAGE })
      .then((r) => { if (alive) { setRows(r.rows); setCount(r.count); } })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [table, select, qDeb, filtersKey, page, tick, reloadSignal]);

  const audit = (action, record, oldV, newV) => persist(addAudit(db, { userId: session.id, action, record: String(record), oldValue: oldV, newValue: newV }));

  const save = async (payload) => {
    const existing = modal && modal[pk] ? modal : null;
    if (existing) {
      await maestrosApi.updateRow(table, existing[pk], payload, pk);
      audit(`Edición de ${entity}`, existing[pk], rowLabel(existing), rowLabel({ ...existing, ...payload }));
    } else {
      const created = await maestrosApi.insertRow(table, payload);
      audit(`Creación de ${entity}`, created[pk], "-", rowLabel(created));
    }
    setModal(null); setTick((t) => t + 1);
  };

  const changeActive = async (row, active) => {
    try {
      await maestrosApi.updateRow(table, row[pk], { active }, pk);
      audit(active ? `Reactivación de ${entity}` : `Inactivación de ${entity}`, row[pk], rowLabel(row), active ? "Activo" : "Inactivo");
      setTick((t) => t + 1);
    } catch (e) { setError(e.message); }
    setConfirmAction(null);
  };

  const initialFor = (row) => {
    const base = { ...(row || {}) };
    if (row && row.zone) base.zoneName = row.zone.name;
    if (!row && hasActive) base.active = true;
    return base;
  };

  const desde = count === 0 ? 0 : page * PAGE + 1;
  const hasta = Math.min(count, page * PAGE + rows.length);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 240px" }}>
          <Search size={14} style={{ position: "absolute", left: 8, top: 10, color: "var(--text-faint)" }} />
          <input className="amg-input" style={{ paddingLeft: 28 }} placeholder={searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {filtersDef.map((fd) => (
          <select key={fd.key} className="amg-select" style={{ width: fd.width || 170 }} value={filters[fd.key] ?? ""} onChange={(e) => { setFilters({ ...filters, [fd.key]: e.target.value }); setPage(0); }}>
            <option value="">{fd.label}</option>{fd.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        <button className="amg-btn primary" onClick={() => setModal({})}><Plus size={14} /> {newLabel}</button>
      </div>

      {error && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> {error}. {SQL_ASIGNACION_AVISO}</div>}

      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr>{columns.map((c) => <th key={c.label}>{c.label}</th>)}{hasActive && <th>Estado</th>}<th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[pk]} style={hasActive && r.active === false ? { opacity: 0.6 } : undefined}>
                {columns.map((c) => <td key={c.label} className={c.mono ? "amg-mono" : ""}>{c.render ? c.render(r) : (r[c.key] ?? "-")}</td>)}
                {hasActive && <td><Badge text={r.active === false ? "Inactivo" : "Activo"} color={r.active === false ? "gray" : "green"} /></td>}
                <td style={{ display: "flex", gap: 4 }}>
                  <button className="amg-btn ghost" style={{ padding: 4 }} title="Editar" onClick={() => setModal(r)}><Pencil size={13} /></button>
                  {hasActive && (
                    <button className="amg-btn ghost" style={{ padding: 4 }} title={r.active === false ? "Reactivar" : "Inactivar"} onClick={() => setConfirmAction({ row: r, to: r.active === false })}>
                      {r.active === false ? <RotateCcw size={13} color="var(--green)" /> : <Ban size={13} color="var(--red)" />}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && !error && <tr><td colSpan={columns.length + 2} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin registros. Si aún no has cargado los datos, usa "Importar desde Excel".</td></tr>}
            {loading && <tr><td colSpan={columns.length + 2} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Cargando...</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 12.5, color: "var(--text-dim)", flexWrap: "wrap", gap: 8 }}>
        <span>Mostrando {desde}–{hasta} de {count.toLocaleString("es-CO")}. Los registros no se eliminan: se inactivan o se editan.</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button className="amg-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>← Anterior</button>
          <button className="amg-btn" disabled={hasta >= count} onClick={() => setPage(page + 1)}>Siguiente →</button>
        </span>
      </div>

      {modal !== null && (
        <MaestroFormModal title={modal[pk] ? `Editar ${entity}` : newLabel} fields={fields} initial={initialFor(modal[pk] ? modal : null)} locked={!!modal[pk]} onSave={save} onClose={() => setModal(null)} />
      )}
      {confirmAction && (
        <ConfirmModal title={confirmAction.to ? "Reactivar" : "Inactivar"} message={`¿${confirmAction.to ? "Reactivar" : "Inactivar"} "${rowLabel(confirmAction.row)}"? No se borra nada: deja de usarse en la asignación mientras esté inactivo.`}
          confirmLabel="Confirmar" danger={!confirmAction.to} onConfirm={() => changeActive(confirmAction.row, confirmAction.to)} onClose={() => setConfirmAction(null)} />
      )}
    </div>
  );
}

// Importación única (o de actualización) desde los Excel de Asignación. Primero analiza y muestra el
// resumen; solo escribe en la base de datos cuando se confirma. No borra nada: crea y actualiza.
function ImportMaestrosModal({ kind, onClose, onDone }) {
  const [files, setFiles] = useState({});
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [result, setResult] = useState(null);
  const isGeo = kind === "geo";
  const rep = parsed?.report;

  const analyze = async () => {
    setBusy(true); setError(""); setParsed(null);
    try {
      const wb = readMaestroWorkbook(await files.main.arrayBuffer());
      if (isGeo) setParsed(parseZonasBarrios(wb, files.dist ? readMaestroWorkbook(await files.dist.arrayBuffer()) : null));
      else setParsed(parseProductos(wb));
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const run = async () => {
    setBusy(true); setError("");
    try {
      const res = isGeo ? await maestrosApi.importGeo(parsed, setStep) : await maestrosApi.importAssembly(parsed, setStep);
      setResult(res); onDone(res);
    } catch (e) { setError(`${e.message}. ${SQL_ASIGNACION_AVISO}`); }
    setBusy(false);
  };
  const Lista = ({ titulo, items }) => items && items.length > 0 && (
    <details style={{ marginTop: 8, fontSize: 12.5 }}>
      <summary style={{ cursor: "pointer" }}>{titulo} ({items.length})</summary>
      <div style={{ maxHeight: 160, overflowY: "auto", color: "var(--text-dim)", marginTop: 4 }}>{items.slice(0, 200).map((x, i) => <div key={i}>{x}</div>)}{items.length > 200 && <div>... y {items.length - 200} más</div>}</div>
    </details>
  );

  return (
    <Modal title={isGeo ? "Importar barrios y zonas desde Excel" : "Importar productos de armado desde Excel"} onClose={busy ? () => {} : onClose} width={680}
      footer={result ? <button className="amg-btn primary" onClick={onClose}>Cerrar</button> : <>
        <button className="amg-btn" disabled={busy} onClick={onClose}>Cancelar</button>
        {!parsed && <button className="amg-btn" disabled={busy || !files.main} onClick={analyze}>{busy ? "Analizando..." : "Analizar archivo"}</button>}
        {parsed && <button className="amg-btn primary" disabled={busy} onClick={run}><Upload size={14} /> {busy ? "Importando..." : "Importar a la base de datos"}</button>}
      </>}>
      {!result && (
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label className="amg-label">{isGeo ? "Archivo \"Barrios - Zonas Equivalentes\" (hojas Barrios, Zonas Equivalentes y Abreviatura) *" : "Archivo \"Tablas de Datos\" (hojas Productos y Complejidad) *"}</label>
            <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(e) => { setFiles({ ...files, main: e.target.files[0] }); setParsed(null); }} />
          </div>
          {isGeo && (
            <div>
              <label className="amg-label">Archivo "Distancias y Tiempo Pueblos o Municipios" (opcional; se une a las zonas de tipo municipio)</label>
              <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(e) => { setFiles({ ...files, dist: e.target.files[0] }); setParsed(null); }} />
            </div>
          )}
        </div>
      )}
      {rep && !result && (
        <div className="amg-card" style={{ padding: 12, marginTop: 14, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Resumen del archivo</div>
          {isGeo ? (<>
            <div>Zonas equivalentes: <b>{rep.zonas.toLocaleString("es-CO")}</b> ({rep.zonasSinCoordenadas} sin coordenadas, {rep.zonasRepetidas} repetidas que se omiten)</div>
            <div>Barrios: <b>{rep.barrios.toLocaleString("es-CO")}</b> ({rep.barriosRepetidos} repetidos exactos que se omiten; los de igual nombre en regiones distintas se conservan todos)</div>
            <div>Municipios con distancia/tiempo unidos a su zona: <b>{rep.distancias}</b></div>
            <Lista titulo="Distancias que no encontraron su municipio (revísalas manualmente)" items={rep.distanciasSinZona} />
            <Lista titulo="Barrios cuya zona no existe en la hoja de zonas (no se importan)" items={rep.barriosSinZona} />
            <Lista titulo="Barrios con la misma llave pero otra zona (queda la primera)" items={rep.barriosEnConflicto} />
          </>) : (<>
            <div>Productos: <b>{rep.productos.toLocaleString("es-CO")}</b> ({rep.productosSinTiempo} sin tiempo, {rep.productosSinPersonas} sin # de personas → se toman como 1, {rep.productosRepetidos} repetidos que se omiten)</div>
            <div>Reglas de complejidad por línea/sublínea: <b>{rep.complejidad}</b></div>
            <Lista titulo="Complejidades inválidas (no se importan)" items={rep.complejidadInvalida} />
          </>)}
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>Importar crea lo nuevo y actualiza lo que ya existe; no borra nada.</div>
        </div>
      )}
      {busy && step && <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-dim)" }}>{step}</div>}
      {result && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> Importación terminada: {Object.entries(result).map(([k, v]) => `${v.toLocaleString("es-CO")} ${k}`).join(" · ")}.</div>}
      {error && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {error}</div>}
    </Modal>
  );
}

const REGIONES_OPT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: `Región ${n}` }));

function MaestroZonasBarrios({ db, persist, addAudit, session }) {
  const [sub, setSub] = useState("zonas");
  const [importOpen, setImportOpen] = useState(false);
  const [reloadSignal, setReloadSignal] = useState(0);
  const common = { db, persist, addAudit, session, reloadSignal };
  const SUBS = [{ key: "zonas", label: "Zonas equivalentes" }, { key: "barrios", label: "Barrios" }, { key: "deptos", label: "Departamentos y regiones" }, { key: "codigos", label: "Códigos de municipio" }];
  const codigoFields = [
    { key: "dept_code", label: "Código de departamento (como viene en la base)", required: true, upper: true },
    { key: "city_code", label: "Código de municipio (columna CIUDAD)", required: true, upper: true },
    { key: "city_name", label: "Nombre del municipio", required: true, upper: true, wide: true },
    { key: "active", label: "Estado", type: "check", checkLabel: "Activo" },
  ];

  const zonaFields = [
    { key: "name", label: "Zona equivalente", required: true, wide: true, upper: true },
    { key: "zone_type", label: "Tipo", type: "select", options: ["MUNICIPIO", "BARRIO"], required: true },
    { key: "region", label: "Región", type: "number", required: true },
    { key: "zone_id", label: "IDZona (sector)", type: "number" }, { key: "cluster", label: "Cluster", type: "number" },
    { key: "head", label: "Cabecera" }, { key: "dept_abbr", label: "Abreviatura del departamento", upper: true },
    { key: "compatibility", label: "Z.Compatibilidad", type: "number" }, { key: "danger", label: "Peligrosidad" },
    { key: "latitude", label: "Latitud", type: "number" }, { key: "longitude", label: "Longitud", type: "number" },
    { key: "distance_km", label: "Distancia desde la sede (km)", type: "number" }, { key: "travel_time", label: "Tiempo de desplazamiento (min)", type: "number" },
    { key: "viatico", label: "Viático ($)", type: "number" }, { key: "distance_value", label: "Valor por distancia ($)", type: "number" },
    { key: "active", label: "Estado", type: "check", checkLabel: "Activa" },
  ];
  const barrioFields = [
    { key: "city", label: "Ciudad / municipio", required: true, upper: true }, { key: "neighborhood", label: "Barrio", required: true, upper: true },
    { key: "zone_id", label: "Zona equivalente", type: "zone", required: true, wide: true },
    { key: "region", label: "Región", type: "number", required: true }, { key: "zone_type", label: "Tipo", type: "select", options: ["MUNICIPIO", "BARRIO"] },
    { key: "active", label: "Estado", type: "check", checkLabel: "Activo" },
  ];
  const deptoFields = [
    { key: "abbr", label: "Abreviatura", required: true, upper: true, lockedOnEdit: true }, { key: "name", label: "Nombre", required: true, upper: true },
    { key: "region_id", label: "Región", type: "number", required: true }, { key: "level", label: "A nivel de", type: "select", options: ["MUNICIPIO", "BARRIO"], required: true },
    { key: "dept_abbr", label: "Abreviatura del departamento", upper: true },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SUBS.map((s) => <button key={s.key} className={`amg-btn ${sub === s.key ? "primary" : ""}`} onClick={() => setSub(s.key)}>{s.label}</button>)}
        </div>
        <button className="amg-btn" onClick={() => setImportOpen(true)}><Upload size={14} /> Importar desde Excel</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 12 }}>
        La zona equivalente agrupa barrios y municipios para armar rutas. Cada barrio apunta a una zona; las zonas de tipo municipio guardan además la distancia y el tiempo desde la sede.
      </div>
      {sub === "zonas" && (
        <MaestroLista {...common} key="zonas" entity="zona equivalente" table="geo_zones" orderBy="name" hasActive newLabel="Nueva zona"
          searchCols={["name", "head"]} searchPlaceholder="Buscar zona..." fields={zonaFields} rowLabel={(r) => r.name}
          filtersDef={[{ key: "region", label: "Todas las regiones", options: REGIONES_OPT }, { key: "zone_type", label: "Todos los tipos", options: [{ value: "MUNICIPIO", label: "Municipio" }, { value: "BARRIO", label: "Barrio" }] }]}
          columns={[
            { label: "Zona equivalente", key: "name" }, { label: "Tipo", key: "zone_type" }, { label: "Región", key: "region", mono: true }, { label: "IDZona", key: "zone_id", mono: true },
            { label: "Compat.", key: "compatibility", mono: true }, { label: "Km", key: "distance_km", mono: true }, { label: "Min", key: "travel_time", mono: true },
            { label: "Coordenadas", render: (r) => (r.latitude !== null && r.longitude !== null ? <span className="amg-mono" style={{ fontSize: 11.5 }}>{Number(r.latitude).toFixed(4)}, {Number(r.longitude).toFixed(4)}</span> : <span style={{ color: "var(--text-faint)" }}>sin coordenadas</span>) },
          ]} />
      )}
      {sub === "barrios" && (
        <MaestroLista {...common} key="barrios" entity="barrio" table="geo_neighborhoods" select="*,zone:geo_zones(name)" orderBy="city" hasActive newLabel="Nuevo barrio"
          searchCols={["city", "neighborhood"]} searchPlaceholder="Buscar ciudad o barrio..." fields={barrioFields} rowLabel={(r) => `${r.city} · ${r.neighborhood}`}
          filtersDef={[{ key: "region", label: "Todas las regiones", options: REGIONES_OPT }]}
          columns={[{ label: "Ciudad", key: "city" }, { label: "Barrio", key: "neighborhood" }, { label: "Zona equivalente", render: (r) => r.zone?.name || "-" }, { label: "Región", key: "region", mono: true }, { label: "Tipo", key: "zone_type" }]} />
      )}
      {sub === "deptos" && (
        <MaestroLista {...common} key="deptos" entity="departamento/región" table="geo_abbreviations" pk="abbr" orderBy="region_id" newLabel="Nueva abreviatura"
          searchCols={["abbr", "name"]} searchPlaceholder="Buscar..." fields={deptoFields} rowLabel={(r) => `${r.abbr} · ${r.name}`}
          columns={[{ label: "Abreviatura", key: "abbr", mono: true }, { label: "Nombre", key: "name" }, { label: "Región", key: "region_id", mono: true }, { label: "A nivel de", key: "level" }, { label: "Depto.", key: "dept_abbr" }]} />
      )}
      {sub === "codigos" && (
        <div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 10 }}>
            La base de Jamar trae algunos municipios solo como código (ej. departamento AN + ciudad BA = Barbosa). Aquí se define a qué municipio corresponde cada código; si aparece uno nuevo, agrégalo y vuelve a subir la base.
          </div>
          <MaestroLista {...common} key="codigos" entity="código de municipio" table="geo_city_codes" orderBy="dept_code" hasActive newLabel="Nuevo código"
            searchCols={["dept_code", "city_code", "city_name"]} searchPlaceholder="Buscar código o municipio..." fields={codigoFields} rowLabel={(r) => `${r.dept_code}|${r.city_code} → ${r.city_name}`}
            columns={[{ label: "Departamento", key: "dept_code", mono: true }, { label: "Código municipio", key: "city_code", mono: true }, { label: "Municipio", key: "city_name" }]} />
        </div>
      )}
      {importOpen && (
        <ImportMaestrosModal kind="geo" onClose={() => setImportOpen(false)}
          onDone={(res) => { setReloadSignal((n) => n + 1); persist(addAudit(db, { userId: session.id, action: "Importación de barrios y zonas", record: "geo", oldValue: "-", newValue: `${res.zones} zonas · ${res.neighborhoods} barrios` })); }} />
      )}
    </div>
  );
}

function MaestroProductosArmado({ db, persist, addAudit, session }) {
  const [sub, setSub] = useState("productos");
  const [importOpen, setImportOpen] = useState(false);
  const [reloadSignal, setReloadSignal] = useState(0);
  const common = { db, persist, addAudit, session, reloadSignal };
  const productoFields = [
    { key: "code", label: "Código", required: true, lockedOnEdit: true }, { key: "name", label: "Producto", required: true, upper: true },
    { key: "minutes", label: "Tiempo de armado (min)", type: "number" }, { key: "persons", label: "Personas para armarlo (1 o 2)", type: "number", required: true },
    { key: "price_single", label: "Precio armado individual ($)", type: "number" }, { key: "price_pair", label: "Precio armado entre dos ($)", type: "number" },
    { key: "supplier", label: "Proveedor" }, { key: "code2", label: "Código 2" },
    { key: "active", label: "Estado", type: "check", checkLabel: "Activo" },
  ];
  const compFields = [
    { key: "line", label: "Línea", required: true }, { key: "subline", label: "Sublínea", required: true },
    { key: "complexity", label: "Complejidad", type: "select", options: ["Baja", "Media", "Alta"], required: true },
    { key: "embeddable", label: "Empotrable", type: "check", checkLabel: "Es empotrable" },
  ];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button className={`amg-btn ${sub === "productos" ? "primary" : ""}`} onClick={() => setSub("productos")}>Productos</button>
          <button className={`amg-btn ${sub === "complejidad" ? "primary" : ""}`} onClick={() => setSub("complejidad")}>Complejidad por línea</button>
        </div>
        <button className="amg-btn" onClick={() => setImportOpen(true)}><Upload size={14} /> Importar desde Excel</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 12 }}>
        Aquí se configura el tiempo de armado de cada producto y si se arma entre 2 personas. La complejidad (y si es empotrable) se define por línea y sublínea: los de complejidad Alta o empotrables los toma un técnico senior.
      </div>
      {sub === "productos" && (
        <MaestroLista {...common} key="productos" entity="producto de armado" table="assembly_products" orderBy="name" hasActive newLabel="Nuevo producto"
          searchCols={["code", "name"]} searchPlaceholder="Buscar por código o producto..." fields={productoFields} rowLabel={(r) => `${r.code} · ${r.name}`}
          filtersDef={[{ key: "persons", label: "Todas las personas", options: [{ value: 1, label: "1 persona" }, { value: 2, label: "2 personas" }] }, { key: "active", label: "Todos los estados", options: [{ value: "true", label: "Activos" }, { value: "false", label: "Inactivos" }] }]}
          columns={[{ label: "Código", key: "code", mono: true }, { label: "Producto", key: "name" }, { label: "Min", key: "minutes", mono: true }, { label: "Personas", key: "persons", mono: true },
            { label: "Armado individual", render: (r) => (r.price_single !== null ? fmtCOP(r.price_single) : "-"), mono: true }, { label: "Armado entre dos", render: (r) => (r.price_pair !== null ? fmtCOP(r.price_pair) : "-"), mono: true }]} />
      )}
      {sub === "complejidad" && (
        <MaestroLista {...common} key="complejidad" entity="complejidad de línea" table="assembly_complexity" orderBy="line" newLabel="Nueva regla"
          searchCols={["line", "subline"]} searchPlaceholder="Buscar línea o sublínea..." fields={compFields} rowLabel={(r) => `${r.line} · ${r.subline}: ${r.complexity}${r.embeddable ? " (empotrable)" : ""}`}
          filtersDef={[{ key: "complexity", label: "Toda complejidad", options: ["Baja", "Media", "Alta"].map((c) => ({ value: c, label: c })) }]}
          columns={[{ label: "Línea", key: "line" }, { label: "Sublínea", key: "subline" }, { label: "Complejidad", render: (r) => <Badge text={r.complexity} color={r.complexity === "Alta" ? "red" : r.complexity === "Media" ? "amber" : "gray"} /> }, { label: "Empotrable", render: (r) => (r.embeddable ? "Sí" : "No") }]} />
      )}
      {importOpen && (
        <ImportMaestrosModal kind="assembly" onClose={() => setImportOpen(false)}
          onDone={(res) => { setReloadSignal((n) => n + 1); persist(addAudit(db, { userId: session.id, action: "Importación de productos de armado", record: "assembly", oldValue: "-", newValue: `${res.products} productos · ${res.complexity} reglas de complejidad` })); }} />
      )}
    </div>
  );
}

function MaestroCausales({ db, persist, addAudit, session }) {
  const [modal, setModal] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [estado, setEstado] = useState("");
  const [q, setQ] = useState("");
  const causales = db.causales || [];

  // Cuántos servicios usan cada causal (como causal auditada o como la que reportó Extreme).
  const usos = useMemo(() => {
    const m = {};
    (db.services || []).forEach((s) => {
      const keys = new Set([s.causalAuditada, s.causalExtreme].filter(Boolean).map(normalize));
      keys.forEach((k) => { m[k] = (m[k] || 0) + 1; });
    });
    return m;
  }, [db.services]);

  // Causales que aparecen en los servicios pero no están en el maestro.
  const sinRegistrar = useMemo(() => {
    const enMaestro = new Set(causales.map((c) => normalize(c.name)));
    const found = {};
    (db.services || []).forEach((s) => {
      [s.causalAuditada, s.causalExtreme].filter(Boolean).forEach((c) => {
        const k = normalize(c);
        if (!enMaestro.has(k)) found[k] = cleanCausalName(c);
      });
    });
    return Object.values(found).sort((a, b) => a.localeCompare(b, "es"));
  }, [db.services, causales]);

  const rows = causales
    .filter((c) => (!estado || (estado === "activa" ? c.active : !c.active)) && (!q.trim() || normalize(c.name).includes(normalize(q))))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  // Devuelve un mensaje de error (para mostrarlo en el modal) o null si se guardó.
  const save = (data) => {
    const name = cleanCausalName(data.name);
    if (!name) return "El nombre es obligatorio.";
    if (causales.some((c) => c.id !== data.id && normalize(c.name) === normalize(name))) return "Ya existe una causal con ese nombre.";
    let next;
    if (data.id) {
      const before = causales.find((c) => c.id === data.id);
      if (before.name === name) { setModal(null); return null; }
      // Al renombrar, los servicios ya auditados con el nombre anterior pasan al nuevo.
      // Lo que reportó Extreme (causalExtreme) no se toca: es el dato original del reporte.
      const oldKey = normalize(before.name);
      let afectados = 0;
      const services = (db.services || []).map((s) => {
        if (s.causalAuditada && normalize(s.causalAuditada) === oldKey) { afectados++; return { ...s, causalAuditada: name }; }
        return s;
      });
      next = { ...db, causales: causales.map((c) => c.id === data.id ? { ...c, name } : c), services };
      next = addAudit(next, { userId: session.id, action: "Edición de causal", record: data.id, oldValue: before.name, newValue: `${name}${afectados ? ` (${afectados} servicios auditados actualizados)` : ""}` });
    } else {
      const nc = { id: uid("cau"), name, active: true };
      next = { ...db, causales: [...causales, nc] };
      next = addAudit(next, { userId: session.id, action: "Creación de causal", record: nc.id, oldValue: "-", newValue: name });
    }
    persist(next);
    setModal(null);
    return null;
  };

  const changeActive = (c, active) => {
    let next = { ...db, causales: causales.map((x) => x.id === c.id ? { ...x, active } : x) };
    next = addAudit(next, { userId: session.id, action: active ? "Reactivación de causal" : "Anulación de causal", record: c.id, oldValue: c.name, newValue: active ? "Activa" : "Anulada" });
    persist(next);
    setConfirmAction(null);
  };

  const addQuick = (name) => save({ id: null, name });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={14} style={{ position: "absolute", left: 8, top: 10, color: "var(--text-faint)" }} />
          <input className="amg-input" style={{ paddingLeft: 28 }} placeholder="Buscar causal..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="amg-select" style={{ width: 160 }} value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todas</option><option value="activa">Activas</option><option value="anulada">Anuladas</option>
        </select>
        <button className="amg-btn primary" onClick={() => setModal({})}><Plus size={14} /> Nueva causal</button>
      </div>

      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Causal</th><th>Estado</th><th>Servicios que la usan</th><th></th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={c.active ? undefined : { opacity: 0.6 }}>
                <td>{c.name}</td>
                <td><Badge text={c.active ? "Activa" : "Anulada"} color={c.active ? "green" : "gray"} /></td>
                <td className="amg-mono">{usos[normalize(c.name)] || 0}</td>
                <td style={{ display: "flex", gap: 4 }}>
                  <button className="amg-btn ghost" style={{ padding: 4 }} title="Editar" onClick={() => setModal(c)}><Pencil size={13} /></button>
                  <button className="amg-btn ghost" style={{ padding: 4 }} title={c.active ? "Anular" : "Reactivar"} onClick={() => setConfirmAction({ causal: c, to: !c.active })}>
                    {c.active ? <Ban size={13} color="var(--red)" /> : <RotateCcw size={13} color="var(--green)" />}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>
                {causales.length === 0 ? "No hay causales cargadas. Si ya corriste el SQL de Maestros en Supabase, recarga la página; si no, créalas con \"Nueva causal\"." : "Sin resultados."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>{rows.length} causales. Las causales no se eliminan: al anularlas dejan de ofrecerse al auditar, pero los servicios que ya las usan las conservan.</div>

      {sinRegistrar.length > 0 && (
        <div className="amg-card" style={{ padding: 14, marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Causales en uso que no están en el maestro</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 10 }}>Aparecen en servicios (por ejemplo, las que trae el reporte de Extreme) pero aún no están en esta lista. Agrégalas para poder elegirlas al auditar.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sinRegistrar.map((n) => <button key={n} className="amg-btn" onClick={() => addQuick(n)}><Plus size={12} /> {n}</button>)}
          </div>
        </div>
      )}

      {modal !== null && <CausalModal data={modal} onSave={save} onClose={() => setModal(null)} />}
      {confirmAction && (
        <ConfirmModal title={confirmAction.to ? "Reactivar causal" : "Anular causal"} danger={!confirmAction.to}
          confirmLabel={confirmAction.to ? "Reactivar" : "Anular"}
          message={confirmAction.to
            ? `"${confirmAction.causal.name}" volverá a ofrecerse al auditar servicios.`
            : `"${confirmAction.causal.name}" dejará de ofrecerse al auditar servicios. Los servicios que ya la usan la conservan.`}
          onConfirm={() => changeActive(confirmAction.causal, confirmAction.to)} onClose={() => setConfirmAction(null)} />
      )}
    </div>
  );
}

function CausalModal({ data, onSave, onClose }) {
  const [name, setName] = useState(data.name || "");
  const [error, setError] = useState("");
  const submit = () => { const err = onSave({ id: data.id || null, name }); if (err) setError(err); };
  return (
    <Modal title={data.id ? "Editar causal" : "Nueva causal"} onClose={onClose} width={520}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!name.trim()} onClick={submit}>Guardar</button></>}>
      {error && <div className="amg-alert danger"><AlertTriangle size={14} /> {error}</div>}
      <label className="amg-label">Nombre de la causal</label>
      <input className="amg-input" autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(""); }} onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()} />
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
        Se guarda en mayúsculas, igual que las causales de Extreme.{data.id ? " Si cambias el nombre, los servicios ya auditados con el nombre anterior se actualizan; lo que reportó Extreme no se modifica." : ""}
      </div>
    </Modal>
  );
}

/* ============================================================================
   CARGA (Plantilla de servicios + cruce con Reporte de Extreme)
============================================================================ */

function excelDateToISO(v) {
  if (!v) return "";
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = (parseInt(yr, 10) < 70 ? "20" : "19") + yr;
    return `${yr}-${pad2(parseInt(mo, 10))}-${pad2(parseInt(da, 10))}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return "";
}

function CargaModule({ db, persist, addAudit, session, onGoTech }) {
  const [tab, setTab] = useState("plantilla");
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap" }}>
        <div className={`amg-tab ${tab === "plantilla" ? "active" : ""}`} onClick={() => setTab("plantilla")}>Cargar plantilla</div>
        <div className={`amg-tab ${tab === "extreme" ? "active" : ""}`} onClick={() => setTab("extreme")}>Cargar reporte Extreme</div>
        <div className={`amg-tab ${tab === "auditoria" ? "active" : ""}`} onClick={() => setTab("auditoria")}>Auditoría / Edición</div>
      </div>
      {tab === "plantilla" && <ImportarPlantilla db={db} persist={persist} addAudit={addAudit} session={session} />}
      {tab === "extreme" && <ImportarExtreme db={db} persist={persist} addAudit={addAudit} session={session} />}
      {tab === "auditoria" && <AuditoriaCarga db={db} persist={persist} addAudit={addAudit} session={session} onGoTech={onGoTech} />}
    </div>
  );
}

function buildPlantillaRow(row, idx, db) {
  const servicio = String(row["SERVICIO"] || "").trim();
  const codigo = String(row["CODIGO"] || "").trim();
  const tecnico2Name = String(row["Tecnico2"] || "").trim();
  const tecnico3Name = String(row["Tecnico3"] || "").trim();
  const errors = [];
  if (!servicio) errors.push("Falta el número de Servicio");
  if (!codigo) errors.push("Falta el Código del producto");
  const tech = tecnico2Name ? db.technicians.find((t) => normalize(t.name) === normalize(tecnico2Name)) : null;
  if (!tecnico2Name) errors.push("Falta Tecnico2 (técnico titular)");
  else if (!tech) errors.push(`Técnico2 "${tecnico2Name}" no encontrado en Personal`);

  const existing = db.services.find((s) => s.servicioExterno === servicio && s.productoExternoCodigo === codigo);

  return {
    rowNumber: idx + 2,
    servicio, codigo, tecnico2Name, tecnico3Name, tech,
    fechaProg: excelDateToISO(row["FECHA_PROG"]),
    productoNombre: String(row["NOMBRE PRODUCTO"] || "").trim(),
    cliente: String(row["NOMBRECLIENTE"] || "").trim(),
    direccion: String(row["DIRECCION"] || "").trim(),
    departamento: String(row["NOMBRE DEPARTAMENTO"] || "").trim(),
    ciudad: String(row["Nombre_Ciudad"] || "").trim(),
    tipoServicio: String(row["Tipo de Servicio"] || "").trim(),
    cantidad: parseFloat(row["Cantidad"]) || 1,
    existing, errors,
  };
}

function ImportarPlantilla({ db, persist, addAudit, session }) {
  const [parsedRows, setParsedRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [done, setDone] = useState(null);

  const handleFile = (file) => {
    setFileError(""); setDone(null);
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });
        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
        setParsedRows(json.map((row, idx) => buildPlantillaRow(row, idx, db)));
      } catch (err) {
        setFileError("No se pudo leer el archivo. Verifica que sea la Plantilla de carga (.xlsx).");
      }
    };
    reader.onerror = () => setFileError("No se pudo leer el archivo.");
    reader.readAsArrayBuffer(file);
  };

  const validRows = (parsedRows || []).filter((r) => r.errors.length === 0);
  const errorRows = (parsedRows || []).filter((r) => r.errors.length > 0);
  const newRows = validRows.filter((r) => !r.existing);
  const updateRows = validRows.filter((r) => r.existing);

  const confirmImport = () => {
    let services = [...db.services];
    validRows.forEach((r) => {
      const fields = {
        date: r.fechaProg || todayISO(), technicianId: r.tech?.id || null, quantity: r.cantidad,
        servicioExterno: r.servicio, productoExternoCodigo: r.codigo, productoExternoNombre: r.productoNombre,
        clienteNombre: r.cliente, direccion: r.direccion, departamentoExterno: r.departamento, ciudadExterna: r.ciudad,
        tecnico2Nombre: r.tecnico2Name, tecnico3Nombre: r.tecnico3Name, serviceType: r.tipoServicio || null,
        fechaProg: r.fechaProg || null,
      };
      if (r.existing) {
        services = services.map((s) => s.id === r.existing.id ? { ...s, ...fields } : s);
      } else {
        services = [{
          id: uid("srv"), ...fields, productId: null, observacionTrabajo: null, armado: null, observation: "",
          responsibleUserId: session.id, createdAt: new Date().toISOString(),
        }, ...services];
      }
    });
    let next = { ...db, services };
    next = addAudit(next, { userId: session.id, action: "Importación de plantilla de carga", record: fileName, oldValue: "-", newValue: `${newRows.length} nuevos, ${updateRows.length} actualizados` });
    persist(next);
    setDone({ created: newRows.length, updated: updateRows.length });
    setParsedRows(null);
  };

  return (
    <div>
      {done && (
        <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}>
          <Check size={15} /> Se importaron {done.created} servicios nuevos y se actualizaron {done.updated} existentes.
        </div>
      )}

      {!parsedRows && (
        <div className="amg-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.6 }}>
            Sube el archivo <b>.xlsx</b> de la Plantilla de carga tal como te lo entrega el sistema (con las columnas SERVICIO, CODIGO, Tecnico2, Tecnico3, etc.). El nombre en "Tecnico2" debe coincidir con una persona ya creada en Personal.
            Si un Servicio + Código ya existe (de una carga anterior), se actualiza en vez de duplicarse.
          </div>
          <label className="amg-btn primary" style={{ cursor: "pointer", width: "fit-content" }}>
            <Upload size={14} /> Seleccionar Plantilla de carga (.xlsx)
            <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
          </label>
          {fileError && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {fileError}</div>}
        </div>
      )}

      {parsedRows && (
        <div>
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12.5 }}>
            <span style={{ color: "var(--green)" }}>{newRows.length} nuevos</span>
            <span style={{ color: "var(--blue)" }}>{updateRows.length} actualizarán uno existente</span>
            <span style={{ color: "var(--red)" }}>{errorRows.length} con error</span>
          </div>
          <div className="amg-card" style={{ maxHeight: 420, overflow: "auto" }}>
            <table className="amg-table">
              <thead><tr><th>Fila</th><th>Servicio</th><th>Código</th><th>Producto</th><th>Técnico2</th><th>Técnico3</th><th>Cliente</th><th>Estado</th></tr></thead>
              <tbody>
                {parsedRows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="amg-mono">{r.rowNumber}</td>
                    <td className="amg-mono">{r.servicio}</td>
                    <td className="amg-mono">{r.codigo}</td>
                    <td>{r.productoNombre}</td>
                    <td>{r.tecnico2Name}</td>
                    <td>{r.tecnico3Name}</td>
                    <td>{r.cliente}</td>
                    <td>
                      {r.errors.length > 0 ? <Badge text="Error" color="red" /> : r.existing ? <Badge text="Actualiza" color="blue" /> : <Badge text="Nuevo" color="green" />}
                      {r.errors.length > 0 && <div style={{ fontSize: 10.5, color: "var(--red)", marginTop: 2 }}>{r.errors.join(" · ")}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="amg-btn" onClick={() => { setParsedRows(null); setFileName(""); }}>Elegir otro archivo</button>
            <button className="amg-btn primary" disabled={validRows.length === 0} onClick={confirmImport}>Importar {validRows.length} registro{validRows.length === 1 ? "" : "s"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportarExtreme({ db, persist, addAudit, session }) {
  const [parsedRows, setParsedRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [done, setDone] = useState(null);

  const handleFile = (file) => {
    setFileError(""); setDone(null);
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
        const parsed = rows.slice(4).map((r, idx) => {
          const clave = String(r[1] || "").trim();
          const dash = clave.indexOf("-");
          const servicio = dash > -1 ? clave.slice(0, dash) : clave;
          const codigo = dash > -1 ? clave.slice(dash + 1) : "";
          const match = servicio ? db.services.find((s) => s.servicioExterno === servicio && s.productoExternoCodigo === codigo) : null;
          return {
            rowNumber: idx + 5, clave, servicio, codigo,
            estado: String(r[2] || "").trim(), causal: String(r[16] || "").trim(), diagnostico: String(r[17] || "").trim(),
            match, skip: !clave,
          };
        }).filter((r) => !r.skip);
        setParsedRows(parsed);
      } catch (err) {
        setFileError("No se pudo leer el archivo. Verifica que sea el Reporte detallado de encuestas de Extreme.");
      }
    };
    reader.onerror = () => setFileError("No se pudo leer el archivo.");
    reader.readAsArrayBuffer(file);
  };

  const matched = (parsedRows || []).filter((r) => r.match);
  const unmatched = (parsedRows || []).filter((r) => !r.match);

  const confirmImport = () => {
    let services = [...db.services];
    matched.forEach((r) => {
      services = services.map((s) => s.id === r.match.id
        ? {
            ...s, causalExtreme: r.causal, diagnostico: r.diagnostico, estadoExtreme: r.estado,
            // Servicios que vienen de Asignación: lo que Extreme reporta como realizado se cierra;
            // lo no realizado vuelve a pendientes para la próxima asignación.
            estadoGestion: s.asig ? (r.estado === "Realizado" ? "Realizado" : r.estado === "No realizado" ? "Pendiente" : s.estadoGestion) : s.estadoGestion,
          }
        : s);
    });
    let next = { ...db, services };
    next = addAudit(next, { userId: session.id, action: "Importación de reporte Extreme", record: fileName, oldValue: "-", newValue: `${matched.length} servicios actualizados con causal/diagnóstico, ${unmatched.length} sin coincidencia` });
    persist(next);
    setDone({ matched: matched.length, unmatched: unmatched.length });
    setParsedRows(null);
  };

  return (
    <div>
      {done && (
        <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}>
          <Check size={15} /> Se actualizó causal/diagnóstico en {done.matched} servicios. {done.unmatched} filas del reporte no tenían un servicio+código coincidente en Trabajos realizados (probablemente falta importar esa plantilla).
        </div>
      )}

      {!parsedRows && (
        <div className="amg-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.6 }}>
            Sube el archivo <b>"Reporte detallado de encuestas"</b> tal como lo entrega Extreme (.xls). Se cruza automáticamente por la llave Servicio-Código que trae el reporte, y se rellenan Causal, Diagnóstico y Estado en los servicios que ya existan en Trabajos realizados (importados antes desde la Plantilla). No se toca la "Causal auditada" que hayas corregido manualmente.
          </div>
          <label className="amg-btn primary" style={{ cursor: "pointer", width: "fit-content" }}>
            <Upload size={14} /> Seleccionar Reporte de Extreme (.xls)
            <input type="file" accept=".xls,.xlsx" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
          </label>
          {fileError && <div className="amg-alert danger" style={{ marginTop: 12 }}><AlertTriangle size={14} /> {fileError}</div>}
        </div>
      )}

      {parsedRows && (
        <div>
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12.5 }}>
            <span style={{ color: "var(--green)" }}>{matched.length} con coincidencia</span>
            <span style={{ color: "var(--accent)" }}>{unmatched.length} sin coincidencia</span>
          </div>
          <div className="amg-card" style={{ maxHeight: 420, overflow: "auto" }}>
            <table className="amg-table">
              <thead><tr><th>Fila</th><th>Servicio</th><th>Código</th><th>Estado</th><th>Causal</th><th>Diagnóstico</th><th></th></tr></thead>
              <tbody>
                {parsedRows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="amg-mono">{r.rowNumber}</td>
                    <td className="amg-mono">{r.servicio}</td>
                    <td className="amg-mono">{r.codigo}</td>
                    <td>{r.estado}</td>
                    <td>{r.causal}</td>
                    <td><HoverText text={r.diagnostico} /></td>
                    <td>{r.match ? <Badge text="OK" color="green" /> : <Badge text="Sin coincidencia" color="amber" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
            <button className="amg-btn" onClick={() => { setParsedRows(null); setFileName(""); }}>Elegir otro archivo</button>
            <button className="amg-btn primary" disabled={matched.length === 0} onClick={confirmImport}>Actualizar {matched.length} servicio{matched.length === 1 ? "" : "s"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditoriaCarga({ db, persist, addAudit, session, onGoTech }) {
  const L = useLookups(db);
  const [techId, setTechId] = useState("");
  const [servicioQ, setServicioQ] = useState("");
  const [causalQ, setCausalQ] = useState("");
  const [estadoQ, setEstadoQ] = useState("");
  const [auditadoQ, setAuditadoQ] = useState("");
  const [gestionQ, setGestionQ] = useState("");
  const [regionQ, setRegionQ] = useState("");
  // Por defecto muestra solo los servicios de hoy (la fecha se toma al abrir la pantalla, así cambia cada día).
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [editing, setEditing] = useState(null);
  const [regionInfo, setRegionInfo] = useState({ byDept: {}, nameOf: {} });

  // Región de cada servicio: la guarda Asignación; para los demás se deduce del departamento.
  useEffect(() => {
    let alive = true;
    const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
    maestrosApi.fetchAll("geo_abbreviations", "*", "abbr").then((abbr) => {
      if (!alive) return;
      const byDept = {}, nameOf = {};
      abbr.filter((a) => a.level === "MUNICIPIO").forEach((a) => {
        const key = plain(a.name);
        byDept[key] = a.region_id;
        const bonito = DEPARTAMENTOS_CO.find((d) => plain(d) === key || plain(d).replace(/^LA /, "") === key) || key.charAt(0) + key.slice(1).toLowerCase();
        if (!nameOf[a.region_id]) nameOf[a.region_id] = bonito;
      });
      setRegionInfo({ byDept, nameOf, plain });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const regionOf = (s) => (s.asig && s.asig.region != null ? s.asig.region : (regionInfo.plain ? (regionInfo.byDept[regionInfo.plain(s.departamentoExterno)] ?? null) : null));
  const regionLabel = (r) => (r === null || r === undefined ? "-" : `Región ${r}${regionInfo.nameOf[r] ? ` (${regionInfo.nameOf[r]})` : ""}`);

  const registros = (db.services || []).filter((s) => s.servicioExterno);
  const regionesPresentes = useMemo(() => Array.from(new Set(registros.map(regionOf).filter((r) => r !== null))).sort((a, b) => a - b), [registros, regionInfo]);
  const causalesDistintas = useMemo(() => Array.from(new Set(registros.map((s) => s.causalExtreme).filter(Boolean))).sort(), [registros]);

  const rows = registros.filter((s) =>
    (!techId || s.technicianId === techId) &&
    (!servicioQ.trim() || (s.servicioExterno || "").includes(servicioQ.trim())) &&
    (!causalQ || s.causalExtreme === causalQ) &&
    (!estadoQ || s.estadoExtreme === estadoQ) &&
    (!gestionQ || (s.estadoGestion || "Realizado") === gestionQ) &&
    (!regionQ || String(regionOf(s)) === regionQ) &&
    (!auditadoQ || (auditadoQ === "si" ? !!s.causalAuditada : !s.causalAuditada)) &&
    (!dateFrom || (s.date || "") >= dateFrom) &&
    (!dateTo || (s.date || "") <= dateTo)
  ).sort((a, b) => {
    // Por región, luego por técnico (los sin técnico al final de su región), luego fecha y servicio.
    const ra = regionOf(a), rb = regionOf(b);
    if (ra !== rb) return (ra ?? 999) - (rb ?? 999);
    const ta = L.techById[a.technicianId]?.name || a.tecnico2Nombre || "", tb = L.techById[b.technicianId]?.name || b.tecnico2Nombre || "";
    if (!!ta !== !!tb) return ta ? -1 : 1;
    return ta.localeCompare(tb, "es") || (b.date || "").localeCompare(a.date || "") || String(a.servicioExterno).localeCompare(String(b.servicioExterno)) || 0;
  });

  const saveEdit = (data) => {
    let next;
    if (data.id) {
      const before = registros.find((s) => s.id === data.id);
      next = { ...db, services: db.services.map((s) => s.id === data.id ? { ...s, ...data } : s) };
      if (before && before.causalAuditada !== data.causalAuditada) {
        next = addAudit(next, { userId: session.id, action: "Auditoría de causal", record: data.id, oldValue: before.causalAuditada || "-", newValue: data.causalAuditada || "-" });
      }
      next = addAudit(next, { userId: session.id, action: "Edición de servicio (Carga)", record: data.id, oldValue: "-", newValue: `Técnico ${L.techById[data.technicianId]?.name || "-"} · ${data.productoExternoNombre || "-"}` });
    } else {
      const nt = { id: uid("srv"), ...data, responsibleUserId: session.id, createdAt: new Date().toISOString(), productId: null, observacionTrabajo: null, armado: null, observation: "" };
      next = { ...db, services: [nt, ...db.services] };
      next = addAudit(next, { userId: session.id, action: "Servicio agregado manualmente (Carga)", record: nt.id, oldValue: "-", newValue: `${nt.servicioExterno} · ${nt.productoExternoNombre || "-"}` });
    }
    persist(next);
    setEditing(null);
  };

  const causalEsActiva = (name) => (db.causales || []).some((c) => c.active && normalize(c.name) === normalize(name));

  const useCausalExtreme = (s) => {
    const next0 = { ...db, services: db.services.map((x) => x.id === s.id ? { ...x, causalAuditada: x.causalExtreme } : x) };
    const next = addAudit(next0, { userId: session.id, action: "Auditoría de causal", record: s.id, oldValue: s.causalAuditada || "-", newValue: s.causalExtreme });
    persist(next);
  };

  const exportCSV = () => downloadCSV("auditoria_carga.csv",
    ["Fecha", "Servicio", "Región", "Código", "Producto", "Dirección", "Técnico2", "Técnico3", "Cliente", "Gestión", "Estado Extreme", "Causal Extreme", "Causal auditada", "Diagnóstico"],
    rows.map((s) => [fmtDate(s.date), s.servicioExterno, regionLabel(regionOf(s)), s.productoExternoCodigo, s.productoExternoNombre, s.direccion, s.tecnico2Nombre, s.tecnico3Nombre, s.clienteNombre, s.estadoGestion || "Realizado", s.estadoExtreme, s.causalExtreme, s.causalAuditada, s.diagnostico])
  );

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ minWidth: 200 }}><SearchSelect options={[{ value: "", label: "Todos los técnicos" }, ...db.technicians.map((t) => ({ value: t.id, label: t.name, sublabel: t.code }))]} value={techId} onChange={setTechId} placeholder="Todos los técnicos" /></div>
        <input className="amg-input" style={{ width: 140 }} placeholder="Buscar servicio..." value={servicioQ} onChange={(e) => setServicioQ(e.target.value)} />
        <select className="amg-select" style={{ width: 200 }} value={causalQ} onChange={(e) => setCausalQ(e.target.value)}>
          <option value="">Todas las causales</option>{causalesDistintas.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="amg-select" style={{ width: 150 }} value={estadoQ} onChange={(e) => setEstadoQ(e.target.value)}>
          <option value="">Todos los estados</option><option value="Realizado">Realizado</option><option value="No realizado">No realizado</option>
        </select>
        <select className="amg-select" style={{ width: 160 }} value={gestionQ} onChange={(e) => setGestionQ(e.target.value)}>
          <option value="">Gestión: todas</option><option value="Pendiente">Pendiente</option><option value="En gestión">En gestión</option><option value="Realizado">Realizado</option>
        </select>
        <select className="amg-select" style={{ width: 190 }} value={regionQ} onChange={(e) => setRegionQ(e.target.value)}>
          <option value="">Todas las regiones</option>{regionesPresentes.map((r) => <option key={r} value={String(r)}>{regionLabel(r)}</option>)}
        </select>
        <select className="amg-select" style={{ width: 150 }} value={auditadoQ} onChange={(e) => setAuditadoQ(e.target.value)}>
          <option value="">Auditado: todos</option><option value="si">Ya auditado</option><option value="no">Sin auditar</option>
        </select>
        <input type="date" className="amg-input" style={{ width: 150 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" className="amg-input" style={{ width: 150 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        {(dateFrom || dateTo) && <button className="amg-btn ghost" title="Quita el filtro de fechas para ver todos los registros" onClick={() => { setDateFrom(""); setDateTo(""); }}>Ver todas las fechas</button>}
        {dateFrom !== todayISO() || dateTo !== todayISO() ? <button className="amg-btn ghost" onClick={() => { setDateFrom(todayISO()); setDateTo(todayISO()); }}>Solo hoy</button> : null}
        <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
        <button className="amg-btn primary" style={{ marginLeft: "auto" }} onClick={() => setEditing({})}><Plus size={14} /> Agregar servicio</button>
      </div>

      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Fecha</th><th>Servicio</th><th>Región</th><th>Producto</th><th>Dirección</th><th>Técnico2</th><th>Técnico3</th><th>Gestión</th><th>Estado Extreme</th><th>Causal Extreme</th><th>Diagnóstico Extreme</th><th>Causal auditada</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="amg-mono">{fmtDate(s.date)}</td>
                <td className="amg-mono">{s.servicioExterno}<div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{s.productoExternoCodigo}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>{regionLabel(regionOf(s))}</td>
                <td>{s.productoExternoNombre}</td>
                <td><HoverText text={s.direccion} maxChars={34} /></td>
                <td>{s.technicianId ? <span style={{ cursor: "pointer", color: "var(--accent)" }} onClick={() => onGoTech(s.technicianId)}>{L.techById[s.technicianId]?.name}</span> : (s.tecnico2Nombre || "-")}</td>
                <td>{s.tecnico3Nombre || "-"}</td>
                <td><Badge text={s.estadoGestion || "Realizado"} color={s.estadoGestion === "Pendiente" ? "amber" : s.estadoGestion === "En gestión" ? "blue" : "green"} /></td>
                <td>{s.estadoExtreme || "-"}</td>
                <td>{s.causalExtreme || "-"}</td>
                <td><HoverText text={s.diagnostico} /></td>
                <td>
                  {s.causalAuditada
                    ? <Badge text={s.causalAuditada} color="green" />
                    : (s.causalExtreme
                      ? <button className="amg-btn ghost" style={{ padding: "2px 6px", fontSize: 11 }} disabled={!causalEsActiva(s.causalExtreme)}
                          title={causalEsActiva(s.causalExtreme) ? "Aceptar la causal que reportó Extreme" : "Esta causal no está activa en Maestros → Causales; agrégala o elige otra con el lápiz"}
                          onClick={() => useCausalExtreme(s)}>Usar Extreme</button>
                      : <Badge text="Sin auditar" color="gray" />)}
                </td>
                <td><button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setEditing(s)}><Pencil size={13} /></button></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={13} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin registros para estos filtros. {dateFrom || dateTo ? "Por defecto se muestran solo los de hoy: usa \"Ver todas las fechas\" para ver el resto." : ""}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>{rows.length} registros</div>

      {editing !== null && <EditarServicioCargaModal db={db} data={editing} onSave={saveEdit} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditarServicioCargaModal({ db, data, onSave, onClose }) {
  const causalesActivas = useMemo(() => (db.causales || []).filter((c) => c.active).map((c) => c.name).sort((a, b) => a.localeCompare(b, "es")), [db.causales]);
  const techOptions = db.technicians.map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));
  const tecnico3Match = data.tecnico3Nombre ? db.technicians.find((t) => normalize(t.name) === normalize(data.tecnico3Nombre)) : null;
  const [f, setF] = useState({
    id: data.id || null, date: data.date || todayISO(), technicianId: data.technicianId || "",
    servicioExterno: data.servicioExterno || "", productoExternoCodigo: data.productoExternoCodigo || "",
    productoExternoNombre: data.productoExternoNombre || "", tecnico2Nombre: data.tecnico2Nombre || "",
    tecnico3Id: tecnico3Match?.id || "", tecnico3Nombre: data.tecnico3Nombre || "",
    clienteNombre: data.clienteNombre || "", quantity: data.quantity || 1,
    causalAuditada: data.causalAuditada || "", diagnostico: data.diagnostico || "", causalExtreme: data.causalExtreme || "",
    estadoExtreme: data.estadoExtreme || "",
  });
  const canSave = f.servicioExterno.trim() && f.technicianId;
  // Si el servicio ya trae una causal que no es una de las activas del maestro
  // (anulada o que nunca se registró), se conserva como opción para no perderla.
  const causalActualFuera = f.causalAuditada && !causalesActivas.some((n) => normalize(n) === normalize(f.causalAuditada))
    ? ((db.causales || []).some((c) => normalize(c.name) === normalize(f.causalAuditada)) ? "anulada" : "fuera del maestro")
    : "";

  const submit = () => {
    const tech = db.technicians.find((t) => t.id === f.technicianId);
    const tech3 = db.technicians.find((t) => t.id === f.tecnico3Id);
    const { tecnico3Id, ...rest } = f;
    onSave({
      ...rest, technicianId: f.technicianId,
      tecnico2Nombre: tech?.name || f.tecnico2Nombre,
      tecnico3Nombre: tech3?.name || f.tecnico3Nombre,
      quantity: parseFloat(f.quantity) || 1,
    });
  };

  return (
    <Modal title={f.id ? "Editar servicio" : "Agregar servicio"} onClose={onClose} width={680}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!canSave} onClick={submit}>Guardar</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><label className="amg-label">Servicio</label><input className="amg-input amg-mono" value={f.servicioExterno} onChange={(e) => setF({ ...f, servicioExterno: e.target.value })} /></div>
        <div><label className="amg-label">Código de producto</label><input className="amg-input amg-mono" value={f.productoExternoCodigo} onChange={(e) => setF({ ...f, productoExternoCodigo: e.target.value })} /></div>
        <div><label className="amg-label">Producto</label><input className="amg-input" value={f.productoExternoNombre} onChange={(e) => setF({ ...f, productoExternoNombre: e.target.value })} /></div>
        <div><label className="amg-label">Técnico2 (titular)</label><SearchSelect options={techOptions} value={f.technicianId} onChange={(v) => setF({ ...f, technicianId: v })} placeholder="Buscar técnico..." /></div>
        <div><label className="amg-label">Técnico3 (apoyo/auxiliar, opcional)</label><SearchSelect options={techOptions} value={f.tecnico3Id} onChange={(v) => setF({ ...f, tecnico3Id: v })} placeholder="Buscar técnico..." /></div>
        <div><label className="amg-label">Cliente</label><input className="amg-input" value={f.clienteNombre} onChange={(e) => setF({ ...f, clienteNombre: e.target.value })} /></div>
        <div><label className="amg-label">Cantidad</label><input type="number" min="1" className="amg-input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
      </div>
      {(f.causalExtreme || f.estadoExtreme) && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-faint)" }}>Extreme reportó: <b>{f.estadoExtreme}</b> · causal <b>{f.causalExtreme || "-"}</b></div>
      )}
      <div style={{ marginTop: 12 }}>
        <label className="amg-label">Causal auditada (corregida)</label>
        <select className="amg-select" value={f.causalAuditada} onChange={(e) => setF({ ...f, causalAuditada: e.target.value })}>
          <option value="">Sin auditar</option>
          {causalActualFuera && <option value={f.causalAuditada}>{f.causalAuditada} ({causalActualFuera})</option>}
          {causalesActivas.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>La lista se administra en Maestros → Causales.</div>
      </div>
      <div style={{ marginTop: 12 }}><label className="amg-label">Diagnóstico</label><textarea className="amg-textarea" rows={2} value={f.diagnostico} onChange={(e) => setF({ ...f, diagnostico: e.target.value })} /></div>
    </Modal>
  );
}

/* ============================================================================
   INVENTARIO (compras vs. entregas de insumos controlados, p. ej. Vinipel)
============================================================================ */

function Inventario({ db, persist, addAudit, session }) {
  const [scope, setScope] = useState("insumos");
  const [tab, setTab] = useState("stock");
  const canWrite = session.role === "admin" || session.role === "operador";
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button className={`amg-btn ${scope === "insumos" ? "primary" : ""}`} onClick={() => setScope("insumos")}>Insumos</button>
        <button className={`amg-btn ${scope === "activos" ? "primary" : ""}`} onClick={() => setScope("activos")}>Activos y herramientas</button>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap" }}>
        <div className={`amg-tab ${tab === "stock" ? "active" : ""}`} onClick={() => setTab("stock")}>Stock actual</div>
        <div className={`amg-tab ${tab === "compras" ? "active" : ""}`} onClick={() => setTab("compras")}>Compras (entradas)</div>
        <div className={`amg-tab ${tab === "entregas" ? "active" : ""}`} onClick={() => setTab("entregas")}>Entregas a técnicos (salidas)</div>
      </div>
      {scope === "insumos" && tab === "stock" && <StockActual db={db} />}
      {scope === "insumos" && tab === "compras" && <MovimientosCompras db={db} persist={persist} addAudit={addAudit} session={session} canWrite={canWrite} />}
      {scope === "insumos" && tab === "entregas" && <MovimientosEntregas db={db} persist={persist} addAudit={addAudit} session={session} canWrite={canWrite} />}
      {scope === "activos" && tab === "stock" && <InventarioActivos db={db} />}
      {scope === "activos" && tab === "compras" && <ComprasActivos db={db} persist={persist} addAudit={addAudit} session={session} canWrite={canWrite} />}
      {scope === "activos" && tab === "entregas" && <EntregasActivos db={db} persist={persist} addAudit={addAudit} session={session} canWrite={canWrite} />}
    </div>
  );
}

function departamentosConTecnicos(db) {
  return Array.from(new Set(db.technicians.map((t) => t.department).filter(Boolean))).sort();
}

function DepartamentoMatrix({ title, columns, rows, totalLabel = "Total" }) {
  if (rows.length === 0) return null;
  return (
    <div className="amg-card" style={{ padding: 14, marginTop: 16, overflowX: "auto" }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{title}</div>
      <table className="amg-table">
        <thead><tr><th>Departamento</th>{columns.map((c) => <th key={c}>{c}</th>)}<th>{totalLabel}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.depto}>
              <td>{r.depto}</td>
              {columns.map((c) => <td key={c} className="amg-mono">{r.valores[c] || 0}</td>)}
              <td className="amg-mono" style={{ fontWeight: 700 }}>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockActual({ db }) {
  const L = useLookups(db);
  const items = useMemo(() => inventoryItems(db, true), [db]);
  // Si dos insumos con inventario se llaman igual, se distingue con su subcategoría.
  const labelOf = useMemo(() => {
    const count = {};
    items.forEach((i) => { count[i.label] = (count[i.label] || 0) + 1; });
    return (i) => (count[i.label] > 1 ? `${i.label} (${i.sublabel})` : i.label);
  }, [items]);
  const subById = Object.fromEntries(db.subcategories.map((s) => [s.id, s]));

  const rows = useMemo(() => {
    const keyOf = movementItemKeyFn(db);
    const acc = {};
    items.forEach((i) => { acc[i.key] = { comprado: 0, entregado: 0 }; });
    (db.stockMovements || []).forEach((m) => {
      if (m.status === "Anulado") return;
      const a = acc[keyOf(m)];
      if (!a) return;
      if (m.type === "Compra") a.comprado += m.quantity;
      else if (m.type === "Entrega") a.entregado += m.quantity;
    });
    return items.map((i) => ({ item: i, label: labelOf(i), ...acc[i.key], disponible: acc[i.key].comprado - acc[i.key].entregado }));
  }, [db, items, labelOf]);

  const techDeptoById = Object.fromEntries(db.technicians.map((t) => [t.id, t.department]));
  const deptoRows = useMemo(() => {
    const keyOf = movementItemKeyFn(db);
    const labelByKey = Object.fromEntries(items.map((i) => [i.key, labelOf(i)]));
    const deptos = departamentosConTecnicos(db);
    return deptos.map((depto) => {
      const valores = {};
      items.forEach((i) => { valores[labelOf(i)] = 0; });
      (db.stockMovements || []).filter((m) => m.type === "Entrega" && m.status !== "Anulado" && techDeptoById[m.technicianId] === depto).forEach((m) => {
        const label = labelByKey[keyOf(m)];
        if (label) valores[label] = (valores[label] || 0) + m.quantity;
      });
      const total = Object.values(valores).reduce((a, b) => a + b, 0);
      return { depto, valores, total };
    }).filter((r) => r.total > 0);
  }, [db, items, labelOf]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
        {rows.map((r) => (
          <StatCard key={r.item.key} label={r.label} value={r.disponible} sub={`${r.comprado} comprados · ${r.entregado} entregados`} accent={r.disponible <= 5} />
        ))}
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Insumo</th><th>Categoría</th><th>Comprado (total)</th><th>Entregado (total)</th><th>Stock disponible</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item.key}>
                <td>{r.label}</td>
                <td>{L.catById[subById[r.item.subcategoryId]?.categoryId]?.name}</td>
                <td className="amg-mono">{r.comprado}</td>
                <td className="amg-mono">{r.entregado}</td>
                <td className="amg-mono" style={{ fontWeight: 700, color: r.disponible <= 5 ? "var(--red)" : "var(--text)" }}>{r.disponible}</td>
                <td>{r.disponible <= 5 && <Badge text="Stock bajo" color="red" />}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>
                Ningún insumo lleva inventario todavía. Márcalo con "Controla inventario" en Insumos / elementos → Catálogo de insumos (o en una subcategoría, desde Categorías y subcategorías).
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <DepartamentoMatrix title="Entregas por departamento" columns={items.map(labelOf)} rows={deptoRows} totalLabel="Total entregado" />
    </div>
  );
}

const SIN_DEPARTAMENTO = "Sin departamento";

function InventarioActivos({ db }) {
  const tipos = useMemo(() => Array.from(new Set(db.assets.map((a) => a.type))).sort(), [db.assets]);

  const porTipo = useMemo(() => tipos.map((tipo) => {
    const items = db.assets.filter((a) => a.type === tipo);
    const disponibles = items.filter((a) => a.status === "Disponible").length;
    const asignados = items.filter((a) => a.status === "Asignado").length;
    const otros = items.length - disponibles - asignados;
    return { tipo, total: items.length, disponibles, asignados, otros };
  }), [tipos, db.assets]);

  const techDeptoById = Object.fromEntries(db.technicians.map((t) => [t.id, t.department]));
  const deptoRows = useMemo(() => {
    const deptos = departamentosConTecnicos(db);
    return deptos.map((depto) => {
      const valores = {};
      tipos.forEach((t) => { valores[t] = 0; });
      db.assets.filter((a) => a.status === "Asignado" && a.technicianId && techDeptoById[a.technicianId] === depto).forEach((a) => {
        valores[a.type] = (valores[a.type] || 0) + 1;
      });
      const total = Object.values(valores).reduce((s, n) => s + n, 0);
      return { depto, valores, total };
    }).filter((r) => r.total > 0);
  }, [db, tipos]);

  // Las disponibles no tienen técnico, así que se ubican por el departamento
  // registrado en la propia herramienta ("Sin departamento" si aún no tiene).
  const disponiblesRows = useMemo(() => {
    const grupos = {};
    db.assets.filter((a) => a.status === "Disponible").forEach((a) => {
      const depto = a.department || SIN_DEPARTAMENTO;
      if (!grupos[depto]) { grupos[depto] = {}; tipos.forEach((t) => { grupos[depto][t] = 0; }); }
      grupos[depto][a.type] = (grupos[depto][a.type] || 0) + 1;
    });
    return Object.keys(grupos)
      .sort((a, b) => (a === SIN_DEPARTAMENTO) - (b === SIN_DEPARTAMENTO) || a.localeCompare(b, "es"))
      .map((depto) => ({ depto, valores: grupos[depto], total: Object.values(grupos[depto]).reduce((s, n) => s + n, 0) }));
  }, [db.assets, tipos]);

  const totalGeneral = db.assets.length;
  const totalDisponibles = db.assets.filter((a) => a.status === "Disponible").length;
  const totalAsignados = db.assets.filter((a) => a.status === "Asignado").length;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
        <StatCard label="Total de herramientas" value={totalGeneral} />
        <StatCard label="Disponibles" value={totalDisponibles} />
        <StatCard label="Asignadas" value={totalAsignados} />
      </div>

      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Tipo de herramienta</th><th>Total</th><th>Disponibles</th><th>Asignadas</th><th>Otros estados</th></tr></thead>
          <tbody>
            {porTipo.map((r) => (
              <tr key={r.tipo}>
                <td>{r.tipo}</td>
                <td className="amg-mono">{r.total}</td>
                <td className="amg-mono">{r.disponibles}</td>
                <td className="amg-mono">{r.asignados}</td>
                <td className="amg-mono">{r.otros}</td>
              </tr>
            ))}
            {porTipo.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin activos registrados. Regístralos desde Insumos / elementos → Activos y herramientas.</td></tr>}
          </tbody>
        </table>
      </div>

      <DepartamentoMatrix title="Herramientas asignadas por departamento" columns={tipos} rows={deptoRows} totalLabel="Total asignadas" />
      <DepartamentoMatrix title="Herramientas disponibles por departamento" columns={tipos} rows={disponiblesRows} totalLabel="Total disponibles" />

      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>
        Las asignadas se ubican por el departamento del técnico que las tiene; las disponibles, por el departamento registrado en cada herramienta (al asignarla pasa a ser el del técnico, y al liberarla se queda ahí). Las que dicen "Sin departamento" aún no tienen uno: asígnaselo con el lápiz en Insumos / elementos → Activos y herramientas. Registra compras y entregas de herramientas en las pestañas "Compras" y "Entregas" de arriba. Para editar una herramienta, cambiar su estado (dañada, perdida, etc.) o ver su historial detallado, ve a Insumos / elementos → Activos y herramientas.
      </div>
    </div>
  );
}

function ComprasActivos({ db, persist, addAudit, session, canWrite }) {
  const [modal, setModal] = useState(null);
  const [typesModal, setTypesModal] = useState(false);

  const save = (data) => {
    persist(createAssetFromForm(db, data, session, addAudit));
    setModal(null);
  };

  const historial = [...db.assets].sort((a, b) => (b.purchaseDate || "").localeCompare(a.purchaseDate || ""));
  const exportCSV = () => downloadCSV("compras_activos.csv",
    ["Código", "Tipo", "Marca", "Modelo", "Serial", "Valor", "Fecha de compra", "Departamento", "Estado"],
    historial.map((a) => [a.code, a.type, a.brand, a.model, a.serial, a.value, fmtDate(a.purchaseDate), a.department, a.status])
  );

  return (
    <div>
      {canWrite && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button className="amg-btn primary" onClick={() => setModal({})}><PackagePlus size={14} /> Registrar compra de herramienta</button>
          <button className="amg-btn" onClick={() => setTypesModal(true)}><ListChecks size={14} /> Tipos de herramienta</button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Historial de compras de herramientas</div>
        <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Código</th><th>Tipo</th><th>Marca/Modelo</th><th>Valor</th><th>Fecha de compra</th><th>Departamento</th><th>Estado</th></tr></thead>
          <tbody>
            {historial.map((a) => (
              <tr key={a.id}>
                <td className="amg-mono">{a.code}</td><td>{a.type}</td><td>{a.brand} {a.model}</td>
                <td className="amg-mono">{fmtCOP(a.value)}</td><td className="amg-mono">{fmtDate(a.purchaseDate)}</td>
                <td>{a.department || "-"}</td>
                <td><Badge text={a.status} color={statusColor(a.status)} /></td>
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin herramientas registradas.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal !== null && <AssetModal data={modal} assetTypes={db.assetTypes || []} technicians={db.technicians} onSave={save} onManageTypes={() => setTypesModal(true)} onClose={() => setModal(null)} />}
      {typesModal && <AssetTypesModal db={db} persist={persist} onClose={() => setTypesModal(false)} />}
    </div>
  );
}

function EntregasActivos({ db, persist, addAudit, session, canWrite }) {
  const L = useLookups(db);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState("");

  const disponibles = db.assets.filter((a) => a.status === "Disponible");
  const assetOptions = disponibles.map((a) => ({ value: a.id, label: `${a.code} · ${a.type}`, sublabel: `${a.brand || ""} ${a.model || ""}`.trim() }));
  const techOptions = db.technicians.filter((t) => t.status === "Activo").map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));

  const assign = (techId) => {
    const asset = db.assets.find((a) => a.id === selectedAssetId);
    if (!asset) return;
    const next0 = {
      ...db,
      assets: db.assets.map((a) => a.id === asset.id ? {
        ...a, technicianId: techId, deliveryDate: todayISO(), status: "Asignado",
        department: L.techById[techId]?.department || a.department || null,
        history: [...closeOpenHistoryEntry(a.history), { technicianId: techId, from: todayISO(), to: "", userId: session.id }],
      } : a),
    };
    const next = addAudit(next0, { userId: session.id, action: "Entrega de herramienta a técnico", record: asset.id, oldValue: "Disponible", newValue: L.techById[techId]?.name });
    persist(next);
    setAssignOpen(false);
    setSelectedAssetId("");
  };

  // El estado que se muestra por fila es el de la herramienta en ese momento:
  // para la entrada más reciente de cada herramienta (si sigue abierta) se
  // muestra su estado actual real (Asignado, En reparación, Dañado...);
  // las entradas anteriores, ya cerradas, muestran cuándo se devolvieron.
  const historial = useMemo(() => {
    const rows = [];
    db.assets.forEach((a) => {
      const hist = a.history || [];
      hist.forEach((h, i) => rows.push({ asset: a, isCurrent: i === hist.length - 1 && !h.to, ...h }));
    });
    return rows.sort((x, y) => {
      const kx = x.createdAt || `${x.from}T00:00`;
      const ky = y.createdAt || `${y.from}T00:00`;
      return ky.localeCompare(kx);
    });
  }, [db.assets]);

  const exportCSV = () => downloadCSV("entregas_activos.csv",
    ["Fecha", "Herramienta", "Código", "Técnico", "Estado"],
    historial.map((h) => [fmtDate(h.from), h.asset.type, h.asset.code, L.techById[h.technicianId]?.name, h.isCurrent ? h.asset.status : `Devuelta ${fmtDate(h.to)}`])
  );

  return (
    <div>
      {canWrite && (
        <div style={{ marginBottom: 16 }}>
          <button className="amg-btn primary" disabled={disponibles.length === 0} onClick={() => setAssignOpen(true)}><PackageMinus size={14} /> Entregar herramienta a técnico</button>
          {disponibles.length === 0 && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>No hay herramientas disponibles para entregar. Regístralas primero en "Compras".</div>}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Historial de entregas de herramientas</div>
        <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Fecha</th><th>Herramienta</th><th>Código</th><th>Técnico</th><th>Estado</th></tr></thead>
          <tbody>
            {historial.map((h, i) => (
              <tr key={i}>
                <td className="amg-mono">{fmtDate(h.from)}</td><td>{h.asset.type}</td><td className="amg-mono">{h.asset.code}</td>
                <td>{L.techById[h.technicianId]?.name}</td>
                <td>{h.isCurrent
                  ? <Badge text={h.asset.status} color={statusColor(h.asset.status)} />
                  : <Badge text={`Devuelta ${fmtDate(h.to)}`} color="gray" />}</td>
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin entregas registradas.</td></tr>}
          </tbody>
        </table>
      </div>

      {assignOpen && (
        <Modal title="Entregar herramienta a técnico" onClose={() => { setAssignOpen(false); setSelectedAssetId(""); }} width={640}>
          <div style={{ minHeight: 380, display: "flex", flexDirection: "column", gap: 14 }}>
            <div><label className="amg-label">Herramienta disponible</label><SearchSelect options={assetOptions} value={selectedAssetId} onChange={setSelectedAssetId} placeholder="Buscar herramienta..." /></div>
            <div><label className="amg-label">Técnico</label><SearchSelect options={techOptions} value="" onChange={assign} placeholder="Buscar técnico activo..." disabled={!selectedAssetId} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MovimientosCompras({ db, persist, addAudit, session, canWrite }) {
  const L = useLookups(db);
  const isAdmin = session.role === "admin";
  const items = inventoryItems(db);
  const itemOptions = items.map((i) => ({ value: i.key, label: i.label, sublabel: i.sublabel }));
  const blank = { date: todayISO(), itemKey: items[0]?.key || "", supplier: "", quantity: 1, unitCost: "", observation: "" };
  const [form, setForm] = useState(blank);
  const [saved, setSaved] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [annulTarget, setAnnulTarget] = useState(null);
  const [annulReason, setAnnulReason] = useState("");
  const item = items.find((i) => i.key === form.itemKey);
  const canSave = item && parseFloat(form.quantity) > 0 && form.unitCost !== "" && parseFloat(form.unitCost) >= 0;
  const totalCosto = (parseFloat(form.quantity) || 0) * (parseFloat(form.unitCost) || 0);

  const save = () => {
    const sub = db.subcategories.find((s) => s.id === item.subcategoryId);
    const expId = uid("e");
    const mov = {
      id: uid("stk"), type: "Compra", date: form.date, subcategoryId: item.subcategoryId, productId: item.productId,
      quantity: parseFloat(form.quantity), technicianId: null, unitCost: parseFloat(form.unitCost), supplier: form.supplier,
      observation: form.observation, responsibleUserId: session.id, createdAt: new Date().toISOString(),
      status: "Activo", annulReason: "", annulUserId: "", annulDate: "", relatedExpenseId: expId,
      consecutive: nextMovementConsecutive(db.stockMovements, "Compra"),
    };
    // La compra sí es dinero real de la compañía: también queda como gasto general (sin técnico).
    const exp = {
      id: expId, date: form.date, technicianId: null, categoryId: sub.categoryId, subcategoryId: item.subcategoryId,
      productId: item.productId, conceptManual: `Compra de stock ${mov.consecutive}${form.supplier ? " — " + form.supplier : ""}`,
      quantity: mov.quantity, unitValue: mov.unitCost, totalValue: mov.quantity * mov.unitCost, observation: form.observation,
      responsibleUserId: session.id, status: "Activo", annulReason: "", annulUserId: "", annulDate: "", createdAt: new Date().toISOString(),
    };
    let next = { ...db, stockMovements: [mov, ...(db.stockMovements || [])], expenses: [exp, ...db.expenses] };
    next = addAudit(next, { userId: session.id, action: "Compra de stock", record: mov.id, oldValue: "-", newValue: `${mov.consecutive}: ${mov.quantity} × ${item.label} — ${fmtCOP(exp.totalValue)}` });
    persist(next);
    setSaved(true);
    setForm({ ...blank, itemKey: form.itemKey });
  };

  const confirmAnnul = () => {
    if (!annulReason.trim()) return;
    const sub = db.subcategories.find((s) => s.id === annulTarget.subcategoryId);
    let next = {
      ...db,
      stockMovements: db.stockMovements.map((m) => m.id === annulTarget.id
        ? { ...m, status: "Anulado", annulReason, annulUserId: session.id, annulDate: todayISO() } : m),
    };
    next = addAudit(next, { userId: session.id, action: "Anulación de compra de stock", record: annulTarget.id, oldValue: "Activo", newValue: `Anulado: ${annulReason}` });
    const linkedExp = annulTarget.relatedExpenseId ? db.expenses.find((e) => e.id === annulTarget.relatedExpenseId && e.status === "Activo") : null;
    if (linkedExp) {
      next = { ...next, expenses: next.expenses.map((e) => e.id === linkedExp.id
        ? { ...e, status: "Anulado", annulReason: `Anulado automáticamente: compra de inventario anulada (${annulReason})`, annulUserId: session.id, annulDate: todayISO() } : e) };
      next = addAudit(next, { userId: session.id, action: "Anulación automática de gasto vinculado", record: linkedExp.id, oldValue: "Activo", newValue: `Anulado por anulación de compra ${annulTarget.id}` });
    }
    persist(next);
    setAnnulTarget(null); setAnnulReason("");
  };

  const confirmEdit = (data) => {
    const sub = db.subcategories.find((s) => s.id === data.subcategoryId);
    const oldLabel = movementItemLabel(db, editTarget);
    const newLabel = movementItemLabel(db, { ...editTarget, subcategoryId: data.subcategoryId, productId: data.productId });
    const oldTotal = editTarget.quantity * editTarget.unitCost;
    const newTotal = data.quantity * data.unitCost;
    let next = {
      ...db,
      stockMovements: db.stockMovements.map((m) => m.id === editTarget.id ? {
        ...m, date: data.date, subcategoryId: data.subcategoryId, productId: data.productId || null,
        supplier: data.supplier, quantity: data.quantity, unitCost: data.unitCost, observation: data.observation,
      } : m),
    };
    const linkedExp = editTarget.relatedExpenseId ? db.expenses.find((e) => e.id === editTarget.relatedExpenseId) : null;
    if (linkedExp) {
      next = {
        ...next,
        expenses: next.expenses.map((e) => e.id === linkedExp.id ? {
          ...e, date: data.date, categoryId: sub.categoryId, subcategoryId: data.subcategoryId, productId: data.productId || null,
          conceptManual: `Compra de stock${editTarget.consecutive ? " " + editTarget.consecutive : ""}${data.supplier ? " — " + data.supplier : ""}`,
          quantity: data.quantity, unitValue: data.unitCost, totalValue: newTotal, observation: data.observation,
        } : e),
      };
    }
    next = addAudit(next, {
      userId: session.id, action: "Edición de compra de stock", record: editTarget.id,
      oldValue: `${editTarget.consecutive || ""} ${editTarget.quantity} × ${oldLabel} — ${fmtCOP(oldTotal)}`.trim(),
      newValue: `${editTarget.consecutive || ""} ${data.quantity} × ${newLabel} — ${fmtCOP(newTotal)}`.trim(),
    });
    persist(next);
    setEditTarget(null);
  };

  const historial = (db.stockMovements || []).filter((m) => m.type === "Compra").sort((a, b) => b.date.localeCompare(a.date) || (b.consecutive || "").localeCompare(a.consecutive || ""));
  const exportCSV = () => downloadCSV("compras_stock.csv",
    ["Consecutivo", "Fecha", "Insumo", "Proveedor", "Cantidad", "Costo unitario", "Total", "Responsable", "Estado"],
    historial.map((m) => [m.consecutive, fmtDate(m.date), movementItemLabel(db, m), m.supplier, m.quantity, m.unitCost, m.quantity * m.unitCost, L.userById[m.responsibleUserId]?.name, m.status])
  );

  if (items.length === 0) {
    return <div className="amg-card" style={{ padding: 16, color: "var(--text-faint)", fontSize: 13 }}>Ningún insumo lleva inventario todavía. Márcalo con "Controla inventario" en Insumos / elementos → Catálogo de insumos (o en una subcategoría, desde Categorías y subcategorías).</div>;
  }

  return (
    <div>
      {canWrite && (
        <div className="amg-card" style={{ padding: 20, marginBottom: 16, maxWidth: 620 }}>
          {saved && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)", marginBottom: 12 }}><Check size={15} /> Compra registrada. El stock disponible ya se actualizó.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><label className="amg-label">Insumo</label><SearchSelect options={itemOptions} value={form.itemKey} onChange={(v) => setForm({ ...form, itemKey: v })} placeholder="Buscar insumo..." /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div><label className="amg-label">Proveedor (opcional)</label><input className="amg-input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
            <div><label className="amg-label">Stock actual</label><div className="amg-input amg-mono" style={{ background: "var(--panel)", fontWeight: 600 }}>{item ? stockOfItem(db, item.key) : "-"}</div></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div><label className="amg-label">Cantidad</label><input type="number" min="1" className="amg-input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
            <div><label className="amg-label">Costo unitario (COP)</label><input type="number" min="0" className="amg-input" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} /></div>
            <div><label className="amg-label">Total</label><div className="amg-input amg-mono" style={{ background: "var(--panel)", color: "var(--accent)", fontWeight: 600 }}>{fmtCOP(totalCosto)}</div></div>
          </div>
          <div style={{ marginBottom: 14 }}><label className="amg-label">Observación</label><textarea className="amg-textarea" rows={2} value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></div>
          <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <button className="amg-btn primary" disabled={!canSave} onClick={save}><PackagePlus size={14} /> Registrar compra</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Historial de compras</div>
        <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Consecutivo</th><th>Fecha</th><th>Insumo</th><th>Proveedor</th><th>Cantidad</th><th>Costo unitario</th><th>Total</th><th>Responsable</th><th>Estado</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {historial.map((m) => (
              <tr key={m.id} style={m.status === "Anulado" ? { opacity: 0.6 } : undefined}>
                <td className="amg-mono">{m.consecutive || "-"}</td><td className="amg-mono">{fmtDate(m.date)}</td><td>{movementItemLabel(db, m)}</td><td>{m.supplier || "-"}</td>
                <td className="amg-mono">{m.quantity}</td><td className="amg-mono">{fmtCOP(m.unitCost)}</td>
                <td className="amg-mono" style={{ fontWeight: 600 }}>{fmtCOP(m.quantity * m.unitCost)}</td><td>{L.userById[m.responsibleUserId]?.name}</td>
                <td><Badge text={m.status} color={statusColor(m.status)} />{m.status === "Anulado" && <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{m.annulReason}</div>}</td>
                {isAdmin && (
                  <td style={{ display: "flex", gap: 4 }}>
                    {m.status === "Activo" && <>
                      <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setEditTarget(m)}><Pencil size={13} /></button>
                      <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setAnnulTarget(m)}><Ban size={13} color="var(--red)" /></button>
                    </>}
                  </td>
                )}
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin compras registradas.</td></tr>}
          </tbody>
        </table>
      </div>

      {annulTarget && (
        <ConfirmModal title="Anular compra" confirmLabel="Anular" danger onConfirm={confirmAnnul} onClose={() => { setAnnulTarget(null); setAnnulReason(""); }}
          message={annulTarget.relatedExpenseId ? "El movimiento se conserva pero deja de contar en el stock disponible. El gasto vinculado a esta compra también se anulará automáticamente. Esta acción queda registrada en auditoría." : "El movimiento se conserva pero deja de contar en el stock disponible. Esta acción queda registrada en auditoría."}>
          <label className="amg-label">Motivo de anulación (obligatorio)</label>
          <textarea className="amg-textarea" rows={2} value={annulReason} onChange={(e) => setAnnulReason(e.target.value)} autoFocus />
        </ConfirmModal>
      )}

      {editTarget && (
        <EditarCompraModal db={db} target={editTarget} onSave={confirmEdit} onClose={() => setEditTarget(null)} />
      )}
    </div>
  );
}

function EditarCompraModal({ db, target, onSave, onClose }) {
  // Se incluyen también los insumos inactivos para que la compra original siempre aparezca en la lista.
  const items = inventoryItems(db, true);
  const itemOptions = items.map((i) => ({ value: i.key, label: i.label, sublabel: i.sublabel }));
  const [form, setForm] = useState({
    date: target.date, itemKey: movementItemKeyFn(db)(target),
    supplier: target.supplier || "", quantity: target.quantity, unitCost: target.unitCost, observation: target.observation || "",
  });
  const item = items.find((i) => i.key === form.itemKey);
  const canSave = item && parseFloat(form.quantity) > 0 && form.unitCost !== "" && parseFloat(form.unitCost) >= 0;
  const totalCosto = (parseFloat(form.quantity) || 0) * (parseFloat(form.unitCost) || 0);

  const submit = () => onSave({
    date: form.date, subcategoryId: item.subcategoryId, productId: item.productId,
    supplier: form.supplier, quantity: parseFloat(form.quantity), unitCost: parseFloat(form.unitCost), observation: form.observation,
  });

  return (
    <Modal title={`Editar compra${target.consecutive ? " " + target.consecutive : ""}`} onClose={onClose} width={620}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!canSave} onClick={submit}>Guardar cambios</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        <div><label className="amg-label">Insumo</label><SearchSelect options={itemOptions} value={form.itemKey} onChange={(v) => setForm({ ...form, itemKey: v })} placeholder="Buscar insumo..." /></div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="amg-label">Proveedor (opcional)</label><input className="amg-input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div><label className="amg-label">Cantidad</label><input type="number" min="1" className="amg-input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
        <div><label className="amg-label">Costo unitario (COP)</label><input type="number" min="0" className="amg-input" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} /></div>
        <div><label className="amg-label">Total</label><div className="amg-input amg-mono" style={{ background: "var(--panel)", color: "var(--accent)", fontWeight: 600 }}>{fmtCOP(totalCosto)}</div></div>
      </div>
      <div><label className="amg-label">Observación</label><textarea className="amg-textarea" rows={2} value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></div>
    </Modal>
  );
}

function MovimientosEntregas({ db, persist, addAudit, session, canWrite }) {
  const L = useLookups(db);
  const isAdmin = session.role === "admin";
  const items = inventoryItems(db);
  const itemOptions = items.map((i) => ({ value: i.key, label: i.label, sublabel: i.sublabel }));
  const blank = { date: todayISO(), itemKey: items[0]?.key || "", technicianId: "", quantity: 1, observation: "" };
  const [form, setForm] = useState(blank);
  const [saved, setSaved] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [annulTarget, setAnnulTarget] = useState(null);
  const [annulReason, setAnnulReason] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const techOptions = db.technicians.filter((t) => t.status === "Activo").map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));
  const item = items.find((i) => i.key === form.itemKey);
  const disponible = item ? stockOfItem(db, item.key) : 0;
  const cantidad = parseFloat(form.quantity) || 0;
  const excedeStock = cantidad > disponible;
  const canSave = item && form.technicianId && cantidad > 0 && !excedeStock;

  const save = () => {
    const tech = db.technicians.find((t) => t.id === form.technicianId);
    const mov = {
      id: uid("stk"), type: "Entrega", date: form.date, subcategoryId: item.subcategoryId, productId: item.productId,
      quantity: cantidad, technicianId: form.technicianId, unitCost: null, supplier: "",
      observation: form.observation, responsibleUserId: session.id, createdAt: new Date().toISOString(),
      status: "Activo", annulReason: "", annulUserId: "", annulDate: "", relatedExpenseId: null,
      consecutive: nextMovementConsecutive(db.stockMovements, "Entrega"),
    };
    let next = { ...db, stockMovements: [mov, ...(db.stockMovements || [])] };
    next = addAudit(next, { userId: session.id, action: "Entrega de insumo a técnico", record: mov.id, oldValue: "-", newValue: `${mov.consecutive}: ${mov.quantity} × ${item.label} → ${tech.name}` });
    persist(next);
    setSaved(true);
    setForm({ ...blank, itemKey: form.itemKey });
  };

  const confirmAnnul = () => {
    if (!annulReason.trim()) return;
    let next = {
      ...db,
      stockMovements: db.stockMovements.map((m) => m.id === annulTarget.id
        ? { ...m, status: "Anulado", annulReason, annulUserId: session.id, annulDate: todayISO() } : m),
    };
    next = addAudit(next, { userId: session.id, action: "Anulación de entrega de insumo", record: annulTarget.id, oldValue: "Activo", newValue: `Anulado: ${annulReason}` });
    persist(next);
    setAnnulTarget(null); setAnnulReason("");
  };

  const confirmEdit = (data) => {
    const tech = db.technicians.find((t) => t.id === data.technicianId);
    const oldLabel = movementItemLabel(db, editTarget);
    const newLabel = movementItemLabel(db, { ...editTarget, subcategoryId: data.subcategoryId, productId: data.productId });
    const oldTech = db.technicians.find((t) => t.id === editTarget.technicianId);
    let next = {
      ...db,
      stockMovements: db.stockMovements.map((m) => m.id === editTarget.id ? {
        ...m, date: data.date, subcategoryId: data.subcategoryId, productId: data.productId || null,
        technicianId: data.technicianId, quantity: data.quantity, observation: data.observation,
      } : m),
    };
    next = addAudit(next, {
      userId: session.id, action: "Edición de entrega de insumo", record: editTarget.id,
      oldValue: `${editTarget.consecutive || ""} ${editTarget.quantity} × ${oldLabel} → ${oldTech?.name}`.trim(),
      newValue: `${editTarget.consecutive || ""} ${data.quantity} × ${newLabel} → ${tech?.name}`.trim(),
    });
    persist(next);
    setEditTarget(null);
  };

  const historial = (db.stockMovements || []).filter((m) => m.type === "Entrega").sort((a, b) => b.date.localeCompare(a.date) || (b.consecutive || "").localeCompare(a.consecutive || ""));
  const exportCSV = () => downloadCSV("entregas_stock.csv",
    ["Consecutivo", "Fecha", "Insumo", "Técnico", "Cantidad", "Responsable", "Observación", "Estado"],
    historial.map((m) => [m.consecutive, fmtDate(m.date), movementItemLabel(db, m), L.techById[m.technicianId]?.name, m.quantity, L.userById[m.responsibleUserId]?.name, m.observation, m.status])
  );

  if (items.length === 0) {
    return <div className="amg-card" style={{ padding: 16, color: "var(--text-faint)", fontSize: 13 }}>Ningún insumo lleva inventario todavía. Márcalo con "Controla inventario" en Insumos / elementos → Catálogo de insumos (o en una subcategoría, desde Categorías y subcategorías).</div>;
  }

  return (
    <div>
      {canWrite && (
        <div className="amg-card" style={{ padding: 20, marginBottom: 16, maxWidth: 620 }}>
          {saved && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)", marginBottom: 12 }}><Check size={15} /> Entrega registrada. No se generó un nuevo gasto — el costo ya quedó cubierto en la compra.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><label className="amg-label">Insumo</label><SearchSelect options={itemOptions} value={form.itemKey} onChange={(v) => setForm({ ...form, itemKey: v })} placeholder="Buscar insumo..." /></div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label className="amg-label">Técnico</label><SearchSelect options={techOptions} value={form.technicianId} onChange={(v) => setForm({ ...form, technicianId: v })} placeholder="Buscar técnico activo..." />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 6 }}>
            <div><label className="amg-label">Cantidad a entregar</label><input type="number" min="1" className="amg-input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
            <div><label className="amg-label">Stock disponible</label><div className="amg-input amg-mono" style={{ background: "var(--panel)", color: excedeStock ? "var(--red)" : "var(--text)", fontWeight: 600 }}>{disponible}</div></div>
          </div>
          {excedeStock && <div className="amg-alert danger" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> La cantidad supera el stock disponible ({disponible}). Registra primero una compra.</div>}
          <div style={{ marginBottom: 14 }}><label className="amg-label">Observación</label><textarea className="amg-textarea" rows={2} value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></div>
          <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <button className="amg-btn primary" disabled={!canSave} onClick={save}><PackageMinus size={14} /> Registrar entrega</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Historial de entregas</div>
        <div style={{ display: "flex", gap: 8 }}>
          {canWrite && <button className="amg-btn" onClick={() => downloadImportEntregasTemplate(db)}><FileDown size={14} /> Plantilla</button>}
          {canWrite && <button className="amg-btn primary" onClick={() => setImportOpen(true)}><Upload size={14} /> Importar entregas</button>}
          <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
        </div>
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Consecutivo</th><th>Fecha</th><th>Insumo</th><th>Técnico</th><th>Cantidad</th><th>Responsable</th><th>Observación</th><th>Estado</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {historial.map((m) => (
              <tr key={m.id} style={m.status === "Anulado" ? { opacity: 0.6 } : undefined}>
                <td className="amg-mono">{m.consecutive || "-"}</td><td className="amg-mono">{fmtDate(m.date)}</td><td>{movementItemLabel(db, m)}</td><td>{L.techById[m.technicianId]?.name}</td>
                <td className="amg-mono">{m.quantity}</td><td>{L.userById[m.responsibleUserId]?.name}</td><td>{m.observation}</td>
                <td><Badge text={m.status} color={statusColor(m.status)} />{m.status === "Anulado" && <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{m.annulReason}</div>}</td>
                {isAdmin && (
                  <td style={{ display: "flex", gap: 4 }}>
                    {m.status === "Activo" && <>
                      <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setEditTarget(m)}><Pencil size={13} /></button>
                      <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setAnnulTarget(m)}><Ban size={13} color="var(--red)" /></button>
                    </>}
                  </td>
                )}
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin entregas registradas.</td></tr>}
          </tbody>
        </table>
      </div>

      {annulTarget && (
        <ConfirmModal title="Anular entrega" confirmLabel="Anular" danger onConfirm={confirmAnnul} onClose={() => { setAnnulTarget(null); setAnnulReason(""); }}
          message="El movimiento se conserva pero deja de contar como entregado, devolviendo esa cantidad al stock disponible. Esta acción queda registrada en auditoría.">
          <label className="amg-label">Motivo de anulación (obligatorio)</label>
          <textarea className="amg-textarea" rows={2} value={annulReason} onChange={(e) => setAnnulReason(e.target.value)} autoFocus />
        </ConfirmModal>
      )}

      {editTarget && (
        <EditarEntregaModal db={db} target={editTarget} onSave={confirmEdit} onClose={() => setEditTarget(null)} />
      )}

      {importOpen && (
        <ImportEntregasModal db={db} persist={persist} addAudit={addAudit} session={session} onClose={() => setImportOpen(false)} />
      )}
    </div>
  );
}

function EditarEntregaModal({ db, target, onSave, onClose }) {
  // Se incluyen también los insumos inactivos para que la entrega original siempre aparezca en la lista.
  const items = inventoryItems(db, true);
  const itemOptions = items.map((i) => ({ value: i.key, label: i.label, sublabel: i.sublabel }));
  const [form, setForm] = useState({
    date: target.date, itemKey: movementItemKeyFn(db)(target),
    technicianId: target.technicianId || "", quantity: target.quantity, observation: target.observation || "",
  });
  const techOptions = db.technicians.filter((t) => t.status === "Activo" || t.id === target.technicianId).map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));
  const item = items.find((i) => i.key === form.itemKey);
  const disponible = item ? stockOfItem(db, item.key, target.id) : 0;
  const cantidad = parseFloat(form.quantity) || 0;
  const excedeStock = cantidad > disponible;
  const canSave = item && form.technicianId && cantidad > 0 && !excedeStock;

  const submit = () => onSave({
    date: form.date, subcategoryId: item.subcategoryId, productId: item.productId,
    technicianId: form.technicianId, quantity: cantidad, observation: form.observation,
  });

  return (
    <Modal title={`Editar entrega${target.consecutive ? " " + target.consecutive : ""}`} onClose={onClose} width={620}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!canSave} onClick={submit}>Guardar cambios</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        <div><label className="amg-label">Insumo</label><SearchSelect options={itemOptions} value={form.itemKey} onChange={(v) => setForm({ ...form, itemKey: v })} placeholder="Buscar insumo..." /></div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="amg-label">Técnico</label><SearchSelect options={techOptions} value={form.technicianId} onChange={(v) => setForm({ ...form, technicianId: v })} placeholder="Buscar técnico..." />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 6 }}>
        <div><label className="amg-label">Cantidad entregada</label><input type="number" min="1" className="amg-input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
        <div><label className="amg-label">Stock disponible (sin contar esta entrega)</label><div className="amg-input amg-mono" style={{ background: "var(--panel)", color: excedeStock ? "var(--red)" : "var(--text)", fontWeight: 600 }}>{disponible}</div></div>
      </div>
      {excedeStock && <div className="amg-alert danger" style={{ marginBottom: 10 }}><AlertTriangle size={14} /> La cantidad supera el stock disponible ({disponible}).</div>}
      <div><label className="amg-label">Observación</label><textarea className="amg-textarea" rows={2} value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></div>
    </Modal>
  );
}

/* ============================================================================
   CATEGORÍAS Y SUBCATEGORÍAS
============================================================================ */

function Categorias({ db, persist, session }) {
  const [expanded, setExpanded] = useState({});
  const [catModal, setCatModal] = useState(null);
  const [subModal, setSubModal] = useState(null);
  const canEdit = session.role === "admin";

  const usedCat = (id) => db.expenses.some((e) => e.categoryId === id);
  const usedSub = (id) => db.expenses.some((e) => e.subcategoryId === id);

  const saveCat = (data) => {
    let next;
    if (data.id) next = { ...db, categories: db.categories.map((c) => c.id === data.id ? data : c) };
    else next = { ...db, categories: [...db.categories, { ...data, id: uid("c") }] };
    persist(next); setCatModal(null);
  };
  const saveSub = (data) => {
    let next;
    if (data.id) next = { ...db, subcategories: db.subcategories.map((s) => s.id === data.id ? data : s) };
    else next = { ...db, subcategories: [...db.subcategories, { ...data, id: uid("s") }] };
    persist(next); setSubModal(null);
  };
  const toggleCat = (c) => persist({ ...db, categories: db.categories.map((x) => x.id === c.id ? { ...x, active: !x.active } : x) });
  const toggleSub = (s) => persist({ ...db, subcategories: db.subcategories.map((x) => x.id === s.id ? { ...x, active: !x.active } : x) });

  return (
    <div>
      {canEdit && <button className="amg-btn primary" style={{ marginBottom: 14 }} onClick={() => setCatModal({})}><Plus size={14} /> Nueva categoría</button>}
      <div className="amg-card">
        {db.categories.map((c) => {
          const subs = db.subcategories.filter((s) => s.categoryId === c.id);
          const open = !!expanded[c.id];
          return (
            <div key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", cursor: "pointer" }} onClick={() => setExpanded({ ...expanded, [c.id]: !open })}>
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <FolderTree size={15} color="var(--accent)" />
                <span style={{ fontWeight: 600, flex: 1 }}>{c.name}</span>
                <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{subs.length} subcategorías</span>
                <Badge text={c.active ? "Activa" : "Inactiva"} color={c.active ? "green" : "gray"} />
                {canEdit && <>
                  <button className="amg-btn ghost" style={{ padding: 4 }} onClick={(e) => { e.stopPropagation(); setCatModal(c); }}><Pencil size={13} /></button>
                  <button className="amg-btn ghost" style={{ padding: 4 }} onClick={(e) => { e.stopPropagation(); toggleCat(c); }} title={usedCat(c.id) ? "Tiene movimientos: solo se puede inactivar" : ""}>
                    {c.active ? <Ban size={13} color="var(--red)" /> : <RotateCcw size={13} color="var(--green)" />}
                  </button>
                  <button className="amg-btn ghost" style={{ padding: 4 }} onClick={(e) => { e.stopPropagation(); setSubModal({ categoryId: c.id }); }}><Plus size={13} /></button>
                </>}
              </div>
              {open && (
                <div style={{ padding: "0 14px 12px 40px" }}>
                  <table className="amg-table"><thead><tr><th>Subcategoría</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
                    <tbody>
                      {subs.map((s) => (
                        <tr key={s.id}>
                          <td>{s.name}</td>
                          <td><Badge text={s.tipo} color={s.tipo === "activo" ? "blue" : s.tipo === "gasto" ? "amber" : "gray"} /> {s.trackStock && <Badge text="Inventario" color="green" />}</td>
                          <td><Badge text={s.active ? "Activa" : "Inactiva"} color={s.active ? "green" : "gray"} /></td>
                          <td style={{ display: "flex", gap: 4 }}>
                            {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setSubModal(s)}><Pencil size={13} /></button>}
                            {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => toggleSub(s)} title={usedSub(s.id) ? "Tiene movimientos: solo se puede inactivar" : ""}>{s.active ? <Ban size={13} color="var(--red)" /> : <RotateCcw size={13} color="var(--green)" />}</button>}
                          </td>
                        </tr>
                      ))}
                      {subs.length === 0 && <tr><td colSpan={4} style={{ color: "var(--text-faint)" }}>Sin subcategorías.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {catModal !== null && (
        <Modal title={catModal.id ? "Editar categoría" : "Nueva categoría"} onClose={() => setCatModal(null)}
          footer={<CatFooter data={catModal} onSave={saveCat} onClose={() => setCatModal(null)} />}>
          <CatForm data={catModal} onChange={setCatModal} />
        </Modal>
      )}
      {subModal !== null && (
        <SubModal data={subModal} categories={db.categories} onSave={saveSub} onClose={() => setSubModal(null)} />
      )}
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>Las categorías y subcategorías con movimientos históricos nunca se eliminan, solo se inactivan.</div>
    </div>
  );
}

function CatForm({ data, onChange }) {
  return (
    <div>
      <label className="amg-label">Nombre</label>
      <input className="amg-input" value={data.name || ""} onChange={(e) => onChange({ ...data, name: e.target.value, active: data.active !== false })} />
    </div>
  );
}
function CatFooter({ data, onSave, onClose }) {
  return <><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!data.name} onClick={() => onSave({ ...data, active: data.active !== false })}>Guardar</button></>;
}

function SubModal({ data, categories, onSave, onClose }) {
  const [f, setF] = useState({ id: data.id || null, categoryId: data.categoryId || "", name: data.name || "", tipo: data.tipo || "gasto", active: data.active !== false, trackStock: data.trackStock === true });
  return (
    <Modal title={f.id ? "Editar subcategoría" : "Nueva subcategoría"} onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!f.name || !f.categoryId} onClick={() => onSave(f)}>Guardar</button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label className="amg-label">Categoría</label>
          <select className="amg-select" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">Seleccionar...</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label className="amg-label">Nombre</label><input className="amg-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="amg-label">Tipo de movimiento</label>
          <select className="amg-select" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            <option value="consumible">Consumible</option><option value="gasto">Gasto</option><option value="activo">Activo / herramienta</option>
          </select>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" style={{ marginTop: 3 }} checked={f.trackStock} onChange={(e) => setF({ ...f, trackStock: e.target.checked })} />
          <span>
            <div style={{ fontWeight: 600 }}>Controla inventario</div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>La compra y la entrega a un técnico se registran por separado en el módulo Inventario, en vez de un solo "Registrar gasto".</div>
          </span>
        </label>
      </div>
    </Modal>
  );
}

/* ============================================================================
   PRODUCTOS / ELEMENTOS  (catálogo + activos/herramientas)
============================================================================ */

function Productos({ db, persist, addAudit, session, onGoTech }) {
  const [tab, setTab] = useState("catalogo");
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        <div className={`amg-tab ${tab === "catalogo" ? "active" : ""}`} onClick={() => setTab("catalogo")}>Catálogo de insumos</div>
        <div className={`amg-tab ${tab === "activos" ? "active" : ""}`} onClick={() => setTab("activos")}>Activos y herramientas</div>
      </div>
      {tab === "catalogo" ? <CatalogoProductos db={db} persist={persist} addAudit={addAudit} session={session} /> : <ActivosHerramientas db={db} persist={persist} addAudit={addAudit} session={session} onGoTech={onGoTech} />}
    </div>
  );
}

function CatalogoProductos({ db, persist, addAudit, session }) {
  const [modal, setModal] = useState(null);
  const canEdit = session.role === "admin";
  const L = useLookups(db);

  // Insumo con inventario al que pertenece cada fila del catálogo: el propio insumo si lleva
  // inventario, o su subcategoría si es esta la que lo lleva (caso de lo que ya existía).
  const inventoryItemOf = (p) => {
    const sub = L.subById[p.subcategoryId];
    if (p.trackStock) return { key: `p:${p.id}`, label: p.name, sublabel: sub?.name || "", subcategoryId: p.subcategoryId, productId: p.id, propio: true };
    if (sub?.trackStock) return { key: `s:${sub.id}`, label: sub.name, sublabel: "Subcategoría completa", subcategoryId: sub.id, productId: p.id, propio: false };
    return null;
  };

  const save = (data) => {
    let next;
    if (data.id) {
      const before = db.products.find((p) => p.id === data.id);
      next = { ...db, products: db.products.map((p) => p.id === data.id ? data : p) };
      if (before && !!before.trackStock !== !!data.trackStock) {
        next = addAudit(next, { userId: session.id, action: "Cambio de inventario de insumo", record: data.id, oldValue: before.trackStock ? "Controla inventario" : "Sin inventario", newValue: data.trackStock ? "Controla inventario" : "Sin inventario" });
      }
    } else {
      next = { ...db, products: [...db.products, { ...data, id: uid("p") }] };
    }
    persist(next); setModal(null);
  };
  const toggle = (p) => persist({ ...db, products: db.products.map((x) => x.id === p.id ? { ...x, active: !x.active } : x) });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        {canEdit && <button className="amg-btn primary" onClick={() => setModal({})}><Plus size={14} /> Nuevo insumo</button>}
        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Los insumos que llevan inventario muestran su stock actual. Sus compras y entregas a técnicos se registran en el módulo Inventario.</span>
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Insumo</th><th>Subcategoría</th><th>Categoría</th><th>Inventario</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {db.products.map((p) => {
              const sub = L.subById[p.subcategoryId];
              const item = inventoryItemOf(p);
              const stock = item ? stockOfItem(db, item.key) : null;
              return (
                <tr key={p.id}>
                  <td>{p.name}</td><td>{sub?.name}</td><td>{L.catById[sub?.categoryId]?.name}</td>
                  <td>
                    {item ? (
                      <div>
                        <Badge text={item.propio ? "Controla inventario" : "Por subcategoría"} color={item.propio ? "green" : "gray"} />
                        <div className="amg-mono" style={{ fontSize: 12, marginTop: 3, color: stock <= 5 ? "var(--red)" : "var(--text)", fontWeight: 600 }}>
                          Stock: {stock}{!item.propio && <span style={{ fontWeight: 400, color: "var(--text-faint)" }}> (de todo «{item.label}»)</span>}
                        </div>
                      </div>
                    ) : "-"}
                  </td>
                  <td><Badge text={p.active ? "Activo" : "Inactivo"} color={p.active ? "green" : "gray"} /></td>
                  <td style={{ display: "flex", gap: 4 }}>
                    {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} title="Editar" onClick={() => setModal(p)}><Pencil size={13} /></button>}
                    {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} title={p.active ? "Inactivar" : "Activar"} onClick={() => toggle(p)}>{p.active ? <Ban size={13} color="var(--red)" /> : <RotateCcw size={13} color="var(--green)" />}</button>}
                  </td>
                </tr>
              );
            })}
            {db.products.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin insumos en el catálogo.</td></tr>}
          </tbody>
        </table>
      </div>
      {modal !== null && <ProductoModal data={modal} categories={db.categories} subcategories={db.subcategories} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

function ProductoModal({ data, categories, subcategories, onSave, onClose }) {
  const currentSub = subcategories.find((s) => s.id === data.subcategoryId);
  const [f, setF] = useState({
    id: data.id || null, categoryId: currentSub?.categoryId || "", subcategoryId: data.subcategoryId || "",
    name: data.name || "", active: data.active !== false, trackStock: !!data.trackStock,
  });
  const subOptions = subcategories.filter((s) => s.active && s.categoryId === f.categoryId);
  const subTracks = !!subcategories.find((s) => s.id === f.subcategoryId)?.trackStock;
  return (
    <Modal title={f.id ? "Editar insumo" : "Nuevo insumo"} onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!f.name || !f.subcategoryId} onClick={() => onSave(f)}>Guardar</button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label className="amg-label">Categoría</label>
          <select className="amg-select" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value, subcategoryId: "" })}>
            <option value="">Seleccionar...</option>{categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label className="amg-label">Subcategoría</label>
          <select className="amg-select" value={f.subcategoryId} disabled={!f.categoryId} onChange={(e) => setF({ ...f, subcategoryId: e.target.value })}>
            <option value="">{f.categoryId ? "Seleccionar..." : "Elige primero la categoría"}</option>
            {subOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><label className="amg-label">Nombre del insumo / elemento</label><input className="amg-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={f.trackStock} onChange={(e) => setF({ ...f, trackStock: e.target.checked })} />
            Controla inventario (stock, compras y entregas con consecutivo)
          </label>
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>
            Con la marca, este insumo tiene su propio stock en Inventario, se compra y se entrega a técnicos con su consecutivo (COM-0001, ENT-0001) y se puede asignar desde este catálogo.
            {subTracks && " Su subcategoría ya controla inventario completa: al marcar el insumo, sus movimientos pasan a contarse solo en su propio stock."}
            {f.id && " Si ya tiene compras o entregas y quitas la marca, dejan de contarse en el stock de este insumo."}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const ASSET_STATES = ["Disponible", "Asignado", "En reparación", "Dañado", "Perdido", "Dado de baja"];

function nextAssetCode(assets) {
  const nums = (assets || [])
    .filter((a) => (a.code || "").startsWith("HER-"))
    .map((a) => parseInt(a.code.slice(4), 10))
    .filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `HER-${pad2(next)}`;
}

// Alta de una herramienta nueva (la usan Productos → Activos y herramientas e
// Inventario → Activos → Compras, para que ambos caminos dejen exactamente lo
// mismo): registra la compra en auditoría y, si se eligió un técnico, la
// entrega inmediata (estado Asignado + primera entrada del historial).
function createAssetFromForm(db, data, session, addAudit) {
  const assignTo = data.assignTechId ? db.technicians.find((t) => t.id === data.assignTechId) : null;
  const { assignTechId, ...rest } = data;
  const asset = {
    ...rest, id: uid("a"), code: nextAssetCode(db.assets), value: parseFloat(data.value) || 0,
    department: assignTo?.department || rest.department || null,
    status: assignTo ? "Asignado" : "Disponible",
    technicianId: assignTo ? assignTo.id : null,
    deliveryDate: assignTo ? todayISO() : null,
    history: assignTo ? [{ technicianId: assignTo.id, from: todayISO(), to: "", userId: session.id }] : [],
  };
  let next = { ...db, assets: [...db.assets, asset] };
  next = addAudit(next, {
    userId: session.id, action: "Compra de herramienta", record: asset.id, oldValue: "-",
    newValue: `${asset.code} — ${asset.type}${asset.brand ? " — " + asset.brand : ""}${asset.value ? " — " + fmtCOP(asset.value) : ""}`,
  });
  if (assignTo) {
    next = addAudit(next, { userId: session.id, action: "Entrega de herramienta a técnico", record: asset.id, oldValue: "Disponible", newValue: assignTo.name });
  }
  return next;
}

// Cierra (pone fecha de devolución de hoy) la última entrada del historial
// de una herramienta si quedó abierta, antes de liberarla o reasignarla.
// Sin esto, quedan varias entradas marcadas como "vigentes" a la vez.
function closeOpenHistoryEntry(history) {
  if (!history || history.length === 0) return history || [];
  const last = history[history.length - 1];
  if (last.to) return history;
  return [...history.slice(0, -1), { ...last, to: todayISO() }];
}

function ActivosHerramientas({ db, persist, addAudit, session, onGoTech }) {
  const [modal, setModal] = useState(null);
  const [typesModal, setTypesModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [estadoFiltro, setEstadoFiltro] = useState("");
  const canEdit = session.role === "admin" || session.role === "operador";
  const L = useLookups(db);
  const techActivosOpts = db.technicians.filter((t) => t.status === "Activo").map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));
  const assetsFiltrados = db.assets.filter((a) => !estadoFiltro || a.status === estadoFiltro);

  const save = (data) => {
    let next;
    if (data.id) {
      const before = db.assets.find((a) => a.id === data.id);
      // Se conserva el historial de asignaciones, la fecha de entrega, el estado y el técnico actuales: el formulario solo edita los datos de la herramienta.
      const updated = {
        ...before, type: data.type, brand: data.brand, model: data.model, serial: data.serial,
        value: parseFloat(data.value) || 0, purchaseDate: data.purchaseDate, department: data.department || null,
      };
      next = { ...db, assets: db.assets.map((a) => a.id === data.id ? updated : a) };
      const desc = (a) => `${a.type} · ${a.brand || "-"} ${a.model || ""} · serial ${a.serial || "-"} · ${fmtCOP(a.value)} · compra ${fmtDate(a.purchaseDate)} · depto. ${a.department || "-"}`;
      next = addAudit(next, { userId: session.id, action: "Edición de activo", record: before.id, oldValue: desc(before), newValue: desc(updated) });
    } else {
      next = createAssetFromForm(db, data, session, addAudit);
    }
    persist(next); setModal(null);
  };

  const assign = (asset, techId) => {
    const conflict = db.assets.find((a) => a.id !== asset.id && a.technicianId === techId && a.status === "Asignado" && a.type === asset.type);
    const next0 = {
      ...db,
      assets: db.assets.map((a) => a.id === asset.id ? {
        ...a, technicianId: techId, deliveryDate: todayISO(), status: "Asignado",
        department: L.techById[techId]?.department || a.department || null,
        history: [...closeOpenHistoryEntry(a.history), { technicianId: techId, from: todayISO(), to: "", userId: session.id }],
      } : a),
    };
    const next = addAudit(next0, { userId: session.id, action: "Asignación de herramienta", record: asset.id, oldValue: asset.technicianId ? L.techById[asset.technicianId]?.name : "Disponible", newValue: L.techById[techId]?.name });
    persist(next);
    setAssignTarget(null);
    if (conflict) alert(`Aviso: esta herramienta ya estaba asignada a otro técnico; el registro anterior queda en el historial.`);
  };

  const changeAssetStatus = (asset, status) => {
    const releasing = status !== "Asignado";
    const next0 = {
      ...db,
      assets: db.assets.map((a) => a.id === asset.id ? {
        ...a, status, technicianId: releasing ? null : a.technicianId,
        history: releasing ? closeOpenHistoryEntry(a.history) : a.history,
      } : a),
    };
    const next = addAudit(next0, { userId: session.id, action: "Cambio de estado de activo", record: asset.id, oldValue: asset.status, newValue: status });
    persist(next);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {canEdit && <button className="amg-btn primary" onClick={() => setModal({})}><Plus size={14} /> Nueva herramienta / activo</button>}
        {canEdit && <button className="amg-btn" onClick={() => setTypesModal(true)}><ListChecks size={14} /> Tipos de herramienta</button>}
        <select className="amg-select" style={{ width: 190, marginLeft: "auto" }} value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}>
          <option value="">Todos los estados</option>
          {ASSET_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Código</th><th>Tipo</th><th>Marca/Modelo</th><th>Serial</th><th>Valor</th><th>Departamento</th><th>Técnico asignado</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {assetsFiltrados.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin herramientas{estadoFiltro ? ` en estado "${estadoFiltro}"` : ""}.</td></tr>}
            {assetsFiltrados.map((a) => {
              const tech = a.technicianId ? L.techById[a.technicianId] : null;
              return (
                <tr key={a.id}>
                  <td className="amg-mono">{a.code}</td><td>{a.type}</td><td>{a.brand} {a.model}</td><td className="amg-mono">{a.serial}</td><td className="amg-mono">{fmtCOP(a.value)}</td>
                  <td>{a.department || "-"}</td>
                  <td>{tech ? <span style={{ cursor: "pointer", color: "var(--accent)" }} onClick={() => onGoTech(tech.id)}>{tech.name}{tech.status === "Retirado" && <AlertTriangle size={12} style={{ marginLeft: 4 }} color="var(--red)" />}</span> : "-"}</td>
                  <td>
                    {canEdit ? (
                      <select className="amg-select" style={{ padding: "4px 6px", fontSize: 12 }} value={a.status} onChange={(e) => changeAssetStatus(a, e.target.value)}>
                        {ASSET_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <Badge text={a.status} color={statusColor(a.status)} />}
                  </td>
                  <td style={{ display: "flex", gap: 4 }}>
                    {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} title="Editar herramienta" onClick={() => setModal(a)}><Pencil size={13} /></button>}
                    {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setAssignTarget(a)}>Asignar</button>}
                    <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setHistoryTarget(a)}>Historial</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>
        {assetsFiltrados.length} herramienta{assetsFiltrados.length === 1 ? "" : "s"}. Cada herramienta que registras aquí queda como compra en Inventario → Activos y herramientas (Stock y Compras), y sus entregas a técnicos se ven en Entregas.
      </div>

      {modal !== null && <AssetModal data={modal} assetTypes={db.assetTypes || []} technicians={db.technicians} onSave={save} onManageTypes={() => setTypesModal(true)} onClose={() => setModal(null)} />}
      {typesModal && <AssetTypesModal db={db} persist={persist} onClose={() => setTypesModal(false)} />}
      {assignTarget && (
        <Modal title={`Asignar "${assignTarget.type}" (${assignTarget.code})`} onClose={() => setAssignTarget(null)} width={640}>
          <div style={{ minHeight: 380 }}>
            <label className="amg-label">Técnico</label>
            <SearchSelect options={techActivosOpts} value="" onChange={(v) => assign(assignTarget, v)} placeholder="Buscar técnico activo..." />
          </div>
        </Modal>
      )}
      {historyTarget && (
        <AssetHistoryModal db={db} asset={db.assets.find((a) => a.id === historyTarget.id) || historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
    </div>
  );
}

// Línea de tiempo de una herramienta: asignaciones (con quién las registró) y
// cambios de estado / ediciones (tomados del log de auditoría, que solo puede
// leer un administrador; para otros roles solo se ven las asignaciones).
function AssetHistoryModal({ db, asset, onClose }) {
  const L = useLookups(db);
  const events = [];
  (asset.history || []).forEach((h) => {
    events.push({
      key: `h-${h.from}-${h.technicianId}-${h.createdAt || ""}`,
      sort: h.createdAt || `${h.from}T00:00`,
      when: fmtDate(h.from),
      title: <>Asignada a <b>{L.techById[h.technicianId]?.name || "-"}</b></>,
      detail: h.to ? `desde ${fmtDate(h.from)} hasta ${fmtDate(h.to)}` : `desde ${fmtDate(h.from)} (vigente)`,
      user: L.userById[h.userId]?.name,
    });
  });
  (db.auditLog || []).filter((a) => a.record === asset.id && (a.action === "Cambio de estado de activo" || a.action === "Edición de activo")).forEach((a) => {
    events.push({
      key: `a-${a.id}`,
      sort: `${a.date}T${a.time}`,
      when: `${fmtDate(a.date)} ${a.time}`,
      title: a.action === "Cambio de estado de activo" ? <>Cambio de estado: <b>{a.oldValue}</b> → <b>{a.newValue}</b></> : <>Edición de datos de la herramienta</>,
      detail: a.action === "Edición de activo" ? `${a.oldValue} → ${a.newValue}` : "",
      user: L.userById[a.userId]?.name,
    });
  });
  events.sort((x, y) => y.sort.localeCompare(x.sort));

  return (
    <Modal title={`Historial de "${asset.code}"`} onClose={onClose} width={640}>
      {events.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 13 }}>Sin historial registrado.</div>}
      {events.map((e) => (
        <div key={e.key} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>{e.title}</span>
            <span className="amg-mono" style={{ color: "var(--text-faint)", fontSize: 11.5, whiteSpace: "nowrap" }}>{e.when}</span>
          </div>
          {e.detail && <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>{e.detail}</div>}
          <div style={{ color: "var(--text-faint)", fontSize: 11.5, marginTop: 2 }}>Registrado por: <b style={{ color: "var(--text-dim)" }}>{e.user || "—"}</b></div>
        </div>
      ))}
    </Modal>
  );
}

function AssetModal({ data, assetTypes, technicians = [], onSave, onManageTypes, onClose }) {
  const [f, setF] = useState({
    id: data.id || null, code: data.code || "", type: data.type || "", brand: data.brand || "", model: data.model || "",
    serial: data.serial || "", value: data.value || "", purchaseDate: data.purchaseDate || todayISO(), status: data.status || "Disponible", technicianId: data.technicianId || null,
    assignTechId: "", department: data.department || "",
  });
  const [techOpen, setTechOpen] = useState(false);
  const activeTypes = assetTypes.filter((t) => t.active);
  const techOptions = technicians.filter((t) => t.status === "Activo").map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));
  return (
    <Modal title={f.id ? "Editar activo" : "Nuevo activo / herramienta"} onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!f.type} onClick={() => onSave(f)}>Guardar</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label className="amg-label">Código interno</label>
          <div className="amg-input amg-mono" style={{ background: "var(--panel)", color: "var(--text-faint)" }}>{f.code || "Se genera automáticamente al guardar"}</div>
        </div>
        <div>
          <label className="amg-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Tipo de herramienta</span>
            <span style={{ color: "var(--accent)", cursor: "pointer", fontWeight: 600 }} onClick={onManageTypes}>+ Nuevo tipo</span>
          </label>
          <select className="amg-select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="">Seleccionar...</option>
            {activeTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            {f.type && !activeTypes.some((t) => t.name === f.type) && <option value={f.type}>{f.type} (inactivo)</option>}
          </select>
        </div>
        <div><label className="amg-label">Marca</label><input className="amg-input" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></div>
        <div><label className="amg-label">Modelo</label><input className="amg-input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></div>
        <div><label className="amg-label">Serial</label><input className="amg-input" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} /></div>
        <div><label className="amg-label">Valor (COP)</label><input type="number" className="amg-input" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></div>
        <div><label className="amg-label">Fecha de compra</label><input type="date" className="amg-input" value={f.purchaseDate} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} /></div>
        <div>
          <label className="amg-label">Departamento donde está</label>
          <input className="amg-input" list="amg-deptos-activo" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} placeholder="Ej. Atlántico" />
          <datalist id="amg-deptos-activo">{DEPARTAMENTOS_CO.map((d) => <option key={d} value={d} />)}</datalist>
        </div>
      </div>
      {!f.id && (
        <div style={{ marginTop: 14, paddingBottom: techOpen ? 340 : 0 }}>
          <label className="amg-label">Entregar a un técnico ahora (opcional)</label>
          <SearchSelect options={[{ value: "", label: "No entregar todavía (queda Disponible)" }, ...techOptions]} value={f.assignTechId} onChange={(v) => setF({ ...f, assignTechId: v })} placeholder="No entregar todavía (queda Disponible)" onOpenChange={setTechOpen} />
          <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
            Si la entregas a un técnico, el departamento pasa a ser el del técnico. Al guardar, la herramienta queda registrada como compra en Inventario → Activos y herramientas{f.assignTechId ? " y se registra su entrega al técnico elegido" : ""}.
          </div>
        </div>
      )}
    </Modal>
  );
}

function AssetTypesModal({ db, persist, onClose }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const types = db.assetTypes || [];

  const addType = () => {
    if (!newName.trim()) return;
    persist({ ...db, assetTypes: [...types, { id: uid("at"), name: newName.trim(), active: true }] });
    setNewName("");
  };
  const saveEdit = (id) => {
    if (!editingName.trim()) return;
    persist({ ...db, assetTypes: types.map((t) => t.id === id ? { ...t, name: editingName.trim() } : t) });
    setEditingId(null);
  };
  const toggle = (t) => persist({ ...db, assetTypes: types.map((x) => x.id === t.id ? { ...x, active: !x.active } : x) });
  const usedByAsset = (name) => db.assets.some((a) => a.type === name);

  return (
    <Modal title="Tipos de herramienta" onClose={onClose} width={480}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input className="amg-input" placeholder="Nombre del nuevo tipo" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addType()} />
        <button className="amg-btn primary" disabled={!newName.trim()} onClick={addType}><Plus size={14} /> Agregar</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {types.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6 }}>
            {editingId === t.id ? (
              <input className="amg-input" style={{ flex: 1 }} autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveEdit(t.id)} />
            ) : (
              <span style={{ flex: 1, fontSize: 13.5, color: t.active ? "var(--text)" : "var(--text-faint)" }}>{t.name}</span>
            )}
            <Badge text={t.active ? "Activo" : "Inactivo"} color={t.active ? "green" : "gray"} />
            {editingId === t.id ? (
              <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => saveEdit(t.id)}><Check size={13} color="var(--green)" /></button>
            ) : (
              <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => { setEditingId(t.id); setEditingName(t.name); }}><Pencil size={13} /></button>
            )}
            <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => toggle(t)} title={usedByAsset(t.name) ? "Hay activos con este tipo; solo se puede inactivar" : ""}>
              {t.active ? <Ban size={13} color="var(--red)" /> : <RotateCcw size={13} color="var(--green)" />}
            </button>
          </div>
        ))}
        {types.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 13 }}>Aún no hay tipos creados.</div>}
      </div>
    </Modal>
  );
}

/* ============================================================================
   USUARIOS
============================================================================ */

function UsuariosView({ db, persist, reloadAll, session }) {
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async (data) => {
    setErr("");
    if (data.id) {
      const next = { ...db, users: db.users.map((u) => (u.id === data.id ? { ...u, name: data.name, username: data.username, role: data.role, active: data.active } : u)) };
      persist(next);
      setModal(null);
      return;
    }
    setBusy(true);
    try {
      await api.adminCreateUser({ email: data.email, password: data.password, name: data.name, username: data.username, role: data.role });
      await reloadAll();
      setModal(null);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (u) => persist({ ...db, users: db.users.map((x) => (x.id === u.id ? { ...x, active: !x.active } : x)) });

  return (
    <div>
      <button className="amg-btn primary" style={{ marginBottom: 12 }} onClick={() => { setErr(""); setModal({}); }}><Plus size={14} /> Nuevo usuario</button>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {db.users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}{u.id === session.id && <span style={{ color: "var(--text-faint)", fontSize: 11 }}> (tú)</span>}</td>
                <td className="amg-mono">@{u.username}</td>
                <td><Badge text={u.role} color={u.role === "admin" ? "amber" : u.role === "operador" ? "blue" : "gray"} /></td>
                <td><Badge text={u.active ? "Activo" : "Inactivo"} color={u.active ? "green" : "gray"} /></td>
                <td style={{ display: "flex", gap: 4 }}>
                  <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => { setErr(""); setModal(u); }}><Pencil size={13} /></button>
                  {u.id !== session.id && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => toggle(u)}>{u.active ? <Ban size={13} color="var(--red)" /> : <RotateCcw size={13} color="var(--green)" />}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>Los nuevos usuarios se crean con autenticación real (correo y contraseña) mediante una Edge Function que solo un administrador puede invocar.</div>
      {modal !== null && (
        <Modal title={modal.id ? "Editar usuario" : "Nuevo usuario"} onClose={() => setModal(null)}
          footer={<UserFooter data={modal} busy={busy} onSave={save} onClose={() => setModal(null)} />}>
          {err && <div className="amg-alert danger" style={{ marginBottom: 12 }}><AlertTriangle size={14} /> {err}</div>}
          <UserForm data={modal} onChange={setModal} />
        </Modal>
      )}
    </div>
  );
}
function UserForm({ data, onChange }) {
  const isNew = !data.id;
  const f = {
    name: data.name || "", username: data.username || "", role: data.role || "operador",
    active: data.active !== false, id: data.id || null, email: data.email || "", password: data.password || "",
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label className="amg-label">Nombre completo</label><input className="amg-input" value={f.name} onChange={(e) => onChange({ ...f, name: e.target.value })} /></div>
      <div><label className="amg-label">Usuario</label><input className="amg-input" value={f.username} onChange={(e) => onChange({ ...f, username: e.target.value })} /></div>
      {isNew && (
        <>
          <div><label className="amg-label">Correo electrónico</label><input type="email" className="amg-input" value={f.email} onChange={(e) => onChange({ ...f, email: e.target.value })} /></div>
          <div><label className="amg-label">Contraseña temporal</label><input type="password" className="amg-input" value={f.password} onChange={(e) => onChange({ ...f, password: e.target.value })} /></div>
        </>
      )}
      <div><label className="amg-label">Rol</label>
        <select className="amg-select" value={f.role} onChange={(e) => onChange({ ...f, role: e.target.value })}>
          <option value="admin">Administrador</option><option value="operador">Operador</option><option value="consulta">Consulta / Supervisor</option>
        </select>
      </div>
    </div>
  );
}
function UserFooter({ data, busy, onSave, onClose }) {
  const isNew = !data.id;
  const f = {
    name: data.name || "", username: data.username || "", role: data.role || "operador",
    active: data.active !== false, id: data.id || null, email: data.email || "", password: data.password || "",
  };
  const canSave = isNew ? (f.name && f.username && f.email && f.password.length >= 6) : (f.name && f.username);
  return <><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!canSave || busy} onClick={() => onSave(f)}>{busy ? "Creando..." : "Guardar"}</button></>;
}

function Reportes({ db }) {
  const L = useLookups(db);
  const [active, setActive] = useState(null);
  const activeExp = db.expenses.filter((e) => e.status === "Activo");

  const reports = {
    tecnico: {
      title: "Gasto por técnico", headers: ["Técnico", "Gastos directos", "Insumos entregados", "Total"],
      note: "Los insumos entregados (ej. Vinipel) se valoran con el costo promedio de sus compras. La compra sigue siendo un gasto general, por eso este total no se suma al total de gastos.",
      rows: () => Object.entries(costByTechnician(db, activeExp)).map(([id, c]) => [L.techById[id]?.name, c.directo, c.insumos, c.directo + c.insumos]).sort((a, b) => b[3] - a[3]),
    },
    categoria: { title: "Gasto por categoría", headers: ["Categoría", "Total"], rows: () => Object.entries(groupSum(activeExp, "categoryId")).map(([id, v]) => [L.catById[id]?.name, v]) },
    subcategoria: { title: "Gasto por subcategoría", headers: ["Subcategoría", "Total"], rows: () => Object.entries(groupSum(activeExp, "subcategoryId")).map(([id, v]) => [L.subById[id]?.name, v]) },
    mes: { title: "Gasto por mes", headers: ["Mes", "Total"], rows: () => Object.entries(groupSum(activeExp, "date", monthKey)).sort().map(([k, v]) => [monthLabel(k), v]) },
    anio: { title: "Gasto por año", headers: ["Año", "Total"], rows: () => Object.entries(groupSum(activeExp, "date", yearOf)).sort().map(([k, v]) => [k, v]) },
    usuario: { title: "Gasto por usuario responsable", headers: ["Usuario", "Total"], rows: () => Object.entries(groupSum(activeExp, "responsibleUserId")).map(([id, v]) => [L.userById[id]?.name, v]) },
    departamento: {
      title: "Gasto por departamento", headers: ["Departamento", "Total"],
      rows: () => {
        const m = {};
        Object.entries(costByTechnician(db, activeExp)).forEach(([id, c]) => {
          const dept = L.techById[id]?.department || "Sin departamento";
          m[dept] = (m[dept] || 0) + c.directo + c.insumos;
        });
        return Object.entries(m).sort((a, b) => b[1] - a[1]);
      },
      note: "Incluye los gastos directos y los insumos entregados a los técnicos del departamento (valorados al costo promedio de compra).",
    },
    comparativo: {
      title: "Comparativo mensual", headers: ["Mes", "Total"],
      rows: () => last12MonthKeys().map((k) => [monthLabel(k), activeExp.filter((e) => monthKey(e.date) === k).reduce((s, e) => s + e.totalValue, 0)]),
    },
    herramientasTecnico: {
      title: "Herramientas entregadas por técnico", headers: ["Técnico", "Herramienta", "Código", "Fecha entrega", "Estado"],
      rows: () => db.assets.filter((a) => a.technicianId).map((a) => [L.techById[a.technicianId]?.name, a.type, a.code, fmtDate(a.deliveryDate), a.status]), noSum: true,
    },
    pendientesDevolucion: {
      title: "Herramientas pendientes de devolución", headers: ["Técnico", "Herramienta", "Código", "Estado técnico"],
      rows: () => db.assets.filter((a) => a.technicianId && L.techById[a.technicianId]?.status !== "Activo").map((a) => [L.techById[a.technicianId]?.name, a.type, a.code, L.techById[a.technicianId]?.status]), noSum: true,
    },
    retiradosConHerramientas: {
      title: "Técnicos retirados con herramientas asignadas", headers: ["Técnico", "Herramienta", "Código"],
      rows: () => db.assets.filter((a) => a.technicianId && L.techById[a.technicianId]?.status === "Retirado").map((a) => [L.techById[a.technicianId]?.name, a.type, a.code]), noSum: true,
    },
    vinipel: { title: "Control de vinipel (tasa de uso)", custom: true },
    stock: { title: "Stock actual de inventario", custom: true },
    asignacion: { title: "Asignación por técnico (servicios, movimientos y tiempo)", custom: true },
  };

  const rep = active ? reports[active] : null;
  const rows = rep && !rep.custom ? rep.rows() : [];
  const total = rep && !rep.noSum && !rep.custom ? rows.reduce((s, r) => s + (Number(r[r.length - 1]) || 0), 0) : null;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 10, marginBottom: 18 }}>
        {Object.entries(reports).map(([key, r]) => (
          <div key={key} className="amg-card" style={{ padding: 14, cursor: "pointer", borderColor: active === key ? "var(--accent)" : undefined }} onClick={() => setActive(key)}>
            <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>{key === "vinipel" && <Gauge size={14} color="var(--accent)" />}{key === "stock" && <Boxes size={14} color="var(--accent)" />}{key === "asignacion" && <MapPin size={14} color="var(--accent)" />}{r.title}</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Ver reporte →</div>
          </div>
        ))}
      </div>

      {rep && active === "vinipel" && <ControlVinipel db={db} />}
      {rep && active === "stock" && <StockActual db={db} />}
      {rep && active === "asignacion" && <ReporteAsignacion db={db} />}

      {rep && !rep.custom && (
        <div className="amg-card" style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 600 }}>{rep.title}</div>
            <button className="amg-btn" onClick={() => downloadCSV(`${active}.csv`, rep.headers, rows.map((r) => r.map((v) => typeof v === "number" ? v : v)))}><Download size={14} /> Exportar CSV</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="amg-table">
              <thead><tr>{rep.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>{r.map((v, j) => <td key={j} className={typeof v === "number" ? "amg-mono" : ""}>{typeof v === "number" ? fmtCOP(v) : (v ?? "-")}</td>)}</tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={rep.headers.length} style={{ color: "var(--text-faint)", textAlign: "center", padding: 16 }}>Sin datos.</td></tr>}
              </tbody>
              {total !== null && <tfoot><tr><td style={{ fontWeight: 700 }}>Total</td>
                {rep.headers.slice(1).map((h, k) => <td key={h} className="amg-mono" style={{ fontWeight: 700, color: "var(--accent)" }}>{fmtCOP(rows.reduce((s, r) => s + (Number(r[k + 1]) || 0), 0))}</td>)}
              </tr></tfoot>}
            </table>
          </div>
          {rep.note && <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>{rep.note}</div>}
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>El histórico individual detallado de cada técnico está disponible en su perfil, dentro del módulo Técnicos.</div>
    </div>
  );
}

// Resumen de lo asignado desde el módulo de Asignación, ya guardado en Carga.
function ReporteAsignacion({ db }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [depto, setDepto] = useState("");
  const [byDay, setByDay] = useState(true);
  const deptos = useMemo(() => Array.from(new Set(db.technicians.map((t) => t.department).filter(Boolean))).sort(), [db.technicians]);
  const rows = useMemo(() => assignmentReport(db.services, db.technicians, { from, to, depto, byDay }), [db.services, db.technicians, from, to, depto, byDay]);
  const tot = rows.reduce((a, r) => ({ s: a.s + r.servicios, m: a.m + r.movimientos, p: a.p + r.productos, min: a.min + r.minutos, rea: a.rea + r.realizados }), { s: 0, m: 0, p: 0, min: 0, rea: 0 });
  const exportCSV = () => downloadCSV("asignacion_por_tecnico.csv",
    [...(byDay ? ["Fecha"] : []), "Técnico", "Departamento", "Servicios", "Movimientos (direcciones)", "Productos", "Minutos de producto", "Productos realizados"],
    rows.map((r) => [...(byDay ? [fmtDate(r.date)] : []), r.name, r.depto, r.servicios, r.movimientos, r.productos, r.minutos, r.realizados]));
  return (
    <div className="amg-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 600 }}>Asignación por técnico</div>
        <input type="date" className="amg-input" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="amg-input" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="amg-select" style={{ width: 180 }} value={depto} onChange={(e) => setDepto(e.target.value)}>
          <option value="">Todos los departamentos</option>{deptos.map((d) => <option key={d}>{d}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}><input type="checkbox" checked={byDay} onChange={(e) => setByDay(e.target.checked)} /> Separar por día</label>
        <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr>{byDay && <th>Fecha</th>}<th>Técnico</th><th>Departamento</th><th>Servicios</th><th>Movimientos</th><th>Productos</th><th>Minutos de producto</th><th>Productos realizados</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.date}|${r.techId}`}>
                {byDay && <td className="amg-mono">{fmtDate(r.date)}</td>}
                <td>{r.name}</td><td>{r.depto || "-"}</td>
                <td className="amg-mono">{r.servicios}</td><td className="amg-mono">{r.movimientos}</td><td className="amg-mono">{r.productos}</td>
                <td className="amg-mono">{r.minutos.toLocaleString("es-CO")}</td><td className="amg-mono">{r.realizados}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={byDay ? 8 : 7} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin servicios asignados para estos filtros. Aparecen cuando confirmas una asignación (En gestión) o se cierran como Realizados.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr>{byDay && <td></td>}<td style={{ fontWeight: 700 }}>Total</td><td></td>
              <td className="amg-mono" style={{ fontWeight: 700 }}>{tot.s}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{tot.m}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{tot.p}</td>
              <td className="amg-mono" style={{ fontWeight: 700 }}>{tot.min.toLocaleString("es-CO")}</td><td className="amg-mono" style={{ fontWeight: 700 }}>{tot.rea}</td></tr></tfoot>
          )}
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>Movimientos = direcciones distintas atendidas el mismo día (varios productos en la misma dirección cuentan como un movimiento). Minutos de producto = tiempo de armado de los productos asignados.</div>
    </div>
  );
}

function ControlVinipel({ db }) {
  const L = useLookups(db);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const vinipelSub = db.subcategories.find((s) => normalize(s.name) === "vinipel");
  const services = db.services || [];

  const inRange = (d) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);

  const rows = useMemo(() => {
    if (!vinipelSub) return [];
    return db.technicians.map((t) => {
      const rollos = (db.stockMovements || [])
        .filter((m) => m.type === "Entrega" && m.technicianId === t.id && m.subcategoryId === vinipelSub.id && inRange(m.date))
        .reduce((s, m) => s + m.quantity, 0);
      const trabajosRealizados = services
        .filter((s) => s.technicianId === t.id && inRange(s.date) && trabajoCuenta(s))
        .reduce((s, r) => s + r.quantity, 0);
      const tasa = trabajosRealizados > 0 ? rollos / trabajosRealizados : (rollos > 0 ? null : 0);
      return { tech: t, rollos, trabajosRealizados, tasa };
    }).filter((r) => r.rollos > 0 || r.trabajosRealizados > 0);
  }, [db, dateFrom, dateTo, vinipelSub, services]);

  const tasasValidas = rows.filter((r) => r.tasa !== null).map((r) => r.tasa);
  const promedioTasa = tasasValidas.length ? tasasValidas.reduce((a, b) => a + b, 0) / tasasValidas.length : 0;

  const exportCSV = () => downloadCSV("control_vinipel.csv",
    ["Técnico", "Rollos de vinipel entregados", "Trabajos realizados", "Tasa (rollos por trabajo)"],
    rows.map((r) => [r.tech.name, r.rollos, r.trabajosRealizados, r.tasa === null ? "Sin trabajos registrados" : r.tasa.toFixed(2)])
  );

  const chartData = rows.filter((r) => r.tasa !== null).sort((a, b) => b.tasa - a.tasa).slice(0, 10)
    .map((r) => ({ name: r.tech.name, tasa: Number(r.tasa.toFixed(2)) }));

  if (!vinipelSub) {
    return <div className="amg-card" style={{ padding: 16, color: "var(--text-faint)", fontSize: 13 }}>No se encontró la subcategoría "Vinipel". Verifica el módulo de Categorías.</div>;
  }

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Periodo:</div>
        <input type="date" className="amg-input" style={{ width: 150 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" className="amg-input" style={{ width: 150 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <button className="amg-btn ghost" onClick={() => { setDateFrom(""); setDateTo(""); }}>Limpiar</button>
        <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
      </div>

      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 14, lineHeight: 1.6 }}>
        Tasa de uso = rollos de vinipel <b>entregados</b> (registrados en Inventario → Entregas) ÷ trabajos realizados por el técnico en el periodo (Desarme/Empaque cuentan solo si quedaron armados; N.A.N cuenta siempre). Las compras de stock no afectan este cálculo, solo lo que efectivamente se entregó a cada técnico. Una tasa muy por encima del promedio ({promedioTasa.toFixed(2)} rollos/trabajo) puede indicar sobreconsumo, desperdicio o pérdida de material.
      </div>

      {chartData.length > 0 && (
        <ChartPanel title="Top 10 técnicos por tasa de uso (rollos por trabajo)">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E3D8C4" />
              <XAxis type="number" tick={{ fill: "#6B5D4D", fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fill: "#6B5D4D", fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "#F7F1E4", border: "1px solid #E3D8C4" }} />
              <Bar dataKey="tasa" radius={[0, 3, 3, 0]}>
                {chartData.map((r, i) => <Cell key={i} fill={r.tasa > promedioTasa * 1.3 ? "#D9534F" : "#D98D34"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      )}

      <div className="amg-card" style={{ marginTop: 14, overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Técnico</th><th>Rollos entregados</th><th>Trabajos realizados</th><th>Tasa (rollos/trabajo)</th><th></th></tr></thead>
          <tbody>
            {rows.sort((a, b) => (b.tasa ?? -1) - (a.tasa ?? -1)).map((r) => {
              const alerta = r.tasa !== null && r.tasa > promedioTasa * 1.3 && promedioTasa > 0;
              return (
                <tr key={r.tech.id}>
                  <td>{r.tech.name}</td>
                  <td className="amg-mono">{r.rollos}</td>
                  <td className="amg-mono">{r.trabajosRealizados}</td>
                  <td className="amg-mono">{r.tasa === null ? "—" : r.tasa.toFixed(2)}</td>
                  <td>{alerta && <Badge text="Por encima del promedio" color="red" />}{r.tasa === null && r.rollos > 0 && <Badge text="Sin trabajos registrados" color="amber" />}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin datos de vinipel o trabajos en este periodo.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function groupSum(expenses, field, mapper) {
  const m = {};
  expenses.forEach((e) => { const key = mapper ? mapper(e[field]) : e[field]; m[key] = (m[key] || 0) + e.totalValue; });
  return m;
}

/* ============================================================================
   CONFIGURACIÓN
============================================================================ */

function Configuracion({ db, session }) {
  const L = useLookups(db);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 800 }}>
      <div className="amg-card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Entorno de producción</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>
          Esta instancia está conectada a un proyecto real de Supabase (PostgreSQL) con autenticación y permisos por rol aplicados en la base de datos (Row Level Security). Los datos maestros y de ejemplo se gestionan mediante los scripts SQL del proyecto, no desde esta pantalla.
        </div>
      </div>

      <div className="amg-card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Resumen de datos</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{db.technicians.length} técnicos · {db.categories.length} categorías · {db.subcategories.length} subcategorías · {db.expenses.length} movimientos · {db.assets.length} activos · {(db.services || []).length} servicios · {(db.stockMovements || []).length} movimientos de inventario · {db.users.length} usuarios.</div>
      </div>

      {session.role === "admin" && (
        <div className="amg-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Registro de auditoría</div>
          <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }} className="amg-scroll">
            <table className="amg-table">
              <thead><tr><th>Fecha</th><th>Hora</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Valor anterior</th><th>Valor nuevo</th></tr></thead>
              <tbody>
                {db.auditLog.map((l) => (
                  <tr key={l.id}><td className="amg-mono">{fmtDate(l.date)}</td><td className="amg-mono">{l.time}</td><td>{L.userById[l.userId]?.name || l.userId}</td><td>{l.action}</td><td className="amg-mono" style={{ fontSize: 11 }}>{l.record}</td><td>{l.oldValue}</td><td>{l.newValue}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
