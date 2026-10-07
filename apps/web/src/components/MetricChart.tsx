"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { api } from "@/lib/api";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface Point {
  reportedAt: string;
  metrics: Record<string, number>;
}

/**
 * Telemetry chart (ECharts). Loads the device's history from the api, then
 * appends live points pushed over the socket. One series per metric.
 */
export function MetricChart({
  deviceId,
  live,
}: {
  deviceId: string | null;
  live?: Record<string, number>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const points = useRef<Point[]>([]);

  // init / dispose with the container
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current);
    chart.current = c;
    const onResize = () => c.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      c.dispose();
      chart.current = null;
    };
  }, []);

  // (re)load history when the selected device changes
  useEffect(() => {
    points.current = [];
    if (!deviceId) {
      chart.current?.clear();
      return;
    }
    let cancelled = false;
    void api<Point[]>(`/telemetry/devices/${deviceId}?take=2000`).then((rows) => {
      if (cancelled) return;
      points.current = rows;
      render();
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  // append a live point when new data arrives for this device
  useEffect(() => {
    if (!deviceId || !live || Object.keys(live).length === 0) return;
    const last = points.current[points.current.length - 1];
    if (last && JSON.stringify(last.metrics) === JSON.stringify(live)) return;
    points.current = [
      ...points.current,
      { reportedAt: new Date().toISOString(), metrics: live },
    ].slice(-2000);
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, deviceId]);

  function render() {
    const c = chart.current;
    if (!c) return;
    const metricKeys = Array.from(
      new Set(points.current.flatMap((p) => Object.keys(p.metrics))),
    );
    const xAxis = points.current.map((p) => p.reportedAt);
    c.setOption({
      backgroundColor: "transparent",
      textStyle: { color: "#d7e0ea" },
      tooltip: { trigger: "axis" },
      legend: { data: metricKeys, textStyle: { color: "#7d8da0" } },
      grid: { left: 48, right: 16, top: 32, bottom: 28 },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: "#1e2a3a" } },
        axisLabel: { color: "#7d8da0" },
      },
      yAxis: {
        type: "value",
        scale: true,
        splitLine: { lineStyle: { color: "#1e2a3a" } },
        axisLabel: { color: "#7d8da0" },
      },
      series: metricKeys.map((key, i) => ({
        name: key,
        type: "line",
        showSymbol: false,
        smooth: true,
        data: points.current
          .filter((p) => p.metrics[key] !== undefined)
          .map((p) => [p.reportedAt, p.metrics[key]]),
        lineStyle: { width: 2 },
      })),
    });
  }

  if (!deviceId) {
    return <div className="muted">Select a device to see its telemetry.</div>;
  }
  return <div ref={ref} className="chart" />;
}
