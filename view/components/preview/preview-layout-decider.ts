import { visibleWidth } from "@mariozechner/pi-tui";
import type { WrappingSelectItem } from "../wrapping-select.js";

/** Min terminal/pane width for the side-by-side layout to engage. */
export const PREVIEW_MIN_WIDTH = 100;
/** Visual gap between options column and preview column in side-by-side. */
export const PREVIEW_COLUMN_GAP = 2;
/** 1 col padding inside the preview column (between gap and `│`). */
export const PREVIEW_PADDING_LEFT = 1;
/** Empty rows between options and preview blocks in stacked (narrow) layout. */
export const STACKED_GAP_ROWS = 1;

/** Floor for the adaptive left column width — prevents collapse on short labels. */
export const MIN_LEFT = 30;
/** Ceiling ratio: left column never exceeds this fraction of pane width. */
export const MAX_LEFT_RATIO = 0.5;
/** Floor for the preview column width — prevents right-side collapse on narrow terminals. */
export const MIN_PREVIEW_WIDTH = 40;
/** visibleWidth(" ✔") = 2 (space + ✔ codepoint). Reserved on the longest-label measurement
 *  so a confirmed row never gets truncated when MIN_LEFT clamps the column. */
export const CONFIRMED_OVERHEAD = 2;

export type PreviewLayoutMode = "side-by-side" | "stacked";

/**
 * Decide layout mode from terminal + pane widths. Pure of inputs.
 *
 * The terminal-width gate is the AND check from the previous `preview-pane.ts` —
 * lifted here so the decision is computed ONCE per render and threaded explicitly
 * through `previewBlockHeight`. Removes the bug class where `previewBlockHeight`
 * re-derived `sideBySide` from a column width (already < pane width post-split),
 * capping height too short.
 */
export function decideLayout(terminalWidth: number, paneWidth: number): PreviewLayoutMode {
	return terminalWidth >= PREVIEW_MIN_WIDTH && paneWidth >= PREVIEW_MIN_WIDTH ? "side-by-side" : "stacked";
}

/**
 * Compute the adaptive left column width from option labels.
 * Pure function — deterministic for a given (items, totalForNumbering, paneWidth).
 *
 * Pipeline:
 *   1. Measure: longest visible label width + prefix overhead + confirmed-mark overhead
 *   2. Clamp: floor MIN_LEFT, ceiling paneWidth * MAX_LEFT_RATIO
 *   3. Safety net: never exceed available = paneWidth - GAP - MIN_PREVIEW_WIDTH
 */
export function adaptiveLeftWidth(
	items: readonly WrappingSelectItem[],
	totalForNumbering: number,
	paneWidth: number,
): number {
	const prefixW = String(Math.max(1, totalForNumbering)).length + 4; // digits + "❯ " + ". "
	const confirmedOverhead = CONFIRMED_OVERHEAD; // visibleWidth(" ✔") = 2 (space + ✔ codepoint)
	let maxLabel = 0;
	for (const item of items) {
		const w = visibleWidth(item.label);
		if (w > maxLabel) maxLabel = w;
	}
	const desired = maxLabel + prefixW + confirmedOverhead;
	const ratioCapped = Math.min(desired, Math.floor(paneWidth * MAX_LEFT_RATIO));
	const available = paneWidth - PREVIEW_COLUMN_GAP - MIN_PREVIEW_WIDTH;
	return Math.max(MIN_LEFT, Math.min(ratioCapped, Math.max(1, available)));
}

/**
 * Cross-tab maximum left-column width. Aggregates `adaptiveLeftWidth` over every tab
 * and returns the widest result, so the options column stays stable on tab switch.
 *
 * Pure function — `tabs.length` MUST equal `itemsByTab.length`. Multi-select tabs
 * use `items.length` for numbering; single-select tabs add 1 for the chat row slot.
 * Floor is `MIN_LEFT` so an all-empty input still produces a usable column.
 */
export function crossTabMaxLeftWidth(
	tabs: ReadonlyArray<{ multiSelect?: boolean }>,
	itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]>,
	paneWidth: number,
): number {
	let max = MIN_LEFT;
	for (let i = 0; i < tabs.length; i++) {
		const items = itemsByTab[i] ?? [];
		const totalForNumbering = tabs[i]?.multiSelect ? items.length : items.length + 1;
		const tabWidth = adaptiveLeftWidth(items, totalForNumbering, paneWidth);
		if (tabWidth > max) max = tabWidth;
	}
	return max;
}

/**
 * Width allocation for side-by-side mode.
 * `adaptiveLeft` is the pre-computed left column width (from `adaptiveLeftWidth`,
 * cross-tab aggregated). The Math.max(1, ...) calls keep both columns >= 1 col on
 * extreme inputs.
 */
export function columnWidths(
	paneWidth: number,
	adaptiveLeft: number,
): { leftWidth: number; rightWidth: number; gap: number } {
	const gap = PREVIEW_COLUMN_GAP;
	const leftWidth = Math.min(adaptiveLeft, Math.max(1, paneWidth - gap - 1));
	const rightWidth = Math.max(1, paneWidth - leftWidth - gap);
	return { leftWidth, rightWidth, gap };
}

/**
 * Returns the widths actually passed to `options.render` and `previewLines` inside
 * `render()`. Stacked uses the full pane width for both; side-by-side splits via
 * `columnWidths`, with the preview column offset by `PREVIEW_PADDING_LEFT`.
 */
export function bodyWidths(
	paneWidth: number,
	mode: PreviewLayoutMode,
	adaptiveLeft: number,
): { optionsWidth: number; previewWidth: number } {
	if (mode === "stacked") return { optionsWidth: paneWidth, previewWidth: paneWidth };
	const { leftWidth, rightWidth } = columnWidths(paneWidth, adaptiveLeft);
	return { optionsWidth: leftWidth, previewWidth: Math.max(1, rightWidth - PREVIEW_PADDING_LEFT) };
}
