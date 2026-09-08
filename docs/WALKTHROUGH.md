# Walkthrough

## Guided Demo

Open `?mode=demo` and start the walkthrough. It progresses through evidence, registered jobs, a source correction, selective review and outputs. These are deterministic sample fixtures with mocked reviewer responses, clearly separated from Live. No wallet or network transaction is needed.

## Live

1. Open `?mode=live` and connect your test wallet. Use an existing compatible v2 contract or deploy a new one through the setup panel.
2. Open the workspace. For a new source, leave the existing Source ID field empty. Publish a unique source ID, a title and the exact evidence text. Wait for finalized state to load before continuing.
3. Register a workflow with a unique ID, an owner and a registered executor. For each job, define the condition, protected tool, target and exact parameters. A price report is a convenient first test because it produces a small inspectable artifact.
4. Continue to Review & execute and select **Review all dependent jobs**. After finality, inspect each decision and its evidence. Insufficient evidence is a held decision, not a successful authorization.
5. For a supported job, choose **Authorize this job**, wait for confirmation, then choose **Generate output** as the registered executor. Download the resulting artifact.
6. Open **Inspect complete record** to inspect source history, reviews, permits and outputs. Export a readable HTML report or JSON snapshot. Optional **Archive on Arweave** opens the AR.IO/Turbo publication dialog.

## Test the distinguishing behavior

Use your own test source and two jobs with different conditions. Obtain a permit for a job but leave it unconsumed. Publish a source correction that changes one condition while preserving the other. Attempting execution with the old revision must fail. Request a new review and inspect which jobs remain supported. A supported unexecuted job can receive a fresh permit; a held job cannot generate an output.

Do not change source text merely to force a favorable decision. The purpose is to test whether the registered evidence supports each stated condition. A correction to an already completed job does not remove its historical output.

## Read the recorded reference

Open the live workspace with the contract and source in `deployments/studionet.json`, or run `npm run verify:live`. The recorded no-training and zero-retention jobs show why two jobs using one source can have different outcomes. Current state may have advanced since the documented read.
