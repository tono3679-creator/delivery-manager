import { Hammer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";

export const metadata = { title: "配車管理" };

export default function Page() {
  return (
    <div className="space-y-5">
      <PageHeader title="配車管理" />
      <Card>
        <EmptyState icon={Hammer} title="この画面は Phase 2 で実装します" description="データベースと権限設定は準備済みです。" />
      </Card>
    </div>
  );
}
