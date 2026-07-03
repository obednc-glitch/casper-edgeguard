// sanctionsLocal.js
//
// True on-device sanctions screening: matches a name against a bundled JSON
// snapshot of the OFAC SDN list, with zero network calls. This is what makes
// "offline mode" actually screen something, instead of just queuing a job
// with no compliance data at all - directly the gap flagged in feedback:
// an on-device agent needs something real to refer to even with no internet.
//
// Pure JS, no new dependencies - safe to drop straight into an Expo Go app.
// Mirrors the same matching logic as server/ofacCheck.js so on-device and
// backend results agree when both are available.

// Normalized Levenshtein similarity, 0 (no match) to 1 (exact match).
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  a = (a || '').toLowerCase().trim();
  b = (b || '').toLowerCase().trim();
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/**
 * Screen a name against a bundled snapshot object of shape
 * { fetchedAt: number|null, entities: [{ uid, name, program }] }.
 *
 * @param {string} name
 * @param {object} snapshot
 * @param {number} threshold
 */
function screenNameLocalWithSnapshot(name, snapshot, threshold = 0.82) {
  const entities = (snapshot && snapshot.entities) || [];
  const matches = [];

  for (const e of entities) {
    const sim = similarity(name, e.name);
    if (sim >= threshold) {
      matches.push({ name: e.name, uid: e.uid, program: e.program, similarity: Number(sim.toFixed(3)) });
    }
  }
  matches.sort((a, b) => b.similarity - a.similarity);

  const score = matches.length === 0 ? 100 : Math.max(0, Math.round(40 - matches[0].similarity * 40));
  const ageDays = snapshot && snapshot.fetchedAt ? Math.floor((Date.now() - snapshot.fetchedAt) / 86400000) : null;

  return {
    clear: matches.length === 0,
    score,
    matches: matches.slice(0, 5),
    source: entities.length === 0
      ? 'On-device OFAC snapshot (EMPTY - run `npm run export-snapshot` in edgeguard-server and copy the file in, see README)'
      : 'On-device OFAC SDN snapshot (' + entities.length + ' entries, ' + (ageDays === null ? 'age unknown' : ageDays + ' day(s) old') + ')',
    offline: true,
    screenedAt: new Date().toISOString(),
  };
}

export { screenNameLocalWithSnapshot, similarity };
