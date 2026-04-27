import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Markdown, type MarkdownTheme, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Columns } from "./columns.js";
import type { QuestionData } from "./types.js";
import { WrappingSelect, type WrappingSelectItem, type WrappingSelectTheme } from "./wrapping-select.js";

export const PREVIEW_MIN_WIDTH = 100;
export const MAX_PREVIEW_HEIGHT = 15;
export const NO_PREVIEW_TEXT = "No preview available";
export const MAX_VISIBLE_OPTIONS = 10;

export interface PreviewPaneConfig {
	items: readonly WrappingSelectItem[];
	question: QuestionData;
	theme: Theme;
	markdownTheme: MarkdownTheme;
	getTerminalWidth: () => number;
}

function oneLine(s: string): string {
	return s.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

export class PreviewPane implements Component {
	private readonly question: QuestionData;
	private readonly theme: Theme;
	private readonly markdownTheme: MarkdownTheme;
	private readonly getTerminalWidth: () => number;
	private readonly options: WrappingSelect;
	private readonly previewTexts: Map<number, string>;
	private readonly markdownCache: Map<number, Markdown>;
	private cachedWidth: number | undefined;
	private selectedIndex = 0;

	constructor(config: PreviewPaneConfig) {
		this.question = config.question;
		this.theme = config.theme;
		this.markdownTheme = config.markdownTheme;
		this.getTerminalWidth = config.getTerminalWidth;

		const selectTheme: WrappingSelectTheme = {
			selectedText: (t) => this.theme.fg("accent", this.theme.bold(t)),
			description: (t) => this.theme.fg("muted", t),
			scrollInfo: (t) => this.theme.fg("dim", t),
		};
		this.options = new WrappingSelect(config.items, Math.min(config.items.length, MAX_VISIBLE_OPTIONS), selectTheme);

		this.previewTexts = new Map();
		for (let i = 0; i < config.question.options.length; i++) {
			const raw = config.question.options[i]?.preview;
			if (raw && raw.length > 0) this.previewTexts.set(i, oneLine(raw));
		}
		this.markdownCache = new Map();
	}

	setSelectedIndex(index: number): void {
		this.selectedIndex = index;
		this.options.setSelectedIndex(index);
	}

	setFocused(focused: boolean): void {
		this.options.setFocused(focused);
	}

	invalidateCache(): void {
		for (const md of this.markdownCache.values()) md.invalidate();
		this.cachedWidth = undefined;
	}

	getInputBuffer(): string {
		return this.options.getInputBuffer();
	}

	appendInput(text: string): void {
		this.options.appendInput(text);
	}

	backspaceInput(): void {
		this.options.backspaceInput();
	}

	clearInputBuffer(): void {
		this.options.clearInputBuffer();
	}

	handleInput(_data: string): void {}

	invalidate(): void {
		this.invalidateCache();
		this.options.invalidate();
	}

	render(width: number): string[] {
		if (this.question.multiSelect === true) {
			return this.options.render(width);
		}

		const sideBySide = this.getTerminalWidth() >= PREVIEW_MIN_WIDTH && width >= PREVIEW_MIN_WIDTH;

		if (sideBySide) {
			const preview: Component = {
				render: (w) => this.renderPreviewLines(w),
				handleInput: () => {},
				invalidate: () => this.invalidateCache(),
			};
			const cols = new Columns(
				[
					{ ratio: 3, component: this.options },
					{ ratio: 2, component: preview },
				],
				2,
			);
			return cols.render(width);
		}

		return [...this.options.render(width), ...this.renderPreviewLines(width)];
	}

	private renderPreviewLines(width: number): string[] {
		if (this.cachedWidth !== width) {
			for (const md of this.markdownCache.values()) md.invalidate();
			this.cachedWidth = width;
		}

		const raw: string[] = this.computePreviewBody(width);
		const clamped = raw.map((line) => truncateToWidth(line, width, ""));
		const trimmed = clamped.length > MAX_PREVIEW_HEIGHT ? clamped.slice(0, MAX_PREVIEW_HEIGHT) : clamped;
		while (trimmed.length < MAX_PREVIEW_HEIGHT) trimmed.push("");
		return trimmed;
	}

	private computePreviewBody(width: number): string[] {
		const text = this.previewTexts.get(this.selectedIndex);
		if (!text) {
			const placeholder = this.theme.fg("dim", NO_PREVIEW_TEXT);
			const pad = Math.max(0, width - visibleWidth(placeholder));
			return [placeholder + " ".repeat(pad)];
		}
		let md = this.markdownCache.get(this.selectedIndex);
		if (!md) {
			md = new Markdown(text, 0, 0, this.markdownTheme);
			this.markdownCache.set(this.selectedIndex, md);
		}
		return md.render(width);
	}
}
