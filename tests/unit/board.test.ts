import { describe, expect, it } from "vitest";
import { assignLanes, boardWindow, hhmmToMinutes, minutesFromDayStart, minutesToHhmm, snap } from "@/lib/domain/board";
import { overlappingIds } from "@/lib/domain/schedule";

const day = "2026-10-28";
const at = (hhmm: string) => `${day}T${hhmm}:00+09:00`;

describe("配車ボードの配置", () => {
  it("日本時間の 0:00 からの分に変換する", () => {
    expect(minutesFromDayStart(day, at("09:30"))).toBe(570);
    expect(minutesFromDayStart(day, "2026-10-27T23:00:00+09:00")).toBe(-60);
  });

  it("表示時間は 7〜21時が基本で、はみ出す案件があれば1時間単位で広げる", () => {
    expect(boardWindow(day, [{ pickupAt: at("09:00"), deliveryAt: at("10:00") }])).toEqual({ start: 420, end: 1260 });
    expect(boardWindow(day, [{ pickupAt: at("06:15"), deliveryAt: at("21:40") }])).toEqual({ start: 360, end: 1320 });
    // 前日・翌日にまたがっても 0〜24時に収める
    expect(boardWindow(day, [{ pickupAt: "2026-10-27T23:00:00+09:00", deliveryAt: "2026-10-29T01:00:00+09:00" }])).toEqual({ start: 0, end: 1440 });
  });

  it("15分単位に丸める", () => {
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(15);
    expect(snap(-22)).toBe(-15);
    expect(snap(52)).toBe(45);
  });

  it("重なる予定は別の段に、重ならない予定は同じ段に並べる", () => {
    const { lanes, count } = assignLanes([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 570, end: 630 },
      { id: "c", start: 600, end: 660 }, // a の終了と同時に開始 → a と同じ段
      { id: "d", start: 700, end: 720 },
    ]);
    expect(count).toBe(2);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(1);
    expect(lanes.get("c")).toBe(0);
    expect(lanes.get("d")).toBe(0);
    expect(assignLanes([]).count).toBe(1);
  });

  it("重複の判定：端が接しているだけなら重複ではない", () => {
    const d = (h: string) => new Date(at(h));
    const ids = overlappingIds([
      { id: "a", start: d("09:00"), end: d("10:00") },
      { id: "b", start: d("10:00"), end: d("11:00") },
      { id: "c", start: d("10:30"), end: d("11:30") },
    ]);
    expect([...ids].sort()).toEqual(["b", "c"]);
  });

  it("時刻の文字列と分を相互に変換する", () => {
    expect(minutesToHhmm(570)).toBe("09:30");
    expect(minutesToHhmm(-60)).toBe("23:00");
    expect(hhmmToMinutes("23:59")).toBe(1439);
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(hhmmToMinutes("9:30")).toBeNull();
  });
});
