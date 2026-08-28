/**
 * A faithful TypeScript port of ReputationScore.sol.
 *
 * The dashboard uses it for the demo simulation, and to explain a live score
 * component-by-component without a second round trip. Keep it in step with
 * contracts/contracts/ReputationScore.sol.
 */

export const REPUTATION = {
  MAX_SCORE: 1000,
  BASE_SCORE: 500,
  POINTS_PER_CLEAN_ATTESTATION: 5,
  MAX_ATTESTATION_BONUS: 250,
  POINTS_PER_DAY: 2,
  MAX_LONGEVITY_BONUS: 100,
  POINTS_PER_EXCESS_BOND_MULTIPLE: 25,
  MAX_BOND_BONUS: 100,
  POINTS_PER_DEFENDED_DISPUTE: 20,
  MAX_DEFENSE_BONUS: 60,
  PENALTY_PER_SLASH: 150,
  MAX_SEVERITY_PENALTY: 200,
  PENALTY_PER_OPEN_DISPUTE: 40,
} as const;

export interface ReputationInputs {
  active: boolean;
  bond: number;
  minBond: number;
  totalSlashed: number;
  slashCount: number;
  cleanAttestations: number;
  registeredAt: number;
  openDisputes: number;
  defendedDisputes: number;
  now?: number;
}

export interface ReputationBreakdown {
  score: number;
  base: number;
  attestationBonus: number;
  longevityBonus: number;
  bondBonus: number;
  defenseBonus: number;
  slashPenalty: number;
  severityPenalty: number;
  disputePenalty: number;
}

const cap = (value: number, max: number) => (value > max ? max : value);

export function computeReputation(input: ReputationInputs): ReputationBreakdown {
  const empty: ReputationBreakdown = {
    score: 0,
    base: REPUTATION.BASE_SCORE,
    attestationBonus: 0,
    longevityBonus: 0,
    bondBonus: 0,
    defenseBonus: 0,
    slashPenalty: 0,
    severityPenalty: 0,
    disputePenalty: 0,
  };

  // An agent slashed below the minimum bond is out of the system entirely.
  if (!input.active) return empty;

  const now = input.now ?? Date.now();
  const attestationBonus = cap(
    input.cleanAttestations * REPUTATION.POINTS_PER_CLEAN_ATTESTATION,
    REPUTATION.MAX_ATTESTATION_BONUS
  );

  const daysActive = Math.max(0, Math.floor((now / 1000 - input.registeredAt) / 86_400));
  const longevityBonus = cap(daysActive * REPUTATION.POINTS_PER_DAY, REPUTATION.MAX_LONGEVITY_BONUS);

  let bondBonus = 0;
  if (input.minBond > 0 && input.bond > input.minBond) {
    const excessMultiples = Math.floor((input.bond - input.minBond) / input.minBond);
    bondBonus = cap(
      excessMultiples * REPUTATION.POINTS_PER_EXCESS_BOND_MULTIPLE,
      REPUTATION.MAX_BOND_BONUS
    );
  }

  const defenseBonus = cap(
    input.defendedDisputes * REPUTATION.POINTS_PER_DEFENDED_DISPUTE,
    REPUTATION.MAX_DEFENSE_BONUS
  );

  const slashPenalty = input.slashCount * REPUTATION.PENALTY_PER_SLASH;
  const disputePenalty = input.openDisputes * REPUTATION.PENALTY_PER_OPEN_DISPUTE;

  const lifetimeBond = input.bond + input.totalSlashed;
  const severityPenalty =
    lifetimeBond > 0 && input.totalSlashed > 0
      ? Math.floor((input.totalSlashed * REPUTATION.MAX_SEVERITY_PENALTY) / lifetimeBond)
      : 0;

  const positive = REPUTATION.BASE_SCORE + attestationBonus + longevityBonus + bondBonus + defenseBonus;
  const negative = slashPenalty + severityPenalty + disputePenalty;
  const score = positive > negative ? cap(positive - negative, REPUTATION.MAX_SCORE) : 0;

  return {
    score,
    base: REPUTATION.BASE_SCORE,
    attestationBonus,
    longevityBonus,
    bondBonus,
    defenseBonus,
    slashPenalty,
    severityPenalty,
    disputePenalty,
  };
}

export function tierOf(score: number): "TRUSTED" | "RELIABLE" | "NEUTRAL" | "WATCH" | "UNTRUSTED" {
  if (score >= 800) return "TRUSTED";
  if (score >= 600) return "RELIABLE";
  if (score >= 400) return "NEUTRAL";
  if (score >= 200) return "WATCH";
  return "UNTRUSTED";
}
