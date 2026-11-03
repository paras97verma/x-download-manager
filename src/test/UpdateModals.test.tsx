import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { UpdateRestorationModal } from "../components/UpdateRestorationModal";
import { UpdateCheckModal } from "../components/UpdateCheckModal";
import { UpdateRestorationReport } from "../types/xdm";
import * as tauriBridge from "../services/tauriBridge";

vi.mock("../services/tauriBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof tauriBridge>();
  return {
    ...actual,
    apiDismissUpdateRestorationReport: vi.fn().mockResolvedValue(true),
    apiVerifyAndResumeDownload: vi.fn().mockResolvedValue({
      id: "res-1",
      can_resume: true,
      accepts_ranges: true,
      validator_matches: true,
      server_total_bytes: 1048576000,
      message: "Transfer resumed.",
    }),
    apiCheckForUpdates: vi.fn().mockResolvedValue({
      current_version: "1.0.2",
      latest_version: "1.0.3",
      has_update: true,
      release_notes: "- Added safe application update flow.\n- Enhanced database recovery.",
      release_url: "https://github.com/paras97verma/x-download-manager/releases/tag/v1.0.3",
      published_at: "2026-11-03T10:00:00Z",
    }),
    apiPrepareAppForUpdate: vi.fn().mockResolvedValue({
      success: true,
      paused_downloads_count: 3,
      queued_downloads_count: 1,
      completed_downloads_count: 5,
      backup_path: "/mock/bytex.db.backup",
      db_intact: true,
      prepared_at: "2026-11-03T10:00:00Z",
      message: "Ready for updater.",
    }),
  };
});

describe("Update Modals Component Tests", () => {
  const mockReport: UpdateRestorationReport = {
    restored_at: "2026-11-03T10:00:00Z",
    app_version: "1.0.2",
    previous_version: "1.0.1",
    total_restored: 2,
    safely_paused: 2,
    completed_verified: 0,
    db_restored_from_backup: false,
    ready_to_resume: [
      {
        id: "res-1",
        filename: "large_archive.zip",
        downloaded_bytes: 524288000,
        total_bytes: 1048576000,
        resumable: true,
        reason: "HTTP Range and ETag match",
      },
    ],
    non_resumable_protected: [
      {
        id: "non-res-1",
        filename: "stream_dump.iso",
        downloaded_bytes: 104857600,
        total_bytes: 209715200,
        resumable: false,
        reason: "Server does not support range requests",
      },
    ],
  };

  it("renders UpdateRestorationModal with restored downloads, ready items, and protected non-resumable items", () => {
    render(
      <UpdateRestorationModal
        report={mockReport}
        onClose={vi.fn()}
        onRefreshDownloads={vi.fn()}
      />
    );

    expect(screen.getByText(/ByteX Download Manager Updated Successfully/i)).toBeInTheDocument();
    expect(screen.getByText(/2 Total Transfers Preserved/i)).toBeInTheDocument();
    expect(screen.getByText("large_archive.zip")).toBeInTheDocument();
    expect(screen.getByText("stream_dump.iso")).toBeInTheDocument();
    expect(screen.getByText(/Protected Non-Resumable Transfers/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Acknowledge & Close/i })).toBeInTheDocument();
  });

  it("renders UpdateCheckModal and displays update details when available", async () => {
    render(
      <UpdateCheckModal
        appVersion="1.0.2"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Software Updates/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/New Version Available: v1.0.3/i)).toBeInTheDocument();
      expect(screen.getByText(/Current: v1.0.2/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Prepare App for Update/i })).toBeInTheDocument();
  });
});
