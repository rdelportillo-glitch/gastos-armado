# Gastos Operativos — Técnicos de Armado (versión de producción)

Aplicación de administración de gastos operativos, conectada a un proyecto
real de **Supabase (PostgreSQL + Auth)**, con seguridad por rol aplicada en
la propia base de datos (Row Level Security).

Toda la lógica y las pantallas (dashboard, registro de gastos, historial,
técnicos, categorías, activos, reportes, importación masiva) son las mismas
que ya probaste en el prototipo. Lo que cambia es el almacenamiento: ya no
vive en el artifact, sino en tu propia base de datos.

## 1. Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea un proyecto nuevo (plan gratuito es suficiente para empezar).
2. Guarda la contraseña de la base de datos que te pida.
3. Ve a **Project Settings → API** y copia:
   - `Project URL`
   - `anon public key`
   - `service_role key` (solo se usará en el paso 4, nunca en el frontend)

## 2. Crear el esquema de base de datos

En el **SQL Editor** de Supabase, ejecuta en este orden exacto:

1. `sql/01_schema.sql` — tablas, relaciones e índices (incluye técnicos, categorías, subcategorías, productos, gastos, activos, servicios realizados e inventario).
2. `sql/02_rls.sql` — políticas de seguridad por rol.
3. `sql/03_seed_master_data.sql` — categorías, subcategorías (incluye Vinipel con control de inventario activado), productos, 20 técnicos con departamento, tipos de herramienta y activos de ejemplo.

## 3. Crear los usuarios

Ve a **Authentication → Users → Add user** y crea al menos:

- Un usuario **administrador** (ej. `admin@tuempresa.com`)
- Opcionalmente un usuario **operador** y uno de **consulta**

Al crearse en `auth.users`, un trigger crea automáticamente su fila en
`public.profiles` con rol `consulta` por defecto. Para asignar el rol
correcto, ejecuta en el SQL Editor:

```sql
update public.profiles set role = 'admin', name = 'Nombre del admin', username = 'admin' where id =
  (select id from auth.users where email = 'admin@tuempresa.com');
```

(Opcional) Ejecuta `sql/04_seed_expenses_optional.sql`, reemplazando el
correo del administrador, para cargar gastos, servicios realizados e
inventario de vinipel de ejemplo.

## 4. Desplegar la Edge Function para crear usuarios (sin línea de comandos)

La creación de usuarios desde el módulo **Usuarios** de la app requiere
permisos especiales que nunca deben estar en el navegador. Supabase permite
crear esta función directamente desde el Dashboard, sin instalar nada:

1. Ve a **Edge Functions** en el menú lateral de Supabase → **Create a new function**.
2. Nómbrala `create-user`.
3. Borra el código de ejemplo que trae por defecto y pega el contenido completo del archivo `supabase/functions/create-user/index.ts` de este paquete.
4. Haz clic en **Deploy**.

Supabase ya le da a cada función acceso automático a las claves del proyecto
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), así que no hace falta
configurar nada adicional.

## 5. Configurar y correr la aplicación

```bash
cp .env.example .env
# Edita .env con tu Project URL y anon key

npm install
npm run dev       # entorno local, http://localhost:5173
npm run build     # genera /dist para producción
```

Para publicarla, sube la carpeta generada (`npm run build`) a Vercel,
Netlify, Cloudflare Pages o el hosting que prefieras — configurando ahí las
mismas dos variables de entorno (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

## Estructura del proyecto

```
sql/                           esquema, seguridad y datos de ejemplo
supabase/functions/create-user Edge Function para crear usuarios
src/lib/supabaseClient.js      cliente de Supabase
src/lib/mapping.js             conversión entre filas de la BD y la app
src/lib/api.js                 carga de datos, sincronización, autenticación
src/App.jsx                    toda la aplicación (dashboard, formularios, reportes...)
```

## Cómo guarda los datos

Cada acción en la app (registrar un gasto, editar un técnico, anular un
movimiento, asignar una herramienta...) sigue actualizando un objeto local
igual que en el prototipo. La función `persist()` ahora compara ese objeto
con el último estado sincronizado y envía a Supabase **solo lo que cambió**,
fila por fila y tabla por tabla — sin necesidad de tocar el resto del código
de las pantallas.

## Roles y permisos

Los permisos de cada rol (**admin**, **operador**, **consulta**) no dependen
solo de la interfaz: están reforzados con políticas RLS en la base de datos
(`sql/02_rls.sql`), así que aunque alguien intente saltarse la app y hablar
directo con la API de Supabase, las mismas reglas de negocio se siguen
cumpliendo.

## Próximos pasos sugeridos

- Editar plantillas de correo de Supabase Auth (invitación, recuperación de contraseña) con tu marca.
- Configurar backups automáticos (Supabase Pro) si el negocio lo requiere.
- Conectar Power BI o Google Sheets a las tablas de Postgres vía el conector de Supabase, tal como se dejó previsto en el requerimiento original.
