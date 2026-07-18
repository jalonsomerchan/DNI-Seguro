import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, parseDateCandidate, parseDniCandidate, parseSupportCandidate, patternMatch } from './ocr-helpers.js';

const word = text => ({ text, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } });

test('normaliza acentos y puntuación del OCR', () => {
  assert.equal(normalizeText('N.º de expedición'), 'N DE EXPEDICION');
});

test('encuentra etiquetas unidas y con confusiones visuales', () => {
  const merged = word('PR1MERAPELLID0');
  assert.deepEqual(patternMatch({ words: [merged] }, ['PRIMER', 'APELLIDO']), [merged]);

  const fecha = word('Fecha'), de = word('de'), nacimiento = word('NACIMIENT0');
  assert.deepEqual(patternMatch({ words: [fecha, de, nacimiento] }, ['FECHA', 'NACIMIENTO']), [fecha, nacimiento]);
});

test('corrige confusiones y valida la letra del DNI', () => {
  assert.deepEqual(parseDniCandidate('I2345678Z'), {
    value: '12345678Z', checksumValid: true, suppliedLetter: 'Z', corrections: 1
  });
  assert.equal(parseDniCandidate('12345678A').value, '12345678Z');
  assert.equal(parseDniCandidate('ABC'), null);
});

test('normaliza números de soporte partidos entre letras y dígitos', () => {
  assert.equal(parseSupportCandidate('ABO12O45G').value, 'ABO120456');
  assert.equal(parseSupportCandidate('APELLIDOS'), null);
});

test('acepta fechas reales y rechaza fechas imposibles', () => {
  assert.equal(parseDateCandidate('29/02/2024').value, '29 02 2024');
  assert.equal(parseDateCandidate('29 O2 2O24').value, '29 02 2024');
  assert.equal(parseDateCandidate('31/02/2024'), null);
});
