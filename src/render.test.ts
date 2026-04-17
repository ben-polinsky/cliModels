import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialViewerState,
  getProjectedSpan,
  renderViewer,
  type SceneDocument,
  type SceneModel,
  type SceneSegment,
  type ViewerState,
  type WorldPoint,
} from "./render.js";

function createSceneModel(overrides: Partial<SceneModel> = {}): SceneModel {
  return {
    id: "0x1",
    classFullName: "BisCore:PhysicalModel",
    name: "Test Model",
    displayedElementCount: 1,
    elementLimitReached: false,
    segments: [],
    points: [],
    worldRange: {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 10,
      maxY: 4,
      maxZ: 6,
    },
    ...overrides,
  };
}

function createSceneDocument(model: SceneModel): SceneDocument {
  return {
    filePath: "/tmp/test.bim",
    openKind: "snapshot",
    rootSubjectName: "Test Subject",
    models: [model],
    worldRange: model.worldRange,
  };
}

function createSegment(
  start: WorldPoint,
  end: WorldPoint,
  adjacentNormals?: readonly WorldPoint[],
): SceneSegment {
  return {
    elementId: "0x10",
    start,
    end,
    adjacentNormals,
  };
}

function createViewerState(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    ...createInitialViewerState(),
    showHud: false,
    showHelp: false,
    ...overrides,
  };
}

test("createInitialViewerState starts in top lines mode", () => {
  const state = createInitialViewerState();

  assert.equal(state.preset, "top");
  assert.equal(state.renderMode, "lines");
  assert.equal(state.hiddenLineMode, "off");
  assert.equal(state.yaw, 0);
  assert.equal(state.pitch, 0);
});

test("rotating the camera changes projected span", () => {
  const model = createSceneModel({
    segments: [
      createSegment(
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ),
      createSegment(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 4, z: 6 },
      ),
    ],
  });

  const topSpan = getProjectedSpan(model, createViewerState());
  const rotatedSpan = getProjectedSpan(
    model,
    createViewerState({
      preset: "free",
      yaw: Math.PI / 4,
      pitch: -Math.PI / 6,
    }),
  );

  assert.notDeepEqual(rotatedSpan, topSpan);
});

test("smooth non-silhouette mesh edges are hidden", () => {
  const model = createSceneModel({
    segments: [
      createSegment(
        { x: 1, y: 1, z: 1 },
        { x: 9, y: 1, z: 1 },
        [
          { x: 0, y: 0, z: 1 },
          { x: 0, y: 0, z: 1 },
        ],
      ),
    ],
  });

  const output = renderViewer(
    createSceneDocument(model),
    createViewerState(),
    { width: 30, height: 12 },
    false,
  );

  assert.equal(output.trim(), "");
});

test("strong crease edges remain visible", () => {
  const model = createSceneModel({
    segments: [
      createSegment(
        { x: 1, y: 1, z: 1 },
        { x: 9, y: 1, z: 1 },
        [
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
      ),
    ],
  });

  const output = renderViewer(
    createSceneDocument(model),
    createViewerState({
      hiddenLineMode: "mesh",
    }),
    { width: 30, height: 12 },
    false,
  );

  assert.notEqual(output.trim(), "");
});

test("front point samples occlude deeper linework", () => {
  const model = createSceneModel({
    segments: [
      createSegment(
        { x: 1, y: 1, z: 5 },
        { x: 9, y: 1, z: 5 },
        [
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
      ),
    ],
    points: Array.from({ length: 9 }, (_, index) => ({
      elementId: "0x11",
      position: { x: index + 1, y: 1, z: 1 },
    })),
  });

  const output = renderViewer(
    createSceneDocument(model),
    createViewerState({
      hiddenLineMode: "mesh",
    }),
    { width: 30, height: 12 },
    false,
  );

  assert.equal(output.trim(), "");
});

test("linework in front of point samples stays visible", () => {
  const model = createSceneModel({
    segments: [
      createSegment(
        { x: 1, y: 1, z: 1 },
        { x: 9, y: 1, z: 1 },
        [
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
      ),
    ],
    points: Array.from({ length: 9 }, (_, index) => ({
      elementId: "0x11",
      position: { x: index + 1, y: 1, z: 5 },
    })),
  });

  const output = renderViewer(
    createSceneDocument(model),
    createViewerState(),
    { width: 30, height: 12 },
    false,
  );

  assert.notEqual(output.trim(), "");
});

test("native linework is not suppressed by point occlusion", () => {
  const model = createSceneModel({
    segments: [
      createSegment(
        { x: 1, y: 1, z: 5 },
        { x: 9, y: 1, z: 5 },
      ),
    ],
    points: Array.from({ length: 9 }, (_, index) => ({
      elementId: "0x11",
      position: { x: index + 1, y: 1, z: 1 },
    })),
  });

  const output = renderViewer(
    createSceneDocument(model),
    createViewerState(),
    { width: 30, height: 12 },
    false,
  );

  assert.notEqual(output.trim(), "");
});

test("hidden-line occlusion is optional", () => {
  const model = createSceneModel({
    segments: [
      createSegment(
        { x: 1, y: 1, z: 5 },
        { x: 9, y: 1, z: 5 },
        [
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
      ),
    ],
    points: Array.from({ length: 9 }, (_, index) => ({
      elementId: "0x11",
      position: { x: index + 1, y: 1, z: 1 },
    })),
  });

  const output = renderViewer(
    createSceneDocument(model),
    createViewerState(),
    { width: 30, height: 12 },
    false,
  );

  assert.notEqual(output.trim(), "");
});

test("hud shows free rotation angles", () => {
  const model = createSceneModel({
    segments: [
      createSegment(
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ),
    ],
  });
  const state = createViewerState({
    showHud: true,
    preset: "free",
    yaw: Math.PI / 4,
    pitch: 0,
  });

  const output = renderViewer(
    createSceneDocument(model),
    state,
    { width: 80, height: 16 },
    false,
  );

  assert.match(output, /view free/);
  assert.match(output, /yaw 45deg/);
  assert.match(output, /hidden off/);
});
