import { useState, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as D from "./lib/asignacion/data";
import { haversine } from "./lib/asignacion/engine.js";

/* ============================================================================
   MAPA DE RUTAS (Carga)
   Dibuja sobre un mapa (OpenStreetMap) las rutas de lo que se ve en Carga, por región, con un color por técnico y la parada numerada según el orden de ruta.
   La ubicación es la de la ZONA EQUIVALENTE de cada servicio (la que guarda Asignación, con sus coordenadas de Maestros → Zonas), no la dirección exacta.
   Se puede ver por zona equivalente o por barrio; los barrios no tienen coordenadas propias: se ubican alrededor del punto de su zona (aproximado).
============================================================================ */

const PALETA = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#008080", "#f032e6", "#9a6324", "#800000", "#808000", "#000075", "#2a9d8f", "#e6a817", "#ff6f91", "#6a4c93", "#1d3557", "#c1121f", "#588157", "#0077b6", "#7f5539"];
const GRIS = "#6b7280";
const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const okLL = (a, b) => a !== null && b !== null && a > -5 && a < 14 && b > -80 && b < -66; // dentro de Colombia
const fmtMin = (m) => `${Math.round(m || 0).toLocaleString("es-CO")} min`;
const fmtKm = (k) => `${(Math.round((k || 0) * 10) / 10).toLocaleString("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Para que no se encimen los puntos de una misma zona: los barrios se ubican en anillos (en grados) alrededor de la zona, y los técnicos que coinciden en un mismo punto
// se separan unos píxeles entre sí en pantalla (así se ven a cualquier zoom).
const anillo = (k) => (k === 0 ? [0, 0] : (() => { const r = 0.006 * (1 + Math.floor((k - 1) / 8)), a = (2 * Math.PI * ((k - 1) % 8)) / 8; return [r * Math.sin(a), r * Math.cos(a)]; })());
const ranuraPx = (t, n) => (n <= 1 ? [0, 0] : [11 * Math.sin((2 * Math.PI * t) / n), -11 * Math.cos((2 * Math.PI * t) / n)]);

// Props opcionales para la Asignación (paso 3):
//  · titulo: título de la ventana.
//  · mover: { puede, opciones(sid) → [{ value, label }], onMover(sid, valor) } — al hacer clic en un punto se abre un cuadro con sus servicios y un "Mover a…" para reasignarlos.
//    Cada registro debe traer _sid (id del servicio en la asignación).
//  · infoTec(clave del técnico) → { texto, alerta } — línea extra por técnico en la lista (minutos usados y libres).
export default function MapaRutasModal({ ui, rows, regionOf, regionLabel, techName, techOrden, regionInicial, onClose, titulo = "Mapa de rutas", mover = null, infoTec = null }) {
  const moverRef = useRef(mover); moverRef.current = mover; // siempre la versión más reciente (los cuadros del mapa se crean fuera de React)
  const [region, setRegion] = useState(regionInicial || "");
  const [vista, setVista] = useState("zona"); // zona | barrio
  const [ocultos, setOcultos] = useState(() => new Set());
  const [enfocar, setEnfocar] = useState(null); // { key, n } para centrar el mapa en un técnico
  const [verSin, setVerSin] = useState(false); // tabla de los servicios que no se pudieron ubicar
  const [zonas, setZonas] = useState(null); // zona → coordenadas de Maestros (respaldo si el servicio no guardó coordenadas)
  useEffect(() => { let alive = true; D.loadMasters().then((m) => { if (alive) setZonas(m.M.zona || {}); }).catch(() => { if (alive) setZonas({}); }); return () => { alive = false; }; }, []);

  const regiones = useMemo(() => Array.from(new Set(rows.map((s) => regionOf(s)).filter((r) => r !== null && r !== undefined))).sort((a, b) => a - b), [rows]);

  // Color estable por técnico (según todos los técnicos de lo que se ve en Carga, no solo los de la región elegida).
  const tecnicos = useMemo(() => {
    const m = new Map();
    rows.forEach((s) => {
      const key = s.technicianId || "";
      if (!key) return;
      if (!m.has(key)) m.set(key, { key, nombre: techName(s), orden: techOrden(s) });
    });
    const lista = [...m.values()].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
    lista.forEach((t, i) => { t.color = PALETA[i % PALETA.length]; });
    return new Map(lista.map((t) => [t.key, t]));
  }, [rows]);

  const coordsDe = (s) => {
    const a = s.asig || {};
    let la = num(a.lat), lo = num(a.lng);
    if (!okLL(la, lo) && zonas && a.zona) { const z = zonas[a.zona] || zonas[String(a.zona).toUpperCase()]; if (z) { la = num(z[0]); lo = num(z[1]); } }
    return okLL(la, lo) ? { lat: la, lng: lo } : null;
  };

  // Puntos y rutas: por técnico, un punto por zona (o por barrio) con los servicios que ahí atiende.
  const datos = useMemo(() => {
    const enRegion = rows.filter((s) => !region || String(regionOf(s)) === region);
    const porTec = new Map(); // key técnico → { info, puntos: Map }
    const sinLista = new Map(); // servicio → datos del servicio que no se pudo ubicar
    const servicios = new Set();
    enRegion.forEach((s) => {
      const key = s.technicianId || `n:${s.tecnico2Nombre || ""}`;
      const info = tecnicos.get(s.technicianId || "") || { key, nombre: s.tecnico2Nombre || "Sin técnico", color: GRIS, sinTecnico: true };
      const c = coordsDe(s);
      servicios.add(String(s.servicioExterno));
      const a = s.asig || {};
      if (!c) {
        if (!sinLista.has(String(s.servicioExterno))) sinLista.set(String(s.servicioExterno), {
          servicio: String(s.servicioExterno), cliente: s.clienteNombre || "", tecnico: info.nombre, depto: a.depto || s.departamentoExterno || "", ciudad: a.ciudad || s.ciudadExterna || "",
          zona: a.zona || "", barrio: a.barrio || "", motivo: a.zona ? `La zona "${a.zona}" no tiene coordenadas en Maestros → Zonas` : "El servicio no tiene zona equivalente asignada",
        });
        return;
      }
      const zona = a.zona || a.ciudad || s.ciudadExterna || "Sin zona";
      const barrio = a.barrio || "";
      const pk = vista === "barrio" ? `${zona}|${barrio}` : zona;
      const g = porTec.get(key) || { info, puntos: new Map(), seq: new Map() };
      if (!g.seq.has(String(s.servicioExterno))) g.seq.set(String(s.servicioExterno), { orden: s.rutaOrden ?? 9999, base: c }); // un punto por servicio, en su orden de ruta (para el kilometraje)
      const p = g.puntos.get(pk) || { pk, zona, barrio, ciudad: a.ciudad || s.ciudadExterna || "", base: c, servicios: new Map(), orden: null };
      const sv = p.servicios.get(String(s.servicioExterno)) || { servicio: String(s.servicioExterno), sid: s._sid, cliente: s.clienteNombre || "", productos: 0, items: new Map() };
      sv.productos += 1;
      const nombreProd = s.productoExternoNombre || a.producto || "Producto";
      const it = sv.items.get(nombreProd) || { nombre: nombreProd, n: 0, min: 0 };
      it.n += 1; it.min += Number(s.tiempoMin) || Number(a.tiempo) || 0;
      sv.items.set(nombreProd, it);
      p.servicios.set(sv.servicio, sv);
      if (s.rutaOrden !== null && s.rutaOrden !== undefined && (p.orden === null || s.rutaOrden < p.orden)) p.orden = s.rutaOrden;
      g.puntos.set(pk, p); porTec.set(key, g);
    });
    // Desplazamientos: barrios alrededor de su zona y técnicos alrededor de cada punto.
    const porBase = new Map(); // base → { barrios: [pk], tecs: [key] }
    porTec.forEach((g, key) => g.puntos.forEach((p) => {
      const bk = `${p.base.lat.toFixed(4)}|${p.base.lng.toFixed(4)}`;
      const b = porBase.get(bk) || { barrios: [], tecs: [] };
      if (!b.barrios.includes(p.pk)) b.barrios.push(p.pk);
      if (!b.tecs.includes(key)) b.tecs.push(key);
      porBase.set(bk, b);
    }));
    const tecnicosOut = [...porTec.entries()].map(([key, g]) => {
      const puntos = [...g.puntos.values()].map((p) => {
        const b = porBase.get(`${p.base.lat.toFixed(4)}|${p.base.lng.toFixed(4)}`);
        const [dy, dx] = vista === "barrio" ? anillo(b.barrios.indexOf(p.pk)) : [0, 0];
        const lista = [...p.servicios.values()].map((sv) => ({ ...sv, items: [...sv.items.values()], min: [...sv.items.values()].reduce((x, i) => x + i.min, 0) }));
        return { ...p, lat: p.base.lat + dy, lng: p.base.lng + dx, ranura: b.tecs.indexOf(key), nRanuras: b.tecs.length, lista, min: lista.reduce((x, sv) => x + sv.min, 0) };
      }).sort((x, y) => (x.orden ?? 9999) - (y.orden ?? 9999) || x.zona.localeCompare(y.zona, "es"));
      // Kilometraje: suma de las distancias en línea recta entre las zonas de sus paradas, en el orden de ruta (entre paradas; no incluye ir ni volver a casa).
      const paradas = [...g.seq.values()].sort((x, y) => x.orden - y.orden);
      let km = 0;
      for (let i = 1; i < paradas.length; i++) km += haversine(paradas[i - 1].base, paradas[i].base) || 0;
      return { key, info: g.info, puntos, servicios: puntos.reduce((n, p) => n + p.lista.length, 0), min: puntos.reduce((n, p) => n + p.min, 0), km: g.info.sinTecnico ? null : km };
    }).sort((a, b) => (a.info.sinTecnico ? 1 : 0) - (b.info.sinTecnico ? 1 : 0) || String(a.info.nombre).localeCompare(String(b.info.nombre), "es"));
    return { tecnicos: tecnicosOut, sinLista: [...sinLista.values()], sinUbicacion: sinLista.size, total: servicios.size, km: tecnicosOut.reduce((x, tc) => x + (tc.km || 0), 0) };
  }, [rows, region, vista, tecnicos, zonas]);

  // ---------------- Mapa (Leaflet) ----------------
  const cont = useRef(null), mapa = useRef(null), capa = useRef(null), ultimoAjuste = useRef("");
  useEffect(() => {
    const m = L.map(cont.current, { zoomControl: true }).setView([8.7, -75.2], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(m);
    capa.current = L.layerGroup().addTo(m);
    mapa.current = m;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => m.invalidateSize()) : null;
    if (ro) ro.observe(cont.current);
    const t = setTimeout(() => m.invalidateSize(), 250);
    return () => { clearTimeout(t); if (ro) ro.disconnect(); m.remove(); mapa.current = null; };
  }, []);

  useEffect(() => {
    const m = mapa.current, g = capa.current;
    if (!m || !g) return;
    g.clearLayers();
    const todos = [];
    datos.tecnicos.forEach((t) => {
      if (ocultos.has(t.key)) return;
      const color = t.info.color;
      const pts = t.puntos.map((p) => [p.lat, p.lng]);
      if (!t.info.sinTecnico && pts.length > 1) L.polyline(pts, { color, weight: 3, opacity: 0.65 }).addTo(g);
      t.puntos.forEach((p, i) => {
        todos.push([p.lat, p.lng]);
        const etiqueta = t.info.sinTecnico ? p.lista.length : (p.orden ?? i + 1);
        const [px, py] = ranuraPx(p.ranura, p.nRanuras);
        const icono = L.divIcon({ className: "", iconSize: [28, 28], iconAnchor: [14 - px, 14 - py],
          html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font:700 12px sans-serif">${esc(etiqueta)}</div>` });
        const lista = p.lista.slice(0, 8).map((s) => `<div style="margin-top:4px"><b>${esc(s.servicio)}</b>${s.cliente ? ` · ${esc(s.cliente)}` : ""} <span style="color:#666">(${fmtMin(s.min)})</span>${s.items.slice(0, 5).map((i) => `<div style="padding-left:8px">· ${esc(i.nombre)}${i.n > 1 ? ` ×${i.n}` : ""} — ${fmtMin(i.min)}</div>`).join("")}${s.items.length > 5 ? `<div style="padding-left:8px">y ${s.items.length - 5} producto(s) más…</div>` : ""}</div>`).join("");
        const marcador = L.marker([p.lat, p.lng], { icon: icono });
        if (moverRef.current && moverRef.current.puede) marcador.bindPopup(() => popupReasignar(t, p, etiqueta, m), { maxWidth: 380, minWidth: 300 });
        marcador.bindTooltip(
          `<div style="min-width:320px;max-width:min(480px,80vw);white-space:normal"><b>${esc(t.info.nombre)}</b>${t.info.sinTecnico ? "" : ` · parada ${esc(etiqueta)}`}<br>${vista === "barrio" && p.barrio ? `Barrio: ${esc(p.barrio)}<br>` : ""}Zona: ${esc(p.zona)}${p.ciudad ? ` · ${esc(p.ciudad)}` : ""}<br>${p.lista.length} servicio(s) · tiempo ${fmtMin(p.min)}${lista}${p.lista.length > 8 ? `<div style="margin-top:4px">y ${p.lista.length - 8} servicio(s) más…</div>` : ""}</div>`,
          { direction: "top", offset: [0, -12] });
        marcador.addTo(g);
      });
    });
    // Ajusta el encuadre cuando cambia la región, la vista o el técnico enfocado (no al marcar o desmarcar técnicos).
    const clave = `${region}|${vista}|${enfocar ? enfocar.key + enfocar.n : ""}|${datos.total}`;
    if (clave !== ultimoAjuste.current) {
      ultimoAjuste.current = clave;
      const foco = enfocar ? datos.tecnicos.find((t) => t.key === enfocar.key) : null;
      const pts = foco ? foco.puntos.map((p) => [p.lat, p.lng]) : todos;
      if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 13 });
    }
  }, [datos, ocultos, enfocar, region, vista]);

  // Cuadro de un punto (clic): sus servicios, cada uno con "Mover a…" para reasignarlo a otro técnico de la región. Se arma con el DOM porque Leaflet vive fuera de React.
  const popupReasignar = (t, p, etiqueta, mapaLeaflet) => {
    const mv = moverRef.current;
    const raiz = document.createElement("div");
    raiz.style.cssText = "max-height:340px;overflow:auto;font-size:12px;line-height:1.35";
    const cab = document.createElement("div");
    cab.innerHTML = `<b>${esc(t.info.nombre)}</b>${t.info.sinTecnico ? "" : ` · parada ${esc(etiqueta)}`}<br>Zona: ${esc(p.zona)}${p.barrio ? ` · Barrio: ${esc(p.barrio)}` : ""}${p.ciudad ? ` · ${esc(p.ciudad)}` : ""}`;
    raiz.appendChild(cab);
    p.lista.forEach((s) => {
      const caja = document.createElement("div");
      caja.style.cssText = "margin-top:8px;padding-top:6px;border-top:1px solid #ddd";
      caja.innerHTML = `<b>${esc(s.servicio)}</b>${s.cliente ? ` · ${esc(s.cliente)}` : ""} <span style="color:#666">(${fmtMin(s.min)})</span>${s.items.slice(0, 4).map((i) => `<div style="padding-left:8px">· ${esc(i.nombre)}${i.n > 1 ? ` ×${i.n}` : ""} — ${fmtMin(i.min)}</div>`).join("")}`;
      const sel = document.createElement("select");
      sel.style.cssText = "width:100%;margin-top:5px;padding:3px";
      sel.appendChild(new Option("Mover a…", ""));
      if (!t.info.sinTecnico) sel.appendChild(new Option("— Dejar sin asignar", "__none"));
      (mv.opciones(s.sid) || []).forEach((o) => sel.appendChild(new Option(o.label, o.value)));
      sel.addEventListener("change", () => { if (sel.value) { const v = sel.value; mapaLeaflet.closePopup(); mv.onMover(s.sid, v); } });
      caja.appendChild(sel);
      raiz.appendChild(caja);
    });
    return raiz;
  };

  const alternar = (key) => setOcultos((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const visibles = datos.tecnicos.length - datos.tecnicos.filter((t) => ocultos.has(t.key)).length;

  return (
    <ui.Modal title={titulo} onClose={onClose} width={1250} footer={<button className="amg-btn" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <select className="amg-select" style={{ width: 220 }} value={region} onChange={(e) => { setRegion(e.target.value); setEnfocar(null); }}>
          <option value="">Todas las regiones</option>{regiones.map((r) => <option key={r} value={String(r)}>{regionLabel(r)}</option>)}
        </select>
        <select className="amg-select" style={{ width: 220 }} value={vista} onChange={(e) => setVista(e.target.value)}>
          <option value="zona">Ver por zona equivalente</option><option value="barrio">Ver por barrio</option>
        </select>
        <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{datos.total} servicio(s) · {datos.tecnicos.length} técnico(s) · {fmtKm(datos.km)} en total</span>
        {datos.sinUbicacion > 0 && <button className="amg-btn" style={{ color: "var(--red)", borderColor: "var(--red)" }} title="Servicios que no se pueden dibujar porque su zona no tiene coordenadas" onClick={() => setVerSin((v) => !v)}>{datos.sinUbicacion} sin ubicación · {verSin ? "ocultar" : "ver cuáles"}</button>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <div ref={cont} style={{ flex: "1 1 520px", height: "min(68vh, 640px)", minHeight: 380, borderRadius: 8, border: "1px solid var(--border)", zIndex: 0 }} />
        <div style={{ flex: "0 0 250px", maxWidth: "100%", maxHeight: "min(68vh, 640px)", overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            <button className="amg-btn" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setOcultos(new Set())}>Mostrar todos</button>
            <button className="amg-btn" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setOcultos(new Set(datos.tecnicos.map((t) => t.key)))}>Ocultar todos</button>
          </div>
          {datos.tecnicos.map((t) => (
            <div key={t.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 2px", opacity: ocultos.has(t.key) ? 0.45 : 1, borderBottom: "1px solid var(--border)" }}>
              <input type="checkbox" checked={!ocultos.has(t.key)} onChange={() => alternar(t.key)} title="Mostrar u ocultar en el mapa" />
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: t.info.color, flex: "0 0 14px", border: "1px solid rgba(0,0,0,.25)" }} />
              <button className="amg-btn ghost" style={{ padding: 0, textAlign: "left", flex: 1, fontSize: 12.5, lineHeight: 1.25 }} title="Centrar el mapa en la ruta de este técnico" onClick={() => setEnfocar({ key: t.key, n: Date.now() })}>
                {t.info.nombre}<div style={{ fontSize: 11, color: "var(--text-faint)" }}>{t.servicios} servicio(s) · {t.puntos.length} {vista === "barrio" ? "barrio(s)" : "zona(s)"}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{t.km === null ? "" : <b style={{ color: "var(--text)" }}>{fmtKm(t.km)}</b>}{t.km === null ? "" : " · "}{fmtMin(t.min)}</div>
                {infoTec && !t.info.sinTecnico && (() => { const x = infoTec(t.key); return x && x.texto ? <div style={{ fontSize: 11, color: x.alerta ? "var(--red)" : "var(--text-faint)" }}>{x.texto}</div> : null; })()}
              </button>
            </div>
          ))}
          {datos.tecnicos.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No hay servicios con ubicación para mostrar con estos filtros.</div>}
        </div>
      </div>
      {verSin && datos.sinUbicacion > 0 && (
        <div className="amg-card" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 600, color: "var(--red)" }}>Servicios sin ubicación ({datos.sinUbicacion})</div>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>No salen en el mapa ni cuentan en el kilometraje. Para ubicarlos, ponle coordenadas a su zona en Maestros → Zonas.</span>
            <button className="amg-btn" style={{ marginLeft: "auto" }} onClick={() => ui.downloadCSV("servicios_sin_ubicacion.csv", ["Servicio", "Cliente", "Técnico", "Departamento", "Ciudad", "Zona", "Barrio", "Motivo"], datos.sinLista.map((x) => [x.servicio, x.cliente, x.tecnico, x.depto, x.ciudad, x.zona, x.barrio, x.motivo]))}>Exportar CSV</button>
          </div>
          <div style={{ overflow: "auto", maxHeight: 260 }}>
            <table className="amg-table compact" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Servicio</th><th>Cliente</th><th>Técnico</th><th>Departamento</th><th>Ciudad</th><th>Zona</th><th>Barrio</th><th>Motivo</th></tr></thead>
              <tbody>{datos.sinLista.map((x) => <tr key={x.servicio}><td className="amg-mono">{x.servicio}</td><td>{x.cliente}</td><td>{x.tecnico}</td><td>{x.depto}</td><td>{x.ciudad}</td><td>{x.zona || "-"}</td><td>{x.barrio || "-"}</td><td style={{ color: "var(--text-dim)" }}>{x.motivo}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
        {mover && mover.puede ? <b>Haz clic en un punto para reasignar sus servicios a otro técnico de la región. </b> : null}Un color por técnico; el número del círculo es la parada en su orden de ruta (en gris, los servicios sin técnico, con la cantidad de servicios). Usa los mismos filtros de Carga (fecha, estado, coordinador...).
        La ubicación es la de la <b>zona equivalente</b> de cada servicio (Maestros → Zonas), no la dirección exacta{vista === "barrio" ? "; los barrios se ubican alrededor del punto de su zona, de forma aproximada" : ""}. Los servicios cuya zona no tiene coordenadas salen en "sin ubicación".
        El kilometraje es la distancia en línea recta entre las zonas de sus paradas, en su orden de ruta (aproximado; no incluye ir ni volver a casa ni los servicios sin ubicación).
        Mostrando {visibles} de {datos.tecnicos.length} técnico(s).
      </div>
    </ui.Modal>
  );
}
