import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SchedulerModal } from "../components/SchedulerModal";
import { DEFAULT_SETTINGS } from "../services/tauriBridge";
import { DownloadItem } from "../types/xdm";

describe("SchedulerModal Component", () => {
  const mockDownloads: DownloadItem[] = [
    {
      id: "dl-1",
      url: "https://example.com/file1.zip",
      filename: "file1.zip",
      save_path: "/downloads/file1.zip",
      total_bytes: 1000000,
      downloaded_bytes: 500000,
      status: "downloading",
      speed_bps: 125000,
      eta_seconds: 4,
      queue_id: "main-queue",
      threads_count: 8,
      priority: "normal",
      speed_limit_bps: null,
      protocol: "https",
      category: "other",
      upload_speed_bps: 0,
      custom_headers: {},
      segments: [],
      resumable: true,
      created_at: new Date().toISOString(),
      transfer_log: [],
    },
  ];

  it("renders the 7-day schedule timetable grid and queue list", () => {
    render(
      <SchedulerModal
        settings={DEFAULT_SETTINGS}
        downloads={mockDownloads}
        onSaveSettings={vi.fn()}
        onStartQueueNow={vi.fn()}
        onToggleQueuePause={vi.fn()}
        onScheduleDownload={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/ByteX Custom Queues & Visual Scheduler/i)).toBeInTheDocument();
    expect(screen.getAllByText("Main Download Queue").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Night Off-Peak Queue").length).toBeGreaterThan(0);
    expect(screen.getByText("7-Day Timetable")).toBeInTheDocument();
  });

  it("switches to the Queue Settings tab and shows queue configuration", async () => {
    const user = userEvent.setup();
    render(
      <SchedulerModal
        settings={DEFAULT_SETTINGS}
        downloads={mockDownloads}
        onSaveSettings={vi.fn()}
        onStartQueueNow={vi.fn()}
        onToggleQueuePause={vi.fn()}
        onScheduleDownload={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const settingsTab = screen.getByRole("button", { name: /Queue Settings/i });
    await user.click(settingsTab);

    expect(screen.getByText("Queue Identity & Default Path")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New/i })).toBeInTheDocument();
  });
});
