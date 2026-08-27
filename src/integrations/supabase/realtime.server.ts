import type { WebSocketLikeConstructor } from "@supabase/realtime-js";

export async function getRealtimeTransport(): Promise<WebSocketLikeConstructor> {
  if (typeof WebSocket !== "undefined") {
    return WebSocket as unknown as WebSocketLikeConstructor;
  }

  try {
    const { default: WebSocketFallback } = await import("ws");
    return WebSocketFallback as unknown as WebSocketLikeConstructor;
  } catch {
    // ws is unavailable in this runtime (e.g. Vercel Edge).
    // Return a no-op class so the Supabase client still initialises;
    // server functions don't need WebSocket realtime.
    return class NoOpWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      constructor() {}
      close() {}
      send() {}
    } as unknown as WebSocketLikeConstructor;
  }
}
