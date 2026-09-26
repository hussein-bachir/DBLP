import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import type { EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

// Register only what the profile charts use, so the bundle doesn't carry all of ECharts.
echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  option: EChartsCoreOption;
  height: number;
  ariaLabel: string;
}

/** Owns one ECharts instance: created on mount, updated when `option` changes, resized with its box. */
export function EChart({ option, height, ariaLabel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const instance = echarts.init(element);
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={box} role="img" aria-label={ariaLabel} className="chart" style={{ height }} />;
}
