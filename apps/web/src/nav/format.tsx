import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { NodeStatus } from "../nav-types";

export const short = (value: string, left = 6, right = 4) =>
  value.length <= left + right + 1 ? value : `${value.slice(0, left)}…${value.slice(-right)}`;

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Format a base-unit decimal string with `decimals`, using BigInt only. */
export function formatUnits(raw: string, decimals: number, maxFraction = 4): string {
  let digits = raw.trim();
  const negative = digits.startsWith("-");
  if (negative) digits = digits.slice(1);
  let value: bigint;
  try {
    value = BigInt(digits);
  } catch {
    return raw;
  }
  const scale = 10n ** BigInt(Math.max(0, decimals));
  const whole = value / scale;
  const fraction = decimals > 0
    ? (value % scale).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "")
    : "";
  return `${negative ? "-" : ""}${group(whole.toString())}${fraction ? `.${fraction}` : ""}`;
}

export const formatBps = (bps: number) => `${bps >= 0 ? "+" : ""}${bps} bps`;

export const formatTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC",
  }).format(date) + " UTC";
};

export async function readJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
      ? (body as { error: string }).error
      : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return body as T;
}

export const errorText = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

/** Full monospace value with a copy button; `display` overrides the visible text. */
export function CopyValue({ value, display, mono = true }: { value: string; display?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={`nav-copy ${mono ? "mono" : ""}`}>
      <span className="nav-copy-text">{display ?? value}</span>
      <button
        type="button"
        className="nav-copy-btn"
        title="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
  );
}

export function Pill({ tone, children }: { tone: NodeStatus | "pass" | "fail" | "info" | "warn" | "critical" | "open" | "explained" | "resolved" | "neutral"; children: ReactNode }) {
  return <span className={`nav-pill ${tone}`}>{children}</span>;
}
