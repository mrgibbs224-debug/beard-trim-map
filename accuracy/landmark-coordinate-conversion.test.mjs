// Stage BI-1E Part 2 — pure unit tests for the normalized -> IMAGE landmark conversion boundary.
// Node built-in runner (node --test). Zero dependencies.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizedLandmarksToImageSpace, normalizedPointToImageSpace, LANDMARK_COORDINATE_CONVERSION_VERSION
} from './landmark-coordinate-conversion.mjs';
import { OVERLAY_COORDINATE_SPACE } from './annotation-overlay-data.mjs';
import { CoordinateSpace } from './beard-surface-core.mjs';

test('0 -> 0: the origin point stays the origin regardless of image size', () => {
  const r = normalizedLandmarksToImageSpace([{ x: 0, y: 0, z: 0 }], 640, 480);
  assert.equal(r.points[0].x, 0);
  assert.equal(r.points[0].y, 0);
});

test('1 -> width/height: the far corner maps exactly to the image dimensions', () => {
  const r = normalizedLandmarksToImageSpace([{ x: 1, y: 1, z: 0 }], 640, 480);
  assert.equal(r.points[0].x, 640);
  assert.equal(r.points[0].y, 480);
});

test('representative normalized points convert with simple multiplication', () => {
  const r = normalizedLandmarksToImageSpace([
    { x: 0.5, y: 0.5, z: 0.1 },   // center
    { x: 0.25, y: 0.75, z: -0.2 } // off-center
  ], 640, 480);
  assert.equal(r.points[0].x, 320);
  assert.equal(r.points[0].y, 240);
  assert.equal(r.points[0].z, 0.1);
  assert.equal(r.points[1].x, 160);
  assert.equal(r.points[1].y, 360);
});

test('real-shaped 640x480 keyframe: known real BI-1D landmark values convert to anatomically sane pixels', () => {
  // Real values from session scan_mtcfdr6x_atfvgh, observationId 4 (FRONT_REGION), verified by
  // offline visual overlay in BI-1D to land correctly on nose-tip / chin / forehead.
  const points = { 1: { x: 0.36306724, y: 0.49132863, z: 0.516907 } }; // nose-tip
  const arr = new Array(468).fill(null);
  arr[1] = points[1];
  const r = normalizedLandmarksToImageSpace(arr, 640, 480);
  assert.ok(Math.abs(r.points[1].x - 232.4) < 0.1);
  assert.ok(Math.abs(r.points[1].y - 235.8) < 0.1);
});

test('space is marked as the real OVERLAY_COORDINATE_SPACE constant, sourceSpace as CAPTURE_NORMALIZED', () => {
  const r = normalizedLandmarksToImageSpace([{ x: 0.5, y: 0.5 }], 640, 480);
  assert.equal(r.space, OVERLAY_COORDINATE_SPACE);
  assert.equal(r.space, 'IMAGE');
  assert.equal(r.sourceSpace, CoordinateSpace.CAPTURE_NORMALIZED);
});

test('invalid dimensions (missing, zero, negative, non-finite) fail closed to null', () => {
  const pts = [{ x: 0.5, y: 0.5 }];
  assert.equal(normalizedLandmarksToImageSpace(pts, null, 480), null);
  assert.equal(normalizedLandmarksToImageSpace(pts, 640, undefined), null);
  assert.equal(normalizedLandmarksToImageSpace(pts, 0, 480), null);
  assert.equal(normalizedLandmarksToImageSpace(pts, 640, -480), null);
  assert.equal(normalizedLandmarksToImageSpace(pts, NaN, 480), null);
  assert.equal(normalizedLandmarksToImageSpace(pts, 640, Infinity), null);
});

test('invalid/missing points become null at that index, never an invented coordinate', () => {
  const r = normalizedLandmarksToImageSpace([
    { x: 0.5, y: 0.5 },
    null,
    { x: NaN, y: 0.5 },
    { x: 0.5 }, // missing y
    'not a point'
  ], 640, 480);
  assert.ok(r.points[0] != null);
  assert.equal(r.points[1], null);
  assert.equal(r.points[2], null);
  assert.equal(r.points[3], null);
  assert.equal(r.points[4], null);
});

test('non-array points input fails closed to null', () => {
  assert.equal(normalizedLandmarksToImageSpace(null, 640, 480), null);
  assert.equal(normalizedLandmarksToImageSpace('not an array', 640, 480), null);
  assert.equal(normalizedLandmarksToImageSpace(undefined, 640, 480), null);
});

test('source values remain completely unmodified after conversion', () => {
  const source = [{ x: 0.36306724, y: 0.49132863, z: 0.516907 }];
  const sourceCopy = JSON.parse(JSON.stringify(source));
  normalizedLandmarksToImageSpace(source, 640, 480);
  assert.deepEqual(source, sourceCopy, 'the input array/points must never be mutated');
});

test('the returned descriptor and its points array are frozen (immutable)', () => {
  const r = normalizedLandmarksToImageSpace([{ x: 0.5, y: 0.5 }], 640, 480);
  assert.ok(Object.isFrozen(r));
  assert.ok(Object.isFrozen(r.points));
  assert.ok(Object.isFrozen(r.points[0]));
});

test('normalizedPointToImageSpace converts a single point the same way as the array form', () => {
  const p = normalizedPointToImageSpace({ x: 0.5, y: 0.5 }, 640, 480);
  assert.equal(p.x, 320);
  assert.equal(p.y, 240);
  assert.equal(normalizedPointToImageSpace(null, 640, 480), null);
});

test('module version is exported', () => {
  assert.equal(typeof LANDMARK_COORDINATE_CONVERSION_VERSION, 'string');
});
