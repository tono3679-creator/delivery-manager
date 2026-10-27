"use client";
import { useId, useState } from "react";
import { ChevronDown, Map as MapIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MapPanel } from "@/components/map/map-panel";
import type { MapOrder } from "@/lib/data/map";
import { cn } from "@/lib/utils";

/** ドライバーの「本日の配送」の地図。開いたときだけ地図を読み込む（通信量を抑える） */
export function DriverDayMap({ orders, day }: { orders: MapOrder[]; day: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (orders.length === 0) return null;
  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="flex items-center gap-2">
          <MapIcon className="size-4 text-brand" aria-hidden />
          配送先を地図で見る（{orders.length}件）
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div id={panelId} className="border-t p-3">
          <MapPanel orders={orders} fitKey={day} mapClassName="h-72" label="本日の配送先の地図" detailPath="/driver/orders" />
        </div>
      )}
    </Card>
  );
}
