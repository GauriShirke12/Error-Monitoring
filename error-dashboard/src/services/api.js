import axios from "axios";
import { clearAuthToken, getAuthToken, setAuthToken as persistToken } from "../utils/tokenStorage";
import { clearStoredProjectId, getStoredProjectId, setStoredProjectId } from "../utils/projectStorage";
import { getStoredApiKey, clearStoredApiKey } from "../utils/apiKeyStorage";

const API_BASE_URL = (typeof window === "undefined" ? undefined : window.__EM_API_BASE_URL__) ?? process.env.REACT_APP_API_URL ?? "http://localhost:4000/api";

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

let activeProjectId = typeof window === "undefined" ? null : getStoredProjectId();

export function setActiveProject(projectId) {
  activeProjectId = projectId || null;
  if (activeProjectId) {
    setStoredProjectId(activeProjectId);
  } else {
    clearStoredProjectId();
  }
}

export function getActiveProject() {
  return activeProjectId || null;
}

apiClient.interceptors.request.use(
  (config) => {
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const apiKey = getStoredApiKey(activeProjectId);
    if (apiKey) {
      config.headers["X-Api-Key"] = apiKey;
    } else if (config.headers["X-Api-Key"]) {
      delete config.headers["X-Api-Key"];
    }
    if (activeProjectId) {
      config.headers["X-Project-Id"] = activeProjectId;
    } else if (config.headers["X-Project-Id"]) {
      delete config.headers["X-Project-Id"];
    }
    config.headers["X-Requested-With"] = "XMLHttpRequest";
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearAuthToken();
    }
    return Promise.reject(error);
  }
);

export function setSessionToken(token) {
  persistToken(token);
}

export function resetSession() {
  clearAuthToken();
  clearStoredApiKey();
  setActiveProject(null);
}

export async function fetchProjects(config = {}) {
  const { data } = await apiClient.get("/projects", config);
  return data;
}

export async function createProject(payload, config = {}) {
  const { data } = await apiClient.post("/projects", payload, config);
  return data;
}

export async function updateProject(projectId, payload, config = {}) {
  const { data } = await apiClient.patch(`/projects/${projectId}`, payload, config);
  return data;
}

export async function rotateProjectKey(projectId, config = {}) {
  const { data } = await apiClient.post(`/projects/${projectId}/rotate-key`, {}, config);
  return data;
}

export async function fetchOverviewSummary(params = {}, config = {}) {
  const { data } = await apiClient.get("/analytics/overview", { params, ...config });
  return data;
}

export async function fetchErrorTrends(params = {}, config = {}) {
  const { data } = await apiClient.get("/analytics/trends", { params, ...config });
  return data;
}

export async function fetchTopErrors(params = {}, config = {}) {
  const { data } = await apiClient.get("/analytics/top-errors", { params, ...config });
  return data;
}

export async function fetchAnalyticsPatterns(params = {}, config = {}) {
  const { data } = await apiClient.get("/analytics/patterns", { params, ...config });
  return data;
}

export async function fetchRelatedErrors(params = {}, config = {}) {
  const { data } = await apiClient.get("/analytics/related-errors", { params, ...config });
  return data;
}

export async function fetchUserImpact(params = {}, config = {}) {
  const { data } = await apiClient.get("/analytics/user-impact", { params, ...config });
  return data;
}

export async function fetchResolutionAnalytics(params = {}, config = {}) {
  const { data } = await apiClient.get("/analytics/resolution", { params, ...config });
  return data;
}

export async function fetchErrors(params = {}, config = {}) {
  const response = await apiClient.get("/errors", { params, ...config });
  return response.data;
}

export async function fetchErrorDetail(errorId, config = {}) {
  const { data } = await apiClient.get(`/errors/${errorId}`, config);
  return data;
}

export async function updateErrorStatus(errorId, status, options = {}) {
  const payload = { status };
  if (options.changedBy) {
    payload.changedBy = options.changedBy;
  }
  const { data } = await apiClient.patch(`/errors/${errorId}`, payload);
  return data;
}

export async function deleteError(errorId, config = {}) {
  await apiClient.delete(`/errors/${errorId}`, config);
  return true;
}

export async function updateErrorAssignment(errorId, memberId) {
  const payload = {};
  if (memberId !== undefined) {
    payload.memberId = memberId;
  }
  const { data } = await apiClient.patch(`/errors/${errorId}/assignment`, payload);
  return data;
}

export async function fetchTeamMembers(params = {}, config = {}) {
  const { data } = await apiClient.get('/team/members', { params, ...config });
  return data;
}

export async function createTeamMember(payload, config = {}) {
  const { data } = await apiClient.post('/team/members', payload, config);
  return data;
}

export async function updateTeamMember(memberId, payload, config = {}) {
  const { data } = await apiClient.patch(`/team/members/${memberId}`, payload, config);
  return data;
}

export async function deleteTeamMember(memberId, config = {}) {
  await apiClient.delete(`/team/members/${memberId}`, config);
  return true;
}

export async function fetchTeamPerformance(params = {}, config = {}) {
  const { data } = await apiClient.get('/team/performance', { params, ...config });
  return data;
}

export async function requestReportGeneration(payload, config = {}) {
  const { data } = await apiClient.post('/reports/generate', payload, config);
  return data;
}

export async function fetchReportRuns(params = {}, config = {}) {
  const { data } = await apiClient.get('/reports/runs', { params, ...config });
  return data;
}

export async function createReportShare(runId, payload = {}, config = {}) {
  const { data } = await apiClient.post(`/reports/runs/${runId}/share`, payload, config);
  return data;
}

export async function deleteReportRun(runId, config = {}) {
  await apiClient.delete(`/reports/runs/${runId}`, config);
  return true;
}

export async function downloadReportRun(runId, config = {}) {
  const response = await apiClient.get(`/reports/runs/${runId}/download`, {
    responseType: 'blob',
    ...config,
  });
  return response;
}

export async function fetchReportSchedules(params = {}, config = {}) {
  const { data } = await apiClient.get('/reports/schedules', { params, ...config });
  return data;
}

export async function createReportSchedule(payload, config = {}) {
  const { data } = await apiClient.post('/reports/schedules', payload, config);
  return data;
}

export async function updateReportSchedule(scheduleId, payload, config = {}) {
  const { data } = await apiClient.patch(`/reports/schedules/${scheduleId}`, payload, config);
  return data;
}

export async function deleteReportSchedule(scheduleId, config = {}) {
  await apiClient.delete(`/reports/schedules/${scheduleId}`, config);
  return true;
}

export async function runReportScheduleNow(scheduleId, config = {}) {
  const { data } = await apiClient.post(`/reports/schedules/${scheduleId}/run`, {}, config);
  return data;
}

export async function bulkUpdateErrorStatus(errorIds, status) {
  if (!Array.isArray(errorIds) || errorIds.length === 0) {
    throw new Error("bulkUpdateErrorStatus requires at least one error id");
  }
  const payload = await Promise.all(
    errorIds.map(async (errorId) => {
      const { data } = await apiClient.patch(`/errors/${errorId}`, { status });
      return data;
    })
  );
  return payload;
}

export async function fetchAnalyticsSummary(params = {}) {
  const { data } = await apiClient.get("/analytics/summary", { params });
  return data;
}

export async function fetchAlertRules(params = {}, config = {}) {
  const { data } = await apiClient.get('/alert-rules', { params, ...config });
  return data;
}

export async function testAlertRule(ruleId, payload = {}, config = {}) {
  const { data } = await apiClient.post(`/alert-rules/${ruleId}/test`, payload, config);
  return data;
}

export default apiClient;
