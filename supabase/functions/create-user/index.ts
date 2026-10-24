// Edge Function: create-user
// Permite que un administrador gestione usuarios (auth + perfil) desde la app, sin exponer la
// service role key en el navegador. Acciones (campo "action"; por defecto "create"):
//   create : crea un usuario nuevo (email, password, name, username, role).
//   get    : devuelve el correo de un usuario (userId). La contraseña NO se puede consultar: se guarda cifrada.
//   update : cambia el correo y/o la contraseña de un usuario (userId, email?, password?).
//
// Despliegue:
//   supabase functions deploy create-user
//
// En todas las acciones valida que quien llama sea un admin autenticado y activo.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// El navegador llama a la función desde otro dominio: sin estos encabezados (y sin responder a OPTIONS) la petición se bloquea.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace("Bearer ", "");

    // Cliente con la sesión de quien llama, para verificar su rol
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerUser, error: callerErr } = await callerClient.auth.getUser(callerToken);
    if (callerErr || !callerUser?.user) return json({ error: "No autenticado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: callerProfile } = await admin.from("profiles").select("role, active").eq("id", callerUser.user.id).single();
    if (!callerProfile || callerProfile.role !== "admin" || callerProfile.active === false) {
      return json({ error: "Solo un administrador puede gestionar usuarios" }, 403);
    }

    const body = await req.json();
    const action = body.action || "create";

    if (action === "get") {
      if (!body.userId) return json({ error: "Falta el usuario" }, 400);
      const { data, error } = await admin.auth.admin.getUserById(body.userId);
      if (error || !data?.user) return json({ error: error?.message || "Usuario no encontrado" }, 404);
      return json({ email: data.user.email || "" });
    }

    if (action === "update") {
      const { userId, email, password } = body;
      if (!userId) return json({ error: "Falta el usuario" }, 400);
      const cambios: Record<string, unknown> = {};
      if (email !== undefined && email !== null && String(email).trim() !== "") {
        if (!EMAIL_RE.test(String(email).trim())) return json({ error: "El correo no es válido" }, 400);
        cambios.email = String(email).trim();
        cambios.email_confirm = true;
      }
      if (password !== undefined && password !== null && String(password) !== "") {
        if (String(password).length < 6) return json({ error: "La contraseña debe tener al menos 6 caracteres" }, 400);
        cambios.password = String(password);
      }
      if (!Object.keys(cambios).length) return json({ error: "No hay nada que cambiar" }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, cambios);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // create
    const { email, password, name, username, role } = body;
    if (!email || !password || !name || !username || !role) return json({ error: "Faltan campos requeridos" }, 400);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, username, role },
    });
    if (createErr) return json({ error: createErr.message }, 400);

    return json({ user: created.user });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
