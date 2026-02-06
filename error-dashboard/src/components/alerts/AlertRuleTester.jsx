import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { testAlertRule } from "../../services/api";
import { formatRelativeTime } from "../../utils/date";

const defaultFormState = {
  environment: "production",
  severity: "high",
  fingerprint: "",
  windowCount: "",
  windowMinutes: "",
  baselineCount: "",
  baselineMinutes: "",
  occurrences: "",
  affectedUsers: "",
  userSegments: "",
};

const parseSegments = (value) =>
  value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

const formatNumber = (value) => (value === null || value === undefined ? "—" : value);

const ChannelPreview = ({ channel }) => {
  if (!channel) {
    return null;
  }

  if (channel.unsupported) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h5 className="text-sm font-semibold text-slate-200">{channel.type}</h5>
        <p className="mt-2 text-xs text-slate-400">Preview not available for this channel type.</p>
      </div>
    );
  }

  if (channel.type === "email") {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h5 className="text-sm font-semibold text-slate-200">Email → {channel.target}</h5>
        <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">Subject</p>
        <p className="text-sm text-slate-200">{channel.preview.subject}</p>
        <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">Text preview</p>
        <pre className="mt-2 max-h-40 overflow-y-auto rounded-md bg-slate-950/70 p-3 text-xs text-slate-300">
{channel.preview.text}
        </pre>
      </div>
    );
  }

  if (channel.type === "webhook") {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h5 className="text-sm font-semibold text-slate-200">Webhook → {channel.target}</h5>
        <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">Payload</p>
        <pre className="mt-2 max-h-40 overflow-y-auto rounded-md bg-slate-950/70 p-3 text-xs text-slate-300">
{JSON.stringify(channel.preview.body, null, 2)}
        </pre>
      </div>
    );
  }

  if (channel.type === "slack") {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h5 className="text-sm font-semibold text-slate-200">Slack → {channel.target}</h5>
        <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">Message</p>
        <p className="text-sm text-slate-200">{channel.preview.message.text}</p>
        <p className="mt-2 text-xs text-slate-500">Blocks: {channel.preview.message.blocks.length}</p>
      </div>
    );
  }

  if (channel.type === "discord" || channel.type === "teams") {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h5 className="text-sm font-semibold text-slate-200">{channel.type === "discord" ? "Discord" : "Teams"} → {channel.target}</h5>
        <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">Payload</p>
        <pre className="mt-2 max-h-40 overflow-y-auto rounded-md bg-slate-950/70 p-3 text-xs text-slate-300">
{JSON.stringify(channel.preview.body, null, 2)}
        </pre>
      </div>
    );
  }

  return null;
};

ChannelPreview.propTypes = {
  channel: PropTypes.shape({
    type: PropTypes.string.isRequired,
    target: PropTypes.string,
    preview: PropTypes.oneOfType([PropTypes.object, PropTypes.bool, PropTypes.string]),
    unsupported: PropTypes.bool,
  }).isRequired,
};

export function AlertRuleTester({ rule, onClose }) {
  const [form, setForm] = useState(defaultFormState);
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!rule) {
      return;
    }
    setResult(null);
    setError(null);
    const defaults = {
      ...defaultFormState,
      environment: rule.conditions?.environments?.[0] || "production",
      severity: rule.conditions?.severity || (rule.type === "critical" ? "critical" : "high"),
      windowMinutes: rule.conditions?.windowMinutes?.toString?.() || "",
      baselineMinutes: rule.conditions?.baselineMinutes?.toString?.() || "",
      windowCount: rule.conditions?.threshold?.toString?.() || "",
      fingerprint: rule.conditions?.fingerprint || "",
    };
    setForm(defaults);
  }, [rule]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!rule) {
      return;
    }
    setIsTesting(true);
    setError(null);

    const payload = {
      environment: form.environment || undefined,
      severity: form.severity || undefined,
      fingerprint: form.fingerprint || undefined,
      windowCount: form.windowCount ? Number(form.windowCount) : undefined,
      windowMinutes: form.windowMinutes ? Number(form.windowMinutes) : undefined,
      baselineCount: form.baselineCount ? Number(form.baselineCount) : undefined,
      baselineMinutes: form.baselineMinutes ? Number(form.baselineMinutes) : undefined,
      occurrences: form.occurrences ? Number(form.occurrences) : undefined,
      affectedUsers: form.affectedUsers ? Number(form.affectedUsers) : undefined,
      userSegments: form.userSegments ? parseSegments(form.userSegments) : undefined,
    };

    try {
      const { data } = await testAlertRule(rule._id || rule.id, payload);
      setResult(data);
    } catch (err) {
      const responseError = err.response?.data?.error || {};
      const message = responseError.message || err.message || "Failed to simulate alert";
      const status = responseError.status || err.response?.status || null;
      setError({ message, status, raw: responseError });
      setResult(null);
    } finally {
      setIsTesting(false);
    }
  };

  const evaluationSummary = useMemo(() => {
    if (!result?.evaluation) {
      return null;
    }
    if (!result.triggered) {
      return `Rule did not trigger${result.evaluation.reason ? ` (${result.evaluation.reason})` : ""}.`;
    }
    if (result.evaluation.reason === "threshold_exceeded") {
      return `Triggered: ${formatNumber(result.metrics.windowCount)} occurrences in ${formatNumber(
        result.metrics.windowMinutes
      )} minutes.`;
    }
    if (result.evaluation.reason === "spike_detected") {
      return "Triggered: spike detected over baseline.";
    }
    if (result.evaluation.reason === "new_error") {
      return "Triggered: new fingerprint detected.";
    }
    if (result.evaluation.reason === "critical_severity" || result.evaluation.reason === "critical_fingerprint") {
      return "Triggered: critical rule matched.";
    }
    return "Rule triggered.";
  }, [result]);

  const recentDeployments = result?.alert?.context?.recentDeployments || [];
  const similarIncidents = result?.alert?.context?.similarIncidents || [];
  const suggestedFixes = result?.alert?.context?.suggestedFixes || result?.alert?.nextSteps || [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 py-6 backdrop-blur-sm sm:items-center">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-black/60">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Testing</p>
            <h3 className="text-lg font-semibold text-white">{rule?.name}</h3>
          </div>
          <button
            type="button"
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:border-accent hover:text-white"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="grid gap-6 bg-slate-950/60 p-6 sm:grid-cols-2">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="text-xs uppercase text-slate-500">Environment</label>
              <input
                name="environment"
                value={form.environment}
                onChange={handleChange}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">Severity</label>
              <input
                name="severity"
                value={form.severity}
                onChange={handleChange}
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">Fingerprint</label>
              <input
                name="fingerprint"
                value={form.fingerprint}
                onChange={handleChange}
                placeholder="hash or identifier"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs uppercase text-slate-500">
                <span>Window Count</span>
                <input
                  name="windowCount"
                  value={form.windowCount}
                  onChange={handleChange}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block text-xs uppercase text-slate-500">
                <span>Window Minutes</span>
                <input
                  name="windowMinutes"
                  value={form.windowMinutes}
                  onChange={handleChange}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs uppercase text-slate-500">
                <span>Baseline Count</span>
                <input
                  name="baselineCount"
                  value={form.baselineCount}
                  onChange={handleChange}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block text-xs uppercase text-slate-500">
                <span>Baseline Minutes</span>
                <input
                  name="baselineMinutes"
                  value={form.baselineMinutes}
                  onChange={handleChange}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs uppercase text-slate-500">
                <span>Occurrences</span>
                <input
                  name="occurrences"
                  value={form.occurrences}
                  onChange={handleChange}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block text-xs uppercase text-slate-500">
                <span>Affected Users</span>
                <input
                  name="affectedUsers"
                  value={form.affectedUsers}
                  onChange={handleChange}
                  className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
                />
              </label>
            </div>
            <div>
              <label className="text-xs uppercase text-slate-500">User Segments (comma separated)</label>
              <input
                name="userSegments"
                value={form.userSegments}
                onChange={handleChange}
                placeholder="premium, enterprise"
                className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-accent disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
              disabled={isTesting}
            >
              {isTesting ? "Testing alert…" : "Run Test"}
            </button>
            {error ? (
              <div className="rounded-md border border-rose-800/60 bg-rose-900/40 p-3 text-xs text-rose-200">
                <p className="font-medium text-rose-100">{error.message}</p>
                {error.status === 422 && /fingerprint/i.test(error.message || "") ? (
                  <p className="mt-2 text-[0.7rem] text-rose-100/80">
                    Provide a fingerprint so aggregate rules can map the simulated event to historical data. Use the fingerprint from an existing error group or paste a new hash to continue.
                  </p>
                ) : null}
              </div>
            ) : null}
            {evaluationSummary ? <p className="text-xs text-slate-400">{evaluationSummary}</p> : null}
          </form>

          <div className="space-y-4">
            {result?.alert ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-200">
                <h4 className="text-base font-semibold text-white">Alert preview</h4>
                <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">Why this matters</p>
                <p className="text-sm text-slate-200">{result.alert.whyItMatters || "—"}</p>
                {suggestedFixes.length ? (
                  <div className="mt-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Next steps</p>
                    <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-200">
                      {suggestedFixes.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                {recentDeployments.length ? (
                  <div className="mt-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Recent deployments</p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-200">
                      {recentDeployments.map((deployment) => (
                        <li key={deployment.id}>
                          {deployment.label || "Deployment"} · {formatRelativeTime(deployment.timestamp)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {similarIncidents.length ? (
                  <div className="mt-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Similar incidents</p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-200">
                      {similarIncidents.map((incident) => (
                        <li key={incident.id}>
                          {incident.message || "Incident"} · last seen {formatRelativeTime(incident.lastSeen)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {Array.isArray(result?.channels) && result.channels.length ? (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Channel previews</h4>
                {result.channels.map((channel) => (
                  <ChannelPreview key={`${channel.type}-${channel.target}`} channel={channel} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

AlertRuleTester.propTypes = {
  rule: PropTypes.shape({
    _id: PropTypes.string,
    id: PropTypes.string,
    name: PropTypes.string,
    type: PropTypes.string,
    conditions: PropTypes.object,
  }).isRequired,
  onClose: PropTypes.func.isRequired,
};
