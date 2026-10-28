import React, { useState } from "react";
import {
  X,
  CalendarClock,
  Play,
  Save,
  Clock,
  Layers,
  CheckCircle2,
  ListOrdered,
  Gauge,
  Power,
} from "lucide-react";
import { AppSettings, DownloadItem, SchedulerQueueConfig } from "../types/xdm";

interface SchedulerModalProps {
  settings: AppSettings;
  downloads?: DownloadItem[];
  onSaveSettings: (newSettings: AppSettings) => void;
  onStartQueueNow: (queueId: string) => void;
  onClose: () => void;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const SchedulerModal: React.FC<SchedulerModalProps> = ({
  settings,
  downloads = [],
  onSaveSettings,
  onStartQueueNow,
  onClose,
}) => {
  const [queues, setQueues] = useState<SchedulerQueueConfig[]>(settings.queues);
  const [selectedQueueId, setSelectedQueueId] = useState<string>(
    settings.queues[0]?.id || "main-queue"
  );
  const [activeTab, setActiveTab] = useState<"schedule" | "files">("schedule");
  const [savedNotice, setSavedNotice] = useState(false);

  const activeQueue = queues.find((q) => q.id === selectedQueueId) || queues[0];

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

  const queueDownloads = downloads.filter((d) => d.queue_id === activeQueue.id);

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <CalendarClock className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">IDM Queue Scheduler & Bandwidth Planner</h2>
              <p className="text-[11px] text-slate-400">
                Automate download schedules, set concurrency limits, and execute actions on queue completion.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Body with Sidebar Queues */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Queue List */}
          <div className="w-56 bg-slate-950/60 border-r border-slate-800 p-3 space-y-2 shrink-0 overflow-y-auto">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-2 mb-1">
              Synchronization Queues
            </div>
            {queues.map((q) => {
              const active = q.id === activeQueue.id;
              const count = downloads.filter((d) => d.queue_id === q.id).length;
              return (
                <button
                  key={q.id}
                  onClick={() => setSelectedQueueId(q.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition ${
                    active
                      ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/40"
                      : "text-slate-300 hover:bg-slate-900"
                  }`}
                >
                  <span className="truncate">{q.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right: Queue Config Panels */}
          <div className="flex-1 flex flex-col overflow-hidden bg-[#111827]">
            {/* Sub-tabs */}
            <div className="px-5 py-2.5 bg-slate-900/60 border-b border-slate-800 flex items-center gap-3 shrink-0">
              <button
                onClick={() => setActiveTab("schedule")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === "schedule"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Clock className="w-3.5 h-3.5" /> Schedule & Timing
              </button>
              <button
                onClick={() => setActiveTab("files")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === "files"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <ListOrdered className="w-3.5 h-3.5" /> Files in Queue ({queueDownloads.length})
              </button>
            </div>

            {/* Tab Contents */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {activeTab === "schedule" ? (
                <>
                  {/* Start / Stop Times */}
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                    <div className="font-semibold text-slate-200 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-indigo-400" />
                      Execution Schedule
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

                    {/* Active Days of Week */}
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

                  {/* Concurrency & Speed Limit */}
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                    <div className="font-semibold text-slate-200 flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-blue-400" />
                      Concurrency & Throughput Controls
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-300 font-medium">
                          Max Simultaneous Downloads in this Queue
                        </label>
                        <select
                          value={activeQueue.max_concurrent}
                          onChange={(e) =>
                            updateActiveQueue({ max_concurrent: Number(e.target.value) })
                          }
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100"
                        >
                          {[1, 2, 3, 4, 5, 8, 10].map((num) => (
                            <option key={num} value={num}>
                              {num} simultaneous {num === 1 ? "file" : "files"}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-300 font-medium">
                          Queue Speed Limit Cap (KB/s)
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
                        <span className="text-[10px] text-slate-500">
                          Set to 0 for maximum unthrottled bandwidth
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Post-Queue Completion Action */}
                  <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
                    <div className="font-semibold text-slate-200 flex items-center gap-2">
                      <Power className="w-4 h-4 text-emerald-400" />
                      When All Downloads in Queue Complete:
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { id: "none", label: "Do Nothing (Keep Running)" },
                        { id: "exit_app", label: "Exit X Download Manager" },
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
                </>
              ) : (
                /* Files in Queue */
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
                            <div className="font-semibold text-slate-200 truncate">{d.filename}</div>
                            <div className="text-[10px] text-slate-400 truncate">{d.url}</div>
                          </div>
                        </div>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 capitalize shrink-0">
                          {d.status}
                        </span>
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
    </div>
  );
};
