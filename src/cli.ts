#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { runCliModelApp } from "./app.js";

async function main(): Promise<void> {
  const exitCode = await runCliModelApp(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cli-model] ${message}`);

    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }

    process.exitCode = 1;
  });
}
