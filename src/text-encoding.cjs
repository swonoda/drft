const { isUtf8 } = require("node:buffer");
const iconv = require("iconv-lite");

const UTF8 = "utf8";
const SHIFT_JIS = "shift_jis";

function normalizeEncoding(encoding) {
  return encoding === SHIFT_JIS ? SHIFT_JIS : UTF8;
}

function detectEncoding(buffer) {
  return isUtf8(buffer) ? UTF8 : SHIFT_JIS;
}

function decodeText(buffer) {
  const encoding = detectEncoding(buffer);
  return {
    encoding,
    text: iconv.decode(buffer, encoding),
  };
}

function encodeText(text, encoding) {
  return iconv.encode(text, normalizeEncoding(encoding));
}

module.exports = {
  UTF8,
  SHIFT_JIS,
  normalizeEncoding,
  detectEncoding,
  decodeText,
  encodeText,
};
