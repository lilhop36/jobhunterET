/**
 * SEC-005 password-hashing policy.
 *
 * The SRS requires bcrypt without naming a cost, so the cost is ours to set against NFR-001's
 * 500 ms request budget. Measured on the live stack with the native binding: cost 12 verifies a
 * login in 0.82-0.90 s, cost 11 in ~0.45 s. 11 stays above the OWASP floor of 10 for bcrypt
 * while bringing the auth endpoint inside the same budget every other endpoint already meets.
 *
 * The cost lives inside each stored hash, so this value governs hashes written from now on;
 * AuthService re-hashes an account whose stored cost differs, on a login that already wrote.
 */
export const PASSWORD_COST = 11;
