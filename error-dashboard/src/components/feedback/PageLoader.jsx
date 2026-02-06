import PropTypes from "prop-types";

export function PageLoader({ label }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/50 text-slate-300">
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-r-transparent" />
        <span className="text-sm font-medium">{label}</span>
      </div>
    </div>
  );
}

PageLoader.propTypes = {
  label: PropTypes.string.isRequired,
};

PageLoader.defaultProps = {
  label: "Loading dashboard data...",
};
