"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALL = "__all";

/** 地図の絞り込み（ドライバー・未割当）。条件は URL に保存する */
export function MapDriverFilter({ value, drivers }: { value: string; drivers: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const onChange = (v: string) => {
    const q = new URLSearchParams(params.toString());
    if (v === ALL) q.delete("driver");
    else q.set("driver", v);
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="map-driver" className="text-sm text-muted-foreground">表示する案件</label>
      <Select value={value || ALL} onValueChange={onChange}>
        <SelectTrigger id="map-driver" className="w-full sm:w-56"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>すべてのドライバー</SelectItem>
          <SelectItem value="unassigned">未割当の案件</SelectItem>
          {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
