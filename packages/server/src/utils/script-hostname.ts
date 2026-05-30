import { slugify } from "./worktree.js";

interface BuildScriptHostnameOptions {
  projectSlug: string;
  branchName: string | null;
  scriptName: string;
}

interface BuildPublicScriptHostnameOptions extends BuildScriptHostnameOptions {
  publicBaseUrl: string;
}

function toHostnameLabel(value: string): string {
  return slugify(value) || "untitled";
}

function toPublicServiceLabel({
  projectSlug,
  branchName,
  scriptName,
}: BuildScriptHostnameOptions): string {
  const labels = [toHostnameLabel(scriptName)];
  const isDefaultBranch = branchName === null || branchName === "main" || branchName === "master";
  if (!isDefaultBranch) {
    labels.push(toHostnameLabel(branchName));
  }
  labels.push(toHostnameLabel(projectSlug));
  return labels.join("--");
}

export function buildScriptHostname({
  projectSlug,
  branchName,
  scriptName,
}: BuildScriptHostnameOptions): string {
  const serviceHostnameLabel = toHostnameLabel(scriptName);
  const projectHostnameLabel = toHostnameLabel(projectSlug);
  const isDefaultBranch = branchName === null || branchName === "main" || branchName === "master";

  if (isDefaultBranch) {
    return `${serviceHostnameLabel}.${projectHostnameLabel}.localhost`;
  }

  return `${serviceHostnameLabel}.${toHostnameLabel(branchName)}.${projectHostnameLabel}.localhost`;
}

export function buildPublicScriptHostname({
  publicBaseUrl,
  ...script
}: BuildPublicScriptHostnameOptions): string {
  const base = new URL(publicBaseUrl);
  return `${toPublicServiceLabel(script)}.${base.hostname}`;
}

export function buildPublicScriptProxyUrl(options: BuildPublicScriptHostnameOptions): string {
  const base = new URL(options.publicBaseUrl);
  const hostname = buildPublicScriptHostname(options);
  const port = base.port ? `:${base.port}` : "";
  return `${base.protocol}//${hostname}${port}`;
}
