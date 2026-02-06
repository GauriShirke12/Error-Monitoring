import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import { MainLayout } from "../components/layout/MainLayout";
import { PageLoader } from "../components/feedback/PageLoader";
import {
  createTeamMember,
  deleteTeamMember,
  fetchTeamMembers,
  fetchTeamPerformance,
} from "../services/api";
import { useToast } from "../components/toast/ToastContainer";

const RANGE_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

const numberFormatter = new Intl.NumberFormat("en-US");

const formatDuration = (milliseconds) => {
  if (milliseconds == null) {
    return "—";
  }
  const value = Math.max(0, Math.floor(milliseconds));
  if (value === 0) {
    return "<1m";
  }
  const minutes = Math.floor(value / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;
  if (days > 0) {
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${remainingMinutes}m`;
};

const serializeMember = (member) => ({
  ...member,
  label: member.name || member.email || "Unnamed member",
  initial: member.name ? member.name.charAt(0).toUpperCase() : "?",
});

export function TeamPerformancePage() {
  const { addToast } = useToast();
  const [range, setRange] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [performance, setPerformance] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [memberForm, setMemberForm] = useState({ name: "", email: "", role: "" });
  const [savingMember, setSavingMember] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    fetchTeamPerformance({ range }, { signal: controller.signal })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setPerformance(response?.data ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          addToast({
            title: "Unable to load performance",
            description: error.message || "Try refreshing in a moment.",
            variant: "error",
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [range, addToast]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setMembersLoading(true);
    fetchTeamMembers({}, { signal: controller.signal })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setMembers((response?.data ?? []).map(serializeMember));
      })
      .catch((error) => {
        if (!cancelled) {
          addToast({
            title: "Unable to load team",
            description: error.message || "Could not retrieve members.",
            variant: "error",
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMembersLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [addToast]);

  const timeline = useMemo(() => performance?.timeline ?? [], [performance?.timeline]);
  const leaderboard = useMemo(() => performance?.leaderboard ?? [], [performance?.leaderboard]);
  const backlog = useMemo(() => performance?.backlogPreview ?? [], [performance?.backlogPreview]);

  const handleMemberFieldChange = (event) => {
    const { name, value } = event.target;
    setMemberForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateMember = async (event) => {
    event.preventDefault();
    const name = memberForm.name.trim();
    const email = memberForm.email.trim();
    if (!name || !email) {
      addToast({
        title: "Missing details",
        description: "Enter both name and email.",
        variant: "warning",
      });
      return;
    }

    setSavingMember(true);
    try {
      const response = await createTeamMember({
        name,
        email,
        role: memberForm.role.trim() || null,
      });
      const created = response?.data;
      if (created) {
        setMembers((prev) => [serializeMember(created), ...prev]);
        setMemberForm({ name: "", email: "", role: "" });
        addToast({
          title: "Member added",
          description: `${created.name || created.email} can now be assigned incidents.`,
          variant: "success",
        });
      }
    } catch (error) {
      addToast({
        title: "Unable to add member",
        description: error.message || "Please retry in a moment.",
        variant: "error",
      });
    } finally {
      setSavingMember(false);
    }
  };

  const handleDeactivateMember = async (memberId) => {
    const confirmed = window.confirm("Deactivate this member? They will no longer receive assignments.");
    if (!confirmed) {
      return;
    }
    try {
      await deleteTeamMember(memberId);
      setMembers((prev) => prev.filter((member) => member.id !== memberId));
      addToast({
        title: "Member deactivated",
        description: "Assignments will no longer target this member.",
        variant: "success",
      });
    } catch (error) {
      addToast({
        title: "Unable to deactivate",
        description: error.message || "Try again in a moment.",
        variant: "error",
      });
    }
  };

  const filters = (
    <Fragment>
      <select
        value={range}
        onChange={(event) => setRange(event.target.value)}
        className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
      >
        {RANGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Fragment>
  );

  return (
    <MainLayout
      title="Team Performance"
      description="Monitor workload balance, resolution cadence, and assignment backlog."
      breadcrumbs={[
        { label: "Dashboard", href: "/overview", current: false },
        { label: "Team", href: "/team", current: true },
      ]}
      filters={filters}
    >
      {loading ? <PageLoader label="Analysing team metrics..." /> : null}

      {performance ? (
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Throughput overview</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {numberFormatter.format(performance.totals.resolved)} incidents closed in this window.
                  </p>
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-800/40 px-4 py-2 text-xs text-slate-300">
                  Team size: {performance.totals.teamSize}
                </div>
              </header>
              <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Active assignments</dt>
                  <dd className="mt-2 text-2xl font-semibold text-sky-300">
                    {numberFormatter.format(performance.totals.activeAssignments)}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Unassigned backlog</dt>
                  <dd className="mt-2 text-2xl font-semibold text-amber-300">
                    {numberFormatter.format(performance.totals.unassignedActive)}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Resolved this period</dt>
                  <dd className="mt-2 text-2xl font-semibold text-emerald-300">
                    {numberFormatter.format(performance.totals.resolved)}
                  </dd>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Team avg resolution</dt>
                  <dd className="mt-2 text-2xl font-semibold text-indigo-300">
                    {formatDuration(performance.totals.avgResolutionMs)}
                  </dd>
                </div>
              </dl>

              <div className="mt-10 h-72 w-full">
                <ResponsiveContainer>
                  <AreaChart data={timeline} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="resolvedArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.32} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickLine={false} />
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={(value) => numberFormatter.format(value)} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "0.75rem" }}
                      labelStyle={{ color: "#e2e8f0" }}
                      formatter={(value) => numberFormatter.format(value)}
                    />
                    <Area type="monotone" dataKey="resolvedCount" stroke="#38bdf8" fillOpacity={1} fill="url(#resolvedArea)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">Backlog spotlight</h2>
                <span className="text-xs text-slate-500">Top items need assignment</span>
              </header>
              <ul className="mt-4 space-y-3 text-sm">
                {backlog.length ? (
                  backlog.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-sky-500/50"
                    >
                      <p className="font-medium text-slate-100">{item.message}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {numberFormatter.format(item.count)} occurrences • Last seen {item.lastSeen ? formatDistanceToNow(new Date(item.lastSeen), { addSuffix: true }) : "unknown"}
                      </p>
                    </li>
                  ))
                ) : (
                  <li className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-slate-400">
                    No unassigned errors in this range. Nicely done!
                  </li>
                )}
              </ul>
            </article>
          </div>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">Leaderboard</h2>
                <span className="text-xs text-slate-500">Sorted by resolved count</span>
              </header>
              <ul className="mt-4 space-y-3">
                {leaderboard.length ? (
                  leaderboard.map((entry, index) => (
                    <li
                      key={entry.member.id || index}
                      className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
                          style={{ backgroundColor: entry.member.avatarColor || "#334155" }}
                        >
                          {entry.member.name ? entry.member.name.charAt(0).toUpperCase() : "?"}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-100">{entry.member.name || entry.member.email || "Unassigned"}</p>
                          <p className="text-xs text-slate-400">
                            {numberFormatter.format(entry.resolvedCount)} resolved • Avg {formatDuration(entry.avgResolutionMs)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right text-xs text-slate-400">
                        <p>Open: {numberFormatter.format(entry.openAssignments)}</p>
                        <p>Touched: {numberFormatter.format(entry.assignmentsTouched)}</p>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center text-slate-400">No assignments recorded.</li>
                )}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
              <header className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">Team roster</h2>
                <span className="text-xs text-slate-500">{membersLoading ? "Loading..." : `${members.length} members`}</span>
              </header>
              <form onSubmit={handleCreateMember} className="space-y-3">
                <input
                  name="name"
                  value={memberForm.name}
                  onChange={handleMemberFieldChange}
                  placeholder="Full name"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
                />
                <input
                  name="email"
                  value={memberForm.email}
                  onChange={handleMemberFieldChange}
                  placeholder="Email"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
                />
                <input
                  name="role"
                  value={memberForm.role}
                  onChange={handleMemberFieldChange}
                  placeholder="Role (optional)"
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={savingMember}
                  className="w-full rounded-lg border border-sky-500/40 bg-sky-500/10 py-2 text-sm font-semibold text-sky-200 transition hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingMember ? "Adding..." : "Add team member"}
                </button>
              </form>

              <ul className="mt-6 space-y-2 text-sm">
                {members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                        style={{ backgroundColor: member.avatarColor || "#475569" }}
                      >
                        {member.initial}
                      </div>
                      <div>
                        <p className="font-medium text-slate-100">{member.label}</p>
                        <p className="text-xs text-slate-400">{member.role || "Contributor"}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeactivateMember(member.id)}
                      className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-200 transition hover:border-rose-400"
                    >
                      Deactivate
                    </button>
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
