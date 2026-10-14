// Deduce la línea y sublínea de un producto a partir de su nombre, con la misma lógica de los demás:
//  1) Mismo inicio de nombre: productos que ya tienen línea/sublínea y empiezan igual ("PANEL DE TV ..." → ENTRETENIMIENTO / PANEL DE TV).
//     Se prueba con 4, 3, 2 y 1 palabras; gana la combinación más repetida si es lo bastante dominante.
//  2) Sublínea dentro del nombre: la sublínea de la tabla de Complejidad aparece en el nombre ("COJIN ...") y solo existe en una línea.
// Es una sugerencia: se muestra para revisarla antes de guardar.

const STOP = new Set(["DE", "DEL", "LA", "EL", "LOS", "LAS", "Y", "CON", "PARA", "EN", "A", "SIN", "POR"]);

const plain = (s) => String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();

// Palabras del nombre: letras y números sueltos de 1 o 2 cifras ("COMEDOR 6 PTOS"); sin medidas (182X154X32), cantidades "(1)",
// tiempos "[120m]" ni conectores.
export const tokens = (name) => plain(name).replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/[^A-Z0-9]+/)
  .filter((t) => t && !STOP.has(t) && (/^\d{1,2}$/.test(t) || (t.length > 1 && !/\d/.test(t))));

// Plural sencillo a singular para comparar sublíneas ("COJINES" ≈ "COJIN").
const sing = (t) => (t.length > 4 && t.endsWith("ES") ? t.slice(0, -2) : t.length > 3 && t.endsWith("S") ? t.slice(0, -1) : t);

export function inferirLineas(conLinea, sinLinea, reglas = []) {
  // Prefijos aprendidos de los productos que ya tienen línea.
  const aprendido = new Map(); // "PANEL TV" -> Map("LINEA|SUBLINEA" -> { n, line, subline })
  conLinea.forEach((p) => {
    if (!p.line) return;
    const t = tokens(p.name).map(sing);
    for (let k = 1; k <= Math.min(4, t.length); k++) {
      const key = t.slice(0, k).join(" ");
      const m = aprendido.get(key) || new Map();
      const kk = `${p.line}|${p.subline || ""}`;
      const e = m.get(kk) || { n: 0, line: p.line, subline: p.subline || null };
      e.n++; m.set(kk, e); aprendido.set(key, m);
    }
  });

  // Sublíneas de la tabla de Complejidad que existen en una sola línea.
  const porSub = new Map();
  reglas.forEach((r) => {
    const k = tokens(r.subline).map(sing).join(" ");
    if (!k) return;
    const prev = porSub.get(k);
    if (!prev) porSub.set(k, { line: r.line, subline: r.subline, ambigua: false });
    else if (prev.line !== r.line) prev.ambigua = true;
  });
  const sublineas = [...porSub.entries()].filter(([, v]) => !v.ambigua).sort((a, b) => b[0].split(" ").length - a[0].split(" ").length);

  const out = [];
  sinLinea.forEach((p) => {
    const t = tokens(p.name).map(sing);
    if (!t.length) return;
    let hit = null;
    for (let k = Math.min(4, t.length); k >= 1 && !hit; k--) {
      const key = t.slice(0, k).join(" ");
      const m = aprendido.get(key);
      if (!m) continue;
      const lista = [...m.values()].sort((a, b) => b.n - a.n);
      const total = lista.reduce((s, e) => s + e.n, 0);
      const top = lista[0], share = top.n / total;
      const ok = k >= 3 ? share >= 0.6 && total >= 2 : k === 2 ? share >= 0.6 : share >= 0.85 && total >= 3;
      if (ok) hit = { line: top.line, subline: top.subline, regla: `Empieza como "${key}" (${top.n} de ${total} productos con esa línea)`, confianza: k >= 2 && share >= 0.9 ? "Alta" : "Media" };
    }
    if (!hit) {
      const set = new Set(t);
      const s = sublineas.find(([k]) => k.split(" ").every((w) => set.has(w)));
      if (s) hit = { line: s[1].line, subline: s[1].subline, regla: `El nombre contiene la sublínea "${s[1].subline}"`, confianza: "Media" };
    }
    if (hit) out.push({ code: p.code, name: p.name, ...hit });
  });
  return out;
}
