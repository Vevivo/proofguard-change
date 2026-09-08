const PROFILE_FIELDS = [
  "leaderTimeunitsAllocation",
  "validatorTimeunitsAllocation",
  "executionBudgetPerRound",
];

function asUnsignedBigInt(value, field) {
  if (
    (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") ||
    !/^\d+$/.test(String(value))
  ) {
    throw new Error(`Fee profile field ${field} must be an unsigned integer.`);
  }
  return BigInt(value);
}

export function validateProfileEntry(entry, label = "entry") {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`Fee profile ${label} is missing.`);
  }
  for (const field of PROFILE_FIELDS) {
    asUnsignedBigInt(entry[field], `${label}.${field}`);
  }
  asUnsignedBigInt(entry.totalMessageFees ?? "0", `${label}.totalMessageFees`);
  asUnsignedBigInt(entry.rotationsPerRound ?? "0", `${label}.rotationsPerRound`);
  return entry;
}

export function validateMeasuredProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error("Fee profile must be a JSON object.");
  }
  if (profile.version !== 1) {
    throw new Error("Fee profile version must be 1.");
  }
  if (typeof profile.network !== "string" || profile.network.length === 0) {
    throw new Error("Fee profile network is missing.");
  }
  if (
    typeof profile.measuredAt !== "string" ||
    profile.measuredAt.length === 0 ||
    Number.isNaN(Date.parse(profile.measuredAt))
  ) {
    throw new Error(
      "Fee profile is unmeasured. Generate config/fee-profile.json with the matching v0.6 gltest release before deployment.",
    );
  }
  validateProfileEntry(profile.deploy, "deploy");
  if (!profile.methods || typeof profile.methods !== "object" || Array.isArray(profile.methods)) {
    throw new Error("Fee profile methods are missing.");
  }
  for (const [methodName, entry] of Object.entries(profile.methods)) {
    validateProfileEntry(entry, `methods.${methodName}`);
  }
  return profile;
}

export function isMeasuredProfile(profile) {
  try {
    validateMeasuredProfile(profile);
    return true;
  } catch {
    return false;
  }
}

export function profileEntry(profile, methodName) {
  validateMeasuredProfile(profile);
  const entry = methodName === "deploy" ? profile.deploy : profile.methods[methodName];
  return validateProfileEntry(entry, methodName === "deploy" ? "deploy" : `methods.${methodName}`);
}

export function appealRoundsFrom(value = "1") {
  const appealRounds = asUnsignedBigInt(value, "appealRounds");
  if (appealRounds > 10n) {
    throw new Error("GENLAYER_APPEAL_ROUNDS must be between 0 and 10.");
  }
  return appealRounds;
}

export function estimateOptions(entry, appealRounds = 1n) {
  validateProfileEntry(entry);
  const rounds = appealRoundsFrom(appealRounds);
  const rotationsPerRound = asUnsignedBigInt(
    entry.rotationsPerRound ?? "0",
    "rotationsPerRound",
  );

  return {
    leaderTimeunitsAllocation: asUnsignedBigInt(
      entry.leaderTimeunitsAllocation,
      "leaderTimeunitsAllocation",
    ),
    validatorTimeunitsAllocation: asUnsignedBigInt(
      entry.validatorTimeunitsAllocation,
      "validatorTimeunitsAllocation",
    ),
    executionBudgetPerRound: asUnsignedBigInt(
      entry.executionBudgetPerRound,
      "executionBudgetPerRound",
    ),
    totalMessageFees: asUnsignedBigInt(entry.totalMessageFees ?? "0", "totalMessageFees"),
    appealRounds: rounds,
    rotations: Array.from(
      { length: Number(rounds) + 1 },
      () => rotationsPerRound,
    ),
  };
}

export async function quoteProfileEntry(client, entry, appealRounds = 1n) {
  return client.estimateTransactionFees(estimateOptions(entry, appealRounds));
}

export function transactionFees(estimate) {
  if (!estimate || typeof estimate !== "object") {
    throw new Error("GenLayer returned an invalid fee estimate.");
  }
  if (!estimate.distribution || typeof estimate.feeValue !== "bigint") {
    throw new Error("GenLayer fee estimate is missing distribution or feeValue.");
  }
  return {
    distribution: estimate.distribution,
    feeValue: estimate.feeValue,
  };
}
