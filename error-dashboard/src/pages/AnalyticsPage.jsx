import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { differenceInCalendarDays, format } from "date-fns";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DateRangeSelector } from "../components/filters/DateRangeSelector";
import { PageLoader } from "../components/feedback/PageLoader";
import { MainLayout } from "../components/layout/MainLayout";
import {
  fetchAnalyticsPatterns,
  fetchErrorTrends,
  fetchTopErrors,
  fetchRelatedErrors,
  fetchUserImpact,
  fetchResolutionAnalytics,
} from "../services/api";

const numberFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const RANGE_LABELS = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const DEFAULT_ENVIRONMENT_OPTIONS = [
  { value: "all", label: "All environments" },
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "development", label: "Development" },
];

const ENVIRONMENT_COLORS = ["#38bdf8", "#f97316", "#a855f7", "#22c55e", "#facc15", "#f87171"];

const CHART_COLORS = {
  occurrences: "#38bdf8",
  uniqueUsers: "#a855f7",
  comparisonCount: "#94a3b8",
  comparisonUsers: "#64748b",
  anomaly: "#f97316",
};

const BREAKDOWN_COLORS = {
  errorType: "#a855f7",
  severity: "#f97316",
  users: "#22c55e",
  browsers: "#38bdf8",
  operatingSystems: "#facc15",
  devices: "#f87171",
};

const SAMPLE_TREND_PAYLOAD = {
  range: {
    key: "7d",
    displayStart: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    displayEnd: new Date().toISOString(),
  },
  timeSeries: [
    { bucketStart: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(), label: "Mon", count: 180, uniqueUsers: 64 },
    { bucketStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), label: "Tue", count: 210, uniqueUsers: 72 },
    { bucketStart: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), label: "Wed", count: 165, uniqueUsers: 55 },
    { bucketStart: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), label: "Thu", count: 195, uniqueUsers: 61 },
    { bucketStart: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), label: "Fri", count: 230, uniqueUsers: 78 },
    { bucketStart: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), label: "Sat", count: 150, uniqueUsers: 49 },
    { bucketStart: new Date().toISOString(), label: "Sun", count: 120, uniqueUsers: 41 },
  ],
  comparison: {
    timeSeries: [
      { label: "Mon", count: 150, uniqueUsers: 58 },
      { label: "Tue", count: 175, uniqueUsers: 63 },
      { label: "Wed", count: 140, uniqueUsers: 52 },
      { label: "Thu", count: 160, uniqueUsers: 55 },
      { label: "Fri", count: 190, uniqueUsers: 69 },
      { label: "Sat", count: 130, uniqueUsers: 45 },
      { label: "Sun", count: 110, uniqueUsers: 38 },
    ],
  },
  environmentBreakdown: [
    { environment: "production", occurrences: 760, uniqueUsers: 320 },
    { environment: "staging", occurrences: 190, uniqueUsers: 82 },
    { environment: "development", occurrences: 85, uniqueUsers: 41 },
  ],
  severityBreakdown: [
    { severity: "critical", occurrences: 120 },
    { severity: "error", occurrences: 320 },
    { severity: "warning", occurrences: 180 },
    { severity: "info", occurrences: 90 },
  ],
};

const SAMPLE_TOP_ERRORS = [
  { id: "ae-1", message: "TypeError: Cannot read property 'id' of undefined", count: 245, environment: "production", status: "open" },
  { id: "ae-2", message: "FetchError: Network request failed", count: 131, environment: "production", status: "ignored" },
  { id: "ae-3", message: "DatabaseError: Connection pool exhausted", count: 77, environment: "production", status: "open" },
  { id: "ae-4", message: "ReferenceError: window is not defined", count: 92, environment: "staging", status: "open" },
];

const SAMPLE_PATTERN_PAYLOAD = {
  hotspots: [
    {
      filePath: "src/components/Header.jsx",
      lastSeen: new Date().toISOString(),
      occurrenceCount: 180,
      errorCount: 6,
      recentOccurrences24h: 48,
      recentOccurrences7d: 180,
      sampleErrors: [
        { errorId: "ae-1", message: "TypeError: Cannot read property 'id' of undefined" },
        { errorId: "ae-2", message: "FetchError: Network request failed" },
      ],
    },
  ],
  spikes: {
    spikes: [
      {
        bucketStart: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        count: 72,
        multiplier: 1.8,
        contributors: [
          { errorId: "ae-3", message: "DatabaseError: Connection pool exhausted" },
          { errorId: "ae-1", message: "TypeError: Cannot read property 'id' of undefined" },
        ],
      },
    ],
    timeline: [
      { bucketStart: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), count: 30, baseline: 32, isSpike: false },
      { bucketStart: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), count: 28, baseline: 30, isSpike: false },
      { bucketStart: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), count: 35, baseline: 31, isSpike: false },
      { bucketStart: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), count: 72, baseline: 38, isSpike: true },
      { bucketStart: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), count: 40, baseline: 35, isSpike: false },
      { bucketStart: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), count: 33, baseline: 34, isSpike: false },
    ],
  },
  deployments: {
    parameters: { windowMs: 2 * 60 * 60 * 1000 },
    deployments: [
      {
        id: "dep-sample-1",
        label: "Release v1.8.2",
        timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        metrics: {
          changePercentage: -12,
          rollbackSuggested: false,
          before: { occurrences: 180 },
          after: { occurrences: 158 },
        },
      },
    ],
  },
};

const SAMPLE_RELATED_PAYLOAD = {
  parameters: { windowMs: 15 * 60 * 1000 },
  nodes: [
    { id: "ae-1", message: "TypeError: Cannot read property 'id' of undefined" },
    { id: "ae-2", message: "FetchError: Network request failed" },
    { id: "ae-3", message: "DatabaseError: Connection pool exhausted" },
  ],
  edges: [
    { source: "ae-1", target: "ae-2", sharedWindows: 4, samples: [{ sessionId: "sess-1" }] },
    { source: "ae-2", target: "ae-3", sharedWindows: 2, samples: [{ sessionId: "sess-2" }] },
  ],
  groups: [
    { session: "sess-1", window: "15m", errorIds: ["ae-1", "ae-2"] },
    { session: "sess-2", window: "15m", errorIds: ["ae-2", "ae-3"] },
  ],
};

const SAMPLE_USER_IMPACT = {
  summary: { totalOccurrences: 840, uniqueUsers: 320, sessions: 480 },
  topErrors: [
    { id: "ae-1", message: "TypeError: Cannot read property 'id' of undefined", occurrences: 180, users: 120 },
    { id: "ae-2", message: "FetchError: Network request failed", occurrences: 130, users: 95 },
    { id: "ae-3", message: "DatabaseError: Connection pool exhausted", occurrences: 90, users: 64 },
    { id: "ae-4", message: "ReferenceError: window is not defined", occurrences: 75, users: 58 },
  ],
};

const SAMPLE_RESOLUTION = {
  summary: {
    totalTracked: 24,
    resolvedCount: 18,
    unresolvedCount: 6,
    averageResolveMs: 1000 * 60 * 60 * 6,
    averageVerifyMs: 1000 * 60 * 60 * 2,
    reopenedCount: 2,
  },
  byType: [
    { type: "frontend", occurrences: 220, averageResolveMs: 1000 * 60 * 60 * 4, averageVerifyMs: 1000 * 60 * 60 },
    { type: "backend", occurrences: 180, averageResolveMs: 1000 * 60 * 60 * 6, averageVerifyMs: 1000 * 60 * 60 * 2 },
  ],
  slowestResolved: [
    { id: "ae-2", message: "FetchError: Network request failed", resolveMs: 1000 * 60 * 60 * 12, resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    { id: "ae-3", message: "DatabaseError: Connection pool exhausted", resolveMs: 1000 * 60 * 60 * 9, resolvedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() },
  ],
  unresolvedBacklog: [
    { id: "ae-4", message: "ReferenceError: window is not defined", ageMs: 1000 * 60 * 60 * 24 * 4, firstSeen: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() },
    { id: "ae-5", message: "AuthError: Invalid JWT signature", ageMs: 1000 * 60 * 60 * 24 * 2, firstSeen: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
  ],
};

const toRangeStartIso = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
};

const toRangeEndExclusiveIso = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
};

const safeFormatDate = (value, pattern = "MMM d, yyyy") => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return format(date, pattern);
};

const computeAnomalies = (series) => {
  if (!Array.isArray(series) || series.length < 4) {
    return [];
  }
  const counts = series.map((point) => point.count ?? 0);
  if (!counts.some((value) => value > 0)) {
    return [];
  }
  const mean = counts.reduce((total, value) => total + value, 0) / counts.length;
  const variance = counts.reduce((total, value) => total + (value - mean) ** 2, 0) / counts.length;
  const stdDeviation = Math.sqrt(variance);
  if (stdDeviation === 0) {
    return [];
  }
  const threshold = mean + 2 * stdDeviation;
  return series
    .map((point, index) => (point.count >= threshold ? { ...point, index, threshold } : null))
    .filter(Boolean);
};

const buildComparisonSummary = (previous, delta) => {
  if (previous === null || previous === undefined) {
    return null;
  }

  const previousLabel = numberFormatter.format(previous);

  if (!delta) {
    return `Prev: ${previousLabel}`;
  }

  if (delta.absolute === 0) {
    return `Prev: ${previousLabel} • No change`;
  }

  const absoluteLabel = `${delta.absolute > 0 ? "+" : "−"}${numberFormatter.format(Math.abs(delta.absolute))}`;

  if (delta.percentage === null) {
    return `Prev: ${previousLabel} • Δ ${absoluteLabel} (no baseline)`;
  }

  const percentLabel = `${delta.percentage > 0 ? "+" : "−"}${percentFormatter.format(Math.abs(delta.percentage))}%`;
  return `Prev: ${previousLabel} • Δ ${absoluteLabel} (${percentLabel})`;
};

const buildCsvContent = (payload) => {
  if (!payload?.timeSeries?.length) {
    return null;
  }

  const includeComparison = Boolean(payload?.comparison?.timeSeries?.length);
  const header = includeComparison
    ? ["bucketStart", "label", "occurrences", "uniqueUsers", "previousOccurrences", "previousUniqueUsers"]
    : ["bucketStart", "label", "occurrences", "uniqueUsers"];

  const rows = [header];
  payload.timeSeries.forEach((entry, index) => {
    const baseRow = [entry.bucketStart, entry.label, entry.count ?? 0, entry.uniqueUsers ?? 0];
    if (includeComparison) {
      const comparisonEntry = payload.comparison.timeSeries[index] ?? {};
      baseRow.push(comparisonEntry.count ?? "", comparisonEntry.uniqueUsers ?? "");
    }
    rows.push(baseRow);
  });

  return rows
    .map((row) =>
      row
        .map((cell) => {
          const normalized = cell ?? "";
          const stringified = typeof normalized === "number" ? normalized : String(normalized);
          const escaped = String(stringified).replace(/"/g, '""');
          return `"${escaped}"`;
        })
        .join(",")
    )
    .join("\n");
};

const formatDuration = (milliseconds) => {
  if (milliseconds === null || milliseconds === undefined) {
    return "—";
  }
  const ms = Math.max(0, Number(milliseconds));
  if (!Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 60 * 1000) {
    return "<1m";
  }
  const totalMinutes = Math.floor(ms / (60 * 1000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) {
    parts.push(`${days}d`);
  }
  if (hours) {
    parts.push(`${hours}h`);
  }
  if (!days && minutes) {
    parts.push(`${minutes}m`);
  }
  if (!parts.length) {
    return "<1m";
  }
  return parts.slice(0, 2).join(" ");
};

export function AnalyticsPage() {
  const navigate = useNavigate();
  const [selectedRange, setSelectedRange] = useState("7d");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [selectedEnvironment, setSelectedEnvironment] = useState("all");
  const [compareMode, setCompareMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trendPayload, setTrendPayload] = useState(null);
  const [topErrors, setTopErrors] = useState([]);
  const [patternPayload, setPatternPayload] = useState(null);
  const [patternsLoading, setPatternsLoading] = useState(true);
  const [patternsError, setPatternsError] = useState(null);
  const [relatedPayload, setRelatedPayload] = useState(null);
  const [relatedLoading, setRelatedLoading] = useState(true);
  const [relatedError, setRelatedError] = useState(null);
  const [userImpactPayload, setUserImpactPayload] = useState(null);
  const [userImpactLoading, setUserImpactLoading] = useState(true);
  const [userImpactError, setUserImpactError] = useState(null);
  const [resolutionPayload, setResolutionPayload] = useState(null);
  const [resolutionLoading, setResolutionLoading] = useState(true);
  const [resolutionError, setResolutionError] = useState(null);

  const customRangeError = useMemo(() => {
    if (selectedRange !== "custom") {
      return null;
    }
    if (!customRange.start || !customRange.end) {
      return "Select start and end dates.";
    }
    const start = new Date(`${customRange.start}T00:00:00.000Z`);
    const end = new Date(`${customRange.end}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return "Select valid dates.";
    }
    if (end < start) {
      return "End date must be after start date.";
    }
    const span = differenceInCalendarDays(end, start) + 1;
    if (span < 1) {
      return "Range must span at least 1 day.";
    }
    if (span > 90) {
      return "Range cannot exceed 90 days.";
    }
    return null;
  }, [selectedRange, customRange.start, customRange.end]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const canFetch = selectedRange !== "custom" || !customRangeError;

    if (!canFetch) {
      setLoading(false);
      setError(null);
      if (selectedRange === "custom") {
        setTrendPayload(null);
      }
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const load = async () => {
      setLoading(true);
      setError(null);

      const params = {
        range: selectedRange,
        compare: compareMode ? "true" : "false",
      };

      if (selectedEnvironment !== "all") {
        params.environment = selectedEnvironment;
      }

      if (selectedRange === "custom") {
        const startIso = toRangeStartIso(customRange.start);
        const endIso = toRangeEndExclusiveIso(customRange.end);
        if (!startIso || !endIso) {
          setError(new Error("Unable to parse selected dates."));
          setTrendPayload(null);
          setLoading(false);
          return;
        }
        params.startDate = startIso;
        params.endDate = endIso;
      }

      try {
        const response = await fetchErrorTrends(params, { signal: controller.signal });
        if (cancelled) {
          return;
        }
        setTrendPayload(response?.data ?? null);
      } catch (fetchError) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setTrendPayload(SAMPLE_TREND_PAYLOAD);
        setError(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedRange, customRange.start, customRange.end, selectedEnvironment, compareMode, customRangeError]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const params = selectedEnvironment !== "all" ? { environment: selectedEnvironment } : {};

    fetchTopErrors(params, { signal: controller.signal })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setTopErrors(response?.data?.topByCount ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setTopErrors(SAMPLE_TOP_ERRORS);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedEnvironment]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setPatternsLoading(true);
    setPatternsError(null);

    const params = selectedEnvironment !== "all" ? { environment: selectedEnvironment } : {};

    fetchAnalyticsPatterns(params, { signal: controller.signal })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPatternPayload(response?.data ?? null);
      })
      .catch((fetchError) => {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setPatternPayload(SAMPLE_PATTERN_PAYLOAD);
        setPatternsError(null);
      })
      .finally(() => {
        if (!cancelled) {
          setPatternsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedEnvironment]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setRelatedLoading(true);
    setRelatedError(null);

    const params = selectedEnvironment !== "all" ? { environment: selectedEnvironment } : {};

    fetchRelatedErrors(params, { signal: controller.signal })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setRelatedPayload(response?.data ?? null);
      })
      .catch((fetchError) => {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setRelatedPayload(SAMPLE_RELATED_PAYLOAD);
        setRelatedError(null);
      })
      .finally(() => {
        if (!cancelled) {
          setRelatedLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedEnvironment]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setUserImpactLoading(true);
    setUserImpactError(null);

    const params = selectedEnvironment !== "all" ? { environment: selectedEnvironment } : {};

    fetchUserImpact(params, { signal: controller.signal })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setUserImpactPayload(response?.data ?? null);
      })
      .catch((fetchError) => {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setUserImpactPayload(SAMPLE_USER_IMPACT);
        setUserImpactError(null);
      })
      .finally(() => {
        if (!cancelled) {
          setUserImpactLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedEnvironment]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setResolutionLoading(true);
    setResolutionError(null);

    const params = selectedEnvironment !== "all" ? { environment: selectedEnvironment } : {};

    fetchResolutionAnalytics(params, { signal: controller.signal })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setResolutionPayload(response?.data ?? null);
      })
      .catch((fetchError) => {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setResolutionPayload(SAMPLE_RESOLUTION);
        setResolutionError(null);
      })
      .finally(() => {
        if (!cancelled) {
          setResolutionLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedEnvironment]);

  const rangeLabel = useMemo(() => {
    if (trendPayload?.range?.key && RANGE_LABELS[trendPayload.range.key]) {
      return RANGE_LABELS[trendPayload.range.key];
    }
    if (trendPayload?.range?.key === "custom") {
      return `Custom • ${safeFormatDate(trendPayload.range.displayStart)} – ${safeFormatDate(trendPayload.range.displayEnd)}`;
    }
    return RANGE_LABELS[selectedRange] ?? "Analytics window";
  }, [trendPayload, selectedRange]);

  const environmentData = useMemo(() => trendPayload?.environmentBreakdown ?? [], [trendPayload]);

  const environmentSlices = useMemo(() => {
    if (!environmentData.length) {
      return [];
    }
    const total = environmentData.reduce((sum, entry) => sum + (entry.occurrences ?? 0), 0);
    return environmentData.map((entry, index) => {
      const occurrences = entry.occurrences ?? 0;
      const uniqueUsers = entry.uniqueUsers ?? 0;
      const normalizedValue = typeof entry.environment === "string" ? entry.environment.toLowerCase() : "unknown";
      return {
        ...entry,
        occurrences,
        uniqueUsers,
        value: normalizedValue,
        percentage: total > 0 ? (occurrences / total) * 100 : 0,
        color: ENVIRONMENT_COLORS[index % ENVIRONMENT_COLORS.length],
      };
    });
  }, [environmentData]);

  const environmentOptions = useMemo(() => {
    const base = [...DEFAULT_ENVIRONMENT_OPTIONS];
    environmentSlices.forEach((slice) => {
      if (!slice?.value || slice.value === "all") {
        return;
      }
      if (!base.some((option) => option.value === slice.value)) {
        base.push({ value: slice.value, label: slice.environment });
      }
    });
    return base;
  }, [environmentSlices]);

  useEffect(() => {
    if (selectedEnvironment !== "all" && !environmentOptions.some((option) => option.value === selectedEnvironment)) {
      setSelectedEnvironment("all");
    }
  }, [environmentOptions, selectedEnvironment]);

  const environmentLabel = useMemo(() => {
    const option = environmentOptions.find((item) => item.value === selectedEnvironment);
    return option?.label ?? "All environments";
  }, [environmentOptions, selectedEnvironment]);

  const hotspots = useMemo(() => patternPayload?.hotspots ?? [], [patternPayload]);
  const spikeTimeline = useMemo(() => patternPayload?.spikes?.timeline ?? [], [patternPayload]);
  const spikeHighlights = useMemo(() => patternPayload?.spikes?.spikes ?? [], [patternPayload]);
  const deployments = useMemo(() => patternPayload?.deployments?.deployments ?? [], [patternPayload]);
  const deploymentWindow = patternPayload?.deployments?.parameters ?? null;

  const handleHotspotNavigate = useCallback(
    (filePath) => {
      if (!filePath) {
        return;
      }
      const normalized = filePath.trim();
      if (!normalized || normalized.toLowerCase() === "unknown") {
        return;
      }
      const params = new URLSearchParams();
      params.set("sourceFile", normalized);
      if (selectedEnvironment !== "all") {
        params.set("environment", selectedEnvironment);
      }
      navigate({ pathname: "/errors", search: `?${params.toString()}` });
    },
    [navigate, selectedEnvironment]
  );

  const handleSpikeContributorNavigate = useCallback(
    (errorId) => {
      if (!errorId) {
        return;
      }
      navigate(`/errors/${errorId}`);
    },
    [navigate]
  );

  const handleEnvironmentSliceClick = useCallback(
    (_, index) => {
      const slice = environmentSlices[index];
      if (!slice) {
        return;
      }
      setSelectedEnvironment((current) => (current === slice.value ? "all" : slice.value));
    },
    [environmentSlices]
  );

  const handleEnvironmentLegendClick = useCallback((value) => {
    if (!value) {
      return;
    }
    setSelectedEnvironment((current) => (current === value ? "all" : value));
  }, []);

  const renderEnvironmentTooltip = useCallback(({ active, payload }) => {
    if (!active || !payload?.length) {
      return null;
    }
    const datum = payload[0]?.payload;
    if (!datum) {
      return null;
    }
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/95 px-3 py-2 text-xs text-slate-200 shadow-lg shadow-black/30">
        <p className="font-semibold text-white">{datum.environment}</p>
        <p className="mt-1 text-slate-300">{numberFormatter.format(datum.occurrences)} occurrences</p>
        <p className="text-slate-400">{numberFormatter.format(datum.uniqueUsers)} unique users</p>
        <p className="text-slate-500">{percentFormatter.format(datum.percentage)}% share</p>
      </div>
    );
  }, []);

  const renderBreakdownTooltip = useCallback(({ active, payload }) => {
    if (!active || !payload?.length) {
      return null;
    }
    const datum = payload[0]?.payload;
    if (!datum) {
      return null;
    }
    const title = datum.name || datum.environment || datum.label || "—";
    const occurrences = datum.occurrences ?? payload[0]?.value ?? 0;
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/95 px-3 py-2 text-xs text-slate-200 shadow-lg shadow-black/30">
        <p className="font-semibold text-white">{title}</p>
        <p className="mt-1 text-slate-300">{numberFormatter.format(occurrences)} occurrences</p>
        {typeof datum.uniqueUsers === "number" ? (
          <p className="text-slate-400">{numberFormatter.format(datum.uniqueUsers)} unique users</p>
        ) : null}
      </div>
    );
  }, []);

  const renderUserImpactTooltip = useCallback(({ active, payload }) => {
    if (!active || !payload?.length) {
      return null;
    }
    const datum = payload[0]?.payload;
    if (!datum) {
      return null;
    }
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/95 px-3 py-2 text-xs text-slate-200 shadow-lg shadow-black/30">
        <p className="font-semibold text-white">{datum.environment}</p>
        <p className="mt-1 text-slate-300">{numberFormatter.format(datum.uniqueUsers)} unique users</p>
        <p className="text-slate-400">{numberFormatter.format(datum.occurrences)} occurrences</p>
      </div>
    );
  }, []);

  const chartData = useMemo(() => {
    const primary = trendPayload?.timeSeries ?? [];
    const comparison = trendPayload?.comparison?.timeSeries ?? [];
    if (!primary.length) {
      return [];
    }
    return primary.map((entry, index) => ({
      ...entry,
      previousCount: comparison[index]?.count ?? null,
      previousUniqueUsers: comparison[index]?.uniqueUsers ?? null,
    }));
  }, [trendPayload]);

  const anomalies = useMemo(() => computeAnomalies(trendPayload?.timeSeries ?? []), [trendPayload]);
  const anomalyThreshold = anomalies.length ? anomalies[0].threshold : null;

  const summaryCards = useMemo(() => {
    if (!trendPayload) {
      return [];
    }
    const totals = trendPayload.totals ?? {};
    const comparisonTotals = trendPayload.comparison?.totals;
    return [
      {
        key: "occurrences",
        label: "Total occurrences",
        value: totals.occurrences ?? 0,
        previous: comparisonTotals?.occurrences ?? null,
        delta: comparisonTotals?.deltas?.occurrences ?? null,
      },
      {
        key: "uniqueUsers",
        label: "Unique users",
        value: totals.uniqueUsers ?? 0,
        previous: comparisonTotals?.uniqueUsers ?? null,
        delta: comparisonTotals?.deltas?.uniqueUsers ?? null,
      },
    ];
  }, [trendPayload]);

  const canExport = chartData.length > 0;

  const errorTypeData = useMemo(() => (trendPayload?.errorTypeBreakdown ?? []).slice(0, 8), [trendPayload]);
  const severityData = useMemo(() => (trendPayload?.severityBreakdown ?? []).slice(0, 8), [trendPayload]);
  const clientBreakdown = useMemo(
    () => trendPayload?.clientBreakdown ?? { browsers: [], operatingSystems: [], devices: [] },
    [trendPayload]
  );
  const topBrowsers = useMemo(() => (clientBreakdown.browsers ?? []).slice(0, 8), [clientBreakdown]);
  const topOperatingSystems = useMemo(() => (clientBreakdown.operatingSystems ?? []).slice(0, 8), [clientBreakdown]);
  const topDevices = useMemo(() => (clientBreakdown.devices ?? []).slice(0, 8), [clientBreakdown]);
  const hasClientBreakdown = useMemo(
    () => Boolean((topBrowsers?.length ?? 0) || (topOperatingSystems?.length ?? 0) || (topDevices?.length ?? 0)),
    [topBrowsers, topOperatingSystems, topDevices]
  );
  const userImpactData = useMemo(
    () =>
      environmentSlices.map((slice) => ({
        environment: slice.environment,
        uniqueUsers: slice.uniqueUsers ?? 0,
        occurrences: slice.occurrences ?? 0,
        color: slice.color,
      })),
    [environmentSlices]
  );

  const relatedSummary = useMemo(() => ({
    nodes: relatedPayload?.nodes?.length ?? 0,
    edges: relatedPayload?.edges?.length ?? 0,
    windowMs: relatedPayload?.parameters?.windowMs ?? null,
  }), [relatedPayload]);

  const correlationWindowLabel = useMemo(() => {
    if (!relatedSummary.windowMs) {
      return null;
    }
    const minutes = Math.round(relatedSummary.windowMs / (60 * 1000));
    if (minutes >= 60) {
      const hours = relatedSummary.windowMs / (60 * 60 * 1000);
      const label = Number.isInteger(hours) ? hours.toString() : hours.toFixed(1);
      return `${label}h window`;
    }
    return `${minutes}m window`;
  }, [relatedSummary]);

  const relatedEdges = useMemo(() => {
    if (!relatedPayload?.edges?.length) {
      return [];
    }
    const nodeMap = new Map((relatedPayload.nodes ?? []).map((node) => [node.id, node]));
    return relatedPayload.edges.slice(0, 10).map((edge) => {
      const source = nodeMap.get(edge.source) ?? { message: "Unknown error" };
      const target = nodeMap.get(edge.target) ?? { message: "Unknown error" };
      const sample = edge.samples?.[0];
      return {
        id: `${edge.source}-${edge.target}`,
        source,
        target,
        sharedWindows: edge.sharedWindows ?? 0,
        sample,
      };
    });
  }, [relatedPayload]);

  const relatedGroups = useMemo(() => {
    if (!relatedPayload?.groups?.length) {
      return [];
    }
    const nodeMap = new Map((relatedPayload.nodes ?? []).map((node) => [node.id, node]));
    return relatedPayload.groups.slice(0, 5).map((group, index) => ({
      key: `${group.session || "unknown"}-${index}`,
      session: group.session || "unknown",
      window: group.window || null,
      errors: (group.errorIds || []).map((id) => nodeMap.get(id) ?? { id, message: "Unknown error" }),
    }));
  }, [relatedPayload]);

  const userImpactSummary = useMemo(() => ({
    totalOccurrences: userImpactPayload?.summary?.totalOccurrences ?? 0,
    uniqueUsers: userImpactPayload?.summary?.uniqueUsers ?? 0,
    sessions: userImpactPayload?.summary?.sessions ?? 0,
  }), [userImpactPayload]);

  const highImpactErrors = useMemo(() => (userImpactPayload?.topErrors ?? []).slice(0, 4), [userImpactPayload]);

  const resolutionSummary = useMemo(() => ({
    totalTracked: resolutionPayload?.summary?.totalTracked ?? 0,
    resolvedCount: resolutionPayload?.summary?.resolvedCount ?? 0,
    unresolvedCount: resolutionPayload?.summary?.unresolvedCount ?? 0,
    averageResolveMs: resolutionPayload?.summary?.averageResolveMs ?? null,
    averageVerifyMs: resolutionPayload?.summary?.averageVerifyMs ?? null,
    reopenedCount: resolutionPayload?.summary?.reopenedCount ?? 0,
  }), [resolutionPayload]);

  const resolutionByType = useMemo(() => (resolutionPayload?.byType ?? []).slice(0, 6), [resolutionPayload]);
  const slowestResolved = useMemo(() => resolutionPayload?.slowestResolved ?? [], [resolutionPayload]);
  const unresolvedBacklog = useMemo(() => resolutionPayload?.unresolvedBacklog ?? [], [resolutionPayload]);

  const resolutionCompletionRate = useMemo(() => {
    if (!resolutionSummary.totalTracked) {
      return null;
    }
    return (resolutionSummary.resolvedCount / resolutionSummary.totalTracked) * 100;
  }, [resolutionSummary]);

  const metaEntries = useMemo(() => {
    const entries = [];
    if (rangeLabel) {
      entries.push({ label: rangeLabel });
    }
    if (environmentLabel) {
      entries.push({ label: environmentLabel });
    }
    if (trendPayload?.range) {
      entries.push({
        label: `Window ${safeFormatDate(trendPayload.range.displayStart)} – ${safeFormatDate(trendPayload.range.displayEnd)}`,
      });
    }
    entries.push({ label: compareMode ? "Comparison enabled" : "Comparison off", accent: compareMode });
    return entries;
  }, [rangeLabel, environmentLabel, trendPayload, compareMode]);

  const handleExport = useCallback(() => {
    const csvContent = buildCsvContent(trendPayload);
    if (!csvContent) {
      return;
    }
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const filename = `analytics-${selectedEnvironment}-${selectedRange}-${Date.now()}.csv`;
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [trendPayload, selectedEnvironment, selectedRange]);

  const filters = (
    <div className="flex flex-wrap items-center gap-4">
      <DateRangeSelector
        value={selectedRange}
        onChange={setSelectedRange}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
        error={customRangeError}
      />
      <select
        aria-label="Environment filter"
        value={selectedEnvironment}
        onChange={(event) => setSelectedEnvironment(event.target.value)}
        className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
      >
        {environmentOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label className="inline-flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={compareMode}
          onChange={(event) => setCompareMode(event.target.checked)}
          className="h-4 w-4 rounded border border-slate-700 bg-canvas-subtle text-accent focus:ring-accent"
        />
        Compare previous period
      </label>
      <button
        type="button"
        onClick={handleExport}
        disabled={!canExport}
        className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Export CSV
      </button>
    </div>
  );

  if (loading && !trendPayload) {
    return <PageLoader label="Preparing analytics workspace..." />;
  }

  return (
    <MainLayout
      title="Analytics"
      description="Dive deeper into trends, releases, and user impact across your error data."
      breadcrumbs={[
        { label: "Dashboard", href: "/overview", current: false },
        { label: "Analytics", href: "/analytics", current: true },
      ]}
      filters={filters}
    >
      {error ? (
        <div className="relative mb-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-100">
          <button
            type="button"
            onClick={() => setError(null)}
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-rose-100/80 transition hover:bg-white/10 hover:text-white"
            aria-label="Dismiss error"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <h3 className="text-base font-semibold text-white">Unable to load analytics</h3>
          <p className="mt-2 text-rose-200/90">{error.message || "An unexpected error occurred while fetching analytics."}</p>
        </div>
      ) : null}

      {selectedRange === "custom" && customRangeError ? (
        <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p>{customRangeError}</p>
        </div>
      ) : null}

      {!trendPayload && !loading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
          Select a valid range to load analytics insights.
        </div>
      ) : null}

      {trendPayload ? (
        <Fragment>
          <section className="mb-6 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {metaEntries.map((entry, index) => (
              <Fragment key={`${entry.label}-${index}`}>
                {index > 0 ? <span>•</span> : null}
                <span className={entry.accent ? "text-emerald-300" : undefined}>{entry.label}</span>
              </Fragment>
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {summaryCards.length ? (
              summaryCards.map((card) => (
                <article key={card.key} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg shadow-black/30">
                  <h3 className="text-xs uppercase tracking-wide text-slate-400">{card.label}</h3>
                  <p className="mt-3 text-3xl font-semibold text-white">{numberFormatter.format(card.value)}</p>
                  {card.previous !== null && card.previous !== undefined ? (
                    <p className="mt-2 text-xs text-slate-400">{buildComparisonSummary(card.previous, card.delta)}</p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">Comparison disabled</p>
                  )}
                </article>
              ))
            ) : (
              <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg shadow-black/30">
                <h3 className="text-xs uppercase tracking-wide text-slate-400">Metrics unavailable</h3>
                <p className="mt-3 text-sm text-slate-400">No analytics data for the selected filters.</p>
              </article>
            )}
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-3">
            <article className="xl:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Occurrences over time</h3>
                  <p className="text-xs text-slate-500">Current window vs previous period for selected environment.</p>
                </div>
                {anomalyThreshold ? (
                  <span className="text-xs text-amber-300">Anomaly threshold ≈ {numberFormatter.format(Math.ceil(anomalyThreshold))} events</span>
                ) : null}
              </header>
              <div className="mt-6 h-80">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 24, bottom: 0, left: -10 }}>
                      <defs>
                        <linearGradient id="analytics_occurrences" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS.occurrences} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={CHART_COLORS.occurrences} stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                      <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 10 }} minTickGap={24} />
                      <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} allowDecimals={false} width={48} />
                      <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b" }} labelStyle={{ color: "#e2e8f0" }} />
                      <Legend wrapperStyle={{ color: "#cbd5f5" }} />
                      <Area
                        type="monotone"
                        dataKey="count"
                        name="Occurrences"
                        stroke={CHART_COLORS.occurrences}
                        fill="url(#analytics_occurrences)"
                        strokeWidth={2}
                        fillOpacity={1}
                      />
                      <Line type="monotone" dataKey="uniqueUsers" name="Unique users" stroke={CHART_COLORS.uniqueUsers} strokeWidth={2} dot={false} />
                      {trendPayload?.comparison ? (
                        <Line
                          type="monotone"
                          dataKey="previousCount"
                          name="Prev occurrences"
                          stroke={CHART_COLORS.comparisonCount}
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          dot={false}
                        />
                      ) : null}
                      {trendPayload?.comparison ? (
                        <Line
                          type="monotone"
                          dataKey="previousUniqueUsers"
                          name="Prev unique users"
                          stroke={CHART_COLORS.comparisonUsers}
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          dot={false}
                        />
                      ) : null}
                      {anomalies.map((point) => (
                        <ReferenceDot
                          key={point.bucketStart}
                          x={point.label}
                          y={point.count}
                          r={5}
                          isFront
                          fill={CHART_COLORS.anomaly}
                          stroke="#fde68a"
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">Not enough data to chart.</div>
                )}
              </div>
              {anomalies.length ? (
                <ul className="mt-4 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-100">
                  <li className="font-semibold uppercase tracking-wide text-amber-200">Detected anomalies</li>
                  {anomalies.map((point) => (
                    <li key={`anomaly-${point.bucketStart}`}>{point.label}: spike to {numberFormatter.format(point.count)} events</li>
                  ))}
                </ul>
              ) : null}
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Environment distribution</h3>
                <span className="text-xs text-slate-500">Occurrences by environment</span>
              </header>
              <div className="mt-6">
                {environmentSlices.length ? (
                  <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={environmentSlices}
                            dataKey="occurrences"
                            nameKey="environment"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={2}
                            onClick={handleEnvironmentSliceClick}
                          >
                            {environmentSlices.map((slice, index) => (
                              <Cell
                                key={slice.value || `env-${index}`}
                                fill={slice.color}
                                fillOpacity={
                                  selectedEnvironment === "all" || slice.value === selectedEnvironment ? 1 : 0.5
                                }
                                stroke={slice.value === selectedEnvironment ? "#f8fafc" : "#0f172a"}
                                strokeWidth={slice.value === selectedEnvironment ? 2 : 1}
                                cursor="pointer"
                              />
                            ))}
                          </Pie>
                          <Tooltip content={renderEnvironmentTooltip} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="space-y-3 text-sm">
                      {environmentSlices.map((slice) => {
                        const isActive = selectedEnvironment !== "all" && slice.value === selectedEnvironment;
                        return (
                          <li key={`legend-${slice.value}`}>
                            <button
                              type="button"
                              onClick={() => handleEnvironmentLegendClick(slice.value)}
                              aria-pressed={isActive}
                              className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                                isActive
                                  ? "border-accent bg-accent/10 text-white"
                                  : "border-slate-800 bg-slate-900/40 text-slate-200 hover:border-slate-700 hover:text-white"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="inline-flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: slice.color }} />
                                  <span className="font-medium">{slice.environment}</span>
                                </span>
                                <span className="text-xs text-slate-400">{percentFormatter.format(slice.percentage)}%</span>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                                <span>{numberFormatter.format(slice.occurrences)} events</span>
                                <span>{numberFormatter.format(slice.uniqueUsers)} users</span>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : (
                  <div className="flex h-48 items-center justify-center text-sm text-slate-500">No environment breakdown for this range.</div>
                )}
              </div>
            </article>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1.6fr_minmax(0,1fr)]">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Related error clusters</h3>
                  <p className="text-xs text-slate-500">
                    {correlationWindowLabel ? `Detected within a ${correlationWindowLabel}.` : "Session-based co-occurrence within rolling windows."}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <span className="block">{numberFormatter.format(relatedSummary.nodes)} error nodes</span>
                  <span className="block">{numberFormatter.format(relatedSummary.edges)} strong links</span>
                </div>
              </header>
              {relatedLoading ? (
                <div className="mt-4 flex min-h-[128px] items-center justify-center text-xs text-slate-500">Analyzing sessions…</div>
              ) : null}
              {relatedError ? (
                <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-100">
                  Unable to load correlations: {relatedError.message || "unexpected error"}
                </div>
              ) : null}
              {!relatedLoading && !relatedError && !relatedEdges.length ? (
                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
                  No repeated co-occurrence patterns detected for the current filters.
                </div>
              ) : null}
              {!relatedLoading && !relatedError && relatedEdges.length ? (
                <ul className="mt-5 space-y-4">
                  {relatedEdges.map((edge) => {
                    const sessionLabel = edge.sample?.session || "unknown";
                    const windowLabel = safeFormatDate(edge.sample?.windowStart, "MMM d, yyyy HH:mm");
                    const sampleErrors = (edge.sample?.errors ?? []).slice(0, 4);
                    return (
                      <li key={edge.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-inner shadow-black/20">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="max-w-xl">
                            <p className="text-sm font-semibold text-white" title={edge.source?.message}>
                              {edge.source?.message || "Unknown error"}
                            </p>
                            <p className="mt-1 text-xs text-slate-400" title={edge.target?.message}>
                              ↔ {edge.target?.message || "Unknown error"}
                            </p>
                          </div>
                          <div className="text-right text-xs text-slate-400">
                            <p>
                              <span className="font-semibold text-sky-300">{numberFormatter.format(edge.sharedWindows)}</span> shared windows
                            </p>
                            {correlationWindowLabel ? <p className="mt-1 text-slate-500">Window size {correlationWindowLabel}</p> : null}
                          </div>
                        </div>
                        {edge.sample ? (
                          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
                            <p className="font-mono text-[11px] text-slate-400" title={sessionLabel}>
                              Session • {sessionLabel}
                            </p>
                            <p className="mt-1 text-slate-400">Window start {windowLabel}</p>
                            {sampleErrors.length ? (
                              <div className="mt-2">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">Errors in window</p>
                                <ul className="mt-1 space-y-1 text-slate-200">
                                  {sampleErrors.map((errorItem) => (
                                    <li key={`${edge.id}-${errorItem.id}`} className="truncate">
                                      {errorItem.message}
                                      {errorItem.environment ? <span className="text-slate-500"> • {errorItem.environment}</span> : null}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Correlated sessions</h3>
                <span className="text-xs text-slate-500">Representative journeys where multiple errors appear together.</span>
              </header>
              {relatedLoading ? (
                <div className="mt-4 flex min-h-[120px] items-center justify-center text-xs text-slate-500">Sampling journeys…</div>
              ) : null}
              {relatedError ? (
                <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-100">
                  Unable to load journeys.
                </div>
              ) : null}
              {!relatedLoading && !relatedError && !relatedGroups.length ? (
                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
                  No recurring correlated sessions captured yet.
                </div>
              ) : null}
              {!relatedLoading && !relatedError && relatedGroups.length ? (
                <ul className="mt-4 space-y-4 text-xs text-slate-300">
                  {relatedGroups.map((group) => {
                    const windowLabel = safeFormatDate(group.window, "MMM d, yyyy HH:mm");
                    return (
                      <li key={group.key} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 shadow-inner shadow-black/10">
                        <p className="font-mono text-[11px] text-slate-400">Session {group.session}</p>
                        <p className="mt-1 text-slate-500">Window start {windowLabel}</p>
                        <ul className="mt-3 space-y-1 text-slate-200">
                          {group.errors.map((errorItem) => (
                            <li key={`${group.key}-${errorItem.id}`} className="truncate">
                              {errorItem.message}
                              {errorItem.environment ? <span className="text-slate-500"> • {errorItem.environment}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </article>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1.5fr_minmax(0,1fr)]">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">High-impact user journeys</h3>
                <span className="text-xs text-slate-500">Errors affecting the broadest set of users and sessions.</span>
              </header>
              {userImpactLoading ? (
                <div className="mt-4 flex min-h-[128px] items-center justify-center text-xs text-slate-500">Calculating impact…</div>
              ) : null}
              {userImpactError ? (
                <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-100">
                  Unable to load user impact: {userImpactError.message || "unexpected error"}
                </div>
              ) : null}
              {!userImpactLoading && !userImpactError && !highImpactErrors.length ? (
                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-400">
                  No user journeys meet the impact threshold for this environment.
                </div>
              ) : null}
              {!userImpactLoading && !userImpactError && highImpactErrors.length ? (
                <ul className="mt-4 space-y-4">
                  {highImpactErrors.map((item) => (
                    <li key={item.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-inner shadow-black/20">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="max-w-xl">
                          <p className="text-sm font-semibold text-white" title={item.message}>
                            {item.message}
                          </p>
                          <p className="text-xs text-slate-400">
                            {item.environment ? `${item.environment} • ` : ""}Status {item.status || "unknown"}
                          </p>
                        </div>
                        <div className="text-right text-xs text-slate-400">
                          <p>
                            Impact score <span className="font-semibold text-emerald-300">{numberFormatter.format(item.impactScore ?? 0)}</span>
                          </p>
                          <p className="mt-1">
                            {numberFormatter.format(item.uniqueUsers ?? 0)} users • {numberFormatter.format(item.sessions ?? 0)} sessions
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
                        <span>{numberFormatter.format(item.totalOccurrences ?? 0)} occurrences</span>
                        <span>{numberFormatter.format(item.pageViews ?? 0)} page views near failure</span>
                        <span>Last seen {safeFormatDate(item.lastSeen, "MMM d, yyyy HH:mm")}</span>
                      </div>
                      {item.journey?.topPrevious?.length ? (
                        <div className="mt-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Common previous pages</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {item.journey.topPrevious.slice(0, 3).map((entry) => (
                              <span key={`${item.id}-prev-${entry.value}`} className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-300">
                                {entry.value || "unknown"}
                                <span className="ml-1 text-slate-500">({numberFormatter.format(entry.count)})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {item.journey?.topActions?.length ? (
                        <div className="mt-3">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Frequent actions before failure</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {item.journey.topActions.slice(0, 3).map((entry) => (
                              <span key={`${item.id}-action-${entry.value}`} className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-300">
                                {entry.value || "unknown"}
                                <span className="ml-1 text-slate-500">({numberFormatter.format(entry.count)})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Impact summary</h3>
                <span className="text-xs text-slate-500">Aggregate footprint across users and sessions.</span>
              </header>
              {userImpactLoading ? (
                <div className="mt-4 flex min-h-[96px] items-center justify-center text-xs text-slate-500">Preparing rollups…</div>
              ) : null}
              {!userImpactLoading && !userImpactError ? (
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Occurrences</p>
                      <p className="mt-2 text-lg font-semibold text-white">{numberFormatter.format(userImpactSummary.totalOccurrences)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Unique users</p>
                      <p className="mt-2 text-lg font-semibold text-white">{numberFormatter.format(userImpactSummary.uniqueUsers)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Sessions</p>
                      <p className="mt-2 text-lg font-semibold text-white">{numberFormatter.format(userImpactSummary.sessions)}</p>
                    </div>
                  </div>
                  {highImpactErrors[0]?.journey?.sampleSessions?.length ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Representative session</p>
                      {(() => {
                        const session = highImpactErrors[0].journey.sampleSessions[0];
                        return (
                          <div className="mt-3 space-y-2 text-xs text-slate-300">
                            <p className="font-mono text-[11px] text-slate-400">Session {session.session || "unknown"}</p>
                            <ul className="space-y-1">
                              {session.events.map((event, index) => (
                                <li key={`${session.session || "sample"}-${index}`} className="truncate">
                                  {safeFormatDate(event.timestamp, "MMM d, HH:mm:ss")} • {event.previous ? `${event.previous} → ` : ""}
                                  <span className="text-slate-100">{event.page || "unknown page"}</span>
                                  {event.action ? <span className="text-slate-500"> (action: {event.action})</span> : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-[1.5fr_minmax(0,1fr)]">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Resolution performance</h3>
                  <p className="text-xs text-slate-500">Track closure speed and regression hotspots by error type.</p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <p>{numberFormatter.format(resolutionSummary.resolvedCount)} resolved</p>
                  <p>{numberFormatter.format(resolutionSummary.unresolvedCount)} unresolved</p>
                </div>
              </header>
              {resolutionLoading ? (
                <div className="mt-4 flex min-h-[120px] items-center justify-center text-xs text-slate-500">Crunching timeline…</div>
              ) : null}
              {resolutionError ? (
                <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-100">
                  Unable to load resolution metrics: {resolutionError.message || "unexpected error"}
                </div>
              ) : null}
              {!resolutionLoading && !resolutionError ? (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Tracked</p>
                      <p className="mt-2 text-lg font-semibold text-white">{numberFormatter.format(resolutionSummary.totalTracked)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Completion</p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {resolutionCompletionRate === null ? "—" : `${percentFormatter.format(resolutionCompletionRate)}`}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Reopened</p>
                      <p className="mt-2 text-lg font-semibold text-white">{numberFormatter.format(resolutionSummary.reopenedCount)}</p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Avg resolution</p>
                      <p className="mt-2 text-lg font-semibold text-white">{formatDuration(resolutionSummary.averageResolveMs)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Avg verification</p>
                      <p className="mt-2 text-lg font-semibold text-white">{formatDuration(resolutionSummary.averageVerifyMs)}</p>
                    </div>
                  </div>
                  {resolutionByType.length ? (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">By error type</p>
                      <ul className="mt-2 space-y-3 text-xs text-slate-300">
                        {resolutionByType.map((entry) => (
                          <li key={entry.type} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <span className="font-semibold text-white">{entry.type}</span>
                              <span className="text-slate-400">{numberFormatter.format(entry.resolved)} / {numberFormatter.format(entry.tracked)} resolved</span>
                            </div>
                            <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
                              <span>Avg resolve {formatDuration(entry.averageResolveMs)}</span>
                              <span>Avg verify {formatDuration(entry.averageVerifyMs)}</span>
                              <span>{numberFormatter.format(entry.reopened)} reopened</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Resolution backlog</h3>
                <span className="text-xs text-slate-500">Spot lingering regressions and slow fixes.</span>
              </header>
              {resolutionLoading ? (
                <div className="mt-4 flex min-h-[120px] items-center justify-center text-xs text-slate-500">Assembling cohorts…</div>
              ) : null}
              {!resolutionLoading && !resolutionError ? (
                <div className="mt-4 space-y-6 text-xs text-slate-300">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Slowest resolutions</p>
                    {slowestResolved.length ? (
                      <ul className="mt-2 space-y-2">
                        {slowestResolved.map((item) => (
                          <li key={item.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                            <p className="font-semibold text-white" title={item.message}>
                              {item.message}
                            </p>
                            <p className="mt-1 text-slate-400">Resolved in {formatDuration(item.resolveMs)}</p>
                            <p className="text-slate-500">Resolved {safeFormatDate(item.resolvedAt, "MMM d, yyyy HH:mm")}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-slate-500">No resolved errors to highlight.</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Unresolved backlog</p>
                    {unresolvedBacklog.length ? (
                      <ul className="mt-2 space-y-2">
                        {unresolvedBacklog.map((item) => (
                          <li key={item.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                            <p className="font-semibold text-white" title={item.message}>
                              {item.message}
                            </p>
                            <p className="mt-1 text-slate-400">Open for {formatDuration(item.ageMs)}</p>
                            <p className="text-slate-500">First seen {safeFormatDate(item.firstSeen, "MMM d, yyyy HH:mm")}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-slate-500">No outstanding backlog items.</p>
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-2">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Error hotspots</h3>
                <span className="text-xs text-slate-500">Most active source files over the past seven days.</span>
              </header>
              <div className="mt-4 space-y-3 text-sm text-slate-200">
                {patternsLoading ? (
                  <div className="flex min-h-[128px] items-center justify-center text-xs text-slate-500">Loading hotspots...</div>
                ) : null}
                {patternsError ? (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-100">
                    Unable to load hotspots: {patternsError.message || "unexpected error"}
                  </div>
                ) : null}
                {!patternsLoading && !patternsError && hotspots.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-400">
                    No concentrated source file activity detected for this environment.
                  </div>
                ) : null}
                {!patternsLoading && !patternsError && hotspots.length
                  ? hotspots.map((hotspot, index) => {
                      const canNavigate = hotspot.filePath && hotspot.filePath.toLowerCase() !== "unknown";
                      return (
                        <article
                          key={hotspot.filePath ? `${hotspot.filePath}-${index}` : `hotspot-${index}`}
                          className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-inner shadow-black/20"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-mono text-sm text-emerald-200" title={hotspot.filePath}>
                                {hotspot.filePath || "unknown"}
                              </p>
                              <p className="text-[11px] text-slate-500">Last seen {safeFormatDate(hotspot.lastSeen, "MMM d, yyyy HH:mm")}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleHotspotNavigate(hotspot.filePath)}
                              disabled={!canNavigate}
                              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                canNavigate
                                  ? "border-emerald-500/40 text-emerald-200 hover:border-emerald-400 hover:text-emerald-100"
                                  : "cursor-not-allowed border-slate-800 text-slate-600"
                              }`}
                            >
                              View errors
                              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M5.25 3.75h6.5v6.5" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M4 12l7.5-7.5" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                          <dl className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
                            <div>
                              <dt className="uppercase tracking-wide text-slate-500">Occurrences</dt>
                              <dd className="text-slate-200">{numberFormatter.format(hotspot.occurrenceCount ?? 0)}</dd>
                            </div>
                            <div>
                              <dt className="uppercase tracking-wide text-slate-500">Error groups</dt>
                              <dd className="text-slate-200">{numberFormatter.format(hotspot.errorCount ?? 0)}</dd>
                            </div>
                            <div>
                              <dt className="uppercase tracking-wide text-slate-500">Last 24h / 7d</dt>
                              <dd className="text-slate-200">
                                {numberFormatter.format(hotspot.recentOccurrences24h ?? 0)} / {numberFormatter.format(hotspot.recentOccurrences7d ?? 0)}
                              </dd>
                            </div>
                          </dl>
                          {hotspot.sampleErrors?.length ? (
                            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                              <p className="text-[11px] uppercase tracking-wide text-slate-500">Recent errors</p>
                              <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
                                {hotspot.sampleErrors.map((sample, index) => (
                                  <li key={sample.errorId || index} className="truncate" title={sample.message}>
                                    {sample.message || "(no message)"}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  : null}
              </div>
            </article>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-2">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Error spikes</h3>
                <span className="text-xs text-slate-500">Short-term surges compared to the recent baseline.</span>
              </header>
              <div className="mt-4 space-y-3 text-sm text-slate-200">
                {patternsLoading ? (
                  <div className="flex min-h-[128px] items-center justify-center text-xs text-slate-500">Loading spikes...</div>
                ) : null}
                {patternsError ? (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-100">
                    Unable to load spike data: {patternsError.message || "unexpected error"}
                  </div>
                ) : null}
                {!patternsLoading && !patternsError && spikeHighlights.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-400">
                    No statistically significant spikes detected for this environment.
                  </div>
                ) : null}
                {!patternsLoading && !patternsError && spikeHighlights.length
                  ? spikeHighlights.map((spike) => {
                      const multiplier = typeof spike.multiplier === "number" ? spike.multiplier : null;
                      return (
                        <article key={spike.bucketStart} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-inner shadow-black/20">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{safeFormatDate(spike.bucketStart, "MMM d, yyyy HH:mm")}</p>
                            <p className="text-[11px] text-slate-500">
                              {numberFormatter.format(spike.count ?? 0)} events • {multiplier ? `${percentFormatter.format((multiplier - 1) * 100)}% above baseline` : "no baseline"}
                            </p>
                          </div>
                          <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">
                            Spike x{multiplier ? multiplier.toFixed(2) : "1.00"}
                          </span>
                        </div>
                        {spike.contributors?.length ? (
                          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                            <p className="text-[11px] uppercase tracking-wide text-slate-500">Top contributors</p>
                            <ul className="mt-2 space-y-2 text-[11px] text-slate-300">
                              {spike.contributors.map((item, index) => (
                                <li key={item.errorId || index} className="flex items-center justify-between gap-3">
                                  <span className="truncate" title={item.message}>
                                    {item.message || "(no message)"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleSpikeContributorNavigate(item.errorId)}
                                    disabled={!item.errorId}
                                    className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                                      item.errorId
                                        ? "border-sky-500/40 text-sky-200 hover:border-sky-400 hover:text-sky-100"
                                        : "cursor-not-allowed border-slate-800 text-slate-600"
                                    }`}
                                  >
                                    View
                                    <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                      <path d="M5.25 3.75h6.5v6.5" strokeLinecap="round" strokeLinejoin="round" />
                                      <path d="M4 12l7.5-7.5" strokeLinecap="round" />
                                    </svg>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        </article>
                      );
                    })
                  : null}
              </div>
              {spikeTimeline.length ? (
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
                  <table className="min-w-full divide-y divide-slate-800 text-[11px] text-slate-300">
                    <thead className="bg-slate-900/50 uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Bucket</th>
                        <th className="px-3 py-2 text-right">Count</th>
                        <th className="px-3 py-2 text-right">Baseline</th>
                        <th className="px-3 py-2 text-right">Spike?</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {spikeTimeline.slice(-8).map((entry) => (
                        <tr key={entry.bucketStart} className={entry.isSpike ? "bg-amber-500/5" : undefined}>
                          <td className="px-3 py-2 text-slate-200">{safeFormatDate(entry.bucketStart, "MMM d, HH:mm")}</td>
                          <td className="px-3 py-2 text-right text-slate-200">{numberFormatter.format(entry.count ?? 0)}</td>
                          <td className="px-3 py-2 text-right">{entry.baseline !== null && entry.baseline !== undefined ? numberFormatter.format(Math.round(entry.baseline)) : "—"}</td>
                          <td className="px-3 py-2 text-right">{entry.isSpike ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Deployment impact</h3>
                <span className="text-xs text-slate-500">Compares activity two hours before and after each release.</span>
              </header>
              <div className="mt-4 space-y-3 text-sm text-slate-200">
                {patternsLoading ? (
                  <div className="flex min-h-[128px] items-center justify-center text-xs text-slate-500">Loading deployment impact...</div>
                ) : null}
                {patternsError ? (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-100">
                    Unable to load deployment insight: {patternsError.message || "unexpected error"}
                  </div>
                ) : null}
                {!patternsLoading && !patternsError && deployments.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-400">
                    No deployment markers found. Add one to baseline release behaviour.
                  </div>
                ) : null}
                {!patternsLoading && !patternsError && deployments.length
                  ? deployments.map((deployment) => {
                      const changeLabel = (() => {
                        if (deployment.metrics?.changePercentage === null || deployment.metrics?.changePercentage === undefined) {
                          return "No baseline";
                        }
                        const value = Math.abs(deployment.metrics.changePercentage);
                        return `${deployment.metrics.changePercentage >= 0 ? "+" : "-"}${percentFormatter.format(value)}%`;
                      })();
                      const showRollback = deployment.metrics?.rollbackSuggested;
                      return (
                        <article key={deployment.id} className={`rounded-xl border p-4 shadow-inner shadow-black/20 ${
                          showRollback ? "border-rose-500/40 bg-rose-500/10" : "border-slate-800 bg-slate-900/60"
                        }`}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{deployment.label || "Unnamed deployment"}</p>
                              <p className="text-[11px] text-slate-500">{safeFormatDate(deployment.timestamp, "MMM d, yyyy HH:mm")}</p>
                            </div>
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                              showRollback
                                ? "border-rose-500/60 bg-rose-500/20 text-rose-100"
                                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                            }`}>
                              {showRollback ? "Rollback suggested" : "Stable"}
                            </span>
                          </div>
                          <dl className="mt-3 grid gap-2 text-[11px] text-slate-300 sm:grid-cols-4">
                            <div>
                              <dt className="uppercase tracking-wide text-slate-500">Before events</dt>
                              <dd className="text-slate-200">{numberFormatter.format(deployment.metrics?.before?.occurrences ?? 0)}</dd>
                            </div>
                            <div>
                              <dt className="uppercase tracking-wide text-slate-500">After events</dt>
                              <dd className="text-slate-200">{numberFormatter.format(deployment.metrics?.after?.occurrences ?? 0)}</dd>
                            </div>
                            <div>
                              <dt className="uppercase tracking-wide text-slate-500">Change</dt>
                              <dd className="text-slate-200">{changeLabel}</dd>
                            </div>
                            <div>
                              <dt className="uppercase tracking-wide text-slate-500">Unique users</dt>
                              <dd className="text-slate-200">
                                {numberFormatter.format(deployment.metrics?.before?.uniqueUsers ?? 0)}
                                <span className="text-slate-500"> → </span>
                                {numberFormatter.format(deployment.metrics?.after?.uniqueUsers ?? 0)}
                              </dd>
                            </div>
                          </dl>
                          {deployment.metadata && Object.keys(deployment.metadata).length ? (
                            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-[11px] text-slate-300">
                              <p className="uppercase tracking-wide text-slate-500">Metadata</p>
                              <ul className="mt-2 space-y-1">
                                {Object.entries(deployment.metadata).map(([key, value]) => (
                                  <li key={key} className="flex justify-between gap-3">
                                    <span className="font-semibold text-slate-200">{key}</span>
                                    <span className="truncate text-slate-400" title={String(value)}>{String(value)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  : null}
              </div>
              {deploymentWindow ? (
                <p className="mt-4 text-[11px] text-slate-500">
                  Window: {Math.round((deploymentWindow.windowBeforeMs ?? 0) / (60 * 1000))} min before / {Math.round((deploymentWindow.windowAfterMs ?? 0) / (60 * 1000))} min after
                </p>
              ) : null}
            </article>
          </section>

          <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <header className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Top impacted errors</h3>
                <p className="text-xs text-slate-500">Most frequent error groups in the selected environment.</p>
              </div>
            </header>
            <ul className="mt-4 space-y-3 text-sm text-slate-200">
              {topErrors.length ? (
                topErrors.slice(0, 6).map((errorItem) => (
                  <li key={errorItem.id} className="flex flex-col gap-1 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                    <span className="truncate font-medium text-white" title={errorItem.message}>
                      {errorItem.message}
                    </span>
                    <span className="flex items-center justify-between text-xs text-slate-400">
                      <span className="capitalize">{errorItem.environment}</span>
                      <span>{numberFormatter.format(errorItem.count)} occurrences</span>
                    </span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-slate-400">No error cohorts for the current filters.</li>
              )}
            </ul>
          </section>

          <section className="mt-8 grid gap-6 xl:grid-cols-3">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Error type distribution</h3>
                <span className="text-xs text-slate-500">Most common error categories for this window.</span>
              </header>
              <div className="mt-4 h-72">
                {errorTypeData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={errorTypeData} layout="vertical" margin={{ top: 10, right: 10, left: 60, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                      <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fontSize: 11 }} width={120} />
                      <Tooltip content={renderBreakdownTooltip} />
                      <Bar dataKey="occurrences" fill={BREAKDOWN_COLORS.errorType} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">No error type data for this range.</div>
                )}
              </div>
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Severity levels</h3>
                <span className="text-xs text-slate-500">How errors distribute by severity.</span>
              </header>
              <div className="mt-4 h-72">
                {severityData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={severityData} layout="vertical" margin={{ top: 10, right: 10, left: 50, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                      <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                      <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fontSize: 11 }} width={100} />
                      <Tooltip content={renderBreakdownTooltip} />
                      <Bar dataKey="occurrences" fill={BREAKDOWN_COLORS.severity} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">No severity data for this range.</div>
                )}
              </div>
            </article>
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Affected users by environment</h3>
                <span className="text-xs text-slate-500">Compare unique users against raw occurrences.</span>
              </header>
              <div className="mt-4 h-72">
                {userImpactData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={userImpactData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                      <XAxis dataKey="environment" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                      <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} width={50} />
                      <Tooltip content={renderUserImpactTooltip} />
                      <Legend wrapperStyle={{ color: "#cbd5f5" }} />
                      <Bar yAxisId="left" dataKey="uniqueUsers" name="Unique users" fill={BREAKDOWN_COLORS.users} radius={[6, 6, 0, 0]} />
                      <Line yAxisId="right" type="monotone" dataKey="occurrences" name="Occurrences" stroke={CHART_COLORS.occurrences} strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">No user impact data available.</div>
                )}
              </div>
            </article>
          </section>

          {hasClientBreakdown ? (
            <section className="mt-8 grid gap-6 xl:grid-cols-3">
              <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                <header className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Top browsers</h3>
                  <span className="text-xs text-slate-500">Highest volume clients in this range.</span>
                </header>
                <div className="mt-4 h-72">
                  {topBrowsers.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topBrowsers} layout="vertical" margin={{ top: 10, right: 10, left: 60, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                        <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fontSize: 11 }} width={110} />
                        <Tooltip content={renderBreakdownTooltip} />
                        <Bar dataKey="occurrences" fill={BREAKDOWN_COLORS.browsers} radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">No browser breakdown for this range.</div>
                  )}
                </div>
              </article>
              <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                <header className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Top operating systems</h3>
                  <span className="text-xs text-slate-500">Most impacted platforms.</span>
                </header>
                <div className="mt-4 h-72">
                  {topOperatingSystems.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topOperatingSystems} layout="vertical" margin={{ top: 10, right: 10, left: 70, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                        <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fontSize: 11 }} width={130} />
                        <Tooltip content={renderBreakdownTooltip} />
                        <Bar dataKey="occurrences" fill={BREAKDOWN_COLORS.operatingSystems} radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">No operating system breakdown for this range.</div>
                  )}
                </div>
              </article>
              <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
                <header className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Top devices</h3>
                  <span className="text-xs text-slate-500">Device categories affected by the errors.</span>
                </header>
                <div className="mt-4 h-72">
                  {topDevices.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topDevices} layout="vertical" margin={{ top: 10, right: 10, left: 50, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                        <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fontSize: 11 }} width={120} />
                        <Tooltip content={renderBreakdownTooltip} />
                        <Bar dataKey="occurrences" fill={BREAKDOWN_COLORS.devices} radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">No device breakdown for this range.</div>
                  )}
                </div>
              </article>
            </section>
          ) : null}
        </Fragment>
      ) : null}
    </MainLayout>
  );
}
