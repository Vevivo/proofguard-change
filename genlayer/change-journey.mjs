// Presentation time belongs only to the explicitly labelled local demo.
// Live progress is derived from wallet actions and finalized contract records.
export const JOURNEY_CHAPTERS = [
  { start: 0, duration: 6500, label: "Original evidence", title: "Three jobs. One shared promise.", description: "The supplier promises express delivery on 10 September. Each job has its own condition and permission bound to this original evidence." },
  { start: 6500, duration: 9000, label: "Source correction", title: "The source changes. Permissions pause.", description: "The publisher issues a new revision. Unused permissions from the old revision can no longer create an output, even before review finishes." },
  { start: 15500, duration: 12000, label: "Individual review", title: "Same source. Different decisions.", description: "Each job is checked against its own condition. Follow the reviews one by one to see which dependencies are still supported." },
  { start: 27500, duration: 10500, label: "Protected execution", title: "Permission becomes an output.", description: "Eligible jobs receive a permission for the current revision. Execution checks that revision and the exact intent again before generating an artifact." },
  { start: 38000, duration: 6500, label: "Complete record", title: "The run has a clear ending.", description: "Outputs and held decisions now sit beside their evidence. Inspect the complete record or run a different correction." },
];
export const JOURNEY_DURATION = 44500;
export function advanceJourney(elapsed, delta, visible = true) {
  if (!visible || !Number.isFinite(delta) || delta <= 0) return elapsed;
  // A suspended tab never skips chapters when it returns.
  return Math.min(JOURNEY_DURATION, elapsed + Math.min(delta, 250));
}
export function journeyFrame(elapsed) {
  const time = Math.max(0, Math.min(JOURNEY_DURATION, elapsed));
  let chapter = 0;
  for (let i = 0; i < JOURNEY_CHAPTERS.length; i++) if (time >= JOURNEY_CHAPTERS[i].start) chapter = i;
  const local = time - JOURNEY_CHAPTERS[chapter].start;
  return { chapter, local, done: time >= JOURNEY_DURATION, progress: time / JOURNEY_DURATION,
    reviewed: chapter < 2 ? 0 : chapter > 2 ? 3 : Math.min(3, Math.floor(local / 3000)),
    executed: chapter < 3 ? 0 : chapter > 3 ? 3 : Math.min(3, Math.floor(local / 2800)) };
}
export function journeySnapshot(frame, jobIndex) {
  if (frame.chapter === 0) return 0;
  if (frame.chapter === 1) return 1;
  if (frame.chapter === 2) return jobIndex < frame.reviewed ? 2 : 1;
  return jobIndex < frame.executed ? 3 : 2;
}
