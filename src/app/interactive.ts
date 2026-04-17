import readline from "node:readline";

import {
  createInitialViewerState,
  getActiveModel,
  getProjectedSpan,
  type HiddenLineMode,
  renderViewer,
  type ProjectionPlane,
  type RenderMode,
  type SceneDocument,
  type ViewerState,
} from "../render.js";

export async function runInteractiveViewer(
  document: SceneDocument,
  ansi: boolean,
  hiddenLineMode: HiddenLineMode,
): Promise<void> {
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stdout;
    const state = createInitialViewerState({ hiddenLineMode });
    const rawInput = input;
    const initialRawMode = rawInput.isRaw;
    let closed = false;

    const render = () => {
      output.write("\u001b[?25l\u001b[2J\u001b[H");
      output.write(
        renderViewer(
          document,
          state,
          {
            width: output.columns ?? 100,
            height: output.rows ?? 32,
          },
          ansi,
        ),
      );
    };

    const cleanup = () => {
      if (closed) {
        return;
      }

      closed = true;
      output.off("resize", render);
      input.off("keypress", onKeypress);
      rawInput.setRawMode(Boolean(initialRawMode));
      input.pause();
      output.write("\u001b[0m\u001b[?25h\u001b[2J\u001b[H");
      resolve();
    };

    const onKeypress = (inputText: string, key: readline.Key) => {
      if ((key.ctrl && key.name === "c") || key.name === "escape" || inputText === "q") {
        cleanup();
        return;
      }

      if (handleNavigationInput(document, state, inputText, key)) {
        render();
      }
    };

    readline.emitKeypressEvents(input);
    rawInput.setRawMode(true);
    input.resume();
    input.on("keypress", onKeypress);
    output.on("resize", render);
    render();
  });
}

function handleNavigationInput(
  document: SceneDocument,
  state: ViewerState,
  inputText: string,
  key: readline.Key,
): boolean {
  const model = getActiveModel(document, state);
  const span = getProjectedSpan(model, state);
  const panXStep = span.width / Math.max(12 * state.zoom, 1);
  const panYStep = span.height / Math.max(12 * state.zoom, 1);
  const rotationStep = Math.PI / 24;

  switch (key.name) {
    case "left":
      state.panX -= panXStep;
      return true;
    case "right":
      state.panX += panXStep;
      return true;
    case "up":
      state.panY += panYStep;
      return true;
    case "down":
      state.panY -= panYStep;
      return true;
    default:
      break;
  }

  switch (inputText) {
    case "h":
      state.panX -= panXStep;
      return true;
    case "l":
      state.panX += panXStep;
      return true;
    case "k":
      state.panY += panYStep;
      return true;
    case "j":
      state.panY -= panYStep;
      return true;
    case "a":
      state.yaw -= rotationStep;
      state.preset = "free";
      return true;
    case "d":
      state.yaw += rotationStep;
      state.preset = "free";
      return true;
    case "w":
      state.pitch = clampPitch(state.pitch + rotationStep);
      state.preset = "free";
      return true;
    case "s":
      state.pitch = clampPitch(state.pitch - rotationStep);
      state.preset = "free";
      return true;
    case "+":
    case "=":
      state.zoom *= 1.25;
      return true;
    case "-":
    case "_":
      state.zoom = Math.max(0.2, state.zoom / 1.25);
      return true;
    case "p":
      applyPreset(
        state,
        cycleProjectionPlane(state.preset === "free" ? "top" : state.preset),
      );
      return true;
    case "m":
      state.renderMode = cycleRenderMode(state.renderMode);
      return true;
    case "o":
      state.hiddenLineMode = cycleHiddenLineMode(state.hiddenLineMode);
      return true;
    case "]":
      state.modelIndex = (state.modelIndex + 1) % document.models.length;
      resetView(state);
      return true;
    case "[":
      state.modelIndex =
        (state.modelIndex - 1 + document.models.length) % document.models.length;
      resetView(state);
      return true;
    case "r":
      resetView(state);
      return true;
    case "i":
      state.showHud = !state.showHud;
      return true;
    case "?":
      state.showHelp = !state.showHelp;
      return true;
    default:
      return false;
  }
}

function resetView(state: ViewerState): void {
  state.panX = 0;
  state.panY = 0;
  state.zoom = 1;
}

function cycleProjectionPlane(current: ProjectionPlane): ProjectionPlane {
  switch (current) {
    case "top":
      return "front";
    case "front":
      return "side";
    case "side":
      return "iso";
    case "iso":
    default:
      return "top";
  }
}

function applyPreset(state: ViewerState, preset: ProjectionPlane): void {
  state.preset = preset;

  switch (preset) {
    case "front":
      state.yaw = 0;
      state.pitch = -Math.PI / 2;
      break;
    case "side":
      state.yaw = -Math.PI / 2;
      state.pitch = -Math.PI / 2;
      break;
    case "iso":
      state.yaw = -Math.PI / 4;
      state.pitch = -Math.PI / 5;
      break;
    case "top":
    default:
      state.yaw = 0;
      state.pitch = 0;
      break;
  }

  resetView(state);
}

function clampPitch(value: number): number {
  const limit = Math.PI / 2 - 0.05;
  return Math.max(-limit, Math.min(limit, value));
}

function cycleRenderMode(current: RenderMode): RenderMode {
  switch (current) {
    case "hybrid":
      return "lines";
    case "lines":
      return "points";
    case "points":
    default:
      return "hybrid";
  }
}

function cycleHiddenLineMode(current: HiddenLineMode): HiddenLineMode {
  return current === "off" ? "mesh" : "off";
}
