import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../../components/toast/ToastContainer";
import { TeamPerformancePage } from "../TeamPerformancePage";
import {
  fetchTeamPerformance,
  fetchTeamMembers,
  createTeamMember,
  deleteTeamMember,
} from "../../services/api";

jest.mock("../../services/api", () => ({
  fetchTeamPerformance: jest.fn(),
  fetchTeamMembers: jest.fn(),
  createTeamMember: jest.fn(),
  deleteTeamMember: jest.fn(),
}));

describe("TeamPerformancePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchTeamPerformance.mockResolvedValue({
      data: {
        totals: {
          resolved: 18,
          teamSize: 3,
          activeAssignments: 5,
          unassignedActive: 1,
          avgResolutionMs: 5400000,
        },
        timeline: [
          { date: "2025-01-01", resolvedCount: 6 },
          { date: "2025-01-02", resolvedCount: 4 },
        ],
        leaderboard: [
          {
            member: {
              id: "member-1",
              name: "Taylor Swift",
              email: "taylor@example.com",
              avatarColor: "#38bdf8",
            },
            resolvedCount: 9,
            avgResolutionMs: 3600000,
            openAssignments: 2,
            assignmentsTouched: 6,
          },
        ],
        backlogPreview: [
          {
            id: "error-1",
            message: "Checkout session expired for EU customers",
            count: 4,
            lastSeen: new Date().toISOString(),
          },
        ],
      },
    });

    fetchTeamMembers.mockResolvedValue({
      data: [
        {
          id: "member-1",
          name: "Taylor Swift",
          email: "taylor@example.com",
          role: "On-call",
          avatarColor: "#38bdf8",
        },
        {
          id: "member-2",
          name: "Jordan Lee",
          email: "jordan@example.com",
          role: "SRE",
          avatarColor: "#f97316",
        },
      ],
    });

    createTeamMember.mockResolvedValue({ data: null });
    deleteTeamMember.mockResolvedValue({ data: null });
  });

  it("renders team metrics and roster data from the API", async () => {
    render(
      <MemoryRouter initialEntries={["/team"]}>
        <ToastProvider>
          <TeamPerformancePage />
        </ToastProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Team Performance/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Team size: 3/i)).toBeInTheDocument();
    });

    const leaderboardSection = screen.getByRole("heading", { name: /Leaderboard/i }).closest("section");
    expect(leaderboardSection).not.toBeNull();
    expect(within(leaderboardSection).getByText("Taylor Swift")).toBeInTheDocument();
    expect(screen.getByText(/Checkout session expired/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add team member/i })).toBeInTheDocument();
  });
});
