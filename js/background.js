// Background service worker for YouTube Summarizer - General Edition Chrome Extension
// Implements the PocketFlow design pattern with Map-Reduce approach

class YouTubeSummarizerFlow {
  constructor() {
    this.shared = {};
    this.apiKey = null;
    this.debugMode = false; // Disabled for production
  }

  log(message, data = null) {
    if (this.debugMode) {
      console.log(`[YT-Summarizer-BG] ${message}`, data || "");
    }
  }

  async initialize() {
    // Get API key from storage
    const result = await chrome.storage.sync.get(["geminiApiKey"]);
    this.apiKey = result.geminiApiKey;

    if (!this.apiKey) {
      throw new Error(
        "Gemini API key not configured. Please set it in the extension options.",
      );
    }

    this.log("Initialized with API key");
  }

  // Node 1: Validate URL
  async validateURL(url) {
    this.log("Validating URL:", url);
    const youtubeRegex =
      /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(youtubeRegex);

    if (!match) {
      return {
        isValid: false,
        error:
          "Invalid YouTube URL. Please make sure you're on a YouTube video page.",
      };
    }

    this.shared.videoId = match[3];
    this.shared.youtubeUrl = url;
    this.log("URL validated, videoId:", this.shared.videoId);
    return { isValid: true };
  }

  // Node 2: Get Transcript (using content script extraction)
  async getTranscript() {
    try {
      this.log("Starting transcript extraction...");

      // Extract video info from the page
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab || !tab.url.includes("youtube.com/watch")) {
        throw new Error("Please navigate to a YouTube video page");
      }

      // Get transcript and video info from content script with retry logic
      let result;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          this.log(`Attempt ${retryCount + 1} to get video info...`);
          result = await chrome.tabs.sendMessage(tab.id, {
            action: "getVideoInfo",
            videoId: this.shared.videoId,
          });

          if (result && !result.error) {
            this.log("Successfully got video info");
            break;
          }

          if (result && result.error) {
            throw new Error(result.error);
          }
        } catch (error) {
          retryCount++;
          this.log(`Attempt ${retryCount} failed:`, error.message);
          if (retryCount >= maxRetries) {
            throw error;
          }
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      if (!result) {
        throw new Error(
          "Failed to get response from content script after multiple attempts. Please refresh the page and try again.",
        );
      }

      if (result.error) {
        throw new Error(result.error);
      }

      // More flexible content validation
      if (!result.transcript || result.transcript.length < 30) {
        throw new Error(
          "Insufficient video content for summarization. This video may not have captions, description, or other extractable content. Please try a different video with more available content.",
        );
      }

      this.shared.transcript = result.transcript;
      this.shared.videoInfo = {
        title: result.title || "YouTube Video",
        duration: result.duration || 0,
        url: `https://www.youtube.com/watch?v=${this.shared.videoId}`,
        thumbnailUrl:
          result.thumbnailUrl ||
          `https://img.youtube.com/vi/${this.shared.videoId}/maxresdefault.jpg`,
      };

      this.log("Transcript extracted successfully:", {
        title: this.shared.videoInfo.title,
        transcriptLength: this.shared.transcript.length,
      });

      return { success: true };
    } catch (error) {
      this.log("Failed to get transcript:", error.message);
      throw new Error(`Failed to get transcript: ${error.message}`);
    }
  }

  // Node 3: Generate Topics using Gemini API
  async generateTopics() {
    this.log("Generating topics and initial summary...");

    // Get user preferences for topic generation
    const settings = await chrome.storage.sync.get(["maxTopics"]);
    const maxTopics = settings.maxTopics || 5;

    // Truncate transcript if too long to avoid API limits
    const maxLength = 800000;
    const transcript =
      this.shared.transcript.length > maxLength
        ? this.shared.transcript.substring(0, maxLength) + "..."
        : this.shared.transcript;

    const prompt = `You are analyzing a YouTube video to identify the main topics discussed and creating an initial summary.

VIDEO TITLE: ${this.shared.videoInfo.title}

CONTENT:
${transcript}

TASK:
1. Identify ${maxTopics} main topics or themes from this video content (or fewer if the content doesn't support that many).
2. For each topic, create a brief description.
3. Create a professional yet engaging initial summary of the overall video (150-200 words).
4. Format your response as JSON following this structure:

{
  "topics": [
    {
      "id": 1,
      "name": "First Topic Name",
      "content": "Brief description of what this topic covers"
    },
    // more topics...
  ],
  "initialSummary": "A clear, informative summary that captures the video's key insights and value."
}

Only include valid JSON in your response.`;

    try {
      const response = await this.callGemini(prompt);
      let topics;

      try {
        // Try to parse JSON directly
        topics = JSON.parse(response);
      } catch {
        // If that fails, try to extract JSON from the response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          topics = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Invalid JSON response from AI");
        }
      }

      // Ensure topics is valid
      if (
        !topics.topics ||
        !Array.isArray(topics.topics) ||
        topics.topics.length === 0
      ) {
        throw new Error("No valid topics found");
      }

      this.shared.topics = topics.topics;
      this.shared.initialSummary = topics.initialSummary || "";
      this.log(
        "Topics and initial summary generated:",
        this.shared.topics.length,
      );
      return { success: true, count: this.shared.topics.length };
    } catch (error) {
      this.log("Topic generation failed:", error.message);
      // Re-throw the error instead of using fallback to ensure API key validation
      throw error;
    }
  }

  // Node 4: Topic Processor (Map phase - BatchNode equivalent)
  async processTopics() {
    this.log("Processing topics...");
    const processedTopics = [];

    // Get user's complexity preference from settings
    const settings = await chrome.storage.sync.get(["complexityLevel"]);
    const complexityLevel = settings.complexityLevel || "standard";
    this.log("Complexity level:", complexityLevel);

    // Process each topic independently (Map phase)
    for (const topic of this.shared.topics) {
      try {
        const processed = await this.processSingleTopic(topic, complexityLevel);
        processedTopics.push(processed);
      } catch (error) {
        this.log("Failed to process topic:", topic.name, error.message);
        // Fallback for failed topic processing
        processedTopics.push({
          id: topic.id,
          name: topic.name,
          content: topic.content,
          summary: `This part talks about ${topic.name}`,
          explanation: `This section discusses ${topic.name} in the video.`,
          qaPairs: [
            {
              question: `What is ${topic.name}?`,
              answer: "It's something interesting discussed in the video!",
            },
          ],
        });
      }
    }

    this.shared.processedTopics = processedTopics;
    this.log("Topics processed:", processedTopics.length);
    return { success: true, processedCount: processedTopics.length };
  }

  async processSingleTopic(topic, complexityLevel = "standard") {
    const complexityPrompts = {
      "basic":
        "Use clear, accessible language suitable for general audiences. Focus on core concepts with practical examples.",
      "standard":
        "Use professional language with detailed explanations. Include context and relevant background information.",
      "advanced":
        "Use sophisticated language with comprehensive analysis. Include technical details and industry insights.",
    };

    const complexityInstruction = complexityPrompts[complexityLevel] || complexityPrompts["standard"];

    const prompt = `You are creating a comprehensive explanation for a YouTube video topic for a general professional audience.

COMPLEXITY LEVEL: ${complexityLevel}
STYLE INSTRUCTION: ${complexityInstruction}

TOPIC: ${topic.name}
CONTENT: ${topic.content}

TASK:
1. Create a concise but informative summary of this topic.
2. Create a detailed explanation that provides valuable insights.
3. Create 2-3 question and answer pairs that address common interests or concerns about this topic.

Format your response as JSON:

{
"summary": "Your informative summary here",
"explanation": "Your detailed professional explanation here",
"qaPairs": [
  {
    "question": "First relevant question?",
    "answer": "Comprehensive answer to the first question"
  },
  {
    "question": "Second relevant question?",
    "answer": "Comprehensive answer to the second question"
  }
]
}

Only include valid JSON in your response.`;

    const response = await this.callGemini(prompt);

    try {
      let qaData;
      try {
        qaData = JSON.parse(response);
      } catch {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          qaData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Invalid JSON response");
        }
      }

      return {
        id: topic.id,
        name: topic.name,
        content: topic.content,
        summary: qaData.summary || `This topic is about ${topic.name}`,
        explanation:
          qaData.explanation ||
          `${topic.name} is an interesting subject from the video.`,
        qaPairs: qaData.qaPairs || [
          {
            question: `What is ${topic.name}?`,
            answer: "It's something interesting discussed in the video!",
          },
        ],
      };
    } catch (error) {
      this.log("Failed to parse topic processing response:", error.message);
      throw error;
    }
  }

  // Node 5: Combine Topics (Reduce phase)
  async combineTopics() {
    this.log("Combining topics...");

    if (
      !this.shared.processedTopics ||
      this.shared.processedTopics.length === 0
    ) {
      this.shared.topicConnections = [];
      this.shared.topicRanking = [];
      return { success: true, fallback: true };
    }

    const topicInfo = this.shared.processedTopics
      .map(
        (topic) =>
          `TOPIC ${topic.id}: ${topic.name}\nSUMMARY: ${topic.summary}`,
      )
      .join("\n\n");

    const prompt = `You are reviewing professional explanations of topics from a YouTube video.

VIDEO TITLE: ${this.shared.videoInfo.title}

TOPICS OVERVIEW:
${topicInfo}

TASK:
1. Create 1-2 meaningful connections between topics to form a cohesive narrative.
2. Rank the topics by importance and relevance for the audience.

Format your response as JSON:

{
  "connections": [
    "Brief connection between topics 1 and 2",
    "Another connection between topics"
  ],
  "ranking": [
    {
      "topicId": 1,
      "importance": "high",
      "reason": "Why this topic is important for the audience"
    }
  ]
}

Only include valid JSON in your response.`;

    try {
      const response = await this.callGemini(prompt);
      let combinedData;

      try {
        combinedData = JSON.parse(response);
      } catch {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          combinedData = JSON.parse(jsonMatch[0]);
        } else {
          combinedData = { connections: [], ranking: [] };
        }
      }

      this.shared.topicConnections = combinedData.connections || [];
      this.shared.topicRanking = combinedData.ranking || [];

      return { success: true };
    } catch (error) {
      this.log("Topic combination failed:", error.message);
      // Fallback
      this.shared.topicConnections = [];
      this.shared.topicRanking = [];
      return { success: true, fallback: true };
    }
  }

  // Node 6: Create Summary
  async createSummary() {
    this.log("Creating summary...");

    if (
      !this.shared.processedTopics ||
      this.shared.processedTopics.length === 0
    ) {
      this.shared.summary = `This video "${this.shared.videoInfo.title}" contains valuable insights worth exploring!`;
      return { success: true, fallback: true };
    }

    const topicSummaries = this.shared.processedTopics
      .map((topic) => `- ${topic.name}: ${topic.summary}`)
      .join("\n");

    const connections =
      this.shared.topicConnections?.length > 0
        ? this.shared.topicConnections.map((conn) => `- ${conn}`).join("\n")
        : "";

    const prompt = `You are creating a comprehensive overall summary of a YouTube video for a general professional audience.
The summary should be informative and engaging.

VIDEO TITLE: ${this.shared.videoInfo.title}

TOPIC SUMMARIES:
${topicSummaries}

CONNECTIONS BETWEEN TOPICS:
${connections || "No specific connections identified."}

TASK:
Create a professional, engaging overall summary of this video that captures its key value.
Use clear, accessible language that provides actionable insights.
Keep it to 3-4 sentences that highlight the main takeaways.

Your summary:`;

    try {
      const summary = await this.callGemini(prompt);
      this.shared.summary = summary.trim();
      return { success: true };
    } catch (error) {
      this.log("Summary creation failed:", error.message);
      // Fallback summary
      this.shared.summary = `This video "${this.shared.videoInfo.title}" covers ${this.shared.processedTopics.length} main topics with valuable insights!`;
      return { success: true, fallback: true };
    }
  }

  // Node 6.1: Create Initial Summary (new step for two-phase approach)
  async createInitialSummary() {
    this.log("Creating initial summary...");

    if (!this.shared.topics || this.shared.topics.length === 0) {
      this.shared.initialSummary = `This video "${this.shared.videoInfo.title}" contains valuable insights worth exploring!`;
      return { success: true, fallback: true };
    }

    const topicHighlights = this.shared.topics
      .map((topic) => `- ${topic.name}`)
      .join("\n");

    const prompt = `You are creating an initial summary of a YouTube video for a general professional audience.
This summary should highlight the main topics without going into detail.

VIDEO TITLE: ${this.shared.videoInfo.title}

MAIN TOPICS:
${topicHighlights}

TASK:
Create a concise, engaging initial summary of this video that captures its key value.
Use professional yet accessible language.
Keep it to 2-3 sentences that convey the main insights.

Your summary:`;

    try {
      const summary = await this.callGemini(prompt);
      this.shared.initialSummary = summary.trim();
      return { success: true };
    } catch (error) {
      this.log("Initial summary creation failed:", error.message);
      // Fallback initial summary
      this.shared.initialSummary = `This video "${this.shared.videoInfo.title}" covers various interesting topics!`;
      return { success: true, fallback: true };
    }
  }

  // Node 7: Create Detailed Summary
  async createDetailedSummary() {
    this.log("Creating detailed summary...");

    // Get settings for complexity level and summary preferences
    const settings = await chrome.storage.sync.get([
      "complexityLevel",
      "summaryLength", 
      "summaryFormat",
      "detailLevel",
      "includeTimestamps",
    ]);
    const complexityLevel = settings.complexityLevel || "standard";
    const summaryLength = settings.summaryLength || "standard";
    const summaryFormat = settings.summaryFormat || "bullets";
    const detailLevel = settings.detailLevel || "balanced";
    const includeTimestamps = settings.includeTimestamps || false;

    // Adjust word count based on length preference
    const lengthMap = {
      "brief": "100-150 words",
      "standard": "200-300 words",
      "comprehensive": "350-450 words",
      "executive": "500-600 words",
    };
    const targetLength = lengthMap[summaryLength] || lengthMap["standard"];

    // Format instructions
    const formatMap = {
      "bullets": "Format as clear bullet points with main ideas", 
      "paragraphs": "Format as flowing paragraphs with smooth transitions",
      "outline": "Format as a structured outline with headers and sub-points",
      "qa": "Format as a series of questions and answers covering key topics",
    };
    const formatInstruction = formatMap[summaryFormat] || formatMap["bullets"];

    // Detail level instructions
    const detailMap = {
      "overview": "Provide high-level overview with key takeaways",
      "balanced": "Balance overview with supporting details and examples", 
      "detailed": "Include comprehensive details, examples, and context",
      "comprehensive": "Provide exhaustive coverage with analysis and implications",
    };
    const detailInstruction = detailMap[detailLevel] || detailMap["balanced"];

    // Timestamp instruction
    const timestampInstruction = includeTimestamps 
      ? "Include relevant timestamp references where applicable (e.g., [2:15] for key points)."
      : "Do not include timestamp references.";

    const prompt = `You are creating a detailed summary of a YouTube video for a general professional audience (complexity level: ${complexityLevel}).

VIDEO TITLE: ${this.shared.videoInfo.title}

PROCESSED TOPICS:
${JSON.stringify(this.shared.processedTopics, null, 2)}

TOPIC CONNECTIONS:
${JSON.stringify(this.shared.topicConnections, null, 2)}

TASK:
Create a thorough and informative detailed summary that:
1. Uses professional language appropriate for ${complexityLevel} complexity level
2. Captures the main points and how they connect
3. Is approximately ${targetLength}
4. ${detailInstruction}
5. ${formatInstruction}
6. ${timestampInstruction}
7. Uses an engaging yet professional tone

SUMMARY:`;

    try {
      const response = await this.callGemini(prompt);
      this.shared.detailedSummary = response.trim();
      this.log(
        "Detailed summary created, length:",
        this.shared.detailedSummary.length,
      );
      return { success: true };
    } catch (error) {
      this.log(
        "Failed to create detailed summary, using fallback:",
        error.message,
      );
      // Create a fallback summary
      this.shared.detailedSummary = `This video called "${this.shared.videoInfo.title}" has some interesting information about ${this.shared.processedTopics.map((t) => t.name).join(", ")}. Each topic is explained in a way that's easy to understand. You can explore each topic section to learn more!`;
      return { success: true, fallback: true };
    }
  }

  // Utility function to call Gemini API
  async callGemini(prompt) {
    this.log("Calling Gemini API...");

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();

    if (
      !data.candidates ||
      !data.candidates[0] ||
      !data.candidates[0].content
    ) {
      throw new Error("No content generated by Gemini API");
    }

    const result = data.candidates[0].content.parts[0].text;
    this.log("Gemini API response received");
    return result;
  }

  // Main flow execution
  async run(url, phase = "initial") {
    try {
      this.log(
        `Starting YouTube summarizer flow for: ${url} (Phase: ${phase})`,
      );

      await this.initialize();

      // Step 1: Validate URL
      const validation = await this.validateURL(url);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      // Step 2: Get transcript
      await this.getTranscript();

      // Step 3: Generate topics and initial summary
      await this.generateTopics();

      if (phase === "initial") {
        // Initial phase: Just return topics and initial summary
        this.log("Initial phase completed successfully");
        return {
          success: true,
          phase: "initial",
          data: {
            videoInfo: this.shared.videoInfo,
            summary: this.shared.initialSummary,
            topics: this.shared.topics,
            processingState: "initial",
          },
        };
      } else if (phase === "detailed") {
        // Detailed phase: Process topics in depth

        // Step 4: Process topics (Map phase)
        await this.processTopics();

        // Step 5: Combine topics (Reduce phase)
        await this.combineTopics();

        // Step 6: Create detailed summary
        await this.createDetailedSummary();

        this.log("Detailed phase completed successfully");
        return {
          success: true,
          phase: "detailed",
          data: {
            videoInfo: this.shared.videoInfo,
            summary: this.shared.detailedSummary,
            topics: this.shared.topics, // Include original topics for download
            processedTopics: this.shared.processedTopics,
            topicConnections: this.shared.topicConnections,
            topicRanking: this.shared.topicRanking,
            processingState: "completed",
          },
        };
      }
    } catch (error) {
      this.log("Flow execution failed:", error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// Message handler for popup and content script communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarizeVideo") {
    const flow = new YouTubeSummarizerFlow();
    const phase = request.phase || "initial";

    flow
      .run(request.url, phase)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          success: false,
          error: error.message,
        }),
      );

    return true; // Keep message channel open for async response
  }

  if (request.action === "downloadSummary") {
    try {
      const downloadManager = new SummaryDownloadManager();
      const format = request.format || 'html';
      const result = downloadManager.exportSummary(request.data, format);

      sendResponse({
        success: true,
        content: result.content || result.html, // Support legacy html property
        html: result.html, // Keep for backward compatibility
        filename: result.filename,
        mimeType: result.mimeType || 'text/html',
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message,
      });
    }

    return true;
  }

  if (request.action === "checkApiKey") {
    chrome.storage.sync.get(["geminiApiKey"], (result) => {
      sendResponse({ hasApiKey: !!result.geminiApiKey });
    });

    return true;
  }

  if (request.action === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }
});

// Install/startup handler
chrome.runtime.onInstalled.addListener(() => {
  console.log("YouTube Summarizer - General Edition extension installed");
});

class SummaryDownloadManager {
  constructor() {
    this.debugMode = false; // Disabled for production
  }

  log(message, data = null) {
    if (this.debugMode) {
      console.log(`[YT-Summarizer-Download] ${message}`, data || "");
    }
  }

  formatTextForHTML(text) {
    if (!text || typeof text !== "string") return text;

    // Handle code blocks first (before line break processing)
    text = text.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert line breaks to <br> tags
    const formattedText = text.replace(/\n/g, "<br>");

    // Check for any lists (bullets or numbered)
    const hasBullets = /^[*-] /gm.test(text);
    const hasNumbers = /^\d+\. /gm.test(text);
    
    if (hasBullets || hasNumbers) {
      // Split by line breaks and process lists
      const lines = text.split("\n");
      let inList = false;
      let listType = null; // 'ul' or 'ol'
      let result = "";
      let lastWasList = false;

      for (let line of lines) {
        line = line.trim();
        
        // Check for bullet points (* or -)
        if (line.match(/^[*-] (.+)/)) {
          const content = line.replace(/^[*-] /, "").trim();
          if (!inList || listType !== 'ul') {
            if (inList) result += `</${listType}>`; // Close previous list
            result += "<ul>";
            inList = true;
            listType = 'ul';
          }
          result += `<li>${this.formatInlineText(content)}</li>`;
          lastWasList = true;
        }
        // Check for numbered lists (any number followed by period)
        else if (line.match(/^\d+\. (.+)/)) {
          const content = line.replace(/^\d+\. /, "").trim();
          // Continue existing ordered list or start new one
          if (!inList || listType !== 'ol') {
            if (inList) result += `</${listType}>`; // Close previous list
            result += "<ol>";
            inList = true;
            listType = 'ol';
          }
          result += `<li>${this.formatInlineText(content)}</li>`;
          lastWasList = true;
        }
        // Regular content
        else if (line) {
          // If we just finished a list and this is regular content, close the list
          if (inList) {
            result += `</${listType}>`;
            inList = false;
            listType = null;
          }
          result += `<p>${this.formatInlineText(line)}</p>`;
          lastWasList = false;
        }
        // Empty line - if we're in a list and previous line was also a list item,
        // treat this as spacing within the list, otherwise close the list
        else if (!line) {
          if (inList && !lastWasList) {
            result += `</${listType}>`;
            inList = false;
            listType = null;
          }
          lastWasList = false;
        }
      }

      if (inList) {
        result += `</${listType}>`;
      }

      return result;
    }

    // If no lists, just format inline text and preserve line breaks
    return formattedText
      .split("<br>")
      .map((line) => {
        line = line.trim();
        return line ? `<p>${this.formatInlineText(line)}</p>` : "";
      })
      .filter((line) => line)
      .join("");
  }

  formatInlineText(text) {
    if (!text) return text;

    // Handle code first to avoid conflicts
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Convert ALL CAPS words to bold (common pattern in the text)
    text = text.replace(/\b[A-Z]{2,}\b/g, "<strong>$&</strong>");

    // Convert **bold** text (double asterisks) first
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    
    // Convert remaining single *italic* text (avoiding already processed bold)
    text = text.replace(/\b\*([^*\s][^*]*?)\*\b/g, "<em>$1</em>");
    
    // Convert _italic_ text (underscores)
    text = text.replace(/_([^_\s][^_]*[^_\s]|[^_\s])_/g, "<em>$1</em>");

    // Convert text in quotes to emphasis
    text = text.replace(/"([^"]+)"/g, '<em>"$1"</em>');

    return text;
  }

  generateDownloadableHTML(data) {
    this.log("Generating downloadable HTML for summary");

    const {
      videoInfo,
      summary,
      topics,
      processedTopics,
      topicConnections,
      processingState,
    } = data;
    const generationDate = new Date().toLocaleDateString();
    const generationTime = new Date().toLocaleTimeString();

    // Create safe filename from video title
    const safeTitle = this.createSafeFileName(videoInfo.title);

    // Determine if this is initial or detailed summary
    const isDetailed =
      processingState === "completed" &&
      processedTopics &&
      processedTopics.length > 0;

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YouTube Summary: ${videoInfo.title}</title>
    <style>
        ${this.getDownloadableCSS()}
    </style>
</head>
<body>
    <div class="summary-container">
        <header class="summary-header">
            <div class="video-info">
                <img src="${videoInfo.thumbnailUrl}" alt="Video thumbnail" class="video-thumbnail" onerror="this.style.display='none'">
                <div class="video-details">
                    <h1 class="video-title">${videoInfo.title}</h1>
                    <div class="video-meta">
                        <span class="duration">Duration: ${this.formatDuration(videoInfo.duration)}</span>
                        <span class="generation-info">Generated on ${generationDate} at ${generationTime}</span>
                    </div>
                </div>
            </div>
            <div class="summary-type">
                <span class="type-badge ${isDetailed ? "detailed" : "initial"}">${isDetailed ? "Detailed" : "Quick"} Summary</span>
            </div>
        </header>

        <main class="summary-content">
            <section class="overview-section">
                <h2>📝 Video Summary</h2>
                <div class="summary-text">${this.formatTextForHTML(summary)}</div>
            </section>

            ${this.generateTopicsHTML(topics, processedTopics, isDetailed)}
            
            ${this.generateConnectionsHTML(topicConnections)}
        </main>

        <footer class="summary-footer">
            <div class="footer-content">
                <p>Generated by <strong>YouTube Summarizer - General Edition</strong> Chrome Extension</p>
                <p class="original-url">Original video: <a href="${data.videoInfo.url || "#"}" target="_blank">${data.videoInfo.title || "YouTube Video"}</a></p>
                <p class="disclaimer">This summary was created using AI and is intended for educational purposes.</p>
            </div>
        </footer>
    </div>

    <script>
        // Add print functionality
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                window.print();
            }
        });
        
        // Collapsible sections for detailed summaries
        document.querySelectorAll('.topic-header').forEach(header => {
            header.addEventListener('click', function() {
                const content = this.nextElementSibling;
                const icon = this.querySelector('.toggle-icon');
                
                if (content.style.display === 'none' || content.style.display === '') {
                    content.style.display = 'block';
                    icon.textContent = '▼';
                } else {
                    content.style.display = 'none';
                    icon.textContent = '►';
                }
            });
        });

        // Set initial collapsed state for detailed summaries
        document.querySelectorAll('.topic-detailed .topic-content').forEach(content => {
            content.style.display = 'none';
        });
        document.querySelectorAll('.topic-detailed .toggle-icon').forEach(icon => {
            icon.textContent = '►';
        });
    </script>
</body>
</html>`;

    return {
      html: htmlContent,
      filename: `YouTube_${isDetailed ? "Detailed" : "Quick"}_Summary_${safeTitle}_${this.getDateString()}.html`,
    };
  }

  generateTopicsHTML(topics, processedTopics, isDetailed) {
    let html = "";

    // For detailed summaries, show both main topics and detailed topics
    if (isDetailed && processedTopics && processedTopics.length > 0) {
      // Add main topics section if available
      if (topics && topics.length > 0) {
        html += `
          <section class="topics-section">
              <h2>🎯 Main Topics</h2>
              ${topics
                .map(
                  (topic) => `
                  <div class="topic-simple">
                      <h3>📚 ${topic.name}</h3>
                      <div>${this.formatTextForHTML(topic.content)}</div>
                  </div>
              `,
                )
                .join("")}
          </section>
        `;
      }

      // Add detailed topics section
      html += `
        <section class="topics-section">
            <h2>🎯 Detailed Topics</h2>
            ${processedTopics
              .map(
                (topic) => `
                <div class="topic-detailed">
                    <div class="topic-header">
                        <h3>📚 ${topic.name}</h3>
                        <span class="toggle-icon">►</span>
                    </div>
                    <div class="topic-content">
                        <div class="topic-summary">
                            <h4>Quick Summary:</h4>
                            <div>${this.formatTextForHTML(topic.summary)}</div>
                        </div>
                        <div class="topic-explanation">
                          <h4>📖 Detailed Analysis:</h4>
                          <div>${this.formatTextForHTML(topic.explanation)}</div>
                      </div>
                        <div class="topic-qa">
                            <h4>❓ Questions & Answers:</h4>
                            ${
                              topic.qaPairs && topic.qaPairs.length > 0
                                ? topic.qaPairs
                                    .map(
                                      (qa) => `
                                <div class="qa-pair">
                                    <div class="question">Q: ${this.formatInlineText(qa.question)}</div>
                                    <div class="answer">A: ${this.formatTextForHTML(qa.answer)}</div>
                                </div>
                            `,
                                    )
                                    .join("")
                                : "<p>No questions available for this topic.</p>"
                            }
                        </div>
                    </div>
                </div>
            `,
              )
              .join("")}
        </section>
      `;

      return html;
    } else if (topics && topics.length > 0) {
      // For quick summaries, show only main topics
      return `
        <section class="topics-section">
            <h2>🎯 Main Topics</h2>
            ${topics
              .map(
                (topic) => `
                <div class="topic-simple">
                    <h3>📚 ${topic.name}</h3>
                    <div>${this.formatTextForHTML(topic.content)}</div>
                </div>
            `,
              )
              .join("")}
        </section>
      `;
    } else {
      return "";
    }
  }

  generateConnectionsHTML(connections) {
    if (!connections || connections.length === 0) return "";

    return `
      <section class="connections-section">
          <h2>🔗 How Topics Connect</h2>
          <ul class="connections-list">
              ${connections.map((connection) => `<li>${connection}</li>`).join("")}
          </ul>
      </section>
    `;
  }

  getDownloadableCSS() {
    return `
      /* YouTube Summarizer - General Edition - Professional HTML Export */
      /* HTML5UP Massively-inspired professional design */
      
      @import url('https://fonts.googleapis.com/css2?family=Merriweather:wght@300;400;700&family=Source+Sans+Pro:wght@400;600;900&display=swap');
      
      :root {
        /* Professional color palette */
        --primary: #2d5aa0;      /* Rich royal blue */
        --secondary: #0d7377;    /* Teal green */
        --accent: #f4a261;       /* Warm orange */
        --success: #2a9d8f;      /* Success teal */
        --warning: #e76f51;      /* Warm red-orange */
        --error: #d62828;        /* Strong red */
        
        /* Background colors */
        --bg-primary: #fafbfc;   /* Very light blue-gray */
        --bg-secondary: #ffffff; /* Pure white */
        --bg-accent: #f8f9fa;    /* Warm light gray */
        --bg-light: #e9ecef;     /* Neutral light */
        
        /* Text colors */
        --text-primary: #212529;   /* Rich dark gray */
        --text-secondary: #495057; /* Medium gray */
        --text-light: #6c757d;     /* Light gray */
        --text-white: #ffffff;     /* Pure white */
        
        /* Typography system */
        --font-body: "Merriweather", Georgia, serif;
        --font-heading: "Source Sans Pro", Helvetica, sans-serif;
        --font-size-small: 12px;
        --font-size-base: 14px;
        --font-size-medium: 16px;
        --font-size-large: 18px;
        --font-size-xlarge: 24px;
        
        /* Visual elements */
        --border-radius: 6px;
        --shadow-light: 0 2px 4px rgba(0, 0, 0, 0.08);
        --shadow-medium: 0 4px 12px rgba(0, 0, 0, 0.1);
        --shadow-strong: 0 8px 24px rgba(0, 0, 0, 0.12);
      }
      
      * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
      }

      body {
          font-family: var(--font-body);
          line-height: 1.6;
          color: var(--text-primary);
          background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-light) 100%);
          min-height: 100vh;
      }

      .summary-container {
          max-width: 800px;
          margin: 0 auto;
          padding: 24px;
          background: var(--bg-secondary);
          box-shadow: var(--shadow-medium);
          border-radius: var(--border-radius);
          margin-top: 20px;
          margin-bottom: 20px;
          border: 2px solid var(--secondary);
      }

      .summary-header {
          background: linear-gradient(135deg, var(--primary), var(--secondary));
          color: var(--text-white);
          padding: 24px;
          margin: -24px -24px 30px -24px;
          border-radius: var(--border-radius) var(--border-radius) 0 0;
      }

      .video-info {
          display: flex;
          gap: 20px;
          align-items: center;
          margin-bottom: 15px;
      }

      .video-thumbnail {
          width: 120px;
          height: 90px;
          object-fit: cover;
          border-radius: var(--border-radius);
          box-shadow: var(--shadow-medium);
          border: 2px solid rgba(255, 255, 255, 0.2);
      }

      .video-title {
          color: var(--text-white);
          font-family: var(--font-heading);
          font-size: var(--font-size-xlarge);
          font-weight: 900;
          letter-spacing: 0.075em;
          text-transform: uppercase;
          margin-bottom: 10px;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .video-meta {
          display: flex;
          flex-direction: column;
          gap: 5px;
          font-size: var(--font-size-base);
          color: rgba(255, 255, 255, 0.9);
          font-family: var(--font-heading);
      }

      .type-badge {
          display: inline-block;
          padding: 8px 16px;
          border-radius: 20px;
          font-family: var(--font-heading);
          font-weight: 600;
          text-transform: uppercase;
          font-size: var(--font-size-small);
          letter-spacing: 0.05em;
          border: 2px solid rgba(255, 255, 255, 0.3);
      }

      .type-badge.initial {
          background: linear-gradient(135deg, var(--success), var(--secondary));
          color: var(--text-white);
      }

      .type-badge.detailed {
          background: linear-gradient(135deg, var(--warning), var(--accent));
          color: var(--text-white);
      }

      .summary-content {
          margin-bottom: 30px;
      }

      .overview-section, .topics-section, .connections-section {
          margin-bottom: 30px;
      }

      .overview-section h2, .topics-section h2, .connections-section h2 {
          color: var(--primary);
          font-family: var(--font-heading);
          font-size: var(--font-size-large);
          font-weight: 900;
          letter-spacing: 0.075em;
          text-transform: uppercase;
          margin-bottom: 15px;
          border-left: 4px solid var(--primary);
          padding-left: 15px;
          display: flex;
          align-items: center;
          gap: 8px;
      }

      .summary-text {
          background: var(--bg-accent);
          padding: 20px;
          border-radius: var(--border-radius);
          border-left: 4px solid var(--accent);
          font-size: var(--font-size-medium);
          line-height: 1.7;
          color: var(--text-primary);
          box-shadow: var(--shadow-light);
          border: 2px solid #e0e0e0;
      }

      /* Formatting for structured text content */
      .summary-text p, .topic-simple div p, .topic-summary div p, .topic-explanation div p {
          margin-bottom: 12px;
          line-height: 1.6;
      }

      .summary-text ul, .topic-simple div ul, .topic-summary div ul, .topic-explanation div ul {
          margin: 15px 0;
          padding-left: 20px;
      }

      .summary-text li, .topic-simple div li, .topic-summary div li, .topic-explanation div li {
          margin-bottom: 8px;
          line-height: 1.5;
      }

      .summary-text strong, .topic-simple div strong, .topic-summary div strong, .topic-explanation div strong, .answer strong {
          color: var(--primary);
          font-weight: 700;
      }

      .summary-text em, .topic-simple div em, .topic-summary div em, .topic-explanation div em {
          font-style: italic;
          color: var(--text-secondary);
      }

      .topic-simple, .topic-detailed {
          background: var(--bg-secondary);
          border: 2px solid #e0e0e0;
          border-radius: var(--border-radius);
          margin-bottom: 20px;
          overflow: hidden;
          border-left: 4px solid var(--secondary);
          box-shadow: var(--shadow-light);
          transition: all 0.3s ease;
      }
      
      .topic-simple:hover, .topic-detailed:hover {
          border-color: var(--secondary);
          box-shadow: var(--shadow-medium);
      }

      .topic-simple {
          padding: 20px;
      }

      .topic-simple h3 {
          color: var(--secondary);
          font-family: var(--font-heading);
          font-weight: 600;
          margin-bottom: 10px;
          font-size: var(--font-size-large);
      }

      .topic-header {
          background: linear-gradient(135deg, var(--secondary), var(--success));
          color: var(--text-white);
          padding: 15px 20px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: all 0.3s ease;
          font-family: var(--font-heading);
      }

      .topic-header:hover {
          background: linear-gradient(135deg, var(--success), var(--secondary));
          box-shadow: var(--shadow-medium);
      }

      .topic-header h3 {
          margin: 0;
          font-size: var(--font-size-large);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
      }

      .toggle-icon {
          font-size: 16px;
          font-weight: bold;
      }

      .topic-content {
          padding: 20px;
      }

      .topic-summary, .topic-explanation, .topic-qa {
          margin-bottom: 20px;
      }

      .topic-summary h4, .topic-explanation h4, .topic-qa h4 {
          color: var(--primary);
          font-family: var(--font-heading);
          font-weight: 600;
          margin-bottom: 10px;
          font-size: var(--font-size-medium);
      }

      .qa-pair {
          background: var(--bg-accent);
          padding: 15px;
          border-radius: var(--border-radius);
          margin-bottom: 10px;
          border-left: 3px solid var(--success);
          border: 1px solid #e0e0e0;
          box-shadow: var(--shadow-light);
      }

      .question {
          font-weight: 700;
          font-family: var(--font-heading);
          color: var(--primary);
          margin-bottom: 5px;
      }

      .answer {
          color: #333;
          padding-left: 15px;
      }

      .answer p {
          margin-bottom: 8px;
      }

      .answer ul {
          margin: 10px 0 10px 15px;
      }

      .answer li {
          margin-bottom: 5px;
      }

      .connections-list {
          list-style: none;
          padding-left: 0;
      }

      .connections-list li {
          background: var(--bg-accent);
          padding: 15px;
          margin-bottom: 10px;
          border-radius: var(--border-radius);
          border-left: 4px solid var(--success);
          border: 1px solid #e0e0e0;
          box-shadow: var(--shadow-light);
          font-size: var(--font-size-medium);
          line-height: 1.6;
      }

      .summary-footer {
          background: linear-gradient(135deg, var(--bg-light), var(--bg-accent));
          border-top: 3px solid var(--secondary);
          padding: 24px;
          margin: 30px -24px -24px -24px;
          text-align: center;
          color: var(--text-secondary);
          font-size: var(--font-size-base);
          font-family: var(--font-heading);
          border-radius: 0 0 var(--border-radius) var(--border-radius);
      }

      .footer-content p {
          margin-bottom: 8px;
          line-height: 1.5;
      }
      
      .footer-content strong {
          color: var(--primary);
          font-weight: 700;
      }

      .original-url a {
          color: var(--secondary);
          text-decoration: none;
          font-weight: 600;
          transition: all 0.2s ease;
      }

      .original-url a:hover {
          color: var(--primary);
          text-decoration: underline;
      }

      .disclaimer {
          font-style: italic;
          font-size: var(--font-size-small);
          color: var(--text-light);
          opacity: 0.8;
      }

      /* Print styles */
      @media print {
          body {
              background: white !important;
          }
          
          .summary-container {
              box-shadow: none;
              margin: 0;
              padding: 20px;
              border: none;
          }
          
          .summary-header {
              background: var(--primary) !important;
              -webkit-print-color-adjust: exact;
              color-adjust: exact;
          }
          
          .topic-header {
              background: var(--secondary) !important;
              -webkit-print-color-adjust: exact;
              color-adjust: exact;
          }
          
          .type-badge {
              -webkit-print-color-adjust: exact;
              color-adjust: exact;
          }
      }

      /* Responsive design */
      @media (max-width: 768px) {
          .summary-container {
              margin: 10px;
              padding: 16px;
          }
          
          .summary-header {
              margin: -16px -16px 20px -16px;
              padding: 20px;
          }
          
          .video-info {
              flex-direction: column;
              text-align: center;
              gap: 15px;
          }
          
          .video-thumbnail {
              width: 100px;
              height: 75px;
              align-self: center;
          }
          
          .video-title {
              font-size: var(--font-size-large);
          }
          
          .summary-footer {
              margin: 20px -16px -16px -16px;
              padding: 20px;
          }
      }
    `;
  }

  createSafeFileName(title) {
    return title
      .replace(/[^\w\s-]/g, "") // Remove special characters
      .replace(/\s+/g, "_") // Replace spaces with underscores
      .replace(/_+/g, "_") // Replace multiple underscores with single
      .substring(0, 50) // Limit length
      .replace(/_$/, ""); // Remove trailing underscore
  }

  getDateString() {
    const now = new Date();
    return now.toISOString().split("T")[0]; // YYYY-MM-DD format
  }

  formatDuration(seconds) {
    if (!seconds || seconds === 0) return "Unknown duration";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, "0")}`;
    }
  }

  // New export methods for advanced formats
  generatePlainTextExport(data) {
    const { videoInfo, summary, processedTopics, topicConnections } = data;
    const date = new Date().toLocaleDateString();
    
    let content = `YouTube Video Summary\n`;
    content += `${'='.repeat(50)}\n\n`;
    content += `Title: ${videoInfo.title}\n`;
    content += `Duration: ${this.formatDuration(videoInfo.duration)}\n`;
    content += `Generated: ${date}\n\n`;
    
    content += `SUMMARY:\n${'-'.repeat(20)}\n${summary}\n\n`;
    
    if (processedTopics && processedTopics.length > 0) {
      content += `DETAILED TOPICS:\n${'-'.repeat(20)}\n`;
      processedTopics.forEach((topic, index) => {
        content += `\n${index + 1}. ${topic.name}\n`;
        content += `   ${topic.summary}\n`;
        if (topic.qaPairs) {
          topic.qaPairs.forEach(qa => {
            content += `   Q: ${qa.question}\n`;
            content += `   A: ${qa.answer}\n`;
          });
        }
      });
    }
    
    return { 
      content, 
      filename: `${this.createSafeFileName(videoInfo.title)}_${this.getDateString()}.txt`,
      mimeType: 'text/plain'
    };
  }

  generateMarkdownExport(data) {
    const { videoInfo, summary, processedTopics, topicConnections } = data;
    const date = new Date().toLocaleDateString();
    
    let content = `# YouTube Video Summary\n\n`;
    content += `**Title:** ${videoInfo.title}\n`;
    content += `**Duration:** ${this.formatDuration(videoInfo.duration)}\n`;
    content += `**Generated:** ${date}\n\n`;
    
    content += `## 📝 Summary\n\n${summary}\n\n`;
    
    if (processedTopics && processedTopics.length > 0) {
      content += `## 🎯 Detailed Topics\n\n`;
      processedTopics.forEach((topic, index) => {
        content += `### ${index + 1}. ${topic.name}\n\n`;
        content += `${topic.summary}\n\n`;
        if (topic.qaPairs) {
          content += `**Q&A:**\n\n`;
          topic.qaPairs.forEach(qa => {
            content += `**Q:** ${qa.question}\n`;
            content += `**A:** ${qa.answer}\n\n`;
          });
        }
      });
    }
    
    return { 
      content, 
      filename: `${this.createSafeFileName(videoInfo.title)}_${this.getDateString()}.md`,
      mimeType: 'text/markdown'
    };
  }

  generateJSONExport(data) {
    const exportData = {
      meta: {
        title: data.videoInfo.title,
        duration: data.videoInfo.duration,
        url: data.videoInfo.url,
        thumbnailUrl: data.videoInfo.thumbnailUrl,
        generated: new Date().toISOString()
      },
      summary: data.summary,
      topics: data.processedTopics || [],
      connections: data.topicConnections || [],
      processingState: data.processingState
    };
    
    return { 
      content: JSON.stringify(exportData, null, 2), 
      filename: `${this.createSafeFileName(data.videoInfo.title)}_${this.getDateString()}.json`,
      mimeType: 'application/json'
    };
  }

  exportSummary(data, format = 'html') {
    this.log(`Exporting summary in ${format} format`);
    
    switch (format) {
      case 'text':
        return this.generatePlainTextExport(data);
      case 'markdown':
        return this.generateMarkdownExport(data);
      case 'html':
        return this.generateDownloadableHTML(data);
      case 'json':
        return this.generateJSONExport(data);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }
}
