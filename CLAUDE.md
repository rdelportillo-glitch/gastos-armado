# Plataforma operativa — Gastos, Asignación y Armados (contexto para Claude Code)

Aplicación web de operación para una empresa de armado de muebles: gastos de técnicos, personal, asignación de servicios,
programación, instalación de TV y armados en almacén. **Stack:** React 18 + Vite 5 + Supabase (Postgres, Auth, Storage,
una Edge Function) + Vercel (despliegue automático desde GitHub). El dueño de la plataforma **no es desarrollador**: habla en
español, quiere pasos exactos y respuestas concisas. Responde siempre en español.

> Las "Reglas de trabajo" de abajo son los valores por defecto con los que se construyó la plataforma. El dueño actual puede
> cambiarlas: edítalas aquí si te lo pide.

## Reglas de trabajo (por defecto)

1. **Estabilidad primero.** La plataforma está en producción con usuarios reales.
2. **Nunca hagas push ni merge a `main` sin autorización explícita** del dueño ("pásalo a productivo" o equivalente). Cada cambio va
   en una rama `feature/...` o `fix/...`; Vercel genera una vista previa de cada rama para que el dueño pruebe antes.
3. **Después de cada cambio corre `npm run build`** y verifica la lógica con pruebas de Node cuando sea posible.
4. **Cambios de base de datos (SQL / RLS / buckets):** nunca los ejecutes tú. Escribe un archivo nuevo `sql/NN_nombre.sql`
   (idempotente: `if not exists`, `drop policy if exists`...), presenta un bloque **"CAMBIO DE BASE DE DATOS REQUERIDO"**
   (Qué se necesita / Por qué / Tablas afectadas / Riesgo / SQL propuesta) y espera a que el dueño lo corra en el SQL Editor de
   Supabase y te confirme ("ya corrí el sql NN"). Solo entonces anuncia el cambio como listo para pruebas.
5. **No borres datos.** Lo que sale de uso se inactiva, cancela, anula o archiva; las tablas nuevas no llevan política de DELETE.
6. **Seguridad:** nunca pidas ni escribas contraseñas, `service_role key` ni claves privadas en el chat, el código o los commits.
   Solo la `anon key` y la URL de Supabase van al frontend (variables de entorno en Vercel / `.env`, que no se sube a Git).
7. **Flujo de entrega:** (1) rama + cambios + `npm run build`, (2) commit descriptivo y push de la rama, (3) anuncia
   **"CAMBIO LISTO PARA PRUEBAS"** (rama, qué cambió, cómo probar), (4) cuando el dueño apruebe: merge a `main`, push y reporta
   **"CAMBIO PUBLICADO"** (Commit / Branch / Vercel / Producción / Cambios realizados / Pruebas realizadas).
8. Si hay duda sobre lo que el dueño quiere, **pregunta antes de desarrollar** (pocas preguntas, con una opción recomendada).
9. Respeta el estilo del código existente (comentarios en español, nombres en español para el dominio, sin librerías nuevas
   sin necesidad).

## Arquitectura

- `src/App.jsx` (archivo grande): inicio de sesión, dashboard, gastos, personal, inventario, carga, maestros, usuarios, reportes,
  menú lateral (`NAV_ITEMS`, `NAV_GROUPS`) y permisos por rol. Módulos en archivos propios: `Asignacion.jsx`, `Historico.jsx`,
  `InstalacionTV.jsx`, `Programacion.jsx`, `Armados.jsx`, `ArmadosInforme.jsx`.
- `src/lib/`: `supabaseClient.js`, `api.js` (carga inicial y sincronización), `mapping.js` (fila BD ⇄ objeto de la app),
  `maestrosApi.js` y `maestrosParsers.js` / `maestrosPlantillas.js` (maestros y sus plantillas Excel), `coordinadores.js`,
  `asignacion/` (motor de asignación, geografía, maestros, salidas PDF/Excel, histórico), `tv/`, `programacion/`, `armados/`.
- **Datos:** el estado completo vive en `db` (memoria). Cada cambio arma una copia `next` y llama `persist(next)`, que compara con
  el estado anterior y envía a Supabase solo las filas cambiadas (con reintentos ante errores de sesión). Las tablas grandes
  (gastos, servicios, movimientos) se leen por páginas de 1000. Los maestros de zonas/barrios/productos se consultan directo.
- **Configuración compartida** en la tabla `assignment_settings` (clave → JSON): `rules` (criterios de asignación),
  `tv_config` (Instalación de TV y sus objetivos), `cambio_tecnico_email`, `coordinadores`.
- **Edge Function** `supabase/functions/create-user`: crea usuarios (solo la puede llamar un administrador).

## Módulos (resumen)

- **Gastos / Personal / Inventario / Reportes / Maestros / Usuarios:** base original. Personal incluye datos de asignación
  (capacidad, transporte, pico y placa, vivienda, coordinador — este último sale de Maestros → Coordinadores).
- **Carga:** servicios "En gestión" enviados desde Asignación; finalizar el día los archiva al histórico.
- **Asignación (4 pasos):** carga del día (bases Jamar/TUGO + servicios de Programación y Armados en almacén), técnicos del día,
  asignación automática con ajustes manuales, salidas (PDF por región, resumen, CSV, Cambio de técnico). Un registro de `services`
  por **producto/unidad**. El motor (`asignacion/engine.js`) respeta región, perfil (maestro), pico y placa (se evalúa el "día de
  ejecución"), cercanía a la vivienda, zonas contiguas y capacidad.
- **Programación de servicios:** órdenes `PS-000001` (consecutivo de la BD) con número de servicio propio (obligatorio en Ruta
  Crítica); al guardar crean servicios Pendientes que entran a Asignación.
- **Armados en almacén:** solicitudes por almacén `AA-000001` (PQR), armados del técnico con fotos, cierre validado, informe en
  Resumen, sincronización con Asignación en lotes por jornada (`armados/armadosSync.js`).
- **Instalación de TV:** agenda de llamadas guiada, ejecución y cobro; dashboard en Resumen; configuración y objetivos en Maestros.

## Roles y seguridad (RLS)

Roles: `admin`, `operador`, `consulta` (internos) y `cliente`, `tecnico` (externos). La seguridad real está en la base de datos
(políticas RLS), no solo en la pantalla. Funciones clave: `current_role()`, `is_active_user()` (excluye cliente y técnico: ninguna
tabla interna les responde), `my_client()`, `my_technician()`. Los externos solo ven las vistas de la lista blanca `EXTERNAS` en
`App.jsx`. Para consultar tablas desde otras políticas usa funciones `security definer` (evita recursión de políticas).
Los archivos van a buckets **privados** de Storage con URLs firmadas temporales.

## Cosas que ya costaron tiempo (no las repitas)

- Fechas en Excel: se escriben como número de serie entero + formato `dd/mm/yyyy` (SheetJS con `Date` corre un día).
- Comparaciones de departamentos/ciudades/barrios: **sin tildes y sin mayúsculas** (`deaccent` + mayúsculas).
- `jsonb` de Postgres reordena las llaves: compara contenido con llaves ordenadas, no con `JSON.stringify` directo.
- Un servicio de Asignación solo entra al pool si está Pendiente, no cancelado, y su fecha ≤ la fecha de asignación.
- Después de publicar, una pestaña abierta con la versión anterior puede fallar al pedir archivos que ya no existen
  (ej. generar un PDF): se resuelve recargando con Ctrl+F5.
- Los PDFs (`jspdf`) se cargan con `import()` dinámico.

## Despliegue

GitHub → Vercel (build `npm run build`, salida `dist`). Variables de entorno en Vercel: `VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY`. En Supabase → Authentication → URL Configuration: Site URL y Redirect URLs con el dominio de la
plataforma. Guía completa de instalación en un proyecto nuevo: `docs/TRASPASO_PLATAFORMA.md`.

## Base de datos

Los scripts `sql/01_…` a `sql/NN_…` se ejecutan **en orden numérico** en el SQL Editor de Supabase. Cada cambio de BD nuevo es un
archivo nuevo con el siguiente número. `sql/03` y `sql/04` traen datos de demostración.
