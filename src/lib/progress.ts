// One-shot handoff from the result screen to the map: which level was just passed,
// so the map can run the monkey from it to the next level.
let finished: string | null = null;

export const markLevelFinished = (id: string) => {
  finished = id;
};

export const takeFinishedLevel = () => {
  const id = finished;
  finished = null;
  return id;
};
