import { supabase } from "./supabaseClient";
import {
  rowToTechnician, technicianToRow, rowToCategory, categoryToRow,
  rowToSubcategory, subcategoryToRow, rowToProduct, productToRow,
  rowToExpense, expenseToRow, rowToAsset, assetToRow, rowToAssignment,
  rowToProfile, profileToRow, rowToAudit, auditToRow,
  rowToService, serviceToRow, rowToStockMovement, stockMovementToRow,
  rowToAssetType, assetTypeToRow,
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

// Crea un usuario real (auth + perfil) llamando a la Edge Function, que
// valida en el servidor que quien llama es administrador.
export async function adminCreateUser({ email, password, name, username, role }) {
  const { data, error } = await supabase.functions.invoke("create-user", {
    body: { email, password, name, username, role },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

/* ------------------------------ CARGA TOTAL ----------------------------- */

export async function loadAll() {
  const [tech, cat, sub, prod, exp, ast, asg, prof, aud, svc, stk, atypes] = await Promise.all([
    supabase.from("technicians").select("*").order("code"),
    supabase.from("categories").select("*").order("name"),
    supabase.from("subcategories").select("*").order("name"),
    supabase.from("products").select("*").order("name"),
    supabase.from("expenses").select("*").order("date", { ascending: false }),
    supabase.from("assets").select("*").order("code"),
    supabase.from("asset_assignments").select("*").order("from_date"),
    supabase.from("profiles").select("*").order("name"),
    supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("services").select("*").order("date", { ascending: false }),
    supabase.from("stock_movements").select("*").order("date", { ascending: false }),
    supabase.from("asset_types").select("*").order("name"),
  ]);

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

async function upsertChanged(table, prevArr, nextArr, toRow) {
  const changed = diffRows(prevArr, nextArr);
  if (changed.length === 0) return;
  const { error } = await supabase.from(table).upsert(changed.map(toRow), { onConflict: "id" });
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
    if (nextHist.length <= prevHist.length) continue;

    const newEntries = nextHist.slice(prevHist.length);

    if (prevHist.length > 0) {
      const last = prevHist[prevHist.length - 1];
      if (!last.to) {
        await supabase.from("asset_assignments")
          .update({ to_date: newEntries[0].from })
          .eq("asset_id", asset.id)
          .eq("technician_id", last.technicianId)
          .is("to_date", null);
      }
    }
    for (const h of newEntries) {
      const { error } = await supabase.from("asset_assignments").insert({
        asset_id: asset.id, technician_id: h.technicianId, from_date: h.from,
        to_date: h.to || null, assigned_by: session?.id || null,
      });
      if (error) throw error;
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
    upsertChanged("audit_log", prevDb.auditLog, nextDb.auditLog, auditToRow),
    upsertChanged("services", prevDb.services, nextDb.services, serviceToRow),
    upsertChanged("stock_movements", prevDb.stockMovements, nextDb.stockMovements, stockMovementToRow),
    upsertChanged("asset_types", prevDb.assetTypes, nextDb.assetTypes, assetTypeToRow),
  ]);
  await syncAssetAssignments(prevDb.assets, nextDb.assets, session);
}
