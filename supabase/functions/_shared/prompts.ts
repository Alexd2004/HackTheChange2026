// Every prompt sent to Gemini lives here, so the team can tune wording in one place.

export const extractResumePrompt = (resumeText?: string) => `
You read resumes and list the technical and professional skills they show.
${resumeText ? `Resume:\n"""\n${resumeText}\n"""` : "The resume is the attached PDF."}

For each skill give:
- name: short common name (e.g. "SQL", "React", "Project management").
- level: 0 = mentioned only, 1 = beginner/coursework, 2 = used in a job or real project, 3 = expert/lead.
- evidence: a few words on where it appears (e.g. "2 yrs at internship").

Privacy: never output names, emails, phone numbers, addresses, or links. Only skills.
Return at most 30 skills.`;

export const extractPostingPrompt = (posting: string) => `
You read job postings and list the skills they ask for.
Posting:
"""
${posting}
"""

Return:
- job_title, and company (null if not stated).
- skills: max 12. For each:
  - name: short common name (e.g. "SQL", "REST APIs").
  - need_level: 1 = nice to know, 2 = must use on the job, 3 = must be strong/senior.
  - weight: 1-3, how central it is to the role.
  - required: true if the posting says required/must, false if nice-to-have/asset.
Skip generic traits like "team player" unless the posting stresses them.`;

export const matchSkillsPrompt = (postingSkills: string[], resumeSkills: string[]) => `
Match each job-posting skill to the resume skill with the SAME meaning, or null if none.
Treat synonyms and abbreviations as the same (e.g. "JS" = "JavaScript", "Postgres" = "PostgreSQL" ≈ "SQL").
Do not match merely related skills (e.g. "React" is not "Vue").

Posting skills: ${JSON.stringify(postingSkills)}
Resume skills: ${JSON.stringify(resumeSkills)}

Return one entry per posting skill, using the exact strings given.`;

export const buildMapPrompt = (
  jobTitle: string,
  gaps: { name: string; have: number; need: number }[],
) => `
You design a short learning game for someone applying to be a "${jobTitle}".
Make ONE stage per skill below, in the same order, using the exact skill name in "skill".
${gaps.map((g) => `- ${g.name} (they have level ${g.have}/3, job needs ${g.need}/3)`).join("\n")}

Each stage has exactly 4 levels in this order:
1. normal: the basics
2. normal: the next building block
3. challenge: apply levels 1-2 quickly
4. boss: a realistic on-the-job scenario mixing everything
For every level: a fun short title (max 5 words), a one-sentence objective, and 2-4 concrete concepts
(specific things a quiz can test, e.g. "LEFT JOIN", not "databases").
Stage title: max 4 words, game-like. Summary: one sentence.`;

const typeRules = {
  normal: "5 questions testing the basics of the concepts. Friendly, clear.",
  challenge: "6 harder questions that need applying the concepts, not just recalling them.",
  boss: "8 scenario questions set at a real job. Each one mixes at least two concepts.",
} as const;

export const writeQuestionsPrompt = (p: {
  skill: string;
  type: "normal" | "challenge" | "boss";
  title: string;
  objective: string;
  concepts: string[];
  weakConcepts: string[];
  count: number;
}) => `
Write quiz questions for a learning game.
Skill: ${p.skill}
Level: "${p.title}" (${p.type}). Objective: ${p.objective}
Concepts to test: ${p.concepts.join(", ")}
${p.weakConcepts.length ? `The player got these wrong before, so include some of them: ${p.weakConcepts.join(", ")}` : ""}

Write exactly ${p.count} questions: ${typeRules[p.type]}
Mix about 60% "mcq" and 40% "blank".
- mcq: exactly 4 options, exactly one correct, give its correct_index (0-3), answers = null.
  Vary which position is correct. Wrong options must be plausible but clearly wrong.
- blank: the prompt contains "____" exactly once; answers = 1-4 short accepted variants
  (e.g. ["GET", "get request"]); options = null and correct_index = null.
  The blank must have one short, unambiguous answer (a word or short phrase).
- explanation: 1-2 sentences on why the answer is right.
- concept: which concept from the list it tests.
- difficulty: 1-3.
Questions must be factually correct and answerable without seeing anything else.`;

export const verifyQuestionsPrompt = (
  questions: { idx: number; kind: string; prompt: string; options: string[] | null }[],
) => `
Answer each quiz question yourself. Be careful and accurate.
For "mcq" give mcq_index (0-3) and blank_answer = null.
For "blank" give blank_answer (the word/phrase for ____) and mcq_index = null.

${JSON.stringify(questions, null, 1)}`;
