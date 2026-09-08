import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanceJourney, journeyFrame, journeySnapshot, JOURNEY_CHAPTERS, JOURNEY_DURATION } from "../genlayer/change-journey.mjs";
const fixtures = JSON.parse(readFileSync(new URL("../config/change-network-walkthrough.json", import.meta.url), "utf8"));

test("a fresh run begins with original permissions and no outputs", () => {
  const frame = journeyFrame(0);
  assert.equal(frame.chapter, 0);
  assert.equal(frame.done, false);
  for (const fixture of Object.values(fixtures)) {
    const jobs = fixture.stages[journeySnapshot(frame, 0)].workflows.flatMap(w => w.actions);
    assert.ok(jobs.every(j => j.active_permit && !j.execution));
  }
});

test("every chapter has reading time and cannot be skipped by a delayed timer", () => {
  assert.ok(JOURNEY_CHAPTERS.every(c => c.duration >= 6000));
  assert.equal(advanceJourney(0, 90000), 250);
  assert.equal(advanceJourney(6499, 1), 6500);
  assert.equal(journeyFrame(6499).chapter, 0);
  assert.equal(journeyFrame(6500).chapter, 1);
});

test("hidden tabs, invalid deltas and completed runs never advance unexpectedly", () => {
  assert.equal(advanceJourney(6000, 1200, false), 6000);
  assert.equal(advanceJourney(6000, -2), 6000);
  assert.equal(advanceJourney(6000, NaN), 6000);
  assert.equal(advanceJourney(JOURNEY_DURATION, 100), JOURNEY_DURATION);
});

test("reviews appear individually before any output is available", () => {
  const first = journeyFrame(18500);
  assert.deepEqual([0, 1, 2].map(i => journeySnapshot(first, i)), [2, 1, 1]);
  const second = journeyFrame(21500);
  assert.deepEqual([0, 1, 2].map(i => journeySnapshot(second, i)), [2, 2, 1]);
  const all = journeyFrame(24500);
  assert.deepEqual([0, 1, 2].map(i => journeySnapshot(all, i)), [2, 2, 2]);
});

test("outputs arrive individually and held conditions never get a fabricated output", () => {
  assert.deepEqual([0, 1, 2].map(i => journeySnapshot(journeyFrame(33100), i)), [3, 3, 2]);
  for (const fixture of Object.values(fixtures)) {
    for (let time = 0; time <= JOURNEY_DURATION; time += 100) {
      const frame = journeyFrame(time);
      for (let i = 0; i < 3; i++) {
        const job = fixture.stages[journeySnapshot(frame, i)].workflows.flatMap(w => w.actions)[i];
        if (["MATERIAL_CHANGE", "INSUFFICIENT_EVIDENCE"].includes(job.gate)) assert.equal(job.execution, null);
        if (job.execution) assert.ok(time >= 30300);
      }
    }
  }
});

test("completion follows the record chapter and stops at a definite end", () => {
  assert.equal(journeyFrame(38000).done, false);
  assert.equal(journeyFrame(44499).done, false);
  assert.equal(journeyFrame(44500).done, true);
  assert.equal(journeyFrame(999999).progress, 1);
  assert.deepEqual([0, 1, 2].map(i => journeySnapshot(journeyFrame(44500), i)), [3, 3, 3]);
});
