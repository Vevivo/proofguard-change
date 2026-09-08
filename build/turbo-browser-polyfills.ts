import type { Plugin, UserConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Turbo's /web entry still imports Node stream/crypto dependencies. Apply the
// documented polyfills only to the client environment: replacing process or
// streams in the Cloudflare SSR runner breaks its development module loader.
export function turboBrowserPolyfills(): Plugin[] {
  return nodePolyfills({ include: ["crypto", "stream", "buffer", "process"] }).map(plugin => {
    const configure = plugin.config;
    delete plugin.config;
    plugin.applyToEnvironment = environment => environment.name === "client";
    if (configure) {
      const handler = typeof configure === "function" ? configure : configure.handler;
      let aliases: Record<string, string> = {};
      plugin.enforce = "pre";
      plugin.configEnvironment = async function (name, config, env) {
        if (name !== "client") return;
        const configured = await handler.call(this, config as UserConfig, env);
        if (!configured) return;
        // Vite's alias plugin uses root aliases; environment aliases alone are
        // ignored. Resolve them in this client-only hook instead of leaking
        // browser shims into the Worker environments.
        aliases = configured.resolve?.alias as Record<string, string> || {};
        const { resolve: _resolve, ...environmentConfig } = configured;
        return environmentConfig;
      };
      plugin.resolveId = function (id, importer, options) {
        const replacement = aliases[id];
        if (replacement) return this.resolve(replacement, importer, { ...options, skipSelf: true });
      };
    }
    return plugin;
  });
}
