# Guía paso a paso — Pasar la plataforma a producción

Esta guía está pensada para alguien que **no sabe programar**. Todo se hace
haciendo clic y copiando/pegando texto. No necesitas instalar nada en tu
computador.

Vas a usar tres servicios gratuitos:
- **Supabase**: la base de datos y el sistema de usuarios.
- **GitHub**: donde queda guardado el código de la app.
- **Vercel**: donde la app queda publicada como una página web real.

---

## PARTE 1 — Crear la base de datos en Supabase

### Paso 1.1 — Crear la cuenta y el proyecto
1. Entra a **https://supabase.com** y haz clic en **Start your project**.
2. Regístrate (puedes usar tu cuenta de Google o GitHub).
3. Haz clic en **New project**.
4. Ponle un nombre, ej. `gastos-armado`.
5. Crea una **contraseña de base de datos** — guárdala en un lugar seguro, no la vuelves a ver.
6. Elige la región más cercana (ej. `South America (São Paulo)`).
7. Haz clic en **Create new project** y espera 1-2 minutos mientras se crea.

### Paso 1.2 — Crear las tablas (copiar y pegar)
1. En el menú de la izquierda, haz clic en **SQL Editor**.
2. Haz clic en **New query**.
3. Abre el archivo `sql/01_schema.sql` de este paquete con el Bloc de notas (o cualquier editor de texto).
4. Selecciona todo el contenido (Ctrl+A) y cópialo (Ctrl+C).
5. Pégalo en el recuadro del SQL Editor de Supabase (Ctrl+V).
6. Haz clic en el botón verde **Run** (o presiona Ctrl+Enter).
7. Debe decir "Success. No rows returned" — eso significa que funcionó.

Repite exactamente los mismos pasos 2 veces más, en este orden:
- Con el archivo `sql/02_rls.sql`
- Con el archivo `sql/03_seed_master_data.sql`

(Siempre: **New query** → pegar el contenido del archivo → **Run**.)

### Paso 1.3 — Crear tu primer usuario administrador
1. En el menú de la izquierda, haz clic en **Authentication**.
2. Haz clic en **Add user** → **Create new user**.
3. Escribe un correo, por ejemplo `admin@tuempresa.com`, y una contraseña.
4. Marca la casilla **Auto Confirm User** si aparece.
5. Haz clic en **Create user**.

Ese usuario ya puede iniciar sesión, pero todavía tiene el rol genérico
"consulta". Vamos a convertirlo en administrador:

6. Ve otra vez a **SQL Editor** → **New query**.
7. Pega exactamente esto (cambia el correo y el nombre si quieres):

```sql
update public.profiles set role = 'admin', name = 'Administrador General', username = 'admin' where id =
  (select id from auth.users where email = 'admin@tuempresa.com');
```

8. Haz clic en **Run**.

Repite el Paso 1.3 completo si quieres crear también un usuario **operador**
y uno de **consulta** (cambiando el correo y usando `role = 'operador'` o
`role = 'consulta'` en el segundo comando).

### Paso 1.4 — (Opcional) Cargar datos de ejemplo con movimientos
1. Abre el archivo `sql/04_seed_expenses_optional.sql` en el Bloc de notas.
2. Busca el texto `admin@tuempresa.com` (aparece una vez) y reemplázalo por el correo del administrador que creaste en el Paso 1.3.
3. Copia todo el contenido, pégalo en una **New query** del SQL Editor, y haz clic en **Run**.

Esto carga gastos, servicios realizados y movimientos de inventario de
vinipel de ejemplo, para que puedas probar la app con datos ya cargados.

### Paso 1.5 — Publicar la función que crea usuarios nuevos
1. En el menú de la izquierda, haz clic en **Edge Functions**.
2. Haz clic en **Create a new function** (o **Deploy a new function**).
3. Ponle el nombre exacto: `create-user`
4. Se abrirá un editor de código con un ejemplo. Borra todo lo que trae.
5. Abre el archivo `supabase/functions/create-user/index.ts` de este paquete, copia todo su contenido y pégalo en ese editor.
6. Haz clic en **Deploy** (o **Save and deploy**).

### Paso 1.6 — Copiar tus claves de conexión
1. Ve a **Project Settings** (ícono de engranaje, abajo a la izquierda) → **API**.
2. Copia y guarda en un archivo de texto estos dos valores:
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **anon public** key (una clave larga de letras y números)

Los vas a necesitar en la Parte 3.

---

## PARTE 2 — Subir el código a GitHub

### Paso 2.1 — Crear la cuenta
1. Entra a **https://github.com** y crea una cuenta gratuita (si no tienes una).

### Paso 2.2 — Crear un repositorio nuevo
1. Haz clic en el botón **+** (arriba a la derecha) → **New repository**.
2. Ponle un nombre, ej. `gastos-armado`.
3. Déjalo en **Private** (privado) si prefieres que nadie más lo vea.
4. Haz clic en **Create repository**. NO marques ninguna casilla de "Add a README" — déjalo vacío.

### Paso 2.3 — Subir los archivos
1. En la página del repositorio recién creado, busca el enlace que dice **uploading an existing file** y haz clic ahí.
2. En tu computador, descomprime (extrae) el archivo zip de este paquete en una carpeta.
3. Abre esa carpeta. Selecciona **todos** los archivos y carpetas que están adentro (Ctrl+A) — **no** el zip, sino el contenido ya descomprimido.
4. Arrastra todos esos archivos y carpetas hacia la página de GitHub, donde dice "Drag files here".
5. Espera a que termine de cargar (puede tardar un par de minutos).
6. Baja hasta el final de la página y haz clic en **Commit changes**.

---

## PARTE 3 — Publicar la app con Vercel

### Paso 3.1 — Crear la cuenta
1. Entra a **https://vercel.com** y haz clic en **Sign Up**.
2. Elige **Continue with GitHub** para conectar tu cuenta de GitHub directamente.

### Paso 3.2 — Importar el proyecto
1. En el panel de Vercel, haz clic en **Add New...** → **Project**.
2. Busca el repositorio `gastos-armado` que subiste en la Parte 2 y haz clic en **Import**.
3. Vercel detecta automáticamente que es un proyecto Vite — no cambies nada en "Build settings".

### Paso 3.3 — Agregar las claves de Supabase
1. Antes de darle a "Deploy", despliega la sección **Environment Variables**.
2. Agrega dos variables (una por una, con el botón "Add"):
   - Nombre: `VITE_SUPABASE_URL` — Valor: el "Project URL" que copiaste en el Paso 1.6
   - Nombre: `VITE_SUPABASE_ANON_KEY` — Valor: la "anon public key" que copiaste en el Paso 1.6
3. Haz clic en **Deploy**.
4. Espera 1-2 minutos. Cuando termine, Vercel te muestra una captura de tu app y un botón para visitarla.

### Paso 3.4 — Probar la app
1. Haz clic en el enlace que te dio Vercel (algo como `https://gastos-armado.vercel.app`).
2. Inicia sesión con el correo y contraseña del administrador que creaste en el Paso 1.3.
3. ¡Ya está en producción! Esa URL es la que compartes con tu equipo.

---

## Cómo hacer cambios más adelante

Cada vez que quieras un ajuste en la app (un nuevo campo, un reporte
distinto, etc.), pídemelo en el chat como hiciste hasta ahora. Yo te
entregaré el archivo `App.jsx` actualizado. Para publicarlo:

1. Ve a tu repositorio en GitHub.
2. Abre el archivo `src/App.jsx`, haz clic en el ícono de lápiz (editar).
3. Selecciona todo el contenido (Ctrl+A), bórralo, y pega el nuevo contenido que te entregué.
4. Baja y haz clic en **Commit changes**.
5. Vercel publica la actualización automáticamente en 1-2 minutos, sin que tengas que hacer nada más ahí.

Si el cambio también incluye archivos SQL nuevos (por ejemplo, una tabla
nueva), te lo indicaré explícitamente y te diré exactamente qué pegar en el
SQL Editor de Supabase, igual que en el Paso 1.2.

---

## Si algo no funciona

- **"No se pudieron cargar los datos desde Supabase"**: revisa que copiaste bien el Project URL y la anon key en Vercel (Paso 3.3), sin espacios de más.
- **No puedes iniciar sesión**: confirma que creaste el usuario en Authentication (Paso 1.3) y que le asignaste el rol con el comando SQL.
- **Error al crear un usuario nuevo desde el módulo Usuarios de la app**: revisa que la función `create-user` haya quedado publicada (Paso 1.5) — en Supabase, ve a Edge Functions y confirma que aparece como activa ("Deployed").
- Cualquier otro mensaje de error: cópialo tal cual y pégamelo en el chat, lo resolvemos juntos.
