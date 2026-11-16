import { describe, expect, it } from 'vitest';
import { activeMentionQuery, insertMention, mentionIdsIn, suggestMembers } from './mentions';

const ada = { id: 'a', name: 'Ada Lovelace' };
const alan = { id: 'b', name: 'Alan Turing' };
const grace = { id: 'c', name: 'Grace Hopper' };

describe('activeMentionQuery', () => {
  it('finds "@..." being typed at the start or after a space', () => {
    expect(activeMentionQuery('@Ad', 3)).toEqual({ start: 0, query: 'Ad' });
    expect(activeMentionQuery('hi @Ada Lo', 10)).toEqual({ start: 3, query: 'Ada Lo' });
    expect(activeMentionQuery('hi @', 4)).toEqual({ start: 3, query: '' });
  });

  it('ignores emails, finished lines and plain text', () => {
    expect(activeMentionQuery('mail ada@example.com', 20)).toBeNull();
    expect(activeMentionQuery('@Ada\nnext', 9)).toBeNull();
    expect(activeMentionQuery('no mention here', 15)).toBeNull();
  });
});

describe('suggestMembers', () => {
  it('matches the start of any word first, then anywhere, and never yourself', () => {
    expect(suggestMembers([ada, alan, grace], 'a', 'b').map((m) => m.id)).toEqual(['a', 'c']);
    expect(suggestMembers([ada, alan, grace], 'tur').map((m) => m.id)).toEqual(['b']);
    expect(suggestMembers([ada, alan, grace], 'opp').map((m) => m.id)).toEqual(['c']);
  });
});

describe('insertMention', () => {
  it('replaces the typed query with the full name and a space', () => {
    expect(insertMention('hi @Ad and', 3, 6, 'Ada Lovelace')).toEqual({ text: 'hi @Ada Lovelace  and', caret: 17 });
  });
});

describe('mentionIdsIn', () => {
  it('keeps only people still mentioned in the text, once each', () => {
    expect(mentionIdsIn('@Ada Lovelace and @Ada Lovelace', [ada, alan, ada])).toEqual(['a']);
  });
});
