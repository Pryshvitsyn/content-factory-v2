import React, { useState } from 'react';

export function PilotReview({ review, busy, onDecision, onRestore }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  React.useEffect(() => { setLoaded(false); setFailed(false); }, [review?.contentUrl]);
  if (!review) return null;
  return <section className="panel" aria-label="Saved pilot review">
    <h2 className="panel-title">REVIEW SAVED PILOT</h2>
    <p role="status">{review.state} · {review.quality?.status || review.status}</p>
    {review.contentUrl ? <>
      <video key={review.contentUrl} src={review.contentUrl} controls playsInline preload="metadata"
        aria-label="Saved pilot video" style={{ width: '100%', maxHeight: '65vh', background: '#000' }}
        onLoadedData={() => { setLoaded(true); setFailed(false); }}
        onError={() => { setLoaded(false); setFailed(true); }} />
      <p><a href={review.contentUrl} download="pilot.mp4">Download saved MP4</a> · Playback makes no generation calls.</p>
    </> : <p>No completed pilot file is available yet. Refresh status to check saved progress.</p>}
    {failed ? <p role="alert">Cannot play the saved file. Check storage or download the MP4. Do not generate another pilot to fix playback.</p> : null}
    {review.quality?.checks?.map((check, index) => <p key={index}><strong>{check.status} · {check.code}</strong> — {check.reason}</p>)}
    <p>Review motion, faces, props and the ending against the next shot. A warning needs your decision; it does not trigger a retry.</p>
    <div className="actions">
      {review.canRestoreReview ? <button type="button" disabled={!!busy} onClick={onRestore}>RESTORE SAVED REVIEW · 0 CALLS</button> : null}
      <button type="button" disabled={!!busy || !review.canApprove || !loaded} onClick={() => onDecision('approve')}>APPROVE LOOK & MOTION</button>
      <button type="button" disabled={!!busy || !review.canReject} onClick={() => onDecision('reject')}>REJECT PILOT</button>
    </div>
    {!loaded && review.canApprove && !failed ? <p>Play the saved video before approving it.</p> : null}
    {review.state === 'FIRST_VIDEO_ACCEPTED' ? <p>Pilot approved. Run a fresh final production preflight to continue with the remaining shots.</p> : null}
  </section>;
}
