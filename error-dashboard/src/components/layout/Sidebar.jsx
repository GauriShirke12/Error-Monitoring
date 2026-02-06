import clsx from "clsx";
import PropTypes from "prop-types";
import { NavLink } from "react-router-dom";
import { ProjectSwitcher } from "../projects/ProjectSwitcher";

function OverviewIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="3.75" y="3.75" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.75" y="3.75" width="6.5" height="6.5" rx="1.5" />
      <rect x="3.75" y="13.75" width="6.5" height="6.5" rx="1.5" />
      <path d="M15 13.5h5.25M15 17h5.25" strokeLinecap="round" />
    </svg>
  );
}

function ErrorsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M12 4.5 4.5 9v6L12 19.5 19.5 15V9z" />
      <path d="m9 10.5 6 3" strokeLinecap="round" />
    </svg>
  );
}

function AnalyticsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M4.5 19.5V6" />
      <path d="M9.5 19.5V10" />
      <path d="M14.5 19.5V12" />
      <path d="M19.5 19.5V4.5" />
    </svg>
  );
}

function ReportsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M7.5 3.75h6L18 8.25v12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20.25V5.25a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M13.5 3.75V8.5h4.75" />
      <path d="M9 12h6M9 15.5h6M9 19h3" strokeLinecap="round" />
    </svg>
  );
}

function TeamIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M9 10.5a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z" />
      <path d="M4.5 9.75a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0Z" />
      <path d="M15 18.75a3.75 3.75 0 0 0-6 0M18.75 18.75a2.625 2.625 0 0 0-4.2-2.106" strokeLinecap="round" />
      <path d="M6 16.5a2.625 2.625 0 0 0-2.625 2.25" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M12 14.25a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5Z" />
      <path d="M6.5 6.5 5.5 4.5M17.5 6.5l1-2" strokeLinecap="round" />
      <path d="M6.5 17.5 5.5 19.5M17.5 17.5l1 2" strokeLinecap="round" />
      <path d="M3.75 12H5.5M18.5 12h1.75" strokeLinecap="round" />
      <path d="M12 3.75V5.5M12 18.5v1.75" strokeLinecap="round" />
      <path d="M8.5 5.5 7 7M15.5 5.5 17 7" strokeLinecap="round" />
      <path d="M8.5 18.5 7 17M15.5 18.5 17 17" strokeLinecap="round" />
    </svg>
  );
}

const navItems = [
  { to: "/overview", label: "Overview", icon: OverviewIcon },
  { to: "/errors", label: "Errors", icon: ErrorsIcon },
  { to: "/analytics", label: "Analytics", icon: AnalyticsIcon },
  { to: "/reports", label: "Reports", icon: ReportsIcon },
  { to: "/team", label: "Team", icon: TeamIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar({ className, onNavigate }) {
  return (
    <aside className={clsx("sidebar-panel flex h-full w-72 flex-col gap-8 p-6 text-slate-200", className)}>
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-[0_20px_70px_-50px_rgba(139,92,246,0.9)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-soft text-lg font-semibold text-black shadow-lg shadow-accent/40">
            EM
          </div>
          <div className="leading-tight">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">ErrMon</p>
            <p className="text-sm font-semibold text-white">Control Center</p>
          </div>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Live
        </span>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <ProjectSwitcher />
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            end={item.to === "/overview"}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                "group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-150",
                isActive
                  ? "bg-gradient-to-r from-accent to-accent-soft text-black shadow-lg shadow-accent/40"
                  : "text-slate-300 hover:bg-white/10 hover:shadow-[0_12px_45px_-38px_rgba(139,92,246,0.8)]"
              )
            }
            onClick={onNavigate}
          >
            {({ isActive }) => (
              <>
                <span
                  className={clsx(
                    "flex h-9 w-9 items-center justify-center rounded-xl border text-sm",
                    "border-white/10 bg-white/5",
                    "shadow-[0_10px_30px_-22px_rgba(139,92,246,0.8)]",
                    isActive ? "border-transparent bg-white/10 text-black" : "text-slate-200"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                </span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-fuchsia-500 via-accent to-sky-400 px-4 py-3 text-left text-sm font-semibold text-black shadow-[0_20px_60px_-40px_rgba(139,92,246,1)] transition-transform hover:translate-y-[-1px]"
        >
          <span>New alert rule</span>
          <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px] uppercase tracking-wide text-white">Beta</span>
        </button>
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <a href="#support" className="transition-colors hover:text-white">
            Support
          </a>
          <a href="#docs" className="transition-colors hover:text-white">
            Docs
          </a>
        </div>
      </div>
    </aside>
  );
}

Sidebar.propTypes = {
  className: PropTypes.string.isRequired,
  onNavigate: PropTypes.func.isRequired,
};

Sidebar.defaultProps = {
  className: "",
  onNavigate: () => {},
};
