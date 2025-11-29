const toWsScheme = (url: string): string => {
  if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
  if (url.startsWith("https://")) return url.replace(/^https:/, "wss:");
  if (url.startsWith("http://")) return url.replace(/^http:/, "ws:");
  return `ws://${url}`;
};

export function getSocketUrl(): string {
  // Prefer explicit override
  const explicit = ((import.meta.env?.VITE_SOCKET_URL as string | undefined) || "").trim();
  if (explicit.length > 0) return toWsScheme(explicit);

  // In dev, default to local server
  if (import.meta.env.DEV) return "ws://localhost:3000";

  // In production, assume same-origin
  const { protocol, host } = window.location;
  const wsScheme = protocol === "https:" ? "wss" : "ws";
  return `${wsScheme}://${host}`;
}
