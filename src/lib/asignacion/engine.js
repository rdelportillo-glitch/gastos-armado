// Portado de "Asignación BIVER 2.0": enriquecimiento de la base + motor de asignación de servicios.
import * as GeoMod from "./geo.js";
/* BIVER · Motor de asignación de servicios
   Enriquecimiento (equivalente al Power Query del Tablero V3) + reglas del Ruteitor. */

  // ---------- utilidades ----------
  const U = (v) => (v == null ? '' : String(v)).replace(/\u00a0/g, ' ').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
  const deaccent = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
  const txt = (v) => (v == null ? '' : String(v)).replace(/\u00a0/g, ' ').trim();
  const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];

  const validLL = (lat, lng) => lat != null && lng != null && lat > -5 && lat < 14 && lng > -80 && lng < -66;
  function haversine(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const R = 6371, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function toISODate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') { // serial Excel
      const d = new Date(Math.round((v - 25569) * 86400000));
      return d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return s;
  }

  // Índices de maestros con claves normalizadas (sin tildes) para tolerar variaciones de escritura
  function buildIndex(M) {
    const idx = { barrio: new Map(), municipio: new Map(), zona: new Map(), compl: new Map() };
    for (const k in M.barrio) idx.barrio.set(deaccent(U(k)), M.barrio[k]);
    for (const k in M.municipio) idx.municipio.set(deaccent(U(k)), M.municipio[k]);
    for (const k in M.zona) idx.zona.set(U(k), M.zona[k]);
    for (const k in M.complejidad) idx.compl.set(deaccent(U(k)), M.complejidad[k]);
    return idx;
  }

  // Columnas por nombre, tolerante a variantes
  function pick(r, ...names) {
    for (const n of names) if (r[n] != null && r[n] !== '') return r[n];
    return null;
  }

  const CIUDAD_POR_BARRIO = ['PUNTA CANOA', 'BONDA', 'DON JACA', 'BAHIA CONCHA', 'ALTOS DE BAHIA CONCHA', 'TIERRA BAJA'];

  function tipoServicio(rep) {
    const s = deaccent(U(rep));
    if (s.includes('DESARME')) return 'Desarme';
    if (s.includes('EMPAQUE')) return 'Empaque';
    if (s.includes('INSTALACION DE PIEZA')) return 'Instalación de pieza';
    return 'Armado';
  }
  function prioridad(rep) {
    const s = deaccent(U(rep));
    if (['NO DEVOLVER', 'RUTA CRITICA', 'INCUMPLIMIENTO', 'EMPAQUE'].some((k) => s.includes(k))) return 'Prioridad 1';
    return 'Normal';
  }

  function locate(M, idx, deptoName, ciudad, barrio) {
    const c = deaccent(U(ciudad)), b = deaccent(U(barrio));
    // Cambio frente al HTML original: la llave incluye la región del departamento, porque un mismo
    // municipio/barrio puede existir en departamentos distintos (Cascajal en Atlántico y en Bolívar).
    const reg0 = M.region[deaccent(U(deptoName))];
    const pre = reg0 != null ? reg0 + '|' : '';
    let zona = idx.barrio.get(pre + c + '|' + b) || null, via = zona ? 'barrio' : null;
    if (!zona) { zona = idx.municipio.get(pre + c) || null; via = zona ? 'municipio' : null; }
    let zi = zona ? idx.zona.get(U(zona)) : null; // [lat,lng,idzona,cluster,region]
    if (zi && !validLL(zi[0], zi[1])) zi = [null, null, zi[2], zi[3], zi[4], zi[5]];
    let region = zi && zi[4] != null ? zi[4] : null;
    if (region == null) region = M.region[deaccent(U(deptoName))] ?? null;
    return { zona, via, lat: zi ? zi[0] : null, lng: zi ? zi[1] : null, idzona: zi ? zi[2] : null, cluster: zi ? zi[3] : null, zc: zi ? zi[5] ?? null : null, region };
  }

  // ---------- Enriquecimiento de la Base de Asignación (Jamar) ----------
  function enrichBase(rows, M, idx, opts = {}) {
    const out = [];
    const seen = new Set();
    const hdr = rows.length ? Object.keys(rows[0]) : [];
    const preEnriched = hdr.includes('Zona Equivalente') && hdr.includes('Región');
    for (const r of rows) {
      const servicio = txt(pick(r, 'SERVICIO'));
      if (!servicio) continue;
      const depCode = U(pick(r, 'DEPARTAMENTO'));
      const deptoName = U(pick(r, 'NOMBRE DEPARTAMENTO')) || M.depto[depCode] || depCode;
      if (!deptoName) continue;
      let ciudad = U(pick(r, 'Nombre_Ciudad', 'Nombre Ciudad'));
      if (!ciudad) ciudad = U(M.pueblo[depCode + '|' + U(pick(r, 'CIUDAD'))] || '');
      const barrio = U(pick(r, 'BARRIO'));
      if (CIUDAD_POR_BARRIO.includes(barrio)) ciudad = barrio;
      const nombreProdRaw = txt(pick(r, 'NOMBRE PRODUCTO', 'NOMBREPROD'));
      const codigo = txt(pick(r, 'CODIGO'));
      const rep = txt(pick(r, 'CLIENTEREPORTA'));
      const key = [servicio, codigo, nombreProdRaw, rep, txt(pick(r, 'DIRECCION')), pick(r, 'Cantidad'), txt(pick(r, 'Llave'))].join('¦');
      if (seen.has(key)) continue; seen.add(key);

      const linea = txt(pick(r, 'LINEA', 'Nom_Sublineas.Nombre Linea'));
      const sublinea = txt(pick(r, 'SUBLINEA', 'Nom_Sublineas.Nombre Sublinea'));
      const cx = idx.compl.get(deaccent(U(linea + '|' + sublinea))) || null;
      let loc;
      if (preEnriched && pick(r, 'Zona Equivalente')) {
        let zi = idx.zona.get(U(pick(r, 'Zona Equivalente')));
        if (zi && !validLL(zi[0], zi[1])) zi = [null, null, zi[2], zi[3], zi[4], zi[5]];
        loc = { zona: txt(pick(r, 'Zona Equivalente')), via: 'archivo', lat: zi ? zi[0] : null, lng: zi ? zi[1] : null, idzona: num(pick(r, 'IDZona')) ?? (zi ? zi[2] : null), cluster: zi ? zi[3] : null, zc: zi ? zi[5] ?? null : null, region: num(pick(r, 'Región')) };
      } else loc = locate(M, idx, deptoName, ciudad, barrio);

      const complejidad = txt(pick(r, 'Complejidad.1')) || (cx ? cx[0] : '');
      const empotrable = (txt(pick(r, 'Empotrable')) || (cx ? cx[1] : '')) === 'Si';
      const prodM = M.producto[codigo] || null;
      const cantidad = Math.max(1, num(pick(r, 'Cantidad')) || 1);
      const tArmado = num(pick(r, 'Tiempo ARMADO', 'Tiempo', 'DURACION'));
      const tBiver = num(pick(r, 'Productos.TIEMPOS'));
      const tiempoProducto = (tBiver && tBiver > 0 ? tBiver : null) ?? (prodM && prodM[0] ? prodM[0] : null);
      const personas = num(pick(r, 'Productos.# Personas Armado', '2 Personas.Número de personas requeridos')) || (prodM ? prodM[1] : 1) || 1;
      const nombreProd = nombreProdRaw.replace(/^\(\d+\)\s*/, '').split('[')[0].trim();
      const km = M.distancia[deaccent(deptoName) + '|' + deaccent(ciudad)];
      const tipo = txt(pick(r, 'Tipo de Servicio')) || tipoServicio(rep);
      const prio = txt(pick(r, 'Prioridad')) || prioridad(rep);
      const reps = preEnriched ? 1 : cantidad; // el Power Query expande una fila por unidad
      for (let i = 0; i < reps; i++) {
        const tUnit = tArmado != null ? tArmado / (preEnriched ? 1 : cantidad) : null;
        const tiempo = tiempoProducto ?? (tUnit ? tUnit : null);
        out.push({
          empresa: txt(pick(r, 'EMPRESA', 'Empresa')) || 'JAMAR',
          fecha: toISODate(pick(r, 'FECHA_PROG', 'FECHA')),
          servicio, cliente: txt(pick(r, 'NOMBRECLIENTE')).replace(/&/g, 'Y'),
          direccion: txt(pick(r, 'DIRECCION')).replace(/#/g, 'No '), telefono: txt(pick(r, 'TELEFONO')),
          senas: txt(pick(r, 'SENAS')).replace(/#/g, 'No '), depto: deptoName, ciudad, barrio,
          deptoCod: depCode, ciudadCod: txt(pick(r, 'CIUDAD')),
          producto: nombreProd, codigo, linea, sublinea, tiempoArmado: tUnit,
          tiempo: tiempo != null ? Math.round(tiempo) : null, tiempoFuente: tiempoProducto != null ? 'BIVER' : (tUnit ? 'JAMAR' : 'SIN TIEMPO'),
          tipo, reporta: txt(rep).replace(/#/g, 'No '), usuarioOriginal: txt(pick(r, 'TECNICO')),
          agencia: txt(pick(r, 'AGENCIA')), clienteId: txt(pick(r, 'CLIENTE')), prioridad: prio,
          zona: loc.zona, zonaVia: loc.via, idzona: loc.idzona, cluster: loc.cluster, zc: loc.zc, region: loc.region, lat: loc.lat, lng: loc.lng,
          complejidad, empotrable, personas: personas >= 2 ? 2 : 1,
          perfil: (complejidad === 'Alta' || empotrable) ? 'Maestro' : 'Aprendiz',
          km: km ? km[0] : null, tipoArmado: txt(pick(r, 'TIPOARMADO')), origen: txt(pick(r, '_origen')) || 'Base',
        });
      }
    }
    return out;
  }

  // Base TUGO (viernes)
  function enrichTugo(rows, M, idx) {
    return enrichBase(rows.map((r) => {
      const dep = U(r['Departamento']).includes('MAG') ? 'MA' : 'BO';
      let ciudad = U(r['Ciudad Destino']); if (ciudad === 'CARTAGENA') ciudad = 'CARTAGENA DE INDIAS';
      return {
        EMPRESA: 'TUGO', FECHA_PROG: r['FECHA SERVICIO'], SERVICIO: r['evento'], NOMBRECLIENTE: r['Nombre Cliente'],
        DIRECCION: txt(r['Direccion Envio']).split('\n')[0], TELEFONO: r['Telefono 1'], DEPARTAMENTO: dep, 'Nombre_Ciudad': ciudad,
        'NOMBRE PRODUCTO': r['Descripcion Item'], CODIGO: r['Codigo Item'], 'Tiempo ARMADO': r['TIEMPO TIPOLOGIA'],
        'Productos.TIEMPOS': r['TIEMPO TIPOLOGIA'], CLIENTEREPORTA: r['Nombre Proceso'], 'Tipo de Servicio': 'Armado', Prioridad: 'Normal',
        Cantidad: 1, _origen: 'TUGO',
      };
    }), M, idx);
  }

  // Pendientes desde la PLANTILLA CARGA del día (hoja CONSOLIDADO)
  function enrichPendientes(rows, M, idx, fechaNueva) {
    const inv = {}; for (const k in M.depto) inv[M.depto[k]] = k;
    return enrichBase(rows.map((r) => ({
      EMPRESA: r['EMPRESA'], FECHA_PROG: fechaNueva || r['FECHA'], SERVICIO: r['SERVICIO'], NOMBRECLIENTE: r['NOMBRE CLIENTE'],
      DIRECCION: r['DIRECCIÓN'], TELEFONO: r['TELEFONO'], SENAS: r['SEÑAS'], DEPARTAMENTO: inv[U(r['DPTO'])] || U(r['DPTO']),
      'NOMBRE DEPARTAMENTO': r['DPTO'], 'Nombre_Ciudad': r['CIUDAD'], BARRIO: r['BARRIO'], 'NOMBRE PRODUCTO': r['PRODUCTO'],
      CODIGO: r['CÓDIGO'], 'Tiempo ARMADO': r['TIEMPO'], CLIENTEREPORTA: r['CLIENTE REPORTA'], TECNICO: r['USUARIO ORIGINAL'],
      'Tipo de Servicio': r['OBSERVACION'], Prioridad: 'Prioridad 1', Cantidad: 1, _origen: 'Pendiente',
    })), M, idx);
  }

  // ---------- Servicios ----------
  function buildServices(rows) {
    const map = new Map();
    rows.forEach((r, i) => {
      r._i = i;
      const id = r.servicio + '|' + (r.region ?? 'X');
      let s = map.get(id);
      if (!s) {
        s = { id, servicio: r.servicio, rows: [], region: r.region, depto: r.depto, ciudad: r.ciudad, zona: r.zona, idzona: r.idzona, zc: r.zc,
          lat: r.lat, lng: r.lng, km: r.km, min: 0, prio: 0, needM: false, needEmp: false, need2: false, min2: 0, cliente: r.cliente, direccion: r.direccion, empresa: r.empresa };
        map.set(id, s);
      }
      s.rows.push(r);
      s.min += r.tiempo || 0;
      if (r.prioridad === 'Prioridad 1') s.prio = 1;
      if (r.perfil === 'Maestro') s.needM = true;
      if (r.empotrable) s.needEmp = true;
      if (r.personas >= 2) { s.need2 = true; s.min2 += r.tiempo || 0; }
      if (s.lat == null && r.lat != null) { s.lat = r.lat; s.lng = r.lng; s.zona = r.zona; s.idzona = r.idzona; s.zc = r.zc; }
    });
    return [...map.values()];
  }

  // ---------- Reglas de elegibilidad ----------
  function weekdayName(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T12:00:00');
    return DIAS[d.getDay()];
  }

  function checkEligible(t, s, ctx) {
    if (t.reg !== s.region) return 'Otra región';
    if (s.needM && t.perf !== 'Maestro') return 'Requiere Maestro';
    if (s.needEmp && !t.emp) return 'Requiere empotrar';
    const R = ctx.rules;
    if (R.picoPlaca && t.tr && U(t.tr) === 'MOTO') {
      const pyp = deaccent(U(t.pyp));
      const cities = R.pypCiudades[s.depto];
      if (pyp && pyp === ctx.dia && cities && cities.includes(deaccent(U(s.ciudad)))) return 'Pico y placa';
    }
    if (R.kmLejano && s.km != null && s.km > R.kmLejano) {
      const noVa = /NO VA A MUNICIPIOS/.test(deaccent(U(t.com)));
      if (U(t.tr) !== 'MOTO' || noVa) return 'Municipio lejano sin moto';
    }
    return null;
  }

  // ---------- Motor ----------
  const DEFAULT_RULES = {
    tolerancia: 0.10,          // holgura sobre la capacidad: nunca se pasa de capacidad + 10%
    maxServicios: 10,          // máximo de servicios (toques) por técnico, incluidos los que apoya como asistente
    mismoMunicipio: true,      // una ruta no mezcla municipios (p. ej. Soledad, Barranquilla y Galapa)
    modo: 'orden',             // 'orden' = llenar en el orden de técnicos; 'balance' = repartir parejo
    picoPlaca: true,
    pypCiudades: { ANTIOQUIA: ['MEDELLIN'], BOLIVAR: ['CARTAGENA DE INDIAS', 'CARTAGENA'], SANTANDER: ['BUCARAMANGA'] },
    kmLejano: 30,              // municipios a más de X km solo con moto
    usarVivienda: true,        // cada técnico arranca su ruta por los servicios más cercanos a su vivienda (zona equivalente de Personal)
    asistenteTiempoCompleto: false, // productos de 2 personas: el tiempo del producto se divide entre titular y asistente
    penalZona: 3,              // km equivalentes de penalidad por cambiar de IDZona al armar ruta
    geoCUN: true,              // Bogotá–Cundinamarca: agrupar por corredores y continuidad geográfica antes de asignar
    agruparZonas: true,        // resto de departamentos (no Antioquia ni Cundinamarca): agrupar por zona equivalente y corredor de IDZona
    kmVecino: 4,               // municipios: sectores a menos de X km con la misma compatibilidad se consideran contiguos
    spanUrbano: 6,             // diámetro máximo (km) de una ruta dentro de ciudad: no mezcla norte con sur
    spanMunicipio: 35,         // diámetro máximo (km) en corredores de municipios
    saltoIdZona: 2,            // ciudad: se agrupan sectores con IDZona a 2 o menos de distancia
    saltoMaxId: 5,
    saltoRespaldo: 10,         // último recurso: un servicio sin ruta en su corredor puede unirse a la ruta con IDZona más cercano (hasta 10), marcado             // ciudad: si no hay servicios en los sectores intermedios, se puede saltar al siguiente con servicios hasta 5 IDZona
    vecinos: '1:76-40, 1:76-41', // IDZona vecinos adicionales (región:id-id), p. ej. Soledad 2000 (76) con 20 de Julio (40/41)
  };

  function assign(rows, techList, rulesIn = {}, locks = {}) {
    const rules = Object.assign({}, DEFAULT_RULES, rulesIn);
    const services = buildServices(rows);
    const fecha = rows.find((r) => r.fecha)?.fecha || '';
    const ctx = { rules, dia: weekdayName(fecha) };
    const techs = techList.filter((t) => t.activo !== false && (t.capEff ?? t.cap) > 0).map((t) => ({
      t, cap: t.capEff ?? t.cap, used: 0, svcs: [], help: [], cx: null,
    }));
    const byName = new Map(techs.map((x) => [x.t.n, x]));
    const ordKey = (x) => [x.t.ord == null ? 999 : x.t.ord, x.t.n];
    techs.sort((a, b) => { const ka = ordKey(a), kb = ordKey(b); return ka[0] - kb[0] || ka[1].localeCompare(kb[1]); });

    // Agrupación geográfica Bogotá–Cundinamarca (región 7): primero agrupar, después asignar
    const Geo = GeoMod;
    let G = null;
    if (rules.geoCUN !== false && Geo) G = Geo.applyGeo(services.filter((s) => s.region === 7), rules.M || null);
    const NIVEL_PEN = { 'Misma zona': 0, Alta: 1, Media: 6, Baja: 40 };
    const geoLevel = (x, s) => { if (!G || !s.geo) return null; let worst = 'Misma zona'; for (const v of x.svcs) { if (!v.geo) continue; const l = G.nivel(v.geo.zonaId, s.geo.zonaId); if (Geo.levelRank(l) > Geo.levelRank(worst)) worst = l; } return x.svcs.some((v) => v.geo) ? worst : null; };
    const domCorr = (x) => { const c = {}; x.svcs.forEach((v) => { if (v.geo) c[v.geo.corr] = (c[v.geo.corr] || 0) + v.min; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0]; };

    // ---- Agrupación por zonas equivalentes y corredores (regiones distintas de Antioquia=10 y Cundinamarca=7) ----
    const Z = makeZoneGraph(rules); Z.setRanks(services);
    const zoneMode = (reg) => rules.agruparZonas !== false && reg !== 7;  // todas las regiones menos Bogotá–Cundinamarca (7), que conserva su lógica geográfica
    // Nivel de agrupación de un servicio frente a la ruta del técnico: 0 misma zona · 1 mismo sector (IDZona)
    // 2 sector contiguo (corredor) · 3 misma compatibilidad cercana · 4 fuera de corredor
    const tier = (x, s) => Z.tierRoute(x.svcs, s);

    const state = new Map(); // id -> {tech, helpers:[names], reason, locked}
    const elig = new Map();
    for (const s of services) elig.set(s.id, techs.filter((x) => !checkEligible(x.t, s, ctx)));

    const limit = (x) => x.cap * (1 + rules.tolerancia);
    const maxS = rules.maxServicios || 999;
    const stops = (x) => x.svcs.length + x.help.length;
    const ciudadDe = (x) => (x.svcs[0] || (x.help[0] && x.help[0].s) || {}).ciudad;
    const cityOk = (x, s) => { if (zoneMode(s.region)) return tier(x, s) <= 3; if (!rules.mismoMunicipio || (G && s.region === 7)) return true; const c = ciudadDe(x); return !c || c === s.ciudad; };
    const canTake = (x, s) => x.used + s.min <= limit(x) + 1e-9 && stops(x) < maxS && cityOk(x, s);
    const centroid = (x) => {
      const pts = x.svcs.filter((s) => s.lat != null);
      if (!pts.length) return null;
      return { lat: pts.reduce((a, s) => a + s.lat, 0) / pts.length, lng: pts.reduce((a, s) => a + s.lng, 0) / pts.length };
    };
    const put = (s, x, extra = {}) => { x.svcs.push(s); x.used += s.min; state.set(s.id, Object.assign({ tech: x.t.n, helpers: [] }, extra)); };
    const take = (s) => { const st = state.get(s.id); if (!st) return; const x = byName.get(st.tech); if (x) { x.svcs = x.svcs.filter((v) => v !== s); x.used -= s.min; } state.delete(s.id); };

    // 0. Fijados manualmente
    for (const s of services) {
      const L = locks[s.servicio];
      if (L && byName.get(L.tech)) put(s, byName.get(L.tech), { locked: true, helpers: L.helpers || [] });
    }

    const regions = [...new Set(services.map((s) => s.region))];
    for (const reg of regions) {
      const RS = services.filter((s) => s.region === reg);
      const RT = techs.filter((x) => x.t.reg === reg);
      if (!RT.length) { RS.forEach((s) => { if (!state.has(s.id)) state.set(s.id, { tech: null, reason: 'Fuera de cobertura: sin técnicos disponibles en la región' }); }); continue; }
      const demand = RS.reduce((a, s) => a + s.min, 0);
      const capT = RT.reduce((a, x) => a + x.cap, 0);
      const fill = Math.min(1, demand / capT);
      const target = (x) => rules.modo === 'balance' ? Math.min(limit(x), x.cap * Math.min(1, fill + 0.05)) : x.cap;

      // 1. Servicios más grandes que cualquier técnico → equipo
      for (const s of RS) {
        if (state.has(s.id)) continue;
        const E = elig.get(s.id);
        if (!E.length) continue;
        const maxCap = Math.max(...E.map(limit));
        if (s.min > maxCap) {
          const order = [...E].filter((x) => stops(x) < maxS && cityOk(x, s)).sort((a, b) => (limit(b) - b.used) - (limit(a) - a.used));
          if (!order.length) continue;
          const titular = order[0];
          let resto = s.min - (limit(titular) - titular.used);
          const helpers = [];
          for (const h of RT.filter((x) => x !== titular && stops(x) < maxS && cityOk(x, s)).sort((a, b) => (limit(b) - b.used) - (limit(a) - a.used))) {
            if (resto <= 0) break;
            const give = Math.min(resto, limit(h) - h.used);
            if (give <= 0) continue;
            h.used += give; h.help.push({ s, min: give }); helpers.push(h.t.n); resto -= give;
          }
          if (resto > 0) { // no alcanza ni sumando técnicos sin pasar la holgura: se deshace y queda para decisión manual
            for (const n of helpers) { const h = byName.get(n); const q = h.help.find((q) => q.s === s); h.used -= q.min; h.help = h.help.filter((z) => z !== q); }
            continue;
          }
          const shares = {}; helpers.forEach((n) => { shares[n] = byName.get(n).help.find((q) => q.s === s).min; });
          titular.svcs.push(s); titular.used += s.min - Object.values(shares).reduce((a, b) => a + b, 0);
          s.shares = shares;
          state.set(s.id, { tech: titular.t.n, helpers, team: true });
        }
      }

      const grow = (x, poolFn, stopAt, over = false) => {
        let guard = 0;
        while (guard++ < 500) {
          const pool = RS.filter((s) => !state.has(s.id) && poolFn(s) && elig.get(s.id).includes(x));
          if (!pool.length) break;
          const room = stopAt - x.used;
          if (stops(x) >= maxS) break;
          const fits = pool.filter((s) => cityOk(x, s) && (s.min <= room || (x.used === 0 && s.min <= limit(x)) || (over && s.min <= limit(x) - x.used)));
          if (!fits.length) break;
          const c = centroid(x);
          let best = null, bestScore = Infinity;
          const geoOn = G && reg === 7;
          let zoneRem = null;
          if (geoOn && !c) { zoneRem = {}; RS.forEach((s) => { if (!state.has(s.id) && s.geo) zoneRem[s.geo.zonaId] = (zoneRem[s.geo.zonaId] || 0) + s.min; }); }
          const dc = geoOn ? domCorr(x) : null;
          for (const s of fits) {
            let score;
            if (geoOn && s.geo) {
              // Región 7: proximidad y continuidad geográfica por corredor y zona
              if (!c) {
                score = -(zoneRem[s.geo.zonaId] || 0) / 20 - (Geo.km(s, Geo.BOG_CENTRO) || 0) / 10 + (s.prio ? -5 : 0);
                // Cercanía a la vivienda del técnico (zona equivalente de Personal): arranca por lo más cercano a su casa
                const home = rules.usarVivienda !== false ? x.t.home : null;
                if (home && s.lat != null) score += (haversine(home, s) || 0) * 2;
              }
              else {
                const lvl = geoLevel(x, s);
                if (lvl === 'Baja' && !over) continue;
                const d = Geo.vial({ lat: c.lat, lng: c.lng, corr: dc || s.geo.corr }, { lat: s.lat, lng: s.lng, corr: s.geo.corr });
                score = (d == null ? 60 : d) + (NIVEL_PEN[lvl] ?? 0) + (s.prio ? -2 : 0);
              }
            } else if (zoneMode(reg)) {
              if (!x.svcs.length) {
                // Arranque: el sector y la zona equivalente con más minutos pendientes, para llenar al técnico en un solo lugar
                if (!zoneRem) { zoneRem = { sec: {}, zon: {} }; for (const q of fits) { const k = Z.key(q); zoneRem.sec[k] = (zoneRem.sec[k] || 0) + q.min; zoneRem.zon[q.zona] = (zoneRem.zon[q.zona] || 0) + q.min; } }
                // Arranque por IDZona: cada técnico (en su orden) empieza en el IDZona más bajo pendiente y avanza en barrido
                score = (s.idzona ?? 999) * 10 - Math.min(zoneRem.zon[s.zona] || 0, x.cap) / 100 + (s.prio ? -1 : 0) + (s.lat == null ? 5000 : 0);
                // Cercanía a la vivienda del técnico (zona equivalente de Personal): arranca por lo más cercano a su casa.
                // Solo se comparan servicios para el mismo técnico, así que la escala no importa.
                const home = rules.usarVivienda !== false ? x.t.home : null;
                if (home && s.lat != null) score = haversine(home, s) * 10 + (s.idzona ?? 999) * 0.01 - Math.min(zoneRem.zon[s.zona] || 0, x.cap) / 1000 + (s.prio ? -1 : 0);
              } else {
                const tr = tier(x, s);
                const d = c ? haversine(c, s) : null;
                const di = Math.min(...x.svcs.map((v) => Z.dId(v, s)));
                score = tr * (rules.pesoZona ?? 20) + Math.min(di, 10) * 4 + (d == null ? 8 : Math.min(d, 40) * 0.2) + (s.prio ? -2 : 0);
                // Entre servicios igual de contiguos, se prefiere el más cercano a la vivienda del técnico
                const home = rules.usarVivienda !== false ? x.t.home : null;
                if (home && s.lat != null) score += Math.min(haversine(home, s) || 0, 40) * 0.3;
              }
            } else if (!c) score = (s.idzona ?? 999) * 10 + (s.prio ? -5 : 0) + (s.lat == null ? 50 : 0);
            else {
              // Zonas definidas: se avanza por IDZona dentro del mismo municipio; la distancia solo desempata
              const dz = Math.min(...x.svcs.map((v) => Math.abs((v.idzona ?? 999) - (s.idzona ?? 999))));
              const d = haversine(c, s);
              score = dz * rules.penalZona + (d == null ? 5 : Math.min(d, 20) * 0.5) + (s.prio ? -2 : 0);
            }
            if (score < bestScore) { bestScore = score; best = s; }
          }
          if (!best) break;
          put(best, x);
          if (x.used >= stopAt) break;
        }
      };

      // 2. Maestros primero con los servicios que exigen Maestro (reserva)
      const MR = RS.filter((s) => s.needM && !state.has(s.id)).reduce((a, s) => a + s.min, 0);
      const maestros = RT.filter((x) => x.t.perf === 'Maestro');
      const MC = maestros.reduce((a, x) => a + x.cap, 0);
      if (MR > 0 && MC > 0) {
        const share = Math.min(1, MR / MC);
        for (const x of maestros) grow(x, (s) => s.needM, (G && reg === 7) ? target(x) : Math.min(target(x), x.used + x.cap * Math.min(1, share + 0.15)));
        for (const x of maestros) grow(x, (s) => s.needM, target(x)); // lo que quede de maestro
      }
      // 3. Todos, en el orden definido, completan con el resto de la carga (prioridad 1 pesa más)
      for (const x of RT) grow(x, (s) => s.prio === 1, target(x));
      for (const x of RT) grow(x, () => true, target(x));
      // 3b. Asistente para productos de 2 personas (antes de usar la holgura)
      for (const s of RS) {
        const st = state.get(s.id);
        if (!st || !st.tech || !s.need2 || (st.helpers && st.helpers.length)) continue;
        const x = byName.get(st.tech);
        const need = rules.asistenteTiempoCompleto ? s.min2 : s.min2 / 2; // tiempo del asistente
        // el asistente debe tener cupo en minutos y en servicios, y estar en el mismo municipio
        const cands = RT.filter((h) => h !== x && limit(h) - h.used >= need && stops(h) < maxS && cityOk(h, s))
          .map((h) => ({ h, d: haversine(centroid(h) || s, s) ?? 50 }))
          .sort((a, b) => a.d - b.d);
        if (cands.length) {
          const h = cands[0].h; h.used += need; h.help.push({ s, min: need }); st.helpers = [h.t.n]; st.helperAviso = false;
          if (!rules.asistenteTiempoCompleto) x.used -= need; // el titular solo carga su mitad de los productos de 2 personas
          s.shares = { [h.t.n]: need };
        }
        else st.helperAviso = true; // sin asistente con cupo: se asigna a mano
      }
      // 4. Holgura hasta +tolerancia para lo que quedó
      for (const x of RT) grow(x, () => true, limit(x), true);

      // 5. Garantizar Prioridad 1: desplazar servicios Normal si hace falta
      for (const s of RS.filter((s) => !state.has(s.id) && s.prio === 1)) {
        let bestX = null, bestRem = null;
        for (const x of elig.get(s.id)) {
          if (!cityOk(x, s)) continue;
          const need = x.used + s.min - limit(x);
          if (need <= 0 && stops(x) < maxS) { bestX = x; bestRem = []; break; }
          const c = { lat: s.lat, lng: s.lng };
          const normals = x.svcs.filter((v) => !v.prio && !state.get(v.id)?.locked && !state.get(v.id)?.team && !(state.get(v.id)?.helpers || []).length)
            .sort((a, b) => (haversine(c, b) ?? 99) - (haversine(c, a) ?? 99));
          const rem = []; let freed = 0;
          for (const v of normals) { if (freed >= need && stops(x) - rem.length < maxS) break; rem.push(v); freed += v.min; }
          if (freed >= need && stops(x) - rem.length < maxS && (!bestRem || rem.reduce((a, v) => a + v.min, 0) < bestRem.reduce((a, v) => a + v.min, 0))) { bestX = x; bestRem = rem; }
        }
        if (bestX) { bestRem.forEach(take); put(s, bestX); }
      }
      // 6. Reintento de lo desplazado en quien tenga espacio
      for (const s of RS.filter((s) => !state.has(s.id)).sort((a, b) => b.prio - a.prio || b.min - a.min)) {
        const E = elig.get(s.id).filter((x) => canTake(x, s));
        if (!E.length) continue;
        E.sort((a, b) => (haversine(centroid(a), s) ?? 99) - (haversine(centroid(b), s) ?? 99));
        put(s, E[0]);
      }

      // 6b. Hacer espacio: mover hasta 3 servicios del técnico a otros con cupo para que entre el pendiente
      for (const s of RS.filter((s) => !state.has(s.id)).sort((a, b) => b.prio - a.prio || b.min - a.min)) {
        let best = null;
        for (const x of elig.get(s.id)) {
          if (!cityOk(x, s) || x.svcs.length === 0) continue;
          const need = x.used + s.min - limit(x);
          if (need <= 0 && stops(x) < maxS) { best = { x, moves: [], cost: 0 }; break; }
          const room = new Map(RT.map((y) => [y, limit(y) - y.used]));
          const cnt = new Map(RT.map((y) => [y, stops(y)]));
          const movable = x.svcs.filter((v) => { const sv = state.get(v.id); return !sv.locked && !sv.team && !(sv.helpers && sv.helpers.length); })
            .sort((a, b) => b.min - a.min);
          const moves = []; let freed = 0, cost = 0;
          for (const v of movable) {
            if (freed >= need || moves.length >= 3) break;
            let by = null, bd = Infinity;
            for (const y of elig.get(v.id)) {
              if (y === x || room.get(y) < v.min || cnt.get(y) >= maxS || !cityOk(y, v)) continue;
              const d = haversine(centroid(y), v) ?? 60;
              if (d < bd) { bd = d; by = y; }
            }
            if (!by) continue;
            room.set(by, room.get(by) - v.min); cnt.set(by, cnt.get(by) + 1); moves.push([v, by]); freed += v.min; cost += bd;
          }
          if (freed >= need && stops(x) - moves.length < maxS && (!best || cost < best.cost)) best = { x, moves, cost };
        }
        if (best) { for (const [v, y] of best.moves) { take(v); put(v, y); } put(s, best.x); }
      }

      // 6d. Consolidar zonas partidas: si un servicio quedó solo (o en minoría) en su zona o sector dentro de una ruta
      //     y otro técnico ya tiene esa misma zona/sector con cupo, se mueve para que la zona la haga un solo técnico.
      if (zoneMode(reg)) {
        const movible = (v) => { const sv = state.get(v.id); return sv && !sv.locked && !sv.team && !(sv.helpers && sv.helpers.length) && !v.need2; };
        const cuenta = (x, v, campo) => x.svcs.filter((w) => w !== v && w[campo] != null && w[campo] === v[campo]).length;
        for (let ronda = 0; ronda < 4; ronda++) {
          let cambios = 0;
          for (const v of RS) {
            const sv = state.get(v.id); if (!sv || !sv.tech || !movible(v)) continue;
            const A = byName.get(sv.tech);
            const otros = A.svcs.filter((w) => w !== v);
            const nivelA = Z.tierRoute(otros, v);
            if (nivelA === 0 && cuenta(A, v, 'zona') >= 1 && !sv.cruce) continue; // ya acompañado en su zona
            let best = null, bestK = -1;
            for (const B of elig.get(v.id)) {
              if (B === A || !B.svcs.length || B.used + v.min > limit(B) + 1e-9 || stops(B) >= maxS) continue;
              const nivelB = Z.tierRoute(B.svcs, v);
              if (nivelB > 1 || nivelB >= nivelA && !sv.cruce) continue;
              const k = cuenta(B, v, 'zona') * 10 + cuenta(B, v, 'idzona');
              if (k > bestK || (k === bestK && best && B.used < best.used)) { best = B; bestK = k; }
            }
            if (best) { const extra = {}; take(v); put(v, best, extra); cambios++; }
          }
          if (!cambios) break;
        }
      }

      // 6e. Zonas repartidas entre varios técnicos: el grupo menor se mueve completo al técnico que ya tiene más de esa zona, si le cabe
      if (zoneMode(reg)) {
        const movible = (v) => { const sv = state.get(v.id); return sv && sv.tech && !sv.locked && !sv.team && !(sv.helpers && sv.helpers.length) && !v.need2; };
        const zonas = [...new Set(RS.filter((v) => v.zona && state.get(v.id)?.tech).map((v) => v.zona))];
        for (const zn of zonas) {
          for (let it = 0; it < 4; it++) {
            const hold = new Map();
            RS.forEach((v) => { const sv = state.get(v.id); if (v.zona === zn && sv && sv.tech) { const x = byName.get(sv.tech); const h = hold.get(x) || { min: 0, v: [] }; h.min += v.min; h.v.push(v); hold.set(x, h); } });
            if (hold.size < 2) break;
            const H = [...hold.entries()].sort((a, b) => b[1].min - a[1].min);
            let moved = false;
            for (let i = H.length - 1; i > 0 && !moved; i--) {
              const [x, g] = H[i];
              if (!g.v.every(movible)) continue;
              const gm = g.v.reduce((a, v) => a + v.min, 0);
              for (let j = 0; j < i; j++) {
                const [y] = H[j];
                if (y.used + gm > limit(y) + 1e-9 || stops(y) + g.v.length > maxS) continue;
                if (!g.v.every((v) => elig.get(v.id).includes(y))) continue;
                g.v.forEach((v) => { take(v); put(v, y); }); moved = true; break;
              }
            }
            if (!moved) break;
          }
        }
      }

      // 6f. Liberar técnicos con rutas pequeñas: si quedan servicios sin asignar en otra zona y un técnico tiene una ruta
      //     corta que cabe en las rutas vecinas, sus servicios se pasan a esos técnicos y él arranca una ruta nueva
      //     con lo pendiente (así no se mezcla norte con sur y no queda capacidad ociosa).
      if (zoneMode(reg)) {
        for (let vuelta = 0; vuelta < RT.length; vuelta++) {
          const pend = RS.filter((s) => !state.has(s.id));
          if (!pend.length) break;
          const libres = RT.filter((x) => x.svcs.length && x.used < x.cap * 0.5 && !x.help.length &&
            x.svcs.every((v) => { const sv = state.get(v.id); return !sv.locked && !sv.team && !(sv.helpers && sv.helpers.length); }) &&
            pend.some((s) => elig.get(s.id).includes(x)))
            .sort((a, b) => a.used - b.used);
          let hecho = false;
          for (const x of libres) {
            // simular el traslado de toda su ruta
            const room = new Map(RT.map((y) => [y, limit(y) - y.used])); const cnt = new Map(RT.map((y) => [y, stops(y)]));
            const extra = new Map(); const moves = [];
            for (const v of x.svcs) {
              let by = null, bd = Infinity;
              for (const y of elig.get(v.id)) {
                if (y === x || !y.svcs.length || room.get(y) < v.min || cnt.get(y) >= maxS) continue;
                const ruta = y.svcs.concat(extra.get(y) || []);
                if (Z.tierRoute(ruta, v) > 2) continue;
                const d = haversine(centroid(y), v) ?? 50; if (d < bd) { bd = d; by = y; }
              }
              if (!by) { moves.length = 0; break; }
              moves.push([v, by]); room.set(by, room.get(by) - v.min); cnt.set(by, cnt.get(by) + 1); extra.set(by, (extra.get(by) || []).concat(v));
            }
            if (moves.length !== x.svcs.length) continue;
            for (const [v, y] of moves) { take(v); put(v, y); }
            grow(x, (s) => !state.has(s.id), target(x));
            grow(x, (s) => !state.has(s.id), limit(x), true);
            hecho = true; break;
          }
          if (!hecho) break;
        }
      }

      // 6c. Zonas/municipios que no encajan en ningún corredor con cupo: se asignan al técnico más cercano con cupo y se marcan como cruce
      if (zoneMode(reg)) {
        for (const s of RS.filter((s) => !state.has(s.id)).sort((a, b) => b.prio - a.prio || b.min - a.min)) {
          // en ciudad nunca se parte la ruta (norte–sur); un municipio lejano sí puede ir con otra ruta, marcado como fuera de corredor
          // en ciudad el IDZona no puede quedar a más de saltoRespaldo sectores de la ruta (Miramar 6 con El Carmen 26 nunca)
          const urbano = (x) => !x.svcs.length || Z.muniOf(s) || x.svcs.some((v) => Z.muniOf(v)) || Math.min(...x.svcs.map((v) => Z.dId(v, s))) <= (rules.saltoRespaldo ?? 10);
          const E = elig.get(s.id).filter((x) => x.used + s.min <= limit(x) + 1e-9 && stops(x) < maxS && !Z.excedeSpan(x.svcs, s, Infinity) && urbano(x));
          if (!E.length) continue;
          // primero un técnico sin ruta (no mezcla nada); si no hay, el de ruta más cercana
          const dmin = (x) => (x.svcs.length ? Math.min(...x.svcs.map((v) => Z.dId(v, s))) : 0);
          E.sort((a, b) => (!b.svcs.length) - (!a.svcs.length) || dmin(a) - dmin(b) || (haversine(centroid(a) || s, s) ?? 99) - (haversine(centroid(b) || s, s) ?? 99));
          put(s, E[0], { cruce: !!E[0].svcs.length && Z.tierRoute(E[0].svcs.filter((v) => v !== s), s) > 3 });
        }
      }

      // 7. Motivo de lo no asignado
      for (const s of RS) {
        if (state.has(s.id)) continue;
        let reason = 'Falta de capacidad';
        if (!elig.get(s.id).length) {
          const why = RT.map((x) => checkEligible(x.t, s, ctx));
          if (why.every((w) => w === 'Requiere Maestro' || w === 'Requiere empotrar')) reason = s.needEmp ? 'Falta de habilidad: sin técnico que empotre' : 'Falta de habilidad: sin Maestro disponible';
          else if (why.some((w) => w === 'Pico y placa' || w === 'Municipio lejano sin moto')) reason = 'Restricción de movilidad (pico y placa / municipio lejano)';
          else reason = 'Falta de habilidad técnica';
        } else if (s.prio === 1) reason = 'Falta de capacidad (Prioridad 1)';
        if (reason.startsWith('Falta de capacidad') && elig.get(s.id).length && elig.get(s.id).every((x) => stops(x) >= maxS || !cityOk(x, s) || x.used + s.min > limit(x))) {
          const full = elig.get(s.id).filter((x) => stops(x) >= maxS).length;
          if (full) reason += ` · ${full} técnico(s) ya con ${maxS} servicios`;
        }
        if (zoneMode(reg) && reason.startsWith('Falta de capacidad') && elig.get(s.id).some((x) => x.used + s.min <= limit(x) && stops(x) < maxS))
          reason = 'Sin técnico con cupo en su IDZona o corredor (asignar a mano o liberar un técnico)';
        if (reason.startsWith('Falta de capacidad') || reason.startsWith('Sin técnico con cupo')) {
          const pyp = RT.filter((x) => checkEligible(x.t, s, ctx) === 'Pico y placa').map((x) => x.t.n);
          if (pyp.length) reason += ' · con pico y placa hoy: ' + pyp.join(', ');
        }
        state.set(s.id, { tech: null, reason });
      }
    }

    const plan = finalize(services, techs, state, rules, ctx);
    plan.geo = G; plan.zoneGraph = Z; geoAlerts(plan);
    return plan;
  }

  // Orden de ruta: vecino más cercano desde la zona de menor IDZona
  function routeOrder(svcs, penal) {
    const Geo = GeoMod;
    if (Geo && svcs.length && svcs.every((s) => s.geo)) {
      // Bogotá–Cundinamarca: arranca en el extremo del corredor y avanza por continuidad (sin cruces)
      const left = [...svcs].sort((a, b) => (Geo.km(b, Geo.BOG_CENTRO) || 0) - (Geo.km(a, Geo.BOG_CENTRO) || 0));
      let cur = left.shift(); const seq = [cur];
      while (left.length) {
        let bi = 0, bd = Infinity;
        left.forEach((s, i) => { const d = (Geo.vial({ lat: cur.lat, lng: cur.lng, corr: cur.geo.corr }, { lat: s.lat, lng: s.lng, corr: s.geo.corr }) ?? 80) + (s.geo.zonaId === cur.geo.zonaId ? 0 : 2); if (d < bd) { bd = d; bi = i; } });
        cur = left.splice(bi, 1)[0]; seq.push(cur);
      }
      return seq;
    }
    const left = [...svcs]; const seq = [];
    left.sort((a, b) => (a.idzona ?? 999) - (b.idzona ?? 999));
    let cur = left.shift(); if (!cur) return seq; seq.push(cur);
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((s, i) => { const d = Math.min(haversine(cur, s) ?? 20, 20) * 0.5 + Math.abs((s.idzona ?? 999) - (cur.idzona ?? 999)) * penal; if (d < bd) { bd = d; bi = i; } });
      cur = left.splice(bi, 1)[0]; seq.push(cur);
    }
    return seq;
  }

  // Alertas de cruce geográfico por técnico (zonas de baja compatibilidad en la misma ruta)
  function geoAlerts(plan) {
    const G = plan.geo;
    const byId = new Map(plan.services.map((s) => [s.id, s]));
    const Z = plan.zoneGraph || makeZoneGraph(plan.rules);
    for (const p of plan.techs) {
      const sv = p.svcIds.map((id) => byId.get(id)).filter(Boolean);
      if (plan.rules.agruparZonas !== false && sv.length && sv.every((s) => s.region !== 7)) {
        const comps = Z.components(sv);
        p.geoZonas = [...new Set(sv.map((s) => s.zona))];
        p.geoCruces = comps.length > 1 ? [comps.map((c) => c.label).join(' ↔ ')] : [];
        continue;
      }
      if (!G) continue;
      const zs = [...new Set(p.svcIds.map((id) => byId.get(id)).filter((s) => s && s.geo).map((s) => s.geo.zonaId))];
      const bad = [];
      for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) if (G.nivel(zs[i], zs[j]) === 'Baja') bad.push(zs[i] + ' ↔ ' + zs[j]);
      p.geoCruces = bad;
      p.geoZonas = zs;
    }
  }

  // Grafo de sectores (IDZona) por región a partir del maestro de Zonas Equivalentes.
  // Contiguos: IDZona consecutivo del mismo corredor (≤ 25 km, compatibilidad compartida o rural) o
  // sectores a menos de kmVecino con la misma compatibilidad (Z.Compatibilidad ≠ 0).
  function makeZoneGraph(rules) {
    const SEC = (rules && rules.sector) || {};
    const kmV = (rules && rules.kmVecino) || 4;
    const key = (s) => (s.region ?? 'X') + '|' + (s.idzona ?? 'X');
    const cen = (s) => { const q = SEC[key(s)]; return q && q[0] != null ? { lat: q[0], lng: q[1] } : (s.lat != null ? { lat: s.lat, lng: s.lng } : null); };
    const zcs = (s) => { const q = SEC[key(s)]; const a = q ? q[2] : []; return a && a.length ? a : (s.zc != null ? [s.zc] : []); };
    const share = (a, b) => a.some((z) => z !== 0 && b.includes(z));
    const muni = (s) => { const q = SEC[key(s)]; return q ? !!q[3] : false; };
    // Vecinos adicionales definidos por Operaciones: "1:76-40, 1:76-41"
    const EXTRA = new Set();
    String((rules && rules.vecinos) || '').split(/[,;\n]+/).forEach((t) => {
      const m = t.trim().match(/^(\d+)\s*:\s*(\d+)\s*-\s*(\d+)$/); if (!m) return;
      EXTRA.add(m[1] + '|' + m[2] + '~' + m[3]); EXTRA.add(m[1] + '|' + m[3] + '~' + m[2]);
    });
    const dId = (a, b) => (a.idzona == null || b.idzona == null ? 999 : Math.abs(a.idzona - b.idzona));
    // Barrido por IDZona: posición de cada sector urbano entre los sectores con servicios del día (por región)
    const RANK = new Map();
    function setRanks(services) {
      const by = {};
      services.forEach((s) => { if (s.idzona != null && !muni(s)) (by[s.region] = by[s.region] || new Set()).add(s.idzona); });
      for (const r in by) [...by[r]].sort((a, b) => a - b).forEach((id, i) => RANK.set(r + '|' + id, i));
      memo.clear();
    }
    const rank = (s) => RANK.get(s.region + '|' + s.idzona);
    const memo = new Map();
    function contiguous(a, b) {
      if (a.region !== b.region || a.idzona == null || b.idzona == null) return false;
      if (a.idzona === b.idzona) return (haversine(a, b) ?? 0) <= 15;
      const k = key(a) < key(b) ? key(a) + '~' + key(b) : key(b) + '~' + key(a);
      if (memo.has(k)) return memo.get(k);
      const d = haversine(cen(a), cen(b)); const A = zcs(a), B = zcs(b);
      let ok = false;
      if (EXTRA.has(a.region + '|' + a.idzona + '~' + b.idzona)) ok = true;
      else if (!muni(a) && !muni(b)) { // ciudad: siguiente IDZona en el barrido (consecutivo, o el siguiente que tenga servicios hoy)
        const ra = rank(a), rb = rank(b);
        ok = dId(a, b) <= (rules.saltoIdZona ?? 2) || (ra != null && rb != null && Math.abs(ra - rb) === 1 && dId(a, b) <= (rules.saltoMaxId ?? 5));
      }
      else if (Math.abs(a.idzona - b.idzona) === 1 && d != null && d <= 25 && (share(A, B) || A.includes(0) || B.includes(0))) ok = true;
      else if (d != null && d <= kmV && share(A, B)) ok = true;
      else if (d != null && d <= 15 && share(A, B) && Math.abs(a.idzona - b.idzona) <= 5 && (muni(a) || muni(b))) ok = true; // corredor hacia municipios (p. ej. Malambo → Santo Tomás)
      memo.set(k, ok); return ok;
    }
    // Diámetro máximo de una ruta: en ciudad (sectores de barrio) no se pasa de spanUrbano km entre dos servicios,
    // para no mezclar norte y sur; en corredores de municipios se permite hasta spanMunicipio km.
    const spanU = (rules && rules.spanUrbano) || 6, spanM = (rules && rules.spanMunicipio) || 35;
    function excedeSpan(route, s, factor = 1) {
      if (s.lat == null) return false;
      for (const v of route) {
        if (v.lat == null) continue;
        const d = haversine(v, s); if (d == null) continue;
        const rural = muni(v) || muni(s);
        if (rural && factor === Infinity) continue; // último recurso: un municipio lejano puede ir con cualquier ruta (queda marcado)
        const lim = rural ? spanM : spanU;
        if (d > lim * (factor === Infinity ? 1 : factor)) return true;
      }
      return false;
    }
    function tierRoute(route, s) {
      if (!route.length) return 0;
      if (excedeSpan(route, s)) return 4; // ruta partida norte–sur o municipios lejanos: no se agrupa
      if (route.some((v) => v.zona && v.zona === s.zona)) return 0;
      // mismo sector, salvo sectores del maestro que agrupan municipios distantes (p. ej. IDZona 26 de Bolívar)
      if (route.some((v) => v.region === s.region && v.idzona != null && v.idzona === s.idzona && ((haversine(v, s) ?? 0) <= 15))) return 1;
      if (route.some((v) => contiguous(v, s))) return 2;
      return 4; // no se agrupa por simple cercanía: solo por zona, IDZona o IDZona consecutivo (o vecino definido)
    }
    // Componentes conexos de una ruta (para detectar rutas partidas en zonas no contiguas)
    function components(svcs) {
      const n = svcs.length, par = svcs.map((_, i) => i);
      const f = (i) => (par[i] === i ? i : (par[i] = f(par[i])));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = svcs[i], b = svcs[j];
        const d = haversine(a, b);
        if ((a.zona && a.zona === b.zona) || contiguous(a, b)) par[f(i)] = f(j);
      }
      const g = {}; svcs.forEach((s, i) => { (g[f(i)] = g[f(i)] || []).push(s); });
      return Object.values(g).map((arr) => ({ svcs: arr, label: [...new Set(arr.map((s) => s.zona || s.ciudad))].slice(0, 3).join(' / ') }));
    }
    return { key, contiguous, tierRoute, components, excedeSpan, dId, setRanks, muniOf: muni };
  }

  function finalize(services, techs, state, rules, ctx) {
    const plan = { fecha: services[0]?.rows[0]?.fecha || '', dia: ctx.dia, rules, services, techs: [], unassigned: [] };
    for (const x of techs) {
      const seq = routeOrder(x.svcs, rules.penalZona);
      seq.forEach((s, i) => { state.get(s.id).orden = i + 1; });
      let kmRuta = 0; for (let i = 1; i < seq.length; i++) kmRuta += haversine(seq[i - 1], seq[i]) || 0;
      plan.techs.push({ n: x.t.n, t: x.t, cap: x.cap, used: Math.round(x.used), svcIds: seq.map((s) => s.id), help: x.help.map((h) => ({ id: h.s.id, min: Math.round(h.min) })), km: Math.round(kmRuta) });
    }
    for (const s of services) {
      const st = state.get(s.id) || { tech: null, reason: 'Sin procesar' };
      s.tech = st.tech; s.helpers = st.helpers || []; s.orden = st.orden || null; s.reason = st.reason || null;
      s.locked = !!st.locked; s.team = !!st.team; s.helperAviso = !!st.helperAviso; s.cruce = !!st.cruce;
      if (!s.tech) plan.unassigned.push(s);
    }
    return plan;
  }

  // Recalcula ocupación y orden de ruta después de ajustes manuales
  function recompute(plan, techList) {
    const byName = new Map(plan.techs.map((p) => [p.n, p]));
    for (const p of plan.techs) { p.svcIds = []; p.help = []; p.used = 0; }
    const svcById = new Map(plan.services.map((s) => [s.id, s]));
    plan.unassigned = [];
    for (const s of plan.services) {
      if (s.tech && !byName.has(s.tech)) {
        const t = techList.find((q) => q.n === s.tech);
        if (t) { const p = { n: t.n, t, cap: t.capEff ?? t.cap, used: 0, svcIds: [], help: [], km: 0 }; plan.techs.push(p); byName.set(t.n, p); }
      }
      if (!s.tech) { plan.unassigned.push(s); continue; }
      const p = byName.get(s.tech);
      p.svcIds.push(s.id);
      const full = plan.rules.asistenteTiempoCompleto;
      const sharesOk = s.shares && s.helpers.length && s.helpers.every((h) => s.shares[h] != null);
      p.used += s.min;
      for (const h of s.helpers) {
        const q = byName.get(h); if (!q) continue;
        // Apoyo manual en un servicio que no es de 2 personas: se aplica la misma regla (el tiempo se divide entre titular y apoyo,
        // o el apoyo ocupa el tiempo completo si así está en Criterios), sobre los minutos de todo el servicio.
        const base = s.need2 ? s.min2 : s.min;
        const m = sharesOk ? s.shares[h] : s.team ? s.min / (s.helpers.length + 1) : (full ? base : base / 2);
        q.help.push({ id: s.id, min: Math.round(m) }); q.used += m;
        if (s.team || !full) p.used -= m; // equipo o tiempo dividido: el titular descuenta lo que hace el apoyo
      }
    }
    for (const p of plan.techs) {
      const seq = routeOrder(p.svcIds.map((id) => svcById.get(id)), plan.rules.penalZona);
      seq.forEach((s, i) => { s.orden = i + 1; });
      p.svcIds = seq.map((s) => s.id); p.used = Math.round(p.used);
      let km = 0; for (let i = 1; i < seq.length; i++) km += haversine(seq[i - 1], seq[i]) || 0; p.km = Math.round(km);
    }
    geoAlerts(plan);
    return plan;
  }

  export { U, deaccent, haversine, toISODate, buildIndex, enrichBase, enrichTugo, enrichPendientes, buildServices, checkEligible, assign, recompute, weekdayName, DEFAULT_RULES, tipoServicio, prioridad };
