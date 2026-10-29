import React from "react";
import {
  Layers,
  Archive,
  Cpu,
  Film,
  Music,
  FileText,
  Magnet,
  DownloadCloud,
  CheckCircle2,
  PauseCircle,
  Clock,
  Server,
} from "lucide-react";
import { DownloadItem, SchedulerQueueConfig } from "../types/xdm";

interface SidebarProps {
  downloads: DownloadItem[];
  selectedCategory: string;
  onSelectCategory: (cat: string) => void;
  selectedStatus: string;
  onSelectStatus: (st: string) => void;
  queues: SchedulerQueueConfig[];
  selectedQueue: string;
  onSelectQueue: (qId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  downloads,
  selectedCategory,
  onSelectCategory,
  selectedStatus,
  onSelectStatus,
  queues,
  selectedQueue,
  onSelectQueue,
}) => {
  const categories = [
    { id: "all", label: "All Downloads", icon: Layers },
    { id: "Compressed", label: "Compressed", icon: Archive },
    { id: "Programs", label: "Programs", icon: Cpu },
    { id: "Video", label: "Video", icon: Film },
    { id: "Music", label: "Music", icon: Music },
    { id: "Documents", label: "Documents", icon: FileText },
    { id: "Torrents", label: "BitTorrent / Magnet", icon: Magnet },
  ];

  const statuses = [
    { id: "all", label: "All States", icon: Layers },
    { id: "downloading", label: "Downloading", icon: DownloadCloud },
    { id: "paused", label: "Paused", icon: PauseCircle },
    { id: "queued", label: "Queued", icon: Clock },
    { id: "completed", label: "Completed", icon: CheckCircle2 },
  ];

  const countByCat = (id: string) =>
    id === "all" ? downloads.length : downloads.filter((d) => d.category === id).length;

  const countByStatus = (st: string) =>
    st === "all" ? downloads.length : downloads.filter((d) => d.status === st).length;

  return (
    <aside className="w-60 bg-[#111827] border-r border-slate-800 flex flex-col justify-between p-3 select-none shrink-0 overflow-y-auto">
      <div className="space-y-5">
        {/* Categories */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 mb-1.5">
            Categories
          </div>
          <div className="space-y-0.5">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const active = selectedCategory === cat.id && selectedQueue === "all";
              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    onSelectQueue("all");
                    onSelectCategory(cat.id);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                    active
                      ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                      : "text-slate-300 hover:bg-slate-800/70"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5" />
                    {cat.label}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                    {countByCat(cat.id)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Transfer Status */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 mb-1.5">
            Status Filter
          </div>
          <div className="space-y-0.5">
            {statuses.map((st) => {
              const Icon = st.icon;
              const active = selectedStatus === st.id;
              return (
                <button
                  key={st.id}
                  onClick={() => onSelectStatus(st.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                    active
                      ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                      : "text-slate-300 hover:bg-slate-800/70"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5" />
                    {st.label}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                    {countByStatus(st.id)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* XDM Synchronized Queues */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 mb-1.5">
            Download Queues
          </div>
          <div className="space-y-0.5">
            {queues.map((q) => {
              const active = selectedQueue === q.id;
              const qCount = downloads.filter((d) => d.queue_id === q.id).length;
              return (
                <button
                  key={q.id}
                  onClick={() => onSelectQueue(active ? "all" : q.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                    active
                      ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                      : "text-slate-300 hover:bg-slate-800/70"
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Server className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span className="truncate">{q.name}</span>
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                    {qCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Native Bridge Telemetry Card */}
      <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-400 font-medium">Native Bridge</span>
          <span className="flex items-center gap-1 text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            127.0.0.1:45678
          </span>
        </div>
        <div className="text-[10px] text-slate-400 leading-relaxed">
          Intercepting Chromium, Firefox & Safari downloads + Usersdrive/FTP Auth.
        </div>
      </div>
    </aside>
  );
};
