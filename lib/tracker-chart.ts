export function chartPointIndexAtX(
  clientX: number,
  rectLeft: number,
  plotLeft: number,
  plotRight: number,
  pointCount: number,
) {
  if (!Number.isFinite(clientX) || !Number.isFinite(rectLeft) || pointCount < 1 || plotRight <= plotLeft) return null;
  if (pointCount === 1) return 0;
  const ratio = (clientX - rectLeft - plotLeft) / (plotRight - plotLeft);
  return Math.max(0, Math.min(pointCount - 1, Math.round(ratio * (pointCount - 1))));
}

export function chartPointX(index: number, plotLeft: number, plotRight: number, pointCount: number) {
  if (pointCount <= 1) return (plotLeft + plotRight) / 2;
  return plotLeft + ((plotRight - plotLeft) * index) / (pointCount - 1);
}

export function chartTooltipPosition(pointX: number, pointY: number, width: number, height: number) {
  const horizontalInset = Math.min(92, Math.max(22, width / 2));
  return {
    left: Math.max(horizontalInset, Math.min(width - horizontalInset, pointX)),
    top: Math.max(10, Math.min(height - 68, pointY < 72 ? pointY + 14 : pointY - 62)),
  };
}
