import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BriefcaseDb,
  IModelHost,
  SnapshotDb,
  StandaloneDb,
} from "@itwin/core-backend";
import { OpenMode } from "@itwin/core-bentley";

import type { CliModelSession } from "./types.js";

let hostStarted = false;

export async function openLocalIModel(filePath: string): Promise<CliModelSession> {
  await ensureIModelHost();

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`The file does not exist: ${resolvedPath}`);
  }

  const snapshot = tryOpen(() => SnapshotDb.openFile(resolvedPath));
  if (snapshot.ok) {
    return { db: snapshot.db, filePath: resolvedPath, openKind: "snapshot" };
  }

  const standalone = tryOpen(() => StandaloneDb.openFile(resolvedPath, OpenMode.Readonly));
  if (standalone.ok) {
    return { db: standalone.db, filePath: resolvedPath, openKind: "standalone" };
  }

  const briefcase = await tryOpenAsync(() =>
    BriefcaseDb.open({
      fileName: resolvedPath,
      readonly: true,
    }),
  );
  if (briefcase.ok) {
    return { db: briefcase.db, filePath: resolvedPath, openKind: "briefcase" };
  }

  throw new Error(
    [
      `Unable to open ${resolvedPath} as a local iModel.`,
      `snapshot: ${snapshot.message}`,
      `standalone: ${standalone.message}`,
      `briefcase: ${briefcase.message}`,
    ].join("\n"),
  );
}

export async function shutdownIModelHost(): Promise<void> {
  if (!hostStarted) {
    return;
  }

  await IModelHost.shutdown();
  hostStarted = false;
}

async function ensureIModelHost(): Promise<void> {
  if (hostStarted) {
    return;
  }

  await IModelHost.startup({
    cacheDir: join(tmpdir(), "itwinjs-core-big-experiments-cli-model-cache"),
    profileName: `cli-model-${process.pid}`,
  });
  hostStarted = true;
}

function tryOpen<T>(open: () => T): { ok: true; db: T } | { ok: false; message: string } {
  try {
    return { ok: true, db: open() };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error) };
  }
}

async function tryOpenAsync<T>(
  open: () => Promise<T>,
): Promise<{ ok: true; db: T } | { ok: false; message: string }> {
  try {
    return { ok: true, db: await open() };
  } catch (error) {
    return { ok: false, message: getErrorMessage(error) };
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
