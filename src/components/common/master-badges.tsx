import { CalendarClock, CircleCheck, CircleMinus, CirclePause, Coffee, Wrench, CircleOff, Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DRIVER_STATUS_LABEL, VEHICLE_STATUS_LABEL, type DriverStatus, type VehicleStatus } from "@/lib/domain/labels";
import { formatDaysLeft } from "@/lib/format";
import { DEADLINE_WARNING_DAYS } from "@/lib/domain/deadline";

type Variant = "neutral" | "info" | "success" | "warning" | "danger";

const DRIVER: Record<DriverStatus, { variant: Variant; Icon: typeof CircleCheck }> = {
  active: { variant: "success", Icon: CircleCheck },
  day_off: { variant: "info", Icon: Coffee },
  leave: { variant: "warning", Icon: CirclePause },
  retired: { variant: "neutral", Icon: CircleMinus },
};

const VEHICLE: Record<VehicleStatus, { variant: Variant; Icon: typeof CircleCheck }> = {
  active: { variant: "success", Icon: CircleCheck },
  standby: { variant: "info", Icon: Archive },
  maintenance: { variant: "warning", Icon: Wrench },
  retired: { variant: "neutral", Icon: CircleOff },
};

/** ドライバーの在籍状況（色・アイコン・文字で区別） */
export function DriverStatusBadge({ status }: { status: DriverStatus }) {
  const { variant, Icon } = DRIVER[status];
  return <Badge variant={variant}><Icon aria-hidden />{DRIVER_STATUS_LABEL[status]}</Badge>;
}

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const { variant, Icon } = VEHICLE[status];
  return <Badge variant={variant}><Icon aria-hidden />{VEHICLE_STATUS_LABEL[status]}</Badge>;
}

/** 車検・保険の期限。30日以内は注意、過ぎていたら警告として表示する */
export function DeadlineBadge({ days }: { days: number }) {
  if (days > DEADLINE_WARNING_DAYS) return null;
  return (
    <Badge variant={days < 0 ? "danger" : "warning"}>
      <CalendarClock aria-hidden />
      {formatDaysLeft(days)}
    </Badge>
  );
}
