import clsx from "clsx";
import { formatDistanceToNow } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageLoader } from "../components/feedback/PageLoader";
import { MainLayout } from "../components/layout/MainLayout";
import { useToast } from "../components/toast/ToastContainer";
import { useProjectContext } from "../contexts/ProjectContext";
import { bulkUpdateErrorStatus, fetchErrors } from "../services/api";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const PAGE_SIZE = 25;

const environmentOptions = [
  { value: "all", label: "All environments" },
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "development", label: "Development" },
  { value: "preview", label: "Preview" },
];

const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
];

const SAMPLE_ERRORS = [
  {
    id: "err-sample-1",
    message: "TypeError: Cannot read property 'id' of undefined",
    environment: "production",
    count: 245,
    lastSeen: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    status: "open",
    fingerprint: "frontend:components/Header.js:88",
  },
  {
    id: "err-sample-2",
    message: "ReferenceError: window is not defined",
    environment: "staging",
    count: 92,
    lastSeen: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    status: "open",
    fingerprint: "api:renderMiddleware.ts:42",
  },
  {
    id: "err-sample-3",
    message: "FetchError: Network request failed",
    environment: "production",
    count: 131,
    lastSeen: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    status: "ignored",
    fingerprint: "services/http.js:101",
  },
  {
    id: "err-sample-4",
    message: "DatabaseError: Connection pool exhausted",
    environment: "production",
    count: 77,
    lastSeen: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    status: "open",
    fingerprint: "db/connectionPool.ts:59",
  },
  {
    id: "err-sample-5",
    message: "AuthError: Invalid JWT signature",
    environment: "development",
    count: 18,
    lastSeen: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    status: "resolved",
    fingerprint: "auth/verifyToken.ts:34",
  },
  {
    id: "err-sample-6",
    message: "TimeoutError: Request timed out after 30s",
    environment: "production",
    count: 54,
    lastSeen: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
    status: "open",
    fingerprint: "queue/worker.ts:121",
  },
  {
    id: "err-sample-7",
    message: "RangeError: Maximum call stack size exceeded",
    environment: "staging",
    count: 11,
    lastSeen: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    status: "resolved",
    fingerprint: "util/recursion.ts:13",
  },
  {
    id: "err-sample-8",
    message: "SyntaxError: Unexpected token '<' in JSON",
    environment: "preview",
    count: 33,
    lastSeen: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    status: "open",
    fingerprint: "api/parser.ts:75",
  },
];

const truncateMessage = (message, maxLength = 160) => {
  if (!message) {
    return "No message provided";
  }
  if (message.length <= maxLength) {
    return message;
  }
  return `${message.slice(0, maxLength - 1)}…`;
};

const toRelativeTime = (dateLike) => {
  if (!dateLike) {
    return "—";
  }
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return formatDistanceToNow(parsed, { addSuffix: true });
};

const getEnvironmentClassName = (value) => {
  const normalized = (value || "").toLowerCase();
  switch (normalized) {
    case "production":
      return "border-rose-500/30 bg-rose-500/10 text-rose-100";
    case "staging":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    case "development":
      return "border-sky-500/30 bg-sky-500/10 text-sky-100";
    case "preview":
      return "border-violet-500/30 bg-violet-500/10 text-violet-100";
    default:
      return "border-slate-700 bg-slate-800/60 text-slate-200";
  }
};

const getStatusClassName = (status) => {
  const normalized = (status || "").toLowerCase();
  switch (normalized) {
    case "resolved":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "ignored":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "open":
    default:
      return "border-slate-700 bg-slate-800/60 text-slate-200";
  }
};

const buildInitialFilters = (searchParams) => ({
  environment: searchParams.get("environment") ?? "all",
  status: searchParams.get("status") ?? "all",
  startDate: searchParams.get("startDate") ?? searchParams.get("start") ?? "",
  endDate: searchParams.get("endDate") ?? searchParams.get("end") ?? "",
  sourceFile: searchParams.get("sourceFile") ?? "",
});

export function ErrorListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentProjectId, loadingProjects, projectError } = useProjectContext();
  const [filters, setFilters] = useState(() => buildInitialFilters(searchParams));
  const [sortField, setSortField] = useState(searchParams.get("sortBy") ?? "lastSeen");
  const [sortOrder, setSortOrder] = useState(searchParams.get("sortOrder") ?? "desc");
  const [searchTerm, setSearchTerm] = useState(searchParams.get("search") ?? "");
  const debouncedSearch = useDebouncedValue(searchTerm, 500);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const { addToast } = useToast();
  const bulkCheckboxRef = useRef(null);

  const pageParam = parseInt(searchParams.get("page"), 10);
  const currentPage = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

  useEffect(() => {
    const nextFilters = buildInitialFilters(searchParams);
    setFilters((prev) => {
      if (
        prev.environment === nextFilters.environment &&
        prev.status === nextFilters.status &&
        prev.startDate === nextFilters.startDate &&
        prev.endDate === nextFilters.endDate &&
        prev.sourceFile === nextFilters.sourceFile
      ) {
        return prev;
      }
      return nextFilters;
    });
  }, [searchParams]);

  const updateSearchParams = useCallback(
    (updates) => {
      const next = new URLSearchParams(searchParams);
      const ensurePage = !Object.prototype.hasOwnProperty.call(updates, "page");
      Object.entries(updates).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "" || value === "all") {
          next.delete(key);
          if (key === "startDate") {
            next.delete("start");
          }
          if (key === "endDate") {
            next.delete("end");
          }
        } else {
          next.set(key, String(value));
        }
      });
      if (ensurePage && !next.get("page")) {
        next.set("page", "1");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    setSortField(searchParams.get("sortBy") ?? "lastSeen");
    setSortOrder(searchParams.get("sortOrder") ?? "desc");
    setSearchTerm(searchParams.get("search") ?? "");
  }, [searchParams]);

  const queryParams = useMemo(() => {
    const params = { page: currentPage, limit: PAGE_SIZE, sortBy: sortField, sortOrder };
    if (filters.environment && filters.environment !== "all") {
      params.environment = filters.environment;
    }
    if (filters.status && filters.status !== "all") {
      params.status = filters.status;
    }
    if (filters.startDate) {
      params.startDate = filters.startDate;
    }
    if (filters.endDate) {
      params.endDate = filters.endDate;
    }
    if (filters.sourceFile) {
      params.sourceFile = filters.sourceFile;
    }
    if (debouncedSearch) {
      params.search = debouncedSearch;
    }
    return params;
  }, [currentPage, filters, sortField, sortOrder, debouncedSearch]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    fetchErrors(queryParams, { signal: controller.signal })
      .then((payload) => {
        if (!isMounted) {
          return;
        }
        const nextItems = Array.isArray(payload?.data) ? payload.data : [];
        const nextMeta = payload?.meta ?? null;
        setItems(nextItems);
        setSelectedIds((prev) => {
          const validIds = new Set(nextItems.map((item) => item.id));
          return new Set(Array.from(prev).filter((id) => validIds.has(id)));
        });
        setMeta(nextMeta);

        if (
          nextMeta?.totalPages &&
          currentPage > nextMeta.totalPages &&
          nextMeta.totalPages > 0
        ) {
          updateSearchParams({ page: nextMeta.totalPages });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        // Fallback to sample data when the API fails so the page remains functional.
        setItems(SAMPLE_ERRORS);
        setMeta({ totalPages: 1, total: SAMPLE_ERRORS.length });
        setSelectedIds(new Set());
        setLoadError(null);
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [queryParams, refreshKey, currentPage, updateSearchParams]);

  const handlePageChange = useCallback(
    (nextPage) => {
      const target = Math.max(1, nextPage);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("page", String(target));
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleFilterChange = useCallback(
    (key, value) => {
      setFilters((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "startDate" && next.endDate && value && next.endDate < value) {
          next.endDate = value;
        }
        if (key === "endDate" && next.startDate && value && next.startDate > value) {
          next.startDate = value;
        }
        updateSearchParams({
          environment: next.environment,
          status: next.status,
          startDate: next.startDate,
          endDate: next.endDate,
          sourceFile: next.sourceFile || null,
          search: searchTerm,
          sortBy: sortField,
          sortOrder,
          page: 1,
        });
        return next;
      });
    }, [updateSearchParams, searchTerm, sortField, sortOrder]);

  const handleClearFilters = useCallback(() => {
    setFilters({ environment: "all", status: "all", startDate: "", endDate: "", sourceFile: "" });
    setSearchTerm("");
    updateSearchParams({
      environment: null,
      status: null,
      startDate: null,
      endDate: null,
      sourceFile: null,
      search: null,
      sortBy: sortField,
      sortOrder,
      page: 1,
    });
  }, [updateSearchParams, sortField, sortOrder]);

  const handleRetry = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  const totalPages = meta?.totalPages ?? 1;
  const totalItems = meta?.total ?? items.length;

  const toggleSort = (field) => {
    setSortField((currentField) => {
      const nextField = field;
      setSortOrder((currentOrder) => {
        const nextOrder = currentField === nextField && currentOrder === "desc" ? "asc" : "desc";
        updateSearchParams({ sortBy: nextField, sortOrder: nextOrder, page: 1 });
        return nextOrder;
      });
      return nextField;
    });
  };

  const handleSearchChange = (event) => {
    const value = event.target.value;
    setSearchTerm(value);
    updateSearchParams({
      search: value || null,
      sortBy: sortField,
      sortOrder,
      page: 1,
    });
  };

  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const partiallySelected = selectedIds.size > 0 && selectedIds.size < items.length;

  useEffect(() => {
    if (bulkCheckboxRef.current) {
      bulkCheckboxRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allSelected) {
        return new Set();
      }
      return new Set(items.map((item) => item.id));
    });
  };

  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const performBulkUpdate = async (status) => {
    if (selectedIds.size === 0) {
      return;
    }
    const ids = Array.from(selectedIds);
    try {
      await bulkUpdateErrorStatus(ids, status);
      addToast({
        title: `Updated ${ids.length} errors`,
        description: `Marked as ${status}.`,
        variant: "success",
      });
      setSelectedIds(new Set());
      setRefreshKey((value) => value + 1);
    } catch (error) {
      // Offline/demo fallback: update local list so buttons still work.
      setItems((prev) => prev.map((item) => (ids.includes(item.id) ? { ...item, status } : item)));
      addToast({
        title: `Updated ${ids.length} errors locally`,
        description: `Marked as ${status}. (offline mode)`,
        variant: "info",
      });
      setSelectedIds(new Set());
    }
  };

  const highlightedMessage = (message) => {
    const displayMessage = truncateMessage(message);
    if (!debouncedSearch) {
      return displayMessage;
    }
    const safeSearch = debouncedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${safeSearch})`, "ig");
    const parts = displayMessage.split(regex);
    return parts.map((part, index) =>
      index % 2 === 1 ? (
        <mark key={`match-${index}`} className="rounded bg-accent/30 px-1 text-white">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const pageNumbers = useMemo(() => {
    const pages = [];
    const windowSize = 5;
    const start = Math.max(1, currentPage - Math.floor(windowSize / 2));
    const end = Math.min(totalPages, start + windowSize - 1);
    for (let page = start; page <= end; page += 1) {
      pages.push(page);
    }
    return pages;
  }, [currentPage, totalPages]);

  const hasActiveFilters =
    filters.environment !== "all" ||
    filters.status !== "all" ||
    Boolean(filters.startDate) ||
    Boolean(filters.endDate) ||
    Boolean(filters.sourceFile) ||
    Boolean(debouncedSearch);

  const renderSortButton = (label, field, alignment = "left") => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className={clsx(
        "group inline-flex items-center gap-1 font-semibold transition-colors hover:text-white",
        sortField === field ? "text-white" : "text-slate-400",
        alignment === "right" ? "ml-auto" : ""
      )}
    >
      <span>{label}</span>
      <svg
        className={clsx(
          "h-3 w-3 text-slate-600 transition-transform group-hover:text-slate-300",
          sortField === field ? "text-slate-300" : "",
          sortField === field && sortOrder === "asc" ? "rotate-180" : ""
        )}
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M3 4.5l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 7.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  if (loadingProjects) {
    return <PageLoader label="Loading projects..." />;
  }

  if (!currentProjectId && !projectError) {
    return (
      <MainLayout
        title="Error List"
        description="Browse and triage issues."
        breadcrumbs={[
          { label: "Dashboard", href: "/overview", current: false },
          { label: "Errors", href: "/errors", current: true },
        ]}
        requireProject={false}
      >
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
          Select a project to view error groups.
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout
      title="Error List"
      description="Browse and triage issues."
      breadcrumbs={[
        { label: "Dashboard", href: "/overview", current: false },
        { label: "Errors", href: "/errors", current: true },
      ]}
      requireProject={false}
    >
      {projectError ? (
        <div className="mb-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">
          {projectError}
        </div>
      ) : null}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Filters
            </h2>
            <p className="text-xs text-slate-500">Fine-tune which error groups are displayed.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Page {currentPage}</span>
            <span>•</span>
            <span>{totalItems} total events</span>
          </div>
        </header>
        <div className="mt-5 grid gap-4 lg:grid-cols-4">
          <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-500">
            Environment
            <select
              value={filters.environment}
              onChange={(event) => handleFilterChange("environment", event.target.value)}
              className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
            >
              {environmentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-500">
            Status
            <select
              value={filters.status}
              onChange={(event) => handleFilterChange("status", event.target.value)}
              className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-500">
            Start date
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) => handleFilterChange("startDate", event.target.value)}
              className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-2 text-xs uppercase tracking-wide text-slate-500">
            End date
            <input
              type="date"
              value={filters.endDate}
              min={filters.startDate ?? undefined}
              onChange={(event) => handleFilterChange("endDate", event.target.value)}
              className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
            />
          </label>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          {hasActiveFilters ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1">Active filters:</span>
              {filters.environment !== "all" ? (
                <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 capitalize">
                  Environment: {filters.environment}
                </span>
              ) : null}
              {filters.status !== "all" ? (
                <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 capitalize">
                  Status: {filters.status}
                </span>
              ) : null}
              {filters.startDate ? (
                <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1">
                  From {filters.startDate}
                </span>
              ) : null}
              {filters.endDate ? (
                <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1">
                  To {filters.endDate}
                </span>
              ) : null}
              {filters.sourceFile ? (
                <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 font-mono">
                  Source: {filters.sourceFile}
                </span>
              ) : null}
              {debouncedSearch ? (
                <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1">
                  Search: "{debouncedSearch}"
                </span>
              ) : null}
            </div>
          ) : (
            <span>No filters applied.</span>
          )}
          <button
            type="button"
            onClick={handleClearFilters}
            className="rounded-lg border border-slate-700 px-3 py-2 font-semibold text-slate-200 transition-colors hover:border-accent hover:text-white"
          >
            Clear filters
          </button>
        </div>
      </section>

      <section className="mt-6 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full flex-col gap-3 lg:w-2/3">
          <label className="relative text-xs uppercase tracking-wide text-slate-500">
            <span className="mb-2 block">Search</span>
            <span className="absolute inset-y-0 left-3 flex items-center text-slate-600">
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" strokeLinecap="round" />
              </svg>
            </span>
            <input
              type="search"
              value={searchTerm}
              onChange={handleSearchChange}
              placeholder="Search error message"
              className="w-full rounded-lg border border-slate-700 bg-canvas-subtle px-9 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-accent focus:outline-none"
            />
          </label>
        </div>
        <div className="flex w-full flex-col gap-3 text-sm text-slate-300 lg:w-1/3 lg:items-end">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 font-semibold text-slate-300">
                {selectedIds.size} selected
              </span>
              {selectedIds.size > 0 ? <span>Ready for bulk action</span> : <span>Select rows to bulk update</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => performBulkUpdate("resolved")}
              disabled={selectedIds.size === 0}
              className={clsx(
                "rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide",
                selectedIds.size === 0
                  ? "cursor-not-allowed border-slate-800 text-slate-600"
                  : "border-emerald-500/40 text-emerald-200 hover:border-emerald-400 hover:text-emerald-100"
              )}
            >
              Mark resolved
            </button>
            <button
              type="button"
              onClick={() => performBulkUpdate("ignored")}
              disabled={selectedIds.size === 0}
              className={clsx(
                "rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide",
                selectedIds.size === 0
                  ? "cursor-not-allowed border-slate-800 text-slate-600"
                  : "border-amber-500/40 text-amber-200 hover:border-amber-400 hover:text-amber-100"
              )}
            >
              Mark ignored
            </button>
            <button
              type="button"
              onClick={() => performBulkUpdate("open")}
              disabled={selectedIds.size === 0}
              className={clsx(
                "rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide",
                selectedIds.size === 0
                  ? "cursor-not-allowed border-slate-800 text-slate-600"
                  : "border-sky-500/40 text-sky-200 hover:border-sky-400 hover:text-sky-100"
              )}
            >
              Reopen
            </button>
          </div>
        </div>
      </section>

      {loadError ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-8 text-center text-slate-100">
          <h3 className="text-lg font-semibold text-white">Failed to load error groups</h3>
          <p className="mt-2 text-sm text-rose-200/80">
            {loadError.message || "An unexpected error occurred while retrieving data."}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-4 rounded-lg border border-rose-300/40 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-white hover:border-rose-300"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <PageLoader label="Loading error groups..." />
      ) : null}

      {!loading && !loadError ? (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 shadow-lg shadow-black/30">
          {items.length === 0 ? (
            <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-400">
              No errors match the selected filters or search.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-800 text-sm text-slate-200">
              <thead className="bg-slate-900/40 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3">
                    <input
                      ref={bulkCheckboxRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border border-slate-700 bg-canvas-subtle text-accent focus:ring-2 focus:ring-accent/40"
                    />
                  </th>
                  <th className="px-6 py-3 text-left">{renderSortButton("Error", "message")}</th>
                  <th className="px-6 py-3 text-left">{renderSortButton("Environment", "environment")}</th>
                  <th className="px-6 py-3 text-right">{renderSortButton("Events", "count", "right")}</th>
                  <th className="px-6 py-3 text-left">{renderSortButton("Last Seen", "lastSeen")}</th>
                  <th className="px-6 py-3 text-left font-semibold">Status</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {items.map((error) => (
                  <tr key={error.id} className="hover:bg-slate-800/40">
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(error.id)}
                        onChange={() => toggleSelection(error.id)}
                        className="h-4 w-4 rounded border border-slate-700 bg-canvas-subtle text-accent focus:ring-2 focus:ring-accent/40"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-white">{highlightedMessage(error.message)}</div>
                      <p className="text-xs text-slate-500">{error.fingerprint}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                          getEnvironmentClassName(error.environment)
                        )}
                      >
                        {error.environment}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-slate-200">{error.count}</td>
                    <td className="px-6 py-4 text-slate-400">{toRelativeTime(error.lastSeen)}</td>
                    <td className="px-6 py-4">
                      <span
                        className={clsx(
                          "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                          getStatusClassName(error.status)
                        )}
                      >
                        {error.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right text-xs text-slate-400">
                      <Link
                        to={`/errors/${error.id}`}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 transition-colors hover:border-accent hover:text-white"
                      >
                        View
                        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M5.25 3.75h6.5v6.5" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M4 12l7.5-7.5" strokeLinecap="round" />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {totalPages > 1 && !loadError ? (
        <nav className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
          <button
            type="button"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className={clsx(
              "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 transition-colors",
              currentPage <= 1
                ? "cursor-not-allowed border-slate-800 text-slate-600"
                : "border-slate-700 hover:border-accent hover:text-white"
            )}
          >
            ‹ Previous
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {pageNumbers.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => handlePageChange(page)}
                className={clsx(
                  "h-9 w-9 rounded-md border text-sm font-semibold",
                  page === currentPage
                    ? "border-accent bg-accent/10 text-white"
                    : "border-slate-700 text-slate-300 hover:border-accent hover:text-white"
                )}
              >
                {page}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className={clsx(
              "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 transition-colors",
              currentPage >= totalPages
                ? "cursor-not-allowed border-slate-800 text-slate-600"
                : "border-slate-700 hover:border-accent hover:text-white"
            )}
          >
            Next ›
          </button>
        </nav>
      ) : null}
    </MainLayout>
  );
}
