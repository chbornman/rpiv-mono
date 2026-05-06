import { describe, expect, it } from "vitest";
import type { WrappingSelectItem } from "../wrapping-select.js";
import {
	adaptiveLeftWidth,
	crossTabMaxLeftWidth,
	MAX_LEFT_RATIO,
	MIN_LEFT,
	MIN_PREVIEW_WIDTH,
	PREVIEW_COLUMN_GAP,
} from "./preview-layout-decider.js";

const opt = (label: string): WrappingSelectItem => ({ kind: "option", label });

describe("crossTabMaxLeftWidth", () => {
	it("returns MIN_LEFT for empty input", () => {
		expect(crossTabMaxLeftWidth([], [], 120)).toBe(MIN_LEFT);
	});

	it("floors at MIN_LEFT when every tab has short labels", () => {
		const tabs = [{ multiSelect: false }, { multiSelect: false }];
		const itemsByTab = [[opt("A"), opt("B")], [opt("C")]];
		expect(crossTabMaxLeftWidth(tabs, itemsByTab, 120)).toBe(MIN_LEFT);
	});

	it("returns the widest tab — single long label dominates short tabs", () => {
		const tabs = [{ multiSelect: false }, { multiSelect: false }];
		const longLabel = "A very long option label that exceeds MIN_LEFT comfortably";
		const itemsByTab = [
			[opt("A"), opt("B")],
			[opt(longLabel), opt("y")],
		];
		const longSingleTab = adaptiveLeftWidth([opt(longLabel), opt("y")], 3, 120);
		expect(crossTabMaxLeftWidth(tabs, itemsByTab, 120)).toBe(longSingleTab);
		expect(longSingleTab).toBeGreaterThan(MIN_LEFT);
	});

	it("respects MAX_LEFT_RATIO ceiling — never exceeds floor(paneWidth * 0.5)", () => {
		const tabs = [{ multiSelect: false }];
		const itemsByTab = [[opt("x".repeat(120)), opt("y")]];
		const result = crossTabMaxLeftWidth(tabs, itemsByTab, 120);
		expect(result).toBeLessThanOrEqual(Math.floor(120 * MAX_LEFT_RATIO));
	});

	it("respects MIN_PREVIEW_WIDTH safety net on narrow panes", () => {
		const tabs = [{ multiSelect: false }];
		const itemsByTab = [[opt("x".repeat(60)), opt("y")]];
		// At width 82: available = 82 - GAP(2) - MIN_PREVIEW_WIDTH(40) = 40
		const result = crossTabMaxLeftWidth(tabs, itemsByTab, 82);
		expect(result).toBeLessThanOrEqual(82 - PREVIEW_COLUMN_GAP - MIN_PREVIEW_WIDTH);
	});

	it("multiSelect tabs use items.length for numbering; single-select adds chat row slot", () => {
		// Use 9 items with a label long enough to clear MIN_LEFT so the prefix delta is visible:
		//   multi:  totalForNumbering = 9          → prefixW = 1 + 4 = 5
		//   single: totalForNumbering = 9 + 1 = 10 → prefixW = 2 + 4 = 6
		// With a 30-char label, desired exceeds MIN_LEFT(30) under both, so single is exactly 1 col wider.
		const longLabel = "x".repeat(30);
		const items = Array.from({ length: 9 }, () => opt(longLabel));
		const multi = crossTabMaxLeftWidth([{ multiSelect: true }], [items], 200);
		const single = crossTabMaxLeftWidth([{ multiSelect: false }], [items], 200);
		expect(single - multi).toBe(1);
	});

	it("idempotent across tab order — max is permutation-invariant", () => {
		const a: WrappingSelectItem[] = [opt("short")];
		const b: WrappingSelectItem[] = [opt("a much longer option label here")];
		const tabs = [{ multiSelect: false }, { multiSelect: false }];
		expect(crossTabMaxLeftWidth(tabs, [a, b], 120)).toBe(crossTabMaxLeftWidth(tabs, [b, a], 120));
	});

	it("missing itemsByTab[i] is treated as an empty tab, not a crash", () => {
		const tabs = [{ multiSelect: false }, { multiSelect: false }];
		// Only one entry in itemsByTab — second tab missing
		const itemsByTab: ReadonlyArray<readonly WrappingSelectItem[]> = [[opt("a")]];
		expect(() => crossTabMaxLeftWidth(tabs, itemsByTab, 120)).not.toThrow();
		expect(crossTabMaxLeftWidth(tabs, itemsByTab, 120)).toBe(MIN_LEFT);
	});
});
