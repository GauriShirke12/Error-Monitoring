import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function SignupPage() {
  const { signup, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/overview", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      signup({ email, password, role });
      navigate("/overview", { replace: true });
    } catch (authError) {
      setError(authError.message || "Signup failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0b051a] via-[#0a0627] to-[#0a0319] px-4 py-12 text-slate-100">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-white/10 bg-white/5 p-8 shadow-[0_30px_100px_-60px_rgba(139,92,246,1)] backdrop-blur-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">ErrMon</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">Create account</h1>
            <p className="text-sm text-slate-400">Choose a role and password.</p>
          </div>
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-soft text-lg font-semibold text-black shadow-lg shadow-accent/40">
            EM
          </span>
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="text-xs uppercase text-slate-400">Email</span>
            <input
              type="email"
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase text-slate-400">Password</span>
            <input
              type="password"
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs uppercase text-slate-400">Role</span>
            <select
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-100 focus:border-accent focus:outline-none"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-accent to-accent-soft px-4 py-2 text-sm font-semibold text-black shadow-[0_20px_60px_-35px_rgba(139,92,246,1)] transition-transform hover:translate-y-[-1px] disabled:opacity-60"
          >
            {loading ? "Creating…" : "Sign up"}
          </button>
        </form>

        <p className="text-center text-sm text-slate-400">
          Already have an account? <Link to="/login" className="text-accent-soft hover:text-accent">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
