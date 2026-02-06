import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/feedback/ErrorBoundary";
import { PageLoader } from "./components/feedback/PageLoader";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ErrorListPage } from "./pages/ErrorListPage";
import { ErrorDetailPage } from "./pages/ErrorDetailPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TeamPerformancePage } from "./pages/TeamPerformancePage";
import { ReportsPage } from "./pages/ReportsPage";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";

function App() {
  const withBoundary = (element) => <ErrorBoundary>{element}</ErrorBoundary>;

  return (
    <Suspense fallback={<PageLoader label="Preparing dashboard..." />}>
      <Routes>
        <Route path="/" element={withBoundary(<LandingPage />)} />
        <Route path="/login" element={withBoundary(<LoginPage />)} />
        <Route path="/signup" element={withBoundary(<SignupPage />)} />
        <Route
          path="/overview"
          element={withBoundary(
            <ProtectedRoute>
              <OverviewPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/errors"
          element={withBoundary(
            <ProtectedRoute>
              <ErrorListPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/errors/:errorId"
          element={withBoundary(
            <ProtectedRoute>
              <ErrorDetailPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/analytics"
          element={withBoundary(
            <ProtectedRoute>
              <AnalyticsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/team"
          element={withBoundary(
            <ProtectedRoute allowedRoles={["admin"]}>
              <TeamPerformancePage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/reports"
          element={withBoundary(
            <ProtectedRoute>
              <ReportsPage />
            </ProtectedRoute>
          )}
        />
        <Route
          path="/settings"
          element={withBoundary(
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          )}
        />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;
