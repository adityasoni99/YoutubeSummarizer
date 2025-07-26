// Popup script for YouTube Summarizer for Kids Chrome Extension

class PopupController {
  constructor() {
    this.currentTab = null;
    this.isProcessing = false;
    this.debugMode = false; // Disabled for production
    this.init();
  }

  log(message, data = null) {
    if (this.debugMode) {
      console.log(`[YT-Summarizer-Popup] ${message}`, data || "");
    }
  }

  async init() {
    await this.getCurrentTab();
    await this.checkSetup();
    this.setupEventListeners();
    this.loadUserPreferences();
  }

  async getCurrentTab() {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    this.currentTab = tab;
  }

  async checkSetup() {
    // Check if API key is configured
    const apiKeyCheck = await chrome.runtime.sendMessage({
      action: "checkApiKey",
    });

    if (!apiKeyCheck.hasApiKey) {
      this.showApiKeyWarning();
      return;
    }

    // Check if we're on a YouTube video page
    if (this.isYouTubeVideoPage()) {
      this.showYouTubeInterface();
      this.loadVideoInfo();
    } else {
      this.showNonYouTubeInterface();
    }
  }

  isYouTubeVideoPage() {
    return (
      this.currentTab &&
      this.currentTab.url &&
      this.currentTab.url.includes("youtube.com/watch")
    );
  }

  showApiKeyWarning() {
    this.hideAllInterfaces();
    document.getElementById("api-key-warning").classList.remove("hidden");
  }

  showYouTubeInterface() {
    this.hideAllInterfaces();
    document.getElementById("youtube-interface").classList.remove("hidden");
    document.getElementById("complexity-section").classList.remove("hidden");
  }

  showNonYouTubeInterface() {
    this.hideAllInterfaces();
    document.getElementById("non-youtube-interface").classList.remove("hidden");
  }

  hideAllInterfaces() {
    const interfaces = [
      "youtube-interface",
      "non-youtube-interface",
      "api-key-warning",
      "complexity-section",
      "status",
      "results",
      "error",
    ];

    interfaces.forEach((id) => {
      document.getElementById(id).classList.add("hidden");
    });
  }

  async loadVideoInfo() {
    if (!this.currentTab) return;

    try {
      // Extract video title from tab title (YouTube format: "Title - YouTube")
      const title = this.currentTab.title.replace(" - YouTube", "");
      document.getElementById("video-title").textContent = title;
      document.getElementById("video-url").textContent = this.currentTab.url;
    } catch (error) {
      console.error("Error loading video info:", error);
    }
  }

  setupEventListeners() {
    // Summarize button
    document.getElementById("summarize-btn").addEventListener("click", () => {
      this.handleSummarize();
    });

    // Settings button
    document.getElementById("settings-btn").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });

    // Open options from warning
    document.getElementById("open-options").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });

    // Help button
    document.getElementById("help-btn").addEventListener("click", () => {
      this.showHelp();
    });

    // Retry button
    document.getElementById("retry-btn").addEventListener("click", () => {
      this.hideError();
      this.checkSetup();
    });

    // Create another summary button
    document.getElementById("create-another").addEventListener("click", () => {
      this.hideResults();
      this.showYouTubeInterface();
    });

    // Age selection change
    document.querySelectorAll('input[name="complexity"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        this.saveUserPreferences();
      });
    });
  }

  async handleSummarize() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.showStatus("Creating professional summary...");

    try {
      const selectedComplexity = document.querySelector(
        'input[name="complexity"]:checked',
      ).value;

      // Store complexity preference for the background script to use
      await chrome.storage.sync.set({ complexityLevel: selectedComplexity });

      const result = await chrome.runtime.sendMessage({
        action: "summarizeVideo",
        url: this.currentTab.url,
        phase: "initial", // Start with initial phase
      });

      if (result.success) {
        this.showResults();

        // Inject the summary directly into the page
        try {
          const response = await chrome.tabs.sendMessage(this.currentTab.id, {
            action: "displaySummary",
            data: result.data,
          });

          if (response && response.success) {
            this.log("Summary successfully injected into page");
          } else {
            this.log(
              "Content script could not display summary:",
              response?.error || "Unknown error",
            );
          }
        } catch (e) {
          // Content script might not be ready or loaded
          this.log(
            "Could not inject summary into page - content script may not be loaded:",
            e.message,
          );

          // Inform user to refresh the page if content script isn't available
          if (e.message.includes("Could not establish connection")) {
            this.showError(
              "Please refresh the YouTube page and try again. The content script may not be loaded yet.",
            );
            return;
          }
        }
      } else {
        this.showError(result.error);
      }
    } catch (error) {
      this.showError(error.message);
    } finally {
      this.isProcessing = false;
      this.hideStatus();
    }
  }

  showStatus(message) {
    document.getElementById("status").classList.remove("hidden");
    document.querySelector(".status-text").textContent = message;
    document.getElementById("youtube-interface").classList.add("hidden");
  }

  hideStatus() {
    document.getElementById("status").classList.add("hidden");
  }

  showResults() {
    this.hideAllInterfaces();
    document.getElementById("results").classList.remove("hidden");
  }

  hideResults() {
    document.getElementById("results").classList.add("hidden");
  }

  showError(message) {
    this.hideAllInterfaces();
    document.getElementById("error").classList.remove("hidden");
    document.getElementById("error-message").textContent = message;
  }

  hideError() {
    document.getElementById("error").classList.add("hidden");
  }

  showHelp() {
    const helpText = `
How to use YouTube Summarizer - Professional Edition:

1. 🔧 Set up your Gemini API key in Settings
2. 📺 Go to any YouTube video
3. 🎯 Select content complexity level
4. 🎯 Click "Create Professional Summary"
5. 📜 Read the professional summary with insights!

Features:
• Professional analysis and insights
• Intelligent content processing
• Multiple complexity levels
• Modern, sophisticated interface

Need help? Check the extension options for more settings!
    `;

    alert(helpText);
  }

  async loadUserPreferences() {
    try {
      const result = await chrome.storage.sync.get(["complexityLevel"]);
      if (result.complexityLevel) {
        const complexityRadio = document.querySelector(
          `input[name="complexity"][value="${result.complexityLevel}"]`,
        );
        if (complexityRadio) complexityRadio.checked = true;
      }
    } catch (error) {
      console.error("Error loading preferences:", error);
    }
  }

  async saveUserPreferences() {
    try {
      const selectedComplexity = document.querySelector(
        'input[name="complexity"]:checked',
      ).value;
      await chrome.storage.sync.set({ complexityLevel: selectedComplexity });
    } catch (error) {
      console.error("Error saving preferences:", error);
    }
  }
}

// Initialize popup when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new PopupController();
});
