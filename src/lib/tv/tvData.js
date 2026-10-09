// Instalación de TV (servicio adicional): configuración, cola de llamadas, ofertas y bitácora de llamadas.
import { supabase } from "../supabaseClient";
import { fmtCOP, tvTexto } from "./tvText.js";
export { fmtCOP, tvTexto };

const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/* ------------------------------ Configuración ------------------------------ */

// Valores de la "Propuesta Instalación TV Biver". El administrador los ajusta en la pestaña Configuración.
export const TV_CONFIG_DEFAULT = {
  umbralPulgadas: 55, valorMenor: 100000, valorMayor: 120000,
  minutosBase: 30, sumarIndeciso: true,
  acciones: [
    { key: "desmonte_tv", nombre: "Desmonte del TV anterior", valor: 0, minutos: 10 },
    { key: "organizar_cables", nombre: "Organizar cables", valor: 0, minutos: 10 },
    { key: "mover_punto", nombre: "Mover punto eléctrico", valor: 0, minutos: 10 },
  ],
  maxIntentos: 3, horasRellamada: 2,
  // Panel de TV, centros de entretenimiento y mesa flotante entran a la agenda; "Mesa De Tv" no.
  linea: "ENTRETENIMIENTO", sublineas: ["PANEL DE TV", "CENTRO ENTRETEN", "MESA FLOTANTE"],
  cuenta: "Transferencia Davivienda @DAVIASCINSTSERV (ASC Instalaciones y Servicios SAS)",
  guion: {
    apertura: "Buenos días/tardes, ¿hablo con {cliente}? Le llamo de parte de Biver, empresa encargada del armado de sus muebles Jamar. Junto con su pedido, vemos que adquirió un panel o centro de entretenimiento, y quería comentarle que contamos con un servicio adicional de instalación de televisor, que no está incluido en el armado.",
    oferta: "El valor es de {valorMenor} para TV hasta {umbral}\" o {valorMayor} para TV mayor de {umbral}\". El técnico llega el mismo día del armado, así todo queda listo en una sola visita.",
    cierre: "¿Le gustaría incluir este servicio? Podemos coordinar el pago por transferencia o en efectivo directamente con el técnico el día de la instalación.",
  },
  objeciones: [
    { objecion: "Ya tengo quien me lo instale", respuesta: "Nuestro técnico ya estará en su casa ese día. Le ahorra tiempo y una visita adicional, además garantizamos la instalación correcta del soporte." },
    { objecion: "Es muy caro", respuesta: "El valor incluye mano de obra especializada, soporte certificado y prueba de funcionamiento. Es un precio fijo sin sorpresas." },
    { objecion: "Lo hago yo mismo", respuesta: "Claro que puede, pero si prefiere que quede perfectamente nivelado y asegurado, nuestro técnico lo hace en minutos con las herramientas adecuadas." },
    { objecion: "No tengo efectivo", respuesta: "No hay problema, puede hacer la transferencia antes de la visita a nuestra cuenta Davivienda y listo." },
    { objecion: "Déjeme pensarlo", respuesta: "El técnico ya tiene agendada la visita para ese día. Si decide incluirlo después, tendríamos que programar una visita aparte con costo adicional de desplazamiento." },
  ],
};

export async function loadTvConfig() {
  const { data, error } = await supabase.from("assignment_settings").select("value").eq("key", "tv_config").maybeSingle();
  if (error) throw new Error(error.message);
  const v = (data && data.value) || {};
  return { ...TV_CONFIG_DEFAULT, ...v, guion: { ...TV_CONFIG_DEFAULT.guion, ...(v.guion || {}) }, acciones: v.acciones && v.acciones.length ? v.acciones : TV_CONFIG_DEFAULT.acciones, objeciones: v.objeciones && v.objeciones.length ? v.objeciones : TV_CONFIG_DEFAULT.objeciones };
}

export async function saveTvConfig(cfg, userId) {
  const { error } = await supabase.from("assignment_settings").upsert({ key: "tv_config", value: cfg, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------------- Precios --------------------------------- */

// Valor y minutos de la instalación según pulgadas y acciones adicionales elegidas ({ desmonte_tv: true, ... }).
export function calcPrecio(cfg, pulgadas, acciones = {}) {
  const p = Number(pulgadas) || 0;
  const base = p > 0 ? (p > cfg.umbralPulgadas ? cfg.valorMayor : cfg.valorMenor) : 0;
  const elegidas = cfg.acciones.filter((a) => acciones[a.key]);
  const adicionales = elegidas.reduce((s, a) => s + (Number(a.valor) || 0), 0);
  const minutos = (Number(cfg.minutosBase) || 0) + elegidas.reduce((s, a) => s + (Number(a.minutos) || 0), 0);
  return { base, adicionales, total: base + adicionales, minutos, elegidas: elegidas.map((a) => a.nombre) };
}


/* ----------------------------- Cola de llamadas ----------------------------- */

// ¿El producto es un panel de TV o centro de entretenimiento? (línea y sublínea de la base de Jamar)
export function esProductoTv(asig, cfg) {
  if (!asig) return false;
  if (plain(asig.linea) !== plain(cfg.linea)) return false;
  const sub = plain(asig.sublinea);
  return cfg.sublineas.some((s) => sub.includes(plain(s)));
}

export const telefonosDe = (txt) => [...new Set(String(txt || "").match(/\d{7,}/g) || [])];

// Servicios con panel/centro de TV cargados en Asignación y todavía no finalizados: una entrada por servicio (cliente).
export function buildQueue(services, cfg) {
  const m = new Map();
  (services || []).forEach((s) => {
    if (!s.servicioExterno || s.finalizedAt || !s.asig || !["Pendiente", "En gestión"].includes(s.estadoGestion)) return;
    const tv = esProductoTv(s.asig, cfg);
    const g = m.get(s.servicioExterno) || { servicio: s.servicioExterno, cliente: s.clienteNombre || "", telefonos: telefonosDe(s.asig.telefono), telefonoTxt: s.asig.telefono || "",
      direccion: s.direccion || "", ciudad: s.ciudadExterna || "", barrio: s.asig.barrio || "", departamento: s.departamentoExterno || "", region: s.asig.region ?? null,
      fechaProg: s.date, createdAt: s.createdAt, productos: [], tecnicoId: null, tecnicoNombre: "", estadoGestion: s.estadoGestion, hayTv: false };
    if (tv) { g.hayTv = true; g.productos.push(s.productoExternoNombre || s.asig.producto); }
    if (s.technicianId) { g.tecnicoId = s.technicianId; g.tecnicoNombre = s.tecnico2Nombre || ""; }
    if (s.date < g.fechaProg) g.fechaProg = s.date;
    if (s.createdAt && (!g.createdAt || s.createdAt < g.createdAt)) g.createdAt = s.createdAt;
    m.set(s.servicioExterno, g);
  });
  return [...m.values()].filter((g) => g.hayTv);
}

/* ------------------------------ Ofertas y llamadas ------------------------------ */

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export async function loadOffers({ since } = {}) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    let q = supabase.from("tv_offers").select("*").order("created_at", { ascending: false }).order("id");
    if (since) q = q.gte("created_at", since);
    const { data, error } = await q.range(start, start + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Ofertas de unos servicios, de cualquier estado: en la asignación marcan el servicio, suman tiempo (Aceptó / Indeciso)
// y le muestran al técnico también las gestiones negativas (no contestó, no aceptó).
export async function loadOffersByServicio(servicios) {
  const out = [];
  for (const part of chunk([...new Set(servicios.map(String))], 150)) {
    const { data, error } = await supabase.from("tv_offers").select("*").in("servicio", part);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
  }
  return out;
}

export async function loadCalls({ from, to }) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    let q = supabase.from("tv_calls").select("*").order("called_at", { ascending: false }).order("id");
    if (from) q = q.gte("called_at", `${from}T00:00:00`);
    if (to) q = q.lte("called_at", `${to}T23:59:59.999`);
    const { data, error } = await q.range(start, start + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadCallsOfOffer(offerId) {
  const { data, error } = await supabase.from("tv_calls").select("*").eq("offer_id", offerId).order("called_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

// Estado de la oferta después de una llamada.
export function estadoTrasLlamada(cfg, { resultado, decision, intentos }) {
  if (resultado === "Contactado") return decision || "Rellamar";
  return intentos >= cfg.maxIntentos ? "No contactado" : "Rellamar";
}

// Guarda una llamada: crea/actualiza la oferta del servicio y agrega la llamada a la bitácora.
//   cand: entrada de la cola; offer: oferta existente o null; llamada: { telefono, resultado, decision, objecion, nota, proxima };
//   datos: { pulgadas, acciones, valorTotal, formaPago } cuando hay decisión de aceptar / indeciso.
export async function registrarLlamada({ cand, offer, cfg, llamada, datos, session }) {
  const intentos = (offer ? offer.intentos : 0) + 1;
  const estado = estadoTrasLlamada(cfg, { resultado: llamada.resultado, decision: llamada.decision, intentos });
  const now = new Date().toISOString();
  const row = {
    servicio: String(cand.servicio), estado, intentos, gestor_id: session.id, updated_at: now,
    primera_llamada_at: (offer && offer.primera_llamada_at) || now,
    proxima_llamada: estado === "Rellamar" || (estado === "Indeciso" && llamada.proxima) ? (llamada.proxima || null) : null,
    objecion: llamada.decision === "No aceptó" ? (llamada.objecion || null) : (offer ? offer.objecion : null),
    observacion: llamada.nota || (offer ? offer.observacion : null),
  };
  if (!offer) {
    Object.assign(row, {
      fecha_prog: cand.fechaProg || null, cliente: cand.cliente, telefonos: cand.telefonoTxt, direccion: cand.direccion, ciudad: cand.ciudad,
      departamento: cand.departamento, region: cand.region, productos: cand.productos.join(" · "),
      created_at: cand.createdAt || now, // "recibido": cuándo entró el servicio, para medir el tiempo hasta la primera llamada
    });
  }
  if (datos && (estado === "Aceptó" || estado === "Indeciso")) {
    const acc = datos.acciones || {};
    const precio = calcPrecio(cfg, datos.pulgadas, acc);
    Object.assign(row, {
      pulgadas: Number(datos.pulgadas) || null, valor_base: precio.base,
      desmonte_tv: !!acc.desmonte_tv, organizar_cables: !!acc.organizar_cables, mover_punto: !!acc.mover_punto,
      valor_adicionales: precio.adicionales,
      valor_total: datos.valorTotal === "" || datos.valorTotal === null || datos.valorTotal === undefined ? precio.total : Number(datos.valorTotal),
      forma_pago: datos.formaPago || null,
      tiempo_min: estado === "Aceptó" ? precio.minutos : (cfg.sumarIndeciso ? Number(cfg.minutosBase) || 0 : 0),
    });
  }
  // Si el cliente ya no lleva instalación (no aceptó, no se le pudo contactar), no se suman minutos.
  if (estado !== "Aceptó" && estado !== "Indeciso") row.tiempo_min = 0;
  const { data: saved, error } = await supabase.from("tv_offers").upsert(row, { onConflict: "servicio" }).select().single();
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("tv_calls").insert({
    offer_id: saved.id, servicio: String(cand.servicio), gestor_id: session.id, telefono: llamada.telefono || null, resultado: llamada.resultado,
    decision: llamada.resultado === "Contactado" ? llamada.decision : null, objecion: llamada.objecion || null, nota: llamada.nota || null, proxima_llamada: llamada.proxima || null,
  });
  if (e2) throw new Error(`La oferta se guardó pero no la llamada: ${e2.message}`);
  return saved;
}

/* ------------------------------- Indicadores ------------------------------- */

// Indicadores a partir de las llamadas y ofertas de un rango. Una oferta cuenta una vez, con su última decisión del rango.
export function calcIndicadores(calls, offers, usuarios = {}) {
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const porOferta = new Map();
  [...calls].sort((a, b) => String(a.called_at).localeCompare(String(b.called_at))).forEach((c) => {
    const g = porOferta.get(c.offer_id) || { offerId: c.offer_id, llamadas: 0, contactado: false, decision: null, gestores: new Set() };
    g.llamadas++; g.gestores.add(c.gestor_id);
    if (c.resultado === "Contactado") { g.contactado = true; if (c.decision) g.decision = c.decision; }
    porOferta.set(c.offer_id, g);
  });
  const lista = [...porOferta.values()];
  const cuenta = (f) => lista.filter(f).length;
  const llamados = lista.length, contactados = cuenta((g) => g.contactado);
  const aceptados = cuenta((g) => g.decision === "Aceptó"), indecisos = cuenta((g) => g.decision === "Indeciso"), noAcepto = cuenta((g) => g.decision === "No aceptó");
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const valorAceptado = lista.filter((g) => g.decision === "Aceptó").reduce((s, g) => s + (Number((offerById.get(g.offerId) || {}).valor_total) || 0), 0);
  // tiempo hasta la primera llamada (minutos), solo ofertas cuya primera llamada cae en el rango
  const tiempos = lista.map((g) => offerById.get(g.offerId)).filter((o) => o && o.primera_llamada_at && o.created_at)
    .map((o) => (new Date(o.primera_llamada_at) - new Date(o.created_at)) / 60000).filter((m) => m >= 0);
  const objeciones = {};
  calls.filter((c) => c.decision === "No aceptó" && c.objecion).forEach((c) => { objeciones[c.objecion] = (objeciones[c.objecion] || 0) + 1; });

  const agrupar = (keyFn) => {
    const m = new Map();
    lista.forEach((g) => {
      const o = offerById.get(g.offerId) || {};
      const k = keyFn(g, o);
      const x = m.get(k) || { clave: k, llamados: 0, llamadas: 0, contactados: 0, aceptados: 0, indecisos: 0, noAcepto: 0, valor: 0 };
      x.llamados++; x.llamadas += g.llamadas; if (g.contactado) x.contactados++;
      if (g.decision === "Aceptó") { x.aceptados++; x.valor += Number(o.valor_total) || 0; }
      if (g.decision === "Indeciso") x.indecisos++;
      if (g.decision === "No aceptó") x.noAcepto++;
      m.set(k, x);
    });
    return [...m.values()].map((x) => ({ ...x, contactabilidad: pct(x.contactados, x.llamados), aceptacion: pct(x.aceptados, x.contactados), conversion: pct(x.aceptados, x.llamados) }));
  };
  const porDia = {};
  calls.forEach((c) => { const d = String(c.called_at).slice(0, 10); const x = (porDia[d] = porDia[d] || { dia: d, llamadas: 0, contactos: 0 }); x.llamadas++; if (c.resultado === "Contactado") x.contactos++; });

  return {
    llamados, llamadas: calls.length, contactados, aceptados, indecisos, noAcepto, valorAceptado,
    contactabilidad: pct(contactados, llamados), aceptacion: pct(aceptados, contactados), conversion: pct(aceptados, llamados),
    intentosPromedio: llamados ? calls.length / llamados : 0,
    tiempoPromedioMin: tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : null,
    pctPrimeraHora: tiempos.length ? (tiempos.filter((m) => m <= 60).length / tiempos.length) * 100 : null,
    objeciones: Object.entries(objeciones).sort((a, b) => b[1] - a[1]),
    porGestor: agrupar((g) => [...g.gestores].map((id) => usuarios[id] || "—").join(" / ")).sort((a, b) => b.llamados - a.llamados),
    porDepartamento: agrupar((g, o) => o.departamento || "Sin departamento").sort((a, b) => b.llamados - a.llamados),
    porDia: Object.values(porDia).sort((a, b) => a.dia.localeCompare(b.dia)),
  };
}
