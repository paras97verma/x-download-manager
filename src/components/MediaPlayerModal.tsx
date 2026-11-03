import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  ExternalLink,
  Film,
  Music,
  Radio,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { MediaStreamInfo } from "../types/xdm";
import { apiOpenInExternalPlayer } from "../services/tauriBridge";

interface MediaPlayerModalProps {
  mediaInfo: MediaStreamInfo | null;
  onClose: () => void;
}

export const MediaPlayerModal: React.FC<MediaPlayerModalProps> = ({
  mediaInfo,
  onClose,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!mediaInfo) return null;

  const isVideo = mediaInfo.is_video;
  const isAudio = mediaInfo.is_audio;
  const activeMedia = isVideo ? videoRef.current : audioRef.current;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const h = Math.floor(m / 60);
    if (h > 0) {
      const remM = m % 60;
      return `${h}:${remM < 10 ? "0" : ""}${remM}:${s < 10 ? "0" : ""}${s}`;
    }
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const togglePlay = () => {
    if (!activeMedia) return;
    if (activeMedia.paused) {
      activeMedia.play().catch(() => {});
    } else {
      activeMedia.pause();
    }
  };

  const handleTimeUpdate = () => {
    if (!activeMedia) return;
    setCurrentTime(activeMedia.currentTime);
    if (activeMedia.duration && !isNaN(activeMedia.duration)) {
      setDuration(activeMedia.duration);
    }
    // Update buffered progress
    if (activeMedia.buffered.length > 0) {
      try {
        const end = activeMedia.buffered.end(activeMedia.buffered.length - 1);
        setBufferedEnd(end);
      } catch {
        // Ignored
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (activeMedia) {
      activeMedia.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (activeMedia) {
      activeMedia.volume = val;
      activeMedia.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!activeMedia) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    activeMedia.muted = nextMuted;
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (activeMedia) {
      activeMedia.playbackRate = speed;
    }
  };

  const handleOpenExternal = () => {
    apiOpenInExternalPlayer(mediaInfo.download_id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        ref={containerRef}
        className="flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden w-full max-w-4xl max-h-[92vh]"
      >
        {/* Header Ribbon */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-800/90 border-b border-slate-700/60 select-none">
          <div className="flex items-center space-x-3 overflow-hidden pr-4">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              {isVideo ? <Film className="w-5 h-5" /> : <Music className="w-5 h-5" />}
            </div>
            <div className="flex flex-col truncate">
              <span className="text-sm font-semibold text-slate-100 truncate">
                {mediaInfo.filename}
              </span>
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-slate-400 font-mono">
                  {mediaInfo.mime_type}
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400">
                  {formatBytes(mediaInfo.downloaded_bytes)} of {formatBytes(mediaInfo.total_bytes)}
                </span>
                <span className="text-slate-600">•</span>
                {mediaInfo.is_complete ? (
                  <span className="flex items-center text-emerald-400 font-medium space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Complete</span>
                  </span>
                ) : (
                  <span className="flex items-center text-amber-400 font-medium space-x-1">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    <span>Live Stream</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={handleOpenExternal}
              title="Open in System Media Player (VLC / QuickTime / MPV)"
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700/70 hover:bg-slate-700 text-slate-200 border border-slate-600/60 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>External Player</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Media Viewport */}
        <div className="relative flex-1 bg-black flex items-center justify-center min-h-[360px] max-h-[580px] overflow-hidden group">
          {isVideo ? (
            <video
              ref={videoRef}
              src={mediaInfo.stream_url}
              className="w-full h-full object-contain cursor-pointer"
              onClick={togglePlay}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={handleTimeUpdate}
              onWaiting={() => setIsBuffering(true)}
              onPlaying={() => setIsBuffering(false)}
              onLoadedData={() => setIsBuffering(false)}
              onError={() => {
                setHasError(true);
                setIsBuffering(false);
              }}
              autoPlay
              playsInline
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center space-y-4">
              <audio
                ref={audioRef}
                src={mediaInfo.stream_url}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={handleTimeUpdate}
                onWaiting={() => setIsBuffering(true)}
                onPlaying={() => setIsBuffering(false)}
                onLoadedData={() => setIsBuffering(false)}
                onError={() => {
                  setHasError(true);
                  setIsBuffering(false);
                }}
                autoPlay
              />
              <div className="relative flex items-center justify-center w-28 h-28 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-xl shadow-indigo-500/20">
                <Music className="w-14 h-14 animate-pulse" />
                {isPlaying && (
                  <span className="absolute -inset-1 rounded-full border-2 border-indigo-400/50 animate-ping" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-medium text-slate-200">
                  {mediaInfo.filename}
                </h3>
                <p className="text-xs text-slate-400">
                  Local HTTP Range Audio Stream
                </p>
              </div>
            </div>
          )}

          {/* Buffering Overlay */}
          {isBuffering && !hasError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none">
              <div className="flex items-center space-x-2.5 px-4 py-2 rounded-xl bg-slate-900/90 border border-slate-700/80 shadow-lg text-slate-200 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Buffering stream data...</span>
              </div>
            </div>
          )}

          {/* Codec Error Fallback */}
          {hasError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-6 text-center space-y-3">
              <div className="p-3 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <AlertCircle className="w-8 h-8" />
              </div>
              <div className="space-y-1 max-w-md">
                <h4 className="text-sm font-semibold text-slate-200">
                  Codec Unsupported by System Webview
                </h4>
                <p className="text-xs text-slate-400">
                  The container format or audio/video codec (e.g. MKV/AC3) cannot be decoded directly by the browser engine. The file is intact and actively streaming.
                </p>
              </div>
              <button
                onClick={handleOpenExternal}
                className="flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Launch in VLC / External Player</span>
              </button>
            </div>
          )}
        </div>

        {/* Custom Controls Bar */}
        <div className="p-4 bg-slate-850 bg-slate-900/95 border-t border-slate-800 space-y-3 select-none">
          {/* Progress / Seek Slider */}
          <div className="space-y-1">
            <div className="relative flex items-center group/scrub">
              {/* Buffer Bar Indicator */}
              <div
                className="absolute top-1/2 -translate-y-1/2 left-0 h-1.5 bg-indigo-950/70 rounded-lg pointer-events-none"
                style={{
                  width: `${duration > 0 ? (bufferedEnd / duration) * 100 : 0}%`,
                }}
              />
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 relative z-10"
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-slate-400 px-0.5">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              {/* Play / Pause */}
              <button
                onClick={togglePlay}
                className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-colors"
                title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
              </button>

              {/* Volume */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={toggleMute}
                  className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
              </div>

              {/* Speed Preset Selector */}
              <div className="flex items-center space-x-1 pl-2">
                {[0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSpeedChange(s)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      playbackSpeed === s
                        ? "bg-indigo-500/30 text-indigo-300 font-bold border border-indigo-500/40"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {/* Live Streaming Badge */}
              <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>ByteX Engine • Port 45678</span>
              </div>

              {/* Fullscreen (Video only) */}
              {isVideo && (
                <button
                  onClick={toggleFullscreen}
                  className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                  title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
