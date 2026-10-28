import React, { useState } from "react";
import { Cpu, Magnet, Terminal, ShieldCheck } from "lucide-react";
import { DownloadItem } from "../types/xdm";
import { formatBytes, formatSpeed } from "../services/tauriBridge";

interface SegmentInspectorProps {
  item: DownloadItem | null;
}

export const SegmentInspector: React.FC<SegmentInspectorProps> = ({ item }) => {
  const [activeTab, setActiveTab] = useState<"segments" | "torrent" | "log">("segments");

  if (!item) {
    return (
      <div className="h-60 bg-[#111827] border-t border-slate-800 flex items-center justify-center text-xs text-slate-500">
        Select a download above to inspect multi-threaded segments, BitTorrent peers, or FTP/Auth handshake logs.
      </div>
    );
  }

  return (
    <section className="h-64 bg-[#111827] border-t border-slate-800 flex flex-col shrink-0 select-none">
      {/* Header Bar */}
      <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("segments")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
              activeTab === "segments"
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Threads & Byte Segments ({item.segments.length})
          </button>

          {item.torrent_meta && (
            <button
              onClick={() => setActiveTab("torrent")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
                activeTab === "torrent"
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Magnet className="w-3.5 h-3.5" />
              BitTorrent Peers & Files ({item.torrent_meta.peers_connected} Peers)
            </button>
          )}

          <button
            onClick={() => setActiveTab("log")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
              activeTab === "log"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Protocol & Auth Log ({item.transfer_log.length})
          </button>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span>
            Save Path: <strong className="text-slate-200 font-mono">{item.save_path}</strong>
          </span>
          {item.checksum_sha256 && (
            <span className="flex items-center gap-1 text-emerald-400 font-mono">
              <ShieldCheck className="w-3.5 h-3.5" />
              SHA256: {item.checksum_sha256.slice(0, 12)}...
            </span>
          )}
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-auto p-3">
        {activeTab === "segments" && (
          <div className="space-y-3">
            {/* IDM Visual Chunk Map */}
            <div>
              <div className="text-[11px] text-slate-400 mb-1 flex justify-between">
                <span>IDM Dynamic Byte-Range Allocation Map ({item.threads_count} Threads)</span>
                <span className="text-slate-300 font-mono">
                  {formatBytes(item.downloaded_bytes)} / {formatBytes(item.total_bytes)}
                </span>
              </div>
              <div className="h-4 w-full bg-slate-900 rounded-lg p-0.5 border border-slate-800 flex gap-0.5">
                {item.segments.map((seg) => {
                  const len = Math.max(1, seg.end_byte - seg.start_byte + 1);
                  const pct = Math.min(100, (seg.downloaded_bytes / len) * 100);
                  return (
                    <div
                      key={seg.id}
                      className="flex-1 bg-slate-950 rounded-sm overflow-hidden relative"
                      title={`Thread #${seg.id}: ${pct.toFixed(1)}% (${formatSpeed(seg.speed_bps)})`}
                    >
                      <div
                        className={`h-full ${
                          seg.status === "completed"
                            ? "bg-emerald-500"
                            : seg.status === "receiving"
                            ? "bg-blue-500"
                            : "bg-amber-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Per-Thread Table */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {item.segments.map((seg) => {
                const len = Math.max(1, seg.end_byte - seg.start_byte + 1);
                const pct = Math.min(100, (seg.downloaded_bytes / len) * 100);
                return (
                  <div
                    key={seg.id}
                    className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between text-[11px]"
                  >
                    <div>
                      <div className="font-semibold text-slate-200">Thread #{seg.id}</div>
                      <div className="text-[10px] text-slate-400">
                        {formatBytes(seg.downloaded_bytes)} / {formatBytes(len)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-emerald-400 font-semibold">
                        {seg.speed_bps > 0 ? formatSpeed(seg.speed_bps) : seg.status}
                      </div>
                      <div className="text-[10px] text-slate-400">{pct.toFixed(0)}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "torrent" && item.torrent_meta && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <div className="font-semibold text-slate-200 mb-2 flex justify-between">
                <span>Connected Swarm Peers</span>
                <span className="text-emerald-400 font-mono">
                  InfoHash: {item.torrent_meta.info_hash.slice(0, 16)}...
                </span>
              </div>
              <table className="w-full text-[11px]">
                <thead className="text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-1 text-left">Peer IP:Port</th>
                    <th className="py-1 text-left">Client</th>
                    <th className="py-1 text-left">Flags</th>
                    <th className="py-1 text-right">Down Speed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {item.torrent_meta.peers.map((p, idx) => (
                    <tr key={idx}>
                      <td className="py-1 font-mono text-slate-200">{p.ip_port}</td>
                      <td className="py-1 text-slate-300">{p.client}</td>
                      <td className="py-1 text-indigo-400 font-mono">{p.flags}</td>
                      <td className="py-1 text-right font-mono text-emerald-400">
                        {formatSpeed(p.down_speed_bps)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
              <div className="font-semibold text-slate-200 mb-2 flex justify-between">
                <span>Torrent Files & Selective Priority</span>
                <span className="text-indigo-400">
                  Ratio: {item.torrent_meta.share_ratio.toFixed(2)}
                </span>
              </div>
              <div className="space-y-1.5">
                {item.torrent_meta.files.map((f) => (
                  <div
                    key={f.index}
                    className="p-2 rounded bg-slate-950/70 border border-slate-800 flex items-center justify-between text-[11px]"
                  >
                    <span className="truncate font-mono text-slate-200">{f.path}</span>
                    <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 uppercase text-[10px] font-semibold">
                      {f.priority} ({formatBytes(f.size_bytes)})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "log" && (
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-[11px] space-y-1 text-slate-300">
            {item.resolved_url && (
              <div className="text-amber-300">
                [Resolved Direct Stream] {item.resolved_url}
              </div>
            )}
            {item.transfer_log.map((line, i) => (
              <div key={i} className="text-slate-300">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
