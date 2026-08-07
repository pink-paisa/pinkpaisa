type VoteCounts = {
  id: string;
  yes_count: number;
  no_count: number;
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function withStudyVoteCounts<T extends VoteCounts>(item: T, growthStep = 0): T {
  const hash = stableHash(item.id);
  const baseline = 50 + (hash % 26);
  const total = Math.min(baseline + Math.max(Math.floor(growthStep), 0), 100);
  const yesPercent = 35 + ((hash >>> 8) % 41);
  const yesCount = Math.max(1, Math.min(total - 1, Math.round((total * yesPercent) / 100)));

  return {
    ...item,
    yes_count: yesCount,
    no_count: total - yesCount,
  };
}
