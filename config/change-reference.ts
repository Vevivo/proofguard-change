import { CHANGE_DEFAULT_CONTRACT } from "./change-deployment";
import type { ChangeCase } from "../genlayer/change-client";
export const LIVE_CASE_ID = "PGC-MTRF178C";
export const LIVE_DECISION_TX = "0x18a96a08246268938642bcf8a4379056d56623617562798ab70f40613725dfac";
export function isReferenceCase(address: string, record: ChangeCase | null) {
  return !!record && address.toLowerCase() === CHANGE_DEFAULT_CONTRACT.toLowerCase() && record.id === LIVE_CASE_ID && record.revision === 2
    && record.sources.find(source => source.revision === 1)?.sha256 === "bd27e4b7de1a84797007980e13a55fce06087fe608dda0e550e5336bcfcc38ab"
    && record.sources.find(source => source.revision === 2)?.sha256 === "401d7573103d13be88abb384650b41b6ab96f28da183ca608ac72cdbec26003e"
;
}
