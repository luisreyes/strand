import assert from "node:assert/strict";
import test from "node:test";
import {
  addTask,
  dayTotal,
  deleteTask,
  emptyState,
  exportBackup,
  formatClock,
  formatWords,
  importBackup,
  pause,
  selectTask,
  startOfDay,
  timelineSegments,
  toCsv,
  updateTask,
} from "../js/model.js";

test("clock and word formatting", () => {
  assert.equal(formatClock(0), "0:00:00");
  assert.equal(formatClock(1000), "0:00:01");
  assert.equal(formatClock(61_000), "0:01:01");
  assert.equal(formatClock(3_661_000), "1:01:01");
  assert.equal(formatWords(0), "0s");
  assert.equal(formatWords(61_000), "1m 1s");
  assert.equal(formatWords(3_661_000), "1h 1m 1s");
});

test("selecting a task appends it and the live end keeps growing", () => {
  let state = emptyState();
  state = addTask(state, { title: "Design", color: "#ff6b4a" }, 1_000);
  state = addTask(state, { title: "Email", color: "#5aa9ff" }, 2_000);
  const design = state.tasks[0].id;
  const email = state.tasks[1].id;
  state = selectTask(state, design, 10_000);
  state = selectTask(state, email, 20_000);
  const day = startOfDay(25_000);
  const items = timelineSegments(state, day, 25_000);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.title), ["Design", "Email"]);
  assert.equal(items[0].running, false);
  assert.equal(items[1].running, true);
  assert.equal(items[0].durationMs, 10_000);
  assert.equal(items[1].durationMs, 5_000);
  const later = timelineSegments(state, day, 28_000);
  assert.equal(later[1].durationMs, 8_000);
  assert.equal(later[0].durationMs, 10_000);
});

test("editing a task duration redraws that block and keeps the clock moving", () => {
  let state = emptyState();
  state = addTask(state, { title: "Design", color: "#ff6b4a" }, 1_000);
  state = addTask(state, { title: "Email", color: "#5aa9ff" }, 2_000);
  const design = state.tasks[0].id;
  const email = state.tasks[1].id;
  const start = 10_000;
  state = selectTask(state, design, start);
  state = selectTask(state, email, start + 10_000);
  const now = start + 15_000;
  state = updateTask(state, design, { durationMs: 60_000, color: "#3ecf8e", description: "Notes" }, now);
  const day = startOfDay(now);
  const items = timelineSegments(state, day, now);
  const designBlock = items.find((item) => item.title === "Design");
  const emailBlock = items.find((item) => item.title === "Email");
  assert.equal(designBlock.durationMs, 60_000);
  assert.equal(designBlock.color, "#3ecf8e");
  assert.equal(emailBlock.durationMs, 5_000);
  assert.ok(designBlock.durationMs > emailBlock.durationMs);
  const grown = timelineSegments(state, day, now + 4_000).find((item) => item.title === "Email");
  assert.equal(grown.durationMs, 9_000);
});

test("lowering time shrinks from the latest block backward", () => {
  let state = emptyState();
  state = addTask(state, { title: "Design", color: "#ff6b4a" }, 1_000);
  const id = state.tasks[0].id;
  state = selectTask(state, id, 0);
  state = pause(state, 10_000);
  state = selectTask(state, id, 20_000);
  state = pause(state, 30_000);
  state = updateTask(state, id, { durationMs: 5_000 }, 30_000);
  const day = startOfDay(30_000);
  const items = timelineSegments(state, day, 30_000);
  assert.equal(items.reduce((sum, item) => sum + item.durationMs, 0), 5_000);
  assert.equal(dayTotal(state, day, 30_000), 5_000);
});

test("cross-midnight segments split, and a shorter edit stays consistent", () => {
  const morning = new Date(2026, 8, 21, 1, 0, 0, 0).getTime();
  const day = startOfDay(morning);
  const previous = day - 60 * 60 * 1000;
  let state = emptyState();
  state = addTask(state, { title: "Night", color: "#8b7cff" }, previous);
  const id = state.tasks[0].id;
  state = {
    ...state,
    segments: [{
      id: "night",
      taskId: id,
      start: previous,
      end: morning,
      offsetMs: 0,
    }],
  };
  assert.equal(dayTotal(state, startOfDay(previous), morning), 60 * 60 * 1000);
  assert.equal(dayTotal(state, day, morning), 60 * 60 * 1000);
  state = updateTask(state, id, { durationMs: 30 * 60 * 1000 }, morning);
  const yesterday = dayTotal(state, startOfDay(previous), morning);
  const today = dayTotal(state, day, morning);
  assert.equal(yesterday + today, 30 * 60 * 1000);
  assert.equal(today, 0);
  assert.equal(yesterday, 30 * 60 * 1000);
});

test("backup round trip freezes a running timer without changing the live one", () => {
  let state = emptyState();
  state = addTask(state, { title: "=1+1", color: "nope" }, 1_000);
  const id = state.tasks[0].id;
  state = selectTask(state, id, 5_000);
  const exported = exportBackup(state, 9_000);
  assert.equal(exported.segments[0].end, 9_000);
  assert.equal(state.segments[0].end, null);
  const imported = importBackup(JSON.stringify(exported));
  assert.equal(imported.tasks[0].title, "=1+1");
  assert.equal(imported.tasks[0].color, "#ff6b4a");
  assert.equal(imported.segments[0].end, 9_000);
  assert.equal(timelineSegments(imported, startOfDay(9_000), 20_000)[0].durationMs, 4_000);
});

test("import rejects junk, drops orphans, and keeps a single running segment", () => {
  assert.throws(() => importBackup("{"), SyntaxError);
  assert.throws(() => importBackup("{}"), /not a Strand backup/);
  const imported = importBackup({
    version: 1,
    tasks: [{ id: "a", title: "Keep", color: "#3ecf8e", description: "  hi  ", createdAt: 1 }],
    segments: [
      { id: "s1", taskId: "missing", start: 1, end: null, offsetMs: 0 },
      { id: "s2", taskId: "a", start: 1_000, end: null, offsetMs: 0 },
      { id: "s3", taskId: "a", start: 2_000, end: null, offsetMs: 0 },
    ],
  });
  assert.equal(imported.segments.length, 2);
  assert.equal(imported.segments[0].end, 2_000);
  assert.equal(imported.segments[1].end, null);
  assert.equal(imported.tasks[0].description, "hi");
});

test("sheet export escapes formulas and commas", () => {
  let state = emptyState();
  state = addTask(state, { title: "=1+1", color: "#ff6b4a" }, 1);
  state = updateTask(state, state.tasks[0].id, { description: 'say "hi", friend' }, 1);
  const csv = toCsv(state, 1);
  assert.match(csv, /'=1\+1/);
  assert.match(csv, /say ""hi"", friend/);
});

test("deleting a task removes its color from the timeline", () => {
  let state = emptyState();
  state = addTask(state, { title: "Design", color: "#ff6b4a" }, 1);
  const id = state.tasks[0].id;
  state = selectTask(state, id, 1_000);
  state = deleteTask(state, id);
  assert.equal(state.tasks.length, 0);
  assert.equal(timelineSegments(state, startOfDay(2_000), 2_000).length, 0);
});
