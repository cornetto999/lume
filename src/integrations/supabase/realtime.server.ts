import type { WebSocketLikeConstructor } from "@supabase/realtime-js";

export async function getRealtimeTransport(): Promise<WebSocketLikeConstructor> {
  if (typeof WebSocket !== "undefined") {
    return WebSocket as unknown as WebSocketLikeConstructor;
  }

  const { default: WebSocketFallback } = await import("ws");
  return WebSocketFallback as unknown as WebSocketLikeConstructor;
}
