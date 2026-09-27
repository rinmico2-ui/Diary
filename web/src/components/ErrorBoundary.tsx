import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

/**
 * A React render crash used to produce a completely blank page, which is
 * impossible to diagnose and terrible to experience. This turns any such crash
 * into a readable message with a way out.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app error]', error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  private reset = () => {
    this.setState({ error: null, info: null });
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center px-5 py-10">
        <div className="w-full max-w-lg rounded-card border border-line bg-surface p-6 text-center shadow-card">
          <p className="text-3xl" aria-hidden>
            🌙
          </p>
          <h1 className="mt-3 font-sans text-lg text-ink">Something went wrong on this screen</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            Nothing is lost — everything you saved is safe on the server. This is a problem with the page you were
            looking at, not with your memories.
          </p>

          <details className="mt-5 text-left">
            <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-soft">
              Show technical details
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-sunk p-3 text-[11px] leading-relaxed text-ink-soft">
              {error.message}
              {info ? `\n\n${info.trim().split('\n').slice(0, 12).join('\n')}` : ''}
            </pre>
          </details>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button type="button" onClick={this.reset} className="btn-primary">
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="btn-secondary"
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
