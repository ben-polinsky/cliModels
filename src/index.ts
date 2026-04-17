export const cliModelExperiment = {
  slug: "cli-model",
  name: "Cli Model",
  summary:
    "Interactive terminal experiment for opening local iModels and projecting them into ANSI terminal views.",
  tags: ["cli", "imodel", "terminal", "projection"],
} as const;

export * from "./app.js";
export * from "./imodel.js";
export * from "./render.js";
