import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";
import type { QuestionAnswer } from "./types.js";

export interface TabBarConfig {
	questions: ReadonlyArray<{ header?: string; question: string }>;
	answers: ReadonlyMap<number, QuestionAnswer>;
	activeTabIndex: number;
	totalTabs: number;
}

export class TabBar implements Component {
	private config: TabBarConfig;
	private readonly theme: Theme;

	constructor(config: TabBarConfig, theme: Theme) {
		this.config = config;
		this.theme = theme;
	}

	setConfig(config: TabBarConfig): void {
		this.config = config;
	}

	handleInput(_data: string): void {}

	invalidate(): void {}

	render(width: number): string[] {
		const { questions, answers, activeTabIndex, totalTabs } = this.config;
		const submitIndex = totalTabs - 1;
		const allAnswered = answers.size === questions.length && questions.length > 0;
		const pieces: string[] = [" ← "];

		for (let i = 0; i < questions.length; i++) {
			const q = questions[i];
			const label = q?.header && q.header.length > 0 ? q.header : `Q${i + 1}`;
			const answered = answers.has(i);
			const box = answered ? "■" : "□";
			const rawSeg = ` ${box} ${label} `;
			const isActive = i === activeTabIndex;
			const styled = isActive
				? this.theme.bg("selectedBg", this.theme.fg("text", rawSeg))
				: this.theme.fg(answered ? "success" : "muted", rawSeg);
			pieces.push(styled);
			pieces.push(" ");
		}

		const submitText = " ✓ Submit ";
		const submitActive = activeTabIndex === submitIndex;
		const submitStyled = submitActive
			? this.theme.bg("selectedBg", this.theme.fg("text", submitText))
			: this.theme.fg(allAnswered ? "success" : "dim", submitText);
		pieces.push(submitStyled);
		pieces.push(" →");

		const tabLine = truncateToWidth(pieces.join(""), width, "");
		return [tabLine, ""];
	}
}
