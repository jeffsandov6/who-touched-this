export interface QueueOrderable {
  priority: number;
  joinedAtMillis: number;
}

export interface QueueSearchable extends QueueOrderable {
  displayName: string;
  githubUsername: string;
  email: string;
  status: string;
}

/** Returns a new array. V1 deliberately ignores the reserved sortOrder field. */
export function sortByEffectiveQueueOrder<T extends QueueOrderable>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (left, right) =>
      right.priority - left.priority || left.joinedAtMillis - right.joinedAtMillis,
  );
}

export function filterQueueEntries<T extends QueueSearchable>(
  entries: readonly T[],
  searchTerm: string,
  status: string | null = null,
): T[] {
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();

  return entries.filter((entry) => {
    const matchesStatus = !status || entry.status === status;
    const matchesSearch =
      !normalizedSearch ||
      entry.displayName.toLocaleLowerCase().includes(normalizedSearch) ||
      entry.githubUsername.toLocaleLowerCase().includes(normalizedSearch) ||
      entry.email.toLocaleLowerCase().includes(normalizedSearch);

    return matchesStatus && matchesSearch;
  });
}
