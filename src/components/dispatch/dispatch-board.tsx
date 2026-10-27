"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { AlarmClock, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { assignOrder, type AssignInput } from "@/lib/actions/dispatch";
import type { Conflict } from "@/lib/actions/orders";
import type { BoardDriver, BoardOrder } from "@/lib/data/dispatch";
import { addMinutes } from "@/lib/date";
import { assignLanes, boardWindow, minutesFromDayStart, minutesToHhmm, snap } from "@/lib/domain/board";
import { DRIVER_STATUS_LABEL } from "@/lib/domain/labels";
import { overlappingIds } from "@/lib/domain/schedule";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/domain/status";
import { cn } from "@/lib/utils";
import { OrderSheet } from "./order-sheet";

const LANE_HEIGHT = 40;
const ROW_PADDING = 6;
/** これより小さい横移動は「時刻を変えない」とみなす（縦にドラッグしたときの手ぶれ対策） */
const DEAD_ZONE_PX = 12;
const UNASSIGNED_ROW = "unassigned";
const DISPATCHABLE: readonly OrderStatus[] = ["unassigned", "assigned"];
/** 重複判定の対象（DB の確認と同じ。完了・失敗は対象外） */
const ACTIVE: readonly OrderStatus[] = ["assigned", "picked_up", "in_transit"];

type Placement = { driverId: string | null; pickupAt: string; deliveryAt: string };
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

type Row = { orders: BoardOrder[]; lanes: Map<string, number>; laneCount: number; overlap: Set<string> };

const BLOCK_STYLE: Record<OrderStatus, string> = {
  unassigned: "border-dashed border-warning-strong/60 bg-card text-foreground",
  assigned: "border-brand/40 bg-info-soft text-info-strong",
  picked_up: "border-warning/60 bg-warning-soft text-warning-strong",
  in_transit: "border-warning/60 bg-warning-soft text-warning-strong",
  delivered: "border-success/40 bg-success-soft text-success-strong",
  failed: "border-destructive/40 bg-danger-soft text-danger-strong",
  cancelled: "border-border bg-muted text-muted-foreground",
};

export function DispatchBoard({
  day, today, nowIso, drivers, orders: serverOrders,
}: { day: string; today: string; nowIso: string; drivers: BoardDriver[]; orders: BoardOrder[] }) {
  const router = useRouter();
  // 保存中・確認中の配置（保存が終わるとサーバーの最新データに置き換わる）
  const [overrides, setOverrides] = useState<Record<string, Placement>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ row: string; start: number; end: number } | null>(null);
  const [confirm, setConfirm] = useState<{ input: AssignInput; conflicts: Conflict[]; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date(nowIso));
  const trackWidth = useRef(1);
  // ドラッグを終えた直後のクリックで詳細パネルが開かないようにする（次に押したときに解除）
  const suppressClick = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const orders = useMemo(
    () => serverOrders.map((o) => {
      const p = overrides[o.id];
      if (!p) return o;
      return { ...o, ...p, status: (p.driverId ? (o.status === "unassigned" ? "assigned" : o.status) : "unassigned") as OrderStatus };
    }),
    [serverOrders, overrides],
  );
  const win = useMemo(() => boardWindow(day, serverOrders), [day, serverOrders]);
  const total = win.end - win.start;
  const pct = (minutes: number) => `${((Math.min(Math.max(minutes, win.start), win.end) - win.start) / total) * 100}%`;

  const rows = useMemo(() => {
    const byRow = new Map<string, BoardOrder[]>();
    for (const o of orders) {
      const key = o.driverId ?? UNASSIGNED_ROW;
      byRow.set(key, [...(byRow.get(key) ?? []), o]);
    }
    const build = (key: string): Row => {
      const list = byRow.get(key) ?? [];
      const items = list.map((o) => ({ id: o.id, start: minutesFromDayStart(day, o.pickupAt), end: minutesFromDayStart(day, o.deliveryAt) }));
      const { lanes, count } = assignLanes(items);
      const overlap = key === UNASSIGNED_ROW
        ? new Set<string>()
        : overlappingIds(list.filter((o) => ACTIVE.includes(o.status)).map((o) => ({ id: o.id, start: new Date(o.pickupAt), end: new Date(o.deliveryAt) })));
      return { orders: list, lanes, laneCount: count, overlap };
    };
    return { unassigned: build(UNASSIGNED_ROW), drivers: new Map(drivers.map((d) => [d.id, build(d.id)])) };
  }, [orders, drivers, day]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // スマホは長押しでドラッグ（通常のスワイプは横スクロール）
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );

  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.name ?? "未割当";
  const findServer = (id: string) => serverOrders.find((o) => o.id === id);
  const orderLabel = (id: string) => {
    const o = findServer(id);
    return o ? `${o.orderNo} ${o.deliveryName}` : "案件";
  };

  const shiftFor = (deltaX: number) => (Math.abs(deltaX) < DEAD_ZONE_PX ? 0 : snap((deltaX / trackWidth.current) * total));

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    const track = document.querySelector<HTMLElement>("[data-board-track]");
    trackWidth.current = track?.getBoundingClientRect().width || 1;
  };

  const onDragMove = (e: DragMoveEvent) => {
    const o = orders.find((x) => x.id === e.active.id);
    if (!o || !e.over) {
      setPreview(null);
      return;
    }
    const shift = shiftFor(e.delta.x);
    const start = minutesFromDayStart(day, o.pickupAt) + shift;
    const end = minutesFromDayStart(day, o.deliveryAt) + shift;
    const row = String(e.over.id);
    setPreview((prev) => (prev && prev.row === row && prev.start === start ? prev : { row, start, end }));
  };

  const commit = async (input: AssignInput, message: string) => {
    const base = findServer(input.orderId);
    if (!base) return;
    setOverrides((prev) => ({
      ...prev,
      [input.orderId]: { driverId: input.driverId, pickupAt: input.pickupAt ?? base.pickupAt, deliveryAt: input.deliveryAt ?? base.deliveryAt },
    }));
    const result = await assignOrder(input);
    if (!result.ok && "needsConfirm" in result) {
      setConfirm({ input, conflicts: result.conflicts, message });
      return;
    }
    setOverrides((prev) => without(prev, input.orderId));
    if (result.ok) {
      toast.success(message);
    } else {
      toast.error(result.error);
      if (result.stale) router.refresh();
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    suppressClick.current = true;
    setActiveId(null);
    setPreview(null);
    const o = findServer(String(e.active.id));
    if (!o || !e.over) return;
    const row = String(e.over.id);
    const driverId = row === UNASSIGNED_ROW ? null : row;
    // 未割当へ戻すときは時刻を変えない
    const shift = driverId ? shiftFor(e.delta.x) : 0;
    if (driverId === o.driverId && shift === 0) return;
    const pickupAt = addMinutes(new Date(o.pickupAt), shift).toISOString();
    const deliveryAt = addMinutes(new Date(o.deliveryAt), shift).toISOString();
    const time = `${minutesToHhmm(minutesFromDayStart(day, pickupAt))}〜${minutesToHhmm(minutesFromDayStart(day, deliveryAt))}`;
    const message = !driverId
      ? `${o.orderNo} を未割当に戻しました`
      : driverId === o.driverId
        ? `${o.orderNo} の予定を ${time} に変更しました`
        : `${o.orderNo} を ${driverName(driverId)}さんに配車しました（${time}）`;
    commit(
      {
        orderId: o.id,
        driverId,
        expectedStatus: o.status,
        expectedDriverId: o.driverId,
        ...(shift !== 0 ? { pickupAt, deliveryAt } : {}),
      },
      message,
    );
  };

  const onConfirm = async () => {
    if (!confirm) return;
    setConfirming(true);
    const { input, message } = confirm;
    const result = await assignOrder({ ...input, confirmOverlap: true });
    setConfirming(false);
    setConfirm(null);
    setOverrides((prev) => without(prev, input.orderId));
    if (result.ok) toast.success(`${message}（時間の重複あり）`);
    else if ("error" in result) {
      toast.error(result.error);
      if (result.stale) router.refresh();
    }
  };

  const onCancelConfirm = () => {
    if (confirm) setOverrides((prev) => without(prev, confirm.input.orderId));
    setConfirm(null);
  };

  const active = activeId ? orders.find((o) => o.id === activeId) : null;
  const selected = selectedId ? orders.find((o) => o.id === selectedId) ?? null : null;
  const hours: number[] = [];
  for (let m = Math.ceil(win.start / 60) * 60; m <= win.end; m += 60) hours.push(m);
  const nowMinutes = day === today ? minutesFromDayStart(day, now) : null;

  const openSheet = (id: string) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setSelectedId(id);
  };

  const renderRow = (key: string, row: Row, label: React.ReactNode, disabled = false) => (
    <div key={key} className="grid grid-cols-[9.5rem_1fr] border-b last:border-b-0 sm:grid-cols-[12rem_1fr]">
      <div className="sticky left-0 z-10 flex flex-col justify-center gap-0.5 border-r bg-card px-3 py-1.5">{label}</div>
      <Track id={key} disabled={disabled} height={row.laneCount * LANE_HEIGHT + ROW_PADDING * 2}>
        {hours.map((m) => (
          <span key={m} className="pointer-events-none absolute inset-y-0 w-px bg-border/70" style={{ left: pct(m) }} aria-hidden />
        ))}
        {nowMinutes !== null && nowMinutes >= win.start && nowMinutes <= win.end && (
          <span className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 bg-destructive/70" style={{ left: pct(nowMinutes) }} aria-hidden />
        )}
        {preview?.row === key && (
          <span
            className="pointer-events-none absolute inset-y-1 z-[2] rounded-md border-2 border-dashed border-brand bg-brand/10"
            style={{ left: pct(preview.start), width: `calc(${pct(preview.end)} - ${pct(preview.start)})` }}
            aria-hidden
          />
        )}
        {row.orders.map((o) => {
          const start = minutesFromDayStart(day, o.pickupAt);
          const end = minutesFromDayStart(day, o.deliveryAt);
          return (
            <Block
              key={o.id}
              order={o}
              overlap={row.overlap.has(o.id)}
              saving={Boolean(overrides[o.id])}
              hidden={activeId === o.id}
              style={{
                left: pct(start),
                width: `max(calc(${pct(end)} - ${pct(start)}), 2.25rem)`,
                top: ROW_PADDING + (row.lanes.get(o.id) ?? 0) * LANE_HEIGHT,
              }}
              onOpen={() => openSheet(o.id)}
            />
          );
        })}
      </Track>
    </div>
  );

  return (
    <>
      <DndContext
        id="dispatch-board"
        sensors={sensors}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => { setActiveId(null); setPreview(null); }}
        accessibility={{
          screenReaderInstructions: { draggable: "Enter キーで詳細パネルを開き、担当ドライバーと時刻を変更できます。マウスではドラッグして配車できます。" },
          announcements: {
            onDragStart: ({ active }) => `${orderLabel(String(active.id))}を移動中`,
            onDragOver: ({ over }) => (over ? `${over.id === UNASSIGNED_ROW ? "未割当" : `${driverName(String(over.id))}さん`}の行` : "配置できる場所の外"),
            onDragEnd: ({ over }) => (over ? `${over.id === UNASSIGNED_ROW ? "未割当" : `${driverName(String(over.id))}さん`}に配置しました` : "移動をやめました"),
            onDragCancel: () => "移動をやめました",
          },
        }}
      >
        <div
          className="overflow-x-auto"
          role="region"
          aria-label="配車ボード（横にスクロールできます）"
          onPointerDownCapture={() => { suppressClick.current = false; }}
        >
          <div className="min-w-[56rem]">
            {/* 時刻の見出し */}
            <div className="sticky top-0 z-20 grid grid-cols-[9.5rem_1fr] border-b bg-muted/60 text-xs text-muted-foreground sm:grid-cols-[12rem_1fr]">
              <div className="sticky left-0 z-10 border-r bg-muted px-3 py-2 font-semibold">ドライバー</div>
              <div className="relative h-8">
                {hours.map((m) => (
                  <span
                    key={m}
                    className={cn(
                      "absolute top-2 whitespace-nowrap tabular",
                      m === win.start ? "pl-1" : m === win.end ? "-translate-x-full pr-1" : "-translate-x-1/2",
                    )}
                    style={{ left: pct(m) }}
                  >
                    {m / 60}時
                  </span>
                ))}
              </div>
            </div>

            {renderRow(UNASSIGNED_ROW, rows.unassigned, (
              <>
                <span className="text-sm font-semibold text-warning-strong">未割当</span>
                <span className="text-xs text-muted-foreground">{rows.unassigned.orders.length}件・ここへ戻すと配車解除</span>
              </>
            ))}

            {drivers.map((d) => {
              const row = rows.drivers.get(d.id)!;
              const minutes = row.orders.reduce(
                (sum, o) => sum + (minutesFromDayStart(day, o.deliveryAt) - minutesFromDayStart(day, o.pickupAt)), 0);
              return renderRow(d.id, row, (
                <>
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <span className="truncate">{d.name}</span>
                    {d.status !== "active" && <Badge variant={d.status === "leave" ? "neutral" : "warning"}>{DRIVER_STATUS_LABEL[d.status]}</Badge>}
                  </span>
                  <span className="truncate text-xs text-muted-foreground tabular">
                    {d.status === "leave" ? "割り当てできません" : `${row.orders.length}件・${(minutes / 60).toFixed(1)}時間${d.vehiclePlate ? `・${d.vehiclePlate}` : ""}`}
                  </span>
                  {row.overlap.size > 0 && (
                    <span className="flex items-center gap-1 text-xs font-medium text-danger-strong">
                      <TriangleAlert className="size-3.5" aria-hidden />時間の重複 {row.overlap.size}件
                    </span>
                  )}
                </>
              ), d.status === "leave");
            })}
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {active && (
            <div className={cn("relative h-[34px] cursor-grabbing rounded-md border px-2 py-1 text-xs shadow-lg", BLOCK_STYLE[active.status])}>
              <BlockContent order={active} />
              {preview && (
                <span className="absolute -top-7 left-0 rounded bg-foreground px-1.5 py-0.5 text-[11px] whitespace-nowrap text-background tabular">
                  {preview.row === UNASSIGNED_ROW ? "未割当に戻す" : `${driverName(preview.row)}・${minutesToHhmm(preview.start)}〜${minutesToHhmm(preview.end)}`}
                </span>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <OrderSheet
        order={selected}
        base={selected ? findServer(selected.id) ?? null : null}
        drivers={drivers}
        onOpenChange={(open) => !open && setSelectedId(null)}
        onAssign={async (input, message) => {
          await commit(input, message);
        }}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && onCancelConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-warning-strong" aria-hidden />
              配送予定が重複しています
            </AlertDialogTitle>
            <AlertDialogDescription>
              {driverName(confirm?.input.driverId ?? null)}さんには同じ時間帯に次の案件があります。順番に回れる場合はこのまま配車できます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="grid gap-1.5 rounded-lg bg-warning-soft p-3 text-sm">
            {confirm?.conflicts.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span className="truncate">{c.orderNo} {c.deliveryName}</span>
                <span className="shrink-0 tabular text-muted-foreground">{c.window}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>配車をやめる</AlertDialogCancel>
            <Button onClick={onConfirm} disabled={confirming}>
              {confirming && <Loader2 className="animate-spin" aria-hidden />}
              重複を承知で配車
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Track({ id, disabled, height, children }: { id: string; disabled: boolean; height: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      data-board-track
      className={cn("relative transition-colors", isOver && "bg-brand/5", disabled && "bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--muted)_6px,var(--muted)_12px)]")}
      style={{ height }}
    >
      {children}
    </div>
  );
}

function BlockContent({ order }: { order: BoardOrder }) {
  return (
    <>
      <span className="flex items-center gap-1 truncate font-medium leading-tight">
        {order.isLate && <AlarmClock className="size-3 shrink-0" aria-label="遅延" />}
        <span className="truncate">{order.deliveryName}</span>
      </span>
      <span className="block truncate text-[11px] leading-tight opacity-80 tabular">
        {formatHm(order.pickupAt)}〜{formatHm(order.deliveryAt)}　{order.orderNo}
      </span>
    </>
  );
}

function formatHm(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function Block({
  order, overlap, saving, hidden, style, onOpen,
}: { order: BoardOrder; overlap: boolean; saving: boolean; hidden: boolean; style: React.CSSProperties; onOpen: () => void }) {
  const draggable = DISPATCHABLE.includes(order.status) && !saving;
  const { setNodeRef, listeners, attributes } = useDraggable({ id: order.id, disabled: !draggable });
  const label = `${order.orderNo} ${order.deliveryName} ${formatHm(order.pickupAt)}〜${formatHm(order.deliveryAt)} ${ORDER_STATUS_LABEL[order.status]}${overlap ? "（時間が重複）" : ""}${order.isLate ? "（遅延）" : ""}`;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      // キーボード・スクリーンリーダーではドラッグせず、クリック（Enter）で開く詳細パネルから担当・時刻を変更する
      aria-roledescription={draggable ? "ドラッグして配車できる案件" : undefined}
      aria-label={label}
      title={label}
      onClick={onOpen}
      className={cn(
        "absolute z-[3] h-[34px] overflow-hidden rounded-md border px-2 py-1 text-left text-xs shadow-xs outline-none transition-[box-shadow,opacity]",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        BLOCK_STYLE[order.status],
        draggable ? "cursor-grab touch-manipulation hover:shadow-md" : "cursor-pointer",
        overlap && "ring-2 ring-danger-strong/70",
        order.status === "delivered" && "opacity-75",
        saving && "animate-pulse",
        hidden && "opacity-30",
      )}
      style={style}
    >
      {overlap && <TriangleAlert className="absolute top-1 right-1 size-3 text-danger-strong" aria-hidden />}
      <BlockContent order={order} />
    </button>
  );
}
