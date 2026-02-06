const API_KEY_VALUE = "error-monitor.apiKey";
const API_KEY_PROJECT = "error-monitor.apiKey.project";

export function getStoredApiKey(projectId) {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    const storedProjectId = window.localStorage.getItem(API_KEY_PROJECT);
    if (storedProjectId && projectId && storedProjectId !== projectId) {
      return null;
    }
    return window.localStorage.getItem(API_KEY_VALUE);
  } catch (error) {
    return null;
  }
}

export function setStoredApiKey(apiKey, projectId) {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    if (apiKey) {
      window.localStorage.setItem(API_KEY_VALUE, apiKey);
      if (projectId) {
        window.localStorage.setItem(API_KEY_PROJECT, projectId);
      }
    } else {
      window.localStorage.removeItem(API_KEY_VALUE);
      window.localStorage.removeItem(API_KEY_PROJECT);
    }
  } catch (error) {
    // best-effort storage
  }
}

export function clearStoredApiKey() {
  setStoredApiKey(null, null);
}
