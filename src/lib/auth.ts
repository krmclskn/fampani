import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { get, run, setting, todayStr } from "./db";

export type Role = "sahip" | "operasyon" | "sef" | "stok" | "bar" | "calisan";
export type User = { id: number; name: string; username: string; role: Role };

export const ROLE_LABEL: Record<Role, string> = {
  sahip: "İşletme sahibi",
  operasyon: "Operasyon sorumlusu",
  sef: "Mutfak şefi",
  stok: "Stok / tedarik sorumlusu",
  bar: "Bar sorumlusu",
  calisan: "Vardiya çalışanı",
};

const COOKIE = "fp_session";
const DAYS = 14;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + DAYS * 86400000);
  run("DELETE FROM sessions WHERE expires_at < ?", new Date().toISOString());
  run("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", sha(token), userId, expires.toISOString());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires,
  });
}

export async function destroySession() {
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE token_hash=?", sha(token));
  c.delete(COOKIE);
}

export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return (
    get<User>(
      `SELECT u.id,u.name,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`,
      sha(token), new Date().toISOString(),
    ) ?? null
  );
});

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/giris");
  return u;
}

const is = (u: User, ...roles: Role[]) => roles.includes(u.role);

/** Rol bazlı yetkiler. Para ve stok düzeltmesi içeren işler onay ister. */
export const can = {
  manage: (u: User) => is(u, "sahip", "operasyon"),
  seeSummary: (u: User) => is(u, "sahip", "operasyon"),
  planShifts: (u: User) => is(u, "sahip", "operasyon"),
  assignTasks: (u: User) => !is(u, "calisan"),
  reviewTasks: (u: User) => !is(u, "calisan"),
  editStock: (u: User) => is(u, "sahip", "operasyon", "stok", "sef"),
  approveCount: (u: User) => is(u, "sahip", "operasyon", "stok"),
  reviewPurchase: (u: User) => is(u, "sahip", "operasyon", "stok"),
  approvePurchase: (u: User, totalKurus: number) =>
    u.role === "sahip" || (u.role === "operasyon" && totalKurus <= Number(setting("purchase_limit") || 0)),
  orderPurchase: (u: User) => is(u, "sahip", "operasyon", "stok"),
  receivePurchase: (u: User) => !is(u, "calisan"),
  markPaid: (u: User) => is(u, "sahip"),
  closeDay: (u: User) =>
    is(u, "sahip", "operasyon", "bar") ||
    !!get("SELECT 1 FROM shifts WHERE date=? AND user_id=? AND is_lead=1", todayStr(), u.id),
};
