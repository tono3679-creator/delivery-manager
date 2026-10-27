"use client";
import { ErrorPanel } from "@/components/common/error-panel";

export default function DriverError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} contact="配車担当に連絡してください" className="mt-4" />;
}
