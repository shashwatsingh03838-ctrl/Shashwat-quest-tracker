import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Flame,
  Plus,
  Trash2,
  Trophy,
  Sparkles,
  Check,
  X,
  Calendar,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Pencil,
} from "lucide-react";

const STORAGE_KEY = "quest-tracker-state";

// Local storage shim (this file runs in a real browser via Vite, not inside
// Claude's artifact sandbox, so we use the browser's own localStorage here)
const storage = {
  async get(key) {
    const val = localStorage.getItem(key);
    return val === null ? null : { key, value: val };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const dateOffset = (dateStr, offset) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + offset);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;
};

const dayOfWeek = (dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay(); // 0 = Sunday ... 6 = Saturday
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const isScheduledForDate = (task, dateStr) => {
  const sched = task.schedule || { type: "daily" };
  if (sched.type === "weekly") {
    return (sched.days || []).includes(dayOfWeek(dateStr));
  }
  if (sched.type === "specific") {
    return sched.date === dateStr;
  }
  return true; // daily
};

const scheduleLabel = (task) => {
  const sched = task.schedule || { type: "daily" };
  if (sched.type === "weekly") {
    return (sched.days || []).map((d) => WEEKDAY_LABELS[d]).join("/");
  }
  if (sched.type === "specific") {
    const d = new Date(`${sched.date}T00:00:00`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return null;
};

// Walks backward from `todayDs`, counting consecutive completed scheduled days.
// A scheduled-but-incomplete day breaks the streak — EXCEPT if it's today, since
// today isn't over yet. This means a missed day shows up as a broken streak (0)
// as soon as it's in the past, with no need for the user to touch anything.
const computeStreakUpTo = (todayDs, isScheduledFn, isDoneFn) => {
  let streak = 0;
  let cursor = todayDs;
  let first = true;
  for (let i = 0; i < 3650; i++) {
    if (isScheduledFn(cursor)) {
      if (isDoneFn(cursor)) {
        streak++;
        cursor = dateOffset(cursor, -1);
        first = false;
        continue;
      }
      if (first) {
        // today, not done yet — grace period, don't break, just don't count it
        cursor = dateOffset(cursor, -1);
        first = false;
        continue;
      }
      break;
    }
    cursor = dateOffset(cursor, -1);
    first = false;
  }
  return streak;
};

const levelFromXP = (xp) => {
  // escalating threshold: level n needs n*120 xp cumulative-ish
  let level = 1;
  let remaining = xp;
  let need = 120;
  while (remaining >= need) {
    remaining -= need;
    level += 1;
    need = 120 + level * 30;
  }
  return { level, into: remaining, need };
};

const defaultTemplates = [
  { id: "t1", name: "Deep work block", target: 1, unit: "", xp: 40, schedule: { type: "daily" } },
  { id: "t2", name: "Read", target: 20, unit: "pages", xp: 30, schedule: { type: "daily" } },
  { id: "t3", name: "Move your body", target: 1, unit: "", xp: 25, schedule: { type: "daily" } },
];

export default function QuestTracker() {
  const [templates, setTemplates] = useState(defaultTemplates);
  const [dailyLogs, setDailyLogs] = useState({});
  const [xp, setXp] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskTarget, setNewTaskTarget] = useState("1");
  const [newTaskUnit, setNewTaskUnit] = useState("");
  const [newTaskXp, setNewTaskXp] = useState("20");
  const [newTaskSchedule, setNewTaskSchedule] = useState("daily"); // 'daily' | 'weekly' | 'specific'
  const [newTaskDays, setNewTaskDays] = useState([]);
  const [newTaskDate, setNewTaskDate] = useState(() => dateOffset(todayStr(), 1));
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState(null);
  const [openCalendar, setOpenCalendar] = useState(null); // null | {type:'main'} | {type:'task', task}
  const [confirmReset, setConfirmReset] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);

  const today = todayStr();

  // load
  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setTemplates(parsed.templates?.length ? parsed.templates : defaultTemplates);
          setDailyLogs(parsed.dailyLogs || {});
          setXp(parsed.xp || 0);
        }
      } catch (e) {
        // no existing data yet, fine
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next) => {
    try {
      await storage.set(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.error("Failed to save", e);
    }
  }, []);

  const saveAll = useCallback(
    (updates) => {
      const next = {
        templates,
        dailyLogs,
        xp,
        ...updates,
      };
      setTemplates(next.templates);
      setDailyLogs(next.dailyLogs);
      setXp(next.xp);
      persist(next);
    },
    [templates, dailyLogs, xp, persist]
  );

  const todayLog = dailyLogs[today] || {};

  const scheduledToday = useMemo(
    () => templates.filter((t) => isScheduledForDate(t, today)),
    [templates, today]
  );
  const otherTemplates = useMemo(
    () => templates.filter((t) => !isScheduledForDate(t, today)),
    [templates, today]
  );

  const totals = useMemo(() => {
    let sumCurrent = 0;
    let sumTarget = 0;
    scheduledToday.forEach((t) => {
      sumCurrent += Math.min(todayLog[t.id] || 0, t.target);
      sumTarget += t.target;
    });
    return { sumCurrent, sumTarget };
  }, [scheduledToday, todayLog]);

  const mainProgress = totals.sumTarget > 0 ? totals.sumCurrent / totals.sumTarget : 0;
  const allComplete = scheduledToday.length > 0 && mainProgress >= 1;

  const { level, into, need } = levelFromXP(xp);

  // --- Derived completion + streak helpers (computed fresh from history, never stored) ---
  const scheduledForDate = useCallback(
    (dateStr) => templates.filter((t) => isScheduledForDate(t, dateStr)),
    [templates]
  );

  const mainCompleteOn = useCallback(
    (logsObj, dateStr) => {
      const scheduled = scheduledForDate(dateStr);
      if (scheduled.length === 0) return false;
      const log = logsObj[dateStr] || {};
      const sumTarget = scheduled.reduce((s, t) => s + t.target, 0);
      const sumCurrent = scheduled.reduce((s, t) => s + Math.min(log[t.id] || 0, t.target), 0);
      return sumTarget > 0 && sumCurrent >= sumTarget;
    },
    [scheduledForDate]
  );

  const mainStreakOn = useCallback(
    (logsObj, dateStr) =>
      computeStreakUpTo(
        dateStr,
        (ds) => scheduledForDate(ds).length > 0,
        (ds) => mainCompleteOn(logsObj, ds)
      ),
    [scheduledForDate, mainCompleteOn]
  );

  const taskCompleteOn = (logsObj, task, dateStr) => (logsObj[dateStr]?.[task.id] || 0) >= task.target;

  const taskStreakOn = (logsObj, task, dateStr) =>
    computeStreakUpTo(
      dateStr,
      (ds) => isScheduledForDate(task, ds),
      (ds) => taskCompleteOn(logsObj, task, ds)
    );

  // Values shown right now, derived live from stored history + today's date.
  // Missing a scheduled day always shows up as a broken streak automatically —
  // nothing is cached, so there's no stale number to correct.
  const streak = mainStreakOn(dailyLogs, today);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const updateTaskProgress = (taskId, delta) => {
    const task = templates.find((t) => t.id === taskId);
    if (!task) return;
    const current = todayLog[taskId] || 0;
    const wasComplete = current >= task.target;
    const nextVal = Math.max(0, Math.min(task.target, current + delta));
    const nowComplete = nextVal >= task.target;

    const nextLog = { ...todayLog, [taskId]: nextVal };
    const nextDailyLogs = { ...dailyLogs, [today]: nextLog };

    const taskXp = task.xp ?? 20;
    const earnedXp = (val) => Math.round((Math.min(val, task.target) / task.target) * taskXp);
    const xpDelta = earnedXp(nextVal) - earnedXp(current);

    let nextXp = Math.max(0, xp + xpDelta);

    // day-complete bonus: compare before/after using the tasks actually scheduled today
    const wasAllComplete = mainCompleteOn(dailyLogs, today);
    const nowAllComplete = mainCompleteOn(nextDailyLogs, today);

    if (!wasAllComplete && nowAllComplete) {
      nextXp += 25;
      const streakAfter = mainStreakOn(nextDailyLogs, today);
      showToast(`Day complete — streak now ${streakAfter} \u{1F525}`);
    } else if (wasAllComplete && !nowAllComplete) {
      nextXp = Math.max(0, nextXp - 25);
    }

    if (!wasComplete && nowComplete && !nowAllComplete) {
      const taskStreakAfter = taskStreakOn(nextDailyLogs, task, today);
      const streakNote = taskStreakAfter > 1 ? ` — ${taskStreakAfter} day streak` : "";
      showToast(`${task.name} complete${streakNote}`);
    }

    saveAll({
      dailyLogs: nextDailyLogs,
      xp: nextXp,
    });
  };

  const updateTaskXp = (taskId, value) => {
    const xpVal = Math.max(0, parseInt(value, 10) || 0);
    const nextTemplates = templates.map((t) => (t.id === taskId ? { ...t, xp: xpVal } : t));
    saveAll({ templates: nextTemplates });
  };

  const handleSaveEdit = (updatedTask) => {
    const nextTemplates = templates.map((t) => (t.id === updatedTask.id ? updatedTask : t));
    saveAll({ templates: nextTemplates });
    setEditingTaskId(null);
  };

  const getMainDayStatus = useCallback(
    (dateStr) => {
      const log = dailyLogs[dateStr];
      const scheduled = templates.filter((t) => isScheduledForDate(t, dateStr));
      if (scheduled.length === 0) return "empty";
      if (!log) return "empty";
      const sumTarget = scheduled.reduce((s, t) => s + t.target, 0);
      const sumCurrent = scheduled.reduce((s, t) => s + Math.min(log[t.id] || 0, t.target), 0);
      if (sumTarget > 0 && sumCurrent >= sumTarget) return "complete";
      if (sumCurrent > 0) return "partial";
      return "empty";
    },
    [dailyLogs, templates]
  );

  const getTaskDayStatus = useCallback(
    (dateStr, task) => {
      const log = dailyLogs[dateStr];
      const val = log?.[task.id] || 0;
      if (val <= 0) return "empty";
      if (val >= task.target) return "complete";
      return "partial";
    },
    [dailyLogs]
  );

  const getDayTasks = useCallback(
    (dateStr) => {
      const log = dailyLogs[dateStr] || {};
      const scheduled = templates.filter((t) => isScheduledForDate(t, dateStr));
      return scheduled.map((t) => {
        const current = Math.min(log[t.id] || 0, t.target);
        return {
          id: t.id,
          name: t.name,
          target: t.target,
          unit: t.unit,
          current,
          completed: current >= t.target,
        };
      });
    },
    [dailyLogs, templates]
  );

  const addTask = () => {
    const name = newTaskName.trim();
    if (!name) return;
    const target = Math.max(1, parseInt(newTaskTarget, 10) || 1);
    const xpVal = Math.max(0, parseInt(newTaskXp, 10) || 0);
    const id = `t${Date.now()}`;

    let schedule;
    if (newTaskSchedule === "weekly") {
      schedule = { type: "weekly", days: newTaskDays.length ? newTaskDays : [dayOfWeek(today)] };
    } else if (newTaskSchedule === "specific") {
      schedule = { type: "specific", date: newTaskDate };
    } else {
      schedule = { type: "daily" };
    }

    const nextTemplates = [
      ...templates,
      { id, name, target, unit: newTaskUnit.trim(), xp: xpVal, schedule },
    ];
    saveAll({ templates: nextTemplates });
    setNewTaskName("");
    setNewTaskTarget("1");
    setNewTaskUnit("");
    setNewTaskXp("20");
    setNewTaskSchedule("daily");
    setNewTaskDays([]);
    setNewTaskDate(dateOffset(today, 1));
    setShowAdd(false);
  };

  const toggleNewTaskDay = (d) => {
    setNewTaskDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const removeTask = (id) => {
    const nextTemplates = templates.filter((t) => t.id !== id);
    saveAll({ templates: nextTemplates });
  };

  const resetProgress = () => {
    saveAll({
      dailyLogs: {},
      xp: 0,
    });
    setConfirmReset(false);
    showToast("Fresh start — back to level 1");
  };

  const handleResetClick = () => {
    if (confirmReset) {
      resetProgress();
    } else {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
    }
  };

  if (!loaded) {
    return (
      <div style={styles.loadingWrap}>
        <div style={styles.loadingText}>Unrolling the scroll…</div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <style>{fontImport}</style>
      <div style={styles.vignette} />

      <div style={styles.container}>
        <div style={styles.resetRow}>
          <button style={styles.resetBtn} onClick={handleResetClick}>
            <RotateCcw size={11} />
            {confirmReset ? "Click again to confirm" : "Reset progress"}
          </button>
        </div>

        {/* Header */}
        <div style={styles.header}>
          <div style={styles.medallionWrap}>
            <div style={styles.medallion}>
              <div style={styles.medallionInner}>
                <span style={styles.levelNum}>{level}</span>
              </div>
            </div>
            <span style={styles.levelLabel}>LEVEL</span>
          </div>

          <div style={styles.headerCenter}>
            <h1 style={styles.title}>Quest Log</h1>
            <div style={styles.xpRow}>
              <div style={styles.xpBarTrack}>
                <div
                  style={{
                    ...styles.xpBarFill,
                    width: `${need > 0 ? Math.min(100, (into / need) * 100) : 0}%`,
                  }}
                />
              </div>
              <span style={styles.xpText}>
                {into} / {need} XP
              </span>
            </div>
          </div>

          <div style={styles.streakWrap}>
            <Flame
              size={26}
              color={streak > 0 ? "#ff6b4a" : "#4a4460"}
              fill={streak > 0 ? "#ff6b4a" : "none"}
              strokeWidth={1.5}
            />
            <span style={styles.streakNum}>{streak}</span>
            <span style={styles.streakLabel}>DAY STREAK</span>
          </div>
        </div>

        {/* Main progress */}
        <div style={styles.mainProgressCard}>
          <div style={styles.mainProgressHeader}>
            <span style={styles.mainProgressLabel}>TODAY'S PROGRESS</span>
            <div style={styles.mainProgressHeaderRight}>
              <span style={styles.mainProgressPct}>{Math.round(mainProgress * 100)}%</span>
              <button
                style={styles.calendarIconBtn}
                onClick={() => setOpenCalendar({ type: "main" })}
                aria-label="View quest calendar"
                title="View calendar"
              >
                <Calendar size={14} />
              </button>
            </div>
          </div>
          <div style={styles.mainBarTrack}>
            <div
              style={{
                ...styles.mainBarFill,
                width: `${Math.min(100, mainProgress * 100)}%`,
                background: allComplete
                  ? "linear-gradient(90deg, #5fd68a, #8fe6ab)"
                  : "linear-gradient(90deg, #9b6bff, #c79bff)",
              }}
            />
            <div style={styles.mainBarGlow} />
          </div>
          {allComplete && (
            <div style={styles.completeBanner}>
              <Trophy size={14} color="#e8b84b" />
              <span>All quests complete. The realm thanks you.</span>
            </div>
          )}
        </div>

        {/* Task list */}
        <div style={styles.taskListHeader}>
          <span style={styles.sectionLabel}>TODAY'S QUESTS</span>
          <button style={styles.addBtn} onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? <X size={14} /> : <Plus size={14} />}
            {showAdd ? "Cancel" : "New Quest"}
          </button>
        </div>

        {showAdd && (
          <div style={styles.addForm}>
            <input
              style={{ ...styles.input, width: "100%" }}
              placeholder="Quest name"
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
            />
            <div style={styles.addFormRow}>
              <input
                style={{ ...styles.input, width: 70 }}
                placeholder="Target"
                type="number"
                min="1"
                value={newTaskTarget}
                onChange={(e) => setNewTaskTarget(e.target.value)}
              />
              <input
                style={{ ...styles.input, width: 90 }}
                placeholder="unit (opt.)"
                value={newTaskUnit}
                onChange={(e) => setNewTaskUnit(e.target.value)}
              />
              <input
                style={{ ...styles.input, width: 70 }}
                placeholder="XP"
                type="number"
                min="0"
                value={newTaskXp}
                onChange={(e) => setNewTaskXp(e.target.value)}
              />
            </div>

            <div style={styles.scheduleTabs}>
              {["daily", "weekly", "specific"].map((s) => (
                <button
                  key={s}
                  style={{
                    ...styles.scheduleTab,
                    ...(newTaskSchedule === s ? styles.scheduleTabActive : {}),
                  }}
                  onClick={() => setNewTaskSchedule(s)}
                >
                  {s === "daily" ? "Daily" : s === "weekly" ? "Weekly" : "Specific Day"}
                </button>
              ))}
            </div>

            {newTaskSchedule === "weekly" && (
              <div style={styles.dayPicker}>
                {WEEKDAY_LABELS.map((label, i) => (
                  <button
                    key={i}
                    style={{
                      ...styles.dayPickerBtn,
                      ...(newTaskDays.includes(i) ? styles.dayPickerBtnActive : {}),
                    }}
                    onClick={() => toggleNewTaskDay(i)}
                  >
                    {label[0]}
                  </button>
                ))}
              </div>
            )}

            {newTaskSchedule === "specific" && (
              <input
                style={{ ...styles.input, width: "100%" }}
                type="date"
                value={newTaskDate}
                onChange={(e) => setNewTaskDate(e.target.value)}
              />
            )}

            <button style={{ ...styles.confirmBtn, alignSelf: "flex-end" }} onClick={addTask}>
              <Sparkles size={14} /> Add
            </button>
          </div>
        )}

        <div style={styles.taskList}>
          {scheduledToday.length === 0 && (
            <div style={styles.emptyState}>
              {templates.length === 0
                ? "No quests yet. Add one to begin your log."
                : "No quests scheduled for today."}
            </div>
          )}
          {scheduledToday.map((task) => {
            const current = todayLog[task.id] || 0;
            const pct = Math.min(100, (current / task.target) * 100);
            const complete = current >= task.target;
            const tStreak = taskStreakOn(dailyLogs, task, today);
            const sLabel = scheduleLabel(task);
            return (
              <div key={task.id} style={{ ...styles.taskRow, ...(complete ? styles.taskRowDone : {}) }}>
                <button
                  style={{
                    ...styles.checkBtn,
                    ...(complete ? styles.checkBtnDone : {}),
                  }}
                  onClick={() =>
                    updateTaskProgress(task.id, complete ? -task.target : task.target - current)
                  }
                  aria-label={complete ? "Mark incomplete" : "Mark complete"}
                >
                  {complete && <Check size={13} color="#0d0b14" strokeWidth={3} />}
                </button>

                <div style={styles.taskBody}>
                  <div style={styles.taskTopRow}>
                    <span style={{ ...styles.taskName, ...(complete ? styles.taskNameDone : {}) }}>
                      {task.name}
                      {sLabel && <span style={styles.scheduleBadge}>{sLabel}</span>}
                    </span>
                    <div style={styles.taskMetaRight}>
                      {tStreak > 0 && (
                        <span style={styles.taskStreakBadge}>
                          <Flame size={10} color="#ff6b4a" fill="#ff6b4a" />
                          {tStreak}
                        </span>
                      )}
                      <span style={styles.taskCount}>
                        {task.target > 1
                          ? `${current}/${task.target}${task.unit ? " " + task.unit : ""}`
                          : complete
                          ? "done"
                          : ""}
                      </span>
                    </div>
                  </div>
                  <div style={styles.taskBarTrack}>
                    <div
                      style={{
                        ...styles.taskBarFill,
                        width: `${pct}%`,
                        background: complete ? "#5fd68a" : "#9b6bff",
                      }}
                    />
                  </div>
                </div>

                <div style={styles.xpChipWrap} title="XP awarded on completion">
                  <input
                    style={styles.xpChipInput}
                    type="number"
                    min="0"
                    value={task.xp ?? 0}
                    onChange={(e) => updateTaskXp(task.id, e.target.value)}
                    onClick={(e) => e.target.select()}
                  />
                  <span style={styles.xpChipLabel}>XP</span>
                </div>

                <button
                  style={styles.calendarIconBtn}
                  onClick={() => setOpenCalendar({ type: "task", task })}
                  aria-label={`View calendar for ${task.name}`}
                  title="View history"
                >
                  <Calendar size={14} />
                </button>

                <button
                  style={styles.calendarIconBtn}
                  onClick={() => setEditingTaskId(task.id)}
                  aria-label={`Edit ${task.name}`}
                  title="Edit quest"
                >
                  <Pencil size={14} />
                </button>

                {task.target > 1 && !complete && (
                  <div style={styles.stepBtns}>
                    <button style={styles.stepBtn} onClick={() => updateTaskProgress(task.id, -1)}>
                      −
                    </button>
                    <button style={styles.stepBtn} onClick={() => updateTaskProgress(task.id, 1)}>
                      +
                    </button>
                  </div>
                )}

                <button
                  style={styles.removeBtn}
                  onClick={() => removeTask(task.id)}
                  aria-label="Delete quest"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>

        {otherTemplates.length > 0 && (
          <div style={styles.othersSection}>
            <button style={styles.othersToggle} onClick={() => setShowOthers((s) => !s)}>
              {showOthers ? "Hide" : "Show"} other scheduled quests ({otherTemplates.length})
            </button>
            {showOthers && (
              <div style={styles.othersList}>
                {otherTemplates.map((task) => {
                  const current = todayLog[task.id] || 0;
                  const complete = current >= task.target;
                  return (
                    <div key={task.id} style={styles.othersRow}>
                      <button
                        style={{
                          ...styles.checkBtn,
                          ...(complete ? styles.checkBtnDone : {}),
                        }}
                        onClick={() =>
                          updateTaskProgress(task.id, complete ? -task.target : task.target - current)
                        }
                        aria-label={complete ? "Mark incomplete" : "Mark complete"}
                      >
                        {complete && <Check size={11} color="#0d0b14" strokeWidth={3} />}
                      </button>
                      <span style={{ ...styles.othersName, ...(complete ? styles.taskNameDone : {}) }}>
                        {task.name}
                      </span>
                      <span style={styles.scheduleBadge}>{scheduleLabel(task)}</span>
                      <button
                        style={styles.removeBtn}
                        onClick={() => setEditingTaskId(task.id)}
                        aria-label={`Edit ${task.name}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        style={styles.removeBtn}
                        onClick={() => removeTask(task.id)}
                        aria-label="Delete quest"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}

      {openCalendar?.type === "main" && (
        <CalendarModal
          title="Quest Calendar"
          subtitle="Tap a day to see what you did"
          getDayStatus={getMainDayStatus}
          getDayTasks={getDayTasks}
          legend={[
            { color: "#5fd68a", label: "Full clear" },
            { color: "#9b6bff", label: "Partial" },
            { color: "#241f33", label: "No activity" },
          ]}
          onClose={() => setOpenCalendar(null)}
        />
      )}

      {openCalendar?.type === "task" && (
        <CalendarModal
          title={openCalendar.task.name}
          subtitle="Your history for this quest"
          getDayStatus={(ds) => getTaskDayStatus(ds, openCalendar.task)}
          legend={[
            { color: "#5fd68a", label: "Completed" },
            { color: "#e8b84b", label: "Partial" },
            { color: "#241f33", label: "Missed" },
          ]}
          onClose={() => setOpenCalendar(null)}
        />
      )}

      {editingTaskId && templates.find((t) => t.id === editingTaskId) && (
        <EditTaskModal
          task={templates.find((t) => t.id === editingTaskId)}
          onSave={handleSaveEdit}
          onClose={() => setEditingTaskId(null)}
        />
      )}
    </div>
  );
}

function CalendarModal({ title, subtitle, getDayStatus, getDayTasks, legend, onClose }) {
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => (getDayTasks ? todayStr() : null));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const toDateStr = (d) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const todayDs = todayStr();

  const changeMonth = (delta) => {
    setViewDate(new Date(year, month + delta, 1));
  };

  const selectedDayLabel = selectedDate
    ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    : null;
  const selectedTasks = selectedDate && getDayTasks ? getDayTasks(selectedDate) : null;

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.headerRow}>
          <div>
            <div style={modalStyles.title}>{title}</div>
            {subtitle && <div style={modalStyles.subtitle}>{subtitle}</div>}
          </div>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close calendar">
            <X size={16} />
          </button>
        </div>

        <div style={modalStyles.monthNav}>
          <button style={modalStyles.navBtn} onClick={() => changeMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <span style={modalStyles.monthLabel}>{monthLabel}</span>
          <button style={modalStyles.navBtn} onClick={() => changeMonth(1)} aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>

        <div style={modalStyles.weekRow}>
          {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
            <span key={i} style={modalStyles.weekLabel}>
              {w}
            </span>
          ))}
        </div>

        <div style={modalStyles.grid}>
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} style={modalStyles.emptyCell} />;
            const ds = toDateStr(d);
            const status = getDayStatus(ds);
            const isFuture = ds > todayDs;
            const isToday = ds === todayDs;
            const isSelected = ds === selectedDate;
            return (
              <button
                key={ds}
                style={{
                  ...modalStyles.dayCell,
                  ...(status === "partial" ? modalStyles.dayCellPartial : {}),
                  ...(status === "complete" ? modalStyles.dayCellComplete : {}),
                  ...(isFuture ? modalStyles.dayCellFuture : {}),
                  ...(isToday ? modalStyles.dayCellToday : {}),
                  ...(isSelected ? modalStyles.dayCellSelected : {}),
                  cursor: getDayTasks ? "pointer" : "default",
                }}
                onClick={() => getDayTasks && setSelectedDate(ds)}
                disabled={!getDayTasks}
              >
                {d}
              </button>
            );
          })}
        </div>

        {legend && (
          <div style={modalStyles.legendRow}>
            {legend.map((l) => (
              <div key={l.label} style={modalStyles.legendItem}>
                <span style={{ ...modalStyles.legendDot, background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        )}

        {selectedTasks && (
          <div style={modalStyles.dayDetail}>
            <div style={modalStyles.dayDetailHeader}>{selectedDayLabel}</div>
            {selectedTasks.length === 0 ? (
              <div style={modalStyles.dayDetailEmpty}>No quests existed yet on this day.</div>
            ) : (
              <div style={modalStyles.dayDetailList}>
                {selectedTasks.map((t) => (
                  <div key={t.id} style={modalStyles.dayDetailRow}>
                    <div
                      style={{
                        ...modalStyles.dayDetailCheck,
                        ...(t.completed ? modalStyles.dayDetailCheckDone : {}),
                      }}
                    >
                      {t.completed && <Check size={11} color="#0d0b14" strokeWidth={3} />}
                    </div>
                    <span
                      style={{
                        ...modalStyles.dayDetailName,
                        ...(t.completed ? modalStyles.dayDetailNameDone : {}),
                      }}
                    >
                      {t.name}
                    </span>
                    {t.target > 1 && (
                      <span style={modalStyles.dayDetailCount}>
                        {t.current}/{t.target}
                        {t.unit ? ` ${t.unit}` : ""}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const fontImport = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
`;

function EditTaskModal({ task, onSave, onClose }) {
  const initialSchedule = task.schedule || { type: "daily" };
  const [name, setName] = useState(task.name);
  const [target, setTarget] = useState(String(task.target));
  const [unit, setUnit] = useState(task.unit || "");
  const [xpVal, setXpVal] = useState(String(task.xp ?? 20));
  const [scheduleType, setScheduleType] = useState(initialSchedule.type || "daily");
  const [days, setDays] = useState(initialSchedule.days || []);
  const [date, setDate] = useState(initialSchedule.date || todayStr());

  const toggleDay = (d) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const targetVal = Math.max(1, parseInt(target, 10) || 1);
    const xpNum = Math.max(0, parseInt(xpVal, 10) || 0);

    let schedule;
    if (scheduleType === "weekly") {
      schedule = { type: "weekly", days: days.length ? days : [dayOfWeek(todayStr())] };
    } else if (scheduleType === "specific") {
      schedule = { type: "specific", date };
    } else {
      schedule = { type: "daily" };
    }

    onSave({
      ...task,
      name: trimmedName,
      target: targetVal,
      unit: unit.trim(),
      xp: xpNum,
      schedule,
    });
  };

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.headerRow}>
          <div style={modalStyles.title}>Edit Quest</div>
          <button style={modalStyles.closeBtn} onClick={onClose} aria-label="Close editor">
            <X size={16} />
          </button>
        </div>

        <div style={styles.addForm}>
          <input
            style={{ ...styles.input, width: "100%" }}
            placeholder="Quest name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div style={styles.addFormRow}>
            <input
              style={{ ...styles.input, width: 70 }}
              placeholder="Target"
              type="number"
              min="1"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <input
              style={{ ...styles.input, width: 90 }}
              placeholder="unit (opt.)"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            />
            <input
              style={{ ...styles.input, width: 70 }}
              placeholder="XP"
              type="number"
              min="0"
              value={xpVal}
              onChange={(e) => setXpVal(e.target.value)}
            />
          </div>

          <div style={styles.scheduleTabs}>
            {["daily", "weekly", "specific"].map((s) => (
              <button
                key={s}
                style={{
                  ...styles.scheduleTab,
                  ...(scheduleType === s ? styles.scheduleTabActive : {}),
                }}
                onClick={() => setScheduleType(s)}
              >
                {s === "daily" ? "Daily" : s === "weekly" ? "Weekly" : "Specific Day"}
              </button>
            ))}
          </div>

          {scheduleType === "weekly" && (
            <div style={styles.dayPicker}>
              {WEEKDAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  style={{
                    ...styles.dayPickerBtn,
                    ...(days.includes(i) ? styles.dayPickerBtnActive : {}),
                  }}
                  onClick={() => toggleDay(i)}
                >
                  {label[0]}
                </button>
              ))}
            </div>
          )}

          {scheduleType === "specific" && (
            <input
              style={{ ...styles.input, width: "100%" }}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}

          <button style={{ ...styles.confirmBtn, alignSelf: "flex-end" }} onClick={handleSave}>
            <Check size={14} /> Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  app: {
    minHeight: "100%",
    background: "radial-gradient(ellipse at top, #1a1628 0%, #0d0b14 60%)",
    fontFamily: "'Inter', sans-serif",
    color: "#ede6f5",
    padding: "28px 16px 48px",
    position: "relative",
    overflow: "hidden",
  },
  vignette: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background:
      "radial-gradient(circle at 50% 0%, transparent 40%, rgba(0,0,0,0.5) 100%)",
  },
  loadingWrap: {
    minHeight: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0d0b14",
    color: "#8b81a3",
    fontFamily: "'Inter', sans-serif",
  },
  loadingText: { fontSize: 14, letterSpacing: 0.5 },
  container: {
    maxWidth: 560,
    margin: "0 auto",
    position: "relative",
    zIndex: 1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 22,
  },
  resetRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: 10,
  },
  resetBtn: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    background: "transparent",
    border: "1px solid #2e2740",
    color: "#6b6285",
    fontSize: 10,
    fontWeight: 500,
    padding: "5px 10px",
    borderRadius: 7,
    cursor: "pointer",
  },
  medallionWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  medallion: {
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "linear-gradient(145deg, #e8b84b, #c9932f)",
    padding: 3,
    boxShadow: "0 0 18px rgba(232,184,75,0.35)",
  },
  medallionInner: {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    background: "#17141f",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #3a3350",
  },
  levelNum: {
    fontFamily: "'Cinzel', serif",
    fontSize: 22,
    fontWeight: 700,
    color: "#e8b84b",
  },
  levelLabel: {
    fontSize: 9,
    letterSpacing: 1.5,
    color: "#8b81a3",
    fontWeight: 600,
  },
  headerCenter: { flex: 1, textAlign: "center" },
  title: {
    fontFamily: "'Cinzel', serif",
    fontSize: 24,
    fontWeight: 700,
    margin: "0 0 8px",
    letterSpacing: 1,
    background: "linear-gradient(180deg, #ede6f5, #b8adcf)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  xpRow: { display: "flex", alignItems: "center", gap: 8, justifyContent: "center" },
  xpBarTrack: {
    width: 140,
    height: 7,
    borderRadius: 4,
    background: "#241f33",
    overflow: "hidden",
    border: "1px solid #342c4a",
  },
  xpBarFill: {
    height: "100%",
    background: "linear-gradient(90deg, #e8b84b, #ffd76b)",
    transition: "width 0.4s ease",
  },
  xpText: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: "#8b81a3",
  },
  streakWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 0,
    minWidth: 70,
  },
  streakNum: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 20,
    fontWeight: 600,
    color: "#ede6f5",
    marginTop: 2,
  },
  streakLabel: {
    fontSize: 8,
    letterSpacing: 1,
    color: "#8b81a3",
    fontWeight: 600,
  },
  mainProgressCard: {
    background: "#17141f",
    border: "1px solid #2e2740",
    borderRadius: 14,
    padding: "16px 18px",
    marginBottom: 26,
  },
  mainProgressHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  mainProgressHeaderRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  calendarIconBtn: {
    width: 26,
    height: 26,
    minWidth: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "1px solid #3a3350",
    borderRadius: 7,
    color: "#c79bff",
    cursor: "pointer",
    flexShrink: 0,
  },
  mainProgressLabel: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: "#8b81a3",
    fontWeight: 600,
  },
  mainProgressPct: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: "#c79bff",
    fontWeight: 600,
  },
  mainBarTrack: {
    position: "relative",
    height: 14,
    borderRadius: 8,
    background: "#0d0b14",
    border: "1px solid #2e2740",
    overflow: "hidden",
  },
  mainBarFill: {
    height: "100%",
    borderRadius: 8,
    transition: "width 0.5s cubic-bezier(.4,1.4,.6,1)",
  },
  mainBarGlow: {
    position: "absolute",
    inset: 0,
    boxShadow: "inset 0 0 12px rgba(155,107,255,0.15)",
    pointerEvents: "none",
  },
  completeBanner: {
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "#e8b84b",
  },
  taskListHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: "#8b81a3",
    fontWeight: 600,
  },
  addBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: "1px solid #3a3350",
    color: "#c79bff",
    fontSize: 11,
    fontWeight: 600,
    padding: "5px 10px",
    borderRadius: 8,
    cursor: "pointer",
  },
  addForm: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginBottom: 14,
    background: "#17141f",
    border: "1px solid #2e2740",
    borderRadius: 12,
    padding: 12,
  },
  addFormRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  scheduleTabs: {
    display: "flex",
    gap: 6,
  },
  scheduleTab: {
    flex: 1,
    background: "#0d0b14",
    border: "1px solid #2e2740",
    borderRadius: 7,
    color: "#8b81a3",
    fontSize: 11,
    fontWeight: 600,
    padding: "7px 4px",
    cursor: "pointer",
  },
  scheduleTabActive: {
    background: "rgba(155,107,255,0.18)",
    borderColor: "#9b6bff",
    color: "#c79bff",
  },
  dayPicker: {
    display: "flex",
    gap: 5,
  },
  dayPickerBtn: {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: "1px solid #2e2740",
    background: "#0d0b14",
    color: "#8b81a3",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  },
  dayPickerBtnActive: {
    background: "rgba(155,107,255,0.18)",
    borderColor: "#9b6bff",
    color: "#c79bff",
  },
  scheduleBadge: {
    marginLeft: 7,
    fontSize: 9,
    fontWeight: 600,
    color: "#8b81a3",
    background: "#1f1b2c",
    border: "1px solid #2e2740",
    borderRadius: 5,
    padding: "1px 5px",
    whiteSpace: "nowrap",
  },
  othersSection: {
    marginTop: 6,
  },
  othersToggle: {
    background: "transparent",
    border: "none",
    color: "#6b6285",
    fontSize: 11,
    fontWeight: 500,
    cursor: "pointer",
    padding: "4px 0",
  },
  othersList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 6,
  },
  othersRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#151220",
    border: "1px solid #241f33",
    borderRadius: 9,
    padding: "7px 10px",
  },
  othersName: {
    flex: 1,
    fontSize: 12,
    color: "#8b81a3",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  input: {
    background: "#0d0b14",
    border: "1px solid #2e2740",
    borderRadius: 8,
    padding: "8px 10px",
    color: "#ede6f5",
    fontSize: 12,

    flex: 1,
    minWidth: 100,
    outline: "none",
  },
  confirmBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    background: "#9b6bff",
    border: "none",
    color: "#0d0b14",
    fontSize: 12,
    fontWeight: 600,
    padding: "8px 12px",
    borderRadius: 8,
    cursor: "pointer",
  },
  taskList: { display: "flex", flexDirection: "column", gap: 8 },
  emptyState: {
    color: "#5a5372",
    fontSize: 13,
    textAlign: "center",
    padding: "24px 0",
  },
  taskRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#17141f",
    border: "1px solid #2e2740",
    borderRadius: 12,
    padding: "10px 12px",
  },
  taskRowDone: {
    borderColor: "#2a4a3a",
    background: "#151d19",
  },
  checkBtn: {
    width: 22,
    height: 22,
    minWidth: 22,
    borderRadius: 6,
    border: "1.5px solid #4a4460",
    background: "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  checkBtnDone: {
    background: "#5fd68a",
    borderColor: "#5fd68a",
  },
  taskBody: { flex: 1, minWidth: 0 },
  taskTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 5,
    gap: 8,
  },
  taskName: {
    fontSize: 13.5,
    fontWeight: 500,
    color: "#ede6f5",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  taskNameDone: {
    color: "#7fae91",
    textDecoration: "line-through",
    textDecorationColor: "#3d5a48",
  },
  taskCount: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: "#8b81a3",
    whiteSpace: "nowrap",
  },
  taskMetaRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  taskStreakBadge: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: "#ff9376",
    background: "rgba(255,107,74,0.12)",
    border: "1px solid rgba(255,107,74,0.3)",
    borderRadius: 6,
    padding: "1px 5px",
  },
  xpChipWrap: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    background: "#0d0b14",
    border: "1px solid #342c4a",
    borderRadius: 7,
    padding: "3px 6px",
    flexShrink: 0,
  },
  xpChipInput: {
    width: 30,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#e8b84b",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    textAlign: "right",
    padding: 0,
  },
  xpChipLabel: {
    fontSize: 9,
    color: "#8b81a3",
    fontWeight: 600,
  },
  taskBarTrack: {
    height: 6,
    borderRadius: 4,
    background: "#0d0b14",
    overflow: "hidden",
    border: "1px solid #241f33",
  },
  taskBarFill: {
    height: "100%",
    borderRadius: 4,
    transition: "width 0.3s ease",
  },
  stepBtns: { display: "flex", gap: 3 },
  stepBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    border: "1px solid #3a3350",
    background: "#0d0b14",
    color: "#c79bff",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    lineHeight: 1,
  },
  removeBtn: {
    background: "transparent",
    border: "none",
    color: "#4a4460",
    cursor: "pointer",
    padding: 4,
    display: "flex",
  },
  toast: {
    position: "fixed",
    bottom: 24,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#1f1b2c",
    border: "1px solid #3a3350",
    color: "#e8b84b",
    padding: "10px 18px",
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 500,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    zIndex: 50,
  },
};

const modalStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(6,5,10,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    padding: 16,
    backdropFilter: "blur(2px)",
  },
  panel: {
    width: "100%",
    maxWidth: 340,
    background: "#17141f",
    border: "1px solid #2e2740",
    borderRadius: 16,
    padding: "18px 18px 16px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    fontFamily: "'Inter', sans-serif",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
    gap: 8,
  },
  title: {
    fontFamily: "'Cinzel', serif",
    fontSize: 16,
    fontWeight: 700,
    color: "#ede6f5",
  },
  subtitle: {
    fontSize: 11,
    color: "#8b81a3",
    marginTop: 3,
  },
  closeBtn: {
    background: "transparent",
    border: "1px solid #3a3350",
    borderRadius: 7,
    color: "#8b81a3",
    width: 26,
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  monthNav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    marginBottom: 12,
  },
  navBtn: {
    background: "transparent",
    border: "1px solid #3a3350",
    borderRadius: 7,
    color: "#c79bff",
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  monthLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    color: "#ede6f5",
    fontWeight: 600,
    minWidth: 120,
    textAlign: "center",
  },
  weekRow: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    marginBottom: 4,
  },
  weekLabel: {
    textAlign: "center",
    fontSize: 9,
    color: "#5a5372",
    fontWeight: 600,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 4,
  },
  emptyCell: { aspectRatio: "1 / 1" },
  dayCell: {
    aspectRatio: "1 / 1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    background: "#0d0b14",
    border: "1px solid #241f33",
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    color: "#5a5372",
    padding: 0,
    margin: 0,
  },
  dayCellPartial: {
    background: "rgba(155,107,255,0.18)",
    border: "1px solid rgba(155,107,255,0.4)",
    color: "#c79bff",
  },
  dayCellComplete: {
    background: "rgba(95,214,138,0.22)",
    border: "2px solid #e8b84b",
    color: "#dff5e6",
    boxShadow: "0 0 8px rgba(232,184,75,0.35)",
    fontWeight: 700,
  },
  dayCellFuture: {
    opacity: 0.35,
  },
  dayCellToday: {
    borderColor: "#9b6bff",
  },
  dayCellSelected: {
    boxShadow: "0 0 0 2px #c79bff",
  },
  legendRow: {
    display: "flex",
    justifyContent: "center",
    gap: 14,
    marginTop: 14,
    flexWrap: "wrap",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 10,
    color: "#8b81a3",
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 3,
  },
  dayDetail: {
    marginTop: 16,
    paddingTop: 14,
    borderTop: "1px solid #241f33",
  },
  dayDetailHeader: {
    fontFamily: "'Cinzel', serif",
    fontSize: 12.5,
    fontWeight: 700,
    color: "#c79bff",
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  dayDetailEmpty: {
    fontSize: 11.5,
    color: "#5a5372",
    padding: "6px 0 2px",
  },
  dayDetailList: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    maxHeight: 170,
    overflowY: "auto",
  },
  dayDetailRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  dayDetailCheck: {
    width: 18,
    height: 18,
    minWidth: 18,
    borderRadius: 5,
    border: "1.5px solid #4a4460",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  dayDetailCheckDone: {
    background: "#5fd68a",
    borderColor: "#5fd68a",
  },
  dayDetailName: {
    flex: 1,
    fontSize: 12.5,
    color: "#ede6f5",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dayDetailNameDone: {
    color: "#8fd6a8",
  },
  dayDetailCount: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    color: "#8b81a3",
    whiteSpace: "nowrap",
  },
};
