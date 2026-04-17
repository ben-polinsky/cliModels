import {
  getActiveModel,
  type RenderViewport,
  type SceneDocument,
  type SceneModel,
  type SceneSegment,
  type ViewerState,
  type WorldPoint,
  type WorldRange,
} from "./types.js";

const ANSI_RESET = "\u001b[0m";
const ANSI_BOLD = "\u001b[1m";
const ANSI_CYAN = "\u001b[36m";
const ANSI_DIM = "\u001b[2m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_GREEN = "\u001b[32m";
const OCCLUSION_RADIUS = 2;

export function getProjectedSpan(
  model: SceneModel,
  state: ViewerState,
): { width: number; height: number } {
  const range = getProjectedRange(model, state);
  return {
    width: Math.max(range.maxA - range.minA, 1e-6),
    height: Math.max(range.maxB - range.minB, 1e-6),
  };
}

export function renderViewer(
  document: SceneDocument,
  state: ViewerState,
  viewport: RenderViewport,
  ansi: boolean,
): string {
  const activeModel = getActiveModel(document, state);
  const hudHeight = state.showHud ? (state.showHelp ? 5 : 3) : 0;
  const sceneHeight = Math.max(6, viewport.height - hudHeight);
  const sceneWidth = Math.max(20, viewport.width);
  const sceneLines = rasterizeScene(activeModel, state, {
    width: sceneWidth,
    height: sceneHeight,
  }).map((line) => colorize(line, ANSI_CYAN, ansi));

  if (!state.showHud) {
    return sceneLines.join("\n");
  }

  const hudLines = buildHud(document, activeModel, state, sceneWidth, ansi);
  return [...sceneLines, ...hudLines].join("\n");
}

function rasterizeScene(
  model: SceneModel,
  state: ViewerState,
  viewport: RenderViewport,
): string[] {
  const cells = Array.from({ length: viewport.height }, () =>
    Array.from({ length: viewport.width }, () => " "),
  );
  const depthBuffer = Array.from({ length: viewport.height }, () =>
    Array.from({ length: viewport.width }, () => Number.POSITIVE_INFINITY),
  );
  const projectedRange = getProjectedRange(model, state);
  const centerX = (projectedRange.minA + projectedRange.maxA) / 2 + state.panX;
  const centerY = (projectedRange.minB + projectedRange.maxB) / 2 + state.panY;
  const span = getProjectedSpan(model, state);
  const scale =
    Math.min(
      (viewport.width - 2) / Math.max(span.width, 1e-6),
      (viewport.height - 2) / Math.max(span.height, 1e-6),
    ) * state.zoom;
  const view = {
    centerX,
    centerY,
    scale,
    width: viewport.width,
    height: viewport.height,
    depthNear: projectedRange.minDepth,
    depthFar: projectedRange.maxDepth,
  } satisfies ProjectedView;
  const occlusionDepthBuffer = buildOcclusionDepthBuffer(model, state, view);

  if (state.renderMode !== "points") {
    for (const segment of model.segments) {
      if (!shouldRenderSegment(segment, state)) {
        continue;
      }

      drawSegment(cells, depthBuffer, occlusionDepthBuffer, segment, state, view);
    }
  }

  if (state.renderMode !== "lines") {
    for (const point of model.points) {
      drawPoint(cells, depthBuffer, point.position, state, view);
    }
  }

  return cells.map((row) => row.join(""));
}

function shouldRenderSegment(
  segment: SceneSegment,
  state: ViewerState,
): boolean {
  const normals = segment.adjacentNormals;
  if (!normals || normals.length < 2) {
    return true;
  }

  const [firstNormal, secondNormal] = normals;
  if (!firstNormal || !secondNormal) {
    return true;
  }

  if (dot(firstNormal, secondNormal) < 0.92) {
    return true;
  }

  const rotatedFirst = rotateVector(firstNormal, state);
  const rotatedSecond = rotateVector(secondNormal, state);
  const facingA = rotatedFirst.z;
  const facingB = rotatedSecond.z;
  const silhouetteEpsilon = 0.05;

  if (Math.abs(facingA) <= silhouetteEpsilon || Math.abs(facingB) <= silhouetteEpsilon) {
    return true;
  }

  return facingA * facingB < 0;
}

function drawSegment(
  cells: string[][],
  depthBuffer: number[][],
  occlusionDepthBuffer: number[][],
  segment: SceneSegment,
  state: ViewerState,
  view: ProjectedView,
): void {
  const start = projectPoint(segment.start, state);
  const end = projectPoint(segment.end, state);
  const x0 = worldToScreenX(start.a, view);
  const y0 = worldToScreenY(start.b, view);
  const x1 = worldToScreenX(end.a, view);
  const y1 = worldToScreenY(end.b, view);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const depth = start.depth + (end.depth - start.depth) * t;
    if (
      shouldApplyOcclusion(segment, state) &&
      isOccluded(occlusionDepthBuffer, x, y, depth, view)
    ) {
      continue;
    }
    plot(cells, depthBuffer, x, y, depth, depthToChar(depth, view), true);
  }
}

function drawPoint(
  cells: string[][],
  depthBuffer: number[][],
  point: WorldPoint,
  state: ViewerState,
  view: ProjectedView,
): void {
  const projected = projectPoint(point, state);
  const x = worldToScreenX(projected.a, view);
  const y = worldToScreenY(projected.b, view);
  plot(cells, depthBuffer, x, y, projected.depth, ".", false);
}

function plot(
  cells: string[][],
  depthBuffer: number[][],
  x: number,
  y: number,
  depth: number,
  char: string,
  replacePoints: boolean,
): void {
  if (y < 0 || y >= cells.length || x < 0 || x >= cells[0]!.length) {
    return;
  }

  if (depth > depthBuffer[y]![x]!) {
    return;
  }

  if (!replacePoints && cells[y]![x] !== " ") {
    return;
  }

  depthBuffer[y]![x] = depth;
  cells[y]![x] = char;
}

function buildOcclusionDepthBuffer(
  model: SceneModel,
  state: ViewerState,
  view: ProjectedView,
): number[][] {
  const occlusionDepthBuffer = Array.from({ length: view.height }, () =>
    Array.from({ length: view.width }, () => Number.POSITIVE_INFINITY),
  );

  for (const point of model.points) {
    const projected = projectPoint(point.position, state);
    const x = worldToScreenX(projected.a, view);
    const y = worldToScreenY(projected.b, view);
    plotOccluder(occlusionDepthBuffer, x, y, projected.depth);
  }

  return occlusionDepthBuffer;
}

function shouldApplyOcclusion(segment: SceneSegment, state: ViewerState): boolean {
  return (
    state.hiddenLineMode === "mesh" &&
    Boolean(segment.adjacentNormals && segment.adjacentNormals.length > 0)
  );
}

function plotOccluder(
  depthBuffer: number[][],
  x: number,
  y: number,
  depth: number,
): void {
  for (let deltaY = -OCCLUSION_RADIUS; deltaY <= OCCLUSION_RADIUS; deltaY += 1) {
    const targetY = y + deltaY;
    if (targetY < 0 || targetY >= depthBuffer.length) {
      continue;
    }

    for (let deltaX = -OCCLUSION_RADIUS; deltaX <= OCCLUSION_RADIUS; deltaX += 1) {
      const targetX = x + deltaX;
      if (targetX < 0 || targetX >= depthBuffer[0]!.length) {
        continue;
      }

      depthBuffer[targetY]![targetX] = Math.min(depthBuffer[targetY]![targetX]!, depth);
    }
  }
}

function isOccluded(
  occlusionDepthBuffer: number[][],
  x: number,
  y: number,
  depth: number,
  view: ProjectedView,
): boolean {
  if (y < 0 || y >= occlusionDepthBuffer.length || x < 0 || x >= occlusionDepthBuffer[0]!.length) {
    return false;
  }

  let occluderDepth = Number.POSITIVE_INFINITY;
  for (let deltaY = -OCCLUSION_RADIUS; deltaY <= OCCLUSION_RADIUS; deltaY += 1) {
    const targetY = y + deltaY;
    if (targetY < 0 || targetY >= occlusionDepthBuffer.length) {
      continue;
    }

    for (let deltaX = -OCCLUSION_RADIUS; deltaX <= OCCLUSION_RADIUS; deltaX += 1) {
      const targetX = x + deltaX;
      if (targetX < 0 || targetX >= occlusionDepthBuffer[0]!.length) {
        continue;
      }

      occluderDepth = Math.min(occluderDepth, occlusionDepthBuffer[targetY]![targetX]!);
    }
  }

  if (!Number.isFinite(occluderDepth)) {
    return false;
  }

  const depthTolerance = Math.max((view.depthFar - view.depthNear) * 0.015, 0.1);
  return depth > occluderDepth + depthTolerance;
}

interface ProjectedPoint {
  a: number;
  b: number;
  depth: number;
}

interface ProjectedView {
  centerX: number;
  centerY: number;
  scale: number;
  width: number;
  height: number;
  depthNear: number;
  depthFar: number;
}

function projectPoint(point: WorldPoint, state: ViewerState): ProjectedPoint {
  const rotated = rotatePoint(point, state);
  return { a: rotated.x, b: rotated.y, depth: rotated.z };
}

function rotatePoint(point: WorldPoint, state: ViewerState): WorldPoint {
  const yawCos = Math.cos(state.yaw);
  const yawSin = Math.sin(state.yaw);
  const pitchCos = Math.cos(state.pitch);
  const pitchSin = Math.sin(state.pitch);

  const x1 = point.x * yawCos - point.y * yawSin;
  const y1 = point.x * yawSin + point.y * yawCos;
  const z1 = point.z;

  return {
    x: x1,
    y: y1 * pitchCos - z1 * pitchSin,
    z: y1 * pitchSin + z1 * pitchCos,
  };
}

function rotateVector(vector: WorldPoint, state: ViewerState): WorldPoint {
  return rotatePoint(vector, state);
}

function worldToScreenX(value: number, view: ProjectedView): number {
  return Math.round((value - view.centerX) * view.scale + view.width / 2);
}

function worldToScreenY(value: number, view: ProjectedView): number {
  return Math.round(view.height / 2 - (value - view.centerY) * view.scale);
}

function depthToChar(depth: number, view: ProjectedView): string {
  const palette = ".,-:=+*#%@";
  const span = Math.max(view.depthFar - view.depthNear, 1e-6);
  const normalized = (depth - view.depthNear) / span;
  const index = Math.max(
    0,
    Math.min(
      palette.length - 1,
      Math.round((1 - normalized) * (palette.length - 1)),
    ),
  );

  return palette[index]!;
}

function getProjectedRange(model: SceneModel, state: ViewerState): {
  minA: number;
  maxA: number;
  minB: number;
  maxB: number;
  minDepth: number;
  maxDepth: number;
} {
  let minA = Number.POSITIVE_INFINITY;
  let maxA = Number.NEGATIVE_INFINITY;
  let minB = Number.POSITIVE_INFINITY;
  let maxB = Number.NEGATIVE_INFINITY;
  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = Number.NEGATIVE_INFINITY;

  const includeProjectedPoint = (point: WorldPoint) => {
    const projected = projectPoint(point, state);
    minA = Math.min(minA, projected.a);
    maxA = Math.max(maxA, projected.a);
    minB = Math.min(minB, projected.b);
    maxB = Math.max(maxB, projected.b);
    minDepth = Math.min(minDepth, projected.depth);
    maxDepth = Math.max(maxDepth, projected.depth);
  };

  for (const segment of model.segments) {
    includeProjectedPoint(segment.start);
    includeProjectedPoint(segment.end);
  }

  for (const point of model.points) {
    includeProjectedPoint(point.position);
  }

  if (!Number.isFinite(minA) || !Number.isFinite(minB) || !Number.isFinite(minDepth)) {
    for (const corner of getRangeCorners(model.worldRange)) {
      includeProjectedPoint(corner);
    }
  }

  return { minA, maxA, minB, maxB, minDepth, maxDepth };
}

function buildHud(
  document: SceneDocument,
  model: SceneModel,
  state: ViewerState,
  width: number,
  ansi: boolean,
): string[] {
  const lines = [
    formatHudLine(
      `${colorize("cli-model", ANSI_BOLD, ansi)}  ${document.rootSubjectName}  ${colorize(document.openKind, ANSI_GREEN, ansi)}  ${document.filePath}`,
      width,
    ),
    formatHudLine(
      `model ${state.modelIndex + 1}/${document.models.length}: ${colorize(model.name, ANSI_YELLOW, ansi)}  view ${state.preset}  yaw ${formatAngle(state.yaw)}  pitch ${formatAngle(state.pitch)}  mode ${state.renderMode}  hidden ${state.hiddenLineMode}  zoom ${state.zoom.toFixed(2)}`,
      width,
    ),
    formatHudLine(
      `elements ${model.displayedElementCount}${model.elementLimitReached ? " (capped)" : ""}  segments ${model.segments.length}  points ${model.points.length}`,
      width,
    ),
  ];

  if (state.showHelp) {
    lines.push(
      formatHudLine(
        colorize(
          "arrows/hjkl pan  wasd rotate  +/- zoom  p preset  m mode  o hidden  [ ] models  r reset  i hud  ? help  q quit",
          ANSI_DIM,
          ansi,
        ),
        width,
      ),
      formatHudLine(
        colorize(
          "This is a coarse terminal projection of exported iModel geometry, not a full viewer.",
          ANSI_DIM,
          ansi,
        ),
        width,
      ),
    );
  }

  return lines;
}

function formatHudLine(line: string, width: number): string {
  const visibleLine = stripAnsi(line);
  if (visibleLine.length >= width) {
    return line.slice(0, Math.max(0, width));
  }

  return `${line}${" ".repeat(width - visibleLine.length)}`;
}

function colorize(text: string, color: string, ansi: boolean): string {
  return ansi ? `${color}${text}${ANSI_RESET}` : text;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function dot(lhs: WorldPoint, rhs: WorldPoint): number {
  return lhs.x * rhs.x + lhs.y * rhs.y + lhs.z * rhs.z;
}

function getRangeCorners(range: WorldRange): WorldPoint[] {
  return [
    { x: range.minX, y: range.minY, z: range.minZ },
    { x: range.maxX, y: range.minY, z: range.minZ },
    { x: range.maxX, y: range.maxY, z: range.minZ },
    { x: range.minX, y: range.maxY, z: range.minZ },
    { x: range.minX, y: range.minY, z: range.maxZ },
    { x: range.maxX, y: range.minY, z: range.maxZ },
    { x: range.maxX, y: range.maxY, z: range.maxZ },
    { x: range.minX, y: range.maxY, z: range.maxZ },
  ];
}

function formatAngle(radians: number): string {
  return `${Math.round((radians * 180) / Math.PI)}deg`;
}
