/** Catches render crashes so the arena never shows a blank screen. */
import {AlertTriangle, RefreshCw} from 'lucide-react';
import {Component} from 'react';
import type {ErrorInfo, ReactNode} from 'react';
import {Button} from './ui';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the failure in the console for debugging, then keep the UI usable.
    console.error(`[arena] ${this.props.label ?? 'view'} crashed:`, error.message, info.componentStack);
  }

  render(): ReactNode {
    const {error} = this.state;
    if (!error) return this.props.children;

    return (
      <div className="aurora grid min-h-dvh place-items-center p-5">
        <div className="glass-strong w-full max-w-md rounded-3xl p-7 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-flare-500/16 text-flare-300">
            <AlertTriangle className="size-8" />
          </span>
          <h1 className="mt-5 text-xl font-black tracking-tight text-mist-50">The arena hit a snag</h1>
          <p className="mt-2 text-[0.86rem] font-medium leading-relaxed text-mist-400">
            {error.message || 'Something unexpected happened while rendering this screen.'}
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Button
              block
              onClick={() => this.setState({error: null})}
              icon={<RefreshCw className="size-4" />}
            >
              Try this screen again
            </Button>
            <Button block variant="outline" onClick={() => window.location.reload()}>
              Reload the arena
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
