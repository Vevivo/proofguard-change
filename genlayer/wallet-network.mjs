/** Switch only the chosen provider; rejection must never trigger another request. */
export async function ensureWalletNetwork(provider, chain) {
  const chainId = `0x${chain.id.toString(16)}`;
  if (Number(await provider.request({ method: "eth_chainId" })) !== chain.id) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      if (Number(error?.code) !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: chain.name, rpcUrls: [...chain.rpcUrls.default.http], nativeCurrency: chain.nativeCurrency, ...(chain.blockExplorers?.default?.url ? { blockExplorerUrls: [chain.blockExplorers.default.url] } : {}) }] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    }
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== chain.id) throw new Error("Switch your wallet to GenLayer Studionet before continuing.");
}
