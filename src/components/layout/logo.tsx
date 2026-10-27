import { Route } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className, inverted = false, tagline = true }: { className?: string; inverted?: boolean; tagline?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className={cn("flex size-8 items-center justify-center rounded-lg", inverted ? "bg-brand text-white" : "bg-primary text-primary-foreground")}>
        <Route className="size-4.5" aria-hidden />
      </div>
      <div className="leading-tight">
        <div className={cn("text-[15px] font-bold tracking-tight", inverted ? "text-white" : "text-foreground")}>Delivery Manager</div>
        {tagline && (
          <div className={cn("text-[10px]", inverted ? "text-sidebar-muted" : "text-muted-foreground")}>配送業務のすべてを、ひとつの画面で。</div>
        )}
      </div>
    </div>
  );
}
