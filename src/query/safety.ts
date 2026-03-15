/**
 * SQL safety checker — only allows SELECT statements.
 */

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "REPLACE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "CALL",
  "MERGE",
  "UPSERT",
  "LOAD",
  "COPY",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "SET",
  "VACUUM",
];

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
}

export function checkSqlSafety(sql: string): SafetyCheckResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { safe: false, reason: "Empty SQL statement" };
  }

  // Remove comments
  const cleaned = trimmed
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

  if (!cleaned) {
    return { safe: false, reason: "Empty SQL after removing comments" };
  }

  // Check that it starts with SELECT or WITH (CTE)
  const upperCleaned = cleaned.toUpperCase();
  const firstWord = upperCleaned.split(/\s+/)[0];

  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    return {
      safe: false,
      reason: `Only SELECT statements are allowed. Got: ${firstWord}`,
    };
  }

  // Check for forbidden keywords used as statements (not inside strings)
  // Simple approach: check if any forbidden keyword appears as a standalone word
  // outside of quoted strings
  const withoutStrings = cleaned
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""');

  const upperNoStrings = withoutStrings.toUpperCase();

  for (const keyword of FORBIDDEN_KEYWORDS) {
    // Match keyword as whole word, potentially at start of a sub-statement (after ;)
    const pattern = new RegExp(`(^|;|\\s)${keyword}(\\s|\\(|$)`, "i");
    if (pattern.test(upperNoStrings)) {
      return {
        safe: false,
        reason: `Forbidden keyword detected: ${keyword}`,
      };
    }
  }

  // Check for multiple statements (semicolons followed by non-whitespace)
  const statements = withoutStrings.split(";").filter((s) => s.trim().length > 0);
  if (statements.length > 1) {
    return {
      safe: false,
      reason: "Multiple statements are not allowed",
    };
  }

  return { safe: true };
}
