import { all } from "./db";

export type TaskV = {
  id: number; date: string; title: string; detail: string | null; kind: string; status: string; priority: string;
  needs_review: number; exception_reason: string | null; note: string | null; assignee_id: number | null;
  assignee_role: string | null; done_by: number | null; done_at: string | null; area: string | null;
  assignee: string | null; done_name: string | null; area_id: number | null;
  stock_item_id: number | null; stock_name: string | null; stock_unit: string | null;
};

const BASE = `SELECT t.*, a.name AS area, au.name AS assignee, du.name AS done_name,
    ci.stock_item_id, si.name AS stock_name, si.unit AS stock_unit
  FROM tasks t LEFT JOIN areas a ON a.id=t.area_id LEFT JOIN users au ON au.id=t.assignee_id
  LEFT JOIN users du ON du.id=t.done_by LEFT JOIN checklist_items ci ON ci.id=t.checklist_item_id
  LEFT JOIN stock_items si ON si.id=ci.stock_item_id`;

export const tasksWhere = (where: string, ...p: (string | number | null)[]) =>
  all<TaskV>(`${BASE} WHERE ${where} ORDER BY (t.priority='yuksek') DESC, t.area_id, t.id`, ...p);

export type Area = { id: number; name: string; needs_cover: number };
export const areas = () => all<Area>("SELECT * FROM areas ORDER BY id");

export type ItemV = {
  id: number; name: string; category: string | null; unit: string; location: string; qty: number; min_level: number;
  critical_level: number; supplier_id: number | null; supplier: string | null; last_price: number | null; open_purchase: number | null;
};
export const stockItems = () =>
  all<ItemV>(`SELECT i.*, s.name AS supplier,
    (SELECT id FROM purchases p WHERE p.item_id=i.id AND p.status IN ('talep','onay_bekliyor','onaylandi','siparis') LIMIT 1) AS open_purchase
    FROM stock_items i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.active=1 ORDER BY i.location, i.name`);
