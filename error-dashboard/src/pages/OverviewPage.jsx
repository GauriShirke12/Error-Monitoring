import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  Bar,
  Cell,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageLoader } from "../components/feedback/PageLoader";
import { MainLayout } from "../components/layout/MainLayout";
import { useProjectContext } from "../contexts/ProjectContext";
import { fetchErrorTrends, fetchOverviewSummary, fetchTopErrors } from "../services/api";

const STATUS_COLORS = {
  new: "border-sky-400/40 bg-sky-500/10 text-sky-200",
  open: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  investigating: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200",
  resolved: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  ignored: "border-purple-200/20 bg-purple-900/20 text-slate-300",
  muted: "border-purple-200/20 bg-purple-900/20 text-slate-300",
};

const PIE_COLORS = ["#8b5cf6", "#38bdf8", "#a855f7", "#ec4899", "#f97316", "#14b8a6"];
const BAR_COLOR = "#8b5cf6";

const numberFormatter = new Intl.NumberFormat("en-US");

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

const computePercentChange = (current, previous) => {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
};

const normalizeMetric = (source) => ({
  current: source?.current ?? 0,
  previous: source?.previous ?? 0,
});

const SAMPLE_OVERVIEW = {
  totals: {
    totalErrors: { current: 1240, previous: 1415 },
    newErrors24h: { current: 86, previous: 102 },
    activeErrors24h: { current: 42, previous: 51 },
    resolvedErrors24h: { current: 58, previous: 44 },
  },
};

const SAMPLE_TRENDS = [
  { label: "Mon", count: 180, uniqueUsers: 44 },
  { label: "Tue", count: 210, uniqueUsers: 52 },
  { label: "Wed", count: 165, uniqueUsers: 40 },
  { label: "Thu", count: 195, uniqueUsers: 49 },
  { label: "Fri", count: 230, uniqueUsers: 60 },
  { label: "Sat", count: 150, uniqueUsers: 36 },
  { label: "Sun", count: 120, uniqueUsers: 30 },
];

const SAMPLE_RECENT_ERRORS = [
  { id: "err-1", message: "TypeError: Cannot read property 'foo' of undefined", environment: "production", count: 128, status: "open" },
  { id: "err-2", message: "TimeoutError: Request timed out after 30s", environment: "staging", count: 73, status: "investigating" },
  { id: "err-3", message: "ReferenceError: window is not defined", environment: "production", count: 52, status: "resolved" },
  { id: "err-4", message: "DatabaseError: Connection pool exhausted", environment: "production", count: 34, status: "open" },
  { id: "err-5", message: "AuthError: Invalid JWT signature", environment: "development", count: 19, status: "ignored" },
  { id: "err-6", message: "NetworkError: Failed to fetch", environment: "production", count: 11, status: "new" },
];

const SAMPLE_ENVIRONMENT_BREAKDOWN = [
  { environment: "production", occurrences: 720 },
  { environment: "staging", occurrences: 210 },
  { environment: "development", occurrences: 110 },
];

const SAMPLE_STATUS_BREAKDOWN = [
  { name: "Open", count: 38 },
  { name: "Resolved", count: 22 },
  { name: "Ignored", count: 9 },
];

const SAMPLE_CLIENT_BREAKDOWN = {
  browsers: [
    { name: "Chrome", count: 540 },
    { name: "Firefox", count: 180 },
    { name: "Safari", count: 140 },
    { name: "Edge", count: 90 },
  ],
  operatingSystems: [
    { name: "Windows", count: 410 },
    { name: "macOS", count: 320 },
    { name: "Linux", count: 140 },
    { name: "iOS", count: 60 },
  ],
  devices: [
    { name: "Desktop", count: 640 },
    { name: "Mobile", count: 220 },
    { name: "Tablet", count: 70 },
  ],
};

function SkeletonBar({ className = "" }) {
  return <div className={`animate-pulse rounded-lg bg-white/10 ${className}`} aria-hidden="true" />;
}

function EmptyState({ title, message, action }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 px-6 py-10 text-center text-sm text-slate-300">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-accent" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 4.5 4.5 9v6L12 19.5 19.5 15V9z" />
          <path d="m9 10.5 6 3" strokeLinecap="round" />
        </svg>
      </div>
      <div>
        <p className="text-base font-semibold text-white">{title}</p>
        <p className="mt-1 text-slate-400">{message}</p>
      </div>
      {action || null}
    </div>
  );
}

export function OverviewPage() {
  const navigate = useNavigate();
  const { currentProjectId, loadingProjects, projectError } = useProjectContext();
  const [selectedRange, setSelectedRange] = useState("7d");
  const [selectedEnvironment, setSelectedEnvironment] = useState("all");
  const [overviewData, setOverviewData] = useState(null);
  const [trendData, setTrendData] = useState([]);
  const [topErrors, setTopErrors] = useState([]);
  const [recentErrors, setRecentErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!loadingProjects && (!currentProjectId || projectError)) {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadingProjects, currentProjectId, projectError]);

  const filters = (
    <Fragment>
      <select
        value={selectedRange}
        onChange={(event) => setSelectedRange(event.target.value)}
        className="rounded-lg border border-purple-500/30 bg-canvas-subtle/80 px-3 py-2 text-sm text-slate-100 shadow-[0_0_0_1px_rgba(139,92,246,0.15)] focus:border-accent focus:outline-none"
      >
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
      </select>
      <select
        value={selectedEnvironment}
        onChange={(event) => setSelectedEnvironment(event.target.value)}
        className="rounded-lg border border-purple-500/30 bg-canvas-subtle/80 px-3 py-2 text-sm text-slate-100 shadow-[0_0_0_1px_rgba(139,92,246,0.15)] focus:border-accent focus:outline-none"
      >
        <option value="all">All environments</option>
        <option value="production">Production</option>
        <option value="staging">Staging</option>
        <option value="development">Development</option>
      </select>
    </Fragment>
  );

  useEffect(() => {
    if (loadingProjects || !currentProjectId) {
      return undefined;
    }

    loadedRef.current = false;
    let controller = new AbortController();
    let cancelled = false;

    const fetchData = async (initialFetch) => {
      if (!loadedRef.current || initialFetch) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      const envParam = selectedEnvironment !== "all" ? { environment: selectedEnvironment } : {};

      try {
        const [overviewResponse, trendsResponse, topResponse] = await Promise.all([
          fetchOverviewSummary(envParam, { signal: controller.signal }),
          fetchErrorTrends({ range: selectedRange, ...envParam }, { signal: controller.signal }),
          fetchTopErrors(envParam, { signal: controller.signal }),
        ]);

        if (cancelled) {
          return;
        }

        const overviewPayload = overviewResponse?.data ?? {};
        const trendPayload = trendsResponse?.data ?? {};
        const topPayload = topResponse?.data ?? {};

        setOverviewData(overviewPayload);
        setTrendData(trendPayload?.timeSeries ?? []);
        setTopErrors((topPayload?.topByCount ?? []).slice(0, 5));
        setRecentErrors(topPayload?.recentErrors ?? []);
        setLastUpdatedAt(new Date());
        loadedRef.current = true;
      } catch (fetchError) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
      } finally {
        if (cancelled) {
          return;
        }
        setLoading(false);
        setRefreshing(false);
      }
    };

    fetchData(true);

    const intervalId = setInterval(() => {
      controller.abort();
      controller = new AbortController();
      fetchData(false);
    }, 30000);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(intervalId);
    };
  }, [selectedEnvironment, selectedRange, currentProjectId, loadingProjects]);

  const metrics = useMemo(() => {
    const source = overviewData?.totals ? overviewData : !loading && !refreshing ? SAMPLE_OVERVIEW : null;
    if (!source?.totals) {
      return [];
    }

    const totalErrors = normalizeMetric(source.totals.totalErrors);
    const newErrors = normalizeMetric(source.totals.newErrors24h);
    const activeErrors = normalizeMetric(source.totals.activeErrors24h);
    const resolvedErrors = normalizeMetric(source.totals.resolvedErrors24h);

    const definitions = [
      {
        key: "totalErrors",
        label: "Total errors (24h)",
        metric: totalErrors,
        goodDirection: "down",
      },
      {
        key: "newErrors",
        label: "New errors (24h)",
        metric: newErrors,
        goodDirection: "down",
      },
      {
        key: "activeErrors",
        label: "Active errors",
        metric: activeErrors,
        goodDirection: "down",
      },
      {
        key: "resolvedErrors",
        label: "Resolved errors",
        metric: resolvedErrors,
        goodDirection: "up",
      },
    ];

    return definitions.map((definition) => {
      const change = computePercentChange(definition.metric.current, definition.metric.previous);
      const isGood = definition.goodDirection === "up" ? change >= 0 : change <= 0;
      const changeLabel = `${change >= 0 ? "▲" : "▼"} ${percentFormatter.format(Math.abs(change))}`;

      return {
        ...definition,
        value: numberFormatter.format(definition.metric.current),
        change,
        changeLabel,
        isGood,
      };
    });
  }, [overviewData, loading, refreshing]);

  const environmentBreakdown = overviewData?.environmentBreakdown ?? [];
  const clientBreakdown = overviewData?.clientBreakdown ?? { browsers: [], operatingSystems: [], devices: [] };

  const statusBreakdown = useMemo(() => {
    const raw = overviewData?.statusBreakdown ?? [];
    if (!raw.length) {
      return [];
    }

    const openStatuses = new Set(["new", "open", "investigating"]);
    const ignoredStatuses = new Set(["ignored", "muted"]);

    const summary = {
      open: 0,
      resolved: 0,
      ignored: 0,
    };

    raw.forEach((entry) => {
      const name = (entry?.status || "unknown").toLowerCase();
      if (openStatuses.has(name)) {
        summary.open += entry.count;
      } else if (name === "resolved") {
        summary.resolved += entry.count;
      } else if (ignoredStatuses.has(name)) {
        summary.ignored += entry.count;
      }
    });

    return [
      { name: "Open", count: summary.open },
      { name: "Resolved", count: summary.resolved },
      { name: "Ignored", count: summary.ignored },
    ];
  }, [overviewData]);

  if (loadingProjects) {
    return <PageLoader label="Loading projects..." />;
  }

  if (!currentProjectId && !projectError) {
    return (
      <MainLayout
        title="Overview"
        description="Monitor the health of your applications at a glance."
        breadcrumbs={[
          { label: "Dashboard", href: "/overview", current: false },
          { label: "Overview", href: "/overview", current: true },
        ]}
        filters={filters}
        requireProject={false}
      >
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
          <p>Select or create a project to view analytics.</p>
        </div>
      </MainLayout>
    );
  }

  if (loading) {
    return <PageLoader label="Preparing overview dashboard..." />;
  }

  const isLoading = refreshing;
  const hasTrendData = trendData.length > 0;
  const trendSeries = hasTrendData ? trendData : !isLoading ? SAMPLE_TRENDS : [];
  const hasTrendSeries = trendSeries.length > 0;
  const hasTopErrors = topErrors.length > 0;
  const hasRecentErrors = recentErrors.length > 0;
  const displayRecentErrors = hasRecentErrors ? recentErrors.slice(0, 10) : !isLoading ? SAMPLE_RECENT_ERRORS : [];
  const displayEnvironmentBreakdown = environmentBreakdown.length ? environmentBreakdown : !isLoading ? SAMPLE_ENVIRONMENT_BREAKDOWN : [];
  const displayStatusBreakdown = statusBreakdown.length ? statusBreakdown : !isLoading ? SAMPLE_STATUS_BREAKDOWN : [];
  const displayClientBreakdown = {
    browsers: clientBreakdown.browsers?.length ? clientBreakdown.browsers : !isLoading ? SAMPLE_CLIENT_BREAKDOWN.browsers : [],
    operatingSystems: clientBreakdown.operatingSystems?.length
      ? clientBreakdown.operatingSystems
      : !isLoading
      ? SAMPLE_CLIENT_BREAKDOWN.operatingSystems
      : [],
    devices: clientBreakdown.devices?.length ? clientBreakdown.devices : !isLoading ? SAMPLE_CLIENT_BREAKDOWN.devices : [],
  };

  return (
    <MainLayout
      title="Overview"
      description="Monitor the health of your applications at a glance."
      breadcrumbs={[
        { label: "Dashboard", href: "/overview", current: false },
        { label: "Overview", href: "/overview", current: true },
      ]}
      filters={filters}
      requireProject={false}
    >
      {projectError ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">
          {projectError}
        </div>
      ) : null}

      <section className="mb-6 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span>Auto-refreshing every 30 seconds</span>
        {refreshing ? (
          <span className="inline-flex items-center gap-1 text-accent">
            <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
            Refreshing...
          </span>
        ) : lastUpdatedAt ? (
          <span>Updated {formatDistanceToNow(lastUpdatedAt, { addSuffix: true })}</span>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, index) => (
              <article key={index} className="surface-panel rounded-2xl p-5 backdrop-blur-xl">
                <SkeletonBar className="h-3 w-24" />
                <SkeletonBar className="mt-4 h-8 w-32" />
                <SkeletonBar className="mt-3 h-3 w-28" />
              </article>
            ))
          : metrics.length
          ? metrics.map((metric) => (
              <article key={metric.key} className="surface-panel rounded-2xl p-5 backdrop-blur-xl">
                <h3 className="text-xs uppercase tracking-wide text-slate-300">{metric.label}</h3>
                <p className="mt-3 text-3xl font-semibold text-white">{metric.value}</p>
                <p
                  className={`mt-2 text-xs font-medium ${
                    metric.change === 0
                      ? "text-slate-400"
                      : metric.isGood
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  {metric.change === 0 ? "No change vs prior period" : `${metric.changeLabel} vs previous day`}
                </p>
              </article>
            ))
          : (
              <article className="surface-panel rounded-2xl p-5 backdrop-blur-xl">
                <EmptyState
                  title="No metrics yet"
                  message="We haven't seen activity for this project and filter window. Send a test error to populate the dashboard."
                  action={
                    <button
                      type="button"
                      onClick={() => navigate("/errors")}
                      className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-indigo-950 transition hover:brightness-110"
                    >
                      View error onboarding
                    </button>
                  }
                />
              </article>
            )}
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-3">
        <article className="xl:col-span-2 surface-panel-soft rounded-2xl p-6">
          <header className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Error rate trend</h3>
              <p className="text-xs text-slate-400">Rolling totals for the last {selectedRange === "24h" ? "24 hours" : selectedRange === "7d" ? "7 days" : "30 days"}.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/errors")}
              className="text-xs text-slate-300 transition-colors hover:text-white"
            >
              Go to errors
            </button>
          </header>
          <div className="mt-6 h-72">
            {isLoading ? (
              <div className="flex h-full flex-col justify-center gap-3">
                <SkeletonBar className="h-4 w-32" />
                <SkeletonBar className="h-52 w-full" />
              </div>
            ) : hasTrendSeries ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(168, 85, 247, 0.15)" />
                  <XAxis dataKey="label" stroke="#c4b5fd" tick={{ fontSize: 10, fill: "#d9d6ff" }} minTickGap={24} />
                  <YAxis stroke="#c4b5fd" tick={{ fontSize: 10, fill: "#d9d6ff" }} allowDecimals={false} width={40} />
                  <Tooltip contentStyle={{ backgroundColor: "rgba(18, 4, 49, 0.92)", border: "1px solid rgba(168, 85, 247, 0.4)" }} labelStyle={{ color: "#ede9fe" }} />
                  <Legend iconType="circle" wrapperStyle={{ color: "#c4b5fd" }} />
                  <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Errors" />
                  <Line type="monotone" dataKey="uniqueUsers" stroke="#38bdf8" strokeWidth={2} dot={false} name="Unique users" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title="No trend data"
                message="We need more events in this window to plot the error rate. Try expanding the range or sending a test error."
                action={
                  <button
                    type="button"
                    onClick={() => navigate("/errors")}
                    className="rounded-lg border border-accent/50 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent hover:text-indigo-950"
                  >
                    Open errors list
                  </button>
                }
              />
            )}
          </div>
        </article>
        <article className="surface-panel rounded-2xl p-6">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Top errors</h3>
            <button
              type="button"
              onClick={() => navigate("/errors")}
              className="text-xs text-slate-300 transition-colors hover:text-white"
            >
              View all
            </button>
          </header>
          <ul className="mt-4 space-y-4 text-sm text-slate-200">
            {isLoading
              ? Array.from({ length: 4 }).map((_, index) => (
                  <li key={index} className="space-y-2">
                    <SkeletonBar className="h-4 w-full" />
                    <SkeletonBar className="h-3 w-40" />
                  </li>
                ))
              : hasTopErrors
              ? topErrors.map((error) => (
                  <li key={error.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/errors/${error.id}`)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex-1 truncate font-medium text-white" title={error.message}>
                          {error.message}
                        </span>
                        <span className="text-xs text-slate-300">{numberFormatter.format(error.count)} events</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                        <span className="capitalize">{error.environment}</span>
                        <span>•</span>
                        <span
                          className={`${
                            STATUS_COLORS[error.status] || "border-purple-500/30 bg-purple-900/30 text-slate-200"
                          } inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize`}
                        >
                          {error.status}
                        </span>
                      </div>
                    </button>
                  </li>
                ))
              : (
                  <li>
                    <EmptyState
                      title="No top errors yet"
                      message="Top offenders appear once errors start grouping. Send an event or check your environment filter."
                      action={
                        <button
                          type="button"
                          onClick={() => navigate("/errors")}
                          className="rounded-lg border border-accent/50 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent hover:text-indigo-950"
                        >
                          Go to errors
                        </button>
                      }
                    />
                  </li>
                )}
          </ul>
        </article>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-2">
        <article className="xl:col-span-2 surface-panel-soft rounded-2xl p-6">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Recent errors</h3>
            <button
              type="button"
              onClick={() => navigate("/errors")}
              className="text-xs text-slate-300 transition-colors hover:text-white"
            >
              Open errors list
            </button>
          </header>
          <div className="table-surface mt-4 overflow-hidden rounded-xl">
            <table className="min-w-full divide-y divide-purple-500/15 text-sm text-slate-100">
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-300">
                <tr>
                  <th className="px-4 py-3 text-left">Error</th>
                  <th className="px-4 py-3 text-left">Environment</th>
                  <th className="px-4 py-3 text-right">Events</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purple-500/10">
                {isLoading
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3"><SkeletonBar className="h-4 w-full" /></td>
                        <td className="px-4 py-3"><SkeletonBar className="h-3 w-16" /></td>
                        <td className="px-4 py-3 text-right"><SkeletonBar className="ml-auto h-3 w-10" /></td>
                        <td className="px-4 py-3"><SkeletonBar className="h-3 w-20" /></td>
                      </tr>
                    ))
                  : displayRecentErrors.length
                  ? displayRecentErrors.map((error) => (
                      <tr
                        key={error.id}
                        className="cursor-pointer bg-transparent transition-colors hover:bg-purple-950/40"
                        onClick={() => navigate(`/errors/${error.id}`)}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-white" title={error.message}>
                          {error.message}
                        </td>
                        <td className="px-4 py-3 text-xs capitalize text-slate-300">{error.environment}</td>
                        <td className="px-4 py-3 text-right text-xs text-slate-200">{numberFormatter.format(error.count)}</td>
                        <td className="px-4 py-3 text-xs">
                          <span
                            className={`${
                              STATUS_COLORS[error.status] || "border-purple-500/30 bg-purple-900/30 text-slate-200"
                            } inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize`}
                          >
                            {error.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  : (
                      <tr>
                        <td colSpan={4} className="px-4 py-6">
                          <EmptyState
                            title="No recent errors"
                            message="Nothing has fired recently for this project. Try narrowing the environment filter or generate a test error."
                            action={
                              <button
                                type="button"
                                onClick={() => navigate("/errors")}
                                className="mx-auto mt-3 block rounded-lg border border-accent/50 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent hover:text-indigo-950"
                              >
                                Create a test event
                              </button>
                            }
                          />
                        </td>
                      </tr>
                    )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-3">
        <article className="surface-panel rounded-2xl p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Environment breakdown</h3>
          <div className="mt-4 h-64">
            {displayEnvironmentBreakdown.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={displayEnvironmentBreakdown} dataKey="occurrences" nameKey="environment" innerRadius={50} outerRadius={90}>
                    {displayEnvironmentBreakdown.map((entry, index) => (
                      <Cell key={entry.environment} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "rgba(18, 4, 49, 0.92)", border: "1px solid rgba(168, 85, 247, 0.35)", color: "#ede9fe" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">No environment data available.</div>
            )}
          </div>
        </article>
        <article className="surface-panel rounded-2xl p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Status breakdown</h3>
          <div className="mt-4 h-64">
            {displayStatusBreakdown.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displayStatusBreakdown} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
                  <XAxis dataKey="name" stroke="#c4b5fd" tick={{ fontSize: 12, fill: "#d9d6ff" }} />
                  <YAxis stroke="#c4b5fd" tick={{ fontSize: 12, fill: "#d9d6ff" }} allowDecimals={false} width={32} />
                  <Tooltip contentStyle={{ backgroundColor: "rgba(18, 4, 49, 0.92)", border: "1px solid rgba(168, 85, 247, 0.35)", color: "#ede9fe" }} />
                  <Bar dataKey="count" fill={BAR_COLOR} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">No status data available.</div>
            )}
          </div>
        </article>
        <article className="surface-panel rounded-2xl p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Clients by browser</h3>
          <div className="mt-4 h-64">
            {displayClientBreakdown.browsers?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displayClientBreakdown.browsers} layout="vertical" margin={{ top: 10, right: 10, left: 40, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
                  <XAxis type="number" stroke="#c4b5fd" tick={{ fontSize: 12, fill: "#d9d6ff" }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" stroke="#c4b5fd" tick={{ fontSize: 12, fill: "#d9d6ff" }} width={90} />
                  <Tooltip contentStyle={{ backgroundColor: "rgba(18, 4, 49, 0.92)", border: "1px solid rgba(168, 85, 247, 0.35)", color: "#ede9fe" }} />
                  <Bar dataKey="count" fill="#a855f7" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">No browser data available.</div>
            )}
          </div>
        </article>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-2">
        <article className="surface-panel rounded-2xl p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Clients by operating system</h3>
          <div className="mt-4 h-64">
            {displayClientBreakdown.operatingSystems?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displayClientBreakdown.operatingSystems} layout="vertical" margin={{ top: 10, right: 10, left: 40, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
                  <XAxis type="number" stroke="#c4b5fd" tick={{ fontSize: 12, fill: "#d9d6ff" }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" stroke="#c4b5fd" tick={{ fontSize: 12, fill: "#d9d6ff" }} width={110} />
                  <Tooltip contentStyle={{ backgroundColor: "rgba(18, 4, 49, 0.92)", border: "1px solid rgba(168, 85, 247, 0.35)", color: "#ede9fe" }} />
                  <Bar dataKey="count" fill="#38bdf8" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">No operating system data available.</div>
            )}
          </div>
        </article>
        <article className="surface-panel rounded-2xl p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Clients by device</h3>
          <div className="mt-4 h-64">
            {displayClientBreakdown.devices?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displayClientBreakdown.devices} layout="vertical" margin={{ top: 10, right: 10, left: 40, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(139, 92, 246, 0.1)" />
                  <XAxis type="number" stroke="#c4b5fd" tick={{ fontSize: 12, fill: "#d9d6ff" }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" stroke="#c4b5fd" tick={{ fontSize: 12, fill: "#d9d6ff" }} width={90} />
                  <Tooltip contentStyle={{ backgroundColor: "rgba(18, 4, 49, 0.92)", border: "1px solid rgba(168, 85, 247, 0.35)", color: "#ede9fe" }} />
                  <Bar dataKey="count" fill="#f97316" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">No device data available.</div>
            )}
          </div>
        </article>
      </section>
    </MainLayout>
  );
}
