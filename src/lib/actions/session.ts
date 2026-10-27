"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser, db } from "@/lib/db";
import { getAuthUserId, getCurrentUser } from "@/lib/auth";
import { createDemoSandbox, DEMO_TTL_HOURS, DemoCapacityError, ensureDemoCapacity } from "@/lib/demo/sandbox";
import { serverEnv } from "@/lib/env";
import { verifyPassword } from "@/lib/password";
import { endSession, record, startSession, underLimit } from "@/lib/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

const loginSchema = z.object({
  email: z.email("メールアドレスの形式が正しくありません"),
  password: z.string().min(1, "パスワードを入力してください"),
});

/** 回数の制限（総当たり・大量作成の対策） */
const LIMITS = {
  /** 同じメールアドレスへのログインの失敗：15分に10回まで */
  loginEmail: { max: 10, minutes: 15 },
  /** 同じ接続元からのログインの失敗：15分に30回まで */
  loginIp: { max: 30, minutes: 15 },
  /** 同じ接続元からのデモの作成：1時間に DEMO_CREATE_LIMIT_PER_HOUR 回まで（既定 30） */
  get demoIp() {
    return { max: serverEnv.demoCreateLimitPerHour, minutes: 60 };
  },
};

/** 接続元の IP（Vercel では x-forwarded-for の先頭が利用者の IP。ローカルでは "local"） */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

const LOGIN_FAILED = "メールアドレスまたはパスワードが正しくありません";
const TOO_MANY = "失敗が続いたため、しばらくログインできません。15分ほどしてから再度お試しください";

export async function signInWithPassword(input: z.infer<typeof loginSchema>): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "入力内容を確認してください" };
  const email = parsed.data.email.trim().toLowerCase();
  const byEmail = `login:email:${email}`;
  const byIp = `login:ip:${await clientIp()}`;
  if (!(await underLimit(byEmail, LIMITS.loginEmail.max, LIMITS.loginEmail.minutes))
    || !(await underLimit(byIp, LIMITS.loginIp.max, LIMITS.loginIp.minutes))) {
    return { ok: false, error: TOO_MANY };
  }
  const [user] = await db()<{ id: string; encrypted_password: string | null }[]>`
    select id, encrypted_password from auth.users where lower(email) = ${email} and not is_anonymous`;
  // 利用者がいないときも照合と同じだけ時間をかける（verifyPassword の中）
  if (!(await verifyPassword(parsed.data.password, user?.encrypted_password))) {
    await record(byEmail);
    await record(byIp);
    return { ok: false, error: LOGIN_FAILED };
  }
  await startSession(user.id);
  redirect("/");
}

/** デモを開始する：匿名の利用者を作ってログイン → 訪問者専用のデモ会社を作成 */
export async function startDemo(role: "admin" | "driver"): Promise<ActionResult> {
  if (role !== "admin" && role !== "driver") return { ok: false, error: "不正な操作です" };
  let auth = await getAuthUserId();
  if (!auth) {
    // 匿名の利用者を作る前に、デモ環境を新しく作れるか確かめる
    const byIp = `demo:ip:${await clientIp()}`;
    if (!(await underLimit(byIp, LIMITS.demoIp.max, LIMITS.demoIp.minutes))) {
      return { ok: false, error: "短時間に多くのデモ環境が作られたため、しばらくお待ちください。1時間ほどで再度お試しいただけます" };
    }
    try {
      await ensureDemoCapacity();
    } catch (e) {
      return demoError(e);
    }
    await record(byIp);
    const [user] = await db()<{ id: string }[]>`insert into auth.users (is_anonymous) values (true) returning id`;
    // デモ環境と同じ期限でログインを切る
    await startSession(user.id, DEMO_TTL_HOURS * 3600_000);
    auth = { id: user.id, isAnonymous: true };
  }
  try {
    await createDemoSandbox(auth.id, role);
  } catch (e) {
    return demoError(e);
  }
  redirect(role === "admin" ? "/dashboard" : "/driver");
}

function demoError(e: unknown): ActionResult {
  if (e instanceof DemoCapacityError) {
    return {
      ok: false,
      error: "ただいまデモの利用が集中しているため、新しいデモ環境を用意できません。しばらくしてから再度お試しください",
    };
  }
  console.error(e);
  return { ok: false, error: "デモデータの準備に失敗しました。時間をおいて再度お試しください" };
}

/**
 * ログアウト。デモ（匿名の利用者）のときは、もう一度入る手段がないので、デモ会社と利用者もその場で削除する。
 */
export async function signOut(): Promise<void> {
  const auth = await getAuthUserId();
  if (auth?.isAnonymous) {
    const sql = db();
    await sql.begin(async (tx) => {
      await tx`delete from companies where is_demo and demo_owner = ${auth.id}`;
      await tx`delete from auth.users where id = ${auth.id} and is_anonymous`;
    });
  }
  await endSession();
  redirect("/login");
}

/** デモ環境のみ：管理者⇔ドライバーの切り替え（DB 側でデモ会社かを確認する） */
/**
 * デモ環境での管理者⇔ドライバーの切り替え。
 * driverId を指定すると、そのドライバーとして体験できる（案件詳細の「ドライバー画面で確認」から使う）。
 */
export async function switchDemoRole(role: "admin" | "driver", driverId?: string, next?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.isDemo) redirect("/login");
  const parsedRole = z.enum(["admin", "driver"]).parse(role);
  const parsedDriver = driverId === undefined ? null : z.uuid().parse(driverId);
  await asUser(user.userId, (tx) => tx`select demo_switch_role(${parsedRole}::app_role, ${parsedDriver})`);
  revalidatePath("/", "layout");
  // 移動先は自分のアプリ内のパスに限る（外部サイトへの転送を防ぐ）
  const safeNext = next && /^\/(driver|orders|dispatch|dashboard)(\/[\w-]*)*$/.test(next) ? next : null;
  redirect(safeNext ?? (parsedRole === "admin" ? "/dashboard" : "/driver"));
}

export async function resetDemo(): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.isDemo) redirect("/login");
  await createDemoSandbox(user.userId, user.role);
  revalidatePath("/", "layout");
}

export async function markNotificationsRead(audience: "admin" | "driver"): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await asUser(user.userId, (tx) =>
    audience === "admin"
      ? tx`update notifications set read_at = now() where audience = 'admin' and read_at is null`
      : tx`update notifications set read_at = now() where audience = 'driver' and driver_id = ${user.driverId} and read_at is null`,
  );
  revalidatePath("/", "layout");
}
