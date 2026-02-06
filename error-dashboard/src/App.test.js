import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

jest.mock("prism-react-renderer/themes/nightOwl", () => ({}), { virtual: true });

jest.mock("./services/api", () => ({
  fetchOverviewSummary: jest.fn(async () => ({
    data: {
      totals: {
        totalErrors: { current: 12, previous: 10 },
        newErrors24h: { current: 4, previous: 6 },
        activeErrors24h: { current: 8, previous: 9 },
        resolvedErrors24h: { current: 3, previous: 2 },
      },
      environmentBreakdown: [],
      clientBreakdown: { browsers: [], operatingSystems: [], devices: [] },
      statusBreakdown: [],
    },
  })),
  fetchErrorTrends: jest.fn(async () => ({
    data: {
      timeSeries: [
        { bucketStart: "2024-01-01T00:00:00.000Z", label: "Jan 1", count: 5, uniqueUsers: 2 },
        { bucketStart: "2024-01-02T00:00:00.000Z", label: "Jan 2", count: 3, uniqueUsers: 1 },
      ],
      totals: {
        occurrences: 8,
        uniqueUsers: 3,
      },
      environmentBreakdown: [],
    },
  })),
  fetchTopErrors: jest.fn(async () => ({
    data: {
      topByCount: [],
      recentErrors: [],
    },
  })),
}));

test("renders overview heading on dashboard route", async () => {
  render(
    <MemoryRouter initialEntries={["/overview"]}>
      <App />
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { name: /overview/i })).toBeInTheDocument();
});

test("renders landing hero on root route", () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>
  );

  expect(screen.getByRole("heading", { name: /see issues the instant/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /get started for free/i })).toBeInTheDocument();
});
