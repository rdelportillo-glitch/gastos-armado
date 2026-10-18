# Prompts para el nuevo Claude Code

Copia y pega cada bloque en Claude Code, **con la carpeta del proyecto abierta**.

---

## Prompt 1 — Primera sesión (instalar la plataforma en cuentas nuevas)

```text
Acabo de recibir esta plataforma operativa (React + Vite + Supabase + Vercel) de otro equipo. Tengo mi propia cuenta de
Supabase, de Vercel y de GitHub, todas nuevas y vacías. Soy dueño del negocio y NO soy programador: háblame en español, con
pasos exactos de "haz clic aquí / pega esto".

Recibí el proyecto como un ZIP, sin ninguna conexión con el repositorio de origen: el GitHub debe ser nuevo y mío. Si todavía no
existe un repositorio mío para este proyecto, ayúdame a crearlo y a subir el código (git init, commit y push) con mi cuenta.

Antes de hacer nada:
1. Lee CLAUDE.md, docs/TRASPASO_PLATAFORMA.md, README.md y la lista de archivos de la carpeta sql/.
2. Corre `npm install` y `npm run build` para confirmar que el proyecto compila en mi computador.
3. Resúmeme en pocas líneas qué hace la plataforma y qué módulos tiene, para confirmar que entendiste.

Luego guíame, UNA parte a la vez y esperando mi confirmación entre cada una, por la guía docs/TRASPASO_PLATAFORMA.md:
- Parte 3: crear el proyecto en Supabase. Genera un único archivo sql/_instalacion_completa.sql que una los archivos
  sql/01 en adelante en orden numérico (sin el 04, que es de demostración) para que yo lo pegue en el SQL Editor; si te
  parece más seguro, divídelo en tandas y dime en qué orden pegarlas. Ayúdame a crear el primer administrador y a publicar la
  función create-user.
- Parte 4: publicar en Vercel con las variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY, y configurar las URLs en Supabase.
- Parte 5: revisar conmigo, una por una, las cosas que son de la empresa anterior (nombre de la plataforma, datos de
  demostración, textos de Instalación de TV, almacén de ejemplo, códigos de Jamar). Pregúntame qué quiero dejar y qué cambiar.
- Partes 6 y 7: cargar los maestros con las plantillas de Excel y correr la lista de verificación final.

Reglas durante todo el proceso:
- Nunca me pidas contraseñas, la service_role key ni claves privadas. Solo necesito darte (si hace falta) el Project URL y la
  anon key de Supabase, y esas van únicamente en las variables de entorno de Vercel y en un archivo .env local que no se sube a Git.
- No ejecutes SQL ni cambies nada en mis cuentas: tú me das el texto exacto y yo lo pego donde corresponda.
- Si algo falla, pídeme que te copie el mensaje de error tal cual y lo resolvemos.
- No hagas push ni merge a la rama main sin que yo te lo autorice explícitamente.
```

---

## Prompt 2 — Sesiones siguientes (pedir cambios)

```text
Trabajamos sobre esta plataforma operativa. Lee CLAUDE.md para recordar las reglas del proyecto y cómo trabajamos.
Quiero este cambio: [DESCRIBE AQUÍ LO QUE NECESITAS, con un ejemplo o una captura si puedes].
Si algo no está claro, hazme pocas preguntas antes de desarrollar. Trabaja en una rama nueva, corre `npm run build`,
y avísame cómo probarlo en la vista previa de Vercel. Si el cambio necesita tocar la base de datos, dame el archivo SQL y el
bloque "CAMBIO DE BASE DE DATOS REQUERIDO" y espera a que yo lo corra. No publiques en main hasta que yo te diga
"pásalo a productivo".
```

---

## Prompt 3 — Cuando algo falla en producción

```text
Algo falla en la plataforma publicada. Esto es lo que veo: [pega el mensaje de error tal cual o describe qué pasa y en qué
pantalla]. Lee CLAUDE.md, investiga la causa en el código y propón la corrección en una rama nueva. No toques main hasta que
yo lo autorice. Si el problema puede venir de la base de datos o de los permisos, dime qué consulta de solo lectura debo correr
en el SQL Editor de Supabase para confirmarlo.
```
