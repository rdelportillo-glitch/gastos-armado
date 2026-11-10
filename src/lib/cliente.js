// Consulta de cliente: a partir de la cédula (o NIT / documento) reúne el historial del cliente: servicios de armado, instalaciones de TV y ventas.
//  · El documento del cliente viene de la base de Jamar (columna CLIENTE → asig.clienteId de cada servicio) y de lo que el técnico escribe en cada venta (sales.doc_number).
//  · Las ofertas de Instalación de TV no guardan documento: se ligan por el número de servicio.
//  · Los resultados de los servicios cerrados salen del histórico de asignación (sin los registros anulados); lo que aún está en Carga o en Asignación, del registro de servicio.
import { supabase } from "./supabaseClient";
import { cargarVentas } from "./ventas";

// Documento comparable: mayúsculas, solo letras y números (quita puntos, espacios y guiones) y sin ceros a la izquierda.
export const normDoc = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");

async function enLotes(tabla, columna, valores, cols = "*") {
  const out = [];
  const unicos = [...new Set(valores.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 100) {
    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase.from(tabla).select(cols).in(columna, unicos.slice(i, i + 100)).range(start, start + 999);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

const etiquetaGestion = (s) => {
  if (s.asig && (s.asig.anulada || s.asig.cancelada)) return s.asig.anulada ? "Anulado" : "Cancelado";
  const g = s.estadoGestion || "Realizado";
  return g === "Pendiente" ? "Pendiente de asignar" : g === "Realizado" ? "Realizado (sin cerrar el día)" : "En gestión";
};

// services: todos los registros de servicio (db.services). technicians: Personal (para el nombre del técnico).
export async function buscarCliente(documento, services, technicians = []) {
  const doc = normDoc(documento);
  if (doc.length < 5) throw new Error("Escribe al menos 5 dígitos del documento.");
  const techById = Object.fromEntries((technicians || []).map((t) => [t.id, t]));

  // 1) Servicios del cliente (por el documento de la base de Jamar)
  const propios = (services || []).filter((s) => s.servicioExterno && s.asig && normDoc(s.asig.clienteId) === doc);
  const numeros = [...new Set(propios.map((s) => String(s.servicioExterno)))];

  // 2) Histórico de esos servicios, ofertas de TV y ventas del documento
  const [hist, tvRows, ventasTodas] = await Promise.all([
    enLotes("assignment_history", "servicio", numeros),
    enLotes("tv_offers", "servicio", numeros),
    cargarVentas({ documento: doc }),
  ]);
  const ventas = ventasTodas.filter((v) => normDoc(v.documento) === doc);
  const histPorRegistro = new Map(hist.map((h) => [h.service_id, h]));

  // 3) Una fila por servicio y día: sus productos y su resultado
  const grupos = new Map();
  propios.forEach((s) => {
    const h = histPorRegistro.get(s.id);
    if (h && h.anulado) return; // registro del histórico anulado: no cuenta
    const fecha = (h && h.day) || String(s.date || "").slice(0, 10);
    const k = `${s.servicioExterno}|${fecha}`;
    const a = s.asig || {};
    const g = grupos.get(k) || {
      servicio: String(s.servicioExterno), fecha, empresa: a.empresa || "", cliente: s.clienteNombre || a.cliente || "", telefono: a.telefono || "", direccion: s.direccion || a.direccion || "",
      ciudad: s.ciudadExterna || a.ciudad || "", depto: s.departamentoExterno || a.depto || "", barrio: a.barrio || "", tecnico: "", tipo: s.serviceType || a.tipo || "", productos: new Map(), resultados: new Map(), causales: new Set(),
    };
    const q = Math.max(1, Math.round(Number(h ? h.quantity : s.quantity) || 1));
    const nombre = (h && h.producto) || s.productoExternoNombre || (a.producto) || "-";
    g.productos.set(nombre, (g.productos.get(nombre) || 0) + q);
    const res = h ? h.resultado : etiquetaGestion(s);
    g.resultados.set(res, (g.resultados.get(res) || 0) + q);
    const causal = (h && (h.causal_auditada || h.causal_extreme)) || s.causalAuditada || s.causalExtreme;
    if (causal) g.causales.add(causal);
    const tec = (h && h.technician_name) || (techById[s.technicianId] && techById[s.technicianId].name) || s.tecnico2Nombre || "";
    if (tec && !g.tecnico.split(", ").includes(tec)) g.tecnico = g.tecnico ? `${g.tecnico}, ${tec}` : tec;
    grupos.set(k, g);
  });
  const servicios = [...grupos.values()].map((g) => ({
    ...g, productos: [...g.productos.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad })), unidades: [...g.productos.values()].reduce((x, y) => x + y, 0),
    resultado: [...g.resultados.entries()].map(([r, n]) => (g.resultados.size > 1 ? `${r} (${n})` : r)).join(" · "), causal: [...g.causales].join(" · "),
  })).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.servicio.localeCompare(b.servicio));

  // 4) Instalaciones de TV del cliente (por número de servicio)
  const tv = tvRows.map((o) => ({
    id: o.id, servicio: o.servicio, fecha: o.fecha_prog || "", estado: o.estado, ejecucion: o.ejecucion || "", pulgadas: o.pulgadas, productos: o.productos || "", valorTotal: o.valor_total, valorCobrado: o.valor_cobrado,
    forma: o.cobro_metodo || o.forma_pago || "", objecion: o.objecion || "", tecnico: (techById[o.tecnico_id] && techById[o.tecnico_id].name) || "", intentos: o.intentos || 0, telefonos: o.telefonos || "",
  })).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  // 5) Datos de contacto vistos en los servicios y en las ventas
  const nombres = [...new Set([...servicios.map((s) => s.cliente), ...ventas.map((v) => v.cliente)].map((x) => String(x || "").trim()).filter(Boolean))];
  const direcciones = [...new Set(servicios.map((s) => [s.direccion, s.barrio, s.ciudad].filter(Boolean).join(", ")).filter(Boolean))];
  const telefonos = [...new Set(servicios.flatMap((s) => String(s.telefono || "").split(/[\/,;\s]+/).filter((x) => x.replace(/\D/g, "").length >= 7)))];
  return { documento: doc, nombres, direcciones, telefonos, servicios, tv, ventas };
}
