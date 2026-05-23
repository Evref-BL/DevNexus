#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const keyRenames = new Map([
  ["publicationTrain", "releaseTrain"],
  ["initiativeDelivery", "featureBranchDelivery"],
  ["activeInitiativeId", "activeFeatureId"],
  ["defaultTopology", "defaultBranchStrategy"],
  ["allowedTopologies", "allowedBranchStrategies"],
  ["integrationBranchPattern", "featureBranchPattern"],
  ["sliceBranchPattern", "reviewBranchPattern"],
]);

const providerKeyRenames = new Map([
  ["noise", "commentPolicy"],
]);

const valueRenames = new Map([
  ["slice_pr", "review_branch_pr"],
  ["at_initiative_start", "at_feature_start"],
  ["publication_remote", "push_remote"],
  ["publication_remote_then_fallback", "push_remote_then_fallback"],
]);

const branchPatternKeys = new Set([
  "featureBranchPattern",
  "reviewBranchPattern",
]);

const args = process.argv.slice(2);
const write = consumeFlag(args, "--write");
const check = consumeFlag(args, "--check");
const help = consumeFlag(args, "--help") || consumeFlag(args, "-h");

if (help || args.length === 0) {
  printUsage();
  process.exit(help ? 0 : 1);
}

let totalChanged = 0;
let totalCollisions = 0;

for (const inputPath of args) {
  const filePath = path.resolve(inputPath);
  const original = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(original);
  const result = transformValue(data, { parentKey: null });
  totalChanged += result.changed;
  totalCollisions += result.collisions.length;

  if (result.changed === 0 && result.collisions.length === 0) {
    console.log(`${inputPath}: already current`);
    continue;
  }

  if (result.collisions.length > 0) {
    console.warn(`${inputPath}: skipped ${result.collisions.length} conflicting old key(s)`);
    for (const collision of result.collisions) {
      console.warn(`  ${collision}`);
    }
  }

  if (result.changed > 0) {
    if (write) {
      fs.writeFileSync(filePath, `${JSON.stringify(result.value, null, 2)}\n`);
      console.log(`${inputPath}: updated ${result.changed} value(s)`);
    } else {
      console.log(`${inputPath}: would update ${result.changed} value(s)`);
    }
  }
}

if (check && (totalChanged > 0 || totalCollisions > 0)) {
  process.exit(1);
}

function transformValue(value, context) {
  if (Array.isArray(value)) {
    let changed = 0;
    const collisions = [];
    const items = value.map((item) => {
      const result = transformValue(item, { parentKey: context.parentKey });
      changed += result.changed;
      collisions.push(...result.collisions);
      return result.value;
    });
    return { value: items, changed, collisions };
  }

  if (value && typeof value === "object") {
    return transformObject(value, context);
  }

  if (typeof value === "string") {
    let next = valueRenames.get(value) ?? value;
    if (branchPatternKeys.has(context.parentKey ?? "")) {
      next = next
        .replaceAll("{initiative}", "{feature}")
        .replaceAll("{slice}", "{change}");
    }
    return {
      value: next,
      changed: next === value ? 0 : 1,
      collisions: [],
    };
  }

  return { value, changed: 0, collisions: [] };
}

function transformObject(record, context) {
  let changed = 0;
  const collisions = [];
  const output = {};
  const renames = context.parentKey === "provider"
    ? new Map([...keyRenames, ...providerKeyRenames])
    : keyRenames;

  for (const [key, rawValue] of Object.entries(record)) {
    const renamedKey = renames.get(key) ?? key;
    const targetKey = Object.prototype.hasOwnProperty.call(record, renamedKey)
      ? key
      : renamedKey;
    if (targetKey !== key) {
      changed += 1;
    } else if (renamedKey !== key) {
      collisions.push(`${contextPath(context, key)} -> ${renamedKey}`);
    }

    const result = transformValue(rawValue, { parentKey: targetKey });
    changed += result.changed;
    collisions.push(...result.collisions);
    output[targetKey] = result.value;
  }

  return { value: output, changed, collisions };
}

function contextPath(context, key) {
  return context.parentKey ? `${context.parentKey}.${key}` : key;
}

function consumeFlag(values, flag) {
  const index = values.indexOf(flag);
  if (index === -1) {
    return false;
  }
  values.splice(index, 1);
  return true;
}

function printUsage() {
  console.log(`Usage: node scripts/update-git-workflow-vocabulary-config.mjs [--write] [--check] <json-file...>

Renames DevNexus git workflow config from the old initiative/publication-train
vocabulary to feature/release-train vocabulary. The default mode is a dry run.
Use --write to update files in place. Use --check in CI to fail when changes or
conflicting old/new keys are found.`);
}
