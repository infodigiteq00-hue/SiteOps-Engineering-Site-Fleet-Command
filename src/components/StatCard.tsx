import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  accent?: "blue" | "cyan" | "teal" | "green" | "orange";
}

const accents: Record<NonNullable<Props["accent"]>, { card: string; iconWrap: string; icon: string }> = {
  blue: {
    card: "border-blue-500/20 bg-gradient-to-br from-blue-500 to-blue-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
  cyan: {
    card: "border-cyan-500/20 bg-gradient-to-br from-cyan-500 to-sky-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
  teal: {
    card: "border-teal-500/20 bg-gradient-to-br from-teal-500 to-cyan-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
  orange: {
    card: "border-orange-500/20 bg-gradient-to-br from-orange-500 to-amber-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
  green: {
    card: "border-emerald-500/20 bg-gradient-to-br from-emerald-500 to-green-600 text-white",
    iconWrap: "bg-white/15 ring-1 ring-white/20",
    icon: "text-white",
  },
};

export const StatCard = ({ label, value, icon: Icon, trend, accent = "blue" }: Props) => {
  const style = accents[accent];

  return (
    <div className={cn("group relative overflow-hidden rounded-2xl border p-5 shadow-elevated transition-all hover:-translate-y-0.5", style.card)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.22),transparent_45%)]" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-white/85">{label}</div>
          <div className="mt-1.5 font-display text-4xl font-bold leading-none tabular-nums text-white">{value}</div>
          {trend && <div className="mt-2 text-xs font-medium text-white/85">{trend}</div>}
        </div>
        <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-white/10" />
          <div className="absolute inset-2.5 rounded-full bg-white/12" />
          <div className={cn("relative flex h-12 w-12 items-center justify-center rounded-full", style.iconWrap)}>
            <div className="absolute inset-1 rounded-full bg-white/10 blur-sm" />
            <Icon className={cn("relative z-10 h-5 w-5", style.icon)} />
          </div>
        </div>
      </div>
    </div>
  );
};
