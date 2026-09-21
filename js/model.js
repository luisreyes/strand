export const PALETTE = [
  "#ff6b4a",
  "#f0a202",
  "#d6e07a",
  "#3ecf8e",
  "#2bbbad",
  "#5aa9ff",
  "#8b7cff",
  "#ef6fad",
];

const MAX_TASKS = 20000;
const MAX_SEGMENTS = 50000;
const MAX_DURATION_MS = 10000 * 60 * 60 * 1000;

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyState() {
  return { app: "strand", version: 1, tasks: [], segments: [] };
}

export function sanitizeColor(value) {
  if (typeof value !== "string") return PALETTE[0];
  const match = value.trim().match(/^#([0-9a-fA-F]{6})$/);
  return match ? `#${match[1].toLowerCase()}` : PALETTE[0];
}

export function startOfDay(ts) {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function nextDay(dayStart) {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function previousDay(dayStart) {
  const date = new Date(dayStart);
  date.setDate(date.getDate() - 1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatWords(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function splitDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

export function durationFromParts(hours, minutes, seconds) {
  const h = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  const m = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return Math.min(Math.round((h * 3600 + m * 60 + s) * 1000), MAX_DURATION_MS);
}

export function formatDayLabel(dayStart, now) {
  const today = startOfDay(now);
  const date = new Date(dayStart).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (dayStart === today) return `Today · ${date}`;
  if (dayStart === previousDay(today)) return `Yesterday · ${date}`;
  return date;
}

export function segmentDuration(segment, now) {
  const end = segment.end == null ? now : segment.end;
  return Math.max(0, end - segment.start + (segment.offsetMs || 0));
}

// Spread a manual offset across the days a segment touches so the
// day bars still add up to the task total. Added time lands on the
// latest day; removed time is taken from the end backward.
export function segmentPieces(segment, now) {
  const open = segment.end == null;
  const end = open ? now : segment.end;
  const start = Math.min(segment.start, Number.isFinite(end) ? end : segment.start);
  const slices = [];
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    let cursor = start;
    while (cursor < end && slices.length < 5000) {
      const day = startOfDay(cursor);
      const boundary = nextDay(day);
      const sliceEnd = Math.min(end, boundary);
      if (sliceEnd <= cursor) break;
      slices.push({ day, ms: sliceEnd - cursor });
      cursor = sliceEnd;
    }
  }
  if (!slices.length) {
    slices.push({ day: startOfDay(open ? now : start), ms: 0 });
  }

  const durations = slices.map((slice) => slice.ms);
  const offset = segment.offsetMs || 0;
  if (offset >= 0) {
    durations[durations.length - 1] += offset;
  } else {
    let cut = -offset;
    for (let index = durations.length - 1; index >= 0 && cut > 0; index -= 1) {
      const take = Math.min(durations[index], cut);
      durations[index] -= take;
      cut -= take;
    }
  }

  const today = startOfDay(now);
  return slices.map((slice, index) => ({
    day: slice.day,
    durationMs: durations[index],
    running: open && slice.day === today,
  }));
}

export function taskDuration(state, taskId, now) {
  return state.segments.reduce((sum, segment) => {
    if (segment.taskId !== taskId) return sum;
    return sum + segmentDuration(segment, now);
  }, 0);
}

export function activeSegment(state) {
  return state.segments.find((segment) => segment.end == null) || null;
}

export function activeTask(state) {
  const segment = activeSegment(state);
  if (!segment) return null;
  return state.tasks.find((task) => task.id === segment.taskId) || null;
}

export function lastTask(state) {
  const ordered = [...state.segments].sort((a, b) => b.start - a.start);
  for (const segment of ordered) {
    const task = state.tasks.find((item) => item.id === segment.taskId);
    if (task) return task;
  }
  return state.tasks[state.tasks.length - 1] || null;
}

export function earliestDay(state, now) {
  if (!state.segments.length) return startOfDay(now);
  let min = Infinity;
  for (const segment of state.segments) {
    if (segment.start < min) min = segment.start;
  }
  return startOfDay(min);
}

export function tasksForList(state) {
  const active = activeTask(state);
  const latest = new Map();
  for (const segment of state.segments) {
    const prev = latest.get(segment.taskId) ?? -1;
    if (segment.start > prev) latest.set(segment.taskId, segment.start);
  }
  return [...state.tasks].sort((a, b) => {
    if (active) {
      if (a.id === active.id) return -1;
      if (b.id === active.id) return 1;
    }
    const byRecent = (latest.get(b.id) ?? -1) - (latest.get(a.id) ?? -1);
    if (byRecent) return byRecent;
    return b.createdAt - a.createdAt;
  });
}

export function timelineSegments(state, dayStart, now) {
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  const totals = new Map();
  for (const segment of state.segments) {
    totals.set(segment.taskId, (totals.get(segment.taskId) || 0) + segmentDuration(segment, now));
  }
  const ordered = [...state.segments].sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)));
  const items = [];
  for (const segment of ordered) {
    const task = tasks.get(segment.taskId);
    if (!task) continue;
    for (const piece of segmentPieces(segment, now)) {
      if (piece.day !== dayStart) continue;
      if (piece.durationMs <= 0 && !piece.running) continue;
      items.push({
        id: segment.id,
        taskId: task.id,
        title: task.title,
        color: task.color,
        durationMs: piece.durationMs,
        running: piece.running,
        taskTotalMs: totals.get(task.id) || 0,
      });
    }
  }
  return items;
}

export function dayTotal(state, dayStart, now) {
  return timelineSegments(state, dayStart, now).reduce((sum, item) => sum + item.durationMs, 0);
}

export function taskTimeOnDay(state, taskId, dayStart, now) {
  return state.segments.reduce((sum, segment) => {
    if (segment.taskId !== taskId) return sum;
    const piece = segmentPieces(segment, now).find((item) => item.day === dayStart);
    return sum + (piece?.durationMs || 0);
  }, 0);
}

export function addTask(state, input, now) {
  const title = String(input.title || "").trim().slice(0, 120);
  if (!title) return state;
  const task = {
    id: uid(),
    title,
    description: "",
    color: sanitizeColor(input.color),
    createdAt: now,
  };
  return { ...state, tasks: [...state.tasks, task] };
}

export function selectTask(state, taskId, now) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return state;
  const open = activeSegment(state);
  if (open && open.taskId === taskId) return state;
  const segments = state.segments.map((segment) => (
    segment.end == null ? { ...segment, end: now } : segment
  ));
  segments.push({
    id: uid(),
    taskId,
    start: now,
    end: null,
    offsetMs: 0,
  });
  return { ...state, segments };
}

export function pause(state, now) {
  if (!activeSegment(state)) return state;
  return {
    ...state,
    segments: state.segments.map((segment) => (
      segment.end == null ? { ...segment, end: now } : segment
    )),
  };
}

export function setTaskDuration(state, taskId, desiredMs, now) {
  const desired = Math.max(0, Math.min(MAX_DURATION_MS, Math.round(desiredMs)));
  const mine = state.segments.filter((segment) => segment.taskId === taskId);
  const current = mine.reduce((sum, segment) => sum + segmentDuration(segment, now), 0);
  let delta = desired - current;
  if (delta === 0) return state;

  if (!mine.length) {
    if (desired === 0) return state;
    return {
      ...state,
      segments: [
        ...state.segments,
        {
          id: uid(),
          taskId,
          start: now - desired,
          end: now,
          offsetMs: 0,
        },
      ],
    };
  }

  const offsets = new Map(mine.map((segment) => [segment.id, segment.offsetMs || 0]));
  const ordered = [...mine].sort((a, b) => a.start - b.start);
  if (delta > 0) {
    const last = ordered[ordered.length - 1];
    offsets.set(last.id, (offsets.get(last.id) || 0) + delta);
  } else {
    for (let index = ordered.length - 1; index >= 0 && delta < 0; index -= 1) {
      const segment = ordered[index];
      const duration = Math.max(
        0,
        (segment.end == null ? now : segment.end) - segment.start + (offsets.get(segment.id) || 0),
      );
      const cut = Math.min(duration, -delta);
      offsets.set(segment.id, (offsets.get(segment.id) || 0) - cut);
      delta += cut;
    }
  }

  return {
    ...state,
    segments: state.segments.map((segment) => (
      offsets.has(segment.id) ? { ...segment, offsetMs: offsets.get(segment.id) } : segment
    )),
  };
}

export function updateTask(state, taskId, patch, now) {
  if (!state.tasks.some((task) => task.id === taskId)) return state;
  let next = {
    ...state,
    tasks: state.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const updated = { ...task };
      if (patch.title != null) {
        const title = String(patch.title).trim().slice(0, 120);
        if (title) updated.title = title;
      }
      if (patch.description != null) {
        updated.description = String(patch.description).trim().slice(0, 2000);
      }
      if (patch.color != null) updated.color = sanitizeColor(patch.color);
      return updated;
    }),
  };
  if (patch.durationMs != null && Number.isFinite(patch.durationMs)) {
    next = setTaskDuration(next, taskId, patch.durationMs, now);
  }
  return next;
}

export function deleteTask(state, taskId) {
  return {
    ...state,
    tasks: state.tasks.filter((task) => task.id !== taskId),
    segments: state.segments.filter((segment) => segment.taskId !== taskId),
  };
}

export function exportBackup(state, now = Date.now()) {
  return {
    app: "strand",
    version: 1,
    exportedAt: new Date(now).toISOString(),
    tasks: state.tasks.map((task) => ({ ...task })),
    segments: state.segments.map((segment) => {
      if (segment.end != null) return { ...segment };
      const duration = segmentDuration(segment, now);
      return {
        ...segment,
        start: now - duration,
        end: now,
        offsetMs: 0,
      };
    }),
  };
}

export function importBackup(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!data || typeof data !== "object" || !Array.isArray(data.tasks) || !Array.isArray(data.segments)) {
    throw new Error("This file is not a Strand backup.");
  }
  if (data.version != null && Number(data.version) > 1) {
    throw new Error("This backup is from a newer version of Strand.");
  }
  if (data.tasks.length > MAX_TASKS || data.segments.length > MAX_SEGMENTS) {
    throw new Error("That backup is too large.");
  }

  const seenTasks = new Set();
  const tasks = [];
  for (const task of data.tasks) {
    if (!task || typeof task !== "object") continue;
    let id = typeof task.id === "string" && task.id ? task.id : uid();
    while (seenTasks.has(id)) id = uid();
    seenTasks.add(id);
    const title = String(task.title || "").trim().slice(0, 120) || "Untitled";
    tasks.push({
      id,
      title,
      description: String(task.description || "").trim().slice(0, 2000),
      color: sanitizeColor(task.color),
      createdAt: Number.isFinite(Number(task.createdAt)) ? Number(task.createdAt) : Date.now(),
    });
  }

  const taskIds = new Set(tasks.map((task) => task.id));
  const seenSegments = new Set();
  const segments = [];
  for (const segment of data.segments) {
    if (!segment || typeof segment !== "object") continue;
    if (!taskIds.has(segment.taskId)) continue;
    let id = typeof segment.id === "string" && segment.id ? segment.id : uid();
    while (seenSegments.has(id)) id = uid();
    seenSegments.add(id);
    const start = Number(segment.start);
    if (!Number.isFinite(start)) continue;
    let end = segment.end == null ? null : Number(segment.end);
    if (end != null && !Number.isFinite(end)) end = null;
    if (end != null && end < start) end = start;
    const offsetMs = Number.isFinite(Number(segment.offsetMs)) ? Math.round(Number(segment.offsetMs)) : 0;
    segments.push({ id, taskId: segment.taskId, start, end, offsetMs });
  }
  segments.sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)));
  const opens = segments.filter((segment) => segment.end == null);
  for (let index = 0; index < opens.length - 1; index += 1) {
    opens[index].end = opens[index + 1].start;
  }
  return { app: "strand", version: 1, tasks, segments };
}

function plainCell(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ").replace(/\t/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return text;
}

function csvCell(value) {
  return `"${plainCell(value).replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return plainCell(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatStamp(ts) {
  const date = new Date(ts);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDayKey(ts) {
  const date = new Date(ts);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function buildSheet(state, now) {
  const today = startOfDay(now);
  const summary = {
    title: "Summary",
    headers: ["Task", "Description", "Color", "Total", "Total Hours", "Today", "Today Hours"],
    rows: state.tasks.map((task) => {
      const total = taskDuration(state, task.id, now);
      const todayMs = taskTimeOnDay(state, task.id, today, now);
      return [
        task.title,
        task.description || "",
        task.color,
        formatClock(total),
        (total / 3600000).toFixed(2),
        formatClock(todayMs),
        (todayMs / 3600000).toFixed(2),
      ];
    }),
  };
  const segments = {
    title: "Segments",
    headers: ["Date", "Task", "Description", "Color", "Start", "End", "Duration", "Hours"],
    rows: [...state.segments]
      .sort((a, b) => a.start - b.start)
      .map((segment) => {
        const task = state.tasks.find((item) => item.id === segment.taskId);
        const duration = segmentDuration(segment, now);
        return [
          formatDayKey(segment.start),
          task?.title || "Untitled",
          task?.description || "",
          task?.color || "",
          formatStamp(segment.start),
          segment.end == null ? "" : formatStamp(segment.end),
          formatClock(duration),
          (duration / 3600000).toFixed(2),
        ];
      }),
  };
  return { summary, segments };
}

function tableToDelimited(table, delimiter) {
  const join = (row) => row.map((cell) => (delimiter === "," ? csvCell(cell) : plainCell(cell))).join(delimiter);
  return [plainCell(table.title), join(table.headers), ...table.rows.map(join)].join(delimiter === "," ? "\r\n" : "\n");
}

export function toCsv(state, now) {
  const { summary, segments } = buildSheet(state, now);
  return `${tableToDelimited(summary, ",")}\r\n\r\n${tableToDelimited(segments, ",")}\r\n`;
}

export function toTsv(state, now) {
  const { summary, segments } = buildSheet(state, now);
  return `${tableToDelimited(summary, "\t")}\n\n${tableToDelimited(segments, "\t")}\n`;
}

export function toHtml(state, now) {
  const { summary, segments } = buildSheet(state, now);
  const table = (block) => {
    const head = block.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("");
    const body = block.rows
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
      .join("");
    return `<h2>${escapeHtml(block.title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  };
  return `<!DOCTYPE html><html><body>${table(summary)}${table(segments)}</body></html>`;
}
