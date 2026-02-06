export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepFreeze(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}
