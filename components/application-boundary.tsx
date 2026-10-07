import { Component, type ReactNode } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";

export class ApplicationBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };
  static getDerivedStateFromError(error: unknown) { return { message: error instanceof Error ? error.message : "The application could not finish loading." }; }
  render() {
    if (!this.state.message) return this.props.children;
    return <main className="pg-recovery" role="alert"><div><ShieldCheck size={35} /><h1>Let’s get you back to ProofGuard.</h1><p>This part of the application could not load. Reload to try again. If you had already submitted a transaction, check its existing status before sending another.</p><button className="ed-button ed-dark" onClick={() => window.location.reload()}><RefreshCw size={16} />Reload this page</button><a href="./">Project home</a><details><summary>Technical details</summary><p>{this.state.message}</p></details></div></main>;
  }
}
