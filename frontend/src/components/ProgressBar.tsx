export default function ProgressBar({ pct, shimmer = true }: { pct: number; shimmer?: boolean }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="relative w-full h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: "var(--brand-tint)" }}>
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-width"
        style={{ width: `${clamped}%`, backgroundColor: "var(--brand)" }}
      >
        {shimmer && clamped < 100 && (
          <span className="absolute inset-0 overflow-hidden rounded-full">
            <span className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer" />
          </span>
        )}
      </div>
    </div>
  );
}
