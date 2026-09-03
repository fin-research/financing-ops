import * as echarts from 'echarts/core';
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts';
import {
	AriaComponent,
	GridComponent,
	LegendComponent,
	MarkPointComponent,
	TitleComponent,
	TooltipComponent
} from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
	AriaComponent,
	BarChart,
	GaugeChart,
	GridComponent,
	LabelLayout,
	LegendComponent,
	LineChart,
	MarkPointComponent,
	PieChart,
	SVGRenderer,
	TitleComponent,
	TooltipComponent
]);

type ChartInstance = ReturnType<typeof echarts.init>;
export type ChartOption = EChartsCoreOption;

const instances = new Map<HTMLElement, ChartInstance>();
let resizeObserver: ResizeObserver | null = null;

function observer() {
	if (resizeObserver) return resizeObserver;
	if (typeof ResizeObserver === 'undefined') return null;
	resizeObserver = new ResizeObserver((entries) => {
		for (const entry of entries) instances.get(entry.target as HTMLElement)?.resize();
	});
	return resizeObserver;
}

export function setChart(host: HTMLElement, option: ChartOption) {
	let chart = instances.get(host);
	if (!chart) {
		chart = echarts.init(host, undefined, { renderer: 'svg' });
		instances.set(host, chart);
		observer()?.observe(host);
	}
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	chart.setOption({
		...option,
		backgroundColor: 'transparent',
		animation: !reduceMotion,
		animationDuration: reduceMotion ? 0 : 260,
		animationDurationUpdate: reduceMotion ? 0 : 180,
		animationEasing: 'cubicOut'
	}, { notMerge: true });
}

export function disposeChart(host: HTMLElement) {
	const chart = instances.get(host);
	if (!chart) return;
	resizeObserver?.unobserve(host);
	chart.dispose();
	instances.delete(host);
}
