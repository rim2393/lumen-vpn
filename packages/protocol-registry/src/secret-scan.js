const FORBIDDEN_INLINE_SECRET_KEYS = new Set([
  "secret",
  "secrets",
  "password",
  "passwd",
  "token",
  "accessToken",
  "access_token",
  "bearerToken",
  "bearer_token",
  "apiKey",
  "api_key",
  "privateKey",
  "private_key",
  "uuid",
  "clientUuid",
  "client_uuid",
  "userUuid",
  "user_uuid",
  "vlessUuid",
  "vless_uuid",
  "subscriptionUrl",
  "subscription_url",
  "generatedConfig",
  "generated_config"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(key) {
  return key.replace(/[-_]/g, "").toLowerCase();
}

export function findForbiddenInlineSecretKeys(value, path = "$", violations = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenInlineSecretKeys(item, `${path}[${index}]`, violations));
    return violations;
  }

  if (!isPlainObject(value)) {
    return violations;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    for (const forbiddenKey of FORBIDDEN_INLINE_SECRET_KEYS) {
      if (normalized === normalizeKey(forbiddenKey)) {
        violations.push(`${path}.${key}`);
      }
    }
    findForbiddenInlineSecretKeys(child, `${path}.${key}`, violations);
  }

  return violations;
}

export function assertNoInlineSecretLikeFields(value, label = "value") {
  const violations = findForbiddenInlineSecretKeys(value);
  if (violations.length > 0) {
    throw new Error(`Inline secret-like fields are not allowed in ${label}: ${violations.join(", ")}`);
  }
}
