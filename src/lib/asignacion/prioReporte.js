// Prioridad 1 por lo que dice "Cliente reporta": si menciona un incumplimiento (o algo parecido, incluso mal escrito: INCUMPLIMINTO, INCUMPLIO, INCOMPLIMIENTO...),
// el servicio se resalta como P1 en los PDF de Asignación y de Carga para que el técnico lo priorice.
const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const PARECIDAS = [
  /INC[UO]M?P?L/,                                   // incumplimiento, incumplio, incumple, incomplimiento, incumplimiento mal escrito (INCUMPLIMINTO, INCUPLIMIENTO)
  /NO\s+CUMPL(IO|E|IERON|IDO)/,                     // no cumplió / no cumple / no cumplieron
  /NO\s+SE\s+PRESENT(O|ARON)/,                      // no se presentó
  /(TECNICO|ARMADOR)\s+NO\s+(LLEGO|VINO|FUE|APARECIO)/, // el técnico no llegó / no vino / no fue
  /NO\s+LLEGO\s+(EL|LA)\s+(TECNICO|ARMADOR)/,
];
export const reporteIndicaIncumplimiento = (texto) => { const s = plano(texto); return !!s && PARECIDAS.some((r) => r.test(s)); };
