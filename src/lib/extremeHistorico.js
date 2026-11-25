// Reporte de Extreme → Histórico de asignación de los días YA finalizados.
// Al cargar el reporte de Extreme en Carga solo se actualizan los servicios que siguen abiertos; los de un día ya finalizado quedaban "sin coincidencia" y el histórico se quedaba con lo que
// Extreme había reportado hasta la hora del cierre (por ejemplo, hasta las 5 pm). Aquí esas filas se cruzan con el histórico (por servicio y código) y se actualizan la causal de Extreme,
// el estado de Extreme y el diagnóstico, se iguala el resultado a lo que dice Extreme y se recalculan las columnas derivadas (ARMADO?, CAUSALES, GARANTIA, AUDITORIA...) y el CSV guardado,
// con la misma lógica de «Editar registro» del Histórico. La causal AUDITADA corregida a mano no se toca; solo se quita la PENDIENTE que la plataforma pone sola al cerrar el día
// cuando Extreme ahora trae resultado (realizado o una causal). No se toca lo que ya está en Carga ni los servicios que volvieron a Pendientes.
import { supabase } from "./supabaseClient";
import { camposCierreDeHistorico, parcharFilaCsv } from "./asignacion/csvCarga";
import { gestionDeCausal } from "./asignacion/cierreColumnas";
import { updateHistoryRow } from "./asignacion/history";

const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

export const DIAS_HISTORICO_EXTREME = 7; // hasta cuántos días atrás se actualiza el histórico con el reporte

// Registros del histórico (no anulados) de unos servicios, por lotes.
export async function historiaDeServicios(servicios) {
  const lista = [...new Set((servicios || []).map((s) => String(s)).filter(Boolean))];
  const out = [];
  for (let i = 0; i < lista.length; i += 100) {
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from("assignment_history").select("*").in("servicio", lista.slice(i, i + 100)).eq("anulado", false).order("day", { ascending: false }).order("id").range(start, start + 999);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

const estadoDeExtreme = (t) => { const p = plano(t); return p === "REALIZADO" ? "Realizado" : p === "NO REALIZADO" ? "No realizado" : ""; };

// filas: filas del reporte de Extreme SIN coincidencia en Carga { rowNumber, servicio, codigo, estado, causal, diagnostico } · historia: registros de historiaDeServicios.
// Devuelve [{ fila, hist, cambios: [claves que cambian], sinCambio, patch }] solo de las filas que tienen un registro en el histórico.
export function planHistoricoExtreme({ filas, historia, technicians, causales, desde }) {
  const gestionDe = gestionDeCausal(causales);
  const grupos = new Map(); // servicio|código → registros del día más reciente
  (historia || []).forEach((h) => {
    if (desde && String(h.day) < desde) return; // solo los últimos días: un registro viejo no es del mismo intento que reporta Extreme
    const k = `${h.servicio}|${h.codigo || ""}`;
    const cur = grupos.get(k);
    if (!cur || String(h.day) > cur.day) grupos.set(k, { day: String(h.day), rows: [h] });
    else if (String(h.day) === cur.day) cur.rows.push(h);
  });
  grupos.forEach((g) => g.rows.sort((a, b) => String(a.id).localeCompare(String(b.id))));
  const vistas = new Map(); const usados = new Set();
  const items = [];
  (filas || []).forEach((f) => {
    const k = `${f.servicio}|${f.codigo || ""}`;
    const g = grupos.get(k);
    if (!g) return;
    const n = vistas.get(k) || 0; vistas.set(k, n + 1);
    const h = g.rows[Math.min(n, g.rows.length - 1)]; // la unidad N del reporte con el N-ésimo registro del histórico de ese día
    if (usados.has(h.id)) return; // más filas en el reporte que registros: la repetida no se vuelve a aplicar
    usados.add(h.id);
    const estado = estadoDeExtreme(f.estado) || h.estado_extreme || null;
    const causalExt = String(f.causal || "").trim() || h.causal_extreme || null;
    const diag = String(f.diagnostico || "").trim() || h.diagnostico || null;
    // La PENDIENTE que pone la plataforma al cerrar el día (literal «PENDIENTE») ya no aplica si Extreme dice que se realizó; lo auditado a mano no se toca.
    // Se quita si Extreme ya trae un resultado (realizado o una causal); si el reporte viene vacío se deja.
    const aud = h.causal_auditada === "PENDIENTE" && (estado === "Realizado" || String(f.causal || "").trim()) ? null : (h.causal_auditada || null);
    // Resultado: igual a lo que dice Extreme, salvo lo cancelado o devuelto (esa causal auditada manda).
    const protegido = ["Cancelado", "Devuelto"].includes(gestionDe(aud || ""));
    const resultado = protegido || !estado ? h.resultado : (estado === "Realizado" ? "Realizado" : "No realizado");
    const nuevo = { ...h, estado_extreme: estado, causal_extreme: causalExt, diagnostico: diag, causal_auditada: aud, resultado };
    const cambios = ["estado_extreme", "causal_extreme", "diagnostico", "causal_auditada", "resultado"].filter((c) => (h[c] || null) !== (nuevo[c] || null));
    let patch = null;
    if (cambios.length) {
      patch = { estado_extreme: nuevo.estado_extreme, causal_extreme: nuevo.causal_extreme, diagnostico: nuevo.diagnostico, causal_auditada: nuevo.causal_auditada, resultado: nuevo.resultado, ...camposCierreDeHistorico(nuevo) };
      if (Array.isArray(h.fila_csv)) patch.fila_csv = parcharFilaCsv(h.fila_csv, { ...nuevo, ...patch }, h, { technicians, causales });
    }
    items.push({ fila: f, hist: h, cambios, sinCambio: !cambios.length, patch });
  });
  return items;
}

// Aplica el plan (solo lo que cambia), de a 8 a la vez. Devuelve { actualizados, errores: [mensajes] }.
export async function aplicarPlanHistorico(items) {
  const pend = items.filter((x) => x.patch);
  let actualizados = 0; const errores = [];
  for (let i = 0; i < pend.length; i += 8) {
    await Promise.all(pend.slice(i, i + 8).map(async (x) => {
      try { await updateHistoryRow(x.hist.id, x.patch); actualizados++; } catch (e) { errores.push(`${x.hist.servicio}: ${e.message}`); }
    }));
  }
  return { actualizados, errores };
}
