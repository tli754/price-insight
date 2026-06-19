import { OAuth2Client } from "google-auth-library";

const oauthClient = new OAuth2Client();

/**
 * Verifies a Google-signed OIDC ID token from the Authorization header.
 * Checks signature, audience, and that the token's email claim matches the
 * expected service account — Cloud Run's own IAM gate (run.invoker scoped to
 * one SA) is the primary defense for these private endpoints; this is a
 * second, app-level layer in case ingress/IAM is ever loosened.
 */
export async function verifyOidcToken(
  authorizationHeader: string | undefined,
  expectedServiceAccountEmail: string,
  expectedAudience: string
): Promise<boolean> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }

  const idToken = authorizationHeader.slice("Bearer ".length);

  try {
    const ticket = await oauthClient.verifyIdToken({ idToken, audience: expectedAudience });
    const payload = ticket.getPayload();
    return payload?.email === expectedServiceAccountEmail && payload?.email_verified === true;
  } catch {
    return false;
  }
}
