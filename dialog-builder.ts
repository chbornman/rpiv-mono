import { DynamicBorder, type Theme } from "@mariozechner/pi-coding-agent";
import { type Component, Container, type Input, Spacer } from "@mariozechner/pi-tui";
import { BodyResidualSpacer } from "./body-residual-spacer.js";
import type { MultiSelectOptions } from "./multi-select-options.js";
import type { PreviewPane } from "./preview-pane.js";
import type { QuestionnaireState } from "./questionnaire-state.js";
import type { TabBar } from "./tab-bar.js";
import { QuestionTabStrategy, SubmitTabStrategy, type TabStrategy } from "./tab-strategy.js";
import type { QuestionData } from "./types.js";
import type { WrappingSelect } from "./wrapping-select.js";

// Hint text — these constants are also referenced by tests as substrings of the rendered
// hint line. Keep them as full "contiguous substrings" of the buildHintText() output so the
// `expect(joined).toContain(HINT_*)` assertions remain valid.
//
// Format (per UX spec):
//   <Single>      = "Enter to select · ↑/↓ to navigate · Esc to cancel"
//   <Multi>       = "Enter to select · ↑/↓ to navigate · Tab to switch questions · Esc to cancel"
//   + multiSelect = inserts " · Space to toggle"
//   + answered    = inserts " · n to add notes"
export const HINT_SINGLE = "Enter to select · ↑/↓ to navigate · Esc to cancel";
export const HINT_MULTI = "Enter to select · ↑/↓ to navigate · Tab to switch questions · Esc to cancel";
export const HINT_MULTISELECT_SUFFIX = " · Space to toggle";
export const HINT_NOTES_SUFFIX = " · n to add notes";
export const REVIEW_HEADING = "Review your answers";
export const READY_PROMPT = "Ready to submit your answers?";
export const INCOMPLETE_WARNING_PREFIX = "⚠ Answer remaining questions before submitting:";

export type DialogState = QuestionnaireState;

export interface DialogConfig {
	theme: Theme;
	questions: readonly QuestionData[];
	state: DialogState;
	previewPane: PreviewPane;
	tabBar: TabBar | undefined;
	notesInput: Input;
	chatList: WrappingSelect;
	isMulti: boolean;
	multiSelectOptionsByTab: ReadonlyArray<MultiSelectOptions | undefined>;
	/**
	 * Submit-tab Submit/Cancel picker. Optional so the type stays
	 * compatible with single-question mode (no Submit Tab) and with tests that
	 * exercise non-submit code paths. SubmitTabStrategy falls back to Spacer
	 * rows when undefined.
	 */
	submitPicker?: Component;
	/**
	 * Worst-case body height across all tabs and (for preview tabs) all options.
	 * Determines the stable overall dialog footprint.
	 */
	getBodyHeight: (width: number) => number;
	/**
	 * Body height of the CURRENTLY active tab/option. The chrome wrapper subtracts
	 * this from `getBodyHeight` to absorb the height residual OUTSIDE the bordered
	 * region — the body itself renders at its natural height with no internal padding.
	 */
	getCurrentBodyHeight: (width: number) => number;
}

export interface DialogComponent extends Component {
	setState(state: DialogState): void;
	setPreviewPane(previewPane: PreviewPane): void;
}

export function buildDialog(config: DialogConfig): DialogComponent {
	let liveConfig: DialogConfig = config;

	const questionStrategy: TabStrategy = new QuestionTabStrategy({
		theme: config.theme,
		questions: config.questions,
		// Live getter — reads liveConfig.previewPane on every call so dialog.setPreviewPane
		// updates flow through to the strategy without re-construction.
		getPreviewPane: () => liveConfig.previewPane,
		multiSelectOptionsByTab: config.multiSelectOptionsByTab,
		notesInput: config.notesInput,
		chatList: config.chatList,
		isMulti: config.isMulti,
		getCurrentBodyHeight: config.getCurrentBodyHeight,
	});

	const submitStrategy: TabStrategy | undefined = config.isMulti
		? new SubmitTabStrategy({
				theme: config.theme,
				questions: config.questions,
				submitPicker: config.submitPicker,
			})
		: undefined;

	const maxFooterRowCount = Math.max(questionStrategy.footerRowCount, submitStrategy?.footerRowCount ?? 0);

	const component: DialogComponent = {
		setState(state: DialogState) {
			liveConfig = { ...liveConfig, state };
		},
		setPreviewPane(previewPane: PreviewPane) {
			liveConfig = { ...liveConfig, previewPane };
		},
		handleInput() {},
		invalidate() {
			liveConfig.previewPane.invalidate();
			liveConfig.tabBar?.invalidate();
			liveConfig.notesInput.invalidate();
			liveConfig.chatList.invalidate();
		},
		render(width: number): string[] {
			const onSubmit = liveConfig.isMulti && liveConfig.state.currentTab === liveConfig.questions.length;
			const strategy = onSubmit && submitStrategy ? submitStrategy : questionStrategy;
			return buildContainerFromStrategy(strategy, liveConfig, maxFooterRowCount).render(width);
		},
	};
	return component;
}

/**
 * Chrome wrapper that lays out a tab strategy's content with structural height
 * equality. The residual spacer absorbs both body-height and footer-row-count
 * asymmetry in one expression — the prior `summary.length + offset` compensation is gone.
 *
 * Total dialog height (constant per `getBodyHeight` per render):
 *   topChromeRows (border + tabBar? + Spacer(1)) +
 *     headingRows + body + Spacer(1) + midRows + bottom-border + footerRows + residual
 *   = topChromeRows + (heading constant in multi mode) + getBodyHeight + 2 + maxFooterRowCount
 */
function buildContainerFromStrategy(strategy: TabStrategy, config: DialogConfig, maxFooterRowCount: number): Container {
	const { theme, isMulti, tabBar, state } = config;
	const container = new Container();
	const border = () => new DynamicBorder((s) => theme.fg("accent", s));

	// Top chrome — common to every tab.
	container.addChild(border());
	if (isMulti && tabBar) container.addChild(tabBar);
	container.addChild(new Spacer(1));

	// Strategy-supplied content.
	for (const c of strategy.headingRows(state)) container.addChild(c);
	container.addChild(strategy.bodyComponent(state));
	container.addChild(new Spacer(1));
	for (const c of strategy.midRows(state)) container.addChild(c);

	// Bottom chrome — common.
	container.addChild(border());
	for (const c of strategy.footerRows(state)) container.addChild(c);

	// Residual: equalize total height across strategies. Replaces both the
	// per-tab residual asymmetry and the prior +1 magic.
	container.addChild(
		new BodyResidualSpacer(
			(w) => config.getBodyHeight(w) + maxFooterRowCount,
			(w) => strategy.bodyHeight(w, state) + strategy.footerRowCount,
		),
	);
	return container;
}
