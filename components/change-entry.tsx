"use client";
import { lazy, Suspense, useSyncExternalStore } from "react";
import { ChangeHome } from "./change-home";
const ChangeNetworkWorkspace = lazy(() => import("./change-network-workspace").then(m => ({ default: m.ChangeNetworkWorkspace })));
const ChangeJourney = lazy(() => import("./change-journey").then(m => ({ default: m.ChangeJourney })));
const LegacyWorkspace = lazy(() => import("./change-workspace").then(m => ({ default: m.ChangeWorkspace })));
const subscribe = (listener: () => void) => { window.addEventListener("popstate", listener); return () => window.removeEventListener("popstate", listener); };
export function ChangeEntry() {
 const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
 const params = new URLSearchParams(search);
 const scenario = params.get("scenario");
 if (params.get("legacy") === "1") return <Suspense fallback={<p>Loading the earlier workspace…</p>}><LegacyWorkspace /></Suspense>;
 if (params.get("mode") === "live" || (params.get("mode") !== "demo" && params.has("contract"))) return <Suspense fallback={<div className="pg-site pg-opening" role="status">Opening your Live workspace…</div>}><ChangeNetworkWorkspace /></Suspense>;
 if (params.get("mode") === "demo") return <Suspense fallback={<div className="pg-site pg-opening" role="status">Preparing your guided journey…</div>}><ChangeJourney initialScenario={scenario === "wording" || scenario === "missing" ? scenario : "material"} /></Suspense>;
 return <ChangeHome />;
}
