"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, isDateString } from "@/lib/date";
import { formatDateLong } from "@/lib/format";

/** 表示日の切り替え（前日・翌日・今日・日付指定） */
export function DayNav({ day, today, basePath = "/dispatch" }: { day: string; today: string; basePath?: string }) {
  const router = useRouter();
  const href = (d: string) => (d === today ? basePath : `${basePath}?date=${d}`);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center">
        <Button asChild variant="outline" size="icon" className="rounded-r-none" aria-label="前の日">
          <Link href={href(addDays(day, -1))}><ChevronLeft aria-hidden /></Link>
        </Button>
        <Button asChild variant="outline" size="icon" className="-ml-px rounded-l-none" aria-label="次の日">
          <Link href={href(addDays(day, 1))}><ChevronRight aria-hidden /></Link>
        </Button>
      </div>
      <Button asChild variant={day === today ? "secondary" : "outline"}>
        <Link href={href(today)} aria-current={day === today ? "date" : undefined}>今日</Link>
      </Button>
      <Input
        type="date"
        aria-label="表示する日付"
        className="w-40"
        value={day}
        onChange={(e) => isDateString(e.target.value) && router.push(href(e.target.value))}
      />
      <span className="text-sm font-medium tabular">{formatDateLong(day)}</span>
    </div>
  );
}
