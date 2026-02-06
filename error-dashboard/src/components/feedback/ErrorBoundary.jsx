import PropTypes from "prop-types";
import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (typeof this.props.onError === "function") {
      this.props.onError(error, info);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false });
    if (typeof this.props.onReset === "function") {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-16 text-center text-slate-200">
          <span className="text-sm uppercase tracking-wide text-rose-300/80">Something went wrong</span>
          <h2 className="mt-2 text-2xl font-semibold text-white">We could not load this section</h2>
          <p className="mt-4 max-w-md text-sm text-rose-100/80">
            Try refreshing the page. If the issue persists, check the logs or contact support.
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-6 rounded-lg border border-rose-300/40 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-white hover:border-rose-300"
          >
            Retry load
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  onError: PropTypes.func.isRequired,
  onReset: PropTypes.func.isRequired,
};

ErrorBoundary.defaultProps = {
  onError: () => {},
  onReset: () => {},
};
