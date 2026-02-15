export interface DrawdownPoint {
  timestamp: string;
  drawdownPct: number;
  equity: number;
  peak: number;
}

export function computeDrawdownSeries(
  equityPoints: { timestamp: string; equity: string }[]
): DrawdownPoint[] {
  let peak = 0;
  return equityPoints.map((point) => {
    const equity = parseFloat(point.equity) || 0;
    peak = Math.max(peak, equity);
    const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    return {
      timestamp: point.timestamp,
      drawdownPct: -drawdownPct, // negative for display (underwater)
      equity,
      peak,
    };
  });
}
