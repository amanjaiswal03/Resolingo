import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

export function requireUid(request: CallableRequest<unknown>): string {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in is required.");
  return request.auth.uid;
}

export function invalidArgument(message: string): never {
  throw new HttpsError("invalid-argument", message);
}
