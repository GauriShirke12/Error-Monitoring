const TOKEN_KEY = "error-monitor.authToken";

export function getAuthToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch (error) {
    return null;
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch (error) {
    // intentionally swallow storage errors
  }
}

export function clearAuthToken() {
  setAuthToken(null);
}
