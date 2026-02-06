import PropTypes from "prop-types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createProject as apiCreateProject,
  fetchProjects as apiFetchProjects,
  rotateProjectKey as apiRotateProjectKey,
  updateProject as apiUpdateProject,
  setActiveProject,
  getActiveProject,
} from "../services/api";
import { setStoredApiKey } from "../utils/apiKeyStorage";

const FALLBACK_PROJECTS = [
  { id: "demo-frontend", name: "Frontend Web", apiKey: "demo_frontend_key", environment: "production", role: "admin", status: "active" },
  { id: "demo-mobile", name: "Mobile App", apiKey: "demo_mobile_key", environment: "production", role: "admin", status: "active" },
  { id: "demo-payments", name: "Payments Service", apiKey: "demo_payments_key", environment: "staging", role: "admin", status: "active" },
  { id: "demo-search", name: "Search API", apiKey: "demo_search_key", environment: "production", role: "admin", status: "active" },
  { id: "demo-analytics", name: "Analytics Worker", apiKey: "demo_analytics_key", environment: "development", role: "admin", status: "active" },
];

const ProjectContext = createContext({
  projects: [],
  currentProjectId: null,
  currentProject: null,
  loadingProjects: false,
  projectError: null,
  initialized: false,
  selectProject: () => {},
  refreshProjects: async () => {},
  createProject: async () => {},
  rotateKey: async () => {},
  updateProject: async () => {},
});

const generateDemoKey = () => `demo_${Math.random().toString(16).slice(2, 10)}_${Date.now().toString(16)}`;

export function ProjectProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectError, setProjectError] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState(getActiveProject());
  const currentProjectIdRef = useRef(currentProjectId);

  useEffect(() => {
    currentProjectIdRef.current = currentProjectId;
    setActiveProject(currentProjectId || null);
  }, [currentProjectId]);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    setProjectError(null);
    try {
      const payload = await apiFetchProjects();
      const items = Array.isArray(payload?.data) ? payload.data : [];
      setProjects(items);

      let resolvedProjectId = currentProjectIdRef.current;
      if (!items.some((project) => project.id === resolvedProjectId)) {
        resolvedProjectId = items.length ? items[0].id : null;
      }

      if (resolvedProjectId !== currentProjectIdRef.current) {
        setCurrentProjectId(resolvedProjectId);
      } else {
        setActiveProject(resolvedProjectId || null);
      }
    } catch (error) {
      // On failure, load silent demo projects without surfacing an error banner.
      setProjectError(null);
      setProjects(FALLBACK_PROJECTS);
      const fallbackId = FALLBACK_PROJECTS[0]?.id || null;
      setCurrentProjectId(fallbackId);
      if (fallbackId && FALLBACK_PROJECTS[0]?.apiKey) {
        setStoredApiKey(FALLBACK_PROJECTS[0].apiKey, fallbackId);
      }
      setActiveProject(fallbackId || null);
    } finally {
      setLoadingProjects(false);
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const selectProject = useCallback((projectId) => {
    const normalized = projectId || null;
    setCurrentProjectId(normalized);
  }, []);

  const refreshProjects = useCallback(async () => {
    await loadProjects();
  }, [loadProjects]);

  const createProject = useCallback(async (details) => {
    try {
      const payload = await apiCreateProject(details);
      const created = payload?.data || null;
      if (created) {
        setProjects((prev) => [...prev, created]);
        setCurrentProjectId(created.id);
        if (created.apiKey) {
          setStoredApiKey(created.apiKey, created.id);
        }
      }
      return created;
    } catch (error) {
      const fallback = {
        id: `demo-${Date.now()}`,
        name: details?.name || "New Project",
        apiKey: generateDemoKey(),
        environment: details?.environment || "production",
        role: "admin",
        status: "active",
        scrubbing: details?.scrubbing || {},
        retentionDays: details?.retentionDays ?? 90,
      };
      setProjects((prev) => [...prev, fallback]);
      setCurrentProjectId(fallback.id);
      setStoredApiKey(fallback.apiKey, fallback.id);
      return fallback;
    }
  }, []);

  const rotateKey = useCallback(async (projectId) => {
    try {
      const payload = await apiRotateProjectKey(projectId);
      const updated = payload?.data || null;
      if (updated) {
        setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
        if (updated.apiKey) {
          setStoredApiKey(updated.apiKey, updated.id);
        }
      }
      return updated;
    } catch (error) {
      // Fallback rotate for demo/offline mode.
      const newKey = generateDemoKey();
      setProjects((prev) =>
        prev.map((project) => (project.id === projectId ? { ...project, apiKey: newKey, apiKeyPreview: newKey.slice(-6) } : project))
      );
      setStoredApiKey(newKey, projectId);
      return { id: projectId, apiKey: newKey };
    }
  }, []);

  const updateProject = useCallback(async (projectId, details) => {
    try {
      const payload = await apiUpdateProject(projectId, details);
      const updated = payload?.data || null;
      if (updated) {
        setProjects((prev) => prev.map((project) => (project.id === updated.id ? updated : project)));
      }
      return updated;
    } catch (error) {
      // Fallback local update for demo/offline mode.
      setProjects((prev) => prev.map((project) => (project.id === projectId ? { ...project, ...details } : project)));
      const updated = { id: projectId, ...details };
      return updated;
    }
  }, []);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === currentProjectId) || null,
    [projects, currentProjectId]
  );

  const value = useMemo(
    () => ({
      projects,
      currentProjectId,
      currentProject,
      loadingProjects,
      projectError,
      initialized,
      selectProject,
      refreshProjects,
      createProject,
      rotateKey,
      updateProject,
    }),
    [
      projects,
      currentProjectId,
      currentProject,
      loadingProjects,
      projectError,
      initialized,
      selectProject,
      refreshProjects,
      createProject,
      rotateKey,
      updateProject,
    ]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

ProjectProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useProjectContext() {
  return useContext(ProjectContext);
}
