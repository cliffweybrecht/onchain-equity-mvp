export function vestedLinearWithCliff({ total, start, cliff, end, t }) {
  if (t < cliff) return 0n;
  if (t >= end) return total;

  const duration = end - start;
  if (duration <= 0n) throw new Error("Invalid duration: end must be > start");

  const elapsed = t - start;
  if (elapsed <= 0n) return 0n;

  return (total * elapsed) / duration;
}

export function clamp0(x) {
  return x < 0n ? 0n : x;
}
