import {
  PALETTE,
  activeTask,
  addTask,
  dayTotal,
  deleteTask,
  durationFromParts,
  earliestDay,
  emptyState,
  exportBackup,
  formatClock,
  formatDayLabel,
  formatWords,
  importBackup,
  lastTask,
  nextDay,
  pause,
  previousDay,
  sanitizeColor,
  selectTask,
  splitDuration,
  startOfDay,
  taskDuration,
  tasksForList,
  timelineSegments,
  toCsv,
  toHtml,
  toTsv,
  updateTask,
} from "./model.js";

const STORAGE_KEY = "strand.v1";
const THEME_KEY = "strand.theme";
const MAX_HOURS = 10000;

const floatMode = new URLSearchParams(location.search).get("view") === "float";
const $ = (id) => document.getElementById(id);

const shell = document.querySelector(".shell");
const hero = $("hero");
const clock = $("clock");
const liveDot = $("live-dot");
const activeName = $("active-name");
const todayLine = $("today-line");
const runBtn = $("run-btn");
const dayPrev = $("day-prev");
const dayNext = $("day-next");
const dayLabel = $("day-label");
const track = $("track");
const trackEmpty = $("track-empty");
const viewedTotal = $("viewed-total");
const titleInput = $("title-input");
const swatches = $("swatches");
const customColor = $("custom-color");
const composer = $("composer");
const taskList = $("task-list");
const taskCount = $("task-count");
const taskEmpty = $("task-empty");
const menu = $("menu");
const menuBtn = $("menu-btn");
const themeBtn = $("theme-btn");
const floatBtn = $("float-btn");
const installBtn = $("install-btn");
const iosHint = $("ios-hint");
const tooltip = $("tooltip");
const editor = $("editor");
const editorForm = $("editor-form");
const editTitle = $("edit-title");
const editDesc = $("edit-desc");
const editSwatches = $("edit-swatches");
const editH = $("edit-h");
const editM = $("edit-m");
const editS = $("edit-s");
const editDelete = $("edit-delete");
const editCancel = $("edit-cancel");
const confirmDialog = $("confirm");
const confirmTitle = $("confirm-title");
const confirmMessage = $("confirm-message");
const confirmOk = $("confirm-ok");
const confirmCancel = $("confirm-cancel");
const toastEl = $("toast");
const actionConfirm = $("action-confirm");
const importFile = $("import-file");
const floatRoot = $("float-root");
const pencilTemplate = $("pencil-template");

let state = loadState();
let selectedColor = PALETTE[0];
let pinnedDay = null;
let justAddedId = null;
let pending = null;
let editorState = null;
let toastTimer = 0;
let deferredPrompt = null;
let floatSink = null;
let channel = null;

try {
  channel = new BroadcastChannel("strand");
} catch {
  channel = null;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return importBackup(raw);
  } catch (error) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localStorage.setItem(`${STORAGE_KEY}.corrupt`, raw);
    } catch {
      /* storage may be blocked */
    }
    console.warn("Strand could not read saved time.", error);
    return emptyState();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast("Could not save on this device. Export a backup.");
    return;
  }
  channel?.postMessage({ type: "state", state });
}

function applyRemote(next) {
  try {
    state = importBackup(next);
  } catch {
    return;
  }
  if (editor.open && editorState && !state.tasks.some((task) => task.id === editorState.id)) {
    editor.close();
  }
  closeConfirm();
  render();
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3400);
}

function readable(hex) {
  const value = sanitizeColor(hex);
  const red = Number.parseInt(value.slice(1, 3), 16) / 255;
  const green = Number.parseInt(value.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(value.slice(5, 7), 16) / 255;
  const lin = (channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(red) + 0.7152 * lin(green) + 0.0722 * lin(blue);
  const light = document.documentElement.dataset.theme === "light";
  return light ? luminance < 0.42 : luminance > 0.22;
}

function applyTheme(theme, { persist = false, paint = false } = {}) {
  if (theme !== "light" && theme !== "dark") return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f4efe6" : "#100e0c");
  const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (apple) apple.content = theme === "light" ? "default" : "black-translucent";
  if (themeBtn) {
    const light = theme === "light";
    themeBtn.setAttribute("aria-pressed", String(light));
    themeBtn.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
  }
  const pip = window.documentPictureInPicture?.window;
  if (pip) pip.document.documentElement.dataset.theme = theme;
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage may be blocked */ }
    channel?.postMessage({ type: "theme", theme });
  }
  if (paint) paintLive(Date.now());
}

function viewedDay(now) {
  const today = startOfDay(now);
  if (pinnedDay == null) return today;
  const earliest = earliestDay(state, now);
  if (pinnedDay > today) return today;
  if (pinnedDay < earliest) return earliest;
  return pinnedDay;
}

function readInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : 0;
}

function fileDate(now) {
  const date = new Date(now);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function askConfirm({ title, message, confirmLabel }) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmOk.textContent = confirmLabel || "Confirm";
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      confirmOk.removeEventListener("click", onOk);
      confirmCancel.removeEventListener("click", onCancel);
      confirmDialog.removeEventListener("cancel", onCancelEvent);
      confirmDialog.removeEventListener("close", onClose);
      if (confirmDialog.open) confirmDialog.close();
      resolve(value);
    };
    const onOk = (event) => {
      event.preventDefault();
      finish(true);
    };
    const onCancel = () => finish(false);
    const onCancelEvent = (event) => {
      event.preventDefault();
      finish(false);
    };
    const onClose = () => finish(false);
    confirmOk.addEventListener("click", onOk);
    confirmCancel.addEventListener("click", onCancel);
    confirmDialog.addEventListener("cancel", onCancelEvent);
    confirmDialog.addEventListener("close", onClose);
    confirmDialog.showModal();
  });
}

function closeMenu() {
  menu.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
}

function toggleMenu() {
  const open = menu.hidden;
  menu.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
}

function paintComposerSwatches() {
  const current = selectedColor.toLowerCase();
  const known = PALETTE.includes(current);
  for (const button of swatches.querySelectorAll(".swatch")) {
    button.setAttribute("aria-pressed", String(button.dataset.color === current));
  }
  customColor.classList.toggle("is-custom", !known);
  if (!known) customColor.value = current;
}

function buildComposerSwatches() {
  swatches.replaceChildren();
  for (const color of PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.background = color;
    button.dataset.color = color;
    button.setAttribute("aria-label", `Color ${color}`);
    button.setAttribute("role", "option");
    button.addEventListener("click", () => {
      selectedColor = color;
      paintComposerSwatches();
    });
    swatches.appendChild(button);
  }
  swatches.appendChild(customColor);
  customColor.classList.remove("sr-only");
  customColor.tabIndex = 0;
  customColor.value = selectedColor;
  customColor.addEventListener("input", () => {
    selectedColor = sanitizeColor(customColor.value);
    paintComposerSwatches();
  });
  paintComposerSwatches();
}

function paintEditorSwatches() {
  const current = editorState?.color || PALETTE[0];
  for (const button of editSwatches.querySelectorAll(".swatch")) {
    button.setAttribute("aria-pressed", String(button.dataset.color === current));
  }
  const custom = editSwatches.querySelector("input[type='color']");
  if (!custom) return;
  custom.classList.toggle("is-custom", !PALETTE.includes(current));
  if (custom.value.toLowerCase() !== current) custom.value = current;
}

function buildEditorSwatches() {
  editSwatches.replaceChildren();
  for (const color of PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.background = color;
    button.dataset.color = color;
    button.setAttribute("aria-label", `Color ${color}`);
    button.addEventListener("click", () => {
      editorState.color = color;
      paintEditorSwatches();
    });
    editSwatches.appendChild(button);
  }
  const custom = document.createElement("input");
  custom.type = "color";
  custom.value = editorState?.color || PALETTE[0];
  custom.setAttribute("aria-label", "Custom color");
  custom.addEventListener("input", () => {
    editorState.color = sanitizeColor(custom.value);
    paintEditorSwatches();
  });
  editSwatches.appendChild(custom);
  paintEditorSwatches();
}

function fillTip(tip, segment) {
  tip.querySelector(".tip-title-text").textContent = segment.dataset.title || "";
  tip.querySelector(".tip-length").textContent = segment.dataset.length || "";
  tip.querySelector(".tip-swatch").style.background = segment.dataset.color || "transparent";
  const total = tip.querySelector(".tip-total");
  if (segment.dataset.same === "0") {
    total.hidden = false;
    total.textContent = `Task total ${segment.dataset.total}`;
  } else {
    total.hidden = true;
  }
  tip.dataset.for = segment.dataset.id || "";
}

function placeTip(tip, x, y) {
  const view = tip.ownerDocument.defaultView;
  tip.hidden = false;
  tip.style.left = "0px";
  tip.style.top = "0px";
  const rect = tip.getBoundingClientRect();
  const pad = 8;
  let left = x + 12;
  let top = y - rect.height - 14;
  if (left + rect.width > view.innerWidth - pad) left = view.innerWidth - rect.width - pad;
  if (left < pad) left = pad;
  if (top < pad) top = y + 18;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function bindTrack(trackEl, tip) {
  if (!trackEl || trackEl.dataset.bound) return;
  trackEl.dataset.bound = "1";
  const doc = trackEl.ownerDocument;
  const hover = () => doc.defaultView.matchMedia("(hover: hover) and (pointer: fine)").matches;

  trackEl.addEventListener("pointerover", (event) => {
    const segment = event.target.closest?.(".seg");
    if (!segment || !hover()) return;
    fillTip(tip, segment);
    placeTip(tip, event.clientX, event.clientY);
  });
  trackEl.addEventListener("pointermove", (event) => {
    const segment = event.target.closest?.(".seg");
    if (!segment || tip.hidden || !hover()) return;
    fillTip(tip, segment);
    placeTip(tip, event.clientX, event.clientY);
  });
  trackEl.addEventListener("pointerout", (event) => {
    if (!hover()) return;
    const segment = event.target.closest?.(".seg");
    if (!segment) return;
    const next = event.relatedTarget?.closest?.(".seg");
    if (next && trackEl.contains(next)) return;
    tip.hidden = true;
  });
  trackEl.addEventListener("click", (event) => {
    const segment = event.target.closest?.(".seg");
    if (!segment || hover()) return;
    if (!tip.hidden && tip.dataset.for === segment.dataset.id) {
      tip.hidden = true;
      return;
    }
    fillTip(tip, segment);
    const rect = segment.getBoundingClientRect();
    placeTip(tip, rect.left + rect.width / 2, rect.top);
  });
  trackEl.addEventListener("focusin", (event) => {
    const segment = event.target.closest?.(".seg");
    if (!segment) return;
    fillTip(tip, segment);
    const rect = segment.getBoundingClientRect();
    placeTip(tip, rect.left + rect.width / 2, rect.top);
  });
  trackEl.addEventListener("focusout", (event) => {
    const next = event.relatedTarget?.closest?.(".seg");
    if (next && trackEl.contains(next)) return;
    tip.hidden = true;
  });
  doc.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.(".seg") || event.target.closest?.(".tooltip")) return;
    tip.hidden = true;
  });
  trackEl.parentElement?.addEventListener("scroll", () => {
    tip.hidden = true;
  });
}

function paintTrack(container, items) {
  if (!container) return;
  const signature = items.map((item) => `${item.id}:${item.color}:${item.running ? 1 : 0}`).join("|");
  if (container.dataset.sig !== signature) {
    container.dataset.sig = signature;
    const buttons = items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "seg";
      button.dataset.id = item.id;
      button.style.background = item.color;
      button.setAttribute("role", "listitem");
      return button;
    });
    container.replaceChildren(...buttons);
  }
  const buttons = container.querySelectorAll(".seg");
  items.forEach((item, index) => {
    const button = buttons[index];
    if (!button) return;
    const seconds = item.durationMs / 1000;
    button.style.flexGrow = String(item.running ? Math.max(seconds, 0.35) : Math.max(seconds, 0));
    button.style.background = item.color;
    button.classList.toggle("running", item.running);
    button.dataset.title = item.title;
    button.dataset.length = formatWords(item.durationMs);
    button.dataset.total = formatWords(item.taskTotalMs);
    button.dataset.color = item.color;
    const same = Math.abs(item.taskTotalMs - item.durationMs) < 1000;
    button.dataset.same = same ? "1" : "0";
    button.setAttribute(
      "aria-label",
      same
        ? `${item.title}, ${formatWords(item.durationMs)}`
        : `${item.title}, ${formatWords(item.durationMs)}, task total ${formatWords(item.taskTotalMs)}`,
    );
  });
  container.parentElement?.classList.toggle("has-segs", items.length > 0);
  const tip = container.closest(".float-root")?.querySelector("[data-tip]")
    || (container === track ? tooltip : null);
  if (tip && !tip.hidden && tip.dataset.for) {
    const live = container.querySelector(`.seg[data-id="${CSS.escape(tip.dataset.for)}"]`);
    if (live) fillTip(tip, live);
    else tip.hidden = true;
  }
}

function paintDots(container, tasks, activeId) {
  const signature = tasks.map((task) => `${task.id}:${task.color}:${task.id === activeId}`).join("|");
  if (container.dataset.sig === signature) return;
  container.dataset.sig = signature;
  container.replaceChildren();
  for (const task of tasks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dot";
    button.dataset.task = task.id;
    button.style.background = task.color;
    button.setAttribute("aria-label", task.id === activeId ? `Stop ${task.title}` : `Start ${task.title}`);
    button.setAttribute("aria-pressed", String(task.id === activeId));
    container.appendChild(button);
  }
}

function createTaskRow(task) {
  const item = document.createElement("li");
  item.className = "task";
  item.dataset.id = task.id;
  const main = document.createElement("button");
  main.type = "button";
  main.className = "task-main";
  const title = document.createElement("span");
  title.className = "task-title";
  const titleText = document.createElement("span");
  titleText.className = "task-title-text";
  title.appendChild(titleText);
  main.appendChild(title);
  main.addEventListener("click", () => {
    const id = item.dataset.id;
    if (activeTask(state)?.id === id) requestStop();
    else requestStart(id);
  });

  const side = document.createElement("div");
  side.className = "task-side";
  const time = document.createElement("span");
  time.className = "task-time";
  time.dataset.time = task.id;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "icon-btn";
  edit.append(pencilTemplate.content.cloneNode(true));
  edit.addEventListener("click", () => {
    closeConfirm();
    openEditor(item.dataset.id);
  });
  side.append(time, edit);
  item.append(main, side);
  return item;
}

function updateTaskRow(item, task, active, now) {
  item.style.setProperty("--c", task.color);
  item.classList.toggle("active", active?.id === task.id);
  item.classList.toggle("is-pending", pending?.taskId === task.id);
  item.querySelector(".task-title-text").textContent = task.title;
  const title = item.querySelector(".task-title");
  let badge = title.querySelector(".now");
  if (active?.id === task.id) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "now";
      badge.textContent = "Now";
      title.appendChild(badge);
    }
  } else if (badge) {
    badge.remove();
  }
  const main = item.querySelector(".task-main");
  let description = main.querySelector(".task-desc");
  if (task.description) {
    if (!description) {
      description = document.createElement("span");
      description.className = "task-desc";
      main.appendChild(description);
    }
    description.textContent = task.description;
  } else if (description) {
    description.remove();
  }
  main.setAttribute("aria-label", active?.id === task.id ? `Stop ${task.title}` : `Start ${task.title}`);
  const time = item.querySelector("[data-time]");
  time.dataset.time = task.id;
  time.textContent = formatClock(taskDuration(state, task.id, now));
  item.querySelector(".icon-btn").setAttribute("aria-label", `Edit ${task.title}`);
}

function animateReorder(nodes, before) {
  const moving = [];
  for (const node of nodes) {
    const first = before.get(node.dataset.id);
    if (!first) continue;
    const dy = first.top - node.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    node.style.transition = "none";
    node.style.transform = `translateY(${dy}px)`;
    moving.push(node);
  }
  if (!moving.length) return;
  const lead = nodes[0];
  if (moving.includes(lead)) lead.style.zIndex = "2";
  void taskList.offsetHeight;
  for (const node of moving) {
    node.style.transition = "";
    node.style.transform = "";
  }
  if (moving.includes(lead)) {
    lead.addEventListener("transitionend", () => {
      lead.style.zIndex = "";
    }, { once: true });
  }
}

function renderTasks(now) {
  const tasks = tasksForList(state);
  const active = activeTask(state);
  taskCount.textContent = tasks.length ? String(tasks.length) : "";
  taskEmpty.hidden = tasks.length > 0;
  const previous = [...taskList.children];
  const before = new Map(previous.map((el) => [el.dataset.id, el.getBoundingClientRect()]));
  const existing = new Map(previous.map((el) => [el.dataset.id, el]));
  const orderChanged = tasks.some((task, index) => previous[index]?.dataset.id !== task.id)
    || previous.length !== tasks.length;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (const el of previous) {
    if (!tasks.some((task) => task.id === el.dataset.id)) el.remove();
  }

  const nodes = [];
  for (const task of tasks) {
    let item = existing.get(task.id);
    if (!item) {
      item = createTaskRow(task);
      if (task.id === justAddedId) item.classList.add("just-added");
    }
    updateTaskRow(item, task, active, now);
    nodes.push(item);
    taskList.appendChild(item);
  }
  justAddedId = null;
  if (orderChanged && !reduce) animateReorder(nodes, before);
}

function paintFloat(root, now) {
  if (!root) return;
  const active = activeTask(state);
  const today = startOfDay(now);
  const clockEl = root.querySelector("[data-clock]");
  const nameEl = root.querySelector("[data-name]");
  const dot = root.querySelector("[data-dot]");
  const toggle = root.querySelector("[data-toggle]");
  clockEl.textContent = active
    ? formatClock(taskDuration(state, active.id, now))
    : formatClock(dayTotal(state, today, now));
  nameEl.textContent = active ? active.title : (state.tasks.length ? "Paused" : "Nothing running");
  nameEl.style.color = active && readable(active.color) ? active.color : "";
  dot.hidden = !active;
  if (active) {
    dot.style.setProperty("--dot", active.color);
    dot.style.background = active.color;
  }
  paintTrack(root.querySelector("[data-track]"), timelineSegments(state, today, now));
  paintDots(root.querySelector("[data-dots]"), tasksForList(state), active?.id || "");
  const label = runLabel();
  toggle.hidden = !label;
  toggle.textContent = label;
  const doc = root.ownerDocument;
  doc.title = active ? `${clockEl.textContent} · ${active.title}` : "Strand";
}

function paintLive(now) {
  const active = activeTask(state);
  const today = startOfDay(now);
  const todayMs = dayTotal(state, today, now);
  const viewing = viewedDay(now);
  const items = timelineSegments(state, viewing, now);

  clock.textContent = active ? formatClock(taskDuration(state, active.id, now)) : formatClock(todayMs);
  activeName.textContent = active ? active.title : (state.tasks.length ? "Paused" : "Nothing running");
  activeName.style.color = active && readable(active.color) ? active.color : "";
  hero.style.setProperty("--active", active ? active.color : "transparent");
  liveDot.hidden = !active;
  if (active) {
    liveDot.style.setProperty("--dot", active.color);
    liveDot.style.background = active.color;
  }
  todayLine.textContent = active
    ? `Today ${formatClock(todayMs)}`
    : (state.tasks.length ? "Select a task to continue" : "Add a task, then select it to start");

  runBtn.hidden = !runLabel();
  runBtn.textContent = runLabel();

  dayLabel.textContent = formatDayLabel(viewing, now);
  dayLabel.setAttribute("aria-label", viewing === today ? "Today" : "Back to today");
  dayNext.disabled = viewing >= today;
  dayPrev.disabled = viewing <= earliestDay(state, now);
  trackEmpty.textContent = viewing === today ? "Colors collect here as you work." : "Nothing tracked this day.";
  paintTrack(track, items);

  if (viewing === today) {
    viewedTotal.hidden = true;
  } else {
    const dayMs = items.reduce((sum, item) => sum + item.durationMs, 0);
    viewedTotal.hidden = false;
    viewedTotal.textContent = `${formatClock(dayMs)} on this day`;
  }

  for (const el of taskList.querySelectorAll("[data-time]")) {
    el.textContent = formatClock(taskDuration(state, el.dataset.time, now));
  }

  if (!floatMode) {
    document.title = active ? `${clock.textContent} · ${active.title} · Strand` : "Strand";
  }
  if (floatSink) paintFloat(floatSink, now);
  if (floatMode) paintFloat(floatRoot, now);
}

function render() {
  const now = Date.now();
  renderTasks(now);
  paintLive(now);
}

function confirmNodes() {
  const nodes = [];
  if (!floatMode && actionConfirm) nodes.push(actionConfirm);
  if (floatMode) {
    const local = floatRoot.querySelector("[data-confirm]");
    if (local) nodes.push(local);
  }
  const pip = floatSink?.querySelector("[data-confirm]");
  if (pip) nodes.push(pip);
  return nodes;
}

function showConfirm() {
  if (!pending) return;
  for (const node of confirmNodes()) {
    const copy = node.querySelector("[data-confirm-copy]");
    const ok = node.querySelector("[data-confirm-ok]");
    if (copy) copy.textContent = pending.copy;
    if (ok) ok.textContent = pending.ok;
    node.hidden = false;
  }
  document.body.classList.toggle("confirming", !floatMode);
  for (const row of taskList.querySelectorAll(".task")) {
    row.classList.toggle("is-pending", row.dataset.id === pending.taskId);
  }
}

function closeConfirm() {
  pending = null;
  for (const node of confirmNodes()) node.hidden = true;
  document.body.classList.remove("confirming");
  for (const row of taskList.querySelectorAll(".is-pending")) row.classList.remove("is-pending");
}

function openConfirm(action) {
  pending = action;
  showConfirm();
  const owner = document.activeElement?.ownerDocument || document;
  const local = confirmNodes().find((node) => node.ownerDocument === owner);
  local?.querySelector("[data-confirm-ok]")?.focus();
}

function requestStart(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const active = activeTask(state);
  if (active?.id === taskId) return;
  if (active) {
    openConfirm({
      kind: "switch",
      taskId,
      copy: `Stop ${active.title} and start ${task.title}?`,
      ok: "Switch",
    });
    return;
  }
  const resumed = state.segments.some((segment) => segment.taskId === taskId);
  openConfirm({
    kind: "start",
    taskId,
    copy: resumed ? `Resume ${task.title}?` : `Start ${task.title}?`,
    ok: resumed ? "Resume" : "Start",
  });
}

function requestStop() {
  const active = activeTask(state);
  if (!active) {
    const task = lastTask(state);
    if (task) requestStart(task.id);
    return;
  }
  openConfirm({
    kind: "stop",
    taskId: active.id,
    copy: `Stop ${active.title}?`,
    ok: "Stop",
  });
}

function commitStart(taskId) {
  const now = Date.now();
  const next = selectTask(state, taskId, now);
  if (next === state) return;
  state = next;
  pinnedDay = null;
  persist();
  render();
}

function commitStop() {
  if (!activeTask(state)) return;
  state = pause(state, Date.now());
  persist();
  render();
}

function commitPending() {
  const action = pending;
  if (!action) return;
  closeConfirm();
  if (action.kind === "stop") commitStop();
  else commitStart(action.taskId);
}

function runLabel() {
  if (activeTask(state)) return "Pause";
  if (state.segments.length) return "Resume";
  if (state.tasks.length) return "Start";
  return "";
}

function toggleRun() {
  if (activeTask(state)) requestStop();
  else {
    const task = lastTask(state);
    if (task) requestStart(task.id);
  }
}

function openEditor(taskId) {
  closeConfirm();
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const parts = splitDuration(taskDuration(state, task.id, Date.now()));
  editorState = { id: task.id, color: task.color, time: parts };
  editTitle.value = task.title;
  editDesc.value = task.description || "";
  editH.value = String(parts.h);
  editM.value = String(parts.m);
  editS.value = String(parts.s);
  buildEditorSwatches();
  if (!editor.open) editor.showModal();
  editTitle.focus();
}

function timeDirty() {
  if (!editorState) return false;
  return readInt(editH.value) !== editorState.time.h
    || readInt(editM.value) !== editorState.time.m
    || readInt(editS.value) !== editorState.time.s;
}

async function copyTimes() {
  const now = Date.now();
  const tsv = toTsv(state, now);
  const html = toHtml(state, now);
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tsv);
    } else {
      throw new Error("Clipboard unavailable");
    }
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = tsv;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function setupFloatSurface(root) {
  if (!root || root.dataset.ready === "1") return;
  root.dataset.ready = "1";
  const trackEl = root.querySelector("[data-track]");
  if (trackEl) trackEl.dataset.bound = "";
  bindTrack(trackEl, root.querySelector("[data-tip]"));
  root.querySelector("[data-toggle]")?.addEventListener("click", () => toggleRun());
  root.querySelector("[data-dots]")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-task]");
    if (!button) return;
    if (activeTask(state)?.id === button.dataset.task) requestStop();
    else requestStart(button.dataset.task);
  });
  root.querySelector("[data-confirm-ok]")?.addEventListener("click", () => commitPending());
  root.querySelector("[data-confirm-cancel]")?.addEventListener("click", () => closeConfirm());
}

async function openFloat() {
  closeMenu();
  if ("documentPictureInPicture" in window) {
    try {
      if (documentPictureInPicture.window) {
        documentPictureInPicture.window.focus();
        return;
      }
      const pip = await documentPictureInPicture.requestWindow({ width: 420, height: 280 });
      const base = pip.document.createElement("base");
      base.href = new URL("./", location.href).href;
      pip.document.head.appendChild(base);
      const style = pip.document.createElement("style");
      style.textContent = [...document.styleSheets].map((sheet) => {
        try {
          return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
        } catch {
          return "";
        }
      }).join("\n");
      pip.document.head.appendChild(style);
      pip.document.documentElement.lang = "en";
      pip.document.documentElement.dataset.theme = document.documentElement.dataset.theme || "dark";
      pip.document.body.classList.add("float-mode");
      pip.document.body.style.margin = "0";
      const clone = floatRoot.cloneNode(true);
      clone.dataset.ready = "";
      const clonedTrack = clone.querySelector("[data-track]");
      if (clonedTrack) clonedTrack.dataset.bound = "";
      pip.document.body.appendChild(clone);
      setupFloatSurface(clone);
      floatSink = clone;
      paintFloat(clone, Date.now());
      if (pending) showConfirm();
      pip.addEventListener("pagehide", () => {
        if (floatSink === clone) floatSink = null;
      });
      return;
    } catch (error) {
      if (error?.name === "NotAllowedError") {
        toast("The floating window was dismissed.");
        return;
      }
    }
  }

  const popup = window.open(
    new URL("?view=float", location.href).href,
    "strand-float",
    "popup=yes,width=440,height=320",
  );
  if (!popup) toast("Allow pop-ups to open the floating window.");
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) {
    titleInput.focus();
    return;
  }
  const before = state.tasks.length;
  state = addTask(state, { title, color: selectedColor }, Date.now());
  if (state.tasks.length === before) return;
  const added = state.tasks[state.tasks.length - 1];
  justAddedId = added.id;
  if (PALETTE.includes(selectedColor.toLowerCase())) {
    const index = PALETTE.indexOf(selectedColor.toLowerCase());
    selectedColor = PALETTE[(index + 1) % PALETTE.length];
    paintComposerSwatches();
  }
  titleInput.value = "";
  persist();
  render();
  toast(`Added ${added.title}. Select it to start.`);
});

runBtn.addEventListener("click", () => toggleRun());
dayPrev.addEventListener("click", () => {
  pinnedDay = previousDay(viewedDay(Date.now()));
  render();
});
dayNext.addEventListener("click", () => {
  const today = startOfDay(Date.now());
  const next = nextDay(viewedDay(Date.now()));
  pinnedDay = next >= today ? null : next;
  render();
});
dayLabel.addEventListener("click", () => {
  pinnedDay = null;
  render();
});

menuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMenu();
});
document.addEventListener("click", (event) => {
  if (!menu.hidden && !menu.contains(event.target)) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (pending) {
    closeConfirm();
    return;
  }
  closeMenu();
});
document.addEventListener("pointerdown", (event) => {
  if (!pending) return;
  if (event.target.closest(".action-confirm, .float-confirm, .task-main, [data-task], #run-btn, [data-toggle]")) return;
  closeConfirm();
});
actionConfirm?.querySelector("[data-confirm-ok]")?.addEventListener("click", () => commitPending());
actionConfirm?.querySelector("[data-confirm-cancel]")?.addEventListener("click", () => closeConfirm());

menu.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  closeMenu();
  const now = Date.now();
  if (action === "copy") {
    const ok = await copyTimes();
    toast(ok ? "Copied. Paste into Google Sheets or anywhere else." : "Could not copy. Try Download CSV.");
  } else if (action === "sheets") {
    const copyPromise = copyTimes();
    const popup = window.open("https://sheets.new", "_blank", "noopener");
    const ok = await copyPromise;
    if (ok && popup) {
      toast("Copied. Paste into the new Google Sheet with ⌘V or Ctrl+V.");
    } else if (ok) {
      toast("Copied. Allow pop-ups, or open Google Sheets and paste.");
    } else {
      download(`strand-timesheet-${fileDate(now)}.csv`, toCsv(state, now), "text/csv");
      toast(popup
        ? "Clipboard was blocked. A CSV downloaded — import it into the sheet."
        : "Could not open Sheets or copy. A CSV downloaded instead.");
    }
  } else if (action === "csv") {
    download(`strand-timesheet-${fileDate(now)}.csv`, toCsv(state, now), "text/csv");
    toast("CSV downloaded.");
  } else if (action === "backup") {
    download(
      `strand-backup-${fileDate(now)}.json`,
      JSON.stringify(exportBackup(state, now), null, 2),
      "application/json",
    );
    toast("Backup downloaded. A running timer is saved as paused time.");
  } else if (action === "import") {
    importFile.click();
  } else if (action === "install" && deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt = null;
    installBtn.hidden = true;
  }
});

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  if (file.size > 5_000_000) {
    toast("That file is too large.");
    return;
  }
  let parsed;
  try {
    parsed = importBackup(await file.text());
  } catch (error) {
    toast(error instanceof SyntaxError ? "That file is not valid JSON." : error.message);
    return;
  }
  const ok = await askConfirm({
    title: "Replace time on this device?",
    message: `This backup has ${parsed.tasks.length} task${parsed.tasks.length === 1 ? "" : "s"}. It replaces everything stored in this browser.`,
    confirmLabel: "Replace",
  });
  if (!ok) return;
  state = parsed;
  pinnedDay = null;
  persist();
  render();
  toast("Backup imported.");
});

floatBtn.addEventListener("click", () => openFloat());

editorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editorState) return;
  const title = editTitle.value.trim();
  if (!title) {
    editTitle.focus();
    return;
  }
  const hours = readInt(editH.value);
  const minutes = readInt(editM.value);
  const seconds = readInt(editS.value);
  const patch = {
    title,
    description: editDesc.value.trim(),
    color: editorState.color,
  };
  const dirty = timeDirty();
  if (dirty) {
    if (hours * 3600 + minutes * 60 + seconds > MAX_HOURS * 3600) {
      toast("Time is limited to 10,000 hours.");
      return;
    }
    patch.durationMs = durationFromParts(hours, minutes, seconds);
  }
  state = updateTask(state, editorState.id, patch, Date.now());
  persist();
  editor.close();
  editorState = null;
  render();
  toast(dirty ? "Time updated. Timeline redrawn." : "Task saved.");
});

editCancel.addEventListener("click", () => editor.close());
editor.addEventListener("close", () => {
  editorState = null;
});
editor.addEventListener("click", (event) => {
  if (event.target === editor) editor.close();
});

editDelete.addEventListener("click", async () => {
  if (!editorState) return;
  const task = state.tasks.find((item) => item.id === editorState.id);
  if (!task) return;
  const ok = await askConfirm({
    title: `Delete ${task.title}?`,
    message: "Its tracked time leaves the timeline.",
    confirmLabel: "Delete",
  });
  if (!ok) return;
  state = deleteTask(state, task.id);
  persist();
  editor.close();
  editorState = null;
  render();
  toast(`Deleted ${task.title}`);
});

for (const input of [editH, editM, editS]) {
  input.addEventListener("wheel", (event) => {
    if (document.activeElement === input) event.preventDefault();
  }, { passive: false });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.hidden = false;
});

const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (ios && !standalone) iosHint.hidden = false;

channel?.addEventListener("message", (event) => {
  if (event.data?.type === "state") applyRemote(event.data.state);
  if (event.data?.type === "theme") applyTheme(event.data.theme, { paint: true });
});
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY && event.newValue) applyRemote(event.newValue);
  if (event.key === THEME_KEY) applyTheme(event.newValue, { paint: true });
});

themeBtn?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next, { persist: true, paint: true });
});
matchMedia("(prefers-color-scheme: light)").addEventListener("change", (event) => {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  if (stored === "light" || stored === "dark") return;
  applyTheme(event.matches ? "light" : "dark", { paint: true });
});
applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");

if (floatMode) document.body.classList.add("float-mode");
buildComposerSwatches();
bindTrack(track, tooltip);
setupFloatSurface(floatRoot);
render();
setInterval(() => paintLive(Date.now()), 250);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) paintLive(Date.now());
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
