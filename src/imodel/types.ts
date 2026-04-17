import type { IModelDb } from "@itwin/core-backend";

export interface CliModelSession {
  db: IModelDb;
  filePath: string;
  openKind: "briefcase" | "standalone" | "snapshot";
}

export interface LoadSceneOptions {
  maxElementsPerModel?: number;
  maxPointSamplesPerMesh?: number;
  maxLineSegmentsPerElement?: number;
  chordTol?: number;
  angleTol?: number;
}
