// Owner identity (rule A1 of docs/PRODUCT.md): the owner of a commitment is stored as a name, and a
// Telegram user "is the owner" when the name matches their first name, full name or @username,
// ignoring case, accents and surrounding spaces.

export interface ChatUser {
  /** Channel-scoped id, e.g. "tg:123456". */
  id: string;
  /** Telegram first name, or the full display name. */
  name: string;
  /** Telegram @username without the "@", when there is one. */
  username?: string | null;
  isAdmin: boolean;
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/^@/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Two names refer to the same person, ignoring case and accents. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeName(a) === normalizeName(b);
}

/** Rule A1: does this user match the owner name? */
export function ownerMatchesUser(ownerName: string | null | undefined, user: Pick<ChatUser, "name" | "username">): boolean {
  if (!ownerName) return false;
  const owner = normalizeName(ownerName);
  if (owner === "") return false;
  const fullName = normalizeName(user.name);
  const firstToken = fullName.split(" ")[0] ?? "";
  const username = user.username ? normalizeName(user.username) : "";
  return owner === firstToken || owner === fullName || (username !== "" && owner === username);
}
