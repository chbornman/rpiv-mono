import type { Component } from "@mariozechner/pi-tui";

/**
 * Wraps a child Component and forces its rendered output to exactly
 * `max(0, getHeight(width))` lines per `render(width)` call. Pads short
 * output with empty strings (`""`); truncates long output from the start
 * (top-of-content anchored).
 *
 * Width-safety pass-through: child is responsible for `visibleWidth(line) <= width`.
 * `handleInput` is intentionally a no-op — input is not routed through this wrapper.
 */
export class FixedHeightBox implements Component {
	constructor(
		private readonly child: Component,
		private readonly getHeight: (width: number) => number,
	) {}

	handleInput(_data: string): void {}

	invalidate(): void {
		this.child.invalidate();
	}

	render(width: number): string[] {
		const target = Math.max(0, this.getHeight(width));
		if (target === 0) return [];
		const raw = this.child.render(width);
		const trimmed = raw.length > target ? raw.slice(0, target) : raw.slice();
		while (trimmed.length < target) trimmed.push("");
		return trimmed;
	}
}
