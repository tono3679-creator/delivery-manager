import { cn } from "@/lib/utils";

/** 各画面の見出しと主要な操作ボタン */
export function PageHeader({
  title, description, actions, className,
}: { title: string; description?: string; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-keep text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="text-keep mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
