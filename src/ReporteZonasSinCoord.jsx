import { useState, useEffect, useMemo } from "react";
import { fetchAll } from "./lib/maestrosApi";

/* ============================================================================
   DATOS FALTANTES PARA ASIGNAR Y PARA EL MAPA DE RUTAS
   Tres listados en un solo reporte, para completar los maestros:
    · Zonas sin coordenadas: zonas equivalentes activas sin latitud y longitud válidas (sus servicios no salen en el Mapa de rutas ni cuentan en el kilometraje).
    · Productos sin tiempo: productos del maestro sin minutos de armado y productos de Carga sin tiempo (el motor los asigna con 0 minutos o "SIN TIEMPO").
    · Barrios sin zona equivalente: barrios del maestro que no apuntan a una zona activa y barrios que llegan en los servicios de Carga y no están en el maestro
      (se asignaron con la zona del municipio o sin zona).
   Cada fila dice cuántos servicios de Carga (no finalizados ni anulados) afecta, para completar primero lo que más pesa. Se corrige en Maestros.
============================================================================ */

const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const okLL = (a, b) => a !== null && b !== null && a > -5 && a < 14 && b > -80 && b < -66; // dentro de Colombia
const TABS = [{ key: "zonas", label: "Zonas sin coordenadas" }, { key: "productos", label: "Productos sin tiempo" }, { key: "barrios", label: "Barrios sin zona equivalente" }];

export default function ReporteZonasSinCoord({ db, ui }) {
  const [datos, setDatos] = useState(null); // { zonas, barrios, deptos, productos }
  const [error, setError] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [tab, setTab] = useState("zonas");
  const [q, setQ] = useState("");
  const [depto, setDepto] = useState("");
  const [region, setRegion] = useState("");
  const [tipo, setTipo] = useState("");
  const [soloAfectan, setSoloAfectan] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(""); setDatos(null);
    Promise.all([
      fetchAll("geo_zones", "id,name,latitude,longitude,zone_id,cluster,region,zone_type,dept_abbr,active", "id"),
      fetchAll("geo_neighborhoods", "id,city,neighborhood,region,zone_type,zone_id,active", "id"),
      fetchAll("geo_abbreviations", "*", "abbr"),
      fetchAll("assembly_products", "code,name,minutes,line,subline,active", "id"),
    ]).then(([zonas, barrios, deptos, productos]) => { if (alive) setDatos({ zonas, barrios, deptos, productos }); })
      .catch((e) => { if (alive) { setDatos({ zonas: [], barrios: [], deptos: [], productos: [] }); setError(e.message); } });
    return () => { alive = false; };
  }, [recarga]);

  // Lo que hay hoy en Carga (no finalizado ni anulado).
  const carga = useMemo(() => (db.services || []).filter((s) => s.servicioExterno && !s.finalizedAt && !(s.asig && s.asig.anulada)), [db.services]);

  const R = useMemo(() => {
    if (!datos) return null;
    const deptoDe = Object.fromEntries(datos.deptos.map((d) => [d.abbr, d.name]));
    const zonasPorId = new Map(datos.zonas.map((z) => [z.id, z]));

    // ---- Zonas sin coordenadas ----
    const nBarrios = new Map();
    datos.barrios.filter((b) => b.active !== false).forEach((b) => nBarrios.set(b.zone_id, (nBarrios.get(b.zone_id) || 0) + 1));
    const usoZona = new Map(); let sinZonaCarga = new Set();
    carga.forEach((s) => {
      const z = s.asig && s.asig.zona ? plano(s.asig.zona) : "";
      const sv = String(s.servicioExterno);
      if (!z) { sinZonaCarga.add(sv); return; }
      const set = usoZona.get(z) || new Set(); set.add(sv); usoZona.set(z, set);
    });
    const zonas = datos.zonas.filter((z) => z.active !== false && !okLL(num(z.latitude), num(z.longitude))).map((z) => {
      const la = num(z.latitude), lo = num(z.longitude);
      return {
        id: z.id, zona: z.name, idzona: z.zone_id, region: z.region, tipo: z.zone_type || "", depto: deptoDe[z.dept_abbr] || z.dept_abbr || "", barrios: nBarrios.get(z.id) || 0,
        servicios: (usoZona.get(plano(z.name)) || new Set()).size,
        motivo: la === null && lo === null ? "Sin latitud ni longitud" : la === null ? "Falta la latitud" : lo === null ? "Falta la longitud" : "Coordenadas fuera de Colombia (revisa que no estén invertidas)", lat: la, lng: lo,
      };
    });

    // ---- Productos sin tiempo ----
    const enMaestro = new Map(datos.productos.filter((p) => p.active !== false).map((p) => [String(p.code).trim(), p]));
    const prod = new Map(); // llave → fila
    carga.filter((s) => !(Number(s.tiempoMin) > 0)).forEach((s) => {
      const codigo = String(s.productoExternoCodigo || "").trim(), nombre = s.productoExternoNombre || (s.asig && s.asig.producto) || "";
      const k = codigo || plano(nombre); if (!k) return;
      const m = enMaestro.get(codigo);
      const f = prod.get(k) || { k, codigo, producto: nombre, linea: (m && m.line) || (s.asig && s.asig.linea) || "", sublinea: (m && m.subline) || (s.asig && s.asig.sublinea) || "", unidades: 0, svs: new Set(),
        origen: !m ? "No está en el maestro de productos" : !(Number(m.minutes) > 0) ? "Está en el maestro, sin minutos" : "En Carga sin tiempo (el maestro sí tiene minutos: vuelve a asignar)" };
      f.unidades += 1; f.svs.add(String(s.servicioExterno)); prod.set(k, f);
    });
    datos.productos.filter((p) => p.active !== false && !(Number(p.minutes) > 0)).forEach((p) => {
      const k = String(p.code).trim();
      if (!prod.has(k)) prod.set(k, { k, codigo: k, producto: p.name, linea: p.line || "", sublinea: p.subline || "", unidades: 0, svs: new Set(), origen: "Está en el maestro, sin minutos" });
    });
    const productos = [...prod.values()].map((f) => ({ ...f, servicios: f.svs.size }));

    // ---- Barrios sin zona equivalente ----
    const barrios = [];
    datos.barrios.filter((b) => b.active !== false).forEach((b) => {
      const z = b.zone_id ? zonasPorId.get(b.zone_id) : null;
      const motivo = !b.zone_id ? "El barrio no tiene zona equivalente" : !z ? "La zona equivalente ya no existe" : z.active === false ? `La zona "${z.name}" está inactiva` : "";
      if (motivo) barrios.push({ k: `m|${b.id}`, origen: "Maestro", depto: "", ciudad: b.city || "", barrio: b.neighborhood || "", region: b.region, tipo: b.zone_type || "", servicios: 0, motivo });
    });
    const enc = new Map(); // barrios de Carga que no se encontraron en el maestro
    carga.forEach((s) => {
      const a = s.asig || {};
      if (!a.barrio || a.zonaVia === "barrio" || a.zonaVia === "manual" || a.zonaVia === "archivo") return;
      const k = `c|${plano(a.depto)}|${plano(a.ciudad)}|${plano(a.barrio)}`;
      const f = enc.get(k) || { k, origen: "Carga", depto: a.depto || s.departamentoExterno || "", ciudad: a.ciudad || s.ciudadExterna || "", barrio: a.barrio, region: a.region ?? null, tipo: "",
        svs: new Set(), motivo: a.zonaVia === "municipio" ? `El barrio no está en el maestro: se usó la zona del municipio (${a.zona || "-"})` : "El barrio no está en el maestro y no se encontró zona" };
      f.svs.add(String(s.servicioExterno)); enc.set(k, f);
    });
    enc.forEach((f) => barrios.push({ ...f, servicios: f.svs.size }));

    const ord = (a, b) => b.servicios - a.servicios;
    zonas.sort((a, b) => ord(a, b) || b.barrios - a.barrios || String(a.zona).localeCompare(String(b.zona), "es"));
    productos.sort((a, b) => ord(a, b) || b.unidades - a.unidades || String(a.producto).localeCompare(String(b.producto), "es"));
    barrios.sort((a, b) => ord(a, b) || String(a.ciudad).localeCompare(String(b.ciudad), "es") || String(a.barrio).localeCompare(String(b.barrio), "es"));
    return { zonas, productos, barrios, activas: datos.zonas.filter((z) => z.active !== false).length, sinZonaCarga: sinZonaCarga.size };
  }, [datos, carga]);

  const filtrar = (lista, campos) => lista.filter((f) => (!q.trim() || campos(f).some((c) => plano(c).includes(plano(q)))) && (!soloAfectan || f.servicios > 0)
    && (!depto || f.depto === depto) && (!region || String(f.region) === region) && (!tipo || f.tipo === tipo));
  const lista = R ? (tab === "zonas" ? filtrar(R.zonas, (f) => [f.zona]) : tab === "productos" ? filtrar(R.productos.map((p) => ({ ...p, servicios: p.servicios })), (f) => [f.producto, f.codigo, f.linea]) : filtrar(R.barrios, (f) => [f.barrio, f.ciudad])) : [];
  const cuenta = (k) => (R ? R[k].length : "...");
  const afectados = (k) => (R ? R[k].reduce((s, f) => s + f.servicios, 0) : 0);

  const regiones = useMemo(() => (R ? [...new Set([...R.zonas, ...R.barrios].map((f) => f.region).filter((r) => r !== null && r !== undefined))].sort((a, b) => a - b) : []), [R]);
  const deptosOpt = useMemo(() => (R ? [...new Set([...R.zonas, ...R.barrios].map((f) => f.depto).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")) : []), [R]);

  const exportar = () => {
    if (tab === "zonas") ui.downloadCSV("zonas_sin_coordenadas.csv", ["Zona equivalente", "IDZona", "Región", "Departamento", "Tipo", "Barrios que apuntan", "Servicios en Carga", "Motivo", "Latitud", "Longitud"], lista.map((f) => [f.zona, f.idzona ?? "", f.region ?? "", f.depto, f.tipo, f.barrios, f.servicios, f.motivo, f.lat ?? "", f.lng ?? ""]));
    else if (tab === "productos") ui.downloadCSV("productos_sin_tiempo.csv", ["Código", "Producto", "Línea", "Sublínea", "Situación", "Unidades en Carga sin tiempo", "Servicios en Carga"], lista.map((f) => [f.codigo, f.producto, f.linea, f.sublinea, f.origen, f.unidades, f.servicios]));
    else ui.downloadCSV("barrios_sin_zona_equivalente.csv", ["Dónde", "Departamento", "Ciudad / municipio", "Barrio", "Región", "Servicios en Carga", "Motivo"], lista.map((f) => [f.origen, f.depto, f.ciudad, f.barrio, f.region ?? "", f.servicios, f.motivo]));
  };

  const th = { zonas: ["Zona equivalente", "IDZona", "Región", "Departamento", "Tipo", "Barrios que apuntan", "Servicios en Carga", "Motivo"], productos: ["Código", "Producto", "Línea", "Sublínea", "Situación", "Unidades en Carga sin tiempo", "Servicios en Carga"], barrios: ["Dónde", "Departamento", "Ciudad / municipio", "Barrio", "Región", "Servicios en Carga", "Motivo"] }[tab];
  const rojo = (n) => ({ color: n ? "var(--red)" : undefined, fontWeight: n ? 700 : undefined });
  const ayuda = { zonas: "Se corrige en Maestros → Zonas equivalentes: edita la zona y pon su Latitud y Longitud.", productos: "Se corrige en Maestros → Productos de armado: pon los minutos del producto. Los de Carga ya asignados toman el tiempo al volver a asignar.", barrios: "Se corrige en Maestros → Zonas equivalentes → Barrios: crea el barrio y apúntalo a su zona equivalente (o apunta a una zona activa los que la tienen mal)." }[tab];

  return (
    <div className="amg-card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Datos faltantes: zonas sin coordenadas, productos sin tiempo y barrios sin zona</div>
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 12 }}>Lo que falta en los maestros para asignar bien y para que los servicios salgan en el Mapa de rutas. Cada fila dice cuántos servicios de Carga afecta, para completar primero lo que más pesa.</div>
      {error && <div className="amg-alert danger" style={{ marginBottom: 10 }}>No se pudieron leer los maestros: {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px,1fr))", gap: 12, marginBottom: 12 }}>
        <ui.StatCard label="Zonas sin coordenadas" value={cuenta("zonas")} sub={R ? `de ${R.activas} zonas activas · ${afectados("zonas")} servicios en Carga` : ""} accent={tab === "zonas"} />
        <ui.StatCard label="Productos sin tiempo" value={cuenta("productos")} sub={R ? `${afectados("productos")} servicios en Carga afectados` : ""} accent={tab === "productos"} />
        <ui.StatCard label="Barrios sin zona equivalente" value={cuenta("barrios")} sub={R ? `${afectados("barrios")} servicios en Carga afectados` : ""} accent={tab === "barrios"} />
        <ui.StatCard label="Servicios en Carga sin zona" value={R ? R.sinZonaCarga : "..."} sub="ni barrio ni municipio en Maestros" />
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {TABS.map((t) => <button key={t.key} className={`amg-btn ${tab === t.key ? "primary" : ""}`} onClick={() => setTab(t.key)}>{t.label}{R ? ` (${R[t.key].length})` : ""}</button>)}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <input className="amg-input" style={{ width: 210 }} placeholder={tab === "productos" ? "Buscar producto o código..." : tab === "barrios" ? "Buscar barrio o ciudad..." : "Buscar zona..."} value={q} onChange={(e) => setQ(e.target.value)} />
        {tab !== "productos" && (
          <select className="amg-select" style={{ width: 190 }} value={depto} onChange={(e) => setDepto(e.target.value)}>
            <option value="">Todos los departamentos</option>{deptosOpt.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {tab !== "productos" && (
          <select className="amg-select" style={{ width: 150 }} value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">Todas las regiones</option>{regiones.map((r) => <option key={r} value={String(r)}>Región {r}</option>)}
          </select>
        )}
        {tab === "zonas" && (
          <select className="amg-select" style={{ width: 150 }} value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos los tipos</option><option value="MUNICIPIO">Municipio</option><option value="BARRIO">Barrio</option>
          </select>
        )}
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={soloAfectan} onChange={(e) => setSoloAfectan(e.target.checked)} /> Solo los que afectan servicios en Carga</label>
        <button className="amg-btn" onClick={() => setRecarga((n) => n + 1)} title="Vuelve a leer los maestros (después de corregirlos)">Actualizar</button>
        <button className="amg-btn" style={{ marginLeft: "auto" }} disabled={!lista.length} onClick={exportar}>Exportar CSV</button>
      </div>

      <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
        <table className="amg-table" style={{ fontSize: 12.5 }}>
          <thead><tr>{th.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {tab === "zonas" && lista.map((f) => (
              <tr key={f.id}><td><b>{f.zona}</b></td><td className="amg-mono">{f.idzona ?? "-"}</td><td className="amg-mono">{f.region ?? "-"}</td><td>{f.depto || "-"}</td><td>{f.tipo || "-"}</td>
                <td className="amg-mono">{f.barrios}</td><td className="amg-mono" style={rojo(f.servicios)}>{f.servicios}</td><td style={{ color: "var(--text-dim)" }}>{f.motivo}</td></tr>
            ))}
            {tab === "productos" && lista.map((f) => (
              <tr key={f.k}><td className="amg-mono">{f.codigo || "-"}</td><td><b>{f.producto || "-"}</b></td><td>{f.linea || "-"}</td><td>{f.sublinea || "-"}</td><td style={{ color: "var(--text-dim)" }}>{f.origen}</td>
                <td className="amg-mono" style={rojo(f.unidades)}>{f.unidades}</td><td className="amg-mono">{f.servicios}</td></tr>
            ))}
            {tab === "barrios" && lista.map((f) => (
              <tr key={f.k}><td>{f.origen === "Carga" ? "Carga (servicios)" : "Maestro de barrios"}</td><td>{f.depto || "-"}</td><td>{f.ciudad || "-"}</td><td><b>{f.barrio || "-"}</b></td><td className="amg-mono">{f.region ?? "-"}</td>
                <td className="amg-mono" style={rojo(f.servicios)}>{f.servicios}</td><td style={{ color: "var(--text-dim)" }}>{f.motivo}</td></tr>
            ))}
            {!R && <tr><td colSpan={th.length} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>Cargando maestros...</td></tr>}
            {R && lista.length === 0 && <tr><td colSpan={th.length} style={{ textAlign: "center", color: "var(--text-faint)", padding: 20 }}>{R[tab].length ? "Nada coincide con los filtros." : "No falta nada en esta lista."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8 }}>
        {ayuda} "Servicios en Carga" cuenta los registros no finalizados ni anulados. Las zonas y los barrios inactivos no se listan. Una zona queda "sin coordenadas" si le falta la latitud o la longitud, o si están fuera de Colombia (por ejemplo, invertidas).
      </div>
    </div>
  );
}
