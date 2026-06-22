const API_BASE_URL = "http://127.0.0.1:8000";

const analyzeBtn = document.getElementById("analyzeBtn");
const loading = document.getElementById("loading");
const errorBox = document.getElementById("errorBox");
const results = document.getElementById("results");

const totalReviews = document.getElementById("totalReviews");
const positivePct = document.getElementById("positivePct");
const negativePct = document.getElementById("negativePct");
const positiveBar = document.getElementById("positiveBar");
const negativeBar = document.getElementById("negativeBar");
const summaryText = document.getElementById("summaryText");
const keywordList = document.getElementById("keywordList");

analyzeBtn.addEventListener("click", handleAnalyzeClick);

async function handleAnalyzeClick() {
  setLoadingState(true);
  clearError();
  hideResults();

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab || !tab.id) {
      throw new Error("No active browser tab found.");
    }

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeReviewsFromPage
    });

    const reviews = injectionResults?.[0]?.result || [];

    if (!reviews.length) {
      throw new Error(
        "No review-like text found on this page. Try a page with visible reviews or comments."
      );
    }

    const response = await fetch(`${API_BASE_URL}/v1/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ reviews })
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(
        errorPayload?.detail || `Backend error: ${response.status}`
      );
    }

    const data = await response.json();
    renderResults(data);
  } catch (error) {
    showError(error.message || "Something went wrong.");
  } finally {
    setLoadingState(false);
  }
}

function scrapeReviewsFromPage() {
  const selectors = [
    // YouTube comments
    "ytd-comment-thread-renderer #content-text",

    // Generic review-like selectors
    "[data-review-id]",
    "[class*='review']",
    "[class*='Review']",
    ".review",
    ".review-text",
    ".review-content",
    ".comment",
    ".comment-text",

    // Fallback content blocks
    "article",
    "p"
  ];

  const seen = new Set();
  const reviews = [];

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));

    for (const element of elements) {
      const text = (element.innerText || element.textContent || "")
        .replace(/\s+/g, " ")
        .trim();

      const isUsefulLength = text.length >= 25 && text.length <= 2000;
      const isDuplicate = seen.has(text);

      if (isUsefulLength && !isDuplicate) {
        seen.add(text);
        reviews.push(text);
      }

      if (reviews.length >= 80) {
        return reviews;
      }
    }

    // Stop early if a strong selector already found enough text.
    if (reviews.length >= 10) {
      return reviews;
    }
  }

  return reviews;
}

function renderResults(data) {
  const positive = data.sentiment.positive_pct || 0;
  const negative = data.sentiment.negative_pct || 0;

  totalReviews.textContent = String(data.total_reviews);
  positivePct.textContent = `${positive}%`;
  negativePct.textContent = `${negative}%`;

  positiveBar.style.width = `${positive}%`;
  negativeBar.style.width = `${negative}%`;

  summaryText.textContent = data.summary || "No summary available.";

  keywordList.innerHTML = "";

  if (data.top_negative_terms && data.top_negative_terms.length) {
    for (const item of data.top_negative_terms) {
      const li = document.createElement("li");
      li.textContent = `${item.term} (${item.count})`;
      keywordList.appendChild(li);
    }
  } else {
    const li = document.createElement("li");
    li.textContent = "No repeated issue terms found.";
    keywordList.appendChild(li);
  }

  results.classList.remove("hidden");
}

function setLoadingState(isLoading) {
  analyzeBtn.disabled = isLoading;
  loading.classList.toggle("hidden", !isLoading);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.textContent = "";
  errorBox.classList.add("hidden");
}

function hideResults() {
  results.classList.add("hidden");
}