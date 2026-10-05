// Portado de "Asignación BIVER 2.0" (agrupación geográfica Bogotá – Cundinamarca).
/* BIVER · Agrupación geográfica Bogotá – Cundinamarca (región 7)
   Primero agrupar geográficamente, después optimizar operativamente.
   Jerarquía de ubicación: coordenadas → dirección → barrio/sector → localidad → municipio → corredor. */
  const R = Math.PI / 180;
  const km = (a, b) => {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const dLat = (b.lat - a.lat) * R, dLng = (b.lng - a.lng) * R;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(x));
  };
  const U = (v) => (v == null ? '' : String(v)).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const P = (lat, lng) => ({ lat, lng });

  // Localidades de Bogotá: centroide aproximado y radio de aceptación para la ubicación por dirección
  const LOC = {
    USA: { n: 'Usaquén', c: P(4.715, -74.032), r: 4 }, SUB: { n: 'Suba', c: P(4.745, -74.085), r: 4.5 },
    ENG: { n: 'Engativá', c: P(4.705, -74.110), r: 3.5 }, BAR: { n: 'Barrios Unidos', c: P(4.667, -74.075), r: 2 },
    TEU: { n: 'Teusaquillo', c: P(4.640, -74.083), r: 2.2 }, CHA: { n: 'Chapinero', c: P(4.650, -74.058), r: 2.8 },
    SFE: { n: 'Santa Fe', c: P(4.607, -74.066), r: 2 }, CAN: { n: 'La Candelaria', c: P(4.597, -74.073), r: 1 },
    LOS: { n: 'Los Mártires', c: P(4.606, -74.090), r: 1.6 }, ANT: { n: 'Antonio Nariño', c: P(4.589, -74.101), r: 1.5 },
    PUE: { n: 'Puente Aranda', c: P(4.616, -74.112), r: 2.5 }, FON: { n: 'Fontibón', c: P(4.676, -74.145), r: 3 },
    KEN: { n: 'Kennedy', c: P(4.628, -74.155), r: 3.5 }, BOS: { n: 'Bosa', c: P(4.615, -74.192), r: 2.5 },
    CIU: { n: 'Ciudad Bolívar', c: P(4.555, -74.150), r: 3.5 }, TUN: { n: 'Tunjuelito', c: P(4.576, -74.133), r: 2 },
    RAF: { n: 'Rafael Uribe Uribe', c: P(4.570, -74.113), r: 2 }, SCR: { n: 'San Cristóbal', c: P(4.562, -74.085), r: 2.5 },
    USM: { n: 'Usme', c: P(4.490, -74.115), r: 4 },
  };
  const BOG_CENTRO = P(4.630, -74.095);

  // Corredores iniciales (referencias, no reglas rígidas): puntos ancla por sector o municipio
  const CORR = {
    OCCIDENTE: [['Fontibón', 4.676, -74.145], ['Engativá', 4.705, -74.110], ['Kennedy occidental', 4.645, -74.165], ['Funza', 4.7166, -74.2118], ['Mosquera', 4.7059, -74.2302], ['Madrid', 4.7329, -74.2642], ['El Rosal', 4.8530, -74.2602], ['Facatativá', 4.8137, -74.3545], ['Bojacá', 4.7339, -74.3421]],
    NORTE: [['Suba', 4.745, -74.085], ['Usaquén norte', 4.722, -74.038], ['Cota', 4.8097, -74.1017], ['Chía', 4.8619, -74.0523], ['Cajicá', 4.9186, -74.0285], ['Zipaquirá', 5.0221, -73.9947], ['Sopó', 4.9078, -73.9386], ['Tocancipá', 4.9650, -73.9133], ['Tenjo', 4.8717, -74.1447]],
    ORIENTE: [['Chapinero', 4.650, -74.058], ['Usaquén oriental', 4.690, -74.030], ['Teusaquillo', 4.640, -74.080], ['Santa Fe', 4.607, -74.066], ['La Calera', 4.7215, -73.9690]],
    SUR: [['Bosa', 4.615, -74.192], ['Kennedy sur', 4.608, -74.148], ['Ciudad Bolívar', 4.555, -74.150], ['Tunjuelito', 4.576, -74.133], ['Rafael Uribe', 4.570, -74.113], ['San Cristóbal', 4.562, -74.085], ['Usme', 4.490, -74.115], ['Soacha', 4.5794, -74.2168], ['Sibaté', 4.4906, -74.2596], ['Fusagasugá', 4.3378, -74.3639]],
  };
  const ABR = { OCCIDENTE: 'OCC', NORTE: 'NOR', ORIENTE: 'ORI', SUR: 'SUR' };
  const OPP = { OCCIDENTE: 'ORIENTE', ORIENTE: 'OCCIDENTE', NORTE: 'SUR', SUR: 'NORTE' };
  const rel = (a, b) => (a === b ? 'mismo' : OPP[a] === b ? 'opuesto' : 'vecino');

  // Distancia vial estimada: línea recta × factor + costo de cambiar de corredor (atravesar la ciudad)
  function vial(a, b) {
    const d = km(a, b); if (d == null) return null;
    const r = rel(a.corr, b.corr);
    return d * 1.3 + (r === 'mismo' ? 0 : r === 'vecino' ? 3 : 8);
  }

  // Ubicación por dirección en la grilla de Bogotá (calle ≈ norte-sur, carrera ≈ oriente-occidente).
  // Modelo lineal ajustado con puntos de referencia conocidos; precisión ~1,5 km.
  const GRID = { lat: [4.59223474, 7.98385184e-4, 5.26410352e-4], lng: [-74.0762777, 3.95703548e-4, -7.73052533e-4] };
  function parseDir(dir) {
    const s = U(dir).replace(/#/g, ' ').replace(/NO\.?\s/g, ' ').replace(/-/g, ' ');
    const m = s.match(/^(AV(?:ENIDA)?\s+)?(CL|CLL|CALLE|AC|DG|DIAGONAL|KR|CR|CRA|CARRERA|AK|TV|TR|TRANSVERSAL)\.?\s+(\d{1,3})\s*([A-Z]{0,3})?\s*(BIS)?\s*([A-Z])?\s*(SUR|ESTE)?\s+(\d{1,3})\s*([A-Z]{0,3})?\s*(BIS)?\s*([A-Z])?\s*(SUR|ESTE)?\b(.*)$/);
    if (!m) return null;
    const tipo = m[2]; const n1 = +m[3], n2 = +m[8];
    const head = s.slice(0, 32); const sur = /SUR\b/.test(head) || /\d+\s*S\b/.test(head);
    const este = /\bESTE\b/.test(s);
    const esCalle = /^(CL|CLL|CALLE|AC|DG|DIAGONAL)$/.test(tipo);
    let calle = esCalle ? n1 : n2, carrera = esCalle ? n2 : n1;
    if (!isFinite(calle) || !isFinite(carrera) || calle > 250 || carrera > 170) return null;
    if (sur) calle = -calle; if (este) carrera = -carrera;
    return { calle, carrera };
  }
  function gridPoint(dir) {
    const g = parseDir(dir); if (!g) return null;
    const lat = GRID.lat[0] + GRID.lat[1] * g.calle + GRID.lat[2] * g.carrera;
    const lng = GRID.lng[0] + GRID.lng[1] * g.calle + GRID.lng[2] * g.carrera;
    return P(lat, lng);
  }

  function nearestCorr(p) {
    const out = [];
    for (const c in CORR) {
      let best = Infinity, via = '';
      for (const [n, la, ln] of CORR[c]) { const d = km(p, P(la, ln)); if (d < best) { best = d; via = n; } }
      out.push({ c, d: best, via });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  function locateService(s, M) {
    const r = s.rows[0];
    const zona = r.zona || '';
    const loc = (zona.match(/\/([A-Z]{3})$/) || (r.barrio || '').match(/\/([A-Z]{3})$/) || [])[1] || null;
    const esBog = /BOGOTA/.test(U(r.ciudad));
    const municipio = esBog ? 'Bogotá D.C.' : titleCase(r.ciudad);
    let p = null, via = '';
    if (r.lat != null && r.lng != null) { p = P(r.lat, r.lng); via = r.zonaVia === 'municipio' ? 'Municipio' : 'Coordenada del barrio'; }
    if (!p && esBog) {
      const g = gridPoint(r.direccion);
      if (g && loc && LOC[loc] && km(g, LOC[loc].c) <= LOC[loc].r) { p = g; via = 'Dirección (grilla Bogotá)'; }
      else if (g && !loc && km(g, BOG_CENTRO) < 16) { p = g; via = 'Dirección (grilla Bogotá)'; }
    }
    if (!p && loc && LOC[loc]) { p = Object.assign({}, LOC[loc].c); via = 'Localidad (aprox.)'; }
    if (!p && !esBog && M) {
      const z = M.zona['CUN - ' + U(r.ciudad)]; if (z && z[0] != null) { p = P(z[0], z[1]); via = 'Municipio'; }
    }
    if (!p && esBog) { p = Object.assign({}, BOG_CENTRO); via = 'Sin ubicación precisa'; }
    let locF = loc;
    if (!locF && esBog && via !== 'Sin ubicación precisa') { let bd = Infinity; for (const k in LOC) { const d = km(p, LOC[k].c); if (d < bd) { bd = d; locF = k; } } }
    return { p, via, loc: locF, locN: locF && LOC[locF] ? LOC[locF].n : '', municipio, esBog, subzona: zona.replace(/^(BOG|CUN) - /, '') || (r.barrio || '') };
  }
  function titleCase(s) { return (s || '').toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()); }

  // Agrupación jerárquica por enlace promedio (sin romper identidad de municipio)
  function agglomerate(pts, thr) {
    let cl = pts.map((p) => [p]);
    const avg = (A, B) => { let s = 0; for (const a of A) for (const b of B) s += km(a.p, b.p); return s / (A.length * B.length); };
    for (;;) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) { const d = avg(cl[i], cl[j]); if (d < bd) { bd = d; bi = i; bj = j; } }
      if (bi < 0 || bd > thr) break;
      cl[bi] = cl[bi].concat(cl[bj]); cl.splice(bj, 1);
    }
    return cl;
  }

  function levelRank(l) { return { 'Misma zona': 0, Alta: 1, Media: 2, Baja: 3 }[l] ?? 3; }
  function compat(A, B) {
    // A, B: zonas {corr, pts[], esBog, municipio}
    let dmin = Infinity;
    for (const a of A.pts) for (const b of B.pts) { const d = km(a, b); if (d < dmin) dmin = d; }
    const r = rel(A.corr, B.corr);
    const dv = dmin * 1.3 + (r === 'mismo' ? 0 : r === 'vecino' ? 3 : 8);
    let nivel, motivo;
    if (dmin <= 2.5 && r !== 'opuesto') { nivel = 'Alta'; motivo = 'Zonas colindantes'; }
    else if (r === 'mismo' && dv <= 6) { nivel = 'Alta'; motivo = 'Continuidad territorial'; }
    else if (r === 'mismo' && (!A.esBog || !B.esBog) && dv <= 18) { nivel = 'Alta'; motivo = A.esBog !== B.esBog ? 'Corredor directo con Bogotá' : 'Mismo corredor intermunicipal'; }
    else if (r === 'mismo' && dv <= 18) { nivel = 'Media'; motivo = 'Mismo corredor, mayor distancia'; }
    else if (r === 'mismo' && (!A.esBog || !B.esBog) && dv <= 45) { nivel = 'Media'; motivo = 'Mismo corredor, municipio periférico'; }
    else if (r === 'mismo') { nivel = 'Baja'; motivo = 'Mismo corredor pero distante'; }
    else if (r === 'vecino' && dv <= 9) { nivel = 'Media'; motivo = 'Corredores vecinos con conexión directa'; }
    else if (r === 'vecino') { nivel = 'Baja'; motivo = 'Desplazamiento transversal'; }
    else if (dv <= 7) { nivel = 'Media'; motivo = 'Corredores opuestos pero colindantes'; }
    else { nivel = 'Baja'; motivo = 'Cruce geográfico (corredores opuestos)'; }
    return { nivel, motivo, dmin: Math.round(dmin * 10) / 10, dvial: Math.round(dv * 10) / 10 };
  }

  function analyze(services, M) {
    const S = services.map((s) => {
      const L = locateService(s, M);
      const nc = nearestCorr(L.p);
      return { s, L, p: L.p, nc, corr: nc[0].c, d1: nc[0].d, d2: nc[1].d, c2: nc[1].c, frontera: false, nota: '' };
    });
    // Zonas fronterizas: cerca del límite entre dos corredores → se decide por continuidad con los vecinos
    for (const x of S) {
      const amb = x.d1 < 12 && (x.d2 - x.d1 < 1.2 || x.d2 < x.d1 * 1.25);
      if (!amb) continue;
      const votes = {};
      for (const y of S) {
        if (y === x) continue; const d = km(x.p, y.p); if (d > 3.5) continue;
        const amby = y.d1 < 12 && (y.d2 - y.d1 < 1.2 || y.d2 < y.d1 * 1.25); if (amby) continue;
        votes[y.corr] = (votes[y.corr] || 0) + 1 / (d + 0.3);
      }
      const v1 = votes[x.corr] || 0, v2 = votes[x.c2] || 0;
      if (v2 > v1 * 1.5 && v2 > 0.5) { x.corr = x.c2; x.nota = 'Asignado al corredor vecino por continuidad con servicios cercanos'; }
      else if (v1 > v2 * 1.5 && v1 > 0.5) { x.nota = 'Límite entre corredores; se mantiene por continuidad con servicios cercanos'; }
      else { x.frontera = true; x.nota = 'ZONA FRONTERIZA – REVISIÓN'; if (v2 > v1) x.corr = x.c2; }
    }
    // Zonas: Bogotá por proximidad real dentro del corredor; cada municipio conserva su identidad
    const zones = [];
    for (const c of Object.keys(CORR)) {
      const inC = S.filter((x) => x.corr === c);
      const bog = inC.filter((x) => x.L.esBog);
      agglomerate(bog, 3.0).forEach((cl) => zones.push({ corr: c, esBog: true, items: cl }));
      const byMun = {};
      inC.filter((x) => !x.L.esBog).forEach((x) => { (byMun[x.L.municipio] = byMun[x.L.municipio] || []).push(x); });
      for (const m in byMun) agglomerate(byMun[m], 5.0).forEach((cl, i, arr) => zones.push({ corr: c, esBog: false, municipio: m, items: cl, sub: arr.length > 1 ? i + 1 : 0 }));
    }
    const count = {};
    zones.forEach((z) => {
      z.pts = z.items.map((x) => x.p);
      z.c = P(z.pts.reduce((a, p) => a + p.lat, 0) / z.pts.length, z.pts.reduce((a, p) => a + p.lng, 0) / z.pts.length);
      z.radio = Math.max(0, ...z.pts.map((p) => km(p, z.c)));
      const locs = {}; z.items.forEach((x) => { const k = x.L.esBog ? (x.L.locN || 'Bogotá') : x.L.municipio; locs[k] = (locs[k] || 0) + 1; });
      z.sectores = Object.keys(locs).sort((a, b) => locs[b] - locs[a]);
      count[z.corr] = (count[z.corr] || 0) + 1;
      z.id = `${ABR[z.corr]}-${count[z.corr]}`;
      z.nombre = `${z.id} · ${z.esBog ? z.sectores.slice(0, 2).join(' / ') : z.municipio + (z.sub ? ' ' + z.sub : '')}`;
      z.distCentro = km(z.c, BOG_CENTRO);
      z.items.forEach((x) => { x.zona = z; });
    });
    // Matriz de compatibilidad del día
    const matrix = [];
    for (const a of zones) {
      a.vecinas = []; a.compatibles = []; a.incompatibles = [];
      for (const b of zones) {
        if (a === b) continue;
        const k = compat(a, b);
        matrix.push({ origen: a.nombre, destino: b.nombre, a, b, ...k });
        if (k.dmin <= 4) a.vecinas.push(b.nombre);
        (k.nivel === 'Baja' ? a.incompatibles : a.compatibles).push(b.nombre);
      }
    }
    // Tipo de zona
    zones.forEach((z) => {
      const t = [];
      const vecMin = Math.min(Infinity, ...matrix.filter((m) => m.a === z).map((m) => m.dmin));
      if (z.items.length >= 3 && z.radio <= 1.5) t.push('Compacta');
      if (z.radio > 2.5) t.push('Extendida');
      if (!z.esBog || z.distCentro > 17) t.push('Periférica');
      if (vecMin > 10) t.push('Aislada');
      if (z.items.some((x) => x.frontera)) t.push('Fronteriza');
      if (z.sectores.length > 1) t.push('Mixta');
      z.tipo = t.length ? t : ['Estándar'];
    });
    // Afinidad de cada servicio con su zona
    S.forEach((x) => {
      const z = x.zona; const otros = z.items.filter((y) => y !== x);
      const dn = otros.length ? Math.min(...otros.map((y) => km(x.p, y.p))) : null;
      let af;
      if (x.frontera) af = 'Fronteriza';
      else if (x.L.via === 'Sin ubicación precisa' || x.d1 > 25 || z.tipo.includes('Aislada') && !otros.length) af = 'Baja';
      else if (dn != null && dn <= (z.esBog ? 2 : 5) && x.L.via !== 'Localidad (aprox.)') af = 'Alta';
      else if (!z.esBog && !otros.length) af = x.d1 <= 3 ? 'Media' : 'Baja';
      else af = 'Media';
      x.afinidad = af;
    });
    return { S, zones, matrix };
  }

  // Matriz de referencia entre sectores y municipios ancla (sin depender de la carga del día)
  function referencia() {
    const Z = [];
    const MUN = /Funza|Mosquera|Madrid|El Rosal|Facatativá|Bojacá|Cota|Chía|Cajicá|Zipaquirá|Sopó|Tocancipá|Tenjo|La Calera|Soacha|Sibaté|Fusagasugá/;
    for (const c in CORR) for (const [n, la, ln] of CORR[c]) Z.push({ nombre: n, corr: c, esBog: !MUN.test(n), pts: [P(la, ln)] });
    const out = [];
    for (const a of Z) for (const b of Z) if (a !== b) out.push({ origen: a.nombre, corrO: a.corr, destino: b.nombre, corrD: b.corr, ...compat(a, b) });
    return out;
  }

  // Aplica el análisis a los servicios (s.geo) y devuelve el resumen para la interfaz y exportes
  function applyGeo(services, M) {
    if (!services.length) return null;
    const G = analyze(services, M);
    const cmap = new Map();
    for (const m of G.matrix) cmap.set(m.a.id + '>' + m.b.id, m.nivel);
    G.nivel = (za, zb) => (za === zb ? 'Misma zona' : cmap.get(za + '>' + zb) || 'Baja');
    G.S.forEach((x) => {
      const s = x.s;
      s.geo = {
        corr: x.corr, corr2: x.c2, frontera: x.frontera, nota: x.nota, zonaId: x.zona.id, zona: x.zona.nombre, subzona: x.L.subzona,
        localidad: x.L.locN, municipio: x.L.municipio, via: x.L.via, afinidad: x.afinidad, lat: x.p.lat, lng: x.p.lng,
        compatibles: x.zona.compatibles, noRecomendadas: x.zona.incompatibles, ancla: x.nc[0].via, dCorr: Math.round(x.d1 * 10) / 10,
      };
      if (s.lat == null) { s.lat = x.p.lat; s.lng = x.p.lng; s.latAprox = true; }
    });
    return G;
  }

  export { applyGeo, referencia, vial, km, gridPoint, parseDir, CORR, LOC, BOG_CENTRO, levelRank, OPP, ABR };
