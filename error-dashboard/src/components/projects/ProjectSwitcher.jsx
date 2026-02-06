import PropTypes from "prop-types";
import clsx from "clsx";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectContext } from "../../contexts/ProjectContext";

export function ProjectSwitcher({ variant, showManage }) {
  const navigate = useNavigate();
  const {
    projects,
    currentProjectId,
    selectProject,
    loadingProjects,
    projectError,
    refreshProjects,
  } = useProjectContext();

  const handleChange = useCallback(
    (event) => {
      const value = event.target.value;
      selectProject(value || null);
    },
    [selectProject]
  );

  const manageProjects = useCallback(() => {
    navigate("/settings");
  }, [navigate]);

  const containerClasses = clsx(
    "flex flex-col gap-2",
    variant === "inline" ? "sm:flex-row sm:items-center sm:gap-3" : null
  );

  const selectClasses = clsx(
    "rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none",
    variant === "inline" ? "min-w-[180px]" : "w-full"
  );

  return (
    <div className={containerClasses}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="block text-xs uppercase tracking-wide text-slate-400">Project</span>
          {projectError ? (
            <button
              type="button"
              onClick={refreshProjects}
              className="text-xs text-rose-300 hover:text-rose-200"
            >
              Retry loading projects
            </button>
          ) : null}
        </div>
        {showManage ? (
          <button
            type="button"
            onClick={manageProjects}
            className="text-xs font-semibold text-accent hover:text-accent-soft"
          >
            Manage
          </button>
        ) : null}
      </div>
      <select
        value={currentProjectId || ""}
        onChange={handleChange}
        disabled={loadingProjects || !projects.length}
        className={selectClasses}
      >
        {!projects.length ? (
          <option value="">{loadingProjects ? "Loading projects…" : "No projects available"}</option>
        ) : null}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </div>
  );
}

ProjectSwitcher.propTypes = {
  variant: PropTypes.oneOf(["default", "inline"]),
  showManage: PropTypes.bool,
};

ProjectSwitcher.defaultProps = {
  variant: "default",
  showManage: true,
};
