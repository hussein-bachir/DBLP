import { BarChart, GraphChart, LineChart, PieChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

// Register only what the charts use, so the bundle doesn't carry all of ECharts.
echarts.use([BarChart, LineChart, PieChart, GraphChart, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export type ChartInstance = echarts.ECharts;

interface Props {
  option: EChartsCoreOption;
  height: number;
  ariaLabel: string;
  /**
   * true (default): each new option replaces the old one. false: merge into it, which is
   * what a force graph needs so an update doesn't throw the layout away.
   */
  replace?: boolean;
  /** Called once with the live ECharts instance (and with null when it is disposed). */
  onChart?: (chart: ChartInstance | null) => void;
}

/** Owns one ECharts instance: created on mount, updated when `option` changes, resized with its box. */
export function EChart({ option, height, ariaLabel, replace = true, onChart }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ChartInstance | null>(null);
  const onChartRef = useRef(onChart);

  useEffect(() => {
    onChartRef.current = onChart;
  });

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const instance = echarts.init(element);
    chart.current = instance;
    onChartRef.current?.(instance);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
      onChartRef.current?.(null);
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, replace);
  }, [option, replace]);

  return <div ref={box} role="img" aria-label={ariaLabel} className="chart" style={{ height }} />;
}
