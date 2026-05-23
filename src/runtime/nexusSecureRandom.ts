import { randomBytes } from "node:crypto";
import process from "node:process";

export function secureRandomHex(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

export function secureRandomIdSuffix(): string {
  return secureRandomHex(4);
}

export function temporaryStoreNonce(): string {
  return `${process.pid}-${Date.now()}-${secureRandomHex(8)}`;
}
