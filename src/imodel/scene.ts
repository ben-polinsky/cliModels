import { basename } from "node:path";

import {
  type IModelDb,
} from "@itwin/core-backend";
import { type Id64String } from "@itwin/core-bentley";
import {
  type ElementProps,
  type GeometricModel3dProps,
} from "@itwin/core-common";

import {
  createEmptyRange,
  includePointInRange,
  includeRange,
  isRangeEmpty,
  type SceneDocument,
  type SceneModel,
  type ScenePointSample,
  type SceneSegment,
} from "../render.js";
import {
  appendSegments,
  collectLineSegments,
  collectMeshPoints,
  collectMeshWireframe,
  collectPlacementFallback,
} from "./geometry.js";
import type { CliModelSession, LoadSceneOptions } from "./types.js";

export async function loadSceneDocument(
  session: CliModelSession,
  options: LoadSceneOptions = {},
): Promise<SceneDocument> {
  const maxElementsPerModel = options.maxElementsPerModel ?? 200;
  const modelIds = Array.from(
    session.db.queryEntityIds({
      from: "BisCore.GeometricModel3d",
      orderBy: "ECInstanceId",
    }),
  );
  const models: SceneModel[] = [];
  const worldRange = createEmptyRange();

  for (const modelId of modelIds) {
    const sceneModel = await buildSceneModel(session.db, modelId, {
      ...options,
      maxElementsPerModel,
    });

    if (!sceneModel) {
      continue;
    }

    models.push(sceneModel);
    includeRange(worldRange, sceneModel.worldRange);
  }

  return {
    filePath: session.filePath,
    openKind: session.openKind,
    rootSubjectName: getRootSubjectName(session.db, session.filePath),
    models,
    worldRange,
  };
}

async function buildSceneModel(
  db: IModelDb,
  modelId: Id64String,
  options: LoadSceneOptions,
): Promise<SceneModel | undefined> {
  const modelProps = db.models.getModelProps<GeometricModel3dProps>(modelId);
  const elementIds = Array.from(
    db.queryEntityIds({
      from: "BisCore.GeometricElement3d",
      where: "Model.Id = ?",
      bindings: [modelId],
      orderBy: "ECInstanceId",
      limit: options.maxElementsPerModel ?? 200,
    }),
  );

  if (elementIds.length === 0) {
    return undefined;
  }

  const worldRange = createEmptyRange();
  const segments: SceneSegment[] = [];
  const points: ScenePointSample[] = [];
  const nativeSegmentsByElement = new Map<string, SceneSegment[]>();
  const meshSegmentsByElement = new Map<string, SceneSegment[]>();
  const maxLineSegmentsPerElement = options.maxLineSegmentsPerElement ?? 320;
  const maxPointSamplesPerMesh = options.maxPointSamplesPerMesh ?? 180;

  await db.exportGraphicsAsync({
    elementIdArray: elementIds,
    chordTol: options.chordTol ?? 0.25,
    angleTol: options.angleTol ?? Math.PI / 18,
    onLineGraphics: ({ elementId, lines }) => {
      appendSegments(
        nativeSegmentsByElement,
        elementId,
        collectLineSegments(elementId, lines, maxLineSegmentsPerElement),
      );
    },
    onGraphics: ({ elementId, mesh }) => {
      appendSegments(
        meshSegmentsByElement,
        elementId,
        collectMeshWireframe(elementId, mesh, maxLineSegmentsPerElement),
      );
      collectMeshPoints(points, worldRange, elementId, mesh, maxPointSamplesPerMesh);
    },
  });

  for (const elementId of elementIds) {
    const key = String(elementId);
    const preferredSegments =
      nativeSegmentsByElement.get(key) ?? meshSegmentsByElement.get(key) ?? [];

    for (const segment of preferredSegments) {
      segments.push(segment);
      includePointInRange(worldRange, segment.start);
      includePointInRange(worldRange, segment.end);
    }
  }

  if (segments.length === 0 && points.length === 0) {
    collectPlacementFallback(db, elementIds, segments, points, worldRange);
  }

  if (isRangeEmpty(worldRange)) {
    const modelRange = await db.models.queryRange(modelId);
    includePointInRange(worldRange, {
      x: modelRange.low.x,
      y: modelRange.low.y,
      z: modelRange.low.z,
    });
    includePointInRange(worldRange, {
      x: modelRange.high.x,
      y: modelRange.high.y,
      z: modelRange.high.z,
    });
  }

  if (segments.length === 0 && points.length === 0) {
    return undefined;
  }

  return {
    id: modelId,
    classFullName: modelProps.classFullName,
    name: describeModel(db, modelProps, modelId),
    displayedElementCount: elementIds.length,
    elementLimitReached: elementIds.length >= (options.maxElementsPerModel ?? 200),
    segments,
    points,
    worldRange,
  };
}

function getRootSubjectName(db: IModelDb, filePath: string): string {
  const rootSubject = db.elements.getRootSubject();
  const codeValue = rootSubject.code.value?.trim();
  return codeValue && codeValue.length > 0 ? codeValue : basename(filePath);
}

function describeModel(
  db: IModelDb,
  modelProps: GeometricModel3dProps,
  modelId: string,
): string {
  const elementId = modelProps.modeledElement.id;
  const modeledElement = db.elements.tryGetElementProps<ElementProps>(elementId);
  const userLabel = modeledElement?.userLabel?.trim();
  const codeValue = modeledElement?.code.value?.trim();
  const modelName = modelProps.name?.trim();

  return (
    userLabel ||
    codeValue ||
    modelName ||
    `${modelProps.classFullName.split(":").pop() ?? "Model"} ${modelId}`
  );
}
