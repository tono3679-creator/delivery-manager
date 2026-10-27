"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPinOff, ShieldAlert } from "lucide-react";
import type { MapOrder } from "@/lib/data/map";
import { MAP_STATE_LABEL, MAP_STATES, type MapState } from "@/lib/domain/map";
import { formatNumber, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeliveryMap } from "./delivery-map";
import { PinGlyph } from "./pin";

/** 実際の位置と誤認されないための表示（仕様：デモ表示であることを明記する） */
export function MapDemoNotice({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
      <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning-strong" aria-hidden />
      <span>
        <strong className="font-semibold text-warning-strong">デモ表示</strong>
        ：マーカーは住所から求めた架空の位置です。GPS による車両の現在地ではありません。
      </span>
    </p>
  );
}

/**
 * 地図＋凡例（区分ごとの件数・表示の切り替え）＋ 位置が無い案件の件数。
 * withList を指定すると、横に配送予定順の一覧を出し、選んだ案件の吹き出しを地図で開く。
 */
export function MapPanel({
  orders, fitKey, withList = false, mapClassName, label,
}: {
  orders: MapOrder[];
  fitKey: string;
  withList?: boolean;
  mapClassName?: string;
  label: string;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<MapState>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = Object.fromEntries(MAP_STATES.map((s) => [s, 0])) as Record<MapState, number>;
    for (const o of orders) c[o.state] += 1;
    return c;
  }, [orders]);
  const visible = useMemo(() => orders.filter((o) => !hidden.has(o.state)), [orders, hidden]);
  const unlocated = visible.filter((o) => o.lat === null || o.lng === null);

  const toggle = (state: MapState) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(state)) next.delete(state);
      else next.add(state);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="表示する区分">
        {MAP_STATES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={!hidden.has(s)}
            onClick={() => toggle(s)}
            disabled={counts[s] === 0}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:opacity-50",
              hidden.has(s) ? "bg-card text-muted-foreground line-through" : "bg-card text-foreground",
            )}
          >
            <PinGlyph state={s} className="flex" />
            {MAP_STATE_LABEL[s]}
            <span className="tabular text-muted-foreground">{formatNumber(counts[s])}</span>
          </button>
        ))}
      </div>

      <div className={cn(withList && "grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]")}>
        <DeliveryMap
          orders={visible}
          fitKey={fitKey}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpen={(href) => router.push(href)}
          label={label}
          className={mapClassName ?? "h-80"}
        />
        {withList && (
          <ol className="max-h-[560px] divide-y overflow-y-auto rounded-lg border" aria-label="案件（配送予定順）">
            {visible.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">表示する案件はありません</li>}
            {visible.map((o) => {
              const located = o.lat !== null && o.lng !== null;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => (located ? setSelectedId(o.id) : router.push(`/orders/${o.id}`))}
                    aria-current={selectedId === o.id ? "true" : undefined}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none",
                      selectedId === o.id && "bg-info-soft",
                    )}
                  >
                    <PinGlyph state={o.state} className="mt-0.5 flex shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="font-semibold tabular">{formatTime(o.deliveryAt)}</span>
                        <span className="tabular text-muted-foreground">{o.orderNo}</span>
                        <span className="sr-only">{MAP_STATE_LABEL[o.state]}</span>
                        {!located && <MapPinOff className="size-3 text-muted-foreground" aria-label="位置情報なし" />}
                      </span>
                      <span className="block truncate text-sm">{o.deliveryName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{o.driverName ?? "未割当"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <MapDemoNotice />
        {unlocated.length > 0 && (
          <p className="text-xs text-muted-foreground">
            住所から位置を求められなかった案件 {formatNumber(unlocated.length, "件")}は地図に表示していません
          </p>
        )}
      </div>
    </div>
  );
}
