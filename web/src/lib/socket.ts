import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';

/**
 * Single shared socket for the whole app. The session cookie authenticates the
 * handshake, so there is no token to pass around.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 6000,
    });
  }
  return socket;
}

type Handler = (payload: unknown) => void;

/** Subscribes to a realtime event for the lifetime of a component. */
export function useRealtime(event: string, handler: Handler): void {
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    const instance = getSocket();
    const listener = (payload: unknown) => saved.current(payload);
    instance.on(event, listener);
    return () => {
      instance.off(event, listener);
    };
  }, [event]);
}

export type ConnectionState = 'connecting' | 'online' | 'offline';

/** True only while the socket is actually connected. */
export function useConnectionState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    const instance = getSocket();

    const onConnect = () => setState('online');
    const onDisconnect = () => setState('offline');
    const onConnecting = () => setState('connecting');

    if (instance.connected) setState('online');
    instance.on('connect', onConnect);
    instance.on('disconnect', onDisconnect);
    instance.on('connect_error', onConnecting);
    instance.io.on('reconnect_attempt', onConnecting);

    return () => {
      instance.off('connect', onConnect);
      instance.off('disconnect', onDisconnect);
      instance.off('connect_error', onConnecting);
      instance.io.off('reconnect_attempt', onConnecting);
    };
  }, []);

  return state;
}

/** Throttled typing signal so we do not spam the socket on every keystroke. */
export function useTypingSignal(peerId: string | null) {
  const timeout = useRef<number | null>(null);
  const lastSent = useRef(0);

  useEffect(
    () => () => {
      if (timeout.current) window.clearTimeout(timeout.current);
      getSocket().emit('typing:stop');
    },
    [],
  );

  return (isTyping: boolean) => {
    if (!peerId) return;
    const now = Date.now();

    if (!isTyping) {
      getSocket().emit('typing:stop');
      if (timeout.current) window.clearTimeout(timeout.current);
      timeout.current = null;
      return;
    }

    // At most one "start" every 3 seconds while typing continues.
    if (now - lastSent.current > 3000) {
      lastSent.current = now;
      getSocket().emit('typing:start', { isTyping: true });
    }

    if (timeout.current) window.clearTimeout(timeout.current);
    timeout.current = window.setTimeout(() => {
      getSocket().emit('typing:stop');
      timeout.current = null;
    }, 2500);
  };
}
