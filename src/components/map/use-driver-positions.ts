"use client";
import { useEffect, useState } from "react";
import type { DriverPositions } from "@/lib/domain/driver-position";

/** 取り直す間隔（ドライバーは1分ごとに送るので、遅れは最大で1分半ほど） */
const POLL_MS = 20_000;

/**
 * ドライバーの現在地を定期的に取り直す（画面が隠れている間は取らない）。
 * サーバーで描画した値（initial）と、取り直した値のうち新しいほうを返す。
 */
export function useDriverPositions(initial: DriverPositions | null, enabled: boolean): DriverPositions | null {
  const [fetched, setFetched] = useState<DriverPositions | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/driver-positions", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as DriverPositions;
        if (!cancelled) setFetched(data);
      } catch {
        // 通信できないときは次の回に取り直す
      }
    };
    const timer = setInterval(load, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  if (!initial) return null;
  return fetched && fetched.at > initial.at ? fetched : initial;
}
