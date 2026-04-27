import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export interface ColumnConfig {
	ratio: number;
	component: Component;
}

export class Columns implements Component {
	private readonly configs: readonly ColumnConfig[];
	private readonly gap: number;

	constructor(configs: readonly ColumnConfig[], gap: number = 2) {
		this.configs = configs;
		this.gap = Math.max(0, gap);
	}

	handleInput(_data: string): void {}

	invalidate(): void {
		for (const c of this.configs) c.component.invalidate();
	}

	render(width: number): string[] {
		if (this.configs.length === 0 || width <= 0) return [];

		const widths = this.allocateWidths(width);
		const rendered = this.configs.map((c, i) => c.component.render(widths[i] ?? 0));
		const maxHeight = rendered.reduce((m, lines) => Math.max(m, lines.length), 0);
		if (maxHeight === 0) return [];

		const gapStr = " ".repeat(this.gap);
		const output: string[] = [];
		for (let row = 0; row < maxHeight; row++) {
			const parts: string[] = [];
			for (let col = 0; col < this.configs.length; col++) {
				const colWidth = widths[col] ?? 0;
				const rawLine = rendered[col]?.[row] ?? "";
				const clamped = truncateToWidth(rawLine, colWidth, "");
				const pad = Math.max(0, colWidth - visibleWidth(clamped));
				parts.push(clamped + " ".repeat(pad));
			}
			const joined = parts.join(gapStr);
			output.push(truncateToWidth(joined, width, ""));
		}
		return output;
	}

	private allocateWidths(width: number): number[] {
		const totalRatio = this.configs.reduce((s, c) => s + Math.max(0, c.ratio), 0);
		const gapTotal = this.gap * Math.max(0, this.configs.length - 1);
		const available = Math.max(0, width - gapTotal);

		if (totalRatio <= 0) {
			const even = Math.floor(available / this.configs.length);
			const widths = this.configs.map(() => even);
			widths[widths.length - 1] += available - even * this.configs.length;
			return widths;
		}

		const widths: number[] = [];
		let allocated = 0;
		for (let i = 0; i < this.configs.length - 1; i++) {
			const share = Math.floor((available * Math.max(0, this.configs[i].ratio)) / totalRatio);
			widths.push(share);
			allocated += share;
		}
		widths.push(Math.max(0, available - allocated));
		return widths;
	}
}
