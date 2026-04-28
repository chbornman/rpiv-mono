import type { QuestionAnswer, QuestionData } from "./types.js";
import type { WrappingSelectItem } from "./wrapping-select.js";

/**
 * Canonical state for the questionnaire dialog. Single source of truth — both the
 * dispatcher (`handleQuestionnaireInput`) and the view layer (`buildDialog`,
 * `MultiSelectOptions.setState`, `SubmitPicker.setState`) read this same shape.
 */
export interface QuestionnaireState {
	currentTab: number;
	optionIndex: number;
	inputMode: boolean;
	notesVisible: boolean;
	chatFocused: boolean;
	answers: ReadonlyMap<number, QuestionAnswer>;
	multiSelectChecked: ReadonlySet<number>;
	/**
	 * True iff the currently-focused option carries a non-empty `preview` string.
	 * Computed via `computeFocusedOptionHasPreview` below. Stored on state because it
	 * gates the `notes_enter` action and the "n to add notes" hint chip.
	 */
	focusedOptionHasPreview: boolean;
	/**
	 * Focused row in the Submit-tab picker (0 = Submit answers, 1 = Cancel). Default 0;
	 * reset on every tab switch.
	 */
	submitChoiceIndex: number;
}

/**
 * Per-tick context the dispatcher needs alongside the canonical state. Lives separately
 * from `QuestionnaireState` because these fields don't belong on the view-side state
 * (the view's `setState` consumers should not see `keybindings` or `inputBuffer`).
 */
export interface QuestionnaireRuntime {
	keybindings: { matches(data: string, name: string): boolean };
	inputBuffer: string;
	questions: readonly QuestionData[];
	isMulti: boolean;
	currentItem: WrappingSelectItem | undefined;
	items: readonly WrappingSelectItem[];
}

/**
 * Combined snapshot read by the dispatcher. The view receives the same object —
 * structural typing accepts the superset wherever a `QuestionnaireState` is expected
 * (covariance), so a single `snapshot()` call serves both consumers.
 */
export type QuestionnaireDispatchSnapshot = QuestionnaireState & QuestionnaireRuntime;

/**
 * Pure derivation: does the option focused by `(currentTab, optionIndex)` carry a
 * non-empty `preview` string? Mode gates (chat focus, notes mode, multiSelect) layer
 * on top via dispatch branches; this predicate is intentionally mode-agnostic.
 */
export function computeFocusedOptionHasPreview(
	questions: readonly QuestionData[],
	currentTab: number,
	optionIndex: number,
): boolean {
	const q = questions[currentTab];
	if (!q) return false;
	const opt = q.options[optionIndex];
	return !!opt && typeof opt.preview === "string" && opt.preview.length > 0;
}

/**
 * Numbering for the chat row's WrappingSelect, computed from the active tab's items.
 *
 * The chat row lives in its own one-item WrappingSelect; the host calls this on every tab
 * switch / selection update to keep the chat row's `N. ` label continuous with the visible
 * numbered rows of the active tab. The shape `{ offset, total }` mirrors `WrappingSelect.setNumbering(numberStartOffset, totalItemsForNumbering)` directly.
 */
export function chatNumberingFor(items: readonly WrappingSelectItem[]): {
	offset: number;
	total: number;
} {
	// Count only the visible-numbered rows. The Next sentinel renders without a number
	// (see MultiSelectOptions), so it must NOT advance the chat row's number — otherwise
	// chat reads as "6." next to options labeled 1-4.
	const count = items.filter((i) => !i.isNext).length;
	return { offset: count, total: count + 1 };
}
