function buildRateLimitKey(
  prefix: string,
  policyId: string,
  clientIp: string,
): string {
  return `${prefix}:${policyId}:${clientIp}`;
}

function buildRateLimitOverrideKey(
  prefix: string,
  overrideClientId: string,
): string {
  return `${prefix}:override:${overrideClientId}`;
}

export { buildRateLimitKey, buildRateLimitOverrideKey };