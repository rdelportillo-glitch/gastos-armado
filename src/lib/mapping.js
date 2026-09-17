// Conversión entre columnas de Postgres (snake_case) y el modelo en memoria
// que usan los componentes de la app (camelCase) — el mismo "shape" que
// tenía el prototipo, para no tener que reescribir las vistas.

export const rowToTechnician = (r) => ({
  id: r.id, code: r.code, name: r.name, document: r.document, phone: r.phone,
  city: r.city, department: r.department, zone: r.zone, entryDate: r.entry_date, status: r.status,
  exitDate: r.exit_date, type: r.type, notes: r.notes, category: r.category || "Técnico de campo",
});
export const technicianToRow = (t) => ({
  id: t.id, code: t.code, name: t.name, document: t.document, phone: t.phone,
  city: t.city, department: t.department || null, zone: t.zone, entry_date: t.entryDate || null, status: t.status,
  exit_date: t.exitDate || null, type: t.type, notes: t.notes, category: t.category || "Técnico de campo",
});

export const rowToCategory = (r) => ({ id: r.id, name: r.name, active: r.active });
export const categoryToRow = (c) => ({ id: c.id, name: c.name, active: c.active });

export const rowToSubcategory = (r) => ({ id: r.id, categoryId: r.category_id, name: r.name, tipo: r.tipo, active: r.active, trackStock: r.track_stock === true });
export const subcategoryToRow = (s) => ({ id: s.id, category_id: s.categoryId, name: s.name, tipo: s.tipo, active: s.active, track_stock: s.trackStock === true });

export const rowToProduct = (r) => ({ id: r.id, subcategoryId: r.subcategory_id, name: r.name, active: r.active });
export const productToRow = (p) => ({ id: p.id, subcategory_id: p.subcategoryId, name: p.name, active: p.active });

export const rowToExpense = (r) => ({
  id: r.id, date: r.date, technicianId: r.technician_id, categoryId: r.category_id,
  subcategoryId: r.subcategory_id, productId: r.product_id, conceptManual: r.concept_manual,
  quantity: Number(r.quantity), unitValue: Number(r.unit_value), totalValue: Number(r.total_value),
  observation: r.observation, attachmentName: r.attachment_name, responsibleUserId: r.responsible_user_id,
  status: r.status, annulReason: r.annul_reason, annulUserId: r.annul_user_id, annulDate: r.annul_date,
  createdAt: r.created_at,
});
// total_value es una columna generada por Postgres: nunca se envía en el insert/update.
export const expenseToRow = (e) => ({
  id: e.id, date: e.date, technician_id: e.technicianId || null, category_id: e.categoryId,
  subcategory_id: e.subcategoryId, product_id: e.productId || null, concept_manual: e.conceptManual || null,
  quantity: e.quantity, unit_value: e.unitValue, observation: e.observation || null,
  attachment_name: e.attachmentName || null, responsible_user_id: e.responsibleUserId,
  status: e.status, annul_reason: e.annulReason || null, annul_user_id: e.annulUserId || null,
  annul_date: e.annulDate || null,
});

export const rowToAsset = (r) => ({
  id: r.id, code: r.code, type: r.type, brand: r.brand, model: r.model, serial: r.serial,
  value: Number(r.value || 0), purchaseDate: r.purchase_date, technicianId: r.technician_id,
  deliveryDate: r.delivery_date, status: r.status, history: [],
});
export const assetToRow = (a) => ({
  id: a.id, code: a.code, type: a.type, brand: a.brand, model: a.model, serial: a.serial,
  value: a.value || 0, purchase_date: a.purchaseDate || null, technician_id: a.technicianId || null,
  delivery_date: a.deliveryDate || null, status: a.status,
});

export const rowToAssignment = (r) => ({
  assetId: r.asset_id, technicianId: r.technician_id, from: r.from_date, to: r.to_date, userId: r.assigned_by,
});

export const rowToProfile = (r) => ({ id: r.id, name: r.name, username: r.username, role: r.role, active: r.active });
export const profileToRow = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active });

export const rowToAudit = (r) => {
  const d = new Date(r.created_at);
  return {
    id: r.id, userId: r.user_id, action: r.action, record: r.record, oldValue: r.old_value, newValue: r.new_value,
    date: d.toISOString().slice(0, 10), time: d.toTimeString().slice(0, 5),
  };
};
export const auditToRow = (a) => ({ id: a.id, user_id: a.userId, action: a.action, record: a.record, old_value: a.oldValue, new_value: a.newValue });

export const rowToService = (r) => ({
  id: r.id, date: r.date, technicianId: r.technician_id, serviceType: r.service_type,
  productId: r.product_id, observacionTrabajo: r.observacion_trabajo, armado: r.armado,
  quantity: Number(r.quantity), observation: r.observation, responsibleUserId: r.responsible_user_id, createdAt: r.created_at,
});
export const serviceToRow = (s) => ({
  id: s.id, date: s.date, technician_id: s.technicianId, service_type: s.serviceType || null,
  product_id: s.productId || null, observacion_trabajo: s.observacionTrabajo || null, armado: s.armado || null,
  quantity: s.quantity, observation: s.observation || null, responsible_user_id: s.responsibleUserId,
});

export const rowToStockMovement = (r) => ({
  id: r.id, type: r.type, date: r.date, subcategoryId: r.subcategory_id, productId: r.product_id,
  quantity: Number(r.quantity), technicianId: r.technician_id, unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
  supplier: r.supplier, observation: r.observation, responsibleUserId: r.responsible_user_id, createdAt: r.created_at,
  status: r.status || "Activo", annulReason: r.annul_reason, annulUserId: r.annul_user_id, annulDate: r.annul_date,
  relatedExpenseId: r.related_expense_id,
});
export const stockMovementToRow = (m) => ({
  id: m.id, type: m.type, date: m.date, subcategory_id: m.subcategoryId, product_id: m.productId || null,
  quantity: m.quantity, technician_id: m.technicianId || null, unit_cost: m.unitCost === null || m.unitCost === undefined ? null : m.unitCost,
  supplier: m.supplier || null, observation: m.observation || null, responsible_user_id: m.responsibleUserId,
  status: m.status || "Activo", annul_reason: m.annulReason || null, annul_user_id: m.annulUserId || null,
  annul_date: m.annulDate || null, related_expense_id: m.relatedExpenseId || null,
});

export const rowToAssetType = (r) => ({ id: r.id, name: r.name, active: r.active });
export const assetTypeToRow = (t) => ({ id: t.id, name: t.name, active: t.active });
