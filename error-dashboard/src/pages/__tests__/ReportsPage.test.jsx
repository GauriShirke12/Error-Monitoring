import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/toast/ToastContainer";
import { ReportsPage } from "../ReportsPage";
import {
  fetchReportSchedules,
  fetchReportRuns,
  createReportSchedule,
  deleteReportSchedule,
  deleteReportRun,
  runReportScheduleNow,
  updateReportSchedule,
  createReportShare,
  downloadReportRun,
  requestReportGeneration,
} from "../../services/api";

jest.mock("../../services/api", () => ({
  fetchReportSchedules: jest.fn(),
  fetchReportRuns: jest.fn(),
  createReportSchedule: jest.fn(),
  deleteReportSchedule: jest.fn(),
  deleteReportRun: jest.fn(),
  runReportScheduleNow: jest.fn(),
  updateReportSchedule: jest.fn(),
  createReportShare: jest.fn(),
  downloadReportRun: jest.fn(),
  requestReportGeneration: jest.fn(),
}));

describe("ReportsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const now = new Date();

    fetchReportSchedules.mockResolvedValue({
      data: [
        {
          _id: "schedule-1",
          name: "Weekly digest",
          frequency: "weekly",
          dayOfWeek: 1,
          runAtUTC: "09:00",
          format: "pdf",
          parameters: { range: { preset: "7d" } },
          recipients: ["team@example.com"],
          active: true,
          nextRunAt: now.toISOString(),
          lastRunAt: now.toISOString(),
        },
      ],
    });

    fetchReportRuns.mockResolvedValue({
      data: [
        {
          _id: "run-1",
          scheduleId: "schedule-1",
          format: "pdf",
          status: "success",
          fileSize: 1048576,
          createdAt: now.toISOString(),
          summary: {
            range: { label: "Jan 01 → Jan 07" },
            quickInsights: ["Active errors outpace resolutions."],
          },
          recommendations: ["Active errors outpace resolutions."],
        },
      ],
      meta: { total: 1 },
    });
  });

  it("loads schedules and runs", async () => {
    render(
      <MemoryRouter initialEntries={["/reports"]}>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: /Weekly digest/i })).toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: /Report history/i })).toBeInTheDocument();

    expect(screen.getByText(/Generate once/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download/i })).toBeInTheDocument();
  });
});
