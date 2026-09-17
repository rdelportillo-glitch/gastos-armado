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
  ListChecks, Gauge, Boxes, PackagePlus, PackageMinus,
} from "lucide-react";

import { supabase } from "./lib/supabaseClient";
import * as api from "./lib/api";
import { DEPARTAMENTOS_CO, CITIES_BY_DEPARTMENT } from "./lib/colombiaData";

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

function stockDisponible(db, subcategoryId) {
  const movs = (db.stockMovements || []).filter((m) => m.subcategoryId === subcategoryId);
  const comprado = movs.filter((m) => m.type === "Compra").reduce((s, m) => s + m.quantity, 0);
  const entregado = movs.filter((m) => m.type === "Entrega").reduce((s, m) => s + m.quantity, 0);
  return comprado - entregado;
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
      border: 1px solid var(--border); border-radius: 6px; z-index: 50; max-height: 240px; overflow-y: auto;
      box-shadow: 0 8px 24px rgba(46,38,32,0.15);
    }
    .amg-searchselect-opt { padding: 8px 10px; font-size: 13px; cursor: pointer; }
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

function SearchSelect({ options, value, onChange, placeholder = "Seleccionar...", disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
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

const NAV_ITEMS = [
  { key: "dashboard", label: "Inicio / Dashboard", icon: LayoutDashboard, roles: ["admin", "operador", "consulta"] },
  { key: "registrar", label: "Registrar gasto", icon: FilePlus2, roles: ["admin", "operador"] },
  { key: "historial", label: "Historial de gastos", icon: History, roles: ["admin", "operador", "consulta"] },
  { key: "tecnicos", label: "Personal", icon: HardHat, roles: ["admin", "operador", "consulta"] },
  { key: "servicios", label: "Servicios realizados", icon: ListChecks, roles: ["admin", "operador", "consulta"] },
  { key: "inventario", label: "Inventario", icon: Boxes, roles: ["admin", "operador", "consulta"] },
  { key: "categorias", label: "Categorías y subcategorías", icon: FolderTree, roles: ["admin", "operador", "consulta"] },
  { key: "productos", label: "Productos / elementos", icon: Package, roles: ["admin", "operador", "consulta"] },
  { key: "usuarios", label: "Usuarios", icon: UserCog, roles: ["admin"] },
  { key: "reportes", label: "Reportes", icon: BarChart3, roles: ["admin", "operador", "consulta"] },
  { key: "configuracion", label: "Configuración", icon: Settings, roles: ["admin"] },
];

export default function App() {
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [view, setView] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
          {navAllowed.map((n) => (
            <div key={n.key} className={`amg-nav-item ${view === n.key || (n.key === "tecnicos" && view === "tecnico-perfil") ? "active" : ""}`}
              onClick={() => { setView(n.key); setSidebarOpen(false); }}>
              <n.icon size={16} /> {n.label}
            </div>
          ))}
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
  const prodOptions = db.products.filter((p) => p.active && p.subcategoryId === form.subcategoryId).map((p) => ({ value: p.id, label: p.name }));

  const total = (parseFloat(form.quantity) || 0) * (parseFloat(form.unitValue) || 0);
  const selectedTech = db.technicians.find((t) => t.id === form.technicianId);
  const selectedSub = db.subcategories.find((s) => s.id === form.subcategoryId);
  const selectedProd = db.products.find((p) => p.id === form.productId);
  const bloqueadoPorInventario = !!selectedSub?.trackStock;

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
    setSaved(true);
    reset(again);
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
            "{selectedSub.name}" controla inventario: la compra y la entrega a un técnico se registran por separado en el módulo Inventario, no aquí.
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
          <label className="amg-label">Producto / concepto</label>
          {!form.manualMode ? (
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}><SearchSelect options={prodOptions} value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} placeholder="Seleccionar producto" disabled={!form.subcategoryId} /></div>
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

  const canAnnul = (e) => session.role === "admin" || (session.role === "operador" && e.responsibleUserId === session.id && e.status === "Activo");

  const confirmAnnul = () => {
    if (!annulReason.trim()) return;
    const next = { ...db, expenses: db.expenses.map((e) => e.id === annulTarget.id ? { ...e, status: "Anulado", annulReason, annulUserId: session.id, annulDate: todayISO() } : e) };
    const withAudit = addAudit(next, { userId: session.id, action: "Anulación de movimiento", record: annulTarget.id, oldValue: "Activo", newValue: `Anulado: ${annulReason}` });
    persist(withAudit);
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
                  : <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>Compra de stock</span>}</td>
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
  const canEdit = session.role === "admin";

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
  );

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
          <thead><tr><th>Código</th><th>Nombre</th><th>Categoría</th><th>Departamento</th><th>Ciudad</th><th>Cargo</th><th>Estado</th><th>Gasto acumulado</th><th></th></tr></thead>
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
                  {canEdit && t.status === "Activo" && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setConfirmAction({ tech: t, to: "Inactivo" })}><CircleDot size={14} color="var(--text-dim)" /></button>}
                  {canEdit && t.status === "Inactivo" && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setConfirmAction({ tech: t, to: "Activo" })}><RotateCcw size={14} color="var(--green)" /></button>}
                  {canEdit && t.status !== "Retirado" && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setConfirmAction({ tech: t, to: "Retirado" })}><Ban size={14} color="var(--red)" /></button>}
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
  });
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
      <div style={{ marginTop: 12 }}><label className="amg-label">Observaciones</label><textarea className="amg-textarea" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
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
  const serviciosRealizados = (db.services || []).filter((s) => s.technicianId === techId).reduce((s, r) => s + r.quantity, 0);
  const tasaVinipel = serviciosRealizados > 0 ? rollosVinipel / serviciosRealizados : null;

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
        {vinipelSub && (rollosVinipel > 0 || serviciosRealizados > 0) && (
          <StatCard label="Tasa de uso de vinipel" value={tasaVinipel === null ? "—" : `${tasaVinipel.toFixed(2)} rollos/servicio`} sub={`${rollosVinipel} rollos · ${serviciosRealizados} servicios`} />
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
   SERVICIOS REALIZADOS (para calcular tasas de uso de insumos)
============================================================================ */

const SERVICE_TYPES = ["Instalación", "Mantenimiento", "Reparación", "Reconexión", "Otro"];

function Servicios({ db, persist, addAudit, session, onGoTech }) {
  const [tab, setTab] = useState("registrar");
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        <div className={`amg-tab ${tab === "registrar" ? "active" : ""}`} onClick={() => setTab("registrar")}>Registrar servicio</div>
        <div className={`amg-tab ${tab === "historial" ? "active" : ""}`} onClick={() => setTab("historial")}>Historial de servicios</div>
      </div>
      {tab === "registrar"
        ? <RegistrarServicio db={db} persist={persist} addAudit={addAudit} session={session} />
        : <HistorialServicios db={db} onGoTech={onGoTech} />}
    </div>
  );
}

function RegistrarServicio({ db, persist, addAudit, session }) {
  const blank = { date: todayISO(), technicianId: "", serviceType: SERVICE_TYPES[0], quantity: 1, observation: "" };
  const [form, setForm] = useState(blank);
  const [saved, setSaved] = useState(false);
  const techOptions = db.technicians.filter((t) => t.status === "Activo").map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));
  const canSave = form.technicianId && form.serviceType && form.quantity > 0;

  const save = (again) => {
    const rec = {
      id: uid("srv"), date: form.date, technicianId: form.technicianId, serviceType: form.serviceType,
      quantity: parseFloat(form.quantity), observation: form.observation, responsibleUserId: session.id, createdAt: new Date().toISOString(),
    };
    let next = { ...db, services: [rec, ...(db.services || [])] };
    next = addAudit(next, { userId: session.id, action: "Registro de servicio realizado", record: rec.id, oldValue: "-", newValue: `${rec.quantity} × ${rec.serviceType}` });
    persist(next);
    setSaved(true);
    setForm(again ? { ...blank, technicianId: form.technicianId, serviceType: form.serviceType, date: form.date } : blank);
  };

  return (
    <div style={{ maxWidth: 560 }}>
      {saved && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)" }}><Check size={15} /> Servicio registrado correctamente.</div>}
      <div className="amg-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div><label className="amg-label">Técnico</label><SearchSelect options={techOptions} value={form.technicianId} onChange={(v) => setForm({ ...form, technicianId: v })} placeholder="Buscar técnico..." /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div><label className="amg-label">Tipo de servicio</label>
            <select className="amg-select" value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })}>
              {SERVICE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label className="amg-label">Cantidad realizada</label><input type="number" min="1" className="amg-input" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
        </div>
        <div><label className="amg-label">Observación (opcional)</label><textarea className="amg-textarea" rows={2} value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></div>
        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Responsable del registro: <b style={{ color: "var(--text-dim)" }}>{session.name}</b></div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <button className="amg-btn" onClick={() => setForm(blank)}>Cancelar</button>
          <button className="amg-btn primary" disabled={!canSave} onClick={() => save(false)}>Guardar servicio</button>
          <button className="amg-btn" disabled={!canSave} onClick={() => save(true)}>Guardar y registrar otro</button>
        </div>
      </div>
    </div>
  );
}

function HistorialServicios({ db, onGoTech }) {
  const L = useLookups(db);
  const [techId, setTechId] = useState("");
  const [tipo, setTipo] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const services = db.services || [];

  const rows = services.filter((s) =>
    (!techId || s.technicianId === techId) &&
    (!tipo || s.serviceType === tipo) &&
    (!dateFrom || s.date >= dateFrom) &&
    (!dateTo || s.date <= dateTo)
  ).sort((a, b) => b.date.localeCompare(a.date));

  const exportCSV = () => downloadCSV("historial_servicios.csv",
    ["Fecha", "Técnico", "Tipo de servicio", "Cantidad", "Responsable", "Observación"],
    rows.map((s) => [fmtDate(s.date), L.techById[s.technicianId]?.name, s.serviceType, s.quantity, L.userById[s.responsibleUserId]?.name, s.observation])
  );

  return (
    <div>
      <div className="amg-card" style={{ padding: 12, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ minWidth: 200 }}><SearchSelect options={[{ value: "", label: "Todos los técnicos" }, ...db.technicians.map((t) => ({ value: t.id, label: t.name, sublabel: t.code }))]} value={techId} onChange={setTechId} placeholder="Todos los técnicos" /></div>
        <select className="amg-select" style={{ width: 170 }} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos los tipos</option>{SERVICE_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input type="date" className="amg-input" style={{ width: 150 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" className="amg-input" style={{ width: 150 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Fecha</th><th>Técnico</th><th>Tipo</th><th>Cantidad</th><th>Responsable</th><th>Observación</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="amg-mono">{fmtDate(s.date)}</td>
                <td><span style={{ cursor: "pointer", color: "var(--accent)" }} onClick={() => onGoTech(s.technicianId)}>{L.techById[s.technicianId]?.name}</span></td>
                <td>{s.serviceType}</td>
                <td className="amg-mono">{s.quantity}</td>
                <td>{L.userById[s.responsibleUserId]?.name}</td>
                <td>{s.observation}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin servicios registrados para estos filtros.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-dim)" }}>{rows.length} registros · Total unidades: <b className="amg-mono">{rows.reduce((s, r) => s + r.quantity, 0)}</b></div>
    </div>
  );
}

/* ============================================================================
   INVENTARIO (compras vs. entregas de insumos controlados, p. ej. Vinipel)
============================================================================ */

function Inventario({ db, persist, addAudit, session }) {
  const [tab, setTab] = useState("stock");
  const canWrite = session.role === "admin" || session.role === "operador";
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 16, flexWrap: "wrap" }}>
        <div className={`amg-tab ${tab === "stock" ? "active" : ""}`} onClick={() => setTab("stock")}>Stock actual</div>
        <div className={`amg-tab ${tab === "compras" ? "active" : ""}`} onClick={() => setTab("compras")}>Compras (entradas)</div>
        <div className={`amg-tab ${tab === "entregas" ? "active" : ""}`} onClick={() => setTab("entregas")}>Entregas a técnicos (salidas)</div>
      </div>
      {tab === "stock" && <StockActual db={db} />}
      {tab === "compras" && <MovimientosCompras db={db} persist={persist} addAudit={addAudit} session={session} canWrite={canWrite} />}
      {tab === "entregas" && <MovimientosEntregas db={db} persist={persist} addAudit={addAudit} session={session} canWrite={canWrite} />}
    </div>
  );
}

function StockActual({ db }) {
  const L = useLookups(db);
  const subs = db.subcategories.filter((s) => s.trackStock);
  const rows = subs.map((s) => {
    const comprado = (db.stockMovements || []).filter((m) => m.type === "Compra" && m.subcategoryId === s.id).reduce((a, m) => a + m.quantity, 0);
    const entregado = (db.stockMovements || []).filter((m) => m.type === "Entrega" && m.subcategoryId === s.id).reduce((a, m) => a + m.quantity, 0);
    return { sub: s, comprado, entregado, disponible: comprado - entregado };
  });
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
        {rows.map((r) => (
          <StatCard key={r.sub.id} label={r.sub.name} value={r.disponible} sub={`${r.comprado} comprados · ${r.entregado} entregados`} accent={r.disponible <= 5} />
        ))}
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Insumo</th><th>Categoría</th><th>Comprado (total)</th><th>Entregado (total)</th><th>Stock disponible</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sub.id}>
                <td>{r.sub.name}</td>
                <td>{L.catById[r.sub.categoryId]?.name}</td>
                <td className="amg-mono">{r.comprado}</td>
                <td className="amg-mono">{r.entregado}</td>
                <td className="amg-mono" style={{ fontWeight: 700, color: r.disponible <= 5 ? "var(--red)" : "var(--text)" }}>{r.disponible}</td>
                <td>{r.disponible <= 5 && <Badge text="Stock bajo" color="red" />}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>
                Ninguna subcategoría tiene activado "Controla inventario" todavía. Actívalo desde Categorías y subcategorías.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MovimientosCompras({ db, persist, addAudit, session, canWrite }) {
  const L = useLookups(db);
  const stockSubs = db.subcategories.filter((s) => s.trackStock && s.active);
  const blank = { date: todayISO(), subcategoryId: stockSubs[0]?.id || "", productId: "", supplier: "", quantity: 1, unitCost: "", observation: "" };
  const [form, setForm] = useState(blank);
  const [saved, setSaved] = useState(false);
  const prodOptions = db.products.filter((p) => p.active && p.subcategoryId === form.subcategoryId).map((p) => ({ value: p.id, label: p.name }));
  const canSave = form.subcategoryId && parseFloat(form.quantity) > 0 && form.unitCost !== "" && parseFloat(form.unitCost) >= 0;
  const totalCosto = (parseFloat(form.quantity) || 0) * (parseFloat(form.unitCost) || 0);

  const save = () => {
    const sub = db.subcategories.find((s) => s.id === form.subcategoryId);
    const mov = {
      id: uid("stk"), type: "Compra", date: form.date, subcategoryId: form.subcategoryId, productId: form.productId || null,
      quantity: parseFloat(form.quantity), technicianId: null, unitCost: parseFloat(form.unitCost), supplier: form.supplier,
      observation: form.observation, responsibleUserId: session.id, createdAt: new Date().toISOString(),
    };
    // La compra sí es dinero real de la compañía: también queda como gasto general (sin técnico).
    const exp = {
      id: uid("e"), date: form.date, technicianId: null, categoryId: sub.categoryId, subcategoryId: form.subcategoryId,
      productId: form.productId || null, conceptManual: `Compra de stock${form.supplier ? " — " + form.supplier : ""}`,
      quantity: mov.quantity, unitValue: mov.unitCost, totalValue: mov.quantity * mov.unitCost, observation: form.observation,
      responsibleUserId: session.id, status: "Activo", annulReason: "", annulUserId: "", annulDate: "", createdAt: new Date().toISOString(),
    };
    let next = { ...db, stockMovements: [mov, ...(db.stockMovements || [])], expenses: [exp, ...db.expenses] };
    next = addAudit(next, { userId: session.id, action: "Compra de stock", record: mov.id, oldValue: "-", newValue: `${mov.quantity} × ${sub.name} — ${fmtCOP(exp.totalValue)}` });
    persist(next);
    setSaved(true);
    setForm({ ...blank, subcategoryId: form.subcategoryId });
  };

  const historial = (db.stockMovements || []).filter((m) => m.type === "Compra").sort((a, b) => b.date.localeCompare(a.date));
  const exportCSV = () => downloadCSV("compras_stock.csv",
    ["Fecha", "Insumo", "Proveedor", "Cantidad", "Costo unitario", "Total", "Responsable"],
    historial.map((m) => [fmtDate(m.date), L.subById[m.subcategoryId]?.name, m.supplier, m.quantity, m.unitCost, m.quantity * m.unitCost, L.userById[m.responsibleUserId]?.name])
  );

  if (stockSubs.length === 0) {
    return <div className="amg-card" style={{ padding: 16, color: "var(--text-faint)", fontSize: 13 }}>No hay subcategorías con "Controla inventario" activado. Actívalo desde Categorías y subcategorías.</div>;
  }

  return (
    <div>
      {canWrite && (
        <div className="amg-card" style={{ padding: 20, marginBottom: 16, maxWidth: 620 }}>
          {saved && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)", marginBottom: 12 }}><Check size={15} /> Compra registrada. El stock disponible ya se actualizó.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><label className="amg-label">Insumo</label>
              <select className="amg-select" value={form.subcategoryId} onChange={(e) => setForm({ ...form, subcategoryId: e.target.value, productId: "" })}>
                {stockSubs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div><label className="amg-label">Producto (opcional)</label><SearchSelect options={prodOptions} value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} placeholder="Sin especificar" /></div>
            <div><label className="amg-label">Proveedor (opcional)</label><input className="amg-input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
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
          <thead><tr><th>Fecha</th><th>Insumo</th><th>Proveedor</th><th>Cantidad</th><th>Costo unitario</th><th>Total</th><th>Responsable</th></tr></thead>
          <tbody>
            {historial.map((m) => (
              <tr key={m.id}>
                <td className="amg-mono">{fmtDate(m.date)}</td><td>{L.subById[m.subcategoryId]?.name}</td><td>{m.supplier || "-"}</td>
                <td className="amg-mono">{m.quantity}</td><td className="amg-mono">{fmtCOP(m.unitCost)}</td>
                <td className="amg-mono" style={{ fontWeight: 600 }}>{fmtCOP(m.quantity * m.unitCost)}</td><td>{L.userById[m.responsibleUserId]?.name}</td>
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin compras registradas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MovimientosEntregas({ db, persist, addAudit, session, canWrite }) {
  const L = useLookups(db);
  const stockSubs = db.subcategories.filter((s) => s.trackStock && s.active);
  const blank = { date: todayISO(), subcategoryId: stockSubs[0]?.id || "", productId: "", technicianId: "", quantity: 1, observation: "" };
  const [form, setForm] = useState(blank);
  const [saved, setSaved] = useState(false);
  const techOptions = db.technicians.filter((t) => t.status === "Activo").map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));
  const prodOptions = db.products.filter((p) => p.active && p.subcategoryId === form.subcategoryId).map((p) => ({ value: p.id, label: p.name }));
  const disponible = stockDisponible(db, form.subcategoryId);
  const cantidad = parseFloat(form.quantity) || 0;
  const excedeStock = cantidad > disponible;
  const canSave = form.subcategoryId && form.technicianId && cantidad > 0 && !excedeStock;

  const save = () => {
    const sub = db.subcategories.find((s) => s.id === form.subcategoryId);
    const tech = db.technicians.find((t) => t.id === form.technicianId);
    const mov = {
      id: uid("stk"), type: "Entrega", date: form.date, subcategoryId: form.subcategoryId, productId: form.productId || null,
      quantity: cantidad, technicianId: form.technicianId, unitCost: null, supplier: "",
      observation: form.observation, responsibleUserId: session.id, createdAt: new Date().toISOString(),
    };
    let next = { ...db, stockMovements: [mov, ...(db.stockMovements || [])] };
    next = addAudit(next, { userId: session.id, action: "Entrega de insumo a técnico", record: mov.id, oldValue: "-", newValue: `${mov.quantity} × ${sub.name} → ${tech.name}` });
    persist(next);
    setSaved(true);
    setForm({ ...blank, subcategoryId: form.subcategoryId });
  };

  const historial = (db.stockMovements || []).filter((m) => m.type === "Entrega").sort((a, b) => b.date.localeCompare(a.date));
  const exportCSV = () => downloadCSV("entregas_stock.csv",
    ["Fecha", "Insumo", "Técnico", "Cantidad", "Responsable", "Observación"],
    historial.map((m) => [fmtDate(m.date), L.subById[m.subcategoryId]?.name, L.techById[m.technicianId]?.name, m.quantity, L.userById[m.responsibleUserId]?.name, m.observation])
  );

  if (stockSubs.length === 0) {
    return <div className="amg-card" style={{ padding: 16, color: "var(--text-faint)", fontSize: 13 }}>No hay subcategorías con "Controla inventario" activado. Actívalo desde Categorías y subcategorías.</div>;
  }

  return (
    <div>
      {canWrite && (
        <div className="amg-card" style={{ padding: 20, marginBottom: 16, maxWidth: 620 }}>
          {saved && <div className="amg-alert" style={{ background: "rgba(63,157,110,0.1)", border: "1px solid rgba(63,157,110,0.3)", color: "var(--green)", marginBottom: 12 }}><Check size={15} /> Entrega registrada. No se generó un nuevo gasto — el costo ya quedó cubierto en la compra.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div><label className="amg-label">Fecha</label><input type="date" className="amg-input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div><label className="amg-label">Insumo</label>
              <select className="amg-select" value={form.subcategoryId} onChange={(e) => setForm({ ...form, subcategoryId: e.target.value, productId: "" })}>
                {stockSubs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div><label className="amg-label">Técnico</label><SearchSelect options={techOptions} value={form.technicianId} onChange={(v) => setForm({ ...form, technicianId: v })} placeholder="Buscar técnico activo..." /></div>
            <div><label className="amg-label">Producto (opcional)</label><SearchSelect options={prodOptions} value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} placeholder="Sin especificar" /></div>
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
        <button className="amg-btn" onClick={exportCSV}><Download size={14} /> Exportar CSV</button>
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Fecha</th><th>Insumo</th><th>Técnico</th><th>Cantidad</th><th>Responsable</th><th>Observación</th></tr></thead>
          <tbody>
            {historial.map((m) => (
              <tr key={m.id}>
                <td className="amg-mono">{fmtDate(m.date)}</td><td>{L.subById[m.subcategoryId]?.name}</td><td>{L.techById[m.technicianId]?.name}</td>
                <td className="amg-mono">{m.quantity}</td><td>{L.userById[m.responsibleUserId]?.name}</td><td>{m.observation}</td>
              </tr>
            ))}
            {historial.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin entregas registradas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
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
        <div className={`amg-tab ${tab === "catalogo" ? "active" : ""}`} onClick={() => setTab("catalogo")}>Catálogo de productos</div>
        <div className={`amg-tab ${tab === "activos" ? "active" : ""}`} onClick={() => setTab("activos")}>Activos y herramientas</div>
      </div>
      {tab === "catalogo" ? <CatalogoProductos db={db} persist={persist} session={session} /> : <ActivosHerramientas db={db} persist={persist} addAudit={addAudit} session={session} onGoTech={onGoTech} />}
    </div>
  );
}

function CatalogoProductos({ db, persist, session }) {
  const [modal, setModal] = useState(null);
  const canEdit = session.role === "admin";
  const L = useLookups(db);

  const save = (data) => {
    let next;
    if (data.id) next = { ...db, products: db.products.map((p) => p.id === data.id ? data : p) };
    else next = { ...db, products: [...db.products, { ...data, id: uid("p") }] };
    persist(next); setModal(null);
  };
  const toggle = (p) => persist({ ...db, products: db.products.map((x) => x.id === p.id ? { ...x, active: !x.active } : x) });

  return (
    <div>
      {canEdit && <button className="amg-btn primary" style={{ marginBottom: 12 }} onClick={() => setModal({})}><Plus size={14} /> Nuevo producto</button>}
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Producto</th><th>Subcategoría</th><th>Categoría</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {db.products.map((p) => {
              const sub = L.subById[p.subcategoryId];
              return (
                <tr key={p.id}>
                  <td>{p.name}</td><td>{sub?.name}</td><td>{L.catById[sub?.categoryId]?.name}</td>
                  <td><Badge text={p.active ? "Activo" : "Inactivo"} color={p.active ? "green" : "gray"} /></td>
                  <td style={{ display: "flex", gap: 4 }}>
                    {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setModal(p)}><Pencil size={13} /></button>}
                    {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => toggle(p)}>{p.active ? <Ban size={13} color="var(--red)" /> : <RotateCcw size={13} color="var(--green)" />}</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {modal !== null && <ProductoModal data={modal} subcategories={db.subcategories} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

function ProductoModal({ data, subcategories, onSave, onClose }) {
  const [f, setF] = useState({ id: data.id || null, subcategoryId: data.subcategoryId || "", name: data.name || "", active: data.active !== false });
  return (
    <Modal title={f.id ? "Editar producto" : "Nuevo producto"} onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!f.name || !f.subcategoryId} onClick={() => onSave(f)}>Guardar</button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label className="amg-label">Subcategoría</label>
          <select className="amg-select" value={f.subcategoryId} onChange={(e) => setF({ ...f, subcategoryId: e.target.value })}>
            <option value="">Seleccionar...</option>{subcategories.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><label className="amg-label">Nombre del producto / elemento</label><input className="amg-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      </div>
    </Modal>
  );
}

const ASSET_STATES = ["Disponible", "Asignado", "En reparación", "Dañado", "Perdido", "Dado de baja"];

function ActivosHerramientas({ db, persist, addAudit, session, onGoTech }) {
  const [modal, setModal] = useState(null);
  const [typesModal, setTypesModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const canEdit = session.role === "admin" || session.role === "operador";
  const L = useLookups(db);
  const techActivosOpts = db.technicians.filter((t) => t.status === "Activo").map((t) => ({ value: t.id, label: t.name, sublabel: t.code }));

  const save = (data) => {
    let next;
    if (data.id) next = { ...db, assets: db.assets.map((a) => a.id === data.id ? data : a) };
    else next = { ...db, assets: [...db.assets, { ...data, id: uid("a"), history: [] }] };
    persist(next); setModal(null);
  };

  const assign = (asset, techId) => {
    const conflict = db.assets.find((a) => a.id !== asset.id && a.technicianId === techId && a.status === "Asignado" && a.type === asset.type);
    const next0 = {
      ...db,
      assets: db.assets.map((a) => a.id === asset.id ? {
        ...a, technicianId: techId, deliveryDate: todayISO(), status: "Asignado",
        history: [...a.history, { technicianId: techId, from: todayISO(), to: "", userId: session.id }],
      } : a),
    };
    const next = addAudit(next0, { userId: session.id, action: "Asignación de herramienta", record: asset.id, oldValue: asset.technicianId ? L.techById[asset.technicianId]?.name : "Disponible", newValue: L.techById[techId]?.name });
    persist(next);
    setAssignTarget(null);
    if (conflict) alert(`Aviso: esta herramienta ya estaba asignada a otro técnico; el registro anterior queda en el historial.`);
  };

  const changeAssetStatus = (asset, status) => {
    const releasing = status !== "Asignado";
    const next0 = { ...db, assets: db.assets.map((a) => a.id === asset.id ? { ...a, status, technicianId: releasing ? null : a.technicianId } : a) };
    const next = addAudit(next0, { userId: session.id, action: "Cambio de estado de activo", record: asset.id, oldValue: asset.status, newValue: status });
    persist(next);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {canEdit && <button className="amg-btn primary" onClick={() => setModal({})}><Plus size={14} /> Nueva herramienta / activo</button>}
        {canEdit && <button className="amg-btn" onClick={() => setTypesModal(true)}><ListChecks size={14} /> Tipos de herramienta</button>}
      </div>
      <div className="amg-card" style={{ overflowX: "auto" }}>
        <table className="amg-table">
          <thead><tr><th>Código</th><th>Tipo</th><th>Marca/Modelo</th><th>Serial</th><th>Valor</th><th>Técnico asignado</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {db.assets.map((a) => {
              const tech = a.technicianId ? L.techById[a.technicianId] : null;
              return (
                <tr key={a.id}>
                  <td className="amg-mono">{a.code}</td><td>{a.type}</td><td>{a.brand} {a.model}</td><td className="amg-mono">{a.serial}</td><td className="amg-mono">{fmtCOP(a.value)}</td>
                  <td>{tech ? <span style={{ cursor: "pointer", color: "var(--accent)" }} onClick={() => onGoTech(tech.id)}>{tech.name}{tech.status === "Retirado" && <AlertTriangle size={12} style={{ marginLeft: 4 }} color="var(--red)" />}</span> : "-"}</td>
                  <td>
                    {canEdit ? (
                      <select className="amg-select" style={{ padding: "4px 6px", fontSize: 12 }} value={a.status} onChange={(e) => changeAssetStatus(a, e.target.value)}>
                        {ASSET_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <Badge text={a.status} color={statusColor(a.status)} />}
                  </td>
                  <td style={{ display: "flex", gap: 4 }}>
                    {canEdit && <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setAssignTarget(a)}>Asignar</button>}
                    <button className="amg-btn ghost" style={{ padding: 4 }} onClick={() => setHistoryTarget(a)}>Historial</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal !== null && <AssetModal data={modal} assetTypes={db.assetTypes || []} onSave={save} onManageTypes={() => setTypesModal(true)} onClose={() => setModal(null)} />}
      {typesModal && <AssetTypesModal db={db} persist={persist} onClose={() => setTypesModal(false)} />}
      {assignTarget && (
        <Modal title={`Asignar "${assignTarget.type}" (${assignTarget.code})`} onClose={() => setAssignTarget(null)}>
          <label className="amg-label">Técnico</label>
          <SearchSelect options={techActivosOpts} value="" onChange={(v) => assign(assignTarget, v)} placeholder="Buscar técnico activo..." />
        </Modal>
      )}
      {historyTarget && (
        <Modal title={`Historial de "${historyTarget.code}"`} onClose={() => setHistoryTarget(null)}>
          {historyTarget.history.length === 0 && <div style={{ color: "var(--text-faint)", fontSize: 13 }}>Sin historial de asignaciones.</div>}
          {historyTarget.history.map((h, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <b>{L.techById[h.technicianId]?.name}</b> · desde {fmtDate(h.from)} {h.to ? `hasta ${fmtDate(h.to)}` : "(vigente)"}
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}

function AssetModal({ data, assetTypes, onSave, onManageTypes, onClose }) {
  const [f, setF] = useState({
    id: data.id || null, code: data.code || "", type: data.type || "", brand: data.brand || "", model: data.model || "",
    serial: data.serial || "", value: data.value || "", purchaseDate: data.purchaseDate || todayISO(), status: data.status || "Disponible", technicianId: data.technicianId || null,
  });
  const activeTypes = assetTypes.filter((t) => t.active);
  return (
    <Modal title={f.id ? "Editar activo" : "Nuevo activo / herramienta"} onClose={onClose}
      footer={<><button className="amg-btn" onClick={onClose}>Cancelar</button><button className="amg-btn primary" disabled={!f.code || !f.type} onClick={() => onSave(f)}>Guardar</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label className="amg-label">Código interno</label><input className="amg-input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
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
      </div>
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
    tecnico: { title: "Gasto por técnico", headers: ["Técnico", "Total"], rows: () => Object.entries(groupSum(activeExp.filter((e) => e.technicianId), "technicianId")).map(([id, v]) => [L.techById[id]?.name, v]) },
    categoria: { title: "Gasto por categoría", headers: ["Categoría", "Total"], rows: () => Object.entries(groupSum(activeExp, "categoryId")).map(([id, v]) => [L.catById[id]?.name, v]) },
    subcategoria: { title: "Gasto por subcategoría", headers: ["Subcategoría", "Total"], rows: () => Object.entries(groupSum(activeExp, "subcategoryId")).map(([id, v]) => [L.subById[id]?.name, v]) },
    mes: { title: "Gasto por mes", headers: ["Mes", "Total"], rows: () => Object.entries(groupSum(activeExp, "date", monthKey)).sort().map(([k, v]) => [monthLabel(k), v]) },
    anio: { title: "Gasto por año", headers: ["Año", "Total"], rows: () => Object.entries(groupSum(activeExp, "date", yearOf)).sort().map(([k, v]) => [k, v]) },
    usuario: { title: "Gasto por usuario responsable", headers: ["Usuario", "Total"], rows: () => Object.entries(groupSum(activeExp, "responsibleUserId")).map(([id, v]) => [L.userById[id]?.name, v]) },
    departamento: {
      title: "Gasto por departamento", headers: ["Departamento", "Total"],
      rows: () => {
        const m = {};
        activeExp.filter((e) => e.technicianId).forEach((e) => {
          const dept = L.techById[e.technicianId]?.department || "Sin departamento";
          m[dept] = (m[dept] || 0) + e.totalValue;
        });
        return Object.entries(m).sort((a, b) => b[1] - a[1]);
      },
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
  };

  const rep = active ? reports[active] : null;
  const rows = rep && !rep.custom ? rep.rows() : [];
  const total = rep && !rep.noSum && !rep.custom ? rows.reduce((s, r) => s + (Number(r[r.length - 1]) || 0), 0) : null;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 10, marginBottom: 18 }}>
        {Object.entries(reports).map(([key, r]) => (
          <div key={key} className="amg-card" style={{ padding: 14, cursor: "pointer", borderColor: active === key ? "var(--accent)" : undefined }} onClick={() => setActive(key)}>
            <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>{key === "vinipel" && <Gauge size={14} color="var(--accent)" />}{key === "stock" && <Boxes size={14} color="var(--accent)" />}{r.title}</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Ver reporte →</div>
          </div>
        ))}
      </div>

      {rep && active === "vinipel" && <ControlVinipel db={db} />}
      {rep && active === "stock" && <StockActual db={db} />}

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
              {total !== null && <tfoot><tr><td style={{ fontWeight: 700 }}>Total</td><td className="amg-mono" style={{ fontWeight: 700, color: "var(--accent)" }}>{fmtCOP(total)}</td></tr></tfoot>}
            </table>
          </div>
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>El histórico individual detallado de cada técnico está disponible en su perfil, dentro del módulo Técnicos.</div>
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
      const serviciosRealizados = services
        .filter((s) => s.technicianId === t.id && inRange(s.date))
        .reduce((s, r) => s + r.quantity, 0);
      const tasa = serviciosRealizados > 0 ? rollos / serviciosRealizados : (rollos > 0 ? null : 0);
      return { tech: t, rollos, serviciosRealizados, tasa };
    }).filter((r) => r.rollos > 0 || r.serviciosRealizados > 0);
  }, [db, dateFrom, dateTo, vinipelSub, services]);

  const tasasValidas = rows.filter((r) => r.tasa !== null).map((r) => r.tasa);
  const promedioTasa = tasasValidas.length ? tasasValidas.reduce((a, b) => a + b, 0) / tasasValidas.length : 0;

  const exportCSV = () => downloadCSV("control_vinipel.csv",
    ["Técnico", "Rollos de vinipel entregados", "Servicios realizados", "Tasa (rollos por servicio)"],
    rows.map((r) => [r.tech.name, r.rollos, r.serviciosRealizados, r.tasa === null ? "Sin servicios registrados" : r.tasa.toFixed(2)])
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
        Tasa de uso = rollos de vinipel <b>entregados</b> (registrados en Inventario → Entregas) ÷ servicios realizados por el técnico en el periodo. Las compras de stock no afectan este cálculo, solo lo que efectivamente se entregó a cada técnico. Una tasa muy por encima del promedio ({promedioTasa.toFixed(2)} rollos/servicio) puede indicar sobreconsumo, desperdicio o pérdida de material.
      </div>

      {chartData.length > 0 && (
        <ChartPanel title="Top 10 técnicos por tasa de uso (rollos por servicio)">
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
          <thead><tr><th>Técnico</th><th>Rollos entregados</th><th>Servicios realizados</th><th>Tasa (rollos/servicio)</th><th></th></tr></thead>
          <tbody>
            {rows.sort((a, b) => (b.tasa ?? -1) - (a.tasa ?? -1)).map((r) => {
              const alerta = r.tasa !== null && r.tasa > promedioTasa * 1.3 && promedioTasa > 0;
              return (
                <tr key={r.tech.id}>
                  <td>{r.tech.name}</td>
                  <td className="amg-mono">{r.rollos}</td>
                  <td className="amg-mono">{r.serviciosRealizados}</td>
                  <td className="amg-mono">{r.tasa === null ? "—" : r.tasa.toFixed(2)}</td>
                  <td>{alerta && <Badge text="Por encima del promedio" color="red" />}{r.tasa === null && r.rollos > 0 && <Badge text="Sin servicios registrados" color="amber" />}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Sin datos de vinipel o servicios en este periodo.</td></tr>}
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
