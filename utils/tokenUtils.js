import crypto from "crypto";

/**
 * Generates a cryptographically secure random invitation token
 * and its corresponding SHA-256 hash.
 *
 * @returns {{ rawToken: string, tokenHash: string }}
 */
export const generateInvitationToken = () => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashInvitationToken(rawToken);
  return { rawToken, tokenHash };
};

/**
 * Computes the SHA-256 hash of a raw token.
 *
 * @param {string} rawToken
 * @returns {string} SHA-256 hash hex string
 */
export const hashInvitationToken = (rawToken) => {
  if (!rawToken || typeof rawToken !== "string") {
    return "";
  }
  return crypto.createHash("sha256").update(rawToken).digest("hex");
};

