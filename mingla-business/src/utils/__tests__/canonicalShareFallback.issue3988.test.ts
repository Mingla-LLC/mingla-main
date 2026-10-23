import { canonicalShareFallback } from '../canonicalShareFallback';

describe('#3988 canonical share fallback', () => {
  it('keeps the Foodie Fantasy public URL actionable when preview preparation is unavailable', () => {
    expect(canonicalShareFallback({
      title: ' FoodieFantasy By The Sea ',
      url: 'https://host.usemingla.com/e/foodiefantasybythesea/foodiefantasy-by-the-sea',
      description: ' A seaside food event ',
    })).toEqual({
      title: 'FoodieFantasy By The Sea',
      url: 'https://host.usemingla.com/e/foodiefantasybythesea/foodiefantasy-by-the-sea',
      description: 'A seaside food event',
    });
  });

  it.each([
    'http://host.usemingla.com/e/foodie/event',
    'javascript:alert(1)',
    'not a url',
    'https://user:secret@host.usemingla.com/e/foodie/event',
  ])('rejects an unsafe fallback destination: %s', (url) => {
    expect(canonicalShareFallback({ title: 'Foodie', url })).toBeNull();
  });
});
