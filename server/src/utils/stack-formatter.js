const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const formatFrameHtml = (frame) => {
  const fn = frame.function || frame.func || '<anonymous>';
  const file = frame.file || frame.filename || 'unknown';
  const line = frame.line ?? frame.lineno ?? '?';
  const column = frame.column ?? frame.colno ?? '?';

  return `<span class="frame-fn">${escapeHtml(fn)}</span> at <span class="frame-file">${escapeHtml(
    file
  )}</span>:<span class="frame-line">${escapeHtml(line)}</span>:<span class="frame-column">${escapeHtml(
    column
  )}</span>`;
};

const formatStackTraceForHighlight = (stackTrace = []) =>
  stackTrace.map((frame) => ({
    ...frame,
    formatted: `${frame.function || frame.func || '<anonymous>'} at ${(frame.file || frame.filename || 'unknown')}:${
      frame.line ?? frame.lineno ?? '?'
    }:${frame.column ?? frame.colno ?? '?'}`,
    highlightHtml: formatFrameHtml(frame),
  }));

module.exports = {
  formatStackTraceForHighlight,
};
