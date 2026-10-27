/**
 * ドライバーの現在地のマーカー（丸いトラックの印＋名前）。
 *   GPS：塗りつぶし、模擬位置（デモ）：白地に破線の縁。更新が止まった GPS は地図側で薄くする。
 * 名前は textContent で入れる（利用者の入力を HTML として解釈しない）。印の SVG は固定の文字列だけ。
 */
import type { DriverPosition } from "@/lib/domain/driver-position";

/** lucide の truck と同じ形（固定の文字列） */
export const TRUCK_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';

export function driverSourceLabel(d: Pick<DriverPosition, "source">): string {
  return d.source === "gps" ? "GPS" : "模擬位置";
}

/** 地図に出す名前（姓だけ。長い名前で地図が埋まらないように） */
export function shortDriverName(name: string): string {
  return name.split(/[\s　]+/)[0] || name;
}

export function driverMarkerElement(d: DriverPosition): HTMLElement {
  const root = document.createElement("div");
  root.className = "relative flex size-9 items-center justify-center";
  const dot = document.createElement("span");
  dot.className =
    d.source === "gps"
      ? "flex size-8 items-center justify-center rounded-full border-2 border-white bg-[oklch(0.32_0.06_260)] text-white shadow-md"
      : "flex size-8 items-center justify-center rounded-full border-2 border-dashed border-[oklch(0.32_0.06_260)] bg-white text-[oklch(0.32_0.06_260)] shadow-md";
  dot.innerHTML = TRUCK_SVG;
  const label = document.createElement("span");
  label.className =
    "pointer-events-none absolute top-full left-1/2 mt-0.5 -translate-x-1/2 rounded bg-white/95 px-1 text-[11px] leading-4 font-semibold whitespace-nowrap text-[oklch(0.25_0.03_260)] shadow-sm";
  label.textContent = shortDriverName(d.driverName);
  root.append(dot, label);
  return root;
}
