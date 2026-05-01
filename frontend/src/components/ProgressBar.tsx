export default function ProgressBar({
  pct,
  shimmer = true,
  indeterminate = false,
}: {
  pct?: number;
  shimmer?: boolean;
  indeterminate?: boolean;
}) {
  if (indeterminate) {
    return (
      <div className="relative w-full h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: "var(--brand-tint)" }}>
        <div className="animate-indeterminate" style={{ backgroundColor: "var(--brand)", width: "45%" }} />
      </div>
    );
  }

  const clamped = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <div className="relative w-full h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: "var(--brand-tint)" }}>
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
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
