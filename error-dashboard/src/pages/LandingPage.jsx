import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const features = [
  {
    title: "Instant anomaly alerts",
    description: "Receive glassy, in-context alerts the moment your error rate spikes across any environment.",
  },
  {
    title: "Deep correlation insights",
    description: "Trace issues back to releases, teams, and regions with rich analytics built for fast triage.",
  },
  {
    title: "Unified team workspace",
    description: "Collaborate with engineering, QA, and support in a single, live dashboard experience.",
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuth();

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 top-0 h-[520px] w-[520px] rounded-full bg-purple-700/30 blur-3xl" />
        <div className="absolute right-[-14%] top-24 h-[420px] w-[420px] rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="absolute left-1/2 top-[-18%] h-[620px] w-[620px] -translate-x-1/2 rounded-full bg-purple-500/30 blur-[220px]" />
        <div className="absolute bottom-[-25%] left-1/3 h-[560px] w-[560px] rounded-full bg-indigo-500/25 blur-[180px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-black/20 to-black" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 py-6 lg:px-12">
          <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-widest text-slate-300">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent-soft text-base text-white shadow-xl shadow-accent/40">
              EM
            </span>
            <span className="text-xs font-semibold text-slate-400">Error Monitor</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-slate-300 lg:flex">
            <span className="cursor-default text-slate-400">Product</span>
            <span className="cursor-default text-slate-400">Docs</span>
            <span className="cursor-default text-slate-400">Pricing</span>
            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => {
                  logout();
                  navigate("/", { replace: true });
                }}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-[0_20px_60px_-35px_rgba(139,92,246,0.7)] transition-transform hover:scale-[1.02] hover:border-rose-400 hover:text-rose-100"
              >
                Logout
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="rounded-full border border-accent/40 bg-accent/40 px-4 py-2 text-sm font-semibold text-white shadow-[0_20px_60px_-35px_rgba(139,92,246,0.9)] transition-transform hover:scale-[1.02]"
              >
                Sign in
              </button>
            )}
          </nav>
        </header>

        <main className="flex flex-1 flex-col items-center px-6 pb-16 pt-10 lg:px-12 lg:pt-12">
          <div className="max-w-3xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-300">Full-stack observability</span>
            <h1 className="mt-6 text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
              See issues the instant they happen. Ship fixes before users notice.
            </h1>
            <p className="mt-6 text-base text-slate-300 sm:text-lg">
              Monitor, investigate, and resolve errors with a dashboard built for the neon night shift. Precision insights, live collaboration, and a purple-black aesthetic that keeps you in the flow.
            </p>
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="w-full rounded-full border border-accent/50 bg-accent px-6 py-3 text-sm font-semibold uppercase tracking-wide text-black shadow-[0_30px_90px_-45px_rgba(139,92,246,1)] transition-transform hover:scale-[1.02] hover:shadow-[0_40px_120px_-50px_rgba(139,92,246,1)] sm:w-auto"
              >
                Get started for free
              </button>
              <button
                type="button"
                className="w-full rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-slate-100 transition-colors hover:border-white/25 hover:bg-white/10 sm:w-auto"
              >
                Watch product tour
              </button>
            </div>
          </div>

          <div className="mt-16 flex w-full justify-center">
            <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 shadow-[0_60px_160px_-80px_rgba(139,92,246,0.95)] backdrop-blur-2xl">
              <div className="flex flex-col gap-6 md:flex-row md:items-start">
                <div className="flex-1 space-y-4">
                  <div className="rounded-2xl border border-accent/30 bg-black/60 p-5 shadow-inner shadow-accent/20">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Last 24 hours</p>
                    <p className="mt-2 text-3xl font-semibold text-white">98.2% stability</p>
                    <p className="mt-2 text-xs font-semibold text-emerald-300">↑ 12% vs previous period</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Live activity</p>
                    <p className="mt-2 text-base text-slate-200">Teams are resolving incidents in under 8 minutes on average.</p>
                    <div className="mt-4 flex items-center gap-3 text-xs text-slate-300">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-soft text-black font-semibold">AL</span>
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-sky-400 text-black font-semibold">QA</span>
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-400 text-black font-semibold">DB</span>
                    </div>
                  </div>
                </div>
                <div className="flex-1 space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Realtime errors</p>
                    <ul className="mt-3 space-y-2 text-sm text-slate-200">
                      <li className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2">
                        <span className="truncate">Unhandled promise rejection</span>
                        <span className="text-xs text-emerald-300">Solved</span>
                      </li>
                      <li className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2">
                        <span className="truncate">API rate limit exceeded</span>
                        <span className="text-xs text-amber-300">Investigating</span>
                      </li>
                      <li className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2">
                        <span className="truncate">Frontend hydration mismatch</span>
                        <span className="text-xs text-rose-300">New</span>
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-accent/30 bg-black/60 p-5 shadow-inner shadow-accent/20">
                    <p className="text-xs uppercase tracking-wide text-slate-400">Response time</p>
                    <p className="mt-2 text-3xl font-semibold text-white">352 ms</p>
                    <p className="mt-2 text-xs font-semibold text-emerald-300">↑ 6% faster this week</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section className="mt-20 grid w-full max-w-5xl gap-6 md:grid-cols-3">
            {features.map((feature) => (
              <article key={feature.title} className="rounded-2xl border border-white/10 bg-white/5 p-6 text-left shadow-[0_30px_80px_-60px_rgba(139,92,246,0.8)]">
                <h3 className="text-base font-semibold text-white">{feature.title}</h3>
                <p className="mt-3 text-sm text-slate-300">{feature.description}</p>
              </article>
            ))}
          </section>
        </main>

        <footer className="px-6 pb-10 pt-8 text-xs text-slate-500 lg:px-12">
          <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 sm:flex-row">
            <p>© {new Date().getFullYear()} Error Monitor. Built for teams that never sleep.</p>
            <div className="flex items-center gap-4">
              <span className="cursor-default">Security</span>
              <span className="cursor-default">Status</span>
              <span className="cursor-default">Contact</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
