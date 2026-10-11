import { RENDER_MODE_INLINE, type RenderMode } from "./config.js";

/**
 * Inline row budget. A component in Pi's editor slot only receives a width, and the
 * host clips the slot from the bottom when the dock outgrows the screen, so the inline
 * dialog caps itself — the same idiom Pi's own editor uses in that slot
 * (`max(5, floor(rows * 0.3))`). The floor keeps the dialog chrome plus a few option
 * rows; past the cap, `DialogView`'s scroll-to-focus partition takes over.
 */
export const INLINE_ROW_RATIO = 0.7;
export const INLINE_MIN_ROWS = 12;

/** Maps the terminal's row count to the rows the dialog may render. */
export type RowBudget = (terminalRows: number) => number;

export const overlayRowBudget: RowBudget = (terminalRows) => terminalRows;

export const inlineRowBudget: RowBudget = (terminalRows) =>
	Math.min(terminalRows, Math.max(INLINE_MIN_ROWS, Math.floor(terminalRows * INLINE_ROW_RATIO)));

export interface Presentation {
	/** True → focused overlay (`ctx.ui.custom` overlay options); false → Pi's editor slot. */
	overlay: boolean;
	rowBudget: RowBudget;
	/** Frees the inline slot; present only when this presentation claimed it. Call once, on teardown. */
	release?: () => void;
}

// Pi runs tool calls in parallel by default and has a single editor slot: a second
// inline mount would replace the first, whose `custom()` promise would never settle.
// Overlays stack safely, so a questionnaire that finds the slot taken degrades to one
// instead of waiting — waiting could stall on a lane's parked question indefinitely.
let inlineSlotHeld = false;

function claimInlineSlot(): (() => void) | undefined {
	if (inlineSlotHeld) return undefined;
	inlineSlotHeld = true;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		inlineSlotHeld = false;
	};
}

export function resolvePresentation(mode: RenderMode): Presentation {
	if (mode === RENDER_MODE_INLINE) {
		const release = claimInlineSlot();
		if (release) return { overlay: false, rowBudget: inlineRowBudget, release };
	}
	return { overlay: true, rowBudget: overlayRowBudget };
}
