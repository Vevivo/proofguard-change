import React from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import "../app/change.css";
import "../app/change-network.css";
import "../app/change-experience.css";
import "../app/reference-fonts.css";
import "../app/change-reference.css";
import "../app/evidence-desk.css";
import { ChangeEntry } from "@/components/change-entry";
import { ApplicationBoundary } from "@/components/application-boundary";
import { PUBLIC_API_ORIGIN } from "@/config/public-site";

window.__PROOFGUARD_API_ORIGIN__ = PUBLIC_API_ORIGIN;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApplicationBoundary><ChangeEntry /></ApplicationBoundary>
  </React.StrictMode>,
);
