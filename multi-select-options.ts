import type { Theme } from "@mariozechner/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { DialogState } from "./dialog-builder.js";
import type { QuestionData } from "./types.js";

const ACTIVE_POINTER = "❯ ";
const INACTIVE_POINTER = "  ";
const CHECKED = "☑";
const UNCHECKED = "☐";

/**
 * Renders the multi-select option list (one row per option — pointer + checkbox + label —
 * plus zero or more wrapped continuation lines per description).
 *
 * `naturalHeight(width)` is state-INDEPENDENT (depends only on theme glyph widths,
 * question.options, and width) so the host can compute a stable globalContentHeight
 * without rendering. `naturalHeight(w) === render(w).length` for every state.
 *
 * `setState(state)` is a pure field reassignment — no render, no invalidate side effects.
 */
export class MultiSelectOptions implements Component {
	private state: DialogState;

	constructor(
		private readonly theme: Theme,
		private readonly question: QuestionData,
		initialState: DialogState,
	) {
		this.state = initialState;
	}

	setState(state: DialogState): void {
		this.state = state;
	}

	handleInput(_data: string): void {}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		const prefixWidth = this.prefixVisibleWidth();
		const contentWidth = Math.max(1, width - prefixWidth);
		for (let i = 0; i < this.question.options.length; i++) {
			const opt = this.question.options[i];
			if (!opt) continue;
			const checked = this.state.multiSelectChecked.has(i);
			const active = i === this.state.optionIndex;
			const pointer = active ? ACTIVE_POINTER : INACTIVE_POINTER;
			const box = checked ? this.theme.fg("success", CHECKED) : this.theme.fg("muted", UNCHECKED);
			const label = truncateToWidth(opt.label, contentWidth, "…");
			const styledLabel = active ? this.theme.fg("accent", this.theme.bold(label)) : label;
			lines.push(truncateToWidth(`${pointer}${box} ${styledLabel}`, width, ""));
			if (opt.description) {
				const continuationPrefix = " ".repeat(prefixWidth);
				const wrapped = wrapTextWithAnsi(opt.description, contentWidth);
				for (const segment of wrapped) {
					lines.push(continuationPrefix + this.theme.fg("muted", segment));
				}
			}
		}
		return lines;
	}

	naturalHeight(width: number): number {
		const contentWidth = Math.max(1, width - this.prefixVisibleWidth());
		let total = 0;
		for (const opt of this.question.options) {
			if (!opt) continue;
			total += 1; // row line
			if (opt.description) {
				total += wrapTextWithAnsi(opt.description, contentWidth).length;
			}
		}
		return total;
	}

	private prefixVisibleWidth(): number {
		// Canonical prefix uses INACTIVE_POINTER + UNCHECKED so the width is state-independent.
		// ACTIVE_POINTER and INACTIVE_POINTER share visibleWidth; CHECKED and UNCHECKED share visibleWidth.
		return visibleWidth(`${INACTIVE_POINTER}${UNCHECKED} `);
	}
}
