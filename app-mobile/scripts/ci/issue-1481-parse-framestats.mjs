#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const requiredColumns = ['Flags', 'IntendedVsync', 'FrameDeadline', 'FrameCompleted'];

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil((percentileValue / 100) * sortedValues.length) - 1,
  );
  return sortedValues[Math.max(0, index)];
}

export function parseFrameStats(raw, { refreshRateHz, refreshMode = null } = {}) {
  if (!Number.isFinite(refreshRateHz) || refreshRateHz <= 0) {
    throw new Error('A positive refreshRateHz is required');
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const headerLineIndex = lines.findIndex((line) => {
    const names = new Set(line.split(',').map((name) => name.trim()));
    return requiredColumns.every((name) => names.has(name));
  });
  if (headerLineIndex < 0) {
    throw new Error(`Missing framestats columns: ${requiredColumns.join(', ')}`);
  }

  const headers = lines[headerLineIndex].split(',').map((name) => name.trim());
  const columnIndex = new Map(headers.map((name, index) => [name, index]));
  const frames = [];

  for (const line of lines.slice(headerLineIndex + 1)) {
    if (!line || line.startsWith('---PROFILEDATA---')) continue;
    const values = line.split(',').map((value) => value.trim());
    const readNamedNumber = (name) => Number(values[columnIndex.get(name)]);
    const flags = readNamedNumber('Flags');
    const intendedVsyncNs = readNamedNumber('IntendedVsync');
    const frameDeadlineNs = readNamedNumber('FrameDeadline');
    const frameCompletedNs = readNamedNumber('FrameCompleted');
    if (![flags, intendedVsyncNs, frameDeadlineNs, frameCompletedNs].every(Number.isFinite)) {
      continue;
    }
    if (flags !== 0 || intendedVsyncNs <= 0 || frameDeadlineNs <= 0 || frameCompletedNs <= 0) {
      continue;
    }
    const rawDurationMs = (frameCompletedNs - intendedVsyncNs) / 1_000_000;
    if (rawDurationMs < 0) continue;
    frames.push({
      flags,
      intendedVsyncNs,
      frameDeadlineNs,
      frameCompletedNs,
      rawDurationMs,
      deadlineMissed: frameCompletedNs > frameDeadlineNs,
    });
  }

  const rawDurationsMs = frames.map((frame) => frame.rawDurationMs);
  const sortedDurationsMs = [...rawDurationsMs].sort((left, right) => left - right);
  const deadlineMissedFrames = frames.filter((frame) => frame.deadlineMissed).length;
  return {
    refreshRateHz,
    refreshMode,
    totalFrames: frames.length,
    deadlineMissedFrames,
    deadlineJankPercent: frames.length === 0
      ? 0
      : (deadlineMissedFrames / frames.length) * 100,
    frozenFrames: rawDurationsMs.filter((durationMs) => durationMs >= 700).length,
    p50Ms: percentile(sortedDurationsMs, 50),
    p95Ms: percentile(sortedDurationsMs, 95),
    p99Ms: percentile(sortedDurationsMs, 99),
    maxMs: sortedDurationsMs.at(-1) ?? 0,
    rawDurationsMs,
    frames,
  };
}

export function evaluateAndroidFrameStats(stats) {
  const passes = {
    deadlineJank: stats.deadlineJankPercent <= 5,
    p95: stats.p95Ms <= 32,
    p99: stats.p99Ms <= 50,
    max: stats.maxMs < 100,
    frozenFrames: stats.frozenFrames === 0,
  };
  return {
    passes,
    passed: Object.values(passes).every(Boolean),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find((arg) => !arg.startsWith('--'));
  const refreshRateArgument = args.find((arg) => arg.startsWith('--refresh-rate-hz='));
  const refreshModeArgument = args.find((arg) => arg.startsWith('--refresh-mode='));
  if (!inputPath || !refreshRateArgument) {
    throw new Error('Usage: issue-1481-parse-framestats.mjs <file> --refresh-rate-hz=<hz> [--refresh-mode=<mode>]');
  }
  const refreshRateHz = Number(refreshRateArgument.split('=')[1]);
  const refreshMode = refreshModeArgument?.split('=').slice(1).join('=') || null;
  const stats = parseFrameStats(await readFile(inputPath, 'utf8'), { refreshRateHz, refreshMode });
  process.stdout.write(`${JSON.stringify({ ...stats, verdict: evaluateAndroidFrameStats(stats) }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
