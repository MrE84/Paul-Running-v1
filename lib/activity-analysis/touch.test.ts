import assert from "node:assert/strict";
import test from "node:test";
import { clampPointerX, touchGestureIntent } from "./touch";

test("touch gesture stays pending until movement clears the threshold", () => {
  assert.equal(touchGestureIntent(2, 3), "pending");
  assert.equal(touchGestureIntent(5, 1), "pending");
});

test("horizontal touch movement resolves to chart scrubbing", () => {
  assert.equal(touchGestureIntent(12, 3), "scrub");
  assert.equal(touchGestureIntent(-14, 7), "scrub");
  assert.equal(touchGestureIntent(8, 8), "scrub");
});

test("vertical touch movement resolves to page scrolling", () => {
  assert.equal(touchGestureIntent(3, 12), "scroll");
  assert.equal(touchGestureIntent(7, -14), "scroll");
});

test("pointer x position is clamped to the visible plot width", () => {
  assert.equal(clampPointerX(95, 100, 300), 0);
  assert.equal(clampPointerX(220, 100, 300), 120);
  assert.equal(clampPointerX(450, 100, 300), 300);
  assert.equal(clampPointerX(Number.NaN, 100, 300), 0);
});
