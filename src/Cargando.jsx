import { useState, useEffect } from "react";

/* Pantalla de carga de la plataforma: un castor armando un mueble, mensajes que van cambiando y una barra de avance.
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
  @keyframes amg-martillo { 0%, 100% { transform: rotate(-38deg); } 45% { transform: rotate(14deg); } 55% { transform: rotate(14deg); } }
  @keyframes amg-golpe { 0%, 40% { transform: translateY(0); } 50% { transform: translateY(1.5px); } 60%, 100% { transform: translateY(0); } }
  @keyframes amg-tabla { 0% { transform: translateY(-14px); opacity: 0; } 25% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(0); opacity: 1; } }
  @keyframes amg-cola { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-6deg); } }
  @keyframes amg-aparece { 0% { opacity: 0; transform: translateY(4px); } 15%, 85% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-4px); } }
  .amg-castor-martillo { transform-origin: 78px 60px; animation: amg-martillo 1.1s ease-in-out infinite; }
  .amg-castor-caja { animation: amg-golpe 1.1s ease-in-out infinite; }
  .amg-castor-tabla { animation: amg-tabla 2.2s ease-out infinite; }
  .amg-castor-cola { transform-origin: 40px 82px; animation: amg-cola 1.1s ease-in-out infinite; }
  .amg-carga-mensaje { animation: amg-aparece 2.4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .amg-castor-martillo, .amg-castor-caja, .amg-castor-tabla, .amg-castor-cola, .amg-carga-mensaje { animation: none; } }
`;

function Castor() {
  return (
    <svg width="170" height="120" viewBox="0 0 170 120" role="img" aria-label="Un castor armando un mueble">
      {/* suelo */}
      <ellipse cx="85" cy="108" rx="70" ry="5" fill="currentColor" opacity="0.12" />
      {/* mueble que se va armando */}
      <g className="amg-castor-caja">
        <rect x="104" y="70" width="46" height="34" rx="3" fill="#C98F4E" stroke="#8A5A2B" strokeWidth="2" />
        <line x1="104" y1="87" x2="150" y2="87" stroke="#8A5A2B" strokeWidth="2" />
        <circle cx="127" cy="78" r="2" fill="#8A5A2B" />
        <circle cx="127" cy="96" r="2" fill="#8A5A2B" />
      </g>
      <rect className="amg-castor-tabla" x="106" y="60" width="42" height="7" rx="2" fill="#E0A964" stroke="#8A5A2B" strokeWidth="1.5" />
      {/* cola */}
      <g className="amg-castor-cola">
        <ellipse cx="30" cy="90" rx="16" ry="7" fill="#5B3A22" transform="rotate(-18 30 90)" />
        <path d="M20 86l20 8M22 91l20 4" stroke="#3E2616" strokeWidth="1" opacity="0.6" />
      </g>
      {/* cuerpo */}
      <ellipse cx="55" cy="84" rx="25" ry="22" fill="#8A5A2B" />
      <ellipse cx="60" cy="90" rx="14" ry="13" fill="#D9B07A" />
      {/* patas */}
      <ellipse cx="46" cy="104" rx="8" ry="4" fill="#5B3A22" />
      <ellipse cx="68" cy="104" rx="8" ry="4" fill="#5B3A22" />
      {/* cabeza */}
      <circle cx="62" cy="52" r="20" fill="#8A5A2B" />
      <circle cx="49" cy="36" r="6" fill="#8A5A2B" /><circle cx="49" cy="36" r="3" fill="#5B3A22" />
      <circle cx="75" cy="36" r="6" fill="#8A5A2B" /><circle cx="75" cy="36" r="3" fill="#5B3A22" />
      <ellipse cx="70" cy="58" rx="12" ry="9" fill="#D9B07A" />
      <circle cx="70" cy="53" r="3.2" fill="#2B1A0E" />
      <circle cx="68" cy="46" r="2.4" fill="#2B1A0E" /><circle cx="68.8" cy="45.2" r="0.8" fill="#fff" />
      <circle cx="55" cy="46" r="2.4" fill="#2B1A0E" /><circle cx="55.8" cy="45.2" r="0.8" fill="#fff" />
      {/* dientes de castor */}
      <rect x="66" y="60" width="5" height="7" rx="1" fill="#fff" stroke="#8A5A2B" strokeWidth="0.8" />
      <rect x="71" y="60" width="5" height="7" rx="1" fill="#fff" stroke="#8A5A2B" strokeWidth="0.8" />
      {/* casco amarillo de obra */}
      <g>
        <path d="M41 37 Q41 13 62 13 Q83 13 83 37 Z" fill="#F2A900" stroke="#B87800" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M62 13 L62 37" stroke="#B87800" strokeWidth="1.4" />
        <path d="M52 15.5 Q50 26 50 37 M72 15.5 Q74 26 74 37" stroke="#D99000" strokeWidth="1.4" fill="none" />
        <rect x="58" y="9" width="8" height="5" rx="2" fill="#F2A900" stroke="#B87800" strokeWidth="1.4" />
        <rect x="35" y="35" width="54" height="6" rx="3" fill="#E09A00" stroke="#B87800" strokeWidth="1.6" />
        <path d="M47 20 Q52 15.5 58 15" stroke="#FFE08A" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.85" />
      </g>
      {/* brazo con martillo */}
      <g className="amg-castor-martillo">
        <rect x="76" y="56" width="5" height="34" rx="2" fill="#6B4423" />
        <rect x="68" y="50" width="22" height="10" rx="2" fill="#7B7F86" stroke="#4A4D52" strokeWidth="1.2" />
        <circle cx="78" cy="62" r="5" fill="#8A5A2B" />
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
