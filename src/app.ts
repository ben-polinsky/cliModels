import {
  loadSceneDocument,
  openLocalIModel,
  shutdownIModelHost,
} from "./imodel.js";
import { getUsageText, parseArguments, renderStaticPreview } from "./app/args.js";
import { runInteractiveViewer } from "./app/interactive.js";

export async function runCliModelApp(argv: readonly string[]): Promise<number> {
  const parsed = parseArguments(argv);
  if (parsed.kind === "help") {
    process.stdout.write(getUsageText());
    return 0;
  }

  const session = await openLocalIModel(parsed.options.filePath);

  try {
    process.stdout.write(`[cli-model] opening ${session.filePath}\n`);
    const document = await loadSceneDocument(session, parsed.options);

    if (document.models.length === 0) {
      throw new Error(
        "No drawable geometric 3d models were found in the supplied iModel.",
      );
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      const staticView = renderStaticPreview(document, parsed.options);
      process.stdout.write(`${staticView}\n`);
      return 0;
    }

    await runInteractiveViewer(
      document,
      parsed.options.ansi,
      parsed.options.hiddenLineMode,
    );
    return 0;
  } finally {
    session.db.close();
    await shutdownIModelHost();
  }
}
