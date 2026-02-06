import { useCallback, useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { MainLayout } from "../components/layout/MainLayout";
import { PageLoader } from "../components/feedback/PageLoader";
import { useToast } from "../components/toast/ToastContainer";
import {
  createReportSchedule,
  deleteReportSchedule,
  deleteReportRun,
  fetchReportRuns,
  fetchReportSchedules,
  runReportScheduleNow,
  updateReportSchedule,
  createReportShare,
  downloadReportRun,
  requestReportGeneration,
} from "../services/api";

const FREQUENCY_OPTIONS = [
  { value: "weekly", label: "Weekly", description: "Send on a specific weekday each week." },
  { value: "monthly", label: "Monthly", description: "Send on a specific day each month." },
];

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

const RANGE_PRESETS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const FORMAT_OPTIONS = [
  { value: "pdf", label: "PDF" },
  { value: "xlsx", label: "Spreadsheet" },
];

const DEFAULT_FORM = Object.freeze({
  name: "Weekly health report",
  frequency: "weekly",
  dayOfWeek: 1,
  dayOfMonth: 1,
  runAtUTC: "09:00",
  format: "pdf",
  rangePreset: "7d",
  includeRecommendations: true,
  environment: "",
  recipients: "",
});

const RUN_STATUS_STYLES = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  failed: "border-rose-500/40 bg-rose-500/10 text-rose-200",
};

const SAMPLE_SCHEDULES = [
  {
    id: "sched-sample-1",
    name: "Weekly health report",
    frequency: "weekly",
    dayOfWeek: 1,
    runAtUTC: "09:00",
    format: "pdf",
    parameters: { range: { preset: "7d" }, environment: "production" },
    recipients: ["product@example.com", "qa@example.com"],
    includeRecommendations: true,
    active: true,
    nextRunAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    lastRunAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "sched-sample-2",
    name: "Monthly stability digest",
    frequency: "monthly",
    dayOfMonth: 1,
    runAtUTC: "14:30",
    format: "xlsx",
    parameters: { range: { preset: "30d" }, environment: "staging" },
    recipients: ["eng-leads@example.com"],
    includeRecommendations: false,
    active: false,
    nextRunAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    lastRunAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    lastErrorMessage: "SMTP connection timed out on last attempt.",
  },
];

const SAMPLE_RUNS = [
  {
    id: "run-sample-1",
    scheduleId: "sched-sample-1",
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    status: "success",
    format: "pdf",
    fileSize: 1_048_576,
    summary: { range: { label: "Last 7 days" }, quickInsights: ["Errors down 8% week over week", "No new critical issues detected"] },
    recommendations: ["Rotate API keys weekly", "Add alert on 5xx spikes"],
  },
  {
    id: "run-sample-2",
    scheduleId: "sched-sample-2",
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    status: "failed",
    error: "Data warehouse unavailable during export window",
    format: "xlsx",
    fileSize: 0,
    summary: { range: { label: "Last 30 days" } },
    recommendations: [],
  },
];

const formatFileSize = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const toOrdinal = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  const tens = number % 100;
  if (tens >= 11 && tens <= 13) {
    return `${number}th`;
  }
  switch (number % 10) {
    case 1:
      return `${number}st`;
    case 2:
      return `${number}nd`;
    case 3:
      return `${number}rd`;
    default:
      return `${number}th`;
  }
};

const formatDateTimeUTC = (value) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${format(date, "MMM d, yyyy • HH:mm")} UTC`;
};

const relativeTime = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return formatDistanceToNow(date, { addSuffix: true });
};

const describeRange = (schedule) => {
  const preset = schedule?.parameters?.range?.preset;
  const option = RANGE_PRESETS.find((item) => item.value === preset);
  return option ? option.label : "Custom range";
};

const describeRecipients = (schedule) => {
  const recipients = Array.isArray(schedule?.recipients) ? schedule.recipients : [];
  if (!recipients.length) {
    return "No recipients configured";
  }
  if (recipients.length === 1) {
    return recipients[0];
  }
  return `${recipients[0]} +${recipients.length - 1}`;
};

const getScheduleId = (schedule) => (schedule?._id ? String(schedule._id) : schedule?.id ? String(schedule.id) : null);

export function ReportsPage() {
  const { addToast } = useToast();
  const [form, setForm] = useState(() => ({ ...DEFAULT_FORM }));
  const [schedules, setSchedules] = useState([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [creatingSchedule, setCreatingSchedule] = useState(false);
  const [busyScheduleId, setBusyScheduleId] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runsMeta, setRunsMeta] = useState(null);
  const [runsLoading, setRunsLoading] = useState(true);
  const [generatingRun, setGeneratingRun] = useState(false);
  const [busyRunId, setBusyRunId] = useState(null);
  const [shareInfo, setShareInfo] = useState(null);

  const loadSchedules = useCallback(
    async (options = {}) => {
      const silent = Boolean(options.silent);
      if (!silent) {
        setSchedulesLoading(true);
      }
      try {
        const response = await fetchReportSchedules();
        setSchedules(response?.data ?? []);
      } catch (error) {
        setSchedules(SAMPLE_SCHEDULES);
      } finally {
        if (!silent) {
          setSchedulesLoading(false);
        }
      }
    },
    [addToast]
  );

  const loadRuns = useCallback(
    async (options = {}) => {
      const silent = Boolean(options.silent);
      if (!silent) {
        setRunsLoading(true);
      }
      try {
        const response = await fetchReportRuns();
        setRuns(response?.data ?? []);
        setRunsMeta(response?.meta ?? null);
      } catch (error) {
        setRuns(SAMPLE_RUNS);
        setRunsMeta({ total: SAMPLE_RUNS.length });
      } finally {
        if (!silent) {
          setRunsLoading(false);
        }
      }
    },
    [addToast]
  );

  useEffect(() => {
    loadSchedules();
    loadRuns();
  }, [loadSchedules, loadRuns]);

  const scheduleCount = schedules.length;

  const resetForm = () => {
    setForm({ ...DEFAULT_FORM });
  };

  const handleFormChange = (event) => {
    const { name, type, checked, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleFrequencySelect = (value) => {
    setForm((prev) => ({
      ...prev,
      frequency: value,
    }));
  };

  const parsedRecipients = useMemo(() => {
    if (!form.recipients) {
      return [];
    }
    return form.recipients
      .split(/[,\n]/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length && entry.includes("@"));
  }, [form.recipients]);

  const buildShareUrl = useCallback((path) => {
    if (!path) {
      return null;
    }
    if (typeof window !== "undefined") {
      return `${window.location.origin}${path}`;
    }
    return path;
  }, []);

  const handleCreateSchedule = async (event) => {
    event.preventDefault();
    setCreatingSchedule(true);
    const payload = {
      name: form.name.trim() || DEFAULT_FORM.name,
      frequency: form.frequency,
      runAtUTC: form.runAtUTC,
      format: form.format,
      timezone: "UTC",
      parameters: {
        range: {
          preset: form.rangePreset,
        },
        includeRecommendations: form.includeRecommendations,
        environment: form.environment?.trim() || null,
      },
      recipients: parsedRecipients,
      active: true,
    };

    if (form.frequency === "weekly") {
      payload.dayOfWeek = Number(form.dayOfWeek);
    } else if (form.frequency === "monthly") {
      payload.dayOfMonth = Number(form.dayOfMonth);
    }

    try {
      const response = await createReportSchedule(payload);
      const created = response?.data;
      if (created) {
        const createdId = getScheduleId(created);
        setSchedules((prev) => [
          created,
          ...prev.filter((schedule) => getScheduleId(schedule) !== createdId),
        ]);
        addToast({
          title: "Schedule created",
          description: `${created.name} will send ${describeRange(created).toLowerCase()} reports at ${created.runAtUTC} UTC.`,
          variant: "success",
        });
        resetForm();
      } else {
        await loadSchedules({ silent: true });
      }
    } catch (error) {
      const fallbackId = `sample-schedule-${Date.now()}`;
      const fallback = {
        id: fallbackId,
        name: payload.name,
        frequency: payload.frequency,
        dayOfWeek: payload.dayOfWeek,
        dayOfMonth: payload.dayOfMonth,
        runAtUTC: payload.runAtUTC,
        format: payload.format,
        parameters: payload.parameters,
        recipients: payload.recipients,
        includeRecommendations: payload.parameters.includeRecommendations,
        active: true,
        nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        lastRunAt: new Date().toISOString(),
      };
      setSchedules((prev) => [fallback, ...prev]);
      addToast({
        title: "Schedule saved offline",
        description: "Using sample schedule locally (API unavailable).",
        variant: "info",
      });
    } finally {
      setCreatingSchedule(false);
    }
  };

  const handleGenerateReport = async () => {
    setGeneratingRun(true);
    try {
      const response = await requestReportGeneration({
        format: form.format,
        range: form.rangePreset,
        environment: form.environment?.trim() || null,
        includeRecommendations: form.includeRecommendations,
      });
      const created = response?.data;
      if (created) {
        addToast({
          title: "Report is ready",
          description: `${created.summary?.range?.label || "Selected range"} exported as ${created.format?.toUpperCase?.() || "PDF"}.`,
          variant: "success",
        });
        await loadRuns({ silent: true });
      } else {
        await loadRuns({ silent: true });
      }
    } catch (error) {
      const rangeLabel = RANGE_PRESETS.find((item) => item.value === form.rangePreset)?.label || "Selected range";
      const fallbackRun = {
        id: `sample-run-${Date.now()}`,
        createdAt: new Date().toISOString(),
        status: "success",
        format: form.format,
        fileSize: 768_000,
        summary: { range: { label: rangeLabel }, quickInsights: ["Sample export generated offline."] },
        recommendations: form.includeRecommendations ? ["Automated remediation guidance"] : [],
      };
      setRuns((prev) => [fallbackRun, ...prev]);
      setRunsMeta((prev) => ({ total: (prev?.total ?? prev?.length ?? 0) + 1 }));
      addToast({
        title: "Report generated offline",
        description: "Added a sample export because the API is unavailable.",
        variant: "info",
      });
    } finally {
      setGeneratingRun(false);
    }
  };

  const toggleScheduleActive = async (schedule) => {
    const scheduleId = getScheduleId(schedule);
    if (!scheduleId) {
      return;
    }
    setBusyScheduleId(scheduleId);
    try {
      const response = await updateReportSchedule(scheduleId, { active: !schedule.active });
      const updated = response?.data;
      if (updated) {
        const updatedId = getScheduleId(updated);
        setSchedules((prev) => prev.map((item) => (getScheduleId(item) === updatedId ? updated : item)));
        addToast({
          title: updated.active ? "Schedule enabled" : "Schedule paused",
          description: `${updated.name} is now ${updated.active ? "active" : "paused"}.`,
          variant: "success",
        });
      } else {
        await loadSchedules({ silent: true });
      }
    } catch (error) {
      addToast({
        title: "Unable to update schedule",
        description: error.message || "Please try again in a moment.",
        variant: "error",
      });
    } finally {
      setBusyScheduleId(null);
    }
  };

  const handleRunNow = async (schedule) => {
    const scheduleId = getScheduleId(schedule);
    if (!scheduleId) {
      return;
    }
    setBusyScheduleId(scheduleId);
    try {
      await runReportScheduleNow(scheduleId);
      addToast({
        title: "Report queued",
        description: `${schedule.name} will generate shortly.`,
        variant: "success",
      });
      await loadSchedules({ silent: true });
    } catch (error) {
      addToast({
        title: "Unable to run schedule",
        description: error.message || "Try again in a moment.",
        variant: "error",
      });
    } finally {
      setBusyScheduleId(null);
    }
  };

  const handleDeleteSchedule = async (schedule) => {
    const scheduleId = getScheduleId(schedule);
    if (!scheduleId) {
      return;
    }
    const confirmed = window.confirm(`Delete the "${schedule.name}" schedule?`);
    if (!confirmed) {
      return;
    }
    setBusyScheduleId(scheduleId);
    try {
      await deleteReportSchedule(scheduleId);
      setSchedules((prev) => prev.filter((item) => getScheduleId(item) !== scheduleId));
      addToast({
        title: "Schedule removed",
        description: `${schedule.name} will no longer run automatically.`,
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Unable to delete schedule",
        description: error.message || "Please retry in a moment.",
        variant: "error",
      });
    } finally {
      setBusyScheduleId(null);
    }
  };

  const handleDeleteRun = async (run) => {
    const runId = getScheduleId(run);
    if (!runId) {
      return;
    }
    const confirmed = window.confirm("Delete this report export? The file will be removed.");
    if (!confirmed) {
      return;
    }
    setBusyRunId(runId);
    try {
      await deleteReportRun(runId);
      setRuns((prev) => prev.filter((item) => getScheduleId(item) !== runId));
      if (shareInfo?.runId === runId) {
        setShareInfo(null);
      }
      addToast({
        title: "Report deleted",
        description: "The export and file have been removed.",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Unable to delete report",
        description: error.message || "Please retry shortly.",
        variant: "error",
      });
    } finally {
      setBusyRunId(null);
    }
  };

  const handleShareRun = async (run) => {
    const runId = getScheduleId(run);
    if (!runId) {
      return;
    }
    setBusyRunId(runId);
    try {
      const response = await createReportShare(runId, {});
      const share = response?.data;
      if (share) {
        const url = buildShareUrl(share.path);
        setShareInfo({
          runId,
          url,
          expiresAt: share.expiresAt,
        });
        addToast({
          title: "Share link created",
          description: "Copy the link below to share this report.",
          variant: "success",
        });
      }
    } catch (error) {
      addToast({
        title: "Unable to create share link",
        description: error.message || "Please try again shortly.",
        variant: "error",
      });
    } finally {
      setBusyRunId(null);
    }
  };

  const handleDownloadRun = async (run) => {
    const runId = getScheduleId(run);
    if (!runId) {
      return;
    }
    setBusyRunId(runId);
    try {
      const response = await downloadReportRun(runId);
      const blob = new Blob([response.data], {
        type: response.headers?.["content-type"] || "application/octet-stream",
      });
      let filename = `report-${runId}.${run.format === "xlsx" ? "xlsx" : "pdf"}`;
      const disposition = response.headers?.["content-disposition"];
      if (disposition) {
        const match = disposition.match(/filename="?([^";]+)"?/i);
        if (match && match[1]) {
          filename = match[1];
        }
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      addToast({
        title: "Download started",
        description: filename,
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Unable to download",
        description: error.message || "Try again in a moment.",
        variant: "error",
      });
    } finally {
      setBusyRunId(null);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareInfo?.url) {
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareInfo.url);
      } else {
        const helper = document.createElement("textarea");
        helper.value = shareInfo.url;
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
        description: "Share URL copied to clipboard.",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Copy failed",
        description: error.message || "Copy the link manually.",
        variant: "error",
      });
    }
  };

  return (
    <MainLayout
      title="Reports"
      description=""
      breadcrumbs={[
        { label: "Dashboard", href: "/overview", current: false },
        { label: "Reports", href: "/reports", current: true },
      ]}
    >
      {shareInfo?.url ? (
        <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 p-6 text-sm text-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-sky-200">Share link ready</h2>
              <p className="mt-1 text-xs text-slate-200/80">
                Expires {shareInfo.expiresAt ? `${formatDateTimeUTC(shareInfo.expiresAt)} (${relativeTime(shareInfo.expiresAt)})` : "soon"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShareInfo(null)}
              className="text-xs uppercase tracking-wide text-slate-300 hover:text-white"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
            <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-lg border border-sky-500/40 bg-slate-900/60 px-3 py-2 font-mono text-xs text-sky-100">
              {shareInfo.url}
            </code>
            <button
              type="button"
              onClick={handleCopyShareLink}
              className="rounded-lg border border-sky-500/60 bg-sky-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-sky-100 transition hover:border-sky-400"
            >
              Copy link
            </button>
          </div>
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <header className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">New schedule</h2>
              <p className="mt-1 text-sm text-slate-400">Choose cadence, recipients, and coverage window.</p>
            </div>
            <span className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400">UTC timezone</span>
          </header>
          <form onSubmit={handleCreateSchedule} className="mt-5 space-y-4 text-sm">
            <label className="block">
              <span className="text-xs uppercase text-slate-500">Schedule name</span>
              <input
                name="name"
                value={form.name}
                onChange={handleFormChange}
                placeholder="e.g. Monday health digest"
                className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
              />
            </label>

            <div>
              <span className="text-xs uppercase text-slate-500">Cadence</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {FREQUENCY_OPTIONS.map((option) => {
                  const active = form.frequency === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleFrequencySelect(option.value)}
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        active
                          ? "border-accent bg-accent/10 text-slate-100"
                          : "border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="mt-1 block text-xs text-slate-400">{option.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {form.frequency === "weekly" ? (
              <label className="block">
                <span className="text-xs uppercase text-slate-500">Send on</span>
                <select
                  name="dayOfWeek"
                  value={form.dayOfWeek}
                  onChange={handleFormChange}
                  className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
                >
                  {WEEKDAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {form.frequency === "monthly" ? (
              <label className="block">
                <span className="text-xs uppercase text-slate-500">Send on</span>
                <input
                  type="number"
                  name="dayOfMonth"
                  min={1}
                  max={31}
                  value={form.dayOfMonth}
                  onChange={handleFormChange}
                  className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
                />
                <span className="mt-1 block text-xs text-slate-500">{toOrdinal(form.dayOfMonth)} day of each month</span>
              </label>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs uppercase text-slate-500">Send at (UTC)</span>
                <input
                  name="runAtUTC"
                  value={form.runAtUTC}
                  onChange={handleFormChange}
                  placeholder="09:00"
                  className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase text-slate-500">Report format</span>
                <select
                  name="format"
                  value={form.format}
                  onChange={handleFormChange}
                  className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
                >
                  {FORMAT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="text-xs uppercase text-slate-500">Coverage window</span>
              <select
                name="rangePreset"
                value={form.rangePreset}
                onChange={handleFormChange}
                className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
              >
                {RANGE_PRESETS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name="includeRecommendations"
                checked={form.includeRecommendations}
                onChange={handleFormChange}
                className="h-4 w-4 rounded border-slate-700 bg-canvas-subtle"
              />
              <span className="text-xs text-slate-400">Include remediation recommendations</span>
            </label>

            <label className="block">
              <span className="text-xs uppercase text-slate-500">Environment filter</span>
              <input
                name="environment"
                value={form.environment}
                onChange={handleFormChange}
                placeholder="Optional (e.g. production)"
                className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase text-slate-500">Recipients</span>
              <textarea
                name="recipients"
                value={form.recipients}
                onChange={handleFormChange}
                placeholder="Comma or newline separated emails"
                rows={3}
                className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none"
              />
              <span className="mt-1 block text-xs text-slate-500">
                {parsedRecipients.length ? `${parsedRecipients.length} recipient${parsedRecipients.length === 1 ? "" : "s"} will receive each report.` : "Add at least one email to deliver via inbox."}
              </span>
            </label>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={handleGenerateReport}
                disabled={generatingRun}
                className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-200 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generatingRun ? "Generating…" : "Generate once"}
              </button>
              <button
                type="submit"
                disabled={creatingSchedule}
                className="rounded-lg border border-accent/60 bg-accent/10 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingSchedule ? "Creating…" : "Create schedule"}
              </button>
            </div>
          </form>
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Schedule overview</h2>
              <p className="mt-1 text-sm text-slate-400">Monitor upcoming runs and delivery status.</p>
            </div>
            <span className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400">
              {scheduleCount === 1 ? "1 active schedule" : `${scheduleCount} schedules`}
            </span>
          </header>
          <div className="mt-5 space-y-4 text-sm text-slate-300">
            {schedulesLoading ? (
              <PageLoader label="Retrieving schedules..." />
            ) : scheduleCount ? (
              schedules.map((schedule) => {
                const scheduleId = getScheduleId(schedule) || schedule.name;
                const nextRunRelative = relativeTime(schedule.nextRunAt);
                return (
                  <div
                    key={scheduleId}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition hover:border-accent/40"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-white">{schedule.name}</h3>
                        <p className="mt-1 text-xs text-slate-400">
                          {schedule.frequency === "weekly"
                            ? `Weekly on ${WEEKDAY_OPTIONS.find((option) => option.value === schedule.dayOfWeek)?.label || "selected day"}`
                            : schedule.frequency === "monthly"
                            ? `Monthly on the ${toOrdinal(schedule.dayOfMonth || 1)}`
                            : "Custom schedule"}
                          {` • ${schedule.runAtUTC} UTC`}
                        </p>
                      </div>
                      <span
                        className={`mt-1 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                          schedule.active
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                            : "border-slate-700 bg-slate-900 text-slate-400"
                        }`}
                      >
                        {schedule.active ? "Active" : "Paused"}
                      </span>
                    </div>

                    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <dt className="text-[11px] uppercase text-slate-500">Next run</dt>
                        <dd className="mt-1 text-sm text-slate-200">
                          {formatDateTimeUTC(schedule.nextRunAt)}
                          {nextRunRelative ? <span className="ml-2 text-xs text-slate-500">({nextRunRelative})</span> : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase text-slate-500">Last run</dt>
                        <dd className="mt-1 text-sm text-slate-200">{formatDateTimeUTC(schedule.lastRunAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase text-slate-500">Coverage</dt>
                        <dd className="mt-1 text-sm text-slate-200">{describeRange(schedule)}</dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase text-slate-500">Recipients</dt>
                        <dd className="mt-1 text-sm text-slate-200">{describeRecipients(schedule)}</dd>
                      </div>
                    </dl>

                    {schedule.lastErrorMessage ? (
                      <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                        <strong className="font-semibold">Last failure:</strong> {schedule.lastErrorMessage}
                      </div>
                    ) : null}

                    <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => toggleScheduleActive(schedule)}
                        disabled={busyScheduleId === scheduleId}
                        className="rounded-md border border-slate-700 px-3 py-2 font-semibold text-slate-200 transition hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {schedule.active ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRunNow(schedule)}
                        disabled={busyScheduleId === scheduleId}
                        className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 font-semibold text-sky-200 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Run now
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSchedule(schedule)}
                        disabled={busyScheduleId === scheduleId}
                        className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-semibold text-rose-200 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
                No schedules configured yet. Create your first cadence to keep stakeholders in the loop.
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Report history</h2>
            <p className="mt-1 text-sm text-slate-400">Download recent exports, share securely, or trigger new ones.</p>
          </div>
          {runsMeta?.total ? (
            <span className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400">
              {runsMeta.total} total
            </span>
          ) : null}
        </header>

        <div className="mt-5 space-y-4 text-sm text-slate-300">
          {runsLoading ? (
            <PageLoader label="Fetching report exports..." />
          ) : runs.length ? (
            runs.map((run) => {
              const runId = getScheduleId(run) || run._id;
              const statusClass = RUN_STATUS_STYLES[run.status] || "border-slate-700 bg-slate-900 text-slate-400";
              const createdRelative = relativeTime(run.createdAt);
              const quickInsights = Array.isArray(run.summary?.quickInsights)
                ? run.summary.quickInsights.slice(0, 3)
                : [];
              const viaSchedule = run.scheduleId ? schedules.find((item) => getScheduleId(item) === run.scheduleId?.toString()) : null;

              return (
                <article
                  key={runId}
                  className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 transition hover:border-accent/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-white">
                        {run.summary?.range?.label || "Custom range"} · {run.format?.toUpperCase?.() || "PDF"}
                      </h3>
                      <p className="mt-1 text-xs text-slate-400">
                        Generated {formatDateTimeUTC(run.createdAt)} {createdRelative ? `(${createdRelative})` : ""}
                        {viaSchedule ? ` • via ${viaSchedule.name}` : ""}
                      </p>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusClass}`}>
                      {run.status || "unknown"}
                    </span>
                  </div>

                  <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div>
                      <dt className="text-[11px] uppercase text-slate-500">Range</dt>
                      <dd className="mt-1 text-sm text-slate-200">
                        {run.summary?.range?.label || "Custom"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase text-slate-500">File size</dt>
                      <dd className="mt-1 text-sm text-slate-200">{formatFileSize(run.fileSize)}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase text-slate-500">Recommendations</dt>
                      <dd className="mt-1 text-sm text-slate-200">
                        {Array.isArray(run.recommendations) && run.recommendations.length
                          ? `${run.recommendations.length} insight${run.recommendations.length === 1 ? "" : "s"}`
                          : "None recorded"}
                      </dd>
                    </div>
                  </dl>

                  {run.status === "failed" && run.error ? (
                    <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                      <strong className="font-semibold">Error:</strong> {run.error}
                    </div>
                  ) : null}

                  {quickInsights.length ? (
                    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-300">
                      <p className="font-semibold uppercase tracking-wide text-slate-500">Highlights</p>
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-400">
                        {quickInsights.map((insight, index) => (
                          <li key={`${runId}-insight-${index}`}>{insight}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleDownloadRun(run)}
                      disabled={busyRunId === runId || run.status !== "success"}
                      className="rounded-md border border-slate-700 px-3 py-2 font-semibold text-slate-200 transition hover:border-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => handleShareRun(run)}
                      disabled={busyRunId === runId || run.status !== "success"}
                      className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 font-semibold text-sky-200 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Share link
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRun(run)}
                      disabled={busyRunId === runId}
                      className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-semibold text-rose-200 transition hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
              No reports generated yet. Create a schedule or run a one-off export to populate this list.
            </div>
          )}
        </div>
      </section>
    </MainLayout>
  );
}
