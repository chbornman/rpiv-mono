import { describe, expect, it } from "vitest";
import { RENDER_MODE_INLINE, RENDER_MODE_OVERLAY } from "./config.js";
import { INLINE_MIN_ROWS, inlineRowBudget, overlayRowBudget, resolvePresentation } from "./presentation.js";

describe("row budgets", () => {
	it("passes terminal rows through unchanged for the overlay", () => {
		expect(overlayRowBudget(24)).toBe(24);
		expect(overlayRowBudget(7)).toBe(7);
	});

	it("caps inline at a share of the terminal with a floor, never above the terminal", () => {
		expect(inlineRowBudget(24)).toBe(16);
		expect(inlineRowBudget(40)).toBe(28);
		expect(inlineRowBudget(16)).toBe(INLINE_MIN_ROWS);
		expect(inlineRowBudget(8)).toBe(8);
	});
});

describe("resolvePresentation", () => {
	it("gives the overlay no slot to release", () => {
		const p = resolvePresentation(RENDER_MODE_OVERLAY);
		expect(p).toMatchObject({ overlay: true, rowBudget: overlayRowBudget });
		expect(p.release).toBeUndefined();
	});

	it("holds the inline slot until released, degrading contenders to the overlay", () => {
		const first = resolvePresentation(RENDER_MODE_INLINE);
		expect(first).toMatchObject({ overlay: false, rowBudget: inlineRowBudget });
		const second = resolvePresentation(RENDER_MODE_INLINE);
		expect(second).toMatchObject({ overlay: true, rowBudget: overlayRowBudget });
		expect(second.release).toBeUndefined();

		first.release?.();
		// Idempotent: a double release must not free a slot someone else now holds.
		const third = resolvePresentation(RENDER_MODE_INLINE);
		first.release?.();
		expect(resolvePresentation(RENDER_MODE_INLINE).overlay).toBe(true);
		third.release?.();
	});
});
