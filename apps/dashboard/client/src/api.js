export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || `Request failed: ${response.status}`);
  return payload;
}

export function artifactUrl(artifact) {
  const params = new URLSearchParams({ sourceId: artifact.sourceId || artifact.id, brandId: artifact.brandId });
  return `/api/artifacts/${encodeURIComponent(artifact.artifactId)}/versions/${artifact.version || artifact.artifactVersion}/content?${params}`;
}

export function decideReview(review, decision, reason) {
  return api(`/api/reviews/${review.id}/${decision}`, {
    method: 'POST',
    body: JSON.stringify({ brandId: review.brandId, ...(reason ? { reason } : {}) }),
  });
}
