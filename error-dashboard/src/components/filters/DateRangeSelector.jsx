import { Fragment, useMemo } from "react";

const RANGE_OPTIONS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
];

export function DateRangeSelector({ value, onChange, customRange, onCustomRangeChange, error, disabled = false }) {
  const currentCustomRange = useMemo(
    () => ({
      start: customRange?.start ?? "",
      end: customRange?.end ?? "",
    }),
    [customRange]
  );

  const handleCustomChange = (key, nextValue) => {
    if (typeof onCustomRangeChange !== "function") {
      return;
    }
    onCustomRangeChange({ ...currentCustomRange, [key]: nextValue });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          disabled={disabled}
          className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {RANGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {value === "custom" ? (
          <Fragment>
            <input
              type="date"
              value={currentCustomRange.start}
              onChange={(event) => handleCustomChange("start", event.target.value)}
              disabled={disabled}
              className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <span className="text-xs text-slate-500">to</span>
            <input
              type="date"
              value={currentCustomRange.end}
              onChange={(event) => handleCustomChange("end", event.target.value)}
              disabled={disabled}
              className="rounded-lg border border-slate-700 bg-canvas-subtle px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
          </Fragment>
        ) : null}
      </div>
      {value === "custom" ? (
        <span className={`text-xs ${error ? "text-rose-400" : "text-slate-500"}`}>
          {error ?? "Select a window between 1 and 90 days."}
        </span>
      ) : null}
    </div>
  );
}
