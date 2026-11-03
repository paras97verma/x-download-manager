import React, { useState } from "react";
import {
  X,
  CalendarClock,
  Play,
  Pause,
  Save,
  Clock,
  CheckCircle2,
  ListOrdered,
  Gauge,
  Power,
  Plus,
  Trash2,
  FolderOpen,
  Calendar,
  AlertTriangle,
  Sliders,
  Sparkles,
} from "lucide-react";
import { AppSettings, DownloadItem, SchedulerQueueConfig } from "../types/xdm";
import { apiPickDirectory } from "../services/tauriBridge";

interface SchedulerModalProps {
  settings: AppSettings;
  downloads?: DownloadItem[];
  onSaveSettings: (newSettings: AppSettings) => void;
  onStartQueueNow: (queueId: string) => void;
  onToggleQueuePause?: (queueId: string) => Promise<boolean>;
  onScheduleDownload?: (
    downloadId: string,
    startTime: string | null,
    stopTime: string | null
  ) => Promise<void>;
  onClose: () => void;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const QUEUE_COLORS = [
  "from-indigo-600 to-indigo-800 text-indigo-200 border-indigo-500",
  "from-purple-600 to-purple-800 text-purple-200 border-purple-500",
  "from-cyan-600 to-cyan-800 text-cyan-200 border-cyan-500",
  "from-emerald-600 to-emerald-800 text-emerald-200 border-emerald-500",
  "from-amber-600 to-amber-800 text-amber-200 border-amber-500",
  "from-rose-600 to-rose-800 text-rose-200 border-rose-500",
];

export const SchedulerModal: React.FC<SchedulerModalProps> = ({
  settings,
  downloads = [],
  onSaveSettings,
  onStartQueueNow,
  onToggleQueuePause,
  onScheduleDownload,
  onClose,
}) => {
  const [queues, setQueues] = useState<SchedulerQueueConfig[]>(settings.queues);
  const [selectedQueueId, setSelectedQueueId] = useState<string>(
    settings.queues[0]?.id || "main-queue"
  );
  const [activeTab, setActiveTab] = useState<
    "calendar" | "settings" | "scheduled_files" | "queue_files"
  >("calendar");
  const [savedNotice, setSavedNotice] = useState(false);

  // New Queue Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newQueueName, setNewQueueName] = useState("");
  const [newQueueConcurrency, setNewQueueConcurrency] = useState(4);
  const [newQueuePriority, setNewQueuePriority] = useState<"high" | "normal" | "low">("normal");
  const [newQueueDir, setNewQueueDir] = useState("");

  // Safe Delete Queue Modal state
  const [deleteTargetQueue, setDeleteTargetQueue] = useState<SchedulerQueueConfig | null>(null);
  const [reassignDestinationId, setReassignDestinationId] = useState<string>("main-queue");

  // Individual download schedule editor state
  const [editingDownloadId, setEditingDownloadId] = useState<string | null>(null);
  const [editStartTime, setEditStartTime] = useState<string>("");
  const [editStopTime, setEditStopTime] = useState<string>("");

  const activeQueue =
    queues.find((q) => q.id === selectedQueueId) || queues[0] || {
      id: "main-queue",
      name: "Main Download Queue",
      max_concurrent: 4,
      start_time_enabled: false,
      start_time_hhmm: "00:00",
      stop_time_enabled: false,
      stop_time_hhmm: "08:00",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      speed_limit_kbps: null,
      post_queue_action: "none",
    };

  const updateActiveQueue = (fields: Partial<SchedulerQueueConfig>) => {
    setQueues((prev) =>
      prev.map((q) => (q.id === activeQueue.id ? { ...q, ...fields } : q))
    );
  };

  const toggleDay = (dayIndex: number) => {
    const currentDays = activeQueue.days_of_week || [];
    const nextDays = currentDays.includes(dayIndex)
      ? currentDays.filter((d) => d !== dayIndex)
      : [...currentDays, dayIndex].sort();
    updateActiveQueue({ days_of_week: nextDays });
  };

  const handleSave = () => {
    const updated: AppSettings = {
      ...settings,
      queues,
    };
    onSaveSettings(updated);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handlePickDirectoryForQueue = async () => {
    const path = await apiPickDirectory();
    if (path) {
      updateActiveQueue({ download_dir: path });
    }
  };

  const handleCreateQueue = () => {
    if (!newQueueName.trim()) return;
    const generatedId = newQueueName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const uniqueId = queues.some((q) => q.id === generatedId)
      ? `${generatedId}-${Date.now().toString(36)}`
      : generatedId;

    const newConfig: SchedulerQueueConfig = {
      id: uniqueId,
      name: newQueueName.trim(),
      max_concurrent: newQueueConcurrency,
      start_time_enabled: false,
      start_time_hhmm: "00:00",
      stop_time_enabled: false,
      stop_time_hhmm: "08:00",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      speed_limit_kbps: null,
      post_queue_action: "none",
      download_dir: newQueueDir.trim() ? newQueueDir.trim() : null,
      priority: newQueuePriority,
      preferred_connections: 8,
      manual_pause: false,
      date_schedule_enabled: false,
      date_schedule_start: null,
      date_schedule_stop: null,
      per_host_concurrency: 4,
    };

    const nextQueues = [...queues, newConfig];
    setQueues(nextQueues);
    setSelectedQueueId(newConfig.id);
    setShowCreateModal(false);
    setNewQueueName("");
    setNewQueueDir("");
    onSaveSettings({ ...settings, queues: nextQueues });
  };

  const handleConfirmDeleteQueue = () => {
    if (!deleteTargetQueue || deleteTargetQueue.id === "main-queue") return;
    const targetDest = reassignDestinationId || "main-queue";

    // In local state, update any downloads in this queue to target queue
    const remainingQueues = queues.filter((q) => q.id !== deleteTargetQueue.id);
    setQueues(remainingQueues);
    setSelectedQueueId("main-queue");
    setDeleteTargetQueue(null);

    // Save settings
    onSaveSettings({ ...settings, queues: remainingQueues });
  };

  const handleTogglePause = async (queueId: string) => {
    const current = queues.find((q) => q.id === queueId);
    if (!current) return;
    const newPause = !current.manual_pause;

    const nextQueues = queues.map((q) =>
      q.id === queueId ? { ...q, manual_pause: newPause } : q
    );
    setQueues(nextQueues);

    if (onToggleQueuePause) {
      await onToggleQueuePause(queueId);
    }
    onSaveSettings({ ...settings, queues: nextQueues });
  };

  const queueDownloads = downloads.filter((d) => d.queue_id === activeQueue.id);
  const scheduledDownloads = downloads.filter(
    (d) => Boolean(d.scheduled_start) || Boolean(d.scheduled_stop)
  );

  // Time conversion helper for calendar grid
  const parseTimeToPercent = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number);
    const mins = (h || 0) * 60 + (m || 0);
    return (mins / 1440) * 100;
  };

  // Helper to check if queue is active now
  const isQueueActiveNow = (q: SchedulerQueueConfig): boolean => {
    if (q.manual_pause) return false;
    const now = new Date();
    const day = now.getDay();
    if (!q.days_of_week.includes(day)) return false;
    if (!q.start_time_enabled && !q.stop_time_enabled) return true;

    const currentMins = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = (q.start_time_hhmm || "00:00").split(":").map(Number);
    const [stopH, stopM] = (q.stop_time_hhmm || "23:59").split(":").map(Number);
    const startMins = startH * 60 + startM;
    const stopMins = stopH * 60 + stopM;

    if (startMins > stopMins) {
      return currentMins >= startMins || currentMins <= stopMins;
    }
    return currentMins >= startMins && currentMins <= stopMins;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <CalendarClock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                ByteX Custom Queues & Visual Scheduler
                <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.2 rounded font-mono">
                  {queues.length} Queues
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Visual 7-day schedule timetable, custom queue concurrency, throughput controls, and automated actions.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Queue List with New Queue Button */}
          <div className="w-60 bg-slate-950/80 border-r border-slate-800 p-3 space-y-2 shrink-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Queues
              </span>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-950/40 border border-indigo-700/40 hover:bg-indigo-900/50 transition"
                title="Create a new custom download queue"
              >
                <Plus className="w-3 h-3" /> New
              </button>
            </div>

            <div className="space-y-1 overflow-y-auto flex-1 pr-0.5">
              {queues.map((q, idx) => {
                const active = q.id === activeQueue.id;
                const count = downloads.filter((d) => d.queue_id === q.id).length;
                const isPaused = Boolean(q.manual_pause);
                const isRunning = isQueueActiveNow(q);

                return (
                  <div
                    key={q.id}
                    onClick={() => setSelectedQueueId(q.id)}
                    className={`group w-full text-left px-2.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-between cursor-pointer transition ${
                      active
                        ? "bg-indigo-600/20 text-indigo-200 border border-indigo-500/40 shadow-sm"
                        : "text-slate-300 hover:bg-slate-900 border border-transparent"
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isPaused
                            ? "bg-amber-400"
                            : isRunning
                            ? "bg-emerald-400 animate-pulse"
                            : "bg-slate-600"
                        }`}
                        title={isPaused ? "Queue Paused" : isRunning ? "Running Now" : "Idle"}
                      />
                      <span className="truncate">{q.name}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                        {count}
                      </span>
                      {q.id !== "main-queue" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTargetQueue(q);
                            setReassignDestinationId(
                              queues.find((item) => item.id !== q.id)?.id || "main-queue"
                            );
                          }}
                          className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded transition"
                          title="Delete queue..."
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Summary Pill at bottom of left bar */}
            <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
              <span>Active Queues:</span>
              <span className="font-semibold text-emerald-400">
                {queues.filter((q) => isQueueActiveNow(q)).length} of {queues.length}
              </span>
            </div>
          </div>

          {/* Right: Panels & Tabs */}
          <div className="flex-1 flex flex-col overflow-hidden bg-[#111827]">
            {/* Navigation Tabs */}
            <div className="px-5 py-2.5 bg-slate-900/70 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab("calendar")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    activeTab === "calendar"
                      ? "bg-indigo-600 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" /> 7-Day Timetable
                </button>
                <button
                  onClick={() => setActiveTab("settings")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    activeTab === "settings"
                      ? "bg-indigo-600 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" /> Queue Settings
                </button>
                <button
                  onClick={() => setActiveTab("queue_files")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    activeTab === "queue_files"
                      ? "bg-indigo-600 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <ListOrdered className="w-3.5 h-3.5" /> Files in Queue ({queueDownloads.length})
                </button>
                <button
                  onClick={() => setActiveTab("scheduled_files")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                    activeTab === "scheduled_files"
                      ? "bg-indigo-600 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" /> Scheduled Downloads ({scheduledDownloads.length})
                </button>
              </div>

              {/* Quick queue pause toggle */}
              <button
                onClick={() => handleTogglePause(activeQueue.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition ${
                  activeQueue.manual_pause
                    ? "bg-amber-600/20 text-amber-300 border border-amber-500/40 hover:bg-amber-600/30"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
                title={activeQueue.manual_pause ? "Resume this queue" : "Pause all downloads in this queue"}
              >
                {activeQueue.manual_pause ? (
                  <>
                    <Play className="w-3 h-3 text-amber-400" /> Resume Queue
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3 text-slate-400" /> Pause Queue
                  </>
                )}
              </button>
            </div>

            {/* Tab Contents */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* TAB 1: 7-Day Visual Calendar Timetable */}
              {activeTab === "calendar" && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-slate-200 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-indigo-400" />
                        Weekly Operating Schedule (Visual Timetable)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        24-Hour Grid across all 7 Days
                      </div>
                    </div>

                    {/* Weekly Grid */}
                    <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 p-3 space-y-2">
                      {/* Hour Header */}
                      <div className="grid grid-cols-8 text-[10px] font-mono text-slate-500 pb-1 border-b border-slate-800/80">
                        <span className="text-slate-400 font-semibold">Day</span>
                        <span className="text-center">00:00</span>
                        <span className="text-center">04:00</span>
                        <span className="text-center">08:00</span>
                        <span className="text-center">12:00</span>
                        <span className="text-center">16:00</span>
                        <span className="text-center">20:00</span>
                        <span className="text-right">24:00</span>
                      </div>

                      {/* 7 Day Rows */}
                      {DAY_LABELS.map((dayName, dayIdx) => {
                        const isToday = new Date().getDay() === dayIdx;

                        return (
                          <div
                            key={dayName}
                            className={`flex items-center gap-2 py-1.5 px-2 rounded-lg ${
                              isToday ? "bg-slate-900/90 border border-indigo-500/30" : ""
                            }`}
                          >
                            <span
                              className={`w-12 font-mono text-xs font-bold ${
                                isToday ? "text-indigo-400" : "text-slate-400"
                              }`}
                            >
                              {dayName} {isToday && <span className="text-[9px] text-emerald-400">●</span>}
                            </span>

                            {/* 24-Hour Bar */}
                            <div className="flex-1 h-6 bg-slate-900 rounded-md relative overflow-hidden border border-slate-800/70">
                              {/* Render blocks for all queues active on this day */}
                              {queues.map((q, qIdx) => {
                                const runsOnThisDay = (q.days_of_week || []).includes(dayIdx);
                                if (!runsOnThisDay) return null;

                                const startPct = q.start_time_enabled
                                  ? parseTimeToPercent(q.start_time_hhmm || "00:00")
                                  : 0;
                                const stopPct = q.stop_time_enabled
                                  ? parseTimeToPercent(q.stop_time_hhmm || "23:59")
                                  : 100;

                                const isOvernight = startPct > stopPct;
                                const colorClass =
                                  QUEUE_COLORS[qIdx % QUEUE_COLORS.length];

                                if (isOvernight) {
                                  // Two segments: start -> 100% and 0 -> stop%
                                  return (
                                    <React.Fragment key={`${q.id}-${dayIdx}`}>
                                      <div
                                        style={{ left: `${startPct}%`, width: `${100 - startPct}%` }}
                                        className={`absolute top-0.5 bottom-0.5 rounded bg-gradient-to-r ${colorClass} opacity-80 border-l border-r hover:opacity-100 transition cursor-help`}
                                        title={`${q.name}: ${q.start_time_hhmm} - 24:00`}
                                      />
                                      <div
                                        style={{ left: "0%", width: `${stopPct}%` }}
                                        className={`absolute top-0.5 bottom-0.5 rounded bg-gradient-to-r ${colorClass} opacity-80 border-l border-r hover:opacity-100 transition cursor-help`}
                                        title={`${q.name}: 00:00 - ${q.stop_time_hhmm}`}
                                      />
                                    </React.Fragment>
                                  );
                                }

                                const widthPct = Math.max(stopPct - startPct, 2);
                                return (
                                  <div
                                    key={`${q.id}-${dayIdx}`}
                                    style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                                    className={`absolute top-0.5 bottom-0.5 rounded bg-gradient-to-r ${colorClass} opacity-80 border hover:opacity-100 transition cursor-help flex items-center px-1`}
                                    title={`${q.name}: ${q.start_time_hhmm || "00:00"} - ${q.stop_time_hhmm || "24:00"} (Max ${q.max_concurrent} files)`}
                                  >
                                    <span className="text-[9px] font-bold truncate">
                                      {q.name}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Queue Legend */}
                    <div className="pt-2 border-t border-slate-800/80 flex items-center gap-3 flex-wrap">
                      <span className="text-[11px] text-slate-400 font-semibold">
                        Queues Legend:
                      </span>
                      {queues.map((q, idx) => (
                        <div
                          key={q.id}
                          className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer"
                          onClick={() => {
                            setSelectedQueueId(q.id);
                            setActiveTab("settings");
                          }}
                        >
                          <span
                            className={`w-2.5 h-2.5 rounded border ${
                              QUEUE_COLORS[idx % QUEUE_COLORS.length]
                            }`}
                          />
                          <span className="font-medium hover:text-white transition">
                            {q.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Queue Settings & Rules */}
              {activeTab === "settings" && (
                <div className="space-y-4">
                  {/* Queue Identity & Directory */}
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                    <div className="font-semibold text-slate-200 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Sliders className="w-4 h-4 text-indigo-400" />
                        Queue Identity & Default Path
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        ID: {activeQueue.id}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-300 font-medium">
                          Queue Name
                        </label>
                        <input
                          type="text"
                          value={activeQueue.name}
                          onChange={(e) => updateActiveQueue({ name: e.target.value })}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-medium"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-300 font-medium">
                          Queue Priority
                        </label>
                        <select
                          value={activeQueue.priority || "normal"}
                          onChange={(e) =>
                            updateActiveQueue({ priority: e.target.value as any })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100"
                        >
                          <option value="high">High Priority</option>
                          <option value="normal">Normal Priority</option>
                          <option value="low">Low Priority</option>
                        </select>
                      </div>
                    </div>

                    {/* Custom Directory */}
                    <div className="space-y-1 pt-1">
                      <label className="text-[11px] text-slate-300 font-medium">
                        Custom Queue Download Folder (Optional)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={activeQueue.download_dir || ""}
                          placeholder="Inherit global default download directory"
                          onChange={(e) =>
                            updateActiveQueue({
                              download_dir: e.target.value.trim() || null,
                            })
                          }
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono"
                        />
                        <button
                          type="button"
                          onClick={handlePickDirectoryForQueue}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
                        >
                          <FolderOpen className="w-3.5 h-3.5" /> Browse
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Concurrency & Speed Controls */}
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                    <div className="font-semibold text-slate-200 flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-cyan-300" />
                      Concurrency, Connections & Bandwidth
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-300 font-medium">
                          Max Simultaneous Downloads
                        </label>
                        <select
                          value={activeQueue.max_concurrent}
                          onChange={(e) =>
                            updateActiveQueue({ max_concurrent: Number(e.target.value) })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100"
                        >
                          {[1, 2, 3, 4, 5, 8, 10, 16, 20].map((num) => (
                            <option key={num} value={num}>
                              {num} simultaneous {num === 1 ? "file" : "files"}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-300 font-medium">
                          Preferred Threads / Connections
                        </label>
                        <select
                          value={activeQueue.preferred_connections || 8}
                          onChange={(e) =>
                            updateActiveQueue({
                              preferred_connections: Number(e.target.value),
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100"
                        >
                          {[1, 2, 4, 8, 12, 16, 20].map((num) => (
                            <option key={num} value={num}>
                              {num} parallel connections
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-300 font-medium">
                          Speed Cap (KB/s, 0 = Unlimited)
                        </label>
                        <input
                          type="number"
                          value={activeQueue.speed_limit_kbps || 0}
                          placeholder="0 = Unlimited"
                          onChange={(e) =>
                            updateActiveQueue({
                              speed_limit_kbps: Number(e.target.value) || null,
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Schedule & Timing */}
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                    <div className="font-semibold text-slate-200 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-indigo-400" />
                      Execution Schedule Windows
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {/* Start Time */}
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 text-slate-300 font-medium">
                          <input
                            type="checkbox"
                            checked={activeQueue.start_time_enabled}
                            onChange={(e) =>
                              updateActiveQueue({ start_time_enabled: e.target.checked })
                            }
                            className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                          />
                          Start download at:
                        </label>
                        <input
                          type="time"
                          value={activeQueue.start_time_hhmm}
                          disabled={!activeQueue.start_time_enabled}
                          onChange={(e) =>
                            updateActiveQueue({ start_time_hhmm: e.target.value })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 disabled:opacity-40"
                        />
                      </div>

                      {/* Stop Time */}
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 text-slate-300 font-medium">
                          <input
                            type="checkbox"
                            checked={activeQueue.stop_time_enabled}
                            onChange={(e) =>
                              updateActiveQueue({ stop_time_enabled: e.target.checked })
                            }
                            className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                          />
                          Stop download at:
                        </label>
                        <input
                          type="time"
                          value={activeQueue.stop_time_hhmm}
                          disabled={!activeQueue.stop_time_enabled}
                          onChange={(e) =>
                            updateActiveQueue({ stop_time_hhmm: e.target.value })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 disabled:opacity-40"
                        />
                      </div>
                    </div>

                    {/* Active Days */}
                    <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-400">
                        Active Days of the Week:
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {DAY_LABELS.map((dayName, idx) => {
                          const active = (activeQueue.days_of_week || []).includes(idx);
                          return (
                            <button
                              key={dayName}
                              type="button"
                              onClick={() => toggleDay(idx)}
                              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                                active
                                  ? "bg-indigo-600 text-white shadow"
                                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
                              }`}
                            >
                              {dayName}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Post-Queue Action */}
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
                    <div className="font-semibold text-slate-200 flex items-center gap-2">
                      <Power className="w-4 h-4 text-emerald-400" />
                      When All Downloads in Queue Complete:
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { id: "none", label: "Do Nothing (Keep Running)" },
                        { id: "exit_app", label: "Exit ByteX Download Manager" },
                        { id: "sleep", label: "Put Computer to Sleep" },
                        { id: "shutdown", label: "Turn off Computer (Shutdown)" },
                      ].map((act) => (
                        <label
                          key={act.id}
                          className={`p-2.5 rounded-lg border flex items-center gap-2 cursor-pointer transition ${
                            activeQueue.post_queue_action === act.id
                              ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300 font-semibold"
                              : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <input
                            type="radio"
                            name="post_queue_action"
                            value={act.id}
                            checked={activeQueue.post_queue_action === act.id}
                            onChange={() =>
                              updateActiveQueue({
                                post_queue_action: act.id as any,
                              })
                            }
                            className="text-indigo-600 bg-slate-900 border-slate-700 focus:ring-0"
                          />
                          {act.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Files in Queue */}
              {activeTab === "queue_files" && (
                <div className="space-y-2">
                  {queueDownloads.length === 0 ? (
                    <div className="py-12 text-center text-slate-500">
                      No files currently assigned to this queue.
                      <div className="text-[11px] text-slate-600 mt-1">
                        Right-click any download in the main list and select "Move to Queue" to assign it here.
                      </div>
                    </div>
                  ) : (
                    queueDownloads.map((d, index) => (
                      <div
                        key={d.id}
                        className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-5 text-center font-mono text-slate-500 font-bold">
                            #{index + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-200 truncate">
                              {d.filename}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              {d.url}
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 capitalize shrink-0 font-medium">
                          {d.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 4: Individually Scheduled Downloads */}
              {activeTab === "scheduled_files" && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-400">
                    Individual downloads can be configured with their own automatic start and stop date/time windows.
                  </div>

                  {scheduledDownloads.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 border border-dashed border-slate-800 rounded-xl">
                      No downloads currently have individual date/time schedules.
                      <div className="text-[11px] text-slate-600 mt-1">
                        Right-click any download in the main table and select "Schedule Download..." to set automated start/stop times.
                      </div>
                    </div>
                  ) : (
                    scheduledDownloads.map((d) => (
                      <div
                        key={d.id}
                        className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-200 truncate">{d.filename}</div>
                          <div className="text-[11px] text-indigo-400 mt-1 flex items-center gap-3">
                            {d.scheduled_start && (
                              <span>Start: {new Date(d.scheduled_start).toLocaleString()}</span>
                            )}
                            {d.scheduled_stop && (
                              <span>Stop: {new Date(d.scheduled_stop).toLocaleString()}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={async () => {
                              if (onScheduleDownload) {
                                await onScheduleDownload(d.id, null, null);
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
                          >
                            Clear Schedule
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onStartQueueNow(activeQueue.id);
                onClose();
              }}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow"
            >
              <Play className="w-3.5 h-3.5" /> Start Queue Now
            </button>
            {savedNotice && (
              <span className="text-emerald-400 text-xs flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Schedule Saved
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow"
            >
              <Save className="w-3.5 h-3.5" /> Save Changes
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* MODAL: Create New Custom Queue */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-60 p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" /> Create Custom Queue
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Queue Name</label>
                <input
                  type="text"
                  placeholder="e.g. Work Downloads, 4K Movies"
                  value={newQueueName}
                  onChange={(e) => setNewQueueName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Max Concurrency</label>
                  <select
                    value={newQueueConcurrency}
                    onChange={(e) => setNewQueueConcurrency(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    {[1, 2, 3, 4, 5, 8, 10, 16, 20].map((num) => (
                      <option key={num} value={num}>
                        {num} simultaneous
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-slate-300 font-medium">Priority</label>
                  <select
                    value={newQueuePriority}
                    onChange={(e) => setNewQueuePriority(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Custom Directory (Optional)</label>
                <input
                  type="text"
                  placeholder="Leave blank to use default directory"
                  value={newQueueDir}
                  onChange={(e) => setNewQueueDir(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={!newQueueName.trim()}
                onClick={handleCreateQueue}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold shadow"
              >
                Create Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Safe Queue Deletion Dialogue (OBJECTIVE.md §5) */}
      {deleteTargetQueue && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-60 p-4">
          <div className="bg-[#0f172a] border border-amber-600/60 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <div>
                <h3 className="font-bold text-white text-sm">
                  Delete Queue: {deleteTargetQueue.name}?
                </h3>
                <p className="text-[11px] text-slate-400">
                  Deleting a queue must not silently delete its downloads. Where would you like to move jobs currently in this queue?
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs">
              <div className="text-slate-300">
                Jobs currently assigned:{" "}
                <strong className="text-indigo-400">
                  {downloads.filter((d) => d.queue_id === deleteTargetQueue.id).length}
                </strong>
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Reassign all jobs to:</label>
                <select
                  value={reassignDestinationId}
                  onChange={(e) => setReassignDestinationId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white"
                >
                  {queues
                    .filter((q) => q.id !== deleteTargetQueue.id)
                    .map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name} ({downloads.filter((d) => d.queue_id === q.id).length} files)
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteTargetQueue(null)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteQueue}
                className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow"
              >
                Reassign Jobs & Delete Queue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
