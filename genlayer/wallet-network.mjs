/** A relay timeout is not a confirmed rejection or a confirmed chain failure. */
export function walletErrorMessage(message) {
  if (/Invalid chain ID ["']?0xf22f|Unrecognized chain ID ["']?0xf22f/i.test(message)) {
    return "GenLayer Studionet is missing from this wallet. Open the Connect step and choose Add GenLayer network. Approve the network request in MetaMask before trying the transaction again.";
  }
  if (/RPCErr53|Failed to publish message after all retries|Transport request timed out/.test(message)) {
    return "MetaMask did not answer the request. Open MetaMask on your phone and check pending requests and wallet activity before trying again. ProofGuard has not received a transaction confirmation and will not resend automatically.";
  }
  return message;
}

function walletNetworkConfiguration(chain) {
  return { chainId: `0x${chain.id.toString(16)}`, chainName: chain.name, rpcUrls: [...chain.rpcUrls.default.http], nativeCurrency: chain.nativeCurrency, ...(chain.blockExplorers?.default?.url ? { blockExplorerUrls: [chain.blockExplorers.default.url] } : {}) };
}

/** Explicit recovery for a removed mobile network, even if the SDK caches its ID. */
export async function addWalletNetwork(provider, chain) {
  await provider.request({ method: "wallet_addEthereumChain", params: [walletNetworkConfiguration(chain)] });
  await ensureWalletNetwork(provider, chain);
}

/** Reuse granted accounts; permission requests are only needed when none exist. */
export async function requestWalletAccount(provider) {
  let accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || !accounts.length) accounts = await provider.request({ method: "eth_requestAccounts" });
  const account = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof account !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(account)) throw new Error("No wallet account was selected.");
  return account.toLowerCase();
}

/** Switch only the chosen provider; rejection must never trigger another request. */
export async function ensureWalletNetwork(provider, chain) {
  const chainId = `0x${chain.id.toString(16)}`;
  if (Number(await provider.request({ method: "eth_chainId" })) !== chain.id) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      if (Number(error?.code) !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [walletNetworkConfiguration(chain)] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    }
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== chain.id) throw new Error("Switch your wallet to GenLayer Studionet before continuing.");
}
