import clsx from "clsx";
import { format, formatDistanceToNow, startOfHour } from "date-fns";
import { Highlight } from "prism-react-renderer";
import nightOwl from "../themes/nightOwl";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageLoader } from "../components/feedback/PageLoader";
import { MainLayout } from "../components/layout/MainLayout";
import { useToast } from "../components/toast/ToastContainer";
import { useProjectContext } from "../contexts/ProjectContext";
import {
  deleteError,
  fetchErrorDetail,
  fetchTeamMembers,
  updateErrorAssignment,
  updateErrorStatus,
} from "../services/api";

const STATUS_STYLES = {
  new: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  open: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  investigating: "border-purple-500/40 bg-purple-500/10 text-purple-200",
  resolved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  ignored: "border-slate-600/40 bg-slate-800 text-slate-300",
  muted: "border-slate-600/40 bg-slate-800 text-slate-300",
};

const ENVIRONMENT_COLORS = {
  production: "border-rose-500/40 bg-rose-600/10 text-rose-200",
  staging: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  development: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
};

const seededComments = [
  {
    id: "seed-1",
    author: "Alex (Platform)",
    message: "Investigating spike from checkout service after 09:00 UTC deploy.",
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: "seed-2",
    author: "Priya (QA)",
    message: "Able to reproduce when browser has cached feature flag FFG-112.",
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
];

const getStatusClassName = (status) =>
  STATUS_STYLES[status] || "border-slate-600/40 bg-slate-700/20 text-slate-200";

const getEnvironmentClassName = (environment) =>
  ENVIRONMENT_COLORS[environment] || "border-slate-700 bg-slate-800/40 text-slate-200";

const formatExactTimestamp = (value) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return format(date, "MMM d, yyyy • HH:mm:ss");
};

const stackToCode = (frames = [], message) => {
  if (!frames.length) {
    return message ? `${message}\n(No stack trace available)` : "(No stack trace available)";
  }
  return frames
    .map((frame) => frame.formatted || `${frame.function || frame.func || "<anonymous>"} (${frame.file || frame.filename || "unknown"}:${frame.line ?? frame.lineno ?? "?"})`)
    .join("\n");
};

const renderJSON = (value) => JSON.stringify(value ?? {}, null, 2);

const breadcrumbsForOccurrence = (occurrence) => {
  const crumbs = Array.isArray(occurrence?.metadata?.breadcrumbs)
    ? occurrence.metadata.breadcrumbs
    : [];
  return crumbs.slice(0, 3);
};

const getMemberLabel = (member) => {
  if (!member) {
    return "Unassigned";
  }
  return member.name || member.email || "Unnamed member";
};

const StackTraceViewer = ({ frames, message }) => {
  const code = stackToCode(frames, message);

  return (
    <Highlight theme={nightOwl} code={code} language="javascript">
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={clsx(
            className,
            "max-h-96 overflow-auto rounded-xl border border-slate-800 bg-[#011627] p-4 text-xs leading-relaxed"
          )}
          style={style}
        >
          {tokens.map((line, lineIndex) => (
            <div key={lineIndex} {...getLineProps({ line, key: lineIndex })}>
              <span className="mr-4 select-none text-slate-500">{String(lineIndex + 1).padStart(2, "0")}</span>
              {line.map((token, tokenIndex) => (
                <span key={tokenIndex} {...getTokenProps({ token, key: tokenIndex })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
};

export function ErrorDetailPage() {
  const { errorId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { currentProjectId, loadingProjects, projectError } = useProjectContext();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(true);
  const [assignmentUpdating, setAssignmentUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [comments, setComments] = useState(seededComments);
  const [newComment, setNewComment] = useState("");

  useEffect(() => {
    if (!errorId || loadingProjects || !currentProjectId) {
      setDetail(null);
      if (!loadingProjects) {
        setLoading(false);
      }
      return undefined;
    }

    let isMounted = true;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    fetchErrorDetail(errorId, { signal: controller.signal })
      .then((payload) => {
        if (!isMounted) {
          return;
        }
        setDetail(payload?.data ?? null);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setLoadError(error);
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
  }, [errorId, currentProjectId, loadingProjects]);

  useEffect(() => {
    if (loadingProjects || !currentProjectId) {
      setTeamMembers([]);
      setTeamMembersLoading(false);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();
    setTeamMembersLoading(true);

    fetchTeamMembers({}, { signal: controller.signal })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setTeamMembers(response?.data ?? []);
      })
      .catch((error) => {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        addToast({
          title: "Unable to load team",
          description: error.message || "Team roster failed to load.",
          variant: "error",
        });
      })
      .finally(() => {
        if (!cancelled) {
          setTeamMembersLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [addToast, currentProjectId, loadingProjects]);

  const breadcrumbItems = useMemo(
    () => [
      { label: "Dashboard", href: "/overview", current: false },
      { label: "Errors", href: "/errors", current: false },
      {
        label: detail?.message ? detail.message.slice(0, 48) : errorId || "Detail",
        href: errorId ? `/errors/${errorId}` : "/errors",
        current: true,
      },
    ],
    [detail?.message, errorId]
  );

  const occurrences = useMemo(() => detail?.occurrences ?? [], [detail?.occurrences]);

  const teamMemberIndex = useMemo(() => {
    const map = new Map();
    teamMembers.forEach((member) => {
      if (member?.id) {
        map.set(member.id, member);
      }
    });
    return map;
  }, [teamMembers]);

  const assignedMember = useMemo(() => {
    if (!detail?.assignedTo) {
      return null;
    }
    return teamMemberIndex.get(detail.assignedTo) || null;
  }, [detail?.assignedTo, teamMemberIndex]);

  const assignmentHistory = useMemo(() => {
    const history = Array.isArray(detail?.assignmentHistory) ? [...detail.assignmentHistory] : [];
    return history
      .map((entry) => ({
        memberId: entry?.memberId || null,
        assignedAt: entry?.assignedAt || null,
        unassignedAt: entry?.unassignedAt || null,
      }))
      .sort((a, b) => {
        const aTime = a.assignedAt ? new Date(a.assignedAt).getTime() : 0;
        const bTime = b.assignedAt ? new Date(b.assignedAt).getTime() : 0;
        return bTime - aTime;
      });
  }, [detail?.assignmentHistory]);

  const occurrenceChartData = useMemo(() => {
    const source = occurrences;
    if (!source.length) {
      return [];
    }

    const buckets = new Map();

    source.forEach((occurrence) => {
      const timestamp = new Date(occurrence.timestamp);
      if (Number.isNaN(timestamp.getTime())) {
        return;
      }
      const hourBucket = startOfHour(timestamp);
      const key = hourBucket.getTime();
      if (!buckets.has(key)) {
        buckets.set(key, { timestamp: hourBucket, count: 0 });
      }
      buckets.get(key).count += 1;
    });

    return Array.from(buckets.values())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .map((entry) => ({
        label: format(entry.timestamp, "MMM d HH:mm"),
        count: entry.count,
      }));
  }, [occurrences]);

  const handleStatusChange = async (status) => {
    if (!errorId) {
      return;
    }
    setStatusUpdating(true);
    try {
      const result = await updateErrorStatus(errorId, status);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              status: result?.data?.status ?? status,
              lastSeen: result?.data?.lastSeen ?? prev.lastSeen,
            }
          : prev
      );
      addToast({
        title: `Marked as ${status}`,
        description: "Status updated for this error group.",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Unable to update status",
        description: error.message || "Please retry in a moment.",
        variant: "error",
      });
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleAssignmentChange = async (event) => {
    if (!errorId) {
      return;
    }

    const selectedValue = event.target.value;
    const requestedMemberId = selectedValue === "" ? null : selectedValue;
    const currentAssigned = detail?.assignedTo || null;

    if (currentAssigned === requestedMemberId) {
      return;
    }

    setAssignmentUpdating(true);
    try {
      const result = await updateErrorAssignment(errorId, requestedMemberId === null ? undefined : requestedMemberId);
      const updatedAssignedTo = result?.data?.assignedTo ?? null;

      setDetail((prev) => {
        if (!prev) {
          return prev;
        }
        const nowIso = new Date().toISOString();
        const previousAssigned = prev.assignedTo || null;
        if (previousAssigned === updatedAssignedTo) {
          return { ...prev, assignedTo: updatedAssignedTo };
        }

        let nextHistory = Array.isArray(prev.assignmentHistory)
          ? prev.assignmentHistory.map((entry) => ({ ...entry }))
          : [];

        nextHistory = nextHistory.map((entry) => {
          if (!entry.unassignedAt && entry.memberId === previousAssigned) {
            return { ...entry, unassignedAt: nowIso };
          }
          return entry;
        });

        if (updatedAssignedTo) {
          nextHistory.push({ memberId: updatedAssignedTo, assignedAt: nowIso, unassignedAt: null });
        }

        return {
          ...prev,
          assignedTo: updatedAssignedTo,
          assignmentHistory: nextHistory,
        };
      });

      const assignedMemberRef = updatedAssignedTo ? teamMemberIndex.get(updatedAssignedTo) : null;
      const memberLabel = getMemberLabel(assignedMemberRef);

      addToast({
        title: updatedAssignedTo ? "Assignment updated" : "Assignment cleared",
        description: updatedAssignedTo
          ? `${memberLabel} now owns this error.`
          : "This error is back in the unassigned queue.",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Unable to update assignment",
        description: error.message || "Please try assigning again.",
        variant: "error",
      });
    } finally {
      setAssignmentUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!errorId) {
      return;
    }
    const confirmed = window.confirm("Delete this error group and all occurrences? This cannot be undone.");
    if (!confirmed) {
      return;
    }
    setDeleting(true);
    try {
      await deleteError(errorId);
      addToast({
        title: "Error deleted",
        description: "Removed from the project log.",
        variant: "success",
      });
      navigate("/errors", { replace: true });
    } catch (error) {
      addToast({
        title: "Delete failed",
        description: error.message || "Unable to remove this error.",
        variant: "error",
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!errorId) {
      return;
    }
    const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/errors/${errorId}` : `/errors/${errorId}`;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const helper = document.createElement("textarea");
        helper.value = shareUrl;
        helper.setAttribute("readonly", "");
        helper.style.position = "absolute";
        helper.style.left = "-9999px";
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        document.body.removeChild(helper);
      }
      addToast({
        title: "Link copied",
        description: "Shareable URL is now in your clipboard.",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Copy failed",
        description: error.message || "Copy the address bar manually.",
        variant: "error",
      });
    }
  };

  const handleExportJson = () => {
    if (!detail) {
      return;
    }
    try {
      const blob = new Blob([JSON.stringify(detail, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `error-${detail.id || errorId || "detail"}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      addToast({
        title: "Exported",
        description: "JSON snapshot downloaded.",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Export failed",
        description: error.message || "Could not export this error.",
        variant: "error",
      });
    }
  };

  const handleAddComment = (event) => {
    event.preventDefault();
    const value = newComment.trim();
    if (!value) {
      return;
    }
    const nextComment = {
      id: `local-${Date.now()}`,
      author: "You",
      message: value,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [nextComment, ...prev]);
    setNewComment("");
    addToast({
      title: "Comment added",
      description: "Shared with collaborators.",
      variant: "success",
    });
  };

  const detailReady = !loading && detail;

  if (loadingProjects) {
    return <PageLoader label="Loading projects..." />;
  }

  if (!currentProjectId && !projectError) {
    return (
      <MainLayout
        title="Error Detail"
        description="Investigate issue diagnostics across your selected project."
        breadcrumbs={breadcrumbItems}
        requireProject={false}
      >
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
          Choose a project to view error details.
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout
      title="Error Detail"
      description={detail?.message || `Investigate issue ${errorId ?? ""} with full diagnostic context.`}
      breadcrumbs={breadcrumbItems}
      requireProject={false}
    >
      {projectError ? (
        <div className="mb-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">
          {projectError}
        </div>
      ) : null}
      {loading ? <PageLoader label="Loading error details..." /> : null}

      {loadError ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-8 text-center text-slate-100">
          <h3 className="text-lg font-semibold text-white">Failed to load error detail</h3>
          <p className="mt-3 text-sm text-rose-200/80">
            {loadError.message || "An unexpected error occurred while retrieving this error."}
          </p>
        </div>
      ) : null}

      {detailReady ? (
        <section className="grid gap-6 lg:grid-cols-3">
          <article className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">Fingerprint</p>
                <h3 className="text-lg font-semibold text-white break-all">{detail.fingerprint}</h3>
                <p className="text-sm text-slate-400">{detail.message}</p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleStatusChange("resolved")}
                  disabled={statusUpdating}
                  className={clsx(
                    "rounded-md border px-3 py-2 font-semibold uppercase tracking-wide",
                    statusUpdating
                      ? "cursor-not-allowed border-slate-700 text-slate-600"
                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400"
                  )}
                >
                  Resolve
                </button>
                <button
                  type="button"
                  onClick={() => handleStatusChange("ignored")}
                  disabled={statusUpdating}
                  className={clsx(
                    "rounded-md border px-3 py-2 font-semibold uppercase tracking-wide",
                    statusUpdating
                      ? "cursor-not-allowed border-slate-700 text-slate-600"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-100 hover:border-amber-400"
                  )}
                >
                  Ignore
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className={clsx(
                    "rounded-md border px-3 py-2 font-semibold uppercase tracking-wide",
                    deleting
                      ? "cursor-not-allowed border-rose-800 text-rose-700"
                      : "border-rose-500/40 bg-rose-500/10 text-rose-200 hover:border-rose-400"
                  )}
                >
                  Delete
                </button>
              </div>
            </header>

            <div className="mt-6 grid gap-4 text-sm text-slate-300 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-slate-500">Status</p>
                <span
                  className={clsx(
                    "mt-1 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                    getStatusClassName(detail.status)
                  )}
                >
                  {detail.status}
                </span>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Environment</p>
                <span
                  className={clsx(
                    "mt-1 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize",
                    getEnvironmentClassName(detail.environment)
                  )}
                >
                  {detail.environment}
                </span>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Events</p>
                <p className="text-base font-semibold text-white">{detail.count}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">First seen</p>
                <p className="text-base font-semibold text-white">{formatExactTimestamp(detail.firstSeen)}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-slate-500">Last seen</p>
                <p className="text-base font-semibold text-white">{formatExactTimestamp(detail.lastSeen)}</p>
              </div>
            </div>

            <section className="mt-8 space-y-4">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stack trace</h4>
                <div className="mt-3">
                  <StackTraceViewer frames={detail.stackTraceHighlighted} message={detail.message} />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Occurrence frequency</h4>
                    <p className="text-xs text-slate-500">
                      Spot spikes and repeated failure windows over the recent sample ({occurrences.length} of {detail.occurrencesTotal} events).
                    </p>
                  </div>
                </header>
                <div className="mt-4 h-64">
                  {occurrenceChartData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={occurrenceChartData} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="occurrenceGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                        <XAxis dataKey="label" stroke="#94a3b8" minTickGap={24} tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} stroke="#94a3b8" tick={{ fontSize: 10 }} width={32} />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #1e293b" }}
                          labelStyle={{ color: "#e2e8f0" }}
                          cursor={{ stroke: "#38bdf8", strokeDasharray: "3 3" }}
                        />
                        <Area type="monotone" dataKey="count" stroke="#38bdf8" fill="url(#occurrenceGradient)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">
                      No recent occurrences to chart.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
                <header className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Occurrence timeline</h4>
                    <p className="text-xs text-slate-500">Dive into who experienced the error and what happened around it.</p>
                  </div>
                </header>
                <ul className="mt-5 space-y-6">
                  {occurrences.map((occurrence) => {
                    const userEmail =
                      occurrence.userContext?.email || occurrence.userContext?.id || occurrence.userContext?.username;
                    const breadcrumbs = breadcrumbsForOccurrence(occurrence);
                    const metadataMessage = occurrence.metadata?.message;
                    const displayMessage =
                      typeof metadataMessage === "string"
                        ? metadataMessage
                        : metadataMessage
                        ? renderJSON(metadataMessage)
                        : "No metadata message provided.";
                    return (
                      <li key={occurrence.id} className="relative border-l border-slate-800 pl-6">
                        <span className="absolute -left-[7px] top-1 inline-flex h-3 w-3 rounded-full border border-accent bg-accent/40" />
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-slate-300">{formatExactTimestamp(occurrence.timestamp)}</span>
                          <span>•</span>
                          <span>{formatDistanceToNow(new Date(occurrence.timestamp), { addSuffix: true })}</span>
                          {userEmail ? (
                            <>
                              <span>•</span>
                              <span className="text-slate-300">{userEmail}</span>
                            </>
                          ) : null}
                          <span>•</span>
                          <span className={clsx(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
                            getEnvironmentClassName(occurrence.environment)
                          )}>
                            {occurrence.environment}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{displayMessage}</div>
                        {breadcrumbs.length ? (
                          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
                            <p className="mb-2 font-semibold uppercase tracking-wide text-slate-500">Breadcrumbs</p>
                            <ul className="space-y-1">
                              {breadcrumbs.map((crumb, index) => (
                                <li key={`${occurrence.id}-crumb-${index}`}>{typeof crumb === "string" ? crumb : renderJSON(crumb)}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                  {!occurrences.length ? (
                    <li className="text-sm text-slate-500">No recent occurrences recorded.</li>
                  ) : null}
                </ul>
              </div>
            </section>
          </article>

          <aside className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Assignment</h3>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                {teamMembersLoading ? (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
                    Loading team roster…
                  </div>
                ) : teamMembers.length ? (
                  <>
                    <label className="block text-xs uppercase text-slate-500" htmlFor="assignment-select">
                      Assign to responder
                    </label>
                    <select
                      id="assignment-select"
                      value={detail?.assignedTo || ""}
                      onChange={handleAssignmentChange}
                      disabled={assignmentUpdating}
                      className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">Unassigned</option>
                      {teamMembers.map((member) => (
                        <option key={member.id} value={member.id}>
                          {getMemberLabel(member)}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-500">
                      {assignmentUpdating
                        ? "Updating assignment…"
                        : assignedMember
                        ? `${getMemberLabel(assignedMember)} currently owns this issue.`
                        : "This error is unassigned."}
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate("/team")}
                      className="inline-flex items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-accent hover:text-white"
                    >
                      Manage team roster
                    </button>
                  </>
                ) : (
                  <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
                    <p className="font-medium text-slate-100">No active team members yet.</p>
                    <p className="text-xs text-slate-500">Add responders so incidents can be assigned directly from this page.</p>
                    <button
                      type="button"
                      onClick={() => navigate("/team")}
                      className="inline-flex items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-accent hover:text-white"
                    >
                      Create team member
                    </button>
                  </div>
                )}
              </div>

              {assignmentHistory.length ? (
                <div className="mt-6">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent ownership</h4>
                  <ul className="mt-3 space-y-2 text-xs text-slate-400">
                    {assignmentHistory.slice(0, 5).map((entry, index) => {
                      const entryMember = entry.memberId ? teamMemberIndex.get(entry.memberId) : null;
                      const label = entry.memberId ? getMemberLabel(entryMember) : "Unassigned";
                      const assignedAtDate = entry.assignedAt ? new Date(entry.assignedAt) : null;
                      const unassignedAtDate = entry.unassignedAt ? new Date(entry.unassignedAt) : null;
                      const assignedRelative = assignedAtDate && !Number.isNaN(assignedAtDate.getTime())
                        ? formatDistanceToNow(assignedAtDate, { addSuffix: true })
                        : null;
                      const unassignedRelative = unassignedAtDate && !Number.isNaN(unassignedAtDate.getTime())
                        ? formatDistanceToNow(unassignedAtDate, { addSuffix: true })
                        : null;

                      return (
                        <li
                          key={`${entry.memberId || "unassigned"}-${index}-${entry.assignedAt || "na"}`}
                          className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                        >
                          <div className="flex items-center justify-between text-slate-300">
                            <span className="font-semibold text-slate-100">{label}</span>
                            <span>{assignedRelative || "—"}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Assigned {formatExactTimestamp(entry.assignedAt)}
                            {unassignedRelative ? ` • Released ${unassignedRelative}` : " • Active owner"}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="mt-8">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Context</h3>
              <dl className="mt-4 space-y-3 text-sm text-slate-300">
                <div>
                  <dt className="text-xs uppercase text-slate-500">Project scope</dt>
                  <dd className="font-medium text-white">{detail.environment?.toUpperCase?.() || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">Occurrences sampled</dt>
                  <dd className="font-medium text-white">{occurrences.length} / {detail.occurrencesTotal}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">User context</dt>
                  <dd>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs leading-relaxed text-slate-300">
                      {renderJSON(detail.userContext)}
                    </pre>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase text-slate-500">Metadata</dt>
                  <dd>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs leading-relaxed text-slate-300">
                      {renderJSON(detail.metadata)}
                    </pre>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="mt-8 space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Share</h3>
              <div className="flex flex-col gap-2 text-sm">
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="rounded-lg border border-slate-700 px-3 py-2 font-semibold text-slate-200 transition-colors hover:border-accent hover:text-white"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="rounded-lg border border-slate-700 px-3 py-2 font-semibold text-slate-200 transition-colors hover:border-accent hover:text-white"
                >
                  Export JSON
                </button>
              </div>
            </section>

            <section className="mt-8">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Team comments</h3>
              <form onSubmit={handleAddComment} className="mt-4 space-y-3">
                <textarea
                  value={newComment}
                  onChange={(event) => setNewComment(event.target.value)}
                  placeholder="Share an insight or update for your team"
                  rows={3}
                  className="w-full rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-accent focus:outline-none"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="rounded-lg border border-accent/60 bg-accent/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition-colors hover:bg-accent/20"
                  >
                    Post comment
                  </button>
                </div>
              </form>
              <ul className="mt-5 space-y-4">
                {comments.map((comment) => (
                  <li key={comment.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-300">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-slate-300">{comment.author}</span>
                      <span>{formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-line text-sm text-slate-200">{comment.message}</p>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </section>
      ) : null}
    </MainLayout>
  );
}
