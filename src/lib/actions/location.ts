"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { asDriver } from "@/lib/auth";
import { toUserMessage } from "./errors";

export type LocationResult =
  | { ok: true; savedAt: string | null }
  | { ok: false; error: string };

/** ブラウザの位置情報（Geolocation API）から送る値。null は端末が返さなかった項目 */
const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullable(),
  heading: z.number().min(0).lt(360).nullable(),
  speed: z.number().min(0).max(100).nullable(),
  recordedAt: z.iso.datetime({ offset: true }),
});
export type LocationInput = z.input<typeof locationSchema>;

/**
 * 現在地の送信（ドライバー本人のみ）。本人・会社・在籍の確認と、短い間隔の再送の間引きは DB の関数が行う。
 * savedAt が null のときは間引かれた（直前に保存済み）。
 */
export async function reportLocation(input: LocationInput): Promise<LocationResult> {
  const parsed = locationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "位置情報が正しくありません" };
  const v = parsed.data;
  try {
    const [row] = await asDriver((tx) => tx<{ saved_at: Date | null }[]>`
      select driver_report_location(${v.lat}, ${v.lng}, ${v.accuracy}, ${v.heading}, ${v.speed}, ${v.recordedAt}::timestamptz) saved_at`);
    return { ok: true, savedAt: row?.saved_at?.toISOString() ?? null };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "位置情報を送れませんでした") };
  }
}

/** 共有の停止（保存している位置を消す） */
export async function stopLocationSharing(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await asDriver((tx) => tx`select driver_stop_location_sharing()`);
    revalidatePath("/driver", "layout");
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: toUserMessage(e, "共有を停止できませんでした") };
  }
}
