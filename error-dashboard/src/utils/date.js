export function formatRelativeTime(value) {
  if (!value) {
    return "unknown time";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown time";
  }

  const now = Date.now();
  const diffMs = date.getTime() - now;
  const diffSeconds = Math.round(diffMs / 1000);
  const absSeconds = Math.abs(diffSeconds);

  const thresholds = [
    { limit: 60, divisor: 1, unit: "second" },
    { limit: 3600, divisor: 60, unit: "minute" },
    { limit: 86400, divisor: 3600, unit: "hour" },
    { limit: 604800, divisor: 86400, unit: "day" },
    { limit: 2629800, divisor: 604800, unit: "week" },
    { limit: 31557600, divisor: 2629800, unit: "month" },
  ];

  const match = thresholds.find((entry) => absSeconds < entry.limit) || {
    divisor: 31557600,
    unit: "year",
  };

  const valueInUnit = Math.round(diffSeconds / match.divisor);

  try {
    const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    return formatter.format(valueInUnit, match.unit);
  } catch (error) {
    const suffix = diffSeconds < 0 ? "ago" : "from now";
    return `${Math.abs(valueInUnit)} ${match.unit}${Math.abs(valueInUnit) === 1 ? "" : "s"} ${suffix}`;
  }
}

export default formatRelativeTime;
