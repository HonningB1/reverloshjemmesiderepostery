"use client";

import { useEffect, useRef, useState } from "react";
import { chartPointIndexAtX, chartPointX, chartTooltipPosition } from "../../lib/tracker-chart";
import { useTrackerI18n } from "./i18n";

type ChartPoint = { date: string; value: number };
type ChartLayout = { width: number; height: number; left: number; right: number; top: number; bottom: number };

export function ProfitChart({ points, label }: { points: ChartPoint[]; label: string }) {
  const { money, date } = useTrackerI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<ChartLayout | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activePoint = activeIndex === null ? null : points[activeIndex] ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const context = canvas.getContext("2d");
      if (!context) return;
      const nextLayout = { width: rect.width, height: rect.height, left: 10, right: rect.width - 10, top: 16, bottom: rect.height - 18 };
      setLayout((current) => current && Object.entries(current).every(([key, value]) => value === nextLayout[key as keyof ChartLayout]) ? current : nextLayout);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      context.lineWidth = 1;
      context.strokeStyle = "#252b28";
      for (let row = 0; row <= 4; row += 1) {
        const y = nextLayout.top + ((nextLayout.bottom - nextLayout.top) * row) / 4;
        context.beginPath(); context.moveTo(nextLayout.left, y); context.lineTo(nextLayout.right, y); context.stroke();
      }
      if (!points.length) return;

      const values = points.map((point) => point.value);
      let min = Math.min(0, ...values); let max = Math.max(0, ...values);
      if (min === max) { min -= 100; max += 100; }
      const range = max - min;
      const x = (index: number) => chartPointX(index, nextLayout.left, nextLayout.right, points.length);
      const y = (value: number) => nextLayout.top + ((max - value) / range) * (nextLayout.bottom - nextLayout.top);
      const zeroY = y(0);
      context.strokeStyle = "#3e4943";
      context.beginPath(); context.moveTo(nextLayout.left, zeroY); context.lineTo(nextLayout.right, zeroY); context.stroke();

      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(x(index), y(point.value)) : context.moveTo(x(index), y(point.value)));
      context.lineTo(x(points.length - 1), zeroY); context.lineTo(x(0), zeroY); context.closePath();
      context.fillStyle = "rgba(166, 215, 170, .055)"; context.fill();

      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(x(index), y(point.value)) : context.moveTo(x(index), y(point.value)));
      context.strokeStyle = "#a6d7aa"; context.lineWidth = 2; context.lineJoin = "round"; context.lineCap = "round"; context.stroke();

      const selectedIndex = activeIndex === null || activeIndex >= points.length ? points.length - 1 : activeIndex;
      const selected = points[selectedIndex]; const selectedX = x(selectedIndex); const selectedY = y(selected.value);
      if (activeIndex !== null) {
        context.strokeStyle = "rgba(185, 229, 184, .42)"; context.setLineDash([3, 4]); context.lineWidth = 1;
        context.beginPath(); context.moveTo(selectedX, nextLayout.top); context.lineTo(selectedX, nextLayout.bottom); context.stroke(); context.setLineDash([]);
      }
      context.beginPath(); context.arc(selectedX, selectedY, activeIndex === null ? 3.5 : 4.5, 0, Math.PI * 2);
      context.fillStyle = "#b9e5b8"; context.fill();
      if (activeIndex !== null) {
        context.beginPath(); context.arc(selectedX, selectedY, 7, 0, Math.PI * 2); context.strokeStyle = "rgba(185, 229, 184, .34)"; context.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [activeIndex, points]);

  function activate(clientX: number) {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const rect = canvas.getBoundingClientRect();
    setActiveIndex(chartPointIndexAtX(clientX, rect.left, layout.left, layout.right, points.length));
  }

  const tooltip = activePoint && layout && activeIndex !== null ? (() => {
    const values = points.map((point) => point.value); let min = Math.min(0, ...values); let max = Math.max(0, ...values);
    if (min === max) { min -= 100; max += 100; }
    const pointX = chartPointX(activeIndex, layout.left, layout.right, points.length);
    const pointY = layout.top + ((max - activePoint.value) / (max - min)) * (layout.bottom - layout.top);
    return chartTooltipPosition(pointX, pointY, layout.width, layout.height);
  })() : null;

  return <div className="track-profit-chart">
    <canvas ref={canvasRef} className="track-profit-canvas" role="img" tabIndex={0} aria-label={label}
      onPointerMove={(event) => activate(event.clientX)}
      onPointerDown={(event) => { activate(event.clientX); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setActiveIndex(null); }}
      onKeyDown={(event) => {
        if (!points.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); const current = activeIndex ?? points.length - 1;
        if (event.key === "Home") setActiveIndex(0);
        else if (event.key === "End") setActiveIndex(points.length - 1);
        else setActiveIndex(Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1))));
      }} />
    {tooltip && activePoint ? <div className="track-chart-tooltip" style={{ left: tooltip.left, top: tooltip.top }} aria-hidden="true">
      <span>{date(activePoint.date)}</span><strong>{money(activePoint.value)}</strong><small>{label}</small>
    </div> : null}
  </div>;
}
