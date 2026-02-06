import PropTypes from "prop-types";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const SESSION_KEY = "em-demo-session";
const USERS_KEY = "em-demo-users";

const AuthContext = createContext(undefined);

const readStore = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error("Failed to parse auth storage", error);
    return fallback;
  }
};

const writeStore = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error("Failed to write auth storage", error);
  }
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readStore(SESSION_KEY, null));
  const [users, setUsers] = useState(() => readStore(USERS_KEY, []));

  useEffect(() => {
    writeStore(SESSION_KEY, session);
  }, [session]);

  useEffect(() => {
    writeStore(USERS_KEY, users);
  }, [users]);

  const signup = ({ email, password, role }) => {
    const normalizedEmail = (email || "").trim().toLowerCase();
    if (!normalizedEmail || !password || !role) {
      throw new Error("Email, password, and role are required.");
    }
    const exists = users.some((user) => user.email === normalizedEmail);
    if (exists) {
      throw new Error("An account with this email already exists.");
    }
    const nextUsers = [...users, { email: normalizedEmail, password, role }];
    setUsers(nextUsers);
    setSession({ email: normalizedEmail, role });
    return { email: normalizedEmail, role };
  };

  const login = ({ email, password }) => {
    const normalizedEmail = (email || "").trim().toLowerCase();
    const record = users.find((user) => user.email === normalizedEmail && user.password === password);
    if (!record) {
      throw new Error("Invalid email or password.");
    }
    setSession({ email: normalizedEmail, role: record.role });
    return { email: normalizedEmail, role: record.role };
  };

  const logout = () => setSession(null);

  const value = useMemo(
    () => ({
      user: session,
      isAuthenticated: Boolean(session),
      role: session?.role || null,
      login,
      signup,
      logout,
    }),
    [session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
