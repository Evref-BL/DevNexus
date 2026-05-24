export type NexusMcpExposureMode = "direct" | "gateway" | "hidden" | "inherit";
export type NexusResolvedMcpExposureMode = Exclude<NexusMcpExposureMode, "inherit">;

export function isNexusMcpExposureMode(value: unknown): value is NexusMcpExposureMode {
  return (
    value === "direct" ||
    value === "gateway" ||
    value === "hidden" ||
    value === "inherit"
  );
}
