import { studionet } from "genlayer-studionet/chains";

type WalletProvider = NonNullable<Window["ethereum"]>;
type MobileClient = Awaited<ReturnType<typeof import("@metamask/connect-evm")["createEVMClient"]>>;
let active: WalletProvider | undefined;
let mobile: MobileClient | undefined;
let initializing: Promise<MobileClient> | undefined;
const subscribers = new Set<() => void>();
const changed = () => { subscribers.forEach(listener => listener()); };

function useProvider(provider: WalletProvider) {
  if (provider === active) return;
  for (const event of ["accountsChanged", "chainChanged", "disconnect"]) active?.removeListener?.(event, changed);
  active = provider;
  for (const event of ["accountsChanged", "chainChanged", "disconnect"]) active.on?.(event, changed);
}
export function currentWallet() { return active; }
export function observeWallet(listener: () => void) {
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
  for (const event of ["accountsChanged", "chainChanged", "disconnect"]) provider?.removeListener?.(event, changed);
  changed();
  // Injected extensions manage their own permissions; do not revoke unrelated access.
  if (mobile) await mobile.disconnect();
}
