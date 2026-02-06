import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { PageLoader } from "../feedback/PageLoader";
import { useProjectContext } from "../../contexts/ProjectContext";

export function MainLayout({
  title,
  description,
  filters,
  breadcrumbs,
  children,
  requireProject,
  emptyState,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { loadingProjects, projectError, currentProjectId } = useProjectContext();

  const projectGuard = useMemo(() => {
    if (!requireProject) {
      return { showLoader: false, showEmpty: false };
    }
    if (loadingProjects) {
      return { showLoader: true, showEmpty: false };
    }
    if (!currentProjectId) {
      return { showLoader: false, showEmpty: true };
    }
    return { showLoader: false, showEmpty: false };
  }, [requireProject, loadingProjects, currentProjectId]);

  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
    return () => document.body.classList.remove("overflow-hidden");
  }, [sidebarOpen]);

  const toggleSidebar = () => setSidebarOpen((open) => !open);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="flex min-h-screen bg-transparent text-slate-100">
      <div className="hidden lg:flex">
        <Sidebar className="w-72" />
      </div>

      {sidebarOpen ? (
        <>
          <button
            type="button"
            onClick={closeSidebar}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
            aria-label="Close navigation"
          />
          <div className="fixed inset-y-0 left-0 z-50 flex">
            <Sidebar
              className="w-72 shadow-2xl shadow-black/60"
              onNavigate={closeSidebar}
            />
          </div>
        </>
      ) : null}

      <main className="flex flex-1 flex-col overflow-hidden">
        <Header
          title={title}
          description={description}
          filters={filters}
          breadcrumbs={breadcrumbs}
          onToggleSidebar={toggleSidebar}
        />
        <section className="flex-1 overflow-y-auto content-surface px-6 py-6 lg:px-10">
          <div className="mx-auto max-w-6xl space-y-6 pb-16">
            {requireProject && projectError ? (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">
                {projectError}
              </div>
            ) : null}
            {projectGuard.showLoader ? (
              <PageLoader label="Loading projects..." />
            ) : projectGuard.showEmpty ? (
              emptyState || (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
                  Select or create a project to view this section.
                </div>
              )
            ) : (
              children
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

MainLayout.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string.isRequired,
  filters: PropTypes.oneOfType([PropTypes.node, PropTypes.bool]).isRequired,
  breadcrumbs: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      href: PropTypes.string.isRequired,
      current: PropTypes.bool.isRequired,
    }).isRequired
  ).isRequired,
  children: PropTypes.node.isRequired,
  requireProject: PropTypes.bool,
  emptyState: PropTypes.node,
};

MainLayout.defaultProps = {
  description: "",
  filters: false,
  breadcrumbs: [],
  requireProject: true,
  emptyState: null,
};
