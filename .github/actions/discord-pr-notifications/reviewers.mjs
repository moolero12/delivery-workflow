// El verificador y el emisor aplican la misma regla a todos los revisores solicitados.
export function hasDistinctReviewers(reviewers) {
  if (!Array.isArray(reviewers) || reviewers.length < 2) return false;
  const ids = new Set();
  const logins = new Set();
  for (const reviewer of reviewers) {
    if (!reviewer?.login || !Number.isSafeInteger(reviewer.id) || reviewer.id < 1 ||
        ids.has(reviewer.id) || logins.has(reviewer.login)) return false;
    ids.add(reviewer.id);
    logins.add(reviewer.login);
  }
  return true;
}
