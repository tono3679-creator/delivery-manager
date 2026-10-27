import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";

/** 期限切れのデモ会社を削除する（Vercel Cron から1日1回呼ばれる） */
export async function GET(request: Request) {
  const secret = serverEnv.cronSecret;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [row] = await db()<{ n: number }[]>`select demo_cleanup() n`;
  return NextResponse.json({ deleted: row.n });
}
