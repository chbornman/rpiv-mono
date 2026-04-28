import type { Component } from "@mariozechner/pi-tui";

/**
 * Generic state-driven component contract. Implementers consume the full canonical
 * state via `setState`; focus is set independently via `setFocused`.
 *
 * Today's implementers (`MultiSelectOptions`, `SubmitPicker`) use `S = DialogState`. The
 * contract preserves the 2-method API frozen by `multi-select-options.test.ts:147-154`
 * and `submit-picker.test.ts:46-50` — those tests call `setState(state)` and
 * `setFocused(boolean)` separately and must continue to pass without edits.
 *
 * The benefit lives in the host: `QuestionnaireSession.applyState()` iterates a
 * registry of `StatefulComponent<DialogState>` instances and drives both methods in
 * one place. Adding a new state field no longer requires updating `applySelection`
 * AND `dialog-builder.ts` — the session's single registry-driven loop covers both.
 */
export interface StatefulComponent<S> extends Component {
	setState(state: S): void;
	setFocused(focused: boolean): void;
}
