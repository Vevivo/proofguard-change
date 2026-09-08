export const JOURNEY_CHAPTERS: { start: number; duration: number; label: string; title: string; description: string }[];
export const JOURNEY_DURATION: number;
export function advanceJourney(elapsed: number, delta: number, visible?: boolean): number;
export function journeyFrame(elapsed: number): { chapter: number; local: number; done: boolean; progress: number; reviewed: number; executed: number };
export function journeySnapshot(frame: ReturnType<typeof journeyFrame>, jobIndex: number): number;
