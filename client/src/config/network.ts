export function getSocketUrl(): string | undefined {
  // Prefer explicit override
  const explicit = (import.meta.env?.VITE_SOCKET_URL as string | undefined) || undefined;
  if (explicit && explicit.length > 0) return explicit;

  // In dev, default to local server
  if (import.meta.env.DEV) return "http://localhost:3000";

  // In production, assume same-origin
  return undefined;
}
