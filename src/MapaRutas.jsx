import { useState, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as D from "./lib/asignacion/data";

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
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Para que no se encimen los puntos de una misma zona: los barrios se ubican en anillos (en grados) alrededor de la zona, y los técnicos que coinciden en un mismo punto
// se separan unos píxeles entre sí en pantalla (así se ven a cualquier zoom).
const anillo = (k) => (k === 0 ? [0, 0] : (() => { const r = 0.006 * (1 + Math.floor((k - 1) / 8)), a = (2 * Math.PI * ((k - 1) % 8)) / 8; return [r * Math.sin(a), r * Math.cos(a)]; })());
const ranuraPx = (t, n) => (n <= 1 ? [0, 0] : [11 * Math.sin((2 * Math.PI * t) / n), -11 * Math.cos((2 * Math.PI * t) / n)]);

export default function MapaRutasModal({ ui, rows, regionOf, regionLabel, techName, techOrden, regionInicial, onClose }) {
  const [region, setRegion] = useState(regionInicial || "");
  const [vista, setVista] = useState("zona"); // zona | barrio
  const [ocultos, setOcultos] = useState(() => new Set());
  const [enfocar, setEnfocar] = useState(null); // { key, n } para centrar el mapa en un técnico
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
    const sinUbicacion = new Set();
    const servicios = new Set();
    enRegion.forEach((s) => {
      const key = s.technicianId || `n:${s.tecnico2Nombre || ""}`;
      const info = tecnicos.get(s.technicianId || "") || { key, nombre: s.tecnico2Nombre || "Sin técnico", color: GRIS, sinTecnico: true };
      const c = coordsDe(s);
      servicios.add(String(s.servicioExterno));
      if (!c) { sinUbicacion.add(String(s.servicioExterno)); return; }
      const a = s.asig || {};
      const zona = a.zona || a.ciudad || s.ciudadExterna || "Sin zona";
      const barrio = a.barrio || "";
      const pk = vista === "barrio" ? `${zona}|${barrio}` : zona;
      const g = porTec.get(key) || { info, puntos: new Map() };
      const p = g.puntos.get(pk) || { pk, zona, barrio, ciudad: a.ciudad || s.ciudadExterna || "", base: c, servicios: new Map(), orden: null };
      const sv = p.servicios.get(String(s.servicioExterno)) || { servicio: String(s.servicioExterno), cliente: s.clienteNombre || "", productos: 0 };
      sv.productos += 1;
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
        return { ...p, lat: p.base.lat + dy, lng: p.base.lng + dx, ranura: b.tecs.indexOf(key), nRanuras: b.tecs.length, lista: [...p.servicios.values()] };
      }).sort((x, y) => (x.orden ?? 9999) - (y.orden ?? 9999) || x.zona.localeCompare(y.zona, "es"));
      return { key, info: g.info, puntos, servicios: puntos.reduce((n, p) => n + p.lista.length, 0) };
    }).sort((a, b) => (a.info.sinTecnico ? 1 : 0) - (b.info.sinTecnico ? 1 : 0) || String(a.info.nombre).localeCompare(String(b.info.nombre), "es"));
    return { tecnicos: tecnicosOut, sinUbicacion: sinUbicacion.size, total: servicios.size };
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
        const lista = p.lista.slice(0, 12).map((s) => `${esc(s.servicio)}${s.cliente ? ` · ${esc(s.cliente)}` : ""}${s.productos > 1 ? ` (${s.productos} prod.)` : ""}`).join("<br>");
        L.marker([p.lat, p.lng], { icon: icono }).bindTooltip(
          `<b>${esc(t.info.nombre)}</b>${t.info.sinTecnico ? "" : ` · parada ${esc(etiqueta)}`}<br>${vista === "barrio" && p.barrio ? `Barrio: ${esc(p.barrio)}<br>` : ""}Zona: ${esc(p.zona)}${p.ciudad ? ` · ${esc(p.ciudad)}` : ""}<br>${p.lista.length} servicio(s)<br>${lista}${p.lista.length > 12 ? `<br>y ${p.lista.length - 12} más…` : ""}`,
          { direction: "top", offset: [0, -12] }).addTo(g);
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

  const alternar = (key) => setOcultos((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const visibles = datos.tecnicos.length - datos.tecnicos.filter((t) => ocultos.has(t.key)).length;

  return (
    <ui.Modal title="Mapa de rutas" onClose={onClose} width={1250} footer={<button className="amg-btn" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <select className="amg-select" style={{ width: 220 }} value={region} onChange={(e) => { setRegion(e.target.value); setEnfocar(null); }}>
          <option value="">Todas las regiones</option>{regiones.map((r) => <option key={r} value={String(r)}>{regionLabel(r)}</option>)}
        </select>
        <select className="amg-select" style={{ width: 220 }} value={vista} onChange={(e) => setVista(e.target.value)}>
          <option value="zona">Ver por zona equivalente</option><option value="barrio">Ver por barrio</option>
        </select>
        <span style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{datos.total} servicio(s) · {datos.tecnicos.length} técnico(s){datos.sinUbicacion ? ` · ` : ""}{datos.sinUbicacion ? <b style={{ color: "var(--red)" }}>{datos.sinUbicacion} sin ubicación</b> : null}</span>
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
              </button>
            </div>
          ))}
          {datos.tecnicos.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>No hay servicios con ubicación para mostrar con estos filtros.</div>}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
        Un color por técnico; el número del círculo es la parada en su orden de ruta (en gris, los servicios sin técnico, con la cantidad de servicios). Usa los mismos filtros de Carga (fecha, estado, coordinador...).
        La ubicación es la de la <b>zona equivalente</b> de cada servicio (Maestros → Zonas), no la dirección exacta{vista === "barrio" ? "; los barrios se ubican alrededor del punto de su zona, de forma aproximada" : ""}. Los servicios cuya zona no tiene coordenadas salen en "sin ubicación".
        Mostrando {visibles} de {datos.tecnicos.length} técnico(s).
      </div>
    </ui.Modal>
  );
}
