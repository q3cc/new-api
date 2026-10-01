export function orderGroupNames(
  names: string[],
  configuredOrder: string[] = []
): string[] {
  const available = new Set(names)
  const seen = new Set<string>()
  const ordered: string[] = []

  for (const name of configuredOrder) {
    if (!available.has(name) || seen.has(name)) continue
    ordered.push(name)
    seen.add(name)
  }

  const remaining = names
    .filter((name) => !seen.has(name))
    .sort((left, right) => left.localeCompare(right))
  return [...ordered, ...remaining]
}
