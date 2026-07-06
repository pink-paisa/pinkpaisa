import { Component, ErrorInfo, ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string | number;
  title?: string;
  description?: string;
  actionLabel?: string;
  className?: string;
  onReset?: () => void;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Section render failed", error, errorInfo);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className={this.props.className || "rounded-2xl border border-border bg-card p-6 text-center shadow-sm"}>
        <h2 className="font-serif text-xl">{this.props.title || "This section could not load"}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {this.props.description || "Something in this view failed to render. Reload this section to try again."}
        </p>
        <button
          type="button"
          onClick={this.handleReset}
          className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {this.props.actionLabel || "Reload this section"}
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
