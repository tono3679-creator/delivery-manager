"use client";
import { ErrorPanel } from "@/components/common/error-panel";

export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} contact="システムの管理者にお問い合わせください" />;
}
