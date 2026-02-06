import PropTypes from "prop-types";
import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { Breadcrumbs } from "../navigation/Breadcrumbs";
import { ProjectSwitcher } from "../projects/ProjectSwitcher";

export function Header({
  title,
  description,
  filters,
  breadcrumbs,
  onToggleSidebar,
}) {
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="relative w-full box-border overflow-hidden rounded-b-3xl border-b border-white/10 bg-gradient-to-br from-[#150633e6] via-[#0d041f] to-[#0a0319] shadow-[0_24px_60px_-40px_rgba(124,58,237,0.7)]">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute left-[-10%] top-[-40%] h-64 w-64 rounded-full bg-accent/30 blur-3xl" />
        <div className="absolute right-[-18%] top-[-10%] h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute left-1/2 top-[-30%] h-96 w-96 -translate-x-1/2 rounded-full bg-indigo-600/30 blur-[160px]" />
      </div>
      <div className="flex items-center justify-between px-4 py-4 lg:hidden">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-accent"
        >
          <span className="flex flex-col gap-1">
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
          </span>
          <span className="sr-only">Toggle navigation</span>
        </button>
        <div className="flex w-full items-center justify-between gap-3 text-sm text-slate-300">
          <div className="flex-1">
            <ProjectSwitcher variant="inline" showManage={false} />
          </div>
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-accent to-accent-soft shadow-lg shadow-accent/40" />
        </div>
      </div>
      <div className="flex w-full flex-col gap-6 px-6 pb-6 pt-2 lg:px-10">
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex min-w-0 flex-col gap-3">
            {breadcrumbs && breadcrumbs.length ? (
              <Breadcrumbs items={breadcrumbs} />
            ) : null}
            <div>
              <h1 className="text-2xl font-semibold text-white lg:text-3xl whitespace-nowrap">{title}</h1>
              {description ? (
                <p className="mt-1 text-sm text-slate-300">{description}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-200 shadow-[0_10px_30px_-22px_rgba(16,185,129,0.8)]">Live ingest</span>
              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-200">99.98% uptime</span>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-4">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:gap-3 lg:w-auto lg:flex-nowrap">
              <div className="relative min-w-[220px] flex-1 lg:min-w-[260px] lg:max-w-md">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="m16.5 16.5 3 3" strokeLinecap="round" />
                    <circle cx="11.5" cy="11.5" r="5.5" />
                  </svg>
                </span>
                <input
                  type="search"
                  placeholder="Search errors"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-10 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-accent focus:outline-none"
                />
              </div>
              <div className="hidden min-w-[180px] lg:block">
                <ProjectSwitcher variant="inline" />
              </div>
              <div className="hidden shrink-0 items-center gap-3 lg:flex">
                {!filters ? (
                  <select className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-200 focus:border-accent focus:outline-none">
                    <option>Production</option>
                    <option>Staging</option>
                    <option>Development</option>
                  </select>
                ) : null}
                {isAuthenticated ? (
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-soft text-sm font-semibold text-black">
                      ME
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        logout();
                        navigate("/", { replace: true });
                      }}
                      className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-rose-400 hover:text-white"
                    >
                      Logout
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {filters ? <Fragment>{filters}</Fragment> : null}
          </div>
        </div>
      </div>
    </header>
  );
}

Header.propTypes = {
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
  onToggleSidebar: PropTypes.func.isRequired,
};

Header.defaultProps = {
  description: "",
  filters: false,
  breadcrumbs: [],
  onToggleSidebar: () => {},
};
