// Book categories, and a best guess at one from Open Library's subject list.
// Shared by the server (to fill in categories) and the app (to suggest them).
//
// Each subject that matches a category's pattern counts one vote; the
// category with the most votes wins, ties going to whichever is listed first.
// Genre categories count double, and genre subjects don't also count as
// plain Fiction, so a mystery novel isn't just "Fiction".

export const CATEGORIES = [
  ['Fiction', /(?<!non-?)fiction|\bnovel|classic literature|^classics$|\bromance\b/],
  ['Poetry', /poetry|\bpoems?\b/, 2],
  ['Mystery & Thriller', /myster|detective|thriller|\bcrime\b|suspense/, 2],
  ['Fantasy & Sci-Fi', /fantasy|science fiction|sci-fi|dystopi/, 2],
  ['Memoir & Biography', /biograf|biograph|memoir/],
  ['Food & Cooking', /\bcook|restaurant|gastronom|\bfood|culinary|\bchefs?\b|cocinero/],
  ['Philosophy', /philosoph|existential|ethics|filosof/],
  ['Essays & Criticism', /criticism|critique|\bessays\b|literaturkritik/],
  ['History', /\bhistory\b|\bhistoria\b/],
  ['Science & Technology', /scien(?!ce fiction)|genetic|heredit|\bgenes?\b|biolog|physics|medic|chemistry|mathemat|engineering|computer|machine learning|software|programming|artificial intelligence/],
  ['Art & Creativity', /\bart\b|\barts\b|artist|creativ|\bmusic|aesthetic|photograph/],
  ['Self-Help', /self-help|self-actualization|self-improvement|personal (growth|development|effectiveness)|habit|motivation|\bsuccess/],
  ['Politics & Society', /politic|sociolog|economic|business|\bsocial (?!life)/],
  ['Travel', /\btravel/],
].map(([name, pattern, weight = 1]) => ({ name, pattern, weight }));

export const CATEGORY_NAMES = CATEGORIES.map(c => c.name);

export function guessCategory(subjects = []) {
  const list = subjects.slice(0, 40).map(s => String(s).toLowerCase());
  let best = null;
  let bestScore = 0;
  const genres = CATEGORIES.filter(c => c.weight > 1);
  for (const { name, pattern, weight } of CATEGORIES) {
    // A "Science fiction" subject is evidence for Sci-Fi, not for plain Fiction.
    const counts = s => pattern.test(s) && !(name === 'Fiction' && genres.some(g => g.pattern.test(s)));
    const score = list.filter(counts).length * weight;
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}
