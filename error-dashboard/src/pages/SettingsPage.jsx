import { useEffect, useMemo, useState } from "react";
import { AlertRuleTester } from "../components/alerts/AlertRuleTester";
import { MainLayout } from "../components/layout/MainLayout";
import { fetchAlertRules } from "../services/api";
import { useProjectContext } from "../contexts/ProjectContext";
import { useToast } from "../components/toast/ToastContainer";

export function SettingsPage() {
  const [alertRules, setAlertRules] = useState([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [rulesError, setRulesError] = useState(null);
  const [testingRule, setTestingRule] = useState(null);
  const {
    projects,
    currentProject,
    loadingProjects,
    projectError,
    selectProject,
    createProject,
    rotateKey,
    updateProject,
  } = useProjectContext();
  const { addToast } = useToast();
  const [projectName, setProjectName] = useState(currentProject?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [scrubbing, setScrubbing] = useState({ removeEmails: false, removePhones: false, removeIPs: false });
  const [retentionDays, setRetentionDays] = useState(currentProject?.retentionDays ?? 90);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [newProjectScrubbing, setNewProjectScrubbing] = useState({ removeEmails: false, removePhones: false, removeIPs: false });
  const [newRetentionDays, setNewRetentionDays] = useState(90);

  useEffect(() => {
    let cancelled = false;
    const loadRules = async () => {
      setLoadingRules(true);
      setRulesError(null);
      try {
        const payload = await fetchAlertRules();
        if (!cancelled) {
          setAlertRules(Array.isArray(payload?.data) ? payload.data : []);
        }
      } catch (error) {
        if (!cancelled) {
          setRulesError(error.response?.data?.error?.message || "Failed to load alert rules");
          setAlertRules([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingRules(false);
        }
      }
    };

    loadRules();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setProjectName(currentProject?.name || "");
    setScrubbing({
      removeEmails: !!currentProject?.scrubbing?.removeEmails,
      removePhones: !!currentProject?.scrubbing?.removePhones,
      removeIPs: !!currentProject?.scrubbing?.removeIPs,
    });
    setRetentionDays(currentProject?.retentionDays ?? 90);
  }, [currentProject?.id, currentProject?.name, currentProject?.scrubbing, currentProject?.retentionDays]);

  const currentRole = currentProject?.role || "admin";
  const canAdministerProject = (currentRole || "").toLowerCase() === "admin";

  const handleProjectRename = async (event) => {
    event.preventDefault();
    if (!currentProject || !projectName.trim()) {
      return;
    }
    setSavingName(true);
    try {
      await updateProject(currentProject.id, { name: projectName.trim() });
      addToast({ variant: "success", title: "Project updated", description: "Project name saved successfully." });
    } catch (error) {
      const message = error?.response?.data?.error?.message || "Unable to update project.";
      addToast({ variant: "error", title: "Update failed", description: message });
    } finally {
      setSavingName(false);
    }
  };

  const handleRotateKey = async () => {
    if (!currentProject) {
      return;
    }
    setRotatingKey(true);
    try {
      const updated = await rotateKey(currentProject.id);
      addToast({ variant: "success", title: "API key rotated" });
      if (updated?.apiKey && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(updated.apiKey);
          addToast({ variant: "info", title: "API key copied", description: "New key copied to clipboard." });
        } catch (clipboardError) {
          // Swallow clipboard errors silently; copying is best effort.
        }
      }
    } catch (error) {
      const message = error?.response?.data?.error?.message || "Unable to rotate API key.";
      addToast({ variant: "error", title: "Rotation failed", description: message });
    } finally {
      setRotatingKey(false);
    }
  };

  const handleCopyKey = async () => {
    if (!currentProject?.apiKey) {
      addToast({ variant: "info", title: "No API key loaded", description: "Rotate the key to reveal a new secret." });
      return;
    }
    try {
      await navigator.clipboard.writeText(currentProject.apiKey);
      addToast({ variant: "success", title: "API key copied" });
    } catch (error) {
      addToast({ variant: "error", title: "Copy failed", description: "Clipboard access denied." });
    }
  };

  const handleCreateProject = async (event) => {
    event.preventDefault();
    if (!newProjectName.trim()) {
      return;
    }
    setCreatingProject(true);
    try {
      const parsedRetention = Number(newRetentionDays);
      const payload = {
        name: newProjectName.trim(),
        scrubbing: { ...newProjectScrubbing },
      };
      if (Number.isFinite(parsedRetention) && parsedRetention >= 1 && parsedRetention <= 365) {
        payload.retentionDays = parsedRetention;
      }
      const created = await createProject(payload);
      addToast({ variant: "success", title: "Project created", description: created?.name });
      setNewProjectName("");
      setNewProjectScrubbing({ removeEmails: false, removePhones: false, removeIPs: false });
      setNewRetentionDays(90);
    } catch (error) {
      const message = error?.response?.data?.error?.message || "Unable to create project.";
      addToast({ variant: "error", title: "Creation failed", description: message });
    } finally {
      setCreatingProject(false);
    }
  };

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  const toggleScrubbing = (key) => {
    setScrubbing((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePrivacySave = async (event) => {
    event.preventDefault();
    if (!currentProject || !canAdministerProject) {
      return;
    }
    const parsedRetention = Number(retentionDays);
    if (!Number.isFinite(parsedRetention) || parsedRetention < 1 || parsedRetention > 365) {
      addToast({ variant: "error", title: "Invalid retention", description: "Enter a number between 1 and 365." });
      return;
    }
    setSavingPrivacy(true);
    try {
      await updateProject(currentProject.id, { scrubbing, retentionDays: parsedRetention });
      addToast({ variant: "success", title: "Privacy settings saved" });
    } catch (error) {
      const message = error?.response?.data?.error?.message || "Unable to update privacy settings.";
      addToast({ variant: "error", title: "Update failed", description: message });
    } finally {
      setSavingPrivacy(false);
    }
  };

  return (
    <MainLayout
      title="Settings"
      description=""
      breadcrumbs={[
        { label: "Dashboard", href: "/overview", current: false },
        { label: "Settings", href: "/settings", current: true },
      ]}
      requireProject={false}
    >
      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Project Details</h3>
          {loadingProjects ? (
            <p className="mt-4 text-sm text-slate-400">Loading projects…</p>
          ) : projectError ? (
            <p className="mt-4 text-sm text-rose-300">{projectError}</p>
          ) : currentProject ? (
            <form onSubmit={handleProjectRename} className="mt-5 space-y-4 text-sm text-slate-200">
              <label className="block">
                <span className="text-xs uppercase text-slate-500">Project Name</span>
                <input
                  type="text"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 focus:border-accent focus:outline-none"
                  disabled={!canAdministerProject}
                />
              </label>
              <p className="text-xs text-slate-500">
                Role: <span className="font-semibold capitalize text-slate-200">{currentRole}</span>
              </p>
              <button
                type="submit"
                disabled={!canAdministerProject || savingName}
                className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-semibold text-white hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingName ? "Saving…" : "Save Changes"}
              </button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-slate-300">No project selected. Create a project to begin.</p>
          )}
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Authentication</h3>
          <div className="mt-5 space-y-4 text-sm text-slate-300">
            {currentProject ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="text-xs uppercase text-slate-500">API Key</p>
                {currentProject.apiKey ? (
                  <>
                    <code className="mt-2 block overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200">
                      {currentProject.apiKey}
                    </code>
                    <p className="mt-2 text-xs text-slate-400">Store this key securely. It will no longer be displayed after you leave the page.</p>
                    <div className="mt-3 flex gap-3 text-xs">
                      <button
                        type="button"
                        onClick={handleRotateKey}
                        disabled={rotatingKey}
                        className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {rotatingKey ? "Rotating…" : "Rotate"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyKey}
                        className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 hover:border-accent"
                      >
                        Copy
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {currentProject.apiKeyPreview ? (
                      <p className="mt-2 text-xs text-slate-400">
                        Current key preview: <span className="font-mono text-slate-200">…{currentProject.apiKeyPreview}</span>
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-slate-400">
                      Rotate the key to generate a new secret. The full value is only shown immediately after rotation.
                    </p>
                    <div className="mt-3 flex gap-3 text-xs">
                      <button
                        type="button"
                        onClick={handleRotateKey}
                        disabled={rotatingKey}
                        className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {rotatingKey ? "Rotating…" : "Rotate"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Create a project to obtain an ingestion API key.</p>
            )}
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="text-xs uppercase text-slate-500">Alert Destinations</p>
              <ul className="mt-2 space-y-2 text-xs text-slate-400">
                <li>Slack · #oncall-errors</li>
                <li>Email · oncall@example.com</li>
                <li>PagerDuty · Critical incidents</li>
              </ul>
            </div>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Projects</h3>
            <p className="text-xs text-slate-500">Switch between projects or create new ones for each application.</p>
          </div>
        </div>
        {sortedProjects.length ? (
          <ul className="mt-5 space-y-3 text-sm text-slate-200">
            {sortedProjects.map((project) => (
              <li
                key={project.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-base font-semibold text-white">{project.name}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Role: {project.role}</p>
                  <p className="text-xs text-slate-500">Status: {project.status || "active"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => selectProject(project.id)}
                  className="w-full rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-accent sm:w-auto"
                >
                  {currentProject?.id === project.id ? "Selected" : "Switch"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-400">No projects found. Create a project below to get started.</p>
        )}

        <form onSubmit={handleCreateProject} className="mt-6 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Create Project</h4>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="Project name"
              className="flex-1 rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={creatingProject}
              className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-semibold text-white hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingProject ? "Creating…" : "Create"}
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 text-xs text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-700 bg-canvas-subtle"
                checked={newProjectScrubbing.removeEmails}
                onChange={() => setNewProjectScrubbing((prev) => ({ ...prev, removeEmails: !prev.removeEmails }))}
              />
              Remove email addresses
            </label>
            <label className="flex items-center gap-3 text-xs text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-700 bg-canvas-subtle"
                checked={newProjectScrubbing.removePhones}
                onChange={() => setNewProjectScrubbing((prev) => ({ ...prev, removePhones: !prev.removePhones }))}
              />
              Remove phone numbers
            </label>
            <label className="flex items-center gap-3 text-xs text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-700 bg-canvas-subtle"
                checked={newProjectScrubbing.removeIPs}
                onChange={() => setNewProjectScrubbing((prev) => ({ ...prev, removeIPs: !prev.removeIPs }))}
              />
              Remove IP addresses
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              <span className="uppercase text-slate-500">Retention (days)</span>
              <input
                type="number"
                min="1"
                max="365"
                value={newRetentionDays}
                onChange={(event) => setNewRetentionDays(event.target.value)}
                className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none"
              />
            </label>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Alert Rules</h3>
            <p className="text-xs text-slate-500">Run simulations to validate rule conditions and notification payloads.</p>
          </div>
        </div>

        {loadingRules ? (
          <p className="mt-6 text-sm text-slate-400">Loading alert rules…</p>
        ) : null}

        {rulesError ? (
          <p className="mt-6 text-sm text-rose-400">{rulesError}</p>
        ) : null}

        {!loadingRules && !rulesError ? (
          <ul className="mt-5 space-y-3">
            {alertRules.length === 0 ? (
              <li className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
                No alert rules yet. Create one to enable testing.
              </li>
            ) : null}
            {alertRules.map((rule) => (
              <li key={rule._id || rule.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-200 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-base font-semibold text-white">{rule.name}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-500">{(rule.type || "").replace(/_/g, " ")}</p>
                  {rule.description ? <p className="mt-2 text-xs text-slate-400">{rule.description}</p> : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase text-slate-500">Channels: {Array.isArray(rule.channels) ? rule.channels.length : 0}</span>
                  <button
                    type="button"
                    className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:border-accent"
                    onClick={() => setTestingRule(rule)}
                  >
                    Test Alert
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Data Privacy</h3>
        <p className="mt-4 text-slate-400">
          Control scrubbing, PII handling, and retention policies to stay compliant with regulations.
        </p>
        <form className="mt-4 space-y-4" onSubmit={handlePrivacySave}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-3 text-xs text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-700 bg-canvas-subtle"
                checked={scrubbing.removeEmails}
                onChange={() => toggleScrubbing("removeEmails")}
                disabled={!canAdministerProject}
              />
              Remove email addresses
            </label>
            <label className="flex items-center gap-3 text-xs text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-700 bg-canvas-subtle"
                checked={scrubbing.removePhones}
                onChange={() => toggleScrubbing("removePhones")}
                disabled={!canAdministerProject}
              />
              Remove phone numbers
            </label>
            <label className="flex items-center gap-3 text-xs text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-700 bg-canvas-subtle"
                checked={scrubbing.removeIPs}
                onChange={() => toggleScrubbing("removeIPs")}
                disabled={!canAdministerProject}
              />
              Remove IP addresses
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              <span className="uppercase text-slate-500">Retention (days)</span>
              <input
                type="number"
                min="1"
                max="365"
                value={retentionDays}
                onChange={(event) => setRetentionDays(event.target.value)}
                className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none"
                disabled={!canAdministerProject}
              />
              <span className="text-[11px] text-slate-500">Older events and occurrences are purged automatically.</span>
            </label>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{canAdministerProject ? "Settings apply to the selected project." : "You need admin access to change privacy settings."}</span>
            <button
              type="submit"
              disabled={!canAdministerProject || savingPrivacy}
              className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-semibold text-white hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingPrivacy ? "Saving…" : "Save privacy"}
            </button>
          </div>
        </form>
      </section>

      {testingRule ? <AlertRuleTester rule={testingRule} onClose={() => setTestingRule(null)} /> : null}
    </MainLayout>
  );
}
