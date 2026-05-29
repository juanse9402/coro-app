/**
 * searchWorker.js
 * Offloads the full fuzzy-search pipeline to a background thread
 * so the main UI thread is never blocked, even with 500+ songs.
 */

function getLevenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prevRow = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    const currRow = [j];
    for (let i = 1; i <= a.length; i++) {
      currRow[i] = Math.min(
        currRow[i - 1] + 1,
        prevRow[i] + 1,
        prevRow[i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prevRow = currRow;
  }
  return prevRow[a.length];
}

self.onmessage = function (e) {
  const { songs, query, requestId } = e.data;

  // Empty query → return first 20 sorted by ID
  if (!query || !query.trim()) {
    self.postMessage({ results: songs.slice(0, 20), requestId });
    return;
  }

  const qLower = query.trim().toLowerCase();
  const qNoSpace = qLower.replace(/\s+/g, '');

  const processed = songs.map(song => {
    let score = 0;
    let snippet = null;

    // 1. ID exact / partial match
    if (song.id) {
      const idLower = song.id.toLowerCase();
      if (idLower === qNoSpace) score += 100;
      else if (idLower.includes(qNoSpace)) score += 80;
    }

    // 2. Title substring / fuzzy match
    const titleLower = song.title.toLowerCase();
    if (titleLower.includes(qLower)) {
      score += 50;
    } else {
      const titleWords = titleLower.split(/\s+/);
      const queryWords = qLower.split(/\s+/);
      let titleFuzzyMatch = false;
      queryWords.forEach(qw => {
        if (qw.length > 3) {
          titleWords.forEach(tw => {
            if (
              Math.abs(tw.length - qw.length) <= 2 &&
              getLevenshteinDistance(tw, qw) <= 1
            ) {
              titleFuzzyMatch = true;
            }
          });
        }
      });
      if (titleFuzzyMatch) score += 30;
    }

    // 3. Lyric content match (only if title didn't score high)
    if (score < 50) {
      const cleanContent = song.content
        ? song.content.replace(/\[.*?\]/g, '')
        : '';
      const lines = cleanContent.split('\n').filter(l => l.trim().length > 0);
      let matchedLine = lines.findIndex(l => l.toLowerCase().includes(qLower));

      if (matchedLine === -1 && qLower.length > 3) {
        const queryWords = qLower.split(/\s+/);
        outer: for (let i = 0; i < lines.length; i++) {
          const lineWords = lines[i].toLowerCase().split(/\s+/);
          for (const qw of queryWords) {
            if (qw.length > 3) {
              for (const lw of lineWords) {
                if (
                  Math.abs(lw.length - qw.length) <= 2 &&
                  getLevenshteinDistance(lw, qw) <= 1
                ) {
                  matchedLine = i;
                  break outer;
                }
              }
            }
          }
        }
      }

      if (matchedLine !== -1) {
        score += 10;
        snippet = `"...${lines[matchedLine].trim()}..."`;
      }
    }

    return { ...song, score, snippet };
  });

  const results = processed
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  self.postMessage({ results, requestId });
};
