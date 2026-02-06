const PROJECT_KEY = 'error-monitor.activeProjectId';

export function getStoredProjectId() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage.getItem(PROJECT_KEY);
  } catch (error) {
    return null;
  }
}

export function setStoredProjectId(projectId) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    if (projectId) {
      window.localStorage.setItem(PROJECT_KEY, projectId);
    } else {
      window.localStorage.removeItem(PROJECT_KEY);
    }
  } catch (error) {
    // Storage access is best effort only
  }
}

export function clearStoredProjectId() {
  setStoredProjectId(null);
}
