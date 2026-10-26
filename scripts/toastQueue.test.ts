/** Run: npx tsx scripts/toastQueue.test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  initialToastState,
  reduceToast,
  toastVisibleMs,
  type ToastEvent,
  type ToastState,
} from "../lib/toastQueue";
import { UNDO_TOAST_MS, UNDO_TOAST_SCREEN_READER_MS } from "../lib/feedback";

type A = { label: string };
const show = (message: string, action: A | null = null, visibleMs = 2200): ToastEvent<A> => ({
  type: "show",
  message,
  kind: "success",
  action,
  visibleMs,
});
const run = (state: ToastState<A>, ev: ToastEvent<A>) => reduceToast(state, ev);

const cases: Array<[string, () => void]> = [
  ["first toast: reset, enter, arm", () => {
    const r = run(initialToastState<A>(), show("a"));
    assert.equal(r.state.current?.message, "a");
    assert.deepEqual(r.effects.map((e) => e.type), ["disarm", "reset", "enter", "arm"]);
  }],
  ["second toast while first is visible replaces it at once, one active, no reset flicker", () => {
    const a = run(initialToastState<A>(), show("a")).state;
    const b = run(a, show("b"));
    assert.equal(b.state.current?.message, "b");
    assert.equal(b.state.current?.id, 2);
    assert.ok(!b.effects.some((e) => e.type === "reset"));
    assert.equal(b.effects[0].type, "disarm");
  }],
  ["second toast during first one's exit: old text gone, restarts from 0", () => {
    let s = run(initialToastState<A>(), show("a")).state;
    s = run(s, { type: "hideDue", id: 1 }).state;
    assert.equal(s.phase, "out");
    const b = run(s, show("b"));
    assert.equal(b.state.current?.message, "b");
    assert.equal(b.state.phase, "in");
    assert.ok(b.effects.some((e) => e.type === "reset"));
  }],
  ["interrupted exit of the old toast never clears the new one", () => {
    let s = run(initialToastState<A>(), show("a")).state;
    s = run(s, { type: "hideDue", id: 1 }).state;
    s = run(s, show("b")).state;
    const r = run(s, { type: "exitDone", id: 1, finished: false });
    assert.equal(r.state.current?.message, "b");
    const r2 = run(s, { type: "exitDone", id: 1, finished: true });
    assert.equal(r2.state.current?.message, "b");
  }],
  ["stale hide timer of the first toast is ignored", () => {
    let s = run(initialToastState<A>(), show("a")).state;
    s = run(s, show("b")).state;
    const r = run(s, { type: "hideDue", id: 1 });
    assert.equal(r.state.phase, "in");
    assert.equal(r.effects.length, 0);
  }],
  ["hide then exitDone empties the slot", () => {
    let s = run(initialToastState<A>(), show("a")).state;
    s = run(s, { type: "hideDue", id: 1 }).state;
    s = run(s, { type: "exitDone", id: 1, finished: true }).state;
    assert.equal(s.current, null);
    assert.equal(s.phase, "idle");
  }],
  ["action runs once: second press does nothing", () => {
    const s = run(initialToastState<A>(), show("a", { label: "Undo" })).state;
    const r = run(s, { type: "actionRun", id: 1 });
    assert.equal(r.state.current?.action, null);
    assert.equal(r.state.phase, "out");
    const again = run(r.state, { type: "actionRun", id: 1 });
    assert.equal(again.effects.length, 0);
  }],
  ["reduce motion: enter and exit are instant (0 ms)", () => {
    const s = run(initialToastState<A>(), { type: "motion", reduceMotion: true }).state;
    const r = run(s, show("a"));
    assert.deepEqual(r.effects.find((e) => e.type === "enter"), { type: "enter", ms: 0 });
    const h = run(r.state, { type: "hideDue", id: 1 });
    assert.deepEqual(h.effects, [{ type: "exit", id: 1, ms: 0 }]);
    const act = run(r.state, { type: "actionRun", id: 1 });
    assert.deepEqual(act.effects[1], { type: "exit", id: 1, ms: 0 });
  }],
  ["motion on: animated durations", () => {
    const r = run(initialToastState<A>(), show("a"));
    assert.deepEqual(r.effects.find((e) => e.type === "enter"), { type: "enter", ms: 220 });
  }],
  ["armed duration is the one passed in", () => {
    const r = run(initialToastState<A>(), show("a", { label: "x" }, 5000));
    assert.deepEqual(r.effects.find((e) => e.type === "arm"), { type: "arm", id: 1, ms: 5000 });
  }],
  ["undo toast stays 5 s, 20 s with a screen reader, plain toast 2.2 s", () => {
    const base = { plainMs: 2200, actionMs: UNDO_TOAST_MS, actionScreenReaderMs: UNDO_TOAST_SCREEN_READER_MS };
    assert.equal(UNDO_TOAST_MS, 5000);
    assert.equal(toastVisibleMs({ ...base, hasAction: true, screenReader: false }), 5000);
    assert.equal(toastVisibleMs({ ...base, hasAction: true, screenReader: true }), 20000);
    assert.equal(toastVisibleMs({ ...base, hasAction: false, screenReader: true }), 2200);
  }],
  ["plain info toast over a live undo toast waits: the Undo stays, nothing restarts", () => {
    const a = run(initialToastState<A>(), show("saved", { label: "Undo" }, 5000)).state;
    const b = run(a, { ...show("tip"), kind: "info" });
    assert.equal(b.state.current?.message, "saved");
    assert.equal(b.state.current?.action?.label, "Undo");
    assert.equal(b.state.current?.id, 1);
    assert.equal(b.effects.length, 0);
    assert.equal(b.state.queue.length, 1);
  }],
  ["queued toast appears after the undo toast's exit, with its own duration", () => {
    let s = run(initialToastState<A>(), show("saved", { label: "Undo" }, 5000)).state;
    s = run(s, show("tip", null, 2200)).state;
    s = run(s, { type: "hideDue", id: 1 }).state;
    const r = run(s, { type: "exitDone", id: 1, finished: true });
    assert.equal(r.state.current?.message, "tip");
    assert.equal(r.state.current?.id, 2);
    assert.equal(r.state.phase, "in");
    assert.equal(r.state.queue.length, 0);
    assert.deepEqual(r.effects.map((e) => e.type), ["disarm", "reset", "enter", "arm"]);
    assert.deepEqual(r.effects.find((e) => e.type === "arm"), { type: "arm", id: 2, ms: 2200 });
  }],
  ["interrupted exit never releases the queue", () => {
    let s = run(initialToastState<A>(), show("saved", { label: "Undo" }, 5000)).state;
    s = run(s, show("tip")).state;
    s = run(s, { type: "hideDue", id: 1 }).state;
    const r = run(s, { type: "exitDone", id: 1, finished: false });
    assert.equal(r.state.current?.message, "saved");
    assert.equal(r.state.queue.length, 1);
  }],
  ["an error toast is never held back: it replaces the undo toast at once", () => {
    const a = run(initialToastState<A>(), show("saved", { label: "Undo" }, 5000)).state;
    const b = run(a, { ...show("failed"), kind: "error" });
    assert.equal(b.state.current?.message, "failed");
    assert.equal(b.state.queue.length, 0);
  }],
  ["a toast with its own action is never held back either", () => {
    const a = run(initialToastState<A>(), show("one", { label: "Undo" }, 5000)).state;
    const b = run(a, show("two", { label: "Retry" }, 5000));
    assert.equal(b.state.current?.message, "two");
    assert.equal(b.state.queue.length, 0);
  }],
  ["queue keeps arrival order, holds 3 at most (oldest dropped), skips an immediate duplicate", () => {
    let s = run(initialToastState<A>(), show("saved", { label: "Undo" }, 5000)).state;
    for (const m of ["t1", "t1", "t2", "t3", "t4"]) s = run(s, show(m)).state;
    assert.deepEqual(s.queue.map((q) => q.message), ["t2", "t3", "t4"]);
    s = run(s, { type: "hideDue", id: 1 }).state;
    s = run(s, { type: "exitDone", id: 1, finished: true }).state;
    assert.equal(s.current?.message, "t2");
    s = run(s, { type: "hideDue", id: 2 }).state;
    s = run(s, { type: "exitDone", id: 2, finished: true }).state;
    assert.equal(s.current?.message, "t3");
    assert.deepEqual(s.queue.map((q) => q.message), ["t4"]);
  }],
  ["undo pressed, then the 'undone' toast replaces the dying one; the queue still drains after", () => {
    let s = run(initialToastState<A>(), show("saved", { label: "Undo" }, 5000)).state;
    s = run(s, show("tip")).state;
    s = run(s, { type: "actionRun", id: 1 }).state;
    s = run(s, show("undone")).state;
    assert.equal(s.current?.message, "undone");
    assert.equal(s.phase, "in");
    assert.equal(s.queue.length, 1);
    s = run(s, { type: "hideDue", id: 2 }).state;
    s = run(s, { type: "exitDone", id: 2, finished: true }).state;
    assert.equal(s.current?.message, "tip");
  }],
  ["plain toast over a plain toast still replaces in place (no queue)", () => {
    const a = run(initialToastState<A>(), show("a")).state;
    const b = run(a, show("b"));
    assert.equal(b.state.queue.length, 0);
    assert.equal(b.state.current?.message, "b");
  }],
  ["Feedback.tsx contract: one Animated.Value, reduce-motion probe, announce, labelled action, capped width", () => {
    const src =
      readFileSync(new URL("../components/Feedback.tsx", import.meta.url), "utf8") +
      readFileSync(new URL("../components/ToastCard.tsx", import.meta.url), "utf8");
    const provider = src.slice(src.indexOf("export function FeedbackProvider"), src.indexOf("export function FeedbackHost"));
    assert.equal((provider.match(/new Animated\.Value\(/g) ?? []).length, 1);
    assert.ok(src.includes("isReduceMotionEnabled"));
    assert.ok(src.includes("reduceMotionChanged"));
    assert.ok(src.includes("announceForAccessibility"));
    assert.ok(src.includes("accessibilityLabel={action.label}"));
    assert.ok(src.includes("minHeight: HIT_TARGET"));
    assert.ok(!src.includes("insets.top + 8"), "toast must not sit under the top bar");
    assert.ok(src.includes("useToastBottom()"));
    assert.ok(src.includes("TOAST_MAX_WIDTH"));
  }],
];

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
if (failed) process.exit(1);
console.log("all passed");
