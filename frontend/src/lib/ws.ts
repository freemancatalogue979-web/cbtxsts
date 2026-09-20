/**
 * Resilient websocket client for the live channel and duel rooms.
 * Reconnects with backoff, announces status changes, and fans events out to
 * any number of subscribers.
 */
export type WsStatus = 'connecting' | 'open' | 'closed';

export interface WsMessage {
  event: string;
  data?: unknown;
}

type Handler = (data: unknown, message: WsMessage) => void;

/**
 * The backend authenticates sockets from the ``token`` query parameter, so it
 * is appended here rather than sent as a message after connecting.
 */
export function wsUrl(path = '/ws/live', token?: string | null): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(`${protocol}//${window.location.host}${path}`);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

interface LiveSocketOptions {
  token: string;
  path?: string;
  onEvent?: (event: string, data: unknown) => void;
  onStatus?: (status: WsStatus) => void;
}

export class LiveSocket {
  private socket: WebSocket | null = null;

  private handlers = new Map<string, Set<Handler>>();

  private retries = 0;

  private timer: number | null = null;

  private heartbeat: number | null = null;

  private stopped = false;

  private rooms = new Set<string>();

  constructor(private readonly options: LiveSocketOptions) {}

  connect(): void {
    this.stopped = false;
    this.open();
  }

  private open(): void {
    if (this.stopped || !this.options.token) return;
    this.options.onStatus?.('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl(this.options.path, this.options.token));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.retries = 0;
      this.options.onStatus?.('open');
      // Duel rooms are separate authenticated sockets; nothing to re-join here.
      this.heartbeat = window.setInterval(() => this.send({type: 'ping'}), 20_000);
    };

    socket.onmessage = (event) => {
      let message: WsMessage;
      try {
        message = JSON.parse(String(event.data)) as WsMessage;
      } catch {
        return;
      }
      const name = message.event;
      if (name === 'pong' || name === 'ack' || name === 'heartbeat') return;
      this.options.onEvent?.(name, message.data);
      this.handlers.get(name)?.forEach((handler) => handler(message.data, message));
      this.handlers.get('*')?.forEach((handler) => handler(message.data, message));
    };

    socket.onclose = () => {
      this.clearHeartbeat();
      this.options.onStatus?.('closed');
      this.socket = null;
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      // Never close() from inside the error handler: undici/browser implementations
      // can re-dispatch the error and recurse. onclose drives the reconnect.
      try {
        if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close();
      } catch {
        /* already tearing down */
      }
    };
  }

  /**
   * Come back immediately instead of waiting out the backoff.
   *
   * Phones fire this when the tab is shown again, when the network returns or
   * when the window regains focus — the socket is usually half-dead by then
   * (the OS suspended it), so we tear it down and dial again straight away and
   * ask for a fresh presence snapshot. No page reload, no lost state.
   */
  resume(): void {
    if (this.stopped || !this.options.token) return;
    const state = this.socket?.readyState;
    if (state === WebSocket.OPEN) {
      this.send({type: 'presence'});
      return;
    }
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.retries = 0;
    this.clearHeartbeat();
    try {
      this.socket?.close();
    } catch {
      /* already torn down */
    }
    this.socket = null;
    this.open();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.timer !== null) return;
    this.retries += 1;
    const delay = Math.min(12_000, 700 * 2 ** Math.min(this.retries, 4));
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat !== null) {
      window.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  send(payload: Record<string, unknown>): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  /** Request a fresh presence broadcast from the server. */
  requestPresence(): void {
    this.send({type: 'presence'});
  }

  on(event: string, handler: Handler): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler);
      if (!set.size) this.handlers.delete(event);
    };
  }

  close(): void {
    this.stopped = true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.clearHeartbeat();
    this.rooms.clear();
    this.handlers.clear();
    this.socket?.close();
    this.socket = null;
    this.options.onStatus?.('closed');
  }
}
