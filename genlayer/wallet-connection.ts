import { studionet } from "genlayer-studionet/chains";

type WalletProvider = NonNullable<Window["ethereum"]>;
type MobileClient = Awaited<ReturnType<typeof import("@metamask/connect-evm")["createEVMClient"]>>;
let active: WalletProvider | undefined;
let mobile: MobileClient | undefined;
let initializing: Promise<MobileClient> | undefined;
type WalletChange = { event: "accountsChanged" | "chainChanged" | "disconnect"; value?: unknown };
const subscribers = new Set<(change: WalletChange) => void>();
const changed = (change: WalletChange) => { subscribers.forEach(listener => listener(change)); };
const handlers = {
  accountsChanged: (value: unknown) => changed({ event: "accountsChanged", value }),
  chainChanged: (value: unknown) => changed({ event: "chainChanged", value }),
  disconnect: () => changed({ event: "disconnect" }),
};

function useProvider(provider: WalletProvider) {
  if (provider === active) return;
  for (const [event, handler] of Object.entries(handlers)) active?.removeListener?.(event, handler);
  active = provider;
  for (const [event, handler] of Object.entries(handlers)) active.on?.(event, handler);
}
export function currentWallet() { return active; }
export function observeWallet(listener: (change: WalletChange) => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

/** Called only after the user chooses Connect wallet in Live mode. */
export async function requestWallet(): Promise<WalletProvider> {
  if (active) return active;
  if (window.ethereum) { useProvider(window.ethereum); return window.ethereum; }
  initializing ??= import("@metamask/connect-evm").then(({ createEVMClient }) => createEVMClient({
    dapp: { name: "ProofGuard Change", url: window.location.origin, iconUrl: new URL("./favicon.svg", window.location.href).href },
    api: { supportedNetworks: { [`0x${studionet.id.toString(16)}`]: studionet.rpcUrls.default.http[0] } },
    analytics: { enabled: false },
    ui: { preferExtension: true },
  })).catch(error => { initializing = undefined; throw error; });
  mobile = await initializing;
  await mobile.connect({ chainIds: [`0x${studionet.id.toString(16)}`] });
  const provider = mobile.getProvider() as unknown as WalletProvider;
  useProvider(provider);
  return provider;
}

export async function disconnectWallet() {
  const provider = active;
  active = undefined;
  for (const [event, handler] of Object.entries(handlers)) provider?.removeListener?.(event, handler);
  changed({ event: "disconnect" });
  // Injected extensions manage their own permissions; do not revoke unrelated access.
  if (mobile) await mobile.disconnect();
}
