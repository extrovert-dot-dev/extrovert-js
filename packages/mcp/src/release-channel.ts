export type ReleaseChannel = "latest" | "next" | "beta";

export function releaseChannel(version: string): ReleaseChannel {
  return version.split("+")[0]!.includes("-") ? "next" : "latest";
}

export function parseChannel(value: string | undefined): ReleaseChannel | undefined {
  if (value === undefined) return undefined;
  if (value === "latest" || value === "next" || value === "beta") return value;
  throw new Error("--channel must be latest, next, or beta");
}

export function mcpPackage(channel: ReleaseChannel = "latest"): string {
  return channel === "latest" ? "@extrovert.dev/mcp" : `@extrovert.dev/mcp@${channel}`;
}
