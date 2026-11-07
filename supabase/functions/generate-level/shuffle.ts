// shuffleOptions: randomizes the order of a multiple-choice question's options and moves
// correct_index with the right answer, so the correct answer isn't always in the same spot.

// Options like "All of the above" or "Both A and B" only make sense in their original position.
const POSITION_DEPENDENT = /\b(all|none|both|neither) of (the|these)\b|\b(both|either) [a-d]\b|\b(option|choice|answer) [a-d]\b|\ba and b\b/i;

export function shuffleOptions(
  options: string[],
  correctIndex: number,
  random: () => number = Math.random,
): { options: string[]; correct_index: number } {
  if (options.some((o) => POSITION_DEPENDENT.test(o))) return { options, correct_index: correctIndex };

  // Fisher-Yates over the indexes, so we can tell where the correct answer ended up.
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    options: order.map((i) => options[i]),
    correct_index: order.indexOf(correctIndex),
  };
}
