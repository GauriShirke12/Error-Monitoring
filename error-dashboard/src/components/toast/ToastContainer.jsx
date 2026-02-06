import { createContext, useCallback, useContext, useMemo, useState } from "react";
import PropTypes from "prop-types";
import clsx from "clsx";

const ToastContext = createContext({
  addToast: () => {},
  removeToast: () => {},
});

let idCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((toast) => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, ...toast }]);
    if (toast.timeout !== false) {
      const timeout = typeof toast.timeout === "number" ? toast.timeout : 4000;
      setTimeout(() => removeToast(id), timeout);
    }
    return id;
  }, [removeToast]);

  const value = useMemo(() => ({ addToast, removeToast }), [addToast, removeToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[999] flex flex-col items-center gap-3 px-4">
        {toasts.map((toast) => (
          <article
            key={toast.id}
            className={clsx(
              "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-xl shadow-black/40 backdrop-blur",
              toast.variant === "success" && "border-emerald-500/40 bg-emerald-500/20 text-emerald-50",
              toast.variant === "error" && "border-rose-500/40 bg-rose-500/20 text-rose-50",
              (!toast.variant || toast.variant === "info") && "border-slate-700 bg-slate-900/80 text-slate-100"
            )}
          >
            <div className="flex-1">
              <h4 className="text-sm font-semibold leading-tight">{toast.title}</h4>
              {toast.description ? (
                <p className="mt-1 text-xs text-white/80">{toast.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Close notification"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6l-12 12"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

ToastProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useToast() {
  return useContext(ToastContext);
}
