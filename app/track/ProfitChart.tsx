"use client";

import { useEffect, useRef } from "react";

type ChartPoint = { date: string; value: number };

export function ProfitChart({ points, label }: { points: ChartPoint[]; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      const left = 10;
      const right = rect.width - 10;
      const top = 16;
      const bottom = rect.height - 18;
      context.lineWidth = 1;
      context.strokeStyle = "#252b28";
      for (let row = 0; row <= 4; row += 1) {
        const y = top + ((bottom - top) * row) / 4;
        context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
      }
      if (!points.length) return;

      const values = points.map((point) => point.value);
      let min = Math.min(0, ...values);
      let max = Math.max(0, ...values);
      if (min === max) { min -= 100; max += 100; }
      const range = max - min;
      const x = (index: number) => points.length === 1 ? (left + right) / 2 : left + ((right - left) * index) / (points.length - 1);
      const y = (value: number) => top + ((max - value) / range) * (bottom - top);
      const zeroY = y(0);
      context.strokeStyle = "#3e4943";
      context.beginPath(); context.moveTo(left, zeroY); context.lineTo(right, zeroY); context.stroke();

      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(x(index), y(point.value)) : context.moveTo(x(index), y(point.value)));
      context.lineTo(x(points.length - 1), zeroY);
      context.lineTo(x(0), zeroY);
      context.closePath();
      context.fillStyle = "rgba(166, 215, 170, .055)";
      context.fill();

      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(x(index), y(point.value)) : context.moveTo(x(index), y(point.value)));
      context.strokeStyle = "#a6d7aa";
      context.lineWidth = 2;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();
      const last = points.at(-1)!;
      context.beginPath(); context.arc(x(points.length - 1), y(last.value), 3.5, 0, Math.PI * 2);
      context.fillStyle = "#b9e5b8"; context.fill();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [points]);

  return <canvas ref={canvasRef} className="track-profit-canvas" role="img" aria-label={label} />;
}
