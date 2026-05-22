import fs from "node:fs";
import path from "node:path";

export interface TextWriter {
  write(chunk: string): unknown;
}

export function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

export function parseNonNegativeInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} must be a non-negative integer`);
  }

  return parsed;
}

export function readCliJsonFile(inputPath: string, description: string): unknown {
  const resolvedPath = path.resolve(inputPath);
  let raw: Buffer;
  try {
    raw = fs.readFileSync(resolvedPath);
  } catch (error) {
    throw new Error(
      `${description} file ${resolvedPath} could not be read: ${formatErrorMessage(error)}`,
    );
  }

  let text: string;
  try {
    text = decodeCliJsonFileBuffer(raw);
  } catch (error) {
    throw new Error(
      `${description} file ${resolvedPath} must contain valid JSON: ${formatErrorMessage(error)}`,
    );
  }

  try {
    return JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(
      `${description} file ${resolvedPath} must contain valid JSON: ${formatErrorMessage(error)}`,
    );
  }
}

function decodeCliJsonFileBuffer(raw: Buffer): string {
  if (
    raw.length >= 3 &&
    raw[0] === 0xef &&
    raw[1] === 0xbb &&
    raw[2] === 0xbf
  ) {
    return raw.subarray(3).toString("utf8");
  }
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw.subarray(2).toString("utf16le");
  }
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    return decodeUtf16Be(raw.subarray(2));
  }

  return raw.toString("utf8");
}

function decodeUtf16Be(raw: Buffer): string {
  if (raw.length % 2 !== 0) {
    throw new Error("UTF-16BE content has an odd byte length");
  }

  const swapped = Buffer.alloc(raw.length);
  for (let index = 0; index < raw.length; index += 2) {
    swapped[index] = raw[index + 1]!;
    swapped[index + 1] = raw[index]!;
  }

  return swapped.toString("utf16le");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function writeLine(stdout: TextWriter, line = ""): void {
  stdout.write(`${line}\n`);
}

export function writeJson(stdout: TextWriter, value: unknown): void {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
