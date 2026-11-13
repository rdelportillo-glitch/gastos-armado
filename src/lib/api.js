import { supabase } from "./supabaseClient";
import {
  rowToTechnician, technicianToRow, rowToCategory, categoryToRow,
  rowToSubcategory, subcategoryToRow, rowToProduct, productToRow,
  rowToExpense, expenseToRow, rowToAsset, assetToRow, rowToAssignment,
  rowToProfile, profileToRow, rowToAudit, auditToRow,
  rowToService, serviceToRow, rowToStockMovement, stockMovementToRow,
  rowToAssetType, assetTypeToRow, rowToCausal, causalToRow, rowToSupplier, supplierToRow,
} from "./mapping";

/* ---------------------------- AUTENTICACIÓN ---------------------------- */

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getCurrentSessionProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
  if (error || !data) return null;
  return rowToProfile(data);
}

export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

// Cuando la función responde con error, supabase-js solo dice "Edge Function returned a non-2xx status code"; el motivo real viene en el cuerpo de la
// respuesta (error.context). Lo leemos para mostrarlo y damos en español los más comunes.
async function errorDeFuncion(error) {
  let msg = "";
  try { const b = error.context && typeof error.context.json === "function" ? await error.context.json() : null; msg = (b && b.error) || ""; } catch (e) { /* sin cuerpo */ }
  if (!msg) return error;
  if (/already been registered|already registered|email_exists/i.test(msg)) return new Error("Ya existe un usuario con ese correo electrónico.");
  if (/profiles_username_key|duplicate key|Database error creating new user/i.test(msg)) return new Error("No se pudo crear el usuario: ese nombre de usuario o correo ya está en uso. Prueba con otro usuario (sin importar mayúsculas) o revisa si la persona ya tiene cuenta, incluso inactiva.");
  if (/password/i.test(msg) && /6|weak|short/i.test(msg)) return new Error("La contraseña es muy corta o débil: usa al menos 6 caracteres.");
  return new Error(msg);
}

// Crea un usuario real (auth + perfil) llamando a la Edge Function, que
// valida en el servidor que quien llama es administrador.
export async function adminCreateUser({ email, password, name, username, role }) {
  const { data, error } = await supabase.functions.invoke("create-user", {
    body: { email, password, name, username, role },
  });
  if (error) throw await errorDeFuncion(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

// Correo de un usuario (solo administrador). La contraseña no se puede consultar: se guarda cifrada.
export async function adminGetUserEmail(userId) {
  const { data, error } = await supabase.functions.invoke("create-user", { body: { action: "get", userId } });
  if (error) throw await errorDeFuncion(error);
  if (data?.error) throw new Error(data.error);
  return data.email || "";
}

// Cambia el correo y/o la contraseña de un usuario (solo administrador). Lo que no se envía no se toca.
export async function adminUpdateUserAuth({ userId, email, password }) {
  const { data, error } = await supabase.functions.invoke("create-user", { body: { action: "update", userId, email, password } });
  if (error) throw await errorDeFuncion(error);
  if (data?.error) throw new Error(data.error);
  return data;
}

/* ------------------------------ CARGA TOTAL ----------------------------- */

// Supabase devuelve como máximo 1000 filas por consulta. Las tablas que crecen todos los días
// (gastos, servicios, movimientos de stock) se leen por páginas para no perder registros.
async function selectAllPages(table, orderCol, ascending = false) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").order(orderCol, { ascending }).order("id").range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}

export async function loadAll() {
  const [tech, cat, sub, prod, exp, ast, asg, prof, aud, svc, stk, atypes, cau, sup] = await Promise.all([
    supabase.from("technicians").select("*").order("code"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("subcategories").select("*").order("name"),
    supabase.from("products").select("*").order("name"),
    selectAllPages("expenses", "date"),
    supabase.from("assets").select("*").order("code"),
    supabase.from("asset_assignments").select("*").order("from_date"),
    supabase.from("profiles").select("*").order("name"),
    supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500),
    selectAllPages("services", "date"),
    selectAllPages("stock_movements", "date"),
    supabase.from("asset_types").select("*").order("name"),
    supabase.from("causales").select("*").order("name"),
    supabase.from("suppliers").select("*").order("name"),
  ]);

  // "causales" no se incluye en esta validación a propósito: si la tabla aún
  // no existe en Supabase (no se ha corrido sql/11), la app debe seguir
  // cargando y simplemente mostrar el maestro vacío, en vez de quedar bloqueada.
  for (const r of [tech, cat, sub, prod, exp, ast, asg, prof, aud, svc, stk, atypes]) {
    if (r.error) throw r.error;
  }

  const assets = (ast.data || []).map(rowToAsset);
  const assignments = (asg.data || []).map(rowToAssignment);
  assets.forEach((a) => {
    a.history = assignments.filter((h) => h.assetId === a.id).sort((x, y) => (x.from || "").localeCompare(y.from || ""));
  });

  return {
    technicians: (tech.data || []).map(rowToTechnician),
    categories: (cat.data || []).map(rowToCategory),
    subcategories: (sub.data || []).map(rowToSubcategory),
    products: (prod.data || []).map(rowToProduct),
    expenses: (exp.data || []).map(rowToExpense),
    assets,
    users: (prof.data || []).map(rowToProfile),
    auditLog: (aud.data || []).map(rowToAudit),
    services: (svc.data || []).map(rowToService),
    stockMovements: (stk.data || []).map(rowToStockMovement),
    assetTypes: (atypes.data || []).map(rowToAssetType),
    causales: cau.error ? [] : (cau.data || []).map(rowToCausal),
    // Si aún no se corrió sql/42 la app sigue funcionando y la lista de proveedores queda vacía.
    suppliers: sup.error ? [] : (sup.data || []).map(rowToSupplier),
  };
}

// Lo que cambia entre varias personas durante el día (servicios, gastos, movimientos de stock y Personal): se vuelve a leer cada cierto tiempo para que todos vean lo más reciente.
export async function loadVolatile() {
  const [tech, exp, svc, stk] = await Promise.all([
    supabase.from("technicians").select("*").order("code"),
    selectAllPages("expenses", "date"),
    selectAllPages("services", "date"),
    selectAllPages("stock_movements", "date"),
  ]);
  for (const r of [tech, exp, svc, stk]) if (r.error) throw r.error;
  return {
    technicians: (tech.data || []).map(rowToTechnician),
    expenses: (exp.data || []).map(rowToExpense),
    services: (svc.data || []).map(rowToService),
    stockMovements: (stk.data || []).map(rowToStockMovement),
  };
}

/* --------------------------- SINCRONIZACIÓN ----------------------------- */
// El resto de la app sigue funcionando exactamente igual que el prototipo:
// arma un objeto "next" (copia de "db" con un array modificado) y llama a
// persist(next). Aquí comparamos next vs. el último estado conocido y solo
// enviamos a Supabase las filas que realmente cambiaron.

function diffRows(prevArr, nextArr) {
  const prevById = Object.fromEntries((prevArr || []).map((x) => [x.id, x]));
  return (nextArr || []).filter((item) => {
    const before = prevById[item.id];
    return !before || JSON.stringify(before) !== JSON.stringify(item);
  });
}

// Guardado por columnas: un registro que ya existía solo envía las columnas que ESTA persona cambió (comparando contra lo que ella tenía en pantalla), no la fila entera.
// Así una pantalla desactualizada no pisa lo que otra persona cambió en otras columnas del mismo registro. Los registros nuevos sí se envían completos.
// Los registros con exactamente el mismo cambio (por ejemplo finalizar un día) se guardan juntos en una sola petición.
const POR_LOTE = 100;
const SIMULTANEAS = 6;
async function enParalelo(tareas) {
  let i = 0;
  const trabajadores = Array.from({ length: Math.min(SIMULTANEAS, tareas.length) }, async () => {
    while (i < tareas.length) { const t = tareas[i++]; await t(); }
  });
  await Promise.all(trabajadores);
}
export function planDeGuardado(prevArr, nextArr, toRow) {
  const prevById = new Map((prevArr || []).map((x) => [x.id, x]));
  const nuevos = [];
  const grupos = new Map(); // JSON del cambio → { patch, ids }
  for (const item of nextArr || []) {
    const before = prevById.get(item.id);
    if (!before) { nuevos.push(toRow(item)); continue; }
    if (JSON.stringify(before) === JSON.stringify(item)) continue;
    const ahora = toRow(item), antes = toRow(before);
    const patch = {};
    for (const k of Object.keys(ahora)) if (k !== "id" && JSON.stringify(ahora[k]) !== JSON.stringify(antes[k])) patch[k] = ahora[k];
    if (Object.keys(patch).length === 0) continue;
    const clave = JSON.stringify(patch);
    const g = grupos.get(clave) || { patch, ids: [] };
    g.ids.push(item.id); grupos.set(clave, g);
  }
  return { nuevos, grupos: [...grupos.values()] };
}
async function upsertChanged(table, prevArr, nextArr, toRow) {
  const { nuevos, grupos } = planDeGuardado(prevArr, nextArr, toRow);
  if (nuevos.length === 0 && grupos.length === 0) return;
  if (nuevos.length) {
    const { error } = await supabase.from(table).upsert(nuevos, { onConflict: "id" });
    if (error) throw error;
  }
  const tareas = [];
  for (const g of grupos) {
    for (let i = 0; i < g.ids.length; i += POR_LOTE) {
      const ids = g.ids.slice(i, i + POR_LOTE);
      tareas.push(async () => {
        const { error } = await supabase.from(table).update(g.patch).in("id", ids);
        if (error) throw error;
      });
    }
  }
  await enParalelo(tareas);
}

// audit_log es solo de inserción, y solo un admin puede leerla. Un upsert()
// exige además permiso de lectura (SELECT) sobre la fila, así que a un
// operador le fallaba con "new row violates row-level security policy". Un
// insert() simple solo necesita la política de INSERT, que ya permite a
// cualquier usuario activo registrar sus propias entradas.
async function insertNewAuditRows(prevArr, nextArr, toRow) {
  const prevIds = new Set((prevArr || []).map((x) => x.id));
  const added = (nextArr || []).filter((x) => !prevIds.has(x.id));
  if (added.length === 0) return;
  const { error } = await supabase.from("audit_log").insert(added.map(toRow));
  if (error) throw error;
}

// profiles no tiene política de RLS para INSERT (los perfiles nuevos solo se
// crean vía la Edge Function create-user + el trigger de Supabase), así que
// un upsert() siempre falla con "new row violates row-level security policy"
// aunque la fila ya exista. Para editar rol/estado de un usuario existente
// se usa update() en vez de upsert().
async function updateChangedProfiles(prevArr, nextArr, toRow) {
  const changed = diffRows(prevArr, nextArr);
  for (const item of changed) {
    const { id, ...fields } = toRow(item);
    const { error } = await supabase.from("profiles").update(fields).eq("id", id);
    if (error) throw error;
  }
}

async function syncAssetAssignments(prevAssets, nextAssets, session) {
  const prevById = Object.fromEntries((prevAssets || []).map((a) => [a.id, a]));
  for (const asset of nextAssets || []) {
    const before = prevById[asset.id];
    const prevHist = before?.history || [];
    const nextHist = asset.history || [];

    // Cierra cualquier entrada que antes estaba abierta (sin fecha de
    // devolución) y ahora sí la tiene, sin importar si eso pasó porque se
    // reasignó la herramienta o porque simplemente se liberó/cambió su
    // estado. Antes solo se cerraba cuando se agregaba una entrada nueva,
    // lo que dejaba entradas "vigentes" duplicadas cuando la herramienta se
    // liberaba sin reasignarse de inmediato.
    for (let i = 0; i < Math.min(prevHist.length, nextHist.length); i++) {
      const prevEntry = prevHist[i], nextEntry = nextHist[i];
      if (!prevEntry.to && nextEntry.to) {
        await supabase.from("asset_assignments")
          .update({ to_date: nextEntry.to })
          .eq("asset_id", asset.id)
          .eq("technician_id", prevEntry.technicianId)
          .is("to_date", null);
      }
    }

    if (nextHist.length > prevHist.length) {
      const newEntries = nextHist.slice(prevHist.length);
      for (const h of newEntries) {
        const { error } = await supabase.from("asset_assignments").insert({
          asset_id: asset.id, technician_id: h.technicianId, from_date: h.from,
          to_date: h.to || null, assigned_by: session?.id || null,
        });
        if (error) throw error;
      }
    }
  }
}

export async function syncDiff(prevDb, nextDb, session) {
  // Los gastos se guardan primero y se esperan a que terminen: un movimiento
  // de inventario nuevo puede quedar vinculado a un gasto nuevo (compra de
  // stock) mediante related_expense_id, y esa llave foránea exige que el
  // gasto ya exista en la base de datos antes de guardar el movimiento.
  await upsertChanged("expenses", prevDb.expenses, nextDb.expenses, expenseToRow);
  await Promise.all([
    upsertChanged("technicians", prevDb.technicians, nextDb.technicians, technicianToRow),
    upsertChanged("categories", prevDb.categories, nextDb.categories, categoryToRow),
    upsertChanged("subcategories", prevDb.subcategories, nextDb.subcategories, subcategoryToRow),
    upsertChanged("products", prevDb.products, nextDb.products, productToRow),
    upsertChanged("assets", prevDb.assets, nextDb.assets, assetToRow),
    // profiles: solo se sincronizan cambios de rol/estado (la creación pasa por adminCreateUser)
    updateChangedProfiles(prevDb.users, nextDb.users, profileToRow),
    insertNewAuditRows(prevDb.auditLog, nextDb.auditLog, auditToRow),
    upsertChanged("services", prevDb.services, nextDb.services, serviceToRow),
    upsertChanged("stock_movements", prevDb.stockMovements, nextDb.stockMovements, stockMovementToRow),
    upsertChanged("asset_types", prevDb.assetTypes, nextDb.assetTypes, assetTypeToRow),
    upsertChanged("causales", prevDb.causales, nextDb.causales, causalToRow),
    upsertChanged("suppliers", prevDb.suppliers || [], nextDb.suppliers || [], supplierToRow),
  ]);
  await syncAssetAssignments(prevDb.assets, nextDb.assets, session);
}
