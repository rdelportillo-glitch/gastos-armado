# Copia de la plataforma en otro usuario (otro Claude Code, otro Vercel y otro Supabase)

> **Caso más común: una COPIA.** La plataforma original sigue funcionando y evolucionando donde está, con sus usuarios y sus
> datos. La copia es una instalación aparte (su propio GitHub, Vercel y Supabase), sin ninguna conexión con la original:
> lo que pase en una no afecta a la otra. Si en cambio quieres **ceder** la plataforma original, usa la opción A de la Parte 1
> (transferir el repositorio).

Esta guía sirve para instalar la plataforma completa en cuentas nuevas. Está escrita para alguien que no programa: casi todo
es hacer clic y copiar/pegar, y **Claude Code hace el resto** (lee el proyecto, te guía y te pide solo lo que necesita).

Qué se traslada y qué no:

| Se traslada | NO se traslada (hay que crearlo o cargarlo de nuevo) |
|---|---|
| Todo el código (pantallas, motor de asignación, PDFs, Excel…) | Los datos (gastos, servicios, personal, histórico…) |
| Los scripts SQL que crean las tablas, la seguridad y los buckets | Los usuarios y contraseñas (se crean otra vez) |
| Las instrucciones para Claude Code (`CLAUDE.md`) | Las claves de Supabase y las cuentas de Vercel/GitHub |
| Las plantillas de Excel para cargar maestros | Los archivos de Storage (fotos, soportes, manuales) |

> Recomendación: **empezar limpio** en el proyecto nuevo y cargar los maestros con las plantillas (Parte 6). Copiar los datos
> reales de la base vieja es posible pero delicado; si lo necesitas, ver la Parte 8.

---

## Parte 1 — Entregar el código a la copia (lo hace quien entrega)

Para una **copia**, elige la opción B o la C (la A **quita** el repositorio original de tu cuenta):

- **B. Invitar como colaborador (recomendada para copiar):** en el repositorio original, Settings → **Collaborators → Add
  people** con el usuario de GitHub del otro. Él hace un **fork** (botón *Fork*): queda una copia propia en su cuenta que sigue
  enlazada al original y le permite recibir mejoras después (Parte 10). Si prefiere no estar enlazado, descarga el ZIP y lo sube
  a un repositorio nuevo.
- **C. Entregar un ZIP:** en el repositorio → botón verde **Code → Download ZIP**. El otro usuario crea un repositorio
  vacío en su GitHub y sube el contenido. Es una copia totalmente independiente y sin historial de Git.
- **A. Transferir el repositorio (solo si vas a ceder la plataforma):** Settings → General → Danger Zone → **Transfer
  ownership**. El repositorio deja de ser tuyo. **No lo uses para hacer una copia.**

**Antes de entregar, confirma que nunca se subieron secretos:** el archivo `.env` está en `.gitignore` (no se sube). La
`service_role key` de Supabase **nunca** debe estar en el código ni en el chat. No entregues contraseñas: cada dueño crea las suyas.

---

## Parte 2 — Preparar el computador del nuevo dueño

1. Instalar **Node.js** (versión LTS) desde https://nodejs.org
2. Instalar **Git** desde https://git-scm.com
3. Instalar **Claude Code** (la app de escritorio o el CLI) e iniciar sesión con su cuenta.
4. Descargar el proyecto:
   - Si recibió el repositorio por GitHub: abrir una terminal en la carpeta donde quiera guardarlo y ejecutar
     `git clone https://github.com/USUARIO/REPOSITORIO.git` (cambiando la dirección por la real).
   - Si recibió un ZIP: descomprimirlo en una carpeta.
5. Abrir esa carpeta en Claude Code.
6. Pegar el prompt de `docs/PROMPT_NUEVO_CLAUDE_CODE.md` (el primero). Claude leerá `CLAUDE.md` y esta guía y lo acompañará
   en las partes siguientes.

---

## Parte 3 — Crear la base de datos nueva en Supabase

1. Entrar a https://supabase.com y crear una cuenta. **New project** → nombre (ej. `plataforma-operativa`) → contraseña de
   base de datos (guárdala; no se vuelve a ver) → región cercana (ej. `South America (São Paulo)`) → **Create new project**.
2. **Crear las tablas.** Menú **SQL Editor → New query**. Para cada archivo de la carpeta `sql/`, **en este orden numérico**:
   abrir el archivo, copiar todo, pegar en una consulta nueva y pulsar **Run**. Debe decir *Success*.

   | Archivos | Para qué sirven |
   |---|---|
   | `01_schema.sql`, `02_rls.sql` | Tablas base y seguridad por rol |
   | `03_seed_master_data.sql` | Categorías de gasto y **datos de demostración** (técnicos y herramientas de ejemplo) |
   | `04_seed_expenses_optional.sql` | **Opcional, no se recomienda:** gastos de ejemplo (omítelo en producción) |
   | `05` a `13` | Mejoras de gastos, personal, carga, causales, activos e inventario |
   | `14` a `18` | Asignación: maestros de zonas/productos, criterios, códigos de municipio, histórico |
   | `19` a `22` | Instalación de TV (incluye el bucket privado de soportes) |
   | `23`, `24` | Permiso del operador sobre servicios; manuales y línea/sublínea de productos |
   | `25`, `29` | Programación de servicios y número de servicio |
   | `26` | Rol cliente (acceso externo limitado) |
   | `27`, `28` | Armados en almacén, rol técnico y días sugeridos |

   - Consejo: pídele a Claude Code que **junte los archivos en uno solo** (sin el `04`) para pegar menos veces; si da un error a la
     mitad, repartir en tandas de 5 o 6 archivos para ver cuál falla.
   - Si Supabase muestra un aviso de "operación destructiva" por algún `drop policy if exists`, es normal: esos scripts solo
     reemplazan políticas propias y se pueden correr más de una vez.
3. **Crear el primer administrador.** **Authentication → Users → Add user → Create new user** (correo y contraseña, marca
   *Auto Confirm User*). Luego, en **SQL Editor**, ejecutar (con el correo real):

   ```sql
   update public.profiles set role = 'admin', name = 'Nombre del administrador', username = 'admin'
   where id = (select id from auth.users where email = 'admin@tuempresa.com');
   ```

4. **Publicar la función que crea usuarios.** **Edge Functions → Deploy a new function** (por el editor del navegador),
   nombre exacto `create-user`, pegar el contenido de `supabase/functions/create-user/index.ts` y **Deploy**. No hay que
   configurar claves: Supabase se las da sola.
5. **Copiar las claves de conexión.** **Project Settings → API**: guardar **Project URL** y **anon public key**.
   (La `service_role key` no se copia ni se comparte con nadie.)

Los buckets de Storage (fotos, soportes, manuales) los crean los mismos scripts SQL (`19`–`27`); no hay que crearlos a mano.

---

## Parte 4 — Publicar con Vercel

1. Entrar a https://vercel.com y crear cuenta con GitHub.
2. **Add New → Project** → elegir el repositorio → **Import**. Vercel detecta Vite solo; no cambies nada del build.
3. Antes de **Deploy**, abrir **Environment Variables** y agregar:
   - `VITE_SUPABASE_URL` = el *Project URL* de la Parte 3
   - `VITE_SUPABASE_ANON_KEY` = la *anon public key* de la Parte 3
4. **Deploy** y esperar 1–2 minutos. Vercel muestra la dirección (ej. `https://mi-proyecto.vercel.app`).
5. **Dominio propio (opcional):** proyecto → **Settings → Domains → Add** (por ejemplo `operaciones.tuempresa.com`) y crear el
   registro DNS que Vercel indique.
6. **Volver a Supabase:** **Authentication → URL Configuration** → *Site URL* = la dirección de la plataforma; en *Redirect URLs*
   agregar `https://TU-DIRECCION/**`. (Es para los correos de recuperación de contraseña.)
7. Abrir la dirección, iniciar sesión con el administrador de la Parte 3 y confirmar que entra.

A partir de aquí: cada cambio que se publique en la rama `main` de GitHub se despliega solo, y cada rama nueva genera una
**vista previa** para probar antes de publicar.

---

## Parte 5 — Revisar lo que es de la empresa anterior (Biver / Jamar)

La plataforma se construyó para una operación concreta. Pídele a Claude Code que revise y adapte esto con el nuevo dueño:

- [ ] **Nombre de la plataforma:** hoy dice "Gastos Armado" (menú lateral) y "Gastos Operativos — Armado" (inicio de sesión y
      pestaña del navegador).
- [ ] **Datos de demostración** de `sql/03`: técnicos y herramientas de ejemplo. Inactívalos desde la app (Personal / Activos).
- [ ] **Instalación de TV → Maestros → Instalación de TV:** guion de la llamada, cuenta para transferencias, tarifas y
      adicionales traen textos y valores de la propuesta original. Ajustarlos o no usar el módulo.
- [ ] **Códigos de la base de Jamar** (`src/lib/asignacion/masters.js`: `DEPTO_CODES`, `PUEBLO_CODES`) y `sql/17`: solo aplican si
      el nuevo dueño también recibe las bases de Jamar; si el proveedor es otro, hay que adaptar el formato de la carga.
- [ ] **Almacén de ejemplo** que crea `sql/27` (ALMACEN RIOACHA / JAMAR): borrarlo o inactivarlo.
- [ ] **Coordinadores** (Maestros → Coordinadores) y **destinatarios de Cambio de técnico** (Maestros → Cambio de técnico).
- [ ] **Criterios de asignación** (paso "Criterios" en Asignación): revisar capacidades, ciudades con pico y placa, etc.
- [ ] **Tipos de solicitud de Programación** (Ruta Crítica, Particular, IGS, Instalación de Tv): están en el código
      (`src/lib/programacion/progData.js`).
- [ ] **Plan de Supabase:** el plan gratuito se pausa por inactividad y tiene límites de base de datos y archivos; para
      producción real conviene el plan Pro (con copias de seguridad).

---

## Parte 6 — Cargar los datos iniciales (en este orden)

Todo desde la app con el usuario administrador. Los botones **Plantilla de muestra** descargan un Excel con los encabezados
exactos, ejemplos y una hoja de instrucciones.

1. **Maestros → Barrios y zonas equivalentes → Importar desde Excel** (plantillas de zonas/barrios y de distancias).
2. **Maestros → Productos de armado → Importar desde Excel** (plantilla de productos y complejidad); luego el botón
   **Completar línea y sublínea**.
3. **Maestros → Almacenes → Importar desde Excel** (plantilla de almacenes; departamento y ciudad deben coincidir con el maestro de zonas).
4. **Personal:** crear o importar los técnicos (nombre, departamento, ciudad, capacidad, transporte, pico y placa, vivienda).
5. **Maestros → Coordinadores** y **Maestros → Causales**.
6. **Usuarios:** crear los usuarios con su rol (administrador, operador, consulta; cliente con su empresa; técnico vinculado a
   su ficha de Personal).
7. **Maestros → Instalación de TV** y **Maestros → Cambio de técnico**, si se usan.

---

## Parte 7 — Lista de verificación final

- [ ] Inicia sesión el administrador y se ve el menú completo.
- [ ] **Usuarios → Nuevo usuario** crea un usuario (si falla, la función `create-user` no quedó publicada).
- [ ] Los maestros cargaron: Maestros muestra zonas, barrios y productos.
- [ ] En **Asignación → paso 1** se carga una base de prueba y se asigna un día; se descargan los PDF.
- [ ] **Programación de servicios**: se crea una orden y aparece en Asignación (paso 1) en su fecha.
- [ ] **Armados en almacén**: se carga un PQR con la plantilla, un técnico registra un armado con foto y el administrador cierra.
- [ ] Un usuario **cliente** solo ve sus módulos y un usuario **técnico** solo ve Armados en almacén.
- [ ] Una rama de prueba genera su vista previa en Vercel.

---

## Parte 8 — (Opcional) Copiar los datos de la plataforma anterior

Solo si el nuevo dueño necesita el historial. Es delicado: hazlo con Claude Code y con calma.

- **Por tablas:** en el Supabase anterior, **Table Editor → tabla → Export → CSV**; en el nuevo, **Import data from CSV**.
  Importar en orden de dependencias (técnicos y categorías primero; servicios, gastos y movimientos después).
- **Completa:** con `pg_dump` (requiere instalar herramientas de PostgreSQL) se puede copiar toda la base.
- **Usuarios:** las contraseñas **no se pueden copiar**; hay que crear los usuarios de nuevo (y volver a vincular el
  rol técnico/cliente en la pantalla Usuarios).
- **Archivos de Storage:** se descargan y se vuelven a subir a mano; es mejor no migrarlos.

---

## Parte 9 — Cómo trabajar de aquí en adelante

1. El dueño le pide cambios a Claude Code en español, como cualquier conversación.
2. Claude trabaja en una **rama**, corre las pruebas y avisa **"CAMBIO LISTO PARA PRUEBAS"** con la dirección de la vista previa.
3. Si el cambio toca la base de datos, Claude entrega un archivo `sql/NN_….sql` y un bloque **CAMBIO DE BASE DE DATOS
   REQUERIDO**: el dueño lo pega en el SQL Editor de Supabase y responde "ya corrí el sql NN".
4. El dueño prueba en la vista previa. Si todo está bien dice **"pásalo a productivo"** y Claude lo publica en `main`.
5. Después de cada publicación, recargar la página con **Ctrl+F5** antes de seguir trabajando.

## Si algo falla

- *"No se pudieron cargar los datos desde Supabase"* → revisar las dos variables en Vercel (sin espacios) y volver a desplegar.
- *No entra / no hay permisos* → confirmar que el usuario existe en Authentication y que su rol quedó asignado.
- *Error al crear usuarios desde la app* → la Edge Function `create-user` no está publicada.
- *"row-level security"* → falta correr algún archivo SQL, o se corrieron fuera de orden: revisar la lista de la Parte 3.
- *Un PDF no se genera tras una publicación* → recargar con Ctrl+F5.
- Cualquier otro error: copiarlo tal cual a Claude Code.

---

## Parte 10 — Mantener la copia al día con la plataforma original (opcional)

La copia **no se actualiza sola**: cada mejora de la original hay que traerla a propósito.

- **Si la copia es un *fork* en GitHub:** en el repositorio de la copia, botón **Sync fork → Update branch** trae el código nuevo
  de la original. Vercel lo publica solo. Pídele a Claude Code que revise antes qué cambia y que pruebe con una rama.
- **Si la copia salió de un ZIP:** no hay enlace; hay que pedir otro ZIP y que Claude Code compare y aplique las diferencias.
- **En los dos casos, la base de datos es independiente:** cuando la original agrega un archivo `sql/NN_…sql` nuevo, hay que pegarlo
  también en el SQL Editor del Supabase de la copia **antes** de publicar el código que lo usa.
- Los datos, usuarios y configuración de cada plataforma son de cada una: nunca se mezclan.
