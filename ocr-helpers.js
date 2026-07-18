const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function normalizeText(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9<]+/g, ' ').trim();
}

export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let previous = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function canonicalLabel(value) {
  return normalizeText(value).replace(/ /g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');
}

export function tokenMatches(value, target) {
  if (value.includes('<')) return false;
  const candidate = canonicalLabel(value), expected = canonicalLabel(target);
  if (!candidate || !expected) return false;
  if (candidate === expected) return true;
  if (candidate.length <= expected.length + 3 && candidate.includes(expected)) return true;
  if (['HIJO', 'HIJA'].includes(expected) && editDistance(candidate, expected) <= 2) return true;
  return expected.length >= 8 ? editDistance(candidate, expected) <= 2 : expected.length >= 5 && editDistance(candidate, expected) <= 1;
}

export function patternMatch(line, pattern) {
  const entries = line.words.flatMap(word => normalizeText(word.text).split(' ').filter(Boolean).map(value => ({ value, word })));
  const tokens = entries.map(entry => entry.value);
  for (let start = 0; start < tokens.length; start++) {
    let cursor = start;
    const matched = [];
    for (const target of pattern) {
      let found = -1;
      for (let i = cursor; i < Math.min(tokens.length, cursor + 3); i++) {
        if (tokenMatches(tokens[i], target)) { found = i; break; }
      }
      if (found < 0) { matched.length = 0; break; }
      matched.push(entries[found].word);
      cursor = found + 1;
    }
    if (matched.length === pattern.length) return [...new Set(matched)];
  }

  // Tesseract a menudo une una etiqueta completa (p. ej. PRIMERAPELLIDO)
  // en una sola palabra. Comparamos también ventanas de texto sin espacios.
  const expected = canonicalLabel(pattern.join(''));
  for (let start = 0; start < entries.length; start++) {
    let compact = '';
    for (let end = start; end < Math.min(entries.length, start + pattern.length + 2); end++) {
      compact += canonicalLabel(entries[end].value);
      if (tokenMatches(compact, expected)) return [...new Set(entries.slice(start, end + 1).map(entry => entry.word))];
      if (compact.length > expected.length + 3) break;
    }
  }
  return null;
}

function numericText(value) {
  return normalizeText(value).replace(/ /g, '').replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/Z/g, '2').replace(/S/g, '5').replace(/G/g, '6').replace(/B/g, '8');
}

export function parseDniCandidate(value) {
  const raw = normalizeText(value).replace(/ /g, '');
  if (!/^[A-Z0-9]{8,9}$/.test(raw)) return null;
  const digitSource = raw.slice(0, 8), digits = numericText(digitSource);
  if (!/^\d{8}$/.test(digits)) return null;
  const expectedLetter = DNI_LETTERS[Number(digits) % 23];
  const suppliedLetter = raw.length === 9 && /^[A-Z]$/.test(raw[8]) ? raw[8] : null;
  const corrections = [...digitSource].filter((character, index) => character !== digits[index]).length;
  return {
    value: digits + expectedLetter,
    checksumValid: suppliedLetter === expectedLetter,
    suppliedLetter,
    corrections
  };
}

function alphaText(value) {
  return value.replace(/0/g, 'O').replace(/1/g, 'I').replace(/2/g, 'Z').replace(/5/g, 'S').replace(/6/g, 'G').replace(/8/g, 'B');
}

export function parseSupportCandidate(value) {
  const raw = normalizeText(value).replace(/ /g, '');
  if (!/^[A-Z0-9]{7,13}$/.test(raw)) return null;
  const candidates = [];
  for (let split = 2; split <= 4; split++) {
    const letters = alphaText(raw.slice(0, split)), digits = numericText(raw.slice(split));
    if (!/^[A-Z]{2,4}$/.test(letters) || !/^\d{5,9}$/.test(digits)) continue;
    const value = letters + digits;
    const corrections = [...raw].filter((character, index) => character !== value[index]).length;
    if (corrections > 2) continue;
    const formatPenalty = Math.abs(split - 3) + Math.abs(digits.length - 6) * .2;
    candidates.push({ value, corrections, score: corrections + formatPenalty });
  }
  return candidates.sort((a, b) => a.score - b.score)[0] || null;
}

export function parseDateCandidate(value) {
  const digits = numericText(value);
  if (!/^\d{8}$/.test(digits)) return null;
  const day = Number(digits.slice(0, 2)), month = Number(digits.slice(2, 4)), year = Number(digits.slice(4));
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2099) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1 || date.getUTCFullYear() !== year) return null;
  return { day, month, year, value: `${String(day).padStart(2, '0')} ${String(month).padStart(2, '0')} ${year}` };
}
