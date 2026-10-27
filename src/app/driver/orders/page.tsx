import { Hammer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";

export const metadata = { title: "本日の配送" };

export default function Page() {
  return (
    <Card className="mt-2">
      <EmptyState icon={Hammer} title="本日の配送：Phase 2 で実装します" />
    </Card>
  );
}
