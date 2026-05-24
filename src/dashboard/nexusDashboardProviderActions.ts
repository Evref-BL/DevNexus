import type { NexusProjectConfig } from "../project/nexusProjectConfig.js";

export type NexusDashboardProviderActionKind =
  | "pull-request"
  | "issue"
  | "provider-link";

export interface NexusDashboardProviderAction {
  label: string;
  href: string;
  provider: "github" | "web";
  kind: NexusDashboardProviderActionKind;
  title: string | null;
}

export interface NexusDashboardProviderUrls {
  project: string | null;
  components: Map<string, string | null>;
}

interface ProviderComponentSummary {
  readonly id: string;
  readonly remoteUrl: string | null;
}

interface ProviderAuthoritySummary {
  readonly components: Array<{
    readonly componentId: string;
    readonly blockedActions: string[];
    readonly warnings: string[];
  }>;
}

export function dashboardProviderUrls(
  projectConfig: NexusProjectConfig,
  components: ProviderComponentSummary[],
): NexusDashboardProviderUrls {
  const project = githubRepositoryUrl(projectConfig.repo.remoteUrl);
  return {
    project,
    components: new Map(
      components.map((component) => [
        component.id,
        githubRepositoryUrl(component.remoteUrl) ?? project,
      ]),
    ),
  };
}

export function componentProviderUrl(
  providerUrls: NexusDashboardProviderUrls,
  componentId: string | null | undefined,
): string | null {
  return componentId ? providerUrls.components.get(componentId) ?? providerUrls.project : providerUrls.project;
}

export function providerActionsForHref(
  href: string | null | undefined,
  labelOverride?: string,
): NexusDashboardProviderAction[] {
  if (!href) {
    return [];
  }
  const normalized = normalizeProviderHref(href);
  if (!normalized) {
    return [];
  }
  const pull = /\/pull\/(\d+)(?:[/?#].*)?$/iu.exec(normalized);
  if (pull) {
    return [
      {
        label: labelOverride ?? `Open PR #${pull[1]}`,
        href: normalized,
        provider: "github",
        kind: "pull-request",
        title: null,
      },
    ];
  }
  const issue = /\/issues\/(\d+)(?:[/?#].*)?$/iu.exec(normalized);
  if (issue) {
    return [
      {
        label: labelOverride ?? `Open issue #${issue[1]}`,
        href: normalized,
        provider: "github",
        kind: "issue",
        title: null,
      },
    ];
  }
  return [
    {
      label: labelOverride ?? "Open provider",
      href: normalized,
      provider: normalized.startsWith("https://github.com/") ? "github" : "web",
      kind: "provider-link",
      title: null,
    },
  ];
}

export function providerActionsFromText(
  value: string | null | undefined,
  providerUrls: NexusDashboardProviderUrls,
  componentId?: string | null,
): NexusDashboardProviderAction[] {
  const text = value ?? "";
  const repositoryUrl = componentProviderUrl(
    providerUrls,
    componentId ?? inferComponentIdFromText(text, providerUrls),
  );
  const actions: NexusDashboardProviderAction[] = [];
  for (const href of githubLinksFromText(text)) {
    actions.push(...providerActionsForHref(href));
  }
  if (repositoryUrl) {
    for (const match of text.matchAll(/\b(?:PR|pull request)\s*#(\d+)\b/giu)) {
      const number = match[1];
      const title = actionTitleFromText(text, number);
      actions.push({
        label: actionLabel("pull-request", number, title),
        href: `${repositoryUrl}/pull/${number}`,
        provider: "github",
        kind: "pull-request",
        title,
      });
    }
    for (const match of text.matchAll(/\b(?:issue|GitHub)\s*#(\d+)\b/giu)) {
      const number = match[1];
      const title = actionTitleFromText(text, number);
      actions.push({
        label: actionLabel("issue", number, title),
        href: `${repositoryUrl}/issues/${number}`,
        provider: "github",
        kind: "issue",
        title,
      });
    }
    for (const match of text.matchAll(/\bgithub-(\d+)\b/giu)) {
      const number = match[1];
      const title = actionTitleFromText(text, number);
      actions.push({
        label: actionLabel("issue", number, title),
        href: `${repositoryUrl}/issues/${number}`,
        provider: "github",
        kind: "issue",
        title,
      });
    }
    for (const match of text.matchAll(/#(\d+)\b/gu)) {
      const number = match[1];
      const index = match.index ?? 0;
      const prefix = text.slice(Math.max(0, index - 20), index);
      if (/\b(?:PR|pull request|issue|GitHub)\s*$/iu.test(prefix)) {
        continue;
      }
      const title = actionTitleFromText(text, number);
      actions.push({
        label: actionLabel("issue", number, title),
        href: `${repositoryUrl}/issues/${number}`,
        provider: "github",
        kind: "issue",
        title,
      });
    }
  }
  return uniqueProviderActions(actions).slice(0, 3);
}

export function authorityProviderActions(
  authority: ProviderAuthoritySummary,
  providerUrls: NexusDashboardProviderUrls,
): NexusDashboardProviderAction[] {
  return uniqueProviderActions(
    [
      ...authority.components.flatMap((component) =>
        providerActionsFromText(
          [...component.blockedActions, ...component.warnings].join(" "),
          providerUrls,
          component.componentId,
        ),
      ),
      ...authority.components.flatMap((component) =>
        providerActionsForHref(
          componentProviderUrl(providerUrls, component.componentId),
          `Open ${component.componentId} repo`,
        ),
      ),
    ],
  ).slice(0, 3);
}

export function uniqueProviderActions(
  actions: NexusDashboardProviderAction[],
): NexusDashboardProviderAction[] {
  const seen = new Set<string>();
  const unique: NexusDashboardProviderAction[] = [];
  for (const action of actions) {
    if (!action.href || seen.has(action.href)) {
      continue;
    }
    seen.add(action.href);
    unique.push(action);
  }
  return unique;
}

export function firstActionHref(actions: NexusDashboardProviderAction[]): string | null {
  return actions[0]?.href ?? null;
}

function githubRepositoryUrl(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) {
    return null;
  }
  const trimmed = remoteUrl.trim();
  const direct = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/iu.exec(trimmed);
  if (direct) {
    return `https://github.com/${direct[1]}/${stripGitSuffix(direct[2] ?? "")}`;
  }
  const ssh = /^git@github(?:-[^:]+)?\.com:([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/iu.exec(trimmed);
  if (ssh) {
    return `https://github.com/${ssh[1]}/${stripGitSuffix(ssh[2] ?? "")}`;
  }
  const sshUrl = /^ssh:\/\/git@github(?:-[^/]+)?\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/iu.exec(trimmed);
  if (sshUrl) {
    return `https://github.com/${sshUrl[1]}/${stripGitSuffix(sshUrl[2] ?? "")}`;
  }
  return null;
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/iu, "");
}

function githubLinksFromText(text: string): string[] {
  const prefix = "https://github.com/";
  const lowerText = text.toLowerCase();
  const links: string[] = [];
  let searchStart = 0;
  for (;;) {
    const start = lowerText.indexOf(prefix, searchStart);
    if (start < 0) {
      return links;
    }

    let end = start + prefix.length;
    while (end < text.length && !isProviderUrlTerminator(text[end]!)) {
      end += 1;
    }
    const href = trimTrailingProviderPunctuation(text.slice(start, end));
    if (href.length > prefix.length) {
      links.push(href);
    }
    searchStart = end;
  }
}

function isProviderUrlTerminator(char: string): boolean {
  return char.trim() === "" || "<>()\"'`".includes(char);
}

function trimTrailingProviderPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && ".,;:".includes(value[end - 1]!)) {
    end -= 1;
  }
  return value.slice(0, end);
}

function actionLabel(
  kind: NexusDashboardProviderActionKind,
  number: string,
  title: string | null,
): string {
  const prefix = kind === "pull-request" ? `PR #${number}` : `#${number}`;
  return title ? `${prefix}: ${title}` : prefix;
}

function actionTitleFromText(text: string, number: string): string | null {
  const branch = new RegExp(
    `(?:github-${escapeRegExp(number)}|#${escapeRegExp(number)})(?:[-_/])([A-Za-z0-9][A-Za-z0-9/_-]{2,80})`,
    "iu",
  ).exec(text);
  if (branch?.[1]) {
    return compactActionTitle(branch[1]);
  }
  const providerTitle = new RegExp(
    `(?:\\b(?:PR|pull request|issue|GitHub)\\s*)?#${escapeRegExp(number)}\\s*[:\\-]\\s*([^.;\\n]{3,80})`,
    "iu",
  ).exec(text);
  if (providerTitle?.[1]) {
    return compactActionTitle(providerTitle[1]);
  }
  const completed = new RegExp(
    `Completed\\s+([^.;\\n]{1,80}?)\\s+(?:via|in)\\s+[^.;\\n]*#${escapeRegExp(number)}`,
    "iu",
  ).exec(text);
  if (completed?.[1]) {
    return compactActionTitle(completed[1]);
  }
  return null;
}

function compactActionTitle(value: string): string | null {
  const text = value
    .replace(/[/_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) {
    return null;
  }
  return text.length > 54 ? `${text.slice(0, 51)}...` : text;
}

function inferComponentIdFromText(
  text: string,
  providerUrls: NexusDashboardProviderUrls,
): string | null {
  const componentIds = [...providerUrls.components.keys()].sort(
    (left, right) => right.length - left.length,
  );
  for (const componentId of componentIds) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(componentId)}([^A-Za-z0-9_-]|$)`, "u");
    if (pattern.test(text)) {
      return componentId;
    }
  }
  return null;
}

function normalizeProviderHref(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
