import type { Component } from "@mariozechner/pi-tui";
import { visibleWidth } from "@mariozechner/pi-tui";
import { describe, expect, it } from "vitest";
import { FixedHeightBox } from "./fixed-height-box.js";

function stub(lines: string[]): Component & { rendered: number[]; invalidated: number } {
	const out = {
		rendered: [] as number[],
		invalidated: 0,
		render(w: number) {
			out.rendered.push(w);
			return lines;
		},
		handleInput() {},
		invalidate() {
			out.invalidated++;
		},
	};
	return out;
}

describe("FixedHeightBox.render", () => {
	it("pads short child output with empty strings to target height", () => {
		const child = stub(["a", "b", "c"]);
		const box = new FixedHeightBox(child, () => 10);
		const out = box.render(40);
		expect(out.length).toBe(10);
		expect(out.slice(0, 3)).toEqual(["a", "b", "c"]);
		expect(out.slice(3)).toEqual(["", "", "", "", "", "", ""]);
	});

	it("truncates long child output to target height", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
		const child = stub(lines);
		const box = new FixedHeightBox(child, () => 10);
		const out = box.render(40);
		expect(out.length).toBe(10);
		expect(out).toEqual(lines.slice(0, 10));
	});

	it("calls getHeight with the render width passed in", () => {
		const child = stub(["x"]);
		const seen: number[] = [];
		const box = new FixedHeightBox(child, (w) => {
			seen.push(w);
			return 2;
		});
		box.render(73);
		box.render(120);
		expect(seen).toEqual([73, 120]);
	});

	it("forwards width unchanged to child.render", () => {
		const child = stub(["x"]);
		const box = new FixedHeightBox(child, () => 4);
		box.render(73);
		expect(child.rendered[child.rendered.length - 1]).toBe(73);
	});

	it("handles height === 0 (returns empty array)", () => {
		const child = stub(["a", "b"]);
		const box = new FixedHeightBox(child, () => 0);
		expect(box.render(40)).toEqual([]);
	});

	it("handles negative height (returns empty array)", () => {
		const child = stub(["a", "b"]);
		const box = new FixedHeightBox(child, () => -5);
		expect(box.render(40)).toEqual([]);
	});

	it("cascades invalidate to child", () => {
		const child = stub(["a"]);
		const box = new FixedHeightBox(child, () => 1);
		box.invalidate();
		box.invalidate();
		expect(child.invalidated).toBe(2);
	});

	it("handleInput() is a no-op (does not throw, does not call child)", () => {
		const child = stub(["a"]);
		const box = new FixedHeightBox(child, () => 1);
		expect(() => box.handleInput("anything")).not.toThrow();
		expect(child.rendered.length).toBe(0);
	});

	it("does NOT mutate the child's returned array (defensive copy on slice)", () => {
		const original = ["a", "b"];
		const child = stub(original);
		const box = new FixedHeightBox(child, () => 5);
		box.render(40);
		expect(original).toEqual(["a", "b"]);
	});

	it("width safety: every emitted line satisfies visibleWidth(line) <= width", () => {
		// Child honors width-safety; FixedHeightBox must not break that contract.
		for (const w of [20, 40, 80, 120]) {
			const safeChild = stub(["x".repeat(Math.min(w, 10)), "y".repeat(Math.min(w, 5))]);
			const box = new FixedHeightBox(safeChild, () => 6);
			const out = box.render(w);
			for (const line of out) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(w);
			}
		}
	});

	it("empty padding lines contain no newline character", () => {
		const child = stub(["a"]);
		const box = new FixedHeightBox(child, () => 5);
		const out = box.render(40);
		for (const line of out.slice(1)) {
			expect(line).toBe("");
			expect(line.includes("\n")).toBe(false);
		}
	});
});
