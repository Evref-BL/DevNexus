export function countLabel(value: number, singular: string, pluralValue = `${singular}s`): string {
  const count = Number(value ?? 0);
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

export function truncate(value: unknown, limit: number): string {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3))}...` : text;
}

export function compactPath(value: unknown): string {
  const text = String(value ?? "");
  const parts = text.split("/").filter(Boolean);
  return parts.length > 3 ? `.../${parts.slice(-3).join("/")}` : text;
}

export function formatTime(value: unknown): string {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime())
    ? String(value ?? "")
    : date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
}

export function formatDisplayText(value: unknown): string {
  const text = String(value ?? "").replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu,
    (match) => formatTime(match),
  );
  if (
    /No resolved auth profile is available for publication action provider\.pull_request\.open/iu
      .test(text)
  ) {
    return "No bot credential is available for opening a pull request. Approval is required.";
  }
  return text
    .replace(/provider\.pull_request\.open/gu, "opening a pull request")
    .replace(/coordination\.handoff/gu, "approval")
    .replace(/advisory worktree lease/giu, "advisory thread record")
    .replace(/worktree lease/giu, "thread record")
    .replace(/human approval/giu, "approval");
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
}

export function escapeAttribute(value: unknown): string {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "-");
}

export function renderNexusCockpitFormatClientSource(): string {
  return [
    countLabel,
    truncate,
    compactPath,
    formatTime,
    formatDisplayText,
    escapeHtml,
    escapeAttribute,
  ]
    .map((fn) => fn.toString())
    .join("\n\n");
}
