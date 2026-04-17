import {
  type ExportGraphicsLines,
  type ExportGraphicsMesh,
  type IModelDb,
} from "@itwin/core-backend";
import { type Id64String } from "@itwin/core-bentley";
import {
  isPlacement3dProps,
  type GeometricElement3dProps,
} from "@itwin/core-common";
import { Matrix3d, Point3d, Transform, YawPitchRollAngles } from "@itwin/core-geometry";

import {
  includePointInRange,
  type ScenePointSample,
  type SceneSegment,
  type WorldPoint,
  type WorldRange,
} from "../render.js";

interface EdgeAccumulator {
  start: WorldPoint;
  end: WorldPoint;
  normals: WorldPoint[];
}

export function appendSegments(
  target: Map<string, SceneSegment[]>,
  elementId: string,
  segments: readonly SceneSegment[],
): void {
  if (segments.length === 0) {
    return;
  }

  const existing = target.get(elementId);
  if (!existing) {
    target.set(elementId, [...segments]);
    return;
  }

  existing.push(...segments);
}

export function collectLineSegments(
  elementId: string,
  lines: ExportGraphicsLines,
  maxSegments: number,
): SceneSegment[] {
  const available = Math.floor(lines.indices.length / 2);
  if (available === 0) {
    return [];
  }

  const segments = Array.from({ length: available }, (_, segmentIndex) => {
    const firstIndex = lines.indices[segmentIndex * 2]!;
    const secondIndex = lines.indices[segmentIndex * 2 + 1]!;
    const start = pointFromPackedArray(lines.points, firstIndex);
    const end = pointFromPackedArray(lines.points, secondIndex);
    return { elementId, start, end } satisfies SceneSegment;
  }).sort((lhs, rhs) => segmentLength(rhs) - segmentLength(lhs));

  const selectedSegments: SceneSegment[] = [];
  const stride = Math.max(1, Math.ceil(segments.length / maxSegments));

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += stride) {
    selectedSegments.push(segments[segmentIndex]!);
  }

  return selectedSegments;
}

export function collectMeshPoints(
  target: ScenePointSample[],
  range: WorldRange,
  elementId: string,
  mesh: ExportGraphicsMesh,
  maxSamples: number,
): void {
  const available = Math.floor(mesh.points.length / 3);
  if (available === 0) {
    return;
  }

  const stride = Math.max(1, Math.ceil(available / maxSamples));
  for (let pointIndex = 0; pointIndex < available; pointIndex += stride) {
    const point = pointFromPackedArray(mesh.points, pointIndex);
    target.push({ elementId, position: point });
    includePointInRange(range, point);
  }
}

export function collectMeshWireframe(
  elementId: string,
  mesh: ExportGraphicsMesh,
  maxSegments: number,
): SceneSegment[] {
  const triangleCount = Math.floor(mesh.indices.length / 3);
  if (triangleCount === 0) {
    return [];
  }

  const edges = new Map<string, EdgeAccumulator>();

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const offset = triangleIndex * 3;
    const index0 = mesh.indices[offset]!;
    const index1 = mesh.indices[offset + 1]!;
    const index2 = mesh.indices[offset + 2]!;
    const point0 = pointFromPackedArray(mesh.points, index0);
    const point1 = pointFromPackedArray(mesh.points, index1);
    const point2 = pointFromPackedArray(mesh.points, index2);
    const normal = computeTriangleNormal(point0, point1, point2);

    accumulateEdge(edges, index0, index1, point0, point1, normal);
    accumulateEdge(edges, index1, index2, point1, point2, normal);
    accumulateEdge(edges, index2, index0, point2, point0, normal);
  }

  const candidateEdges = Array.from(edges.values())
    .filter(shouldKeepMeshEdge)
    .sort((lhs, rhs) => edgeLength(rhs) - edgeLength(lhs));

  if (candidateEdges.length === 0) {
    return [];
  }

  const segments: SceneSegment[] = [];
  const stride = Math.max(1, Math.ceil(candidateEdges.length / maxSegments));
  for (let edgeIndex = 0; edgeIndex < candidateEdges.length; edgeIndex += stride) {
    const edge = candidateEdges[edgeIndex]!;
    segments.push({
      elementId,
      start: edge.start,
      end: edge.end,
      adjacentNormals: edge.normals.slice(0, 2),
    });
  }

  return segments;
}

export function collectPlacementFallback(
  db: IModelDb,
  elementIds: readonly Id64String[],
  segments: SceneSegment[],
  points: ScenePointSample[],
  range: WorldRange,
): void {
  for (const elementId of elementIds) {
    const props = db.elements.tryGetElementProps<GeometricElement3dProps>(elementId);
    const placement = props?.placement;
    if (!placement || !isPlacement3dProps(placement) || !placement.bbox) {
      continue;
    }

    const bbox = placement.bbox;
    const low = Point3d.fromJSON(bbox.low);
    const high = Point3d.fromJSON(bbox.high);
    const transform = Transform.createOriginAndMatrix(
      Point3d.fromJSON(placement.origin),
      YawPitchRollAngles.fromJSON(placement.angles).toMatrix3d(Matrix3d.createIdentity()),
    );
    const corners = [
      Point3d.create(low.x, low.y, low.z),
      Point3d.create(high.x, low.y, low.z),
      Point3d.create(high.x, high.y, low.z),
      Point3d.create(low.x, high.y, low.z),
      Point3d.create(low.x, low.y, high.z),
      Point3d.create(high.x, low.y, high.z),
      Point3d.create(high.x, high.y, high.z),
      Point3d.create(low.x, high.y, high.z),
    ].map((corner) => transform.multiplyPoint3d(corner));

    const worldCorners = corners.map((corner) => ({
      x: corner.x,
      y: corner.y,
      z: corner.z,
    }));

    for (const point of worldCorners) {
      points.push({ elementId, position: point });
      includePointInRange(range, point);
    }

    for (const [startIndex, endIndex] of BOX_EDGE_INDEXES) {
      segments.push({
        elementId,
        start: worldCorners[startIndex]!,
        end: worldCorners[endIndex]!,
      });
    }
  }
}

function pointFromPackedArray(
  source: Float64Array,
  pointIndex: number,
): WorldPoint {
  const offset = pointIndex * 3;
  return {
    x: source[offset]!,
    y: source[offset + 1]!,
    z: source[offset + 2]!,
  };
}

function accumulateEdge(
  edges: Map<string, EdgeAccumulator>,
  firstIndex: number,
  secondIndex: number,
  start: WorldPoint,
  end: WorldPoint,
  normal: WorldPoint | undefined,
): void {
  const a = Math.min(firstIndex, secondIndex);
  const b = Math.max(firstIndex, secondIndex);
  const key = `${a}:${b}`;
  const existing = edges.get(key);

  if (!existing) {
    edges.set(key, {
      start,
      end,
      normals: normal ? [normal] : [],
    });
    return;
  }

  if (normal) {
    existing.normals.push(normal);
  }
}

function shouldKeepMeshEdge(edge: EdgeAccumulator): boolean {
  if (edge.normals.length < 2) {
    return true;
  }

  const [firstNormal, secondNormal] = edge.normals;
  if (!firstNormal || !secondNormal) {
    return true;
  }

  return dot(firstNormal, secondNormal) < 0.99;
}

function computeTriangleNormal(
  point0: WorldPoint,
  point1: WorldPoint,
  point2: WorldPoint,
): WorldPoint | undefined {
  const vectorA = subtract(point1, point0);
  const vectorB = subtract(point2, point0);
  const cross = {
    x: vectorA.y * vectorB.z - vectorA.z * vectorB.y,
    y: vectorA.z * vectorB.x - vectorA.x * vectorB.z,
    z: vectorA.x * vectorB.y - vectorA.y * vectorB.x,
  };
  const magnitude = Math.hypot(cross.x, cross.y, cross.z);

  if (magnitude <= 1e-9) {
    return undefined;
  }

  return {
    x: cross.x / magnitude,
    y: cross.y / magnitude,
    z: cross.z / magnitude,
  };
}

function subtract(lhs: WorldPoint, rhs: WorldPoint): WorldPoint {
  return {
    x: lhs.x - rhs.x,
    y: lhs.y - rhs.y,
    z: lhs.z - rhs.z,
  };
}

function dot(lhs: WorldPoint, rhs: WorldPoint): number {
  return lhs.x * rhs.x + lhs.y * rhs.y + lhs.z * rhs.z;
}

function segmentLength(segment: SceneSegment): number {
  return Math.hypot(
    segment.end.x - segment.start.x,
    segment.end.y - segment.start.y,
    segment.end.z - segment.start.z,
  );
}

function edgeLength(edge: EdgeAccumulator): number {
  return Math.hypot(
    edge.end.x - edge.start.x,
    edge.end.y - edge.start.y,
    edge.end.z - edge.start.z,
  );
}

const BOX_EDGE_INDEXES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];
