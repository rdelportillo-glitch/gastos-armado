// Edge Function: create-user
// Permite que un administrador cree nuevos usuarios (auth + perfil) desde la
// app, sin exponer la service role key en el navegador.
//
// Despliegue:
//   supabase functions deploy create-user
//
// La función valida que quien llama sea un admin autenticado antes de crear
// al nuevo usuario.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405 });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace("Bearer ", "");

    // Cliente con la sesión de quien llama, para verificar su rol
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerUser, error: callerErr } = await callerClient.auth.getUser(callerToken);
    if (callerErr || !callerUser?.user) {
      return new Response(JSON.stringify({ error: "No autenticado" }), { status: 401 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", callerUser.user.id).single();
    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Solo un administrador puede crear usuarios" }), { status: 403 });
    }

    const { email, password, name, username, role } = await req.json();
    if (!email || !password || !name || !username || !role) {
      return new Response(JSON.stringify({ error: "Faltan campos requeridos" }), { status: 400 });
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, username, role },
    });
    if (createErr) {
      return new Response(JSON.stringify({ error: createErr.message }), { status: 400 });
    }

    return new Response(JSON.stringify({ user: created.user }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
