// JSON Schemas for every Gemini call (passed as responseJsonSchema) plus matching TS types.
// The AI only fills these shapes; code does the math, grading and unlocking.

const str = { type: "string" };
const int = (min: number, max: number) => ({ type: "integer", minimum: min, maximum: max });

// ---- extractPosting
export interface PostingSkills {
  job_title: string;
  company: string | null;
  skills: { name: string; need_level: number; weight: number; required: boolean }[];
}
export const postingSchema = {
  type: "object",
  properties: {
    job_title: str,
    company: { type: ["string", "null"] },
    skills: {
      type: "array",
      items: {
        type: "object",
        properties: { name: str, need_level: int(1, 3), weight: int(1, 3), required: { type: "boolean" } },
        required: ["name", "need_level", "weight", "required"],
      },
    },
  },
  required: ["job_title", "company", "skills"],
};

// ---- rateResume
// The resume is rated against the numbered list of posting skills. `n` is the 1-based position in that list,
// so a rating can never be lost to a naming mismatch ("PostgreSQL (SQL)" vs "SQL").
export interface ResumeRatings {
  ratings: { n: number; evidence: string; have_level: number }[];
}
export const ratingsSchema = {
  type: "object",
  properties: {
    ratings: {
      type: "array",
      items: {
        type: "object",
        // `evidence` comes before the level so the model cites the resume first, then rates.
        properties: { n: { type: "integer", minimum: 1 }, evidence: str, have_level: int(0, 3) },
        required: ["n", "evidence", "have_level"],
      },
    },
  },
  required: ["ratings"],
};

// ---- buildMap
export interface MapPlan {
  stages: {
    skill: string;
    title: string;
    summary: string;
    levels: { title: string; objective: string; concepts: string[] }[];
  }[];
}
export const mapSchema = {
  type: "object",
  properties: {
    stages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: str,
          title: str,
          summary: str,
          levels: {
            type: "array",
            minItems: 7,
            maxItems: 7,
            items: {
              type: "object",
              properties: {
                title: str,
                objective: str,
                concepts: { type: "array", items: str, minItems: 2, maxItems: 4 },
              },
              required: ["title", "objective", "concepts"],
            },
          },
        },
        required: ["skill", "title", "summary", "levels"],
      },
    },
  },
  required: ["stages"],
};

// ---- pickResources
// Picks are by the result's 1-based number, so the model can't invent a link.
export interface PickedResources {
  picks: { i: number; why: string }[];
}
export const pickSchema = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer", minimum: 1 }, why: str },
        required: ["i", "why"],
      },
    },
  },
  required: ["picks"],
};

// ---- writeQuestions
export interface DraftQuestion {
  kind: "mcq" | "blank";
  prompt: string;
  options: string[] | null;
  correct_index: number | null;
  answers: string[] | null;
  explanation: string;
  concept: string;
  difficulty: number;
}
export interface DraftQuestions {
  questions: DraftQuestion[];
}
export const questionsSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["mcq", "blank"] },
          prompt: str,
          options: { type: ["array", "null"], items: str },
          correct_index: { type: ["integer", "null"] },
          answers: { type: ["array", "null"], items: str },
          explanation: str,
          concept: str,
          difficulty: int(1, 3),
        },
        required: ["kind", "prompt", "options", "correct_index", "answers", "explanation", "concept", "difficulty"],
      },
    },
  },
  required: ["questions"],
};

// ---- verifyQuestions
export interface Verification {
  answers: { idx: number; mcq_index: number | null; blank_answer: string | null }[];
}
export const verifySchema = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idx: { type: "integer" },
          mcq_index: { type: ["integer", "null"] },
          blank_answer: { type: ["string", "null"] },
        },
        required: ["idx", "mcq_index", "blank_answer"],
      },
    },
  },
  required: ["answers"],
};
