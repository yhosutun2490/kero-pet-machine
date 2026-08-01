import { describe, it, expect } from 'vitest';
import {
  parseSettings,
  serializeSettings,
  genderOf,
  DEFAULT_SETTINGS,
} from './settings';

describe('parseSettings', () => {
  it('returns defaults when storage is empty', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults on corrupt JSON', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when a value is not whitelisted', () => {
    expect(parseSettings(JSON.stringify({ model: 'gpt-4o', voice: 'cedar' }))).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(parseSettings(JSON.stringify({ model: 'gpt-realtime', voice: 'nova' }))).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('reads a valid persisted value', () => {
    const stored = { model: 'gpt-realtime-mini', voice: 'marin' } as const;
    expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it('round-trips through serialize (persist then reload)', () => {
    const settings = { model: 'gpt-realtime-mini', voice: 'sage' } as const;
    expect(parseSettings(serializeSettings(settings))).toEqual(settings);
  });
});

describe('genderOf', () => {
  it('classifies male and female voices', () => {
    expect(genderOf('cedar')).toBe('male');
    expect(genderOf('ash')).toBe('male');
    expect(genderOf('marin')).toBe('female');
    expect(genderOf('coral')).toBe('female');
  });
});
