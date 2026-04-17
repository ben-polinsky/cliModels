import type { LoadSceneOptions } from "../imodel.js";
import {
  createInitialViewerState,
  renderViewer,
  type HiddenLineMode,
  type SceneDocument,
} from "../render.js";

const USAGE = `Usage: pnpm --filter @itwin-experiments/cli-model cli -- <path-to-imodel> [options]

Options:
  --max-elements <count>  Limit displayed elements per model (default: 200)
  --hidden-lines          Enable mesh-only hidden-line occlusion
  --plain                 Disable ANSI styling in the HUD
  --help                  Show this help
`;

export interface CliArguments extends LoadSceneOptions {
  filePath: string;
  ansi: boolean;
  hiddenLineMode: HiddenLineMode;
}

export function parseArguments(argv: readonly string[]):
  | { kind: "help" }
  | { kind: "run"; options: CliArguments } {
  let filePath: string | undefined;
  let ansi = true;
  let maxElementsPerModel = 200;
  let hiddenLineMode: HiddenLineMode = "off";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--") {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }

    if (arg === "--plain") {
      ansi = false;
      continue;
    }

    if (arg === "--hidden-lines") {
      hiddenLineMode = "mesh";
      continue;
    }

    if (arg === "--max-elements") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing value for --max-elements.");
      }

      maxElementsPerModel = parsePositiveInteger(next, "--max-elements");
      index += 1;
      continue;
    }

    if (arg.startsWith("--max-elements=")) {
      maxElementsPerModel = parsePositiveInteger(
        arg.slice("--max-elements=".length),
        "--max-elements",
      );
      continue;
    }

    if (!arg.startsWith("--") && !filePath) {
      filePath = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!filePath) {
    return { kind: "help" };
  }

  return {
    kind: "run",
    options: {
      filePath,
      ansi,
      hiddenLineMode,
      maxElementsPerModel,
    },
  };
}

export function renderStaticPreview(
  document: SceneDocument,
  options: Pick<CliArguments, "ansi" | "hiddenLineMode">,
): string {
  const state = createInitialViewerState({
    hiddenLineMode: options.hiddenLineMode,
  });
  const width = process.stdout.columns ?? 100;
  const height = Math.max(process.stdout.rows ?? 32, 24);
  return renderViewer(document, state, { width, height }, options.ansi);
}

export function getUsageText(): string {
  return USAGE;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
