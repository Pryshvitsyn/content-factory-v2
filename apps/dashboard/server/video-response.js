'use strict';

// Byte ranges allow native video controls to seek without exposing storage paths.
function sendVideo(request, response, { bytes, contentType }) {
  const headers = { 'Content-Type': contentType, 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
  const range = request.headers.range;
  let start = 0; let end = bytes.length - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    } else start = NaN;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${bytes.length}`, 'Content-Length': 0 });
      return response.end();
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${bytes.length}`;
  }
  headers['Content-Length'] = end - start + 1;
  response.writeHead(range ? 206 : 200, headers);
  return response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
}
module.exports = { sendVideo };
