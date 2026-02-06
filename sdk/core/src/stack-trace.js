const V8_REGEX = /^\s*at (?:(.+?) )?\(?([^()]+?)(?::(\d+))?(?::(\d+))?\)?$/;
const FIREFOX_REGEX = /^(.*?)@([^@]+?)(?::(\d+))?(?::(\d+))?$/;
const SAFARI_NATIVE_REGEX = /^\s*([^@]+?)(?:\[(native code)\])?$/;
const FILE_LINE_REGEX = /^\s*([^\s].*?)(?::(\d+))?(?::(\d+))?$/;

function toInt(value) {
  if (value == null) {
    return null;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function createFrame({ functionName, fileName, lineNumber, columnNumber, raw }) {
  return {
    functionName: functionName || null,
    fileName: fileName || null,
    lineNumber: lineNumber ?? null,
    columnNumber: columnNumber ?? null,
    raw: raw || null
  };
}

function parseV8(line) {
  const match = line.match(V8_REGEX);
  if (!match) {
    return null;
  }

  const [, fnName, location, lineNumber, columnNumber] = match;
  return createFrame({
    functionName: fnName?.trim() || null,
    fileName: location?.trim() || null,
    lineNumber: toInt(lineNumber),
    columnNumber: toInt(columnNumber),
    raw: line
  });
}

function parseFirefox(line) {
  const match = line.match(FIREFOX_REGEX);
  if (!match) {
    return null;
  }

  const [, fnName, location, lineNumber, columnNumber] = match;
  return createFrame({
    functionName: fnName?.trim() || null,
    fileName: location?.trim() || null,
    lineNumber: toInt(lineNumber),
    columnNumber: toInt(columnNumber),
    raw: line
  });
}

function parseSafari(line) {
  if (!line.includes("@") && !line.includes("[native code]")) {
    return null;
  }

  const match = line.match(SAFARI_NATIVE_REGEX);
  if (!match) {
    return null;
  }

  const [, descriptor, nativeTag] = match;
  if (!descriptor) {
    return null;
  }

  return createFrame({
    functionName: descriptor.trim() || null,
    fileName: nativeTag ? "[native code]" : null,
    lineNumber: null,
    columnNumber: null,
    raw: line
  });
}

function parseFileLocation(line) {
  const match = line.match(FILE_LINE_REGEX);
  if (!match) {
    return null;
  }

  const [, location, lineNumber, columnNumber] = match;
  if (!location || location.includes(" ")) {
    return null;
  }

  return createFrame({
    functionName: null,
    fileName: location.trim(),
    lineNumber: toInt(lineNumber),
    columnNumber: toInt(columnNumber),
    raw: line
  });
}

function parseGeneric(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes("@") || trimmed.startsWith("at ") || trimmed.includes(":")) {
    return null;
  }

  return createFrame({
    functionName: trimmed,
    fileName: null,
    lineNumber: null,
    columnNumber: null,
    raw: line
  });
}

export function parseStackTrace(stack) {
  if (typeof stack !== "string" || stack.trim().length === 0) {
    return [];
  }

  const lines = stack.split(/\n+/);
  const frames = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("Error")) {
      continue;
    }

    let frame = parseV8(line);
    if (!frame) {
      frame = parseFirefox(line);
    }
    if (!frame) {
      frame = parseSafari(line);
    }
    if (!frame) {
      frame = parseFileLocation(line);
    }
    if (!frame) {
      frame = parseGeneric(line);
    }
    if (frame) {
      frames.push(frame);
    }
  }

  return frames;
}

export function serializeErrorStack(error) {
  if (!error) {
    return [];
  }
  if (Array.isArray(error.stack)) {
    return error.stack;
  }
  return parseStackTrace(error.stack);
}
