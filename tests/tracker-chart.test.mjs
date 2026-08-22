import assert from "node:assert/strict";
import test from "node:test";
import { chartPointIndexAtX, chartPointX, chartTooltipPosition } from "../lib/tracker-chart.ts";

test("chart inspection uses the full plot width and selects the nearest point", () => {
  assert.equal(chartPointIndexAtX(10, 0, 10, 210, 5), 0);
  assert.equal(chartPointIndexAtX(59, 0, 10, 210, 5), 1);
  assert.equal(chartPointIndexAtX(160, 0, 10, 210, 5), 3);
  assert.equal(chartPointIndexAtX(-100, 0, 10, 210, 5), 0);
  assert.equal(chartPointIndexAtX(999, 0, 10, 210, 5), 4);
  assert.equal(chartPointIndexAtX(500, 0, 10, 210, 1), 0);
  assert.equal(chartPointIndexAtX(1, 0, 10, 10, 2), null);
  assert.equal(chartPointX(2, 10, 210, 5), 110);
});

test("chart tooltip is clamped inside the plot container", () => {
  assert.deepEqual(chartTooltipPosition(0, 0, 320, 235), { left: 92, top: 14 });
  assert.deepEqual(chartTooltipPosition(320, 235, 320, 235), { left: 228, top: 167 });
  assert.deepEqual(chartTooltipPosition(80, 120, 150, 100), { left: 75, top: 32 });
});
