export type TouchGestureIntent = "pending" | "scrub" | "scroll";

export function touchGestureIntent(deltaX: number, deltaY: number, threshold = 6): TouchGestureIntent {
  const horizontal = Math.abs(deltaX);
  const vertical = Math.abs(deltaY);
  if (Math.max(horizontal, vertical) < threshold) return "pending";
  return horizontal >= vertical ? "scrub" : "scroll";
}

export function clampPointerX(clientX: number, left: number, width: number): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return 0;
  return Math.max(0, Math.min(width, clientX - left));
}
