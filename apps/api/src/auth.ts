import { scrypt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

// Same format the seed script writes: scrypt$<salt>$<hash>
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await derive(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Used when the email doesn't exist, so response time doesn't reveal valid emails
export const DUMMY_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;

export function signToken(userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  if (!payload.sub) throw new Error("no subject");
  return payload.sub;
}
