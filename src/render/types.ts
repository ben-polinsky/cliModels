export type ProjectionPlane = "top" | "front" | "side" | "iso";
export type RenderMode = "hybrid" | "lines" | "points";
export type HiddenLineMode = "off" | "mesh";

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface WorldRange {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface SceneSegment {
  elementId: string;
  start: WorldPoint;
  end: WorldPoint;
  adjacentNormals?: readonly WorldPoint[];
}

export interface ScenePointSample {
  elementId: string;
  position: WorldPoint;
}

export interface SceneModel {
  id: string;
  classFullName: string;
  name: string;
  displayedElementCount: number;
  elementLimitReached: boolean;
  segments: SceneSegment[];
  points: ScenePointSample[];
  worldRange: WorldRange;
}

export interface SceneDocument {
  filePath: string;
  openKind: string;
  rootSubjectName: string;
  models: SceneModel[];
  worldRange: WorldRange;
}

export interface ViewerState {
  modelIndex: number;
  preset: ProjectionPlane | "free";
  yaw: number;
  pitch: number;
  renderMode: RenderMode;
  hiddenLineMode: HiddenLineMode;
  zoom: number;
  panX: number;
  panY: number;
  showHud: boolean;
  showHelp: boolean;
}

export interface RenderViewport {
  width: number;
  height: number;
}

export function createEmptyRange(): WorldRange {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
}

export function isRangeEmpty(range: WorldRange): boolean {
  return (
    !Number.isFinite(range.minX) ||
    !Number.isFinite(range.minY) ||
    !Number.isFinite(range.minZ) ||
    !Number.isFinite(range.maxX) ||
    !Number.isFinite(range.maxY) ||
    !Number.isFinite(range.maxZ)
  );
}

export function includePointInRange(range: WorldRange, point: WorldPoint): void {
  range.minX = Math.min(range.minX, point.x);
  range.minY = Math.min(range.minY, point.y);
  range.minZ = Math.min(range.minZ, point.z);
  range.maxX = Math.max(range.maxX, point.x);
  range.maxY = Math.max(range.maxY, point.y);
  range.maxZ = Math.max(range.maxZ, point.z);
}

export function includeRange(target: WorldRange, source: WorldRange): void {
  if (isRangeEmpty(source)) {
    return;
  }

  includePointInRange(target, {
    x: source.minX,
    y: source.minY,
    z: source.minZ,
  });
  includePointInRange(target, {
    x: source.maxX,
    y: source.maxY,
    z: source.maxZ,
  });
}

export function createInitialViewerState(
  overrides: Partial<ViewerState> = {},
): ViewerState {
  return {
    modelIndex: 0,
    preset: "top",
    yaw: 0,
    pitch: 0,
    renderMode: "lines",
    hiddenLineMode: "off",
    zoom: 1,
    panX: 0,
    panY: 0,
    showHud: true,
    showHelp: true,
    ...overrides,
  };
}

export function getActiveModel(
  document: SceneDocument,
  state: ViewerState,
): SceneModel {
  return document.models[Math.max(0, Math.min(state.modelIndex, document.models.length - 1))]!;
}
