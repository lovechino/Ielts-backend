import { Bindings } from '../index';

export class AIService {
  private ai: any;

  constructor(ai: any) {
    this.ai = ai;
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
         - Identify the Reading Passage (title and content).
         - Identify Question Groups (e.g., Questions 1-5).
         - For each question, extract content, options (if any), and correct answer.
      
      2. If it's a WRITING test (contains WRITING TASK 1/2):
         - Identify each Writing Task.
         - Extract the Task Title (e.g., "Writing Task 1").
         - Extract the Instruction (e.g., "Write about 150 words...").
         - Extract the Topic and any suggestions/requirements.
         - IMPORTANT: Treat each Writing Task as a "passage" with its own title and requirements as the content.

      OUTPUT FORMAT (JSON):
      {
        "type": "READING | WRITING",
        "sections": [
          {
            "passage": { "title": "...", "content_html": "..." },
            "question_groups": [
              {
                "title": "...",
                "instruction": "...",
                "group_type": "MULTIPLE_CHOICE | TRUE_FALSE_NOT_GIVEN | FILL_BLANK | WRITING_TASK",
                "questions": [
                  { "content": "...", "options": {}, "correct_answer": "..." }
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
      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a JSON generator. Output ONLY valid JSON. No preamble, no explanation.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2048
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
   * Chấm điểm bài thi Writing dựa trên tiêu chí IELTS
   */
  async gradeWriting(taskPrompt: string, studentAnswer: string) {
    const prompt = `
      You are a professional IELTS Examiner. Grade the following student response based on the official IELTS Writing Task criteria.
      
      TASK PROMPT:
      ${taskPrompt}
      
      STUDENT RESPONSE:
      ${studentAnswer}
      
      Please provide the response in STRICT JSON format. Do not include any conversational text or markdown code blocks.
      
      JSON Structure:
      {
        "overall_score": number,
        "criteria_scores": {
            "task_response": number,
            "coherence_cohesion": number,
            "lexical_resource": number,
            "grammar_accuracy": number
        },
        "feedback": "string (detailed paragraph in Vietnamese)",
        "suggested_version": "string (Band 8+ version)"
      }
    `;

    try {
      const response = await this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are an IELTS Writing Scorer. Output ONLY valid JSON.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2048
      });

      let jsonStr = response.response || "";
      
      // 1. Trích xuất khối JSON
      const startIdx = jsonStr.indexOf('{');
      const endIdx = jsonStr.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
      }

      // 2. Vệ sinh JSON cơ bản: Xử lý xuống dòng và các ký tự điều khiển
      let cleaned = "";
      let inString = false;
      let escaped = false;
      
      for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];
        
        if (char === '"' && !escaped) {
          inString = !inString;
          cleaned += char;
        } else if (char === '\\' && !escaped) {
          escaped = true;
          cleaned += char;
        } else {
          if (char === '\n' || char === '\r' || char === '\t') {
            if (inString) {
              cleaned += "\\n"; // Escape newline trong chuỗi
            } else {
              cleaned += " "; // Thay thế bằng space nếu ở ngoài chuỗi
            }
          } else {
            cleaned += char;
          }
          escaped = false;
        }
      }

      // 3. Loại bỏ dấu phẩy thừa (trailing commas)
      cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

      try {
        const parsed = JSON.parse(cleaned);
        // Đảm bảo các trường bắt buộc tồn tại
        return {
          overall_score: parsed.overall_score || 0,
          criteria_scores: parsed.criteria_scores || {},
          feedback: parsed.feedback || "No feedback provided",
          suggested_version: parsed.suggested_version || ""
        };
      } catch (innerErr) {
        console.error('JSON Parse failed after cleaning. Position:', (innerErr as any).message);
        console.log('Malformed JSON snippet:', cleaned.substring(0, 500));
        
        // 4. Fallback: Dùng Regex để cứu vãn dữ liệu nếu JSON hỏng nặng
        const scoreMatch = cleaned.match(/"overall_score":\s*([\d.]+)/);
        const feedbackMatch = cleaned.match(/"feedback":\s*"((?:[^"\\]|\\.)*)"/);
        const suggestedMatch = cleaned.match(/"suggested_version":\s*"((?:[^"\\]|\\.)*)"/);
        
        return {
          overall_score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
          feedback: feedbackMatch ? feedbackMatch[1].replace(/\\n/g, '\n') : "AI trả về định dạng không chuẩn, vui lòng thử lại.",
          criteria_scores: {},
          suggested_version: suggestedMatch ? suggestedMatch[1].replace(/\\n/g, '\n') : ""
        };
      }

    } catch (err) {
      console.error('Writing Scoring Error:', err);
      return {
        overall_score: 0,
        feedback: "Hệ thống đang gặp sự cố khi chấm điểm. Vui lòng thử lại sau.",
        criteria_scores: {}
      };
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
