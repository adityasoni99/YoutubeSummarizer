// Content script for YouTube Summarizer - General Edition Chrome Extension
// Runs on YouTube pages to extract video information and display summaries

class YouTubeContentScript {
  constructor() {
    this.currentVideoId = null;
    this.summaryPanel = null;
    this.isProcessing = false;
    this.retryCount = 0;
    this.maxRetries = 3;
    this.debugMode = false; // Disabled for production
  }

  init() {
    this.log("Initializing YouTube Content Script");

    // Initialize current video ID
    this.currentVideoId = this.extractVideoId(window.location.href);
    this.log("Initial video ID:", this.currentVideoId);

    this.setupMessageListener();
    this.setupStorageListener(); // Listen for setting changes
    
    // Only add button if we're on a video page initially
    if (this.currentVideoId) {
      // Wait for page to load before adding button (respect auto-detect setting)
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          this.checkAutoDetectSetting(() => this.addSummaryButton());
        });
      } else {
        this.checkAutoDetectSetting(() => {
          setTimeout(() => this.addSummaryButton(), 2000);
        });
      }
    } else {
      this.log("Not on a video page initially, waiting for navigation...");
    }
    
    this.observeVideoChanges();
  }
  log(message, data = null) {
    if (this.debugMode) {
      console.log(`[YT-Summarizer] ${message}`, data || "");
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "getVideoInfo") {
        this.getVideoInfo(request.videoId)
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ error: error.message }));
        return true;
      }

      if (request.action === "displaySummary") {
        this.log("Received displaySummary message from popup");
        try {
          this.displaySummary(request.data);
          sendResponse({ success: true });
        } catch (error) {
          this.log("Error displaying summary:", error.message);
          sendResponse({ success: false, error: error.message });
        }
        return true;
      }
    });
  }

  setupStorageListener() {
    // Listen for changes to storage (when settings are updated)
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === "sync" && changes.autoSummarize) {
        const newValue = changes.autoSummarize.newValue;
        this.log("Auto-detect setting changed to:", newValue);

        if (!newValue) {
          // Auto-detect was disabled, remove all existing buttons thoroughly
          this.removeAllSummaryButtons();
        } else {
          // Auto-detect was enabled, add button if on a video page
          if (this.currentVideoId) {
            setTimeout(() => this.addSummaryButton(), 1000);
          }
        }
      }
    });
  }

  observeVideoChanges() {
    this.log("Setting up video change observation");

    // Watch for URL changes (YouTube is a SPA)
    let currentUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        this.log("URL changed to:", currentUrl);

        // Extract video ID from new URL
        const videoId = this.extractVideoId(currentUrl);
        if (videoId && videoId !== this.currentVideoId) {
          this.currentVideoId = videoId;
          this.log("Video changed to:", videoId);

          // Remove existing summary panel
          if (this.summaryPanel) {
            this.summaryPanel.remove();
            this.summaryPanel = null;
          }

          // Check if auto-detect is enabled before adding button for new video
          this.checkAutoDetectSetting(() => {
            setTimeout(() => this.addSummaryButton(), 2000);
          });
        }
      }
    });

    // Observe changes to the document
    urlObserver.observe(document, { childList: true, subtree: true });

    // Also watch for pushstate/popstate events
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    const self = this;
    history.pushState = function (...args) {
      originalPushState.apply(history, args);
      setTimeout(() => {
        const videoId = self.extractVideoId(window.location.href);
        if (videoId && videoId !== self.currentVideoId) {
          self.handleVideoChange(videoId);
        }
      }, 100);
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(history, args);
      setTimeout(() => {
        const videoId = self.extractVideoId(window.location.href);
        if (videoId && videoId !== self.currentVideoId) {
          self.handleVideoChange(videoId);
        }
      }, 100);
    };

    window.addEventListener("popstate", () => {
      setTimeout(() => {
        const videoId = self.extractVideoId(window.location.href);
        if (videoId && videoId !== self.currentVideoId) {
          self.handleVideoChange(videoId);
        }
      }, 100);
    });
  }

  extractVideoId(url) {
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  }

  handleVideoChange(videoId) {
    this.currentVideoId = videoId;
    this.log("Handling video change to:", videoId);

    // Remove existing summary panel
    if (this.summaryPanel) {
      this.summaryPanel.remove();
      this.summaryPanel = null;
    }

    // Check if auto-detect is enabled before adding button
    this.checkAutoDetectSetting(() => {
      // Re-add summary button for new video if auto-detect is enabled
      setTimeout(() => this.addSummaryButton(), 2000);
    });
  }

  // Check auto-detect setting from storage
  async checkAutoDetectSetting(callback) {
    try {
      const result = await chrome.storage.sync.get(["autoSummarize"]);
      const autoDetectEnabled =
        result.autoSummarize !== undefined ? result.autoSummarize : true; // Default to true

      this.log("Auto-detect setting:", autoDetectEnabled);

      if (autoDetectEnabled) {
        callback();
      } else {
        this.log("Auto-detect disabled, removing any existing summary button");
        // Remove existing button if auto-detect is disabled - be more thorough
        this.removeAllSummaryButtons();
      }
    } catch (error) {
      this.log(
        "Error checking auto-detect setting, defaulting to enabled:",
        error.message,
      );
      callback(); // Default to enabled if there's an error
    }
  }

  // Helper method to remove all summary buttons thoroughly
  removeAllSummaryButtons() {
    try {
      // Remove by ID
      const existingButton = document.getElementById("yt-summarizer-btn");
      if (existingButton) {
        existingButton.remove();
        this.log("Removed existing summary button by ID");
      }

      // Remove by class name (in case there are orphaned buttons)
      const buttonsByClass = document.querySelectorAll(".yt-summarizer-button");
      buttonsByClass.forEach((button) => {
        button.remove();
        this.log("Removed orphaned summary button by class");
      });
    } catch (error) {
      this.log("Error removing summary buttons:", error.message);
    }
  }

  // Improved video information extraction with multiple fallback methods
  async getVideoInfo(videoId) {
    try {
      this.log("Getting video info for:", videoId);

      // Wait for page elements to load
      await this.waitForElement(
        'h1.ytd-video-primary-info-renderer, h1[class*="title"]',
        10000,
      );

      // Get video title with comprehensive selectors
      const title = await this.getVideoTitle();
      this.log("Video title found:", title);

      // Get thumbnail URL
      const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

      // Get video duration
      const duration = await this.getVideoDuration();
      this.log("Video duration:", duration);

      // Try multiple methods to get content
      const content = await this.getVideoContent(videoId);
      this.log("Content extracted, length:", content.length);

      return {
        title,
        duration,
        thumbnailUrl,
        transcript: content,
      };
    } catch (error) {
      this.log("Failed to extract video info:", error.message);
      throw new Error(`Failed to extract video info: ${error.message}`);
    }
  }

  async getVideoTitle() {
    const titleSelectors = [
      "h1.ytd-video-primary-info-renderer .yt-core-attributed-string",
      "h1.ytd-video-primary-info-renderer span",
      "h1.ytd-video-primary-info-renderer",
      'h1[class*="title"] span',
      'h1[class*="title"]',
      ".title.style-scope.ytd-video-primary-info-renderer",
      "#container h1 span",
      "#container h1",
      "ytd-video-primary-info-renderer h1 span",
      "ytd-video-primary-info-renderer h1",
    ];

    for (const selector of titleSelectors) {
      const titleElement = document.querySelector(selector);
      if (
        titleElement &&
        titleElement.textContent &&
        titleElement.textContent.trim()
      ) {
        return titleElement.textContent.trim();
      }
    }

    // Final fallback - use document title
    const pageTitle = document.title;
    if (pageTitle && pageTitle.includes(" - YouTube")) {
      return pageTitle.replace(" - YouTube", "").trim();
    }

    return "YouTube Video";
  }

  async getVideoDuration() {
    let duration = 0;

    // Try multiple selectors for duration
    const durationSelectors = [
      ".ytp-time-duration",
      ".ytp-time-current",
      ".ytd-thumbnail-overlay-time-status-renderer",
      '[class*="duration"]',
    ];

    for (const selector of durationSelectors) {
      const durationElement = document.querySelector(selector);
      if (durationElement && durationElement.textContent) {
        const timeStr = durationElement.textContent.trim();
        if (timeStr.includes(":")) {
          duration = this.parseTimeToSeconds(timeStr);
          break;
        }
      }
    }

    return duration;
  }

  async getVideoContent(videoId) {
    this.log("Starting content extraction...");

    // Method 1: Try to get captions/transcript through YouTube's API approach
    try {
      const transcript = await this.extractCaptionsFromPage();
      if (transcript && transcript.length > 100) {
        this.log("Successfully extracted captions from page");
        return transcript;
      }
    } catch (error) {
      this.log("Caption extraction failed:", error.message);
    }

    // Method 2: Extract description content
    try {
      const description = await this.extractVideoDescription();
      if (description && description.length > 100) {
        this.log("Successfully extracted description");
        return description;
      }
    } catch (error) {
      this.log("Description extraction failed:", error.message);
    }

    // Method 3: Extract comments (first few)
    try {
      const comments = await this.extractTopComments();
      if (comments && comments.length > 100) {
        this.log("Successfully extracted comments");
        return comments;
      }
    } catch (error) {
      this.log("Comments extraction failed:", error.message);
    }

    // Method 4: Create content from available metadata
    const metadata = await this.createMetadataContent();
    if (metadata && metadata.length > 50) {
      this.log("Using metadata as content source");
      return metadata;
    }

    throw new Error(
      "No sufficient content found for this video. The video may not have captions, description, or other extractable content.",
    );
  }

  async extractCaptionsFromPage() {
    // Look for any transcript/caption elements that might be present
    const captionSelectors = [
      ".ytd-transcript-segment-renderer",
      ".ytd-transcript-body-renderer",
      '[data-params*="transcript"]',
      '[aria-label*="transcript"]',
      '[aria-label*="caption"]',
    ];

    let captionText = "";

    for (const selector of captionSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        elements.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) {
            captionText += text + " ";
          }
        });
      }
    }

    if (captionText.length > 100) {
      return captionText.trim();
    }

    return null;
  }

  async extractVideoDescription() {
    // Wait for description to potentially load
    try {
      await this.waitForElement(
        "#description, #meta-contents, ytd-expandable-video-description-body-renderer",
        5000,
      );
    } catch (e) {
      this.log("Description elements not found quickly");
    }

    const descriptionSelectors = [
      "ytd-expandable-video-description-body-renderer #plain-snippet-text",
      "ytd-expandable-video-description-body-renderer .yt-core-attributed-string",
      "ytd-expandable-video-description-body-renderer span",
      "#description.ytd-expandable-video-description-body-renderer",
      "#description yt-formatted-string",
      "#description-text",
      "#meta-contents #description",
      ".description",
      "#watch-description-text",
      "ytd-video-secondary-info-renderer #description",
      "#description-inline-expander yt-formatted-string",
      "#description-inline-expander span",
    ];

    for (const selector of descriptionSelectors) {
      const element = document.querySelector(selector);
      if (
        element &&
        element.textContent &&
        element.textContent.trim().length > 50
      ) {
        const description = element.textContent.trim();
        this.log("Found description:", description.substring(0, 100) + "...");
        // Return first 3000 characters of description
        return description.length > 3000
          ? description.substring(0, 3000) + "..."
          : description;
      }
    }

    return null;
  }

  async extractTopComments() {
    // Wait for comments to load
    try {
      await this.waitForElement(
        "#comments #content, ytd-comment-thread-renderer",
        5000,
      );
    } catch (e) {
      this.log("Comments not found quickly");
    }

    const commentSelectors = [
      "#content-text.ytd-comment-renderer",
      ".comment-text",
      "ytd-comment-renderer #content-text",
    ];

    let commentsText = "";
    let commentCount = 0;
    const maxComments = 5;

    for (const selector of commentSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (commentCount >= maxComments) break;

        const commentText = element.textContent?.trim();
        if (commentText && commentText.length > 20) {
          commentsText += `Comment: ${commentText}\n\n`;
          commentCount++;
        }
      }
      if (commentCount >= maxComments) break;
    }

    return commentsText.length > 100 ? commentsText : null;
  }

  async createMetadataContent() {
    const title = await this.getVideoTitle();

    // Get channel name
    const channelSelectors = [
      "#channel-name .yt-core-attributed-string",
      "#channel-name a",
      ".ytd-channel-name a",
      '[class*="channel"] a',
      "ytd-video-owner-renderer a",
    ];

    let channel = "";
    for (const selector of channelSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        channel = element.textContent.trim();
        break;
      }
    }

    // Get view count and date if available
    let additionalInfo = "";
    const metaSelectors = [
      "#info-strings yt-formatted-string",
      ".view-count",
      ".upload-date",
    ];

    for (const selector of metaSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        additionalInfo += element.textContent.trim() + ". ";
      }
    }

    // Create comprehensive content from available data
    const metadata = `Video Title: "${title}". 
    Channel: ${channel || "YouTube Channel"}. 
    ${additionalInfo}
    This educational video discusses topics related to: ${title.toLowerCase()}. 
    Based on the title, this content covers topics that can be explained clearly with practical examples and professional insights. 
    The video appears to be about educational topics that children can learn from, focusing on ${this.extractKeywords(title).join(", ")}.`;

    return metadata.length > 100 ? metadata : null;
  }

  extractKeywords(title) {
    const commonWords = [
      "the",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "how",
      "what",
      "when",
      "where",
      "why",
      "is",
      "are",
      "was",
      "were",
    ];
    const words = title
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3 && !commonWords.includes(word));
    return words.slice(0, 5); // Return up to 5 keywords
  }

  async waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }

  parseTimeToSeconds(timeStr) {
    const parts = timeStr.split(":").reverse();
    let seconds = 0;
    for (let i = 0; i < parts.length; i++) {
      seconds += parseInt(parts[i]) * Math.pow(60, i);
    }
    return seconds;
  }

  addSummaryButton() {
    // Remove existing buttons thoroughly before adding new one
    this.removeAllSummaryButtons();

    this.log("Adding summary button...");

    // Try multiple insertion strategies
    const strategies = [
      () => this.insertButtonInActionsMenu(),
      () => this.insertButtonNearTitle(),
      () => this.insertButtonInSecondaryInfo(),
      () => this.insertFloatingButton(),
    ];

    for (const strategy of strategies) {
      try {
        if (strategy()) {
          this.log("Button added successfully");
          return;
        }
      } catch (error) {
        this.log("Button insertion strategy failed:", error.message);
      }
    }

    this.log("All button insertion strategies failed");
  }

  insertButtonInActionsMenu() {
    const targetSelectors = [
      "#actions-inner",
      "#actions ytd-button-renderer",
      "#top-level-buttons-computed",
      "ytd-menu-renderer #top-level-buttons",
      "#actions #top-level-buttons",
    ];

    for (const selector of targetSelectors) {
      const targetContainer = document.querySelector(selector);
      if (targetContainer) {
        const button = this.createSummaryButton();
        targetContainer.appendChild(button);
        this.log("Button inserted in actions menu:", selector);
        return true;
      }
    }
    return false;
  }

  insertButtonNearTitle() {
    const titleContainer = document.querySelector(
      "#title, ytd-video-primary-info-renderer, #container.ytd-video-primary-info-renderer",
    );
    if (titleContainer) {
      const button = this.createSummaryButton();
      button.style.cssText += `
        margin: 12px 0;
        display: block;
        width: fit-content;
      `;
      titleContainer.appendChild(button);
      this.log("Button inserted near title");
      return true;
    }
    return false;
  }

  insertButtonInSecondaryInfo() {
    const secondaryInfo = document.querySelector(
      "#secondary-inner, #secondary, ytd-video-secondary-info-renderer",
    );
    if (secondaryInfo) {
      const button = this.createSummaryButton();
      button.style.cssText += `
        margin: 16px 0;
        display: block;
        width: fit-content;
      `;
      secondaryInfo.insertBefore(button, secondaryInfo.firstChild);
      this.log("Button inserted in secondary info");
      return true;
    }
    return false;
  }

  insertFloatingButton() {
    const button = this.createSummaryButton();
    button.style.cssText = `
      position: fixed !important;
      top: 120px !important;
      right: 20px !important;
      z-index: 10000 !important;
      background: linear-gradient(135deg, #ff6b6b, #ff9f43) !important;
      color: white !important;
      border: none !important;
      padding: 12px 16px !important;
      border-radius: 8px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
      transition: all 0.2s ease !important;
    `;

    button.addEventListener("mouseenter", () => {
      button.style.transform = "translateY(-2px) scale(1.05)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.transform = "translateY(0) scale(1)";
    });

    document.body.appendChild(button);
    this.log("Floating button added");
    return true;
  }

  createSummaryButton() {
    const button = document.createElement("button");
    button.id = "yt-summarizer-btn";
    button.innerHTML = "🎬 Smart Summary";
    button.className = "yt-summarizer-button";
    button.addEventListener("click", () => this.handleSummarizeClick());
    return button;
  }

  async handleSummarizeClick() {
    if (this.isProcessing) return;

    const videoId = this.extractVideoId(window.location.href);
    if (!videoId) {
      this.showError(
        "Could not detect video ID. Please make sure you're on a YouTube video page.",
      );
      return;
    }

    this.isProcessing = true;
    this.showLoadingState();

    try {
      // Check if API key is configured
      const apiKeyCheck = await chrome.runtime.sendMessage({
        action: "checkApiKey",
      });
      if (!apiKeyCheck.hasApiKey) {
        this.showError(
          "Please configure your Gemini API key in extension options first!",
          true,
        );
        return;
      }

      const url = window.location.href;
      this.log("Starting initial summarization for:", url);

      const result = await chrome.runtime.sendMessage({
        action: "summarizeVideo",
        url: url,
        phase: "initial",
      });

      if (result.success) {
        this.log("Initial summarization successful");
        this.displaySummary(result.data);
        this.showSuccessNotification();
      } else {
        this.log("Summarization failed:", result.error);
        this.showError(result.error);
      }
    } catch (error) {
      this.log("Summarization error:", error.message);
      this.showError(error.message);
    } finally {
      this.isProcessing = false;
      this.hideLoadingState();
    }
  }



  showLoadingState() {
    const button = document.getElementById("yt-summarizer-btn");
    if (button) {
      button.innerHTML = "⏳ Creating Summary...";
      button.disabled = true;
      button.style.opacity = "0.7";
    }
  }

  hideLoadingState() {
    const button = document.getElementById("yt-summarizer-btn");
    if (button) {
      button.innerHTML = "🎬 Smart Summary";
      button.disabled = false;
      button.style.opacity = "1";
    }
  }

  showSuccessNotification() {
    const notification = document.createElement("div");
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #7ed321, #4ecdc4);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: 600;
      z-index: 10001;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      animation: slideInRight 0.3s ease;
      cursor: pointer;
    `;
    notification.innerHTML =
      "✅ Summary Created!<br><small>Click here to scroll to it!</small>";

    document.body.appendChild(notification);

    // Add click event to scroll to the summary panel
    notification.addEventListener("click", () => {
      if (this.summaryPanel) {
        this.summaryPanel.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });

        // Add a highlight effect to make the panel more noticeable
        this.summaryPanel.classList.add("highlight-panel");
        setTimeout(() => {
          this.summaryPanel.classList.remove("highlight-panel");
        }, 2000);
      }
      notification.remove();
    });

    setTimeout(() => {
      notification.remove();
    }, 6000);
  }

  showError(message, showOptions = false) {
    this.log("Showing error:", message);

    // Remove existing panels
    this.removeSummaryPanel();

    const errorPanel = document.createElement("div");
    errorPanel.className = "yt-summarizer-panel error";

    const optionsButton = showOptions
      ? `
    <div style="margin-top: 16px;">
      <button id="yt-summarizer-options-btn" style="
        background: linear-gradient(135deg, var(--yt-summarizer-accent), var(--yt-summarizer-warning));
        color: var(--yt-summarizer-text-white);
        border: 2px solid transparent;
        padding: 12px 20px;
        border-radius: var(--yt-summarizer-border-radius);
        cursor: pointer;
        font-family: var(--yt-summarizer-font-family-heading);
        font-weight: var(--yt-summarizer-heading-weight);
        letter-spacing: var(--yt-summarizer-heading-spacing);
        text-transform: var(--yt-summarizer-heading-transform);
        font-size: var(--yt-summarizer-font-size-base);
        box-shadow: var(--yt-summarizer-shadow-medium);
        transition: all 0.3s ease;
      ">Open Extension Options</button>
    </div>
  `
      : "";

    errorPanel.innerHTML = `
    <div class="panel-header error">
      <h3>❌ Oops! Something went wrong</h3>
      <button class="close-btn" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
    <div class="panel-content">
      <p><strong>Error:</strong> ${message}</p>
      <div class="error-help">
        <p><strong>Troubleshooting Steps:</strong></p>
        <ul>
          <li>Make sure you have a Gemini API key configured in extension options</li>
          <li>Try refreshing the page and clicking the button again</li>
          <li>Try a different educational video that might have captions or description</li>
          <li>Check that the video is publicly available and not age-restricted</li>
          <li>Make sure your internet connection is stable</li>
        </ul>
      </div>
      ${optionsButton}
      <div style="margin-top: 16px; text-align: center;">
        <button onclick="location.reload()" style="
          background: linear-gradient(135deg, var(--yt-summarizer-success), var(--yt-summarizer-secondary));
          color: var(--yt-summarizer-text-white);
          border: 2px solid transparent;
          padding: 12px 20px;
          border-radius: var(--yt-summarizer-border-radius);
          cursor: pointer;
          font-family: var(--yt-summarizer-font-family-heading);
          font-weight: var(--yt-summarizer-heading-weight);
          letter-spacing: var(--yt-summarizer-heading-spacing);
          text-transform: var(--yt-summarizer-heading-transform);
          font-size: var(--yt-summarizer-font-size-base);
          box-shadow: var(--yt-summarizer-shadow-medium);
          transition: all 0.3s ease;
          margin-right: 8px;
        ">Try Again</button>
      </div>
    </div>
  `;

    this.insertSummaryPanel(errorPanel);
    
    // Add event listener for options button if it exists
    if (showOptions) {
      const optionsBtn = errorPanel.querySelector('#yt-summarizer-options-btn');
      if (optionsBtn) {
        optionsBtn.addEventListener('click', () => {
          // Send message to background script to open options page
          chrome.runtime.sendMessage({action: 'openOptions'});
        });
      }
    }
  }

  displaySummary(data) {
    this.log("Displaying summary:", data);
    this.removeSummaryPanel();

    const panel = document.createElement("div");
    panel.className = "yt-summarizer-panel";

    // Choose HTML generation method based on processing state
    if (data.processingState === "initial") {
      panel.innerHTML = this.generateInitialSummaryHTML(data);
    } else {
      panel.innerHTML = this.generateDetailedSummaryHTML(data);
    }

    this.insertSummaryPanel(panel);

    // Add visual highlight when summary is displayed via popup
    if (this.summaryPanel) {
      // Add a highlight effect to make the panel more noticeable
      this.summaryPanel.classList.add("highlight-panel");

      // Scroll to the panel with a slight delay to ensure rendering
      setTimeout(() => {
        this.summaryPanel.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });

        // Remove highlight after animation
        setTimeout(() => {
          if (this.summaryPanel) {
            this.summaryPanel.classList.remove("highlight-panel");
          }
        }, 3000);
      }, 500);
    }

    // Ensure sections are collapsed by default
    setTimeout(() => this.collapseByDefault(), 300);

    // Set up event listeners for the "View Detailed Summary" button if in initial state
    if (data.processingState === "initial") {
      const detailsButton = panel.querySelector("#view-detailed-summary");
      if (detailsButton) {
        detailsButton.addEventListener("click", () =>
          this.handleDetailedSummaryRequest(),
        );
      }
    }

    // Set up event listener for the download button
    const downloadButton = panel.querySelector("#download-summary");
    if (downloadButton) {
      downloadButton.addEventListener("click", () =>
        this.handleDownloadSummary(data),
      );
    }
  }

  generateInitialSummaryHTML(data) {
    const { videoInfo, summary, topics } = data;

    const topicsHTML = topics
      .map(
        (topic) => `
      <div class="topic-initial">
        <h3>📚 ${topic.name}</h3>
        <div class="topic-content">
          ${this.formatTextForHTML(topic.content)}
        </div>
      </div>
    `,
      )
      .join("");

    return `
      <div class="panel-header">
        <h2>🎬 Video Summary</h2>
        <button class="close-btn" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="panel-content">
        <div class="video-info">
          <img src="${videoInfo.thumbnailUrl}" alt="Video thumbnail" class="thumbnail" onerror="this.style.display='none'" />
          <h3>${videoInfo.title}</h3>
        </div>
        
        <div class="summary">
          <h3>📝 What's this video about?</h3>
          ${this.formatTextForHTML(summary)}
        </div>

        <div class="topics">
          <h3>🎯 Main Topics:</h3>
          ${topicsHTML}
        </div>

        <div class="view-detailed-container">
          <button id="view-detailed-summary" class="view-detailed-button">
            <span class="button-icon">🔍</span> View Detailed Summary
          </button>
          <div class="detailed-info">Detailed summary includes Q&A, explanations, and more!</div>
        </div>

        <div class="download-container">
          <button id="download-summary" class="download-button">
            <span class="button-icon">💾</span> Download Summary
          </button>
          <div class="download-info">Export format configured in settings</div>
        </div>

        <div class="footer">
          <p>✨ This summary was created using AI to help you understand the video content.</p>
        </div>
      </div>
    `;
  }

  generateDetailedSummaryHTML(data) {
    const { videoInfo, summary, topics, processedTopics, topicConnections } =
      data;

    let connectionsHTML = "";
    if (topicConnections && topicConnections.length > 0) {
      connectionsHTML = `
        <div class="connections">
          <h3>🔗 How these topics connect:</h3>
          <ul>
            ${topicConnections.map((conn) => `<li>${this.formatInlineText(conn)}</li>`).join("")}
          </ul>
        </div>
      `;
    }

    const topicsHTML = processedTopics
      .map(
        (topic) => `
      <div class="topic">
        <h3>📚 ${topic.name}</h3>
        <div class="topic-summary">
          <strong class="section-title">Quick Summary:</strong> ${this.formatInlineText(topic.summary)}
        </div>
        <div class="explanation-section">
          <div class="explanation-header">
            <strong class="section-title">📖 Learn More:</strong>
            <span class="toggle-icon">►</span>
          </div>
          <div class="explanation-content">
            <div class="explanation">
              ${this.formatTextForHTML(topic.explanation)}
            </div>
          </div>
        </div>
        <div class="qa-section">
          <div class="qa-section-header">
            <h4>❓ Questions & Answers:</h4>
            <span class="toggle-icon">►</span>
          </div>
          <div class="qa-content">
            ${topic.qaPairs
              .map(
                (qa) => `
              <div class="qa">
                <div class="question">Q: ${this.formatInlineText(qa.question)}</div>
                <div class="answer">A: ${this.formatTextForHTML(qa.answer)}</div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      </div>
    `,
      )
      .join("");

    return `
      <div class="panel-header">
        <h2>🎬 Detailed Summary</h2>
        <button class="close-btn" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
      <div class="panel-content">
        <div class="video-info">
          <img src="${videoInfo.thumbnailUrl}" alt="Video thumbnail" class="thumbnail" onerror="this.style.display='none'" />
          <h3>${videoInfo.title}</h3>
        </div>
        
        <div class="summary">
          <h3>📝 What's this video about?</h3>
          ${this.formatTextForHTML(summary)}
        </div>

        ${connectionsHTML}

        <div class="topics">
          <h3>🎯 Main Topics:</h3>
          ${topicsHTML}
        </div>

        <div class="download-container">
          <button id="download-summary" class="download-button">
            <span class="button-icon">💾</span> Download Summary
          </button>
          <div class="download-info">Save this detailed summary in your preferred format</div>
        </div>

        <div class="footer">
          <p>✨ This detailed summary was created using AI to provide comprehensive insights.</p>
        </div>
      </div>
    `;
  }

  async handleDetailedSummaryRequest() {
    try {
      this.log("Requesting detailed summary...");

      // Find the detailed button and replace with loading indicator
      const detailsButton = document.querySelector("#view-detailed-summary");
      if (detailsButton) {
        detailsButton.innerHTML =
          '<span class="loading-spinner"></span> Processing Detailed Summary...';
        detailsButton.disabled = true;
      }

      // Get current video URL
      const url = window.location.href;

      // Request detailed processing from background script
      const result = await chrome.runtime.sendMessage({
        action: "summarizeVideo",
        url,
        phase: "detailed",
      });

      if (result.success) {
        this.log("Detailed summary received:", result);
        this.displaySummary(result.data);
      } else {
        throw new Error(result.error || "Failed to process detailed summary");
      }
    } catch (error) {
      this.log("Error getting detailed summary:", error.message);

      // Show error message
      const detailsButton = document.querySelector("#view-detailed-summary");
      if (detailsButton) {
        detailsButton.innerHTML =
          "❌ Error: Could not generate detailed summary";
        detailsButton.disabled = true;
      }
    }
  }

  insertSummaryPanel(panel) {
    try {
      this.log("Inserting summary panel...");

      // Strategy 1: Try to insert in comments section first
      const commentsSection = document.querySelector("#comments");
      if (commentsSection) {
        commentsSection.parentNode.insertBefore(panel, commentsSection);
        this.log("Panel inserted before comments section");

        // Scroll to the panel with a slight delay to ensure rendering
        setTimeout(() => {
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 500);

        this.summaryPanel = panel;
        return true;
      }

      // Strategy 2: Try to insert after video info
      const videoInfo = document.querySelector("#info, #meta, #info-contents");
      if (videoInfo) {
        videoInfo.parentNode.insertBefore(panel, videoInfo.nextSibling);
        this.log("Panel inserted after video info");

        setTimeout(() => {
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 500);

        this.summaryPanel = panel;
        return true;
      }

      // Strategy 3: Insert after primary column
      const primaryColumn = document.querySelector("#primary, #primary-inner");
      if (primaryColumn) {
        primaryColumn.appendChild(panel);
        this.log("Panel appended to primary column");

        setTimeout(() => {
          panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 500);

        this.summaryPanel = panel;
        return true;
      }

      // Strategy 4: Fallback - insert as floating panel
      panel.style.position = "fixed";
      panel.style.top = "80px";
      panel.style.right = "20px";
      panel.style.maxWidth = "400px";
      panel.style.maxHeight = "80vh";
      panel.style.overflowY = "auto";
      panel.style.zIndex = "9999";
      panel.style.boxShadow = "0 4px 20px rgba(0,0,0,0.3)";

      document.body.appendChild(panel);
      this.log("Panel inserted as floating element");

      this.summaryPanel = panel;
      return true;
    } catch (error) {
      this.log("Failed to insert panel:", error.message);

      // Last resort - append to body
      try {
        document.body.appendChild(panel);
        this.log("Panel appended to body as last resort");
        this.summaryPanel = panel;
        return true;
      } catch (finalError) {
        this.log("All insertion methods failed:", finalError.message);
        return false;
      }
    }
  }

  removeSummaryPanel() {
    try {
      // Remove existing panel if present
      if (this.summaryPanel) {
        this.summaryPanel.remove();
        this.summaryPanel = null;
        this.log("Existing summary panel removed");
      }

      // Clean up any other panels that might be orphaned
      const existingPanels = document.querySelectorAll(".yt-summarizer-panel");
      existingPanels.forEach((panel) => {
        panel.remove();
        this.log("Cleaned up orphaned panel");
      });
    } catch (error) {
      this.log("Error removing panels:", error.message);
    }
  }

  collapseByDefault() {
    try {
      if (!this.summaryPanel) return;

      // Collapse all expandable sections by default
      const expandableSections = this.summaryPanel.querySelectorAll(
        ".explanation-content, .qa-content",
      );
      expandableSections.forEach((section) => {
        section.style.display = "none";
      });

      // Setup toggle functionality and set initial arrow direction
      const toggleHeaders = this.summaryPanel.querySelectorAll(
        ".explanation-header, .qa-section-header",
      );
      toggleHeaders.forEach((header) => {
        // Remove any existing listeners
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);

        // Set initial arrow direction to right (collapsed state)
        const icon = newHeader.querySelector(".toggle-icon");
        if (icon) icon.textContent = "►";

        // Add click handler
        newHeader.addEventListener("click", () => {
          const content = newHeader.nextElementSibling;
          const icon = newHeader.querySelector(".toggle-icon");

          if (content.style.display === "none") {
            content.style.display = "block";
            if (icon) icon.textContent = "▼";
          } else {
            content.style.display = "none";
            if (icon) icon.textContent = "►";
          }
        });
      });
    } catch (error) {
      this.log("Error setting up collapsible sections:", error.message);
    }
  }

  // Download Summary Functionality
  async handleDownloadSummary(data) {
    try {
      this.log("Starting download process for summary");

      const downloadButton = document.querySelector("#download-summary");
      if (downloadButton) {
        // Show loading state
        const originalContent = downloadButton.innerHTML;
        downloadButton.innerHTML =
          '<span class="button-icon">⏳</span> Generating...';
        downloadButton.disabled = true;
      }

      // Get export format from user settings
      const settings = await chrome.storage.sync.get(['exportFormat', 'enableExport']);
      const exportFormat = settings.exportFormat || 'html';
      const enableExport = settings.enableExport || false;
      
      // Use HTML format if export is disabled, otherwise use user preference
      // Default to HTML for backward compatibility, but users can enable advanced export
      const downloadFormat = enableExport ? exportFormat : 'html';

      // Request content generation from background script
      const response = await chrome.runtime.sendMessage({
        action: "downloadSummary",
        data: data,
        format: downloadFormat,
      });

      if (response.success) {
        this.log(`Download ${downloadFormat.toUpperCase()} generated successfully`);
        // Use content if available (new formats), fallback to html for compatibility
        const downloadContent = response.content || response.html;
        this.triggerDownload(downloadContent, response.filename, response.mimeType);
        this.showDownloadNotification(
          "success",
          `Summary downloaded successfully as ${downloadFormat.toUpperCase()}!`,
        );
      } else {
        throw new Error(response.error || "Failed to generate download");
      }
    } catch (error) {
      this.log("Download failed:", error.message);
      this.showDownloadNotification(
        "error",
        `Download failed: ${error.message}`,
      );
    } finally {
      // Restore button state
      const downloadButton = document.querySelector("#download-summary");
      if (downloadButton) {
        downloadButton.innerHTML =
          '<span class="button-icon">💾</span> Download Summary';
        downloadButton.disabled = false;
      }
    }
  }

  triggerDownload(content, filename, mimeType = 'text/html;charset=utf-8') {
    try {
      // Create blob with appropriate content type
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);

      // Create temporary download link
      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.download = filename;
      downloadLink.style.display = "none";

      // Trigger download
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      this.log(`Download triggered successfully: ${filename} (${mimeType})`);
    } catch (error) {
      this.log("Failed to trigger download:", error.message);
      throw error;
    }
  }

  showDownloadNotification(type, message) {
    const notification = document.createElement("div");
    const isSuccess = type === "success";

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${
        isSuccess
          ? "linear-gradient(135deg, #7ed321, #4ecdc4)"
          : "linear-gradient(135deg, #ff6b6b, #ff8e53)"
      };
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: 600;
      z-index: 10001;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      animation: slideInRight 0.3s ease;
      cursor: pointer;
      max-width: 300px;
    `;

    notification.innerHTML = `
      ${isSuccess ? "✅" : "❌"} ${message}
      <br><small>Click to dismiss</small>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 5 seconds or on click
    const removeNotification = () => {
      if (notification.parentNode) {
        notification.remove();
      }
    };

    notification.addEventListener("click", removeNotification);
    setTimeout(removeNotification, 5000);
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
}

const youTubeContentScript = new YouTubeContentScript();
youTubeContentScript.init();
