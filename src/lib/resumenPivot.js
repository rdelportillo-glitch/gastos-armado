// Resumen en formato de tabla dinámica, como imagen JPG: departamentos con sus técnicos, "Cuenta de EMPRESA" (productos) y "Suma de TIEMPO" (minutos), con el total general.
// Lo usan el paso 3 de Asignación y Carga. La imagen se dibuja en un canvas (sin librerías) con el estilo de una tabla dinámica de Excel.
const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const cmp = (a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base" });

// items: [{ depto, tecnico, n (productos, por defecto 1), min }] → { deptos: [{ nombre, n, min, tecs: [{ nombre, n, min }] }], total: { n, min } }
export function construirPivot(items) {
  const m = new Map();
  items.forEach((i) => {
    const d = plano(i.depto) || "SIN DEPARTAMENTO";
    if (!m.has(d)) m.set(d, new Map());
    const t = m.get(d), k = String(i.tecnico || "SIN TECNICO").trim() || "SIN TECNICO";
    const x = t.get(k) || { n: 0, min: 0 };
    x.n += i.n ?? 1; x.min += Number(i.min) || 0; t.set(k, x);
  });
  const deptos = [...m.entries()].sort((a, b) => cmp(a[0], b[0])).map(([nombre, t]) => {
    const tecs = [...t.entries()].sort((a, b) => cmp(a[0], b[0])).map(([n, v]) => ({ nombre: n, ...v }));
    return { nombre, tecs, n: tecs.reduce((s, x) => s + x.n, 0), min: tecs.reduce((s, x) => s + x.min, 0) };
  });
  return { deptos, total: { n: deptos.reduce((s, d) => s + d.n, 0), min: deptos.reduce((s, d) => s + d.min, 0) } };
}

const AZUL = "#BDD7EE", LINEA = "#8DB4E2", FUENTE = "Calibri, 'Segoe UI', Arial, sans-serif";
const num = (n) => Math.round(n || 0).toLocaleString("es-CO").replace(/\./g, "");

// Dibuja la tabla dinámica y devuelve un Blob JPG (escala 2 para que se vea nítida).
export function pivotJpgBlob(pivot, { escala = 2 } = {}) {
  const W = 581, H_FILA = 24, filas = 1 + pivot.deptos.reduce((s, d) => s + 1 + d.tecs.length, 0) + 1;
  const canvas = document.createElement("canvas");
  canvas.width = W * escala; canvas.height = filas * H_FILA * escala + 2 * escala;
  const c = canvas.getContext("2d");
  c.scale(escala, escala);
  c.fillStyle = "#fff"; c.fillRect(0, 0, W, filas * H_FILA + 2);
  const X1 = 8, X2 = 440, X3 = W - 8; // columnas: etiquetas, cuenta (borde derecho), suma (borde derecho)
  const fuente = (peso) => { c.font = `${peso} 15px ${FUENTE}`; };
  const texto = (t, x, y, alinear = "left") => { c.textAlign = alinear; c.textBaseline = "middle"; c.fillText(String(t), x, y); };
  const linea = (y, color = LINEA) => { c.strokeStyle = color; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke(); };
  let y = 0;

  // Encabezado
  c.fillStyle = AZUL; c.fillRect(0, y, W, H_FILA);
  c.fillStyle = "#000"; fuente("bold"); texto("Etiquetas de fila", X1, y + H_FILA / 2);
  texto("Cuenta de EMPRESA", X2, y + H_FILA / 2, "right"); texto("Suma de TIEMPO", X3, y + H_FILA / 2, "right");
  linea(y + H_FILA - 1); y += H_FILA;

  // Departamentos y técnicos
  pivot.deptos.forEach((d) => {
    linea(y, LINEA);
    // cuadrito con el signo menos (grupo expandido)
    c.strokeStyle = "#555"; c.lineWidth = 1; c.strokeRect(X1 + 0.5, y + H_FILA / 2 - 4.5, 8, 8);
    c.beginPath(); c.moveTo(X1 + 2.5, y + H_FILA / 2 - 0.5); c.lineTo(X1 + 7.5, y + H_FILA / 2 - 0.5); c.stroke();
    c.fillStyle = "#000"; fuente("bold"); texto(d.nombre, X1 + 13, y + H_FILA / 2); texto(num(d.n), X2, y + H_FILA / 2, "right"); texto(num(d.min), X3, y + H_FILA / 2, "right");
    y += H_FILA;
    d.tecs.forEach((t) => {
      c.fillStyle = "#000"; fuente("normal"); texto(t.nombre, X1 + 24, y + H_FILA / 2); texto(num(t.n), X2, y + H_FILA / 2, "right"); texto(num(t.min), X3, y + H_FILA / 2, "right");
      y += H_FILA;
    });
  });

  // Total general
  c.fillStyle = AZUL; c.fillRect(0, y, W, H_FILA); linea(y, LINEA);
  c.fillStyle = "#000"; fuente("bold"); texto("Total general", X1, y + H_FILA / 2); texto(num(pivot.total.n), X2, y + H_FILA / 2, "right"); texto(num(pivot.total.min), X3, y + H_FILA / 2, "right");
  y += H_FILA; linea(y, LINEA);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la imagen."))), "image/jpeg", 0.95));
}
