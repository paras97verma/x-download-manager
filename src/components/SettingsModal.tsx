import React, { useState } from "react";
import {
  X,
  Sliders,
  Cpu,
  Gauge,
  Magnet,
  KeyRound,
  FolderOpen,
  Puzzle,
  Globe,
  Plus,
  Trash2,
} from "lucide-react";
import { AppSettings, SiteCredential } from "../types/xdm";

interface SettingsModalProps {
  initialTab?: string;
  settings: AppSettings;
  onSave: (updated: AppSettings) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  initialTab = "general",
  settings,
  onSave,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [draft, setDraft] = useState<AppSettings>(JSON.parse(JSON.stringify(settings)));

  const [newHostPattern, setNewHostPattern] = useState("*.usersdrive.com");
  const [newSiteType, setNewSiteType] = useState<SiteCredential["site_type"]>("usersdrive");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newCookies, setNewCookies] = useState("");

  const tabs = [
    { id: "general", label: "General", icon: Sliders },
    { id: "connections", label: "Connections & Threads", icon: Cpu },
    { id: "speed", label: "Speed Limiter", icon: Gauge },
    { id: "torrent", label: "BitTorrent / DHT", icon: Magnet },
    { id: "logins", label: "Site Logins & Auth", icon: KeyRound },
    { id: "categories", label: "File Categories", icon: FolderOpen },
    { id: "browser", label: "Browser Monitoring", icon: Puzzle },
    { id: "proxy", label: "Proxy & Network", icon: Globe },
  ];

  const addCredential = () => {
    if (!newHostPattern.trim()) return;
    const entry: SiteCredential = {
      id: `cred-${Date.now()}`,
      host_pattern: newHostPattern.trim(),
      site_type: newSiteType,
      username: newUsername.trim(),
      password_or_token: newPassword,
      cookies: newCookies.trim() || null,
      custom_headers: {},
      enabled: true,
    };
    setDraft({
      ...draft,
      site_credentials: [...draft.site_credentials, entry],
    });
    setNewUsername("");
    setNewPassword("");
    setNewCookies("");
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-4xl h-[560px] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="font-bold text-sm text-white">
            X Download Manager — Professional Configuration & Options
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body with Sidebar */}
        <div className="flex-1 flex overflow-hidden">
          <div className="w-52 bg-slate-900/70 border-r border-slate-800 p-2.5 space-y-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition ${
                    activeTab === t.id
                      ? "bg-blue-600 text-white"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 p-5 overflow-y-auto text-xs space-y-4">
            {activeTab === "general" && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white">General Behavior & OS Integration</h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <input
                      type="checkbox"
                      checked={draft.start_on_boot}
                      onChange={(e) => setDraft({ ...draft, start_on_boot: e.target.checked })}
                    />
                    Launch X Download Manager on system startup
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <input
                      type="checkbox"
                      checked={draft.minimize_to_tray}
                      onChange={(e) => setDraft({ ...draft, minimize_to_tray: e.target.checked })}
                    />
                    Keep running in macOS Menu Bar / System Tray
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <input
                      type="checkbox"
                      checked={draft.auto_verify_checksum}
                      onChange={(e) => setDraft({ ...draft, auto_verify_checksum: e.target.checked })}
                    />
                    Auto-compute SHA-256 checksum on completion
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                    <input
                      type="checkbox"
                      checked={draft.prevent_system_sleep}
                      onChange={(e) => setDraft({ ...draft, prevent_system_sleep: e.target.checked })}
                    />
                    Prevent OS sleep while active downloads are running
                  </label>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Default Download Directory</label>
                  <input
                    type="text"
                    value={draft.default_download_dir}
                    onChange={(e) => setDraft({ ...draft, default_download_dir: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 font-mono"
                  />
                </div>
              </div>
            )}

            {activeTab === "connections" && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white">Multi-Threaded Segmentation Engine (IDM Mode)</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Default Parallel Threads per Download ({draft.default_threads_per_download})
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={32}
                      value={draft.default_threads_per_download}
                      onChange={(e) =>
                        setDraft({ ...draft, default_threads_per_download: Number(e.target.value) })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Max Concurrent Active Downloads ({draft.max_concurrent_downloads})
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={draft.max_concurrent_downloads}
                      onChange={(e) =>
                        setDraft({ ...draft, max_concurrent_downloads: Number(e.target.value) })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={draft.dynamic_segment_stealing}
                    onChange={(e) =>
                      setDraft({ ...draft, dynamic_segment_stealing: e.target.checked })
                    }
                  />
                  Enable Dynamic Segment Work-Stealing (split slow segments when fast workers finish)
                </label>
                <div>
                  <label className="block text-slate-400 mb-1">Custom HTTP User-Agent</label>
                  <input
                    type="text"
                    value={draft.custom_user_agent}
                    onChange={(e) => setDraft({ ...draft, custom_user_agent: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 font-mono"
                  />
                </div>
              </div>
            )}

            {activeTab === "speed" && (
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-white">Token-Bucket Bandwidth Speed Limiter</h3>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={draft.speed_limiter_enabled}
                    onChange={(e) =>
                      setDraft({ ...draft, speed_limiter_enabled: e.target.checked })
                    }
                  />
                  Enable Global Bandwidth Speed Limiter
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-400 mb-1">Max Download Speed (KB/s)</label>
                    <input
                      type="number"
                      value={draft.global_max_download_kbps}
                      onChange={(e) =>
                        setDraft({ ...draft, global_max_download_kbps: Number(e.target.value) })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Max Upload / Seeding Speed (KB/s)</label>
                    <input
                      type="number"
                      value={draft.global_max_upload_kbps}
                      onChange={(e) =>
                        setDraft({ ...draft, global_max_upload_kbps: Number(e.target.value) })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "torrent" && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white">BitTorrent & Magnet Protocol Settings</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex items-center gap-2 p-2 rounded bg-slate-900 border border-slate-800">
                    <input
                      type="checkbox"
                      checked={draft.torrent.enable_dht}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          torrent: { ...draft.torrent, enable_dht: e.target.checked },
                        })
                      }
                    />
                    Enable Mainline DHT (Trackerless Torrents)
                  </label>
                  <label className="flex items-center gap-2 p-2 rounded bg-slate-900 border border-slate-800">
                    <input
                      type="checkbox"
                      checked={draft.torrent.enable_pex}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          torrent: { ...draft.torrent, enable_pex: e.target.checked },
                        })
                      }
                    />
                    Enable Peer Exchange (PEX) & Local Peer Discovery
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">Listening Port</label>
                    <input
                      type="number"
                      value={draft.torrent.listen_port}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          torrent: { ...draft.torrent, listen_port: Number(e.target.value) },
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Stop Seeding at Share Ratio</label>
                    <input
                      type="number"
                      step="0.1"
                      value={draft.torrent.seed_ratio_limit}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          torrent: { ...draft.torrent, seed_ratio_limit: Number(e.target.value) },
                        })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "logins" && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white">
                  Site Logins Vault (Usersdrive, 1fichier, MediaFire, FTP/SFTP, Basic/Bearer Auth)
                </h3>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={newHostPattern}
                      onChange={(e) => setNewHostPattern(e.target.value)}
                      placeholder="*.usersdrive.com"
                      className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200"
                    />
                    <select
                      value={newSiteType}
                      onChange={(e) => setNewSiteType(e.target.value as SiteCredential["site_type"])}
                      className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200"
                    >
                      <option value="usersdrive">Usersdrive Resolver</option>
                      <option value="1fichier">1fichier</option>
                      <option value="mediafire">MediaFire</option>
                      <option value="ftp">FTP / FTPS</option>
                      <option value="sftp">SFTP (SSH)</option>
                      <option value="http_basic">HTTP Basic Auth</option>
                      <option value="bearer">Bearer Token</option>
                    </select>
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="Username"
                      className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Password or API Token"
                      className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200"
                    />
                    <input
                      type="text"
                      value={newCookies}
                      onChange={(e) => setNewCookies(e.target.value)}
                      placeholder="Session Cookies (xfss=...)"
                      className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono"
                    />
                    <button
                      onClick={addCredential}
                      className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded px-3 py-1.5 flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Site Auth
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {draft.site_credentials.map((c) => (
                    <div
                      key={c.id}
                      className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between"
                    >
                      <div>
                        <span className="font-mono font-bold text-amber-300">{c.host_pattern}</span>
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] uppercase">
                          {c.site_type}
                        </span>
                        <div className="text-[11px] text-slate-400">
                          User: {c.username || "session"} | Cookie: {c.cookies ? "Configured" : "None"}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          setDraft({
                            ...draft,
                            site_credentials: draft.site_credentials.filter((x) => x.id !== c.id),
                          })
                        }
                        className="text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "categories" && (
              <div className="space-y-2.5">
                <h3 className="text-sm font-bold text-white">Auto-Categorization Rules & Subfolders</h3>
                {draft.categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1"
                  >
                    <div className="font-semibold text-slate-200">
                      {cat.name} → <span className="font-mono text-blue-400">/{cat.default_subfolder}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Extensions: {cat.extensions.join(", ")}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "browser" && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white">Browser Interception & File Types</h3>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={draft.browser.auto_install_extensions_on_startup}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        browser: {
                          ...draft.browser,
                          auto_install_extensions_on_startup: e.target.checked,
                        },
                      })
                    }
                  />
                  Auto-install & register browser extensions when X Download Manager starts
                </label>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Automatically Intercept File Extensions (Comma separated)
                  </label>
                  <textarea
                    rows={3}
                    value={draft.browser.intercepted_extensions.join(", ")}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        browser: {
                          ...draft.browser,
                          intercepted_extensions: e.target.value
                            .split(",")
                            .map((s) => s.trim().toUpperCase())
                            .filter(Boolean),
                        },
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 font-mono"
                  />
                </div>
              </div>
            )}

            {activeTab === "proxy" && (
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white">HTTP / HTTPS / SOCKS5 Proxy Configuration</h3>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <input
                    type="checkbox"
                    checked={draft.proxy.enabled}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        proxy: { ...draft.proxy, enabled: e.target.checked },
                      })
                    }
                  />
                  Route all downloads & BitTorrent tracker announces through proxy
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <select
                    value={draft.proxy.proxy_type}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        proxy: {
                          ...draft.proxy,
                          proxy_type: e.target.value as AppSettings["proxy"]["proxy_type"],
                        },
                      })
                    }
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                  >
                    <option value="http">HTTP Proxy</option>
                    <option value="https">HTTPS Proxy</option>
                    <option value="socks5">SOCKS5 Proxy</option>
                  </select>
                  <input
                    type="text"
                    value={draft.proxy.host}
                    onChange={(e) =>
                      setDraft({ ...draft, proxy: { ...draft.proxy, host: e.target.value } })
                    }
                    placeholder="Proxy Host (127.0.0.1)"
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                  />
                  <input
                    type="number"
                    value={draft.proxy.port}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        proxy: { ...draft.proxy, port: Number(e.target.value) },
                      })
                    }
                    placeholder="Port"
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-900 border-t border-slate-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
          >
            Save All Settings
          </button>
        </div>
      </div>
    </div>
  );
};
