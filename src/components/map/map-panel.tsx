"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPinOff, ShieldAlert } from "lucide-react";
import type { MapOrder } from "@/lib/data/map";
import { DRIVER_ACTIVITY_LABEL, minutesAgo, type DriverPosition, type DriverPositions } from "@/lib/domain/driver-position";
import { MAP_STATE_LABEL, MAP_STATES, type MapState } from "@/lib/domain/map";
import { formatNumber, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeliveryMap } from "./delivery-map";
import { driverSourceLabel, TRUCK_SVG } from "./driver-marker";
import { PinGlyph } from "./pin";
import { useDriverPositions } from "./use-driver-positions";

/** 実際の位置と誤認されないための表示（仕様：デモ表示であることを明記する） */
export function MapDemoNotice({ className, withDrivers = false }: { className?: string; withDrivers?: boolean }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
      <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning-strong" aria-hidden />
      <span>
        <strong className="font-semibold text-warning-strong">デモ表示</strong>
        ：配送先のマーカーは住所から求めた架空の位置です。
        {withDrivers
          ? "ドライバーの位置は、位置情報を共有中なら GPS、デモではそれ以外を本日の予定から求めた模擬位置で表示します。"
          : "GPS による車両の現在地ではありません。"}
      </span>
    </p>
  );
}

/** 凡例・一覧用のドライバーの印 */
export function DriverGlyph({ source, className }: { source: DriverPosition["source"]; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-[18px] items-center justify-center rounded-full [&_svg]:size-[11px]",
        source === "gps"
          ? "bg-[oklch(0.32_0.06_260)] text-white"
          : "border border-dashed border-[oklch(0.32_0.06_260)] bg-white text-[oklch(0.32_0.06_260)]",
        className,
      )}
      // 固定の SVG 文字列のみ（利用者の入力は含まない）
      dangerouslySetInnerHTML={{ __html: TRUCK_SVG }}
    />
  );
}

const NO_DRIVERS: DriverPosition[] = [];

function driverStatusText(d: DriverPosition, now: Date): string {
  if (d.source === "simulated") return `${DRIVER_ACTIVITY_LABEL[d.activity]}・模擬位置`;
  const ago = minutesAgo(d.updatedAt, now);
  return `${DRIVER_ACTIVITY_LABEL[d.activity]}・GPS ${formatTime(d.updatedAt)}（${ago === 0 ? "1分以内" : `${ago}分前`}）`;
}

/**
 * 地図＋凡例（区分ごとの件数・表示の切り替え）＋ 位置が無い案件の件数。
 * withList を指定すると、横に配送予定順の一覧を出し、選んだ案件の吹き出しを地図で開く。
 * drivers を渡すと、ドライバーの現在地も表示し、liveDrivers のあいだ定期的に取り直す。
 */
export function MapPanel({
  orders, fitKey, withList = false, mapClassName, label, detailPath = "/orders",
  drivers = null, liveDrivers = false, driverFilter,
}: {
  orders: MapOrder[];
  fitKey: string;
  withList?: boolean;
  mapClassName?: string;
  label: string;
  /** 案件の詳細画面のパス（管理者 /orders、ドライバー /driver/orders） */
  detailPath?: string;
  /** ドライバーの現在地（管理者の地図・本日のみ） */
  drivers?: DriverPositions | null;
  liveDrivers?: boolean;
  /** ドライバーで絞り込んでいるとき（"unassigned" ならドライバーは出さない） */
  driverFilter?: string;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<MapState>>(() => new Set());
  const [showDrivers, setShowDrivers] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [listTab, setListTab] = useState<"orders" | "drivers">("orders");

  const latest = useDriverPositions(drivers, liveDrivers);
  const driverList = useMemo(() => {
    const all = latest?.positions ?? [];
    if (!driverFilter) return all;
    return all.filter((d) => d.driverId === driverFilter);
  }, [latest, driverFilter]);
  const withDrivers = drivers !== null;
  // 経過時間は取得した時刻を基準にする（一覧はドライバーがいるときだけ描くので、無いときの値は使わない）
  const now = useMemo(() => new Date(latest?.at ?? 0), [latest]);

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

  const chip = (pressed: boolean) =>
    cn(
      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
      "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default disabled:opacity-50",
      pressed ? "bg-card text-foreground" : "bg-card text-muted-foreground line-through",
    );

  const selectDriver = (id: string) => {
    setShowDrivers(true);
    // 同じドライバーをもう一度選んだときも地図を動かす
    setSelectedDriverId(null);
    requestAnimationFrame(() => setSelectedDriverId(id));
  };

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
            className={chip(!hidden.has(s))}
          >
            <PinGlyph state={s} className="flex" />
            {MAP_STATE_LABEL[s]}
            <span className="tabular text-muted-foreground">{formatNumber(counts[s])}</span>
          </button>
        ))}
        {withDrivers && (
          <button
            type="button"
            aria-pressed={showDrivers}
            onClick={() => setShowDrivers((v) => !v)}
            disabled={driverList.length === 0}
            className={chip(showDrivers)}
          >
            <DriverGlyph source="gps" />
            ドライバー
            <span className="tabular text-muted-foreground">{formatNumber(driverList.length)}</span>
          </button>
        )}
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
          detailPath={detailPath}
          drivers={showDrivers ? driverList : NO_DRIVERS}
          selectedDriverId={selectedDriverId}
          onSelectDriver={setSelectedDriverId}
        />
        {withList && (
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border lg:max-h-[560px]">
            {withDrivers && (
              <div className="grid grid-cols-2 border-b bg-muted/40 p-1 text-sm" role="tablist" aria-label="一覧の切り替え">
                {(["orders", "drivers"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={listTab === tab}
                    onClick={() => setListTab(tab)}
                    className={cn(
                      "rounded-md px-2 py-1.5 font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      listTab === tab ? "bg-card shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab === "orders" ? `案件 ${formatNumber(visible.length)}` : `ドライバー ${formatNumber(driverList.length)}`}
                  </button>
                ))}
              </div>
            )}
            {(!withDrivers || listTab === "orders") && (
              <ol className="relative max-h-[560px] min-h-0 flex-1 divide-y overflow-y-auto" aria-label="案件（配送予定順）">
                {visible.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">表示する案件はありません</li>}
                {visible.map((o) => {
                  const located = o.lat !== null && o.lng !== null;
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => (located ? setSelectedId(o.id) : router.push(`${detailPath}/${o.id}`))}
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
            {withDrivers && listTab === "drivers" && (
              <ul className="relative max-h-[560px] min-h-0 flex-1 divide-y overflow-y-auto" aria-label="ドライバーの現在地">
                {driverList.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                    現在地を表示できるドライバーはいません。ドライバーがスマホで「位置情報の共有」をオンにすると表示されます
                  </li>
                )}
                {driverList.map((d) => (
                  <li key={d.driverId}>
                    <button
                      type="button"
                      onClick={() => selectDriver(d.driverId)}
                      aria-current={selectedDriverId === d.driverId ? "true" : undefined}
                      className={cn(
                        "flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none",
                        selectedDriverId === d.driverId && "bg-info-soft",
                        d.stale && "opacity-70",
                      )}
                    >
                      <DriverGlyph source={d.source} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{d.driverName}</span>
                          <span className="sr-only">{driverSourceLabel(d)}</span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{driverStatusText(d, now)}</span>
                        {d.order && <span className="block truncate text-xs">{d.order.orderNo} {d.order.deliveryName}</span>}
                        {d.stale && <span className="block text-xs font-medium text-warning-strong">しばらく位置が更新されていません</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <MapDemoNotice withDrivers={withDrivers} />
        {unlocated.length > 0 && (
          <p className="text-xs text-muted-foreground">
            住所から位置を求められなかった案件 {formatNumber(unlocated.length, "件")}は地図に表示していません
          </p>
        )}
      </div>
    </div>
  );
}
