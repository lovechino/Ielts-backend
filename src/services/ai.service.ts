import { Bindings } from '../index';

export class AIService {
  private ai: any;

  constructor(ai: any) {
    this.ai = ai;
  }

  private cleanJsonString(str: string): string {
    let cleaned = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];

      if (char === '"' && !escaped) {
        inString = !inString;
        cleaned += char;
      } else if (char === '\\' && !escaped) {
        escaped = true;
        cleaned += char;
      } else {
        if (char === '\n' || char === '\r' || char === '\t') {
          if (inString) {
            cleaned += "\\n";
          } else {
            cleaned += " ";
          }
        } else {
          cleaned += char;
        }
        escaped = false;
      }
    }

    return cleaned.replace(/,\s*([\]}])/g, '$1');
  }

  /**
   * Sử dụng Llama-3 để bóc tách text thô thành cấu trúc IELTS
   */
  async parseExamContent(rawText: string) {
    const prompt = `
      You are an expert IELTS content creator. Your task is to parse the following raw text from an IELTS exam PDF into a structured JSON format.
      The exam can be either a Reading test or a Writing test.
      
      RAW TEXT:
      ${rawText}

      INSTRUCTIONS:
       1. If it's a READING test:
          - Identify ALL Reading Passages (typically 2-3 passages per test). DO NOT skip any.
          - For EACH passage, extract its title and full content.
          - After each passage, identify its corresponding Question Groups.
          - For each question, extract content, options (if any), and correct answer.
      
      2. If it's a WRITING test (contains WRITING TASK 1/2):
         - Identify each Writing Task.
         - Extract the Task Title (e.g., "Writing Task 1").
         - Extract the Instruction (e.g., "Write about 150 words...").
         - Extract the Topic and any suggestions/requirements.
         - IMPORTANT: Treat each Writing Task as a "passage" with its own title and requirements as the content.

      3. If it's a SPEAKING test:
         - Identify the Speaking Part (Part 1, 2, or 3).
         - Extract the context or main prompt as the "passage" content.
         - Extract the individual speaking questions.
         - NEVER generate options for Speaking questions. Set options to null.

      OUTPUT FORMAT (JSON):
      {
        "type": "READING | WRITING | SPEAKING",
        "sections": [
          {
            "passage": { "title": "...", "content_html": "..." },
            "question_groups": [
              {
                "title": "...",
                "instruction": "...",
                "group_type": "MULTIPLE_CHOICE | TRUE_FALSE_NOT_GIVEN | FILL_BLANK | WRITING_TASK | SPEAKING_PROMPT",
                "questions": [
                  { "content": "...", "options": null, "correct_answer": "..." }
                ]
              }
            ]
          }
        ]
      }

      Only return the JSON object. Do not include any explanation.
    `;

    console.log('AI START: Processing text length:', rawText.length);
    try {
      const response = await this.ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: [
          { role: 'system', content: 'You are a JSON generator. Output ONLY valid JSON. No preamble, no explanation.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4096
      });

      if (!response || !response.response) {
        throw new Error('AI returned an empty response');
      }

      let jsonStr = response.response;
      console.log('AI RESPONSE RECEIVED (First 100 chars):', jsonStr.substring(0, 100));
      
      const startIdx = jsonStr.indexOf('{');
      const endIdx = jsonStr.lastIndexOf('}');
      
      if (startIdx !== -1 && endIdx !== -1) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
      }

      jsonStr = this.cleanJsonString(jsonStr);

      try {
        const parsed = JSON.parse(jsonStr);
        if (!parsed.sections) parsed.sections = [];
        return parsed;
      } catch (e) {
        console.error('JSON PARSE ERROR. Raw string:', jsonStr);
        throw new Error('AI returned invalid JSON structure');
      }
    } catch (err) {
      console.error('CRITICAL AI RUNTIME ERROR:', err);
      throw err;
    }
  }

  /**
   * Chấm điểm bài thi Writing dựa trên tiêu chí IELTS chuyên sâu
   */
  async gradeWriting(taskPrompt: string, studentAnswer: string, persona: string = 'james') {
    let personaInstruction = "You are a Senior IELTS Writing Examiner with 20 years of experience.";
    if (persona === 'sarah') personaInstruction += " Style: Direct, high-energy, and extremely strict.";
    else if (persona === 'dr_chen') personaInstruction += " Style: Intellectual, academic, and focuses heavily on lexical precision.";
    else if (persona === 'emily') personaInstruction += " Style: Professional but provides detailed guidance for improvement.";

    const prompt = `
      ${personaInstruction}
      Your task is to evaluate a candidate's essay based strictly on the official IELTS Writing Band Descriptors.

      TASK PROMPT:
      ${taskPrompt}
      
      CANDIDATE SUBMISSION:
      ${studentAnswer}

      CRITICAL RULES FOR EVALUATION:
      1. Word Count Check: If Task 1 < 150 words or Task 2 < 250 words, apply a strict penalty to the TA/TR score (Max 5.0 for TA/TR).
      2. Task 1 Overview: If it's Task 1 and lacks a clear overview, TA score CANNOT exceed 5.0.
      3. Task 2 Position: If it's Task 2 and lacks a clear position throughout, TR score CANNOT exceed 5.5.
      4. Error-Free Ratio: Calculate (Error-free sentences / Total sentences). If < 60%, GRA score CANNOT exceed 5.5.
      5. Half-band scoring: ALL scores must be multiples of 0.5 (e.g., 6.5, 7.0).

      OUTPUT JSON SCHEMA:
      {
        "word_count": number,
        "overall_score": number,
        "criteria_scores": {
            "task_response": { "band": number, "justification_en": "string" },
            "coherence_cohesion": { "band": number, "justification_en": "string" },
            "lexical_resource": { "band": number, "justification_en": "string" },
            "grammar_accuracy": { "band": number, "justification_en": "string", "error_ratio": number }
        },
        "detailed_errors": [
          { "original": "string", "corrected": "string", "error_type": "string", "explanation_vi": "string" }
        ],
        "user_feedback_vi": {
          "strengths": "string",
          "weaknesses": "string",
          "action_plan": "string"
        },
        "sample_rewrite_segments": [
          { "original_segment": "string", "improved_segment": "string", "reason_vi": "string" }
        ],
        "suggested_version": "string (Band 8.5+ full essay version)"
      }
      Respond ONLY with raw JSON.
    `;

    try {
      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are an Expert IELTS Writing Scorer. Output ONLY valid JSON.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 3072
      });

      let jsonStr = response.response || "";
      const startIdx = jsonStr.indexOf('{');
      const endIdx = jsonStr.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
      }
      let cleaned = this.cleanJsonString(jsonStr);

      const roundToHalf = (num: number) => Math.round(num * 2) / 2;

      try {
        const parsed = JSON.parse(cleaned);
        
        // Map và làm tròn điểm
        const result = {
          overall_score: roundToHalf(parsed.overall_score || 0),
          criteria_scores: {
            task_response: roundToHalf(parsed.criteria_scores?.task_response?.band || 0),
            coherence_cohesion: roundToHalf(parsed.criteria_scores?.coherence_cohesion?.band || 0),
            lexical_resource: roundToHalf(parsed.criteria_scores?.lexical_resource?.band || 0),
            grammar_accuracy: roundToHalf(parsed.criteria_scores?.grammar_accuracy?.band || 0)
          },
          feedback: `${parsed.user_feedback_vi?.weaknesses || ""}. ${parsed.user_feedback_vi?.action_plan || ""}`,
          detailed_errors: parsed.detailed_errors || [],
          sample_rewrite_segments: parsed.sample_rewrite_segments || [],
          suggested_version: parsed.suggested_version || "",
          word_count: parsed.word_count || studentAnswer.trim().split(/\s+/).length
        };
        return result;
      } catch (e) {
        console.error('Writing JSON Parse Error:', e);
        throw e;
      }
    } catch (err) {
      console.error('Writing Scoring Error:', err);
      return { overall_score: 0, feedback: "Hệ thống đang bận, vui lòng thử lại.", criteria_scores: {} };
    }
  }

  /**
   * Sinh giải thích cho câu hỏi
   */
  async generateExplanation(passage: string, question: string, correctAnswer: string) {
    const prompt = `
      Passage: ${passage}
      Question: ${question}
      Correct Answer: ${correctAnswer}
      
      Explain why the answer is correct based on the passage. Keep it concise (2-3 sentences).
    `;

    const response = await this.ai.run('@cf/meta/llama-3-8b-instruct', {
      messages: [{ role: 'user', content: prompt }]
    });

    return response.response;
  }
}
