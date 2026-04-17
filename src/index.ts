import {
  defineExperiment,
  formatExperimentSummary,
} from "@itwin-experiments/experiment-core";

export const cliModelExperiment = defineExperiment({
  slug: "cli-model",
  name: "Cli Model",
  summary:
    "Interactive terminal experiment for opening local iModels and projecting them into ANSI terminal views.",
  tags: ["cli", "imodel", "terminal", "projection"],
});

export function describeCliModelExperiment(): string {
  return formatExperimentSummary(cliModelExperiment);
}

export * from "./app.js";
export * from "./imodel.js";
export * from "./render.js";
