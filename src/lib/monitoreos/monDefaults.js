// Configuración inicial de los monitoreos (componentes, subcomponentes, pesos, semáforo y errores críticos), tomada del Excel "Auditoría Biver / Jamar".
// Se puede cambiar en Maestros → Monitoreos; lo guardado allí reemplaza estos valores.
export const MON_DEFAULT = {
 "version": 1,
 "canales": {
  "Digital": {
   "componentes": [
    {
     "id": "dig-c1",
     "codigo": "C1",
     "nombre": "Validación Causal",
     "peso": 35,
     "activo": true,
     "subs": [
      {
       "id": "dig-c1-1",
       "nombre": "Causal correctamente seleccionada",
       "campo": "Causal Correcta",
       "descripcion": "La causal registrada en Extreme corresponde al diagnóstico real del técnico",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c1-2",
       "nombre": "Resultado coherente con diagnóstico",
       "campo": "Coherencia Diagnóstico",
       "descripcion": "El resultado del servicio es coherente con el diagnóstico escrito",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c1-3",
       "nombre": "Coherencia entre causal y fotos",
       "campo": "Coherencia Fotos",
       "descripcion": "Las evidencias fotográficas son coherentes con la causal registrada",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c1-4",
       "nombre": "Coherencia entre causal y llamada cliente",
       "campo": "Confirmación Cliente",
       "descripcion": "El cliente confirma la causal registrada durante la llamada de validación",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c1-5",
       "nombre": "Todos los productos correctamente cerrados",
       "campo": "Todos Productos Cerrados",
       "descripcion": "Todos los productos del servicio tienen cierre correcto en el sistema",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      }
     ]
    },
    {
     "id": "dig-c2",
     "codigo": "C2",
     "nombre": "Evidencia Fotográfica",
     "peso": 25,
     "activo": true,
     "subs": [
      {
       "id": "dig-c2-1",
       "nombre": "Fotos completas",
       "campo": "Fotos Completas",
       "descripcion": "El servicio cuenta con todas las fotos requeridas según el protocolo",
       "regla": "Si No Cumple → Resultado C2 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c2-2",
       "nombre": "Producto visible completamente",
       "campo": "Producto Visible",
       "descripcion": "El producto aparece completamente visible en las fotografías",
       "regla": "Si No Cumple → Resultado C2 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c2-3",
       "nombre": "Evidencia antes/después",
       "campo": "Evidencia Antes/Después",
       "descripcion": "Existen fotos del estado antes y después del servicio",
       "regla": "Si No Cumple → Resultado C2 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c2-4",
       "nombre": "Evidencia de novedad si aplica",
       "campo": "Evidencia Novedad",
       "descripcion": "Si hubo novedad, existe evidencia fotográfica de la misma",
       "regla": "N/A si no hubo novedad. Si aplica y No Cumple → NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c2-5",
       "nombre": "Calidad visual suficiente",
       "campo": "Calidad Visual",
       "descripcion": "Las fotos tienen calidad visual suficiente para validar el servicio",
       "regla": "Si No Cumple → Resultado C2 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c2-6",
       "nombre": "Fotos corresponden al producto correcto",
       "campo": "Correspondencia Producto",
       "descripcion": "Las fotos corresponden al producto y servicio auditado, no a otro",
       "regla": "Si No Cumple → Resultado C2 = NEGATIVO. Posible error crítico.",
       "activo": true
      }
     ]
    },
    {
     "id": "dig-c3",
     "codigo": "C3",
     "nombre": "Diagnóstico y Redacción",
     "peso": 15,
     "activo": true,
     "subs": [
      {
       "id": "dig-c3-1",
       "nombre": "Diagnóstico entendible",
       "campo": "Diagnóstico Entendible",
       "descripcion": "El diagnóstico escrito es comprensible para cualquier lector",
       "regla": "Si No Cumple → Resultado C3 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c3-2",
       "nombre": "Buena ortografía",
       "campo": "Ortografía OK",
       "descripcion": "El texto no presenta errores ortográficos graves",
       "regla": "Si No Cumple → Resultado C3 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c3-3",
       "nombre": "Redacción clara",
       "campo": "Redacción Clara",
       "descripcion": "La redacción es clara, directa y profesional",
       "regla": "Si No Cumple → Resultado C3 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c3-4",
       "nombre": "Información suficiente",
       "campo": "Información Suficiente",
       "descripcion": "El diagnóstico contiene información suficiente para entender el servicio",
       "regla": "Si No Cumple → Resultado C3 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c3-5",
       "nombre": "No uso de términos ambiguos",
       "campo": "Sin Términos Ambiguos",
       "descripcion": "No se usan términos vagos o ambiguos que dificulten la comprensión",
       "regla": "Si No Cumple → Resultado C3 = NEGATIVO",
       "activo": true
      }
     ]
    },
    {
     "id": "dig-c4",
     "codigo": "C4",
     "nombre": "Validación Cliente",
     "peso": 15,
     "activo": true,
     "subs": [
      {
       "id": "dig-c4-1",
       "nombre": "Cliente confirma resultado",
       "campo": "Confirma Causal",
       "descripcion": "El cliente confirma el resultado del servicio durante la llamada",
       "regla": "Si No Cumple → Resultado C4 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c4-2",
       "nombre": "Cliente confirma atención técnica",
       "campo": "Confirma Visita",
       "descripcion": "El cliente confirma que el técnico realizó la visita",
       "regla": "Si No Cumple → posible error crítico (cliente niega aplazamiento)",
       "activo": true
      },
      {
       "id": "dig-c4-3",
       "nombre": "Cliente confirma causal",
       "campo": "Confirma Resultado",
       "descripcion": "El cliente confirma la causal registrada en el sistema",
       "regla": "Si No Cumple → Resultado C4 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c4-4",
       "nombre": "Cliente confirma fecha/hora",
       "campo": "Confirma Atención",
       "descripcion": "El cliente confirma la fecha y hora del servicio registradas",
       "regla": "Si No Cumple → Resultado C4 = NEGATIVO",
       "activo": true
      }
     ]
    },
    {
     "id": "dig-c5",
     "codigo": "C5",
     "nombre": "Cumplimiento Operativo",
     "peso": 10,
     "activo": true,
     "subs": [
      {
       "id": "dig-c5-1",
       "nombre": "Cierre realizado oportunamente",
       "campo": "Cierre Oportuno",
       "descripcion": "El cierre del servicio fue registrado en el tiempo establecido",
       "regla": "Si No Cumple → Resultado C5 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c5-2",
       "nombre": "Información completa en sistema",
       "campo": "Datos Completos",
       "descripcion": "Todos los campos requeridos del servicio están completos en Extreme",
       "regla": "Si No Cumple → Resultado C5 = NEGATIVO",
       "activo": true
      },
      {
       "id": "dig-c5-3",
       "nombre": "Sin inconsistencias administrativas",
       "campo": "Sin Inconsistencias",
       "descripcion": "No existen inconsistencias entre los datos del servicio y el sistema",
       "regla": "Si No Cumple → Resultado C5 = NEGATIVO",
       "activo": true
      }
     ]
    }
   ]
  },
  "Presencial": {
   "componentes": [
    {
     "id": "pre-c1",
     "codigo": "C1",
     "nombre": "Calidad Técnica",
     "peso": 40,
     "activo": true,
     "subs": [
      {
       "id": "pre-c1-1",
       "nombre": "Nivelación",
       "campo": "Nivelación Correcta",
       "descripcion": "El producto quedó correctamente nivelado tras el armado",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c1-2",
       "nombre": "Ajustes",
       "campo": "Ajustes Adecuados",
       "descripcion": "Los ajustes del producto son correctos y funcionales",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c1-3",
       "nombre": "Tornillería",
       "campo": "Tornillería Completa",
       "descripcion": "Toda la tornillería está instalada y correctamente ajustada",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c1-4",
       "nombre": "Estabilidad",
       "campo": "Estabilidad del Producto",
       "descripcion": "El producto es estable y no presenta riesgo de caída o movimiento",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c1-5",
       "nombre": "Procedimiento correcto",
       "campo": "Procedimiento Correcto",
       "descripcion": "El técnico siguió el procedimiento técnico establecido",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c1-6",
       "nombre": "Estado final",
       "campo": "Estado Final OK",
       "descripcion": "El estado final del producto es satisfactorio y sin daños",
       "regla": "Si No Cumple → Resultado C1 = NEGATIVO",
       "activo": true
      }
     ]
    },
    {
     "id": "pre-c2",
     "codigo": "C2",
     "nombre": "Servicio al Cliente",
     "peso": 25,
     "activo": true,
     "subs": [
      {
       "id": "pre-c2-1",
       "nombre": "Presentación personal",
       "campo": "Presentación Personal",
       "descripcion": "El técnico se presentó con uniforme y apariencia adecuada",
       "regla": "Si No Cumple → Resultado C2 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c2-2",
       "nombre": "Comunicación",
       "campo": "Comunicación Efectiva",
       "descripcion": "El técnico se comunicó de forma clara y efectiva con el cliente",
       "regla": "Si No Cumple → Resultado C2 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c2-3",
       "nombre": "Respeto",
       "campo": "Respeto al Cliente",
       "descripcion": "El técnico trató al cliente con respeto en todo momento",
       "regla": "Si No Cumple → posible error crítico (maltrato)",
       "activo": true
      },
      {
       "id": "pre-c2-4",
       "nombre": "Limpieza",
       "campo": "Limpieza del Área",
       "descripcion": "El técnico dejó el área de trabajo limpia al finalizar",
       "regla": "Si No Cumple → Resultado C2 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c2-5",
       "nombre": "Actitud",
       "campo": "Actitud Profesional",
       "descripcion": "El técnico mantuvo actitud profesional durante todo el servicio",
       "regla": "Si No Cumple → Resultado C2 = NEGATIVO",
       "activo": true
      }
     ]
    },
    {
     "id": "pre-c3",
     "codigo": "C3",
     "nombre": "Validación Operativa",
     "peso": 20,
     "activo": true,
     "subs": [
      {
       "id": "pre-c3-1",
       "nombre": "Coincidencia cierre vs realidad",
       "campo": "Coincidencia Cierre vs Realidad",
       "descripcion": "Lo registrado en el sistema coincide con lo observado en sitio",
       "regla": "Si No Cumple → posible error crítico (cierre fraudulento)",
       "activo": true
      },
      {
       "id": "pre-c3-2",
       "nombre": "Coincidencia causal",
       "campo": "Coincidencia Causal",
       "descripcion": "La causal registrada coincide con la situación real del producto",
       "regla": "Si No Cumple → Resultado C3 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c3-3",
       "nombre": "Evidencias reales",
       "campo": "Evidencias Reales",
       "descripcion": "Las evidencias fotográficas corresponden a la realidad observada",
       "regla": "Si No Cumple → posible error crítico (fotos manipuladas)",
       "activo": true
      }
     ]
    },
    {
     "id": "pre-c4",
     "codigo": "C4",
     "nombre": "Seguridad y Buenas Prácticas",
     "peso": 15,
     "activo": true,
     "subs": [
      {
       "id": "pre-c4-1",
       "nombre": "Uso herramientas",
       "campo": "Uso Correcto Herramientas",
       "descripcion": "El técnico usó las herramientas correctas para el tipo de armado",
       "regla": "Si No Cumple → Resultado C4 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c4-2",
       "nombre": "Manipulación correcta",
       "campo": "Manipulación Correcta",
       "descripcion": "El técnico manipuló el producto de forma correcta y segura",
       "regla": "Si No Cumple → Resultado C4 = NEGATIVO",
       "activo": true
      },
      {
       "id": "pre-c4-3",
       "nombre": "Seguridad del cliente",
       "campo": "Seguridad del Cliente",
       "descripcion": "El técnico garantizó la seguridad del cliente durante el servicio",
       "regla": "Si No Cumple → Resultado C4 = NEGATIVO",
       "activo": true
      }
     ]
    }
   ]
  }
 },
 "semaforo": [
  {
   "nombre": "Verde",
   "min": 95,
   "color": "#3F9D6E",
   "descripcion": "Desempeño excelente. Sin intervención requerida.",
   "accion": "Mantener seguimiento periódico."
  },
  {
   "nombre": "Amarillo",
   "min": 90,
   "color": "#E0B020",
   "descripcion": "Desempeño aceptable. Seguimiento preventivo.",
   "accion": "Retroalimentación semanal."
  },
  {
   "nombre": "Naranja",
   "min": 80,
   "color": "#E07B2E",
   "descripcion": "Requiere plan de mejora obligatorio.",
   "accion": "Plan de acción en máximo 5 días hábiles."
  },
  {
   "nombre": "Rojo",
   "min": 0,
   "color": "#C0463A",
   "descripcion": "Estado crítico. Acción inmediata requerida.",
   "accion": "Intervención inmediata. Posible suspensión temporal."
  }
 ],
 "erroresCriticos": [
  {
   "nombre": "Información Falsa",
   "descripcion": "Datos registrados en el sistema que no corresponden a la realidad"
  },
  {
   "nombre": "Causal Incorrecta Intencional",
   "descripcion": "Selección deliberada de causal incorrecta"
  },
  {
   "nombre": "Cliente Niega Aplazamiento",
   "descripcion": "El cliente contradice el aplazamiento registrado"
  },
  {
   "nombre": "Fotos Inexistentes",
   "descripcion": "No existen evidencias fotográficas del servicio"
  },
  {
   "nombre": "Fotos Manipuladas",
   "descripcion": "Evidencias fotográficas alteradas digitalmente"
  },
  {
   "nombre": "Firma Inconsistente/Falsa",
   "descripcion": "Firma del cliente inconsistente o generada sin consentimiento"
  },
  {
   "nombre": "Maltrato al Cliente",
   "descripcion": "Conducta inapropiada o trato descortés hacia el cliente"
  },
  {
   "nombre": "Cobro Indebido",
   "descripcion": "Cualquier cargo no autorizado al cliente"
  },
  {
   "nombre": "Omisión Grave",
   "descripcion": "Información crítica omitida intencionalmente"
  },
  {
   "nombre": "Cierre Fraudulento",
   "descripcion": "Cierre registrado sin haberse realizado el servicio"
  }
 ]
};
