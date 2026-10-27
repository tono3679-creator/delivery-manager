import {
  CircleDashed, CircleCheckBig, Truck, PackageCheck, UserCheck, CircleX, Ban, AlarmClock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/domain/status";
import { cn } from "@/lib/utils";

const STYLE: Record<OrderStatus, { variant: "neutral" | "info" | "success" | "warning" | "danger"; Icon: typeof Truck }> = {
  unassigned: { variant: "warning", Icon: CircleDashed },
  assigned: { variant: "info", Icon: UserCheck },
  picked_up: { variant: "info", Icon: PackageCheck },
  in_transit: { variant: "warning", Icon: Truck },
  delivered: { variant: "success", Icon: CircleCheckBig },
  failed: { variant: "danger", Icon: CircleX },
  cancelled: { variant: "neutral", Icon: Ban },
};

/** 配送ステータス。色・アイコン・文字の3つで区別する */
export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const { variant, Icon } = STYLE[status];
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden />
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}

export function LateBadge({ className }: { className?: string }) {
  return (
    <Badge variant="danger" className={cn("font-semibold", className)}>
      <AlarmClock aria-hidden />
      遅延
    </Badge>
  );
}
