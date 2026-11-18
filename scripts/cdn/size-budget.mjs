import { gzipSync } from "node:zlib";

const optionalBudgets = new Map([
  ["markdownRenderer", { key: "optionalRenderer", label: "renderer" }],
  ["restrictedContent", { key: "optionalRestrictedContent", label: "restricted content" }],
  ["hoverCard", { key: "optionalHoverCard", label: "hover card" }],
]);

export function measureSize(body) {
  return { bytes: body.length, gzipBytes: gzipSync(body, { level: 9 }).length };
}

export function startupRequireSizes(resources, count = resources.length) {
  return {
    count,
    totalBytes: resources.reduce((total, resource) => total + resource.bytes, 0),
    totalGzipBytes: resources.reduce((total, resource) => total + resource.gzipBytes, 0),
  };
}

function sizeLimit(limit, label) {
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new Error(`Invalid CDN size budget for ${label}`);
  return limit;
}

function checkMaximum(failures, measured, limit, label) {
  if (measured > sizeLimit(limit, label))
    failures.push(`${label} ${measured} > ${limit}`);
}

export function startupBudgetFailures(measured, budget) {
  const limits = budget.startupRequires;
  const failures = [];
  if (measured.count !== sizeLimit(limits?.count, "startup @require count"))
    failures.push(`startup @require count ${measured.count} != ${limits.count}`);
  checkMaximum(failures, measured.totalBytes, limits.maxTotalBytes, "startup @require bytes");
  checkMaximum(failures, measured.totalGzipBytes, limits.maxTotalGzipBytes, "startup @require gzip bytes");
  return failures;
}

export function optionalBundleBudgetFailures(bundles, budget, canary = false) {
  const failures = [];
  for (const [name, measured] of Object.entries(bundles)) {
    if (!measured) continue;
    const entry = optionalBudgets.get(name);
    if (!entry || !budget[entry.key]) {
      failures.push(`${canary ? "canary" : "optional"} bundle ${name} has no budget entry`);
      continue;
    }
    const label = canary ? `canary ${name}` : `optional ${entry.label}`;
    const limits = budget[entry.key];
    checkMaximum(failures, measured.bytes, limits.maxBytes, `${label} bytes`);
    checkMaximum(failures, measured.gzipBytes, limits.maxGzipBytes, `${label} gzip bytes`);
  }
  return failures;
}

// The snapshot has already verified the SHA-256 and size of every pinned file.
export function assertCandidateSizeBudget({ manifest, files }, budget) {
  const measurePin = (descriptor, label) => {
    const record = manifest.files[descriptor?.path];
    const body = files.get(descriptor?.path);
    if (!body || !record || record.bytes !== descriptor.bytes || record.sha256 !== descriptor.sha256)
      throw new Error(`Candidate manifest does not pin ${label}`);
    return measureSize(body);
  };
  const startup = ["earlyGate", "runtime"].map((name) =>
    measurePin(manifest.compat?.[name], `startup @require ${name}`));
  const optional = Object.fromEntries(Object.entries(manifest.optionalBundles ?? {}).map(([name, descriptor]) =>
    [name, measurePin(descriptor, `optional bundle ${name}`)]));
  const failures = [
    ...startupBudgetFailures(startupRequireSizes(startup), budget),
    ...optionalBundleBudgetFailures(optional, budget),
  ];
  if (failures.length)
    throw new Error(`Candidate CDN size budget failed: ${failures.join("; ")}`);
}
