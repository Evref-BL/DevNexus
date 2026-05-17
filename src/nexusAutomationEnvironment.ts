export function nonInteractiveGitEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    GIT_EDITOR: env.GIT_EDITOR ?? "true",
    GIT_SEQUENCE_EDITOR: env.GIT_SEQUENCE_EDITOR ?? "true",
    GIT_MERGE_AUTOEDIT: env.GIT_MERGE_AUTOEDIT ?? "no",
  };
}
