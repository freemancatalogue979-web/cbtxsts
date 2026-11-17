// Display-only casing. The API and database keep their enum values exactly as
// stored ("JUNGLE", "WIN", "BANNED/RESTRICTED", "OPPONENT FILE"…); the UI must
// never show a shouted word, so every enum passes through `nice()` on its way
// to the screen. Genuine acronyms and abbreviations stay as they are.
const ACRONYMS = new Set([
  "AI", "API", "BO1", "BO3", "BO5", "BO7", "EXP", "KDA", "MLBB", "MPL", "MSC", "MVP",
  "MWI", "PH", "ID", "MY", "KH", "SG", "TBD", "TBC", "VOD", "VODS", "WR", "XP", "UTC",
]);

/** Turn "BANNED/RESTRICTED" into "Banned/restricted", "OPPONENT FILE" into
 *  "Opponent file" and "JUNGLE" into "Jungle". Strings with no all-caps word
 *  (names, already-friendly labels) come back untouched. */
export function nice(value: string | null | undefined): string {
  if (!value) return "";
  let changed = false;
  const out = value.replace(/[A-Za-z][A-Za-z0-9]*/g, (word) => {
    if (word.length < 2 || word !== word.toUpperCase() || !/[A-Z]{2}/.test(word) || ACRONYMS.has(word)) return word;
    changed = true;
    return word.toLowerCase();
  });
  if (!changed) return value;
  return out.replace(/[A-Za-z]/, (c) => c.toUpperCase());
}
