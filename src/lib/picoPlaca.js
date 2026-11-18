// Pico y placa por día y persona: quién tiene pico y placa ese día (según su ficha de Personal), si trabajó en una ciudad con restricción y el valor del auxilio de
// movilidad. Lo usan el reporte de Pico y placa y el pago de viáticos. La ruta sale de lo asignado ese día: histórico + lo enviado a Carga sin finalizar.
import { buildSnapshot } from "./asignacion/history";
import { valorAuxilio, ciudadConPyP, valorAlmacen } from "./auxilioMovilidad";

const plain = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const DIAS = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
const sumar = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// hist: filas del histórico (assignment_history); services: registros de Carga (db.services); rules: criterios de Asignación; auxCfg: Maestros → Auxilio de movilidad.
// almacen: armados en almacén del rango ({ technician_id, assembled_on }). Quien armó en almacén un día que es su día de pico y placa recibe el valor fijo de almacén (auxCfg.almacen, 20.000);
// si ese mismo día también tuvo ruta en una ciudad con pico y placa, se paga el mayor de los dos (un solo auxilio por día).
export function calcularPicoPlaca({ hist, services, technicians, from, to, depto = "", soloMoto = false, rules, auxCfg, almacen = [] }) {
  const almacenPor = new Map(); // `${día}|${idTécnico}` -> armados en almacén ese día
  (almacen || []).forEach((a) => { const k = `${a.assembled_on}|${a.technician_id}`; almacenPor.set(k, (almacenPor.get(k) || 0) + 1); });
  // ¿Esa ciudad tiene pico y placa? Atlántico: todos los municipios menos los exceptuados (Barranquilla); los demás departamentos: la lista de ciudades.
  const aplicaPyP = (dep, ciudad) => {
    const cfgPyP = ciudadConPyP(auxCfg, dep, ciudad); // lo configurado en Maestros → Auxilio de movilidad
    if (cfgPyP !== null) return cfgPyP;
    const d = plain(dep), c = plain(ciudad);
    const excepto = Object.entries((rules && rules.pypExcepto) || {}).find(([k]) => plain(k) === d);
    if (excepto) return !excepto[1].map(plain).includes(c);
    const lista = Object.entries((rules && rules.pypCiudades) || {}).find(([k]) => plain(k) === d);
    return !!lista && lista[1].map(plain).includes(c);
  };

  const activos = (services || []).filter((s) => s.asig && s.technicianId && !s.finalizedAt && ["En gestión", "Realizado"].includes(s.estadoGestion) && s.date >= from && s.date <= to);
  const snap = buildSnapshot(activos, technicians, () => null, { id: null });
  const rutas = new Map(); // `${día}|${idTécnico}` -> servicios en ciudad con pico y placa / en otras ciudades
  const tomar = (k) => { if (!rutas.has(k)) rutas.set(k, { conPyP: new Map(), deptos: new Set(), otras: new Set(), productos: 0, minutos: 0, apoyos: 0 }); return rutas.get(k); };
  const idPorNombre = new Map(technicians.map((t) => [plain(t.name), t.id]));
  const anotar = (g, r, esApoyo) => {
    const clave = r.servicio;
    if (aplicaPyP(r.departamento, r.ciudad)) { const c = plain(r.ciudad) || "SIN CIUDAD"; const s = g.conPyP.get(c) || new Set(); s.add(clave); g.conPyP.set(c, s); if (r.departamento) g.deptos.add(plain(r.departamento)); } else g.otras.add(clave);
    if (esApoyo) g.apoyos++; else { g.productos += Number(r.quantity) || 1; g.minutos += r.tiempo_min || 0; }
  };
  [...(hist || []), ...snap].forEach((r) => {
    if (r.technician_id) anotar(tomar(`${r.day}|${r.technician_id}`), r, false);
    const ap = r.helper_name && idPorNombre.get(plain(r.helper_name));
    if (ap) anotar(tomar(`${r.day}|${ap}`), r, true);
  });
  const campo = technicians.filter((t) => (t.category || "Técnico de campo") !== "Administrativo" && t.status === "Activo" && t.picoPlacaDay && (!depto || t.department === depto) && (!soloMoto || plain(t.transportMode) === "MOTO"));
  const out = [];
  for (let d = from, n = 0; d <= to && n < 62; d = sumar(d, 1), n++) {
    const dia = DIAS[new Date(`${d}T12:00:00`).getDay()];
    campo.filter((t) => plain(t.picoPlacaDay) === dia).forEach((t) => {
      const g = rutas.get(`${d}|${t.id}`);
      const nConPyP = g ? [...g.conPyP.values()].reduce((s, x) => s + x.size, 0) : 0;
      let estado = nConPyP > 0 ? "pyp" : g && g.otras.size > 0 ? "otra" : "sin";
      // Valor del auxilio: departamento donde se trabajó con pico y placa (si trabajó en varios, el mayor) o, si no hubo ruta con restricción, el de la ficha.
      const deptosValor = g && g.deptos.size > 0 ? [...g.deptos] : [t.department];
      const valores = deptosValor.map((dp) => valorAuxilio(auxCfg, dp, t.contractType)).filter((v) => v !== null);
      let valor = valores.length ? Math.max(...valores) : null;
      const nAlm = almacenPor.get(`${d}|${t.id}`) || 0;
      if (nAlm > 0) {
        const va = valorAlmacen(auxCfg);
        if (estado === "pyp") valor = Math.max(valor || 0, va);   // ruta con pico y placa y almacén el mismo día: el mayor
        else { estado = "almacen"; valor = va; }                  // solo almacén: valor fijo
      }
      out.push({ fecha: d, dia: t.picoPlacaDay, id: t.id, nombre: t.name, codigo: t.code, depto: t.department || "", contrato: t.contractType || "", valor, transporte: t.transportMode || "-", placa: t.plate || "",
        estado, ciudadesPyP: g ? [...g.conPyP.entries()].map(([c, s]) => `${c} (${s.size})`).join(", ") : "", serviciosPyP: nConPyP, serviciosOtras: g ? g.otras.size : 0,
        productos: g ? g.productos : 0, minutos: g ? g.minutos : 0, apoyos: g ? g.apoyos : 0, armadosAlmacen: nAlm });
    });
  }
  return out;
}
