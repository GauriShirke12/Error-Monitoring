import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AnalyticsPage } from "../AnalyticsPage";
import {
  fetchAnalyticsPatterns,
  fetchErrorTrends,
  fetchRelatedErrors,
  fetchResolutionAnalytics,
  fetchTopErrors,
  fetchUserImpact,
} from "../../services/api";

jest.mock("../../services/api", () => ({
  fetchAnalyticsPatterns: jest.fn(),
  fetchErrorTrends: jest.fn(),
  fetchRelatedErrors: jest.fn(),
  fetchResolutionAnalytics: jest.fn(),
  fetchTopErrors: jest.fn(),
  fetchUserImpact: jest.fn(),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

const trendTemplate = {
  range: {
    key: "7d",
    unit: "day",
    bucketSizeMs: DAY_MS,
    bucketCount: 7,
    start: "2025-01-01T00:00:00.000Z",
    end: "2025-01-08T00:00:00.000Z",
    displayStart: "2025-01-01T00:00:00.000Z",
    displayEnd: "2025-01-07T23:59:59.000Z",
  },
  totals: { occurrences: 12, uniqueUsers: 5 },
  timeSeries: [
    { bucketStart: "2025-01-01T00:00:00.000Z", label: "Jan 1", count: 1, uniqueUsers: 1 },
    { bucketStart: "2025-01-02T00:00:00.000Z", label: "Jan 2", count: 2, uniqueUsers: 1 },
    { bucketStart: "2025-01-03T00:00:00.000Z", label: "Jan 3", count: 6, uniqueUsers: 3 },
  ],
  comparison: {
    timeSeries: [
      { bucketStart: "2024-12-25T00:00:00.000Z", label: "Dec 25", count: 0, uniqueUsers: 0 },
      { bucketStart: "2024-12-26T00:00:00.000Z", label: "Dec 26", count: 2, uniqueUsers: 1 },
      { bucketStart: "2024-12-27T00:00:00.000Z", label: "Dec 27", count: 3, uniqueUsers: 2 },
    ],
    totals: {
      occurrences: 5,
      uniqueUsers: 3,
      deltas: {
        occurrences: { absolute: 7, percentage: 140 },
        uniqueUsers: { absolute: 2, percentage: 66.7 },
      },
    },
  },
  environmentBreakdown: [
    { environment: "production", totalOccurrences: 8, uniqueErrors: 3 },
    { environment: "staging", totalOccurrences: 4, uniqueErrors: 2 },
  ],
  errorTypeBreakdown: [
    { name: "api", occurrences: 5, uniqueUsers: 3 },
    { name: "frontend", occurrences: 3, uniqueUsers: 2 },
  ],
  severityBreakdown: [{ name: "critical", occurrences: 6, uniqueUsers: 3 }],
  clientBreakdown: {
    browsers: [{ name: "Chrome", occurrences: 6, uniqueUsers: 3 }],
    operatingSystems: [{ name: "Windows", occurrences: 5, uniqueUsers: 2 }],
    devices: [{ name: "Desktop", occurrences: 8, uniqueUsers: 4 }],
  },
};

const patternsTemplate = {
  environment: null,
  hotspots: [
    {
      filePath: "src/components/CheckoutButton.jsx",
      occurrenceCount: 12,
      errorCount: 3,
      lastSeen: "2025-01-07T11:55:00.000Z",
      recentOccurrences24h: 9,
      recentOccurrences7d: 12,
      sampleErrors: [
        { errorId: "err-1", message: "Checkout surge during release", timestamp: "2025-01-07T11:54:00.000Z" },
      ],
    },
  ],
  spikes: {
    timeline: [
      { bucketStart: "2025-01-07T09:00:00.000Z", label: "09:00", count: 1, uniqueUsers: 1, baseline: 1, multiplier: null, isSpike: false },
      { bucketStart: "2025-01-07T10:00:00.000Z", label: "10:00", count: 1, uniqueUsers: 1, baseline: 1, multiplier: 1, isSpike: false },
      { bucketStart: "2025-01-07T11:00:00.000Z", label: "11:00", count: 6, uniqueUsers: 4, baseline: 1.5, multiplier: 4, isSpike: true },
    ],
    spikes: [
      {
        bucketStart: "2025-01-07T11:00:00.000Z",
        label: "11:00",
        count: 6,
        uniqueUsers: 4,
        baseline: 1.5,
        multiplier: 4,
        isSpike: true,
        bucketSizeMs: 60 * 60 * 1000,
        contributors: [
          { errorId: "err-1", occurrences: 4, message: "Checkout surge during release", environment: "production" },
        ],
      },
    ],
    parameters: {
      lookbackBuckets: 6,
      thresholdMultiplier: 2,
    },
  },
  deployments: {
    deployments: [
      {
        id: "dep-1",
        label: "Release 104",
        timestamp: "2025-01-07T11:30:00.000Z",
        metadata: { version: "104.0.0" },
        window: {
          beforeStart: "2025-01-07T09:30:00.000Z",
          afterEnd: "2025-01-07T13:30:00.000Z",
        },
        metrics: {
          before: { occurrences: 2, uniqueUsers: 2 },
          after: { occurrences: 5, uniqueUsers: 3 },
          changeAbsolute: 3,
          changePercentage: 150,
          rollbackSuggested: true,
        },
      },
    ],
    parameters: {
      windowBeforeMs: 2 * 60 * 60 * 1000,
      windowAfterMs: 2 * 60 * 60 * 1000,
    },
  },
};

const relatedTemplate = {
  nodes: [
    {
      id: "err-1",
      message: "API request timeout",
      environment: "production",
      status: "open",
      totalOccurrences: 12,
      coOccurrenceGroups: 3,
    },
    {
      id: "err-2",
      message: "UI failed to render",
      environment: "production",
      status: "investigating",
      totalOccurrences: 8,
      coOccurrenceGroups: 3,
    },
  ],
  edges: [
    {
      source: "err-1",
      target: "err-2",
      sharedWindows: 4,
      samples: [
        {
          session: "session-rel-1",
          windowStart: "2025-01-07T11:50:00.000Z",
          errors: [
            { id: "err-1", message: "API request timeout", environment: "production" },
            { id: "err-2", message: "UI failed to render", environment: "production" },
          ],
        },
      ],
    },
  ],
  groups: [
    {
      session: "session-rel-1",
      window: "2025-01-07T11:50:00.000Z",
      errorIds: ["err-1", "err-2"],
    },
  ],
  parameters: { windowMs: 5 * 60 * 1000 },
};

const userImpactTemplate = {
  summary: { totalOccurrences: 9, uniqueUsers: 4, sessions: 5 },
  topErrors: [
    {
      id: "err-1",
      message: "Checkout failed: payment declined",
      environment: "production",
      status: "open",
      totalOccurrences: 5,
      uniqueUsers: 3,
      sessions: 2,
      pageViews: 2,
      impactScore: 11,
      lastSeen: "2025-01-07T11:55:00.000Z",
      journey: {
        topPrevious: [{ value: "/cart", count: 3 }],
        topActions: [{ value: "submit-order", count: 4 }],
        sampleSessions: [
          {
            session: "session-1",
            events: [
              {
                timestamp: "2025-01-07T11:53:00.000Z",
                page: "/checkout",
                previous: "/cart",
                action: "submit-order",
                user: "user-1",
              },
            ],
          },
        ],
      },
    },
  ],
};

const resolutionTemplate = {
  summary: {
    totalTracked: 3,
    resolvedCount: 2,
    unresolvedCount: 1,
    averageResolveMs: 7_200_000,
    averageVerifyMs: 1_800_000,
    reopenedCount: 1,
  },
  byType: [
    {
      type: "api",
      tracked: 1,
      resolved: 1,
      averageResolveMs: 3_600_000,
      averageVerifyMs: 1_800_000,
      reopened: 0,
    },
  ],
  slowestResolved: [
    {
      id: "err-2",
      message: "Payment timeout spike",
      environment: "production",
      status: "resolved",
      resolveMs: 10_800_000,
      firstSeen: "2025-01-05T10:00:00.000Z",
      resolvedAt: "2025-01-05T13:00:00.000Z",
    },
  ],
  unresolvedBacklog: [
    {
      id: "err-3",
      message: "Sync worker crash",
      environment: "staging",
      status: "open",
      ageMs: 86_400_000,
      firstSeen: "2025-01-06T12:00:00.000Z",
    },
  ],
};

const topErrorsTemplate = {
  topByCount: [
    { id: "err-1", message: "Checkout failed: payment declined", count: 12, environment: "production", status: "open" },
  ],
  recentErrors: [
    { id: "err-2", message: "Search results timed out", count: 4, environment: "production", status: "investigating" },
  ],
  criticalErrors: [
    { id: "err-1", message: "Checkout failed: payment declined", count: 12, environment: "production", status: "open" },
  ],
  environmentBreakdown: [
    { environment: "production", totalOccurrences: 12, uniqueErrors: 4 },
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeAll(() => {
  if (!originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: () => "blob:placeholder",
    });
  }
  if (!originalRevokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
  }

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  window.ResizeObserver = ResizeObserverStub;
  window.IntersectionObserver = IntersectionObserverStub;
  window.scrollTo = jest.fn();
});

afterAll(() => {
  if (originalCreateObjectURL) {
    URL.createObjectURL = originalCreateObjectURL;
  } else {
    delete URL.createObjectURL;
  }
  if (originalRevokeObjectURL) {
    URL.revokeObjectURL = originalRevokeObjectURL;
  } else {
    delete URL.revokeObjectURL;
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  fetchErrorTrends.mockResolvedValue({ data: clone(trendTemplate) });
  fetchAnalyticsPatterns.mockResolvedValue({ data: clone(patternsTemplate) });
  fetchRelatedErrors.mockResolvedValue({ data: clone(relatedTemplate) });
  fetchUserImpact.mockResolvedValue({ data: clone(userImpactTemplate) });
  fetchResolutionAnalytics.mockResolvedValue({ data: clone(resolutionTemplate) });
  fetchTopErrors.mockResolvedValue({ data: clone(topErrorsTemplate) });
});

const renderAnalytics = () =>
  render(
    <MemoryRouter initialEntries={["/analytics"]}>
      <AnalyticsPage />
    </MemoryRouter>
  );

test("renders analytics overview and related sections", async () => {
  renderAnalytics();

  expect(await screen.findByRole("heading", { name: /Analytics/i })).toBeInTheDocument();
  await waitFor(() => expect(fetchErrorTrends).toHaveBeenCalledTimes(1));

  expect(await screen.findByText(/Total occurrences/i)).toBeInTheDocument();
  expect(screen.getAllByText(/Checkout failed: payment declined/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/Error hotspots/i)).toBeInTheDocument();
  expect(screen.getByText(/Deployment impact/i)).toBeInTheDocument();
  expect(screen.getByText(/Release 104/i)).toBeInTheDocument();
  expect(screen.getByText(/High-impact user journeys/i)).toBeInTheDocument();
  expect(screen.getByText(/Related error clusters/i)).toBeInTheDocument();
});

test("exports trends to CSV and applies environment filters", async () => {
  renderAnalytics();
  await screen.findByText(/Total occurrences/i);

  const createObjectURLSpy = jest.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-analytics");
  const revokeSpy = jest.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const realCreateElement = document.createElement.bind(document);
  const link = realCreateElement("a");
  const clickSpy = jest.spyOn(link, "click").mockImplementation(() => {});
  const appendSpy = jest.spyOn(document.body, "appendChild").mockImplementation(() => {});
  const removeSpy = jest.spyOn(document.body, "removeChild").mockImplementation(() => {});
  const createElementSpy = jest.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    if (tagName === "a") {
      return link;
    }
    return realCreateElement(tagName, options);
  });

  const exportButton = screen.getByRole("button", { name: /Export CSV/i });
  fireEvent.click(exportButton);

  await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalled());
  expect(clickSpy).toHaveBeenCalled();

  const blobArg = createObjectURLSpy.mock.calls[0][0];
  expect(blobArg instanceof Blob).toBe(true);
  const blobText = await new Response(blobArg).text();
  expect(blobText).toContain("bucketStart");
  expect(blobText).toContain("occurrences");

  const environmentSelect = screen.getByRole("combobox", { name: /environment filter/i });
  fireEvent.change(environmentSelect, { target: { value: "production" } });

  await waitFor(() => expect(fetchErrorTrends).toHaveBeenCalledTimes(2));
  const lastParams = fetchErrorTrends.mock.calls[fetchErrorTrends.mock.calls.length - 1][0];
  expect(lastParams.environment).toBe("production");

  createObjectURLSpy.mockRestore();
  revokeSpy.mockRestore();
  createElementSpy.mockRestore();
  clickSpy.mockRestore();
  appendSpy.mockRestore();
  removeSpy.mockRestore();
});
