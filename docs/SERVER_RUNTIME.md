# Private server runtime

The ArNS website is the browser interface. It does not run Node.js processes. The server runtime supplies a supervised report vault and an on-demand stdio MCP connector. The browser still connects directly to GenLayer and uses the owner's wallet for signatures.

The [1 October 2026 deployment record](../deployments/server-runtime-validation-20261001.json) records a real operator-managed server test on Studionet: an existing Copilot report was imported, downloaded with the same digest, and recovered after a container restart. Authentication, held-job rejection and separate filesystem permissions were checked. This is not an independent developer pilot.

## Deployment boundary

The runtime exposes the six default read/request MCP tools plus `proofguard_deliver_report`. It does not enable delegated management or transaction execution and contains no wallet signing key. An agent can prepare a workflow for human approval, inspect its state, obtain an existing output, and ask the vault to store it.

The vault independently verifies finalized chain state for every import and download. Its source and workflow allowlist are operator configuration, not agent input. This is a private installation for a selected workspace, not a public multi-tenant endpoint or an integration that automatically enrolls every website visitor.

| Component | Lifecycle | Access |
| --- | --- | --- |
| ArNS frontend | Static hosting | Browser and wallet |
| Report vault | Docker, restart unless stopped | Container loopback only |
| MCP connector | Starts with each agent session | stdio through an operator-managed connection |
| Report storage | Persistent named volume | Vault UID 10001 only |
| Runtime configuration | Separate named volume | Read-only to vault and connector |

The MCP process runs as UID 10002 and cannot directly read or write the vault's report directory. The application root filesystem is read-only; capabilities are dropped. No host directory, Docker socket or host port is mounted or published. Node dependencies are installed from `package-lock.json` with install scripts disabled.

## Build and initialize

Use a reviewed official Node image digest with Node 22.13 or newer. The image build is independent of the frontend build:

```sh
docker build -f deploy/Dockerfile.runtime \
  --build-arg NODE_BASE=node@sha256:REVIEWED_IMAGE_DIGEST \
  -t proofguard-runtime:VERSION .
docker volume create proofguard-config-v1
docker volume create proofguard-reports-v1
```

Initialize once, substituting the intended contract, source and explicitly permitted workflows:

```sh
docker run --rm --network none --user 0:0 \
  --cap-drop ALL --cap-add CHOWN --security-opt no-new-privileges \
  --mount type=volume,source=proofguard-config-v1,target=/run/proofguard \
  --mount type=volume,source=proofguard-reports-v1,target=/data \
  proofguard-runtime:VERSION node deploy/runtime-init.mjs \
  '{"network":"studionet","contract":"0xYOUR_CONTRACT","sourceId":"YOUR-SOURCE","workflowIds":["YOUR-WORKFLOW"]}'
```

Initialization generates a random service token inside the configuration volume. It refuses existing configuration; it never prints the token. Do not remove the volumes to restart or update the service. A new source or workflow needs explicit operator configuration before it can be delivered to this vault.

```sh
docker run -d --name proofguard-report-vault --restart unless-stopped --init \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 384m --memory-swap 384m --cpus 0.5 --pids-limit 96 \
  --log-opt max-size=5m --log-opt max-file=3 \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  --mount type=volume,source=proofguard-config-v1,target=/run/proofguard,readonly \
  --mount type=volume,source=proofguard-reports-v1,target=/data \
  proofguard-runtime:VERSION
```

Docker must already be enabled at boot. The image health check tests process liveness, not GenLayer consensus or contract state.

## Connect an agent

For an operator-controlled agent on the same server, the stdio command is:

```sh
docker exec -i --user 10002:10003 proofguard-report-vault \
  node deploy/runtime-launch.mjs mcp
```

For a compatible desktop or CLI MCP client, an existing operator SSH connection can carry stdio:

```json
{
  "mcpServers": {
    "proofguard": {
      "command": "ssh",
      "args": ["-T", "YOUR_EXISTING_SSH_ALIAS", "sudo", "-n", "docker", "exec", "-i", "--user", "10002:10003", "proofguard-report-vault", "node", "deploy/runtime-launch.mjs", "mcp"]
    }
  }
}
```

Use an SSH alias whose key and host identity are already verified outside the MCP client. Do not store a password, service token or wallet key in this JSON. This command is for the existing server operator; do not grant other developers administrative SSH or Docker access. A cloud client that requires an HTTPS MCP URL needs a separately authenticated remote transport. This deployment does not provide that URL or automatically register a ChatGPT connector.

Ask the connected agent to call `proofguard_list_workflows` first. `proofguard_prepare_workflow` returns the JSON/link to open on the website. Human registration, review, authorization and execution remain in Live. Once the contract has a current output, `proofguard_get_output` verifies it; `proofguard_deliver_report` submits its identifiers to the private vault.

## Verify and operate

```sh
docker inspect --format '{{.State.Health.Status}}' proofguard-report-vault
docker exec --user 10002:10003 proofguard-report-vault node deploy/runtime-probe.mjs
docker logs --tail 30 proofguard-report-vault
```

The probe requires an existing current output in the first configured workflow. It uses actual MCP and HTTP, verifies report bytes, retries delivery to check deduplication, and checks unauthenticated and held-job rejection. It creates no blockchain transaction. Its first delivery creates one real private report record; subsequent identical deliveries reuse it.

To check persistence, restart only `proofguard-report-vault` and repeat the probe. The delivery ID should match and `alreadyStored` should be true. Back up both named volumes through the operator's private backup process; keep the configuration backup confidential. No off-host backup is provided by this runtime.

Stopping or restarting this container does not require stopping other containers, changing Nginx, or rebuilding the website. See [the report vault specification](REPORT_VAULT.md) for stale-source behavior and the limits of a finalized RPC read.
