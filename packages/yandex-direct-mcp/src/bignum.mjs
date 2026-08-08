// Yandex Direct object IDs (ads, keywords) commonly exceed 2^53 and lose precision
// through standard JSON.parse/JSON.stringify, which represent all JSON numbers as
// JS doubles. A round-trip through the ordinary JSON codec silently rounds these
// IDs to a nearby-but-wrong value, so any later lookup by that ID fails.
//
// parseJsonPreservingBigInts: like JSON.parse, but any bare integer literal with
// 16+ digits is quoted before parsing, so it survives as an exact string instead
// of a rounded number.
//
// stringifyWithRawIds: like JSON.stringify, but any string value matching the
// same 16+ digit pattern is emitted unquoted (as a raw JSON number literal)
// instead of a JSON string, so a big ID obtained from parseJsonPreservingBigInts
// round-trips back onto the wire exactly as Yandex sent it.

const UNSAFE_INT_DIGITS = 16; // Number.MAX_SAFE_INTEGER (9007199254740991) has 16 digits

export function parseJsonPreservingBigInts(text) {
  let out = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escapeNext) escapeNext = false;
      else if (ch === '\\') escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i;
      let numStr = '';
      if (text[j] === '-') {
        numStr += text[j];
        j++;
      }
      let intDigits = '';
      while (j < text.length && text[j] >= '0' && text[j] <= '9') {
        intDigits += text[j];
        j++;
      }
      numStr += intDigits;

      let isPlainInt = true;
      if (text[j] === '.' || text[j] === 'e' || text[j] === 'E') {
        isPlainInt = false;
        if (text[j] === '.') {
          numStr += text[j];
          j++;
          while (j < text.length && text[j] >= '0' && text[j] <= '9') {
            numStr += text[j];
            j++;
          }
        }
        if (text[j] === 'e' || text[j] === 'E') {
          numStr += text[j];
          j++;
          if (text[j] === '+' || text[j] === '-') {
            numStr += text[j];
            j++;
          }
          while (j < text.length && text[j] >= '0' && text[j] <= '9') {
            numStr += text[j];
            j++;
          }
        }
      }

      out += isPlainInt && intDigits.length >= UNSAFE_INT_DIGITS ? `"${numStr}"` : numStr;
      i = j - 1;
      continue;
    }

    out += ch;
  }

  return JSON.parse(out);
}

const BIG_INT_STRING = new RegExp(`^-?\\d{${UNSAFE_INT_DIGITS},}$`);

export function stringifyWithRawIds(value) {
  if (typeof value === 'string' && BIG_INT_STRING.test(value)) {
    return value;
  }
  if (value === undefined || typeof value === 'function') {
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stringifyWithRawIds(v) ?? 'null').join(',')}]`;
  }
  const entries = Object.entries(value)
    .map(([k, v]) => {
      const encoded = stringifyWithRawIds(v);
      return encoded === undefined ? undefined : `${JSON.stringify(k)}:${encoded}`;
    })
    .filter((e) => e !== undefined);
  return `{${entries.join(',')}}`;
}
