import { useState, useEffect } from "react";

/* Pantalla de carga de la plataforma: un castor con casco armando un mueble (ilustración plana, tonos tierra), mensajes que van cambiando y una barra de avance.
   Es liviana a propósito: un SVG en línea y animaciones CSS, sin imágenes ni librerías. Respeta "reducir movimiento". */

const MENSAJES = [
  "Cargando datos...",
  "Preparando tus módulos...",
  "Armando la plataforma...",
  "Revisando que todo esté en su lugar...",
  "Pronto estaremos listos...",
  "Ya casi...",
];

const CSS = `
  @keyframes amg-martillo { 0%, 100% { transform: rotate(-12deg); } 45%, 55% { transform: rotate(7deg); } }
  @keyframes amg-golpe { 0%, 40% { transform: translateY(0); } 50% { transform: translateY(1px); } 60%, 100% { transform: translateY(0); } }
  @keyframes amg-tabla { 0% { transform: translateY(-12px); opacity: 0; } 25% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(0); opacity: 1; } }
  @keyframes amg-cola { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-3deg); } }
  @keyframes amg-aparece { 0% { opacity: 0; transform: translateY(4px); } 15%, 85% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-4px); } }
  .amg-castor-martillo { transform-origin: 74px 74px; animation: amg-martillo 1.1s ease-in-out infinite; }
  .amg-castor-caja { animation: amg-golpe 1.1s ease-in-out infinite; }
  .amg-castor-tabla { animation: amg-tabla 2.2s ease-out infinite; }
  .amg-castor-cola { transform-origin: 44px 100px; animation: amg-cola 1.1s ease-in-out infinite; }
  .amg-carga-mensaje { animation: amg-aparece 2.4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .amg-castor-martillo, .amg-castor-caja, .amg-castor-tabla, .amg-castor-cola, .amg-carga-mensaje { animation: none; } }
`;

function Castor() {
  return (
    <svg width="220" height="143" viewBox="0 0 200 130" role="img" aria-label="Un castor con casco armando un mueble">
      <defs>
        <clipPath id="amg-clip-cola"><ellipse cx="29" cy="104" rx="21" ry="8.5" transform="rotate(-10 29 104)" /></clipPath>
      </defs>
      {/* suelo */}
      <ellipse cx="100" cy="118" rx="84" ry="3.2" fill="currentColor" opacity="0.1" />
      <line x1="12" y1="117" x2="188" y2="117" stroke="currentColor" strokeWidth="1" opacity="0.22" />

      {/* mueble en armado */}
      <g transform="translate(-8 0)">
        <g className="amg-castor-caja">
          <rect x="124" y="60" width="52" height="56" fill="#EBDCC3" />
          <rect x="124" y="60" width="6" height="56" fill="#C9955C" stroke="#8A5A2B" strokeWidth="1" />
          <rect x="170" y="60" width="6" height="56" fill="#C9955C" stroke="#8A5A2B" strokeWidth="1" />
          <rect x="130" y="86" width="40" height="5" fill="#D9A86C" stroke="#8A5A2B" strokeWidth="1" />
          <rect x="130" y="112" width="40" height="4" fill="#D9A86C" stroke="#8A5A2B" strokeWidth="1" />
          <circle cx="127" cy="75" r="1" fill="#6B4423" /><circle cx="173" cy="75" r="1" fill="#6B4423" />
        </g>
        <g className="amg-castor-tabla">
          <rect x="122" y="53" width="56" height="7" rx="1.5" fill="#E2B67C" stroke="#8A5A2B" strokeWidth="1" />
          <circle cx="127" cy="56.5" r="1.1" fill="#6B4423" /><circle cx="173" cy="56.5" r="1.1" fill="#6B4423" />
        </g>
      </g>

      {/* cola con textura de escamas */}
      <g className="amg-castor-cola">
        <ellipse cx="29" cy="104" rx="21" ry="8.5" transform="rotate(-10 29 104)" fill="#3E2A1B" />
        <g clipPath="url(#amg-clip-cola)" stroke="#6B4A33" strokeWidth="0.8" opacity="0.7" fill="none">
          <path d="M10 98l10 12M17 96l10 14M24 95l10 14M31 94l10 14M38 93l10 14" />
          <path d="M10 111l12-10M14 114l16-13M22 114l16-13M30 114l16-13" />
        </g>
      </g>

      {/* patas */}
      <ellipse cx="55" cy="115.5" rx="9" ry="3" fill="#4A301D" />
      <ellipse cx="80" cy="115.5" rx="9" ry="3" fill="#4A301D" />

      {/* cuerpo */}
      <path d="M42 96 C40 74 52 66 68 66 C86 66 94 78 92 96 C91 108 86 114 66 114 C50 114 43 108 42 96 Z" fill="#7A4E2D" />
      <path d="M62 80 C70 74 84 78 86 92 C87 104 80 110 70 110 C62 110 58 100 59 91 C59 86 60 83 62 80 Z" fill="#D5B28C" />

      {/* cabeza */}
      <path d="M52 50 C52 36 62 28 74 28 C88 28 96 36 98 46 C100 52 104 54 104 58 C104 63 98 66 90 66 C78 68 68 68 60 64 C54 61 52 56 52 50 Z" fill="#7A4E2D" />
      <path d="M82 50 C90 48 100 52 103 57 C104 62 98 66 90 66 C84 66 80 62 80 57 C80 54 81 52 82 50 Z" fill="#D5B28C" />
      <ellipse cx="103" cy="55.6" rx="3.4" ry="2.5" fill="#2A1A10" />
      <path d="M88 63.5 Q93 65 98 63.5" stroke="#5C3A21" strokeWidth="1" fill="none" strokeLinecap="round" />
      <rect x="92" y="63.6" width="3" height="4.6" rx="0.8" fill="#F4EBDD" stroke="#9A7A55" strokeWidth="0.5" />
      <rect x="95.2" y="63.6" width="3" height="4.6" rx="0.8" fill="#F4EBDD" stroke="#9A7A55" strokeWidth="0.5" />
      <circle cx="82" cy="49" r="2" fill="#1F130B" /><circle cx="82.7" cy="48.3" r="0.65" fill="#fff" />
      <path d="M77.5 45.2 Q82 43 86 45" stroke="#4A301D" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <circle cx="60" cy="40" r="5.2" fill="#5C3A21" /><circle cx="60" cy="40" r="2.4" fill="#3E2A1B" />

      {/* casco de obra */}
      <path d="M55 37 C55 20 64 14 76 14 C88 14 96 21 96 37 Z" fill="#E08A1E" />
      <path d="M76 14 L76 37" stroke="#B86F10" strokeWidth="1.2" />
      <path d="M66 17 Q64 26 64 37 M86 17 Q88 26 88 37" stroke="#C97A14" strokeWidth="1" fill="none" />
      <rect x="50" y="35.5" width="52" height="5" rx="2.5" fill="#C77712" />
      <path d="M60 23 Q64 18 70 16.5" stroke="#F6C46B" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.9" />

      {/* brazo con martillo: gira desde el hombro */}
      <g className="amg-castor-martillo">
        <path d="M70 70 C80 67 98 68 111 72 L111 79 C98 77 82 78 72 79 Z" fill="#6E4527" />
        <circle cx="113" cy="75" r="4.6" fill="#5C3A21" />
        <rect x="111.4" y="48" width="3.2" height="28" rx="1.6" fill="#A8744A" />
        <rect x="104" y="43.5" width="18" height="8.5" rx="1.8" fill="#8E9399" stroke="#5A5D62" strokeWidth="1" />
        <rect x="104" y="43.5" width="18" height="2.6" rx="1.2" fill="#B7BBC0" opacity="0.8" />
      </g>
    </svg>
  );
}

export default function PantallaCarga() {
  const [i, setI] = useState(0);
  const [pct, setPct] = useState(6);
  const [largo, setLargo] = useState(false);

  // El mensaje cambia cada 2,4 s; la barra avanza rápido al principio y se frena cerca del 92 % (el avance real depende de la red).
  useEffect(() => { const t = setInterval(() => setI((n) => (n + 1) % MENSAJES.length), 2400); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setPct((p) => p + (92 - p) * 0.07), 300); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setTimeout(() => setLargo(true), 15000); return () => clearTimeout(t); }, []);

  return (
    <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, color: "var(--accent)", padding: 24, textAlign: "center" }}>
      <style>{CSS}</style>
      <Castor />
      <div key={i} className="amg-carga-mensaje" style={{ color: "var(--text-dim)", fontSize: 14, fontWeight: 500, minHeight: 20 }}>{MENSAJES[i]}</div>
      <div style={{ width: 220, height: 6, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 4, transition: "width 0.3s linear" }} />
      </div>
      <div style={{ color: "var(--text-faint)", fontSize: 12, minHeight: 16 }}>{largo ? "Esto está tardando un poco más de lo normal. Si no avanza, recarga con Ctrl+F5." : "Plataforma Operativa - Biver"}</div>
    </div>
  );
}
