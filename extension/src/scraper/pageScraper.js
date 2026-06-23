export function scrapeReviewsFromPage(limit) {
  const scrapeLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Number(limit)
    : Number.POSITIVE_INFINITY;

  function parseCompactNumberInPage(value) {
    const match = String(value || "")
      .replace(/,/g, "")
      .match(/(\d+(?:\.\d+)?)\s*([kKmM])?/);

    if (!match) {
      return null;
    }

    const multiplier = match[2]?.toLowerCase() === "m"
      ? 1_000_000
      : match[2]?.toLowerCase() === "k"
        ? 1_000
        : 1;
    const parsed = Number(match[1]) * multiplier;

    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  }

  function cleanCandidateText(value) {
    return String(value || "")
      .replace(/\b(?:Read more|Show less|Verified Purchase|Helpful|Report)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isUsefulReviewText(text) {
    const normalized = cleanCandidateText(text);
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;

    if (normalized.length < 20 || normalized.length > 1800 || wordCount < 4) {
      return false;
    }

    const lowerText = normalized.toLowerCase();
    const blockedTexts = [
      "customer reviews",
      "write a review",
      "sort by",
      "filter by",
      "back to top",
      "loading",
    ];

    return !blockedTexts.some((blockedText) => lowerText === blockedText);
  }

  function extractRatingFromTextInPage(text) {
    const normalized = String(text || "").replace(/\s+/g, " ");
    const outOfMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:out of|\/)\s*(5|10)\s*(?:stars?|rating)?/i);

    if (outOfMatch) {
      return {
        rating: Number(outOfMatch[1]),
        rating_max: Number(outOfMatch[2]),
      };
    }

    const starMatch = normalized.match(/(\d+(?:\.\d+)?)\s*stars?/i);

    if (starMatch) {
      return {
        rating: Number(starMatch[1]),
        rating_max: 5,
      };
    }

    return {};
  }

  function closestReviewContainer(element) {
    return (
      element.closest(
        [
          "ytd-comment-thread-renderer",
          "[data-hook='review']",
          "[data-review-id]",
          "[data-testid*='review' i]",
          "[aria-label*='review' i]",
          "[class*='review' i]",
          "[class*='comment' i]",
          ".review",
          ".comment",
          "article",
        ].join(","),
      ) || element
    );
  }

  function extractElementNumberInPage(container, selectors, blockedWords = []) {
    const candidates = Array.from(container.querySelectorAll(selectors.join(",")));

    for (const candidate of candidates) {
      const text = [
        candidate.getAttribute("aria-label"),
        candidate.getAttribute("title"),
        candidate.getAttribute("data-count"),
        candidate.getAttribute("data-testid"),
        candidate.innerText,
        candidate.textContent,
      ]
        .filter(Boolean)
        .join(" ");
      const lowerText = text.toLowerCase();

      if (blockedWords.some((word) => lowerText.includes(word))) {
        continue;
      }

      const count = parseCompactNumberInPage(text);

      if (count !== null) {
        return count;
      }
    }

    return null;
  }

  function extractTextCountInPage(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (match) {
        return parseCompactNumberInPage(match[1]);
      }
    }

    return null;
  }

  function extractReviewDateInPage(container, containerText) {
    const dateElement = container.querySelector(
      [
        "time[datetime]",
        "[datetime]",
        "[data-hook*='review-date' i]",
        "[class*='date' i]",
        "[aria-label*='date' i]",
      ].join(","),
    );
    const explicitDate = [
      dateElement?.getAttribute("datetime"),
      dateElement?.getAttribute("title"),
      dateElement?.getAttribute("aria-label"),
      dateElement?.innerText,
    ]
      .filter(Boolean)
      .map((value) => String(value).replace(/\s+/g, " ").trim())
      .find(Boolean);

    if (explicitDate) {
      return explicitDate;
    }

    const datePatterns = [
      /\b\d{4}-\d{2}-\d{2}\b/,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i,
      /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/i,
    ];

    for (const pattern of datePatterns) {
      const match = containerText.match(pattern);

      if (match) {
        return match[0].replace(/\s+/g, " ").trim();
      }
    }

    return null;
  }

  function extractReviewMetadataInPage(element) {
    const container = closestReviewContainer(element);
    const containerText = cleanCandidateText(container.innerText || container.textContent || "");
    const metadata = {};
    const ratingElement = container.querySelector(
      [
        "[itemprop='ratingValue']",
        "[data-hook='review-star-rating']",
        "[data-hook='cmps-review-star-rating']",
        "[aria-label*='star' i]",
        "[aria-label*='rating' i]",
        "[title*='star' i]",
        "[title*='rating' i]",
        "[class*='rating' i]",
        "[class*='star' i]",
      ].join(","),
    );
    const ratingText = [
      ratingElement?.getAttribute("content"),
      ratingElement?.getAttribute("aria-label"),
      ratingElement?.getAttribute("title"),
      ratingElement?.innerText,
      container.getAttribute("aria-label"),
      containerText,
    ]
      .filter(Boolean)
      .join(" ");

    Object.assign(metadata, extractRatingFromTextInPage(ratingText));

    const upvotes = extractElementNumberInPage(
      container,
      [
        "[data-hook='helpful-vote-statement']",
        "[aria-label*='like' i]",
        "[aria-label*='upvote' i]",
        "[aria-label*='helpful' i]",
        "[title*='like' i]",
        "[title*='upvote' i]",
        "[title*='helpful' i]",
        "[class*='like' i]",
        "[class*='upvote' i]",
        "[class*='helpful' i]",
      ],
      ["dislike", "downvote"],
    ) ?? extractTextCountInPage(containerText, [
      /(\d[\d,.]*\s*[kKmM]?)\s*(?:people\s+found\s+this\s+helpful|found\s+this\s+helpful|helpful|upvotes?|likes?)/i,
    ]);

    if (upvotes !== null) {
      metadata.upvotes = upvotes;
    }

    const downvotes = extractElementNumberInPage(
      container,
      [
        "[aria-label*='dislike' i]",
        "[aria-label*='downvote' i]",
        "[title*='dislike' i]",
        "[title*='downvote' i]",
        "[class*='dislike' i]",
        "[class*='downvote' i]",
      ],
    ) ?? extractTextCountInPage(containerText, [
      /(\d[\d,.]*\s*[kKmM]?)\s*(?:downvotes?|dislikes?)/i,
    ]);

    if (downvotes !== null) {
      metadata.downvotes = downvotes;
    }

    const helpfulMatch = containerText.match(/(\d[\d,.]*\s*[kKmM]?)\s+(?:people\s+)?(?:found\s+this\s+)?helpful/i);

    if (helpfulMatch) {
      const helpfulVotes = parseCompactNumberInPage(helpfulMatch[1]);

      if (helpfulVotes !== null) {
        metadata.helpful_votes = helpfulVotes;
        metadata.helpfulness = `${helpfulVotes} helpful`;
      }
    }

    const reviewDate = extractReviewDateInPage(container, containerText);

    if (reviewDate) {
      metadata.date = reviewDate;
    }

    return metadata;
  }

  function addReviewFromElement(element, seen, reviews) {
    const text = cleanCandidateText(element.innerText || element.textContent || "");

    if (!isUsefulReviewText(text)) {
      return false;
    }

    const key = text.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    reviews.push({
      text,
      ...extractReviewMetadataInPage(element),
    });

    return true;
  }

  function reviewTextFromContainer(container) {
    const textSelectors = [
      "[data-hook='review-title']",
      "[data-hook='review-body']",
      "[data-hook='review-collapsed']",
      "[data-testid*='review-title' i]",
      "[data-testid*='review-body' i]",
      "[data-testid*='comment' i]",
      "[class*='review-title' i]",
      "[class*='review-body' i]",
      "[class*='review-text' i]",
      "[class*='review-content' i]",
      "[class*='comment-text' i]",
      "[class*='content-text' i]",
      "#content-text",
    ];
    const parts = [];
    const seenParts = new Set();

    for (const candidate of Array.from(container.querySelectorAll(textSelectors.join(",")))) {
      const text = cleanCandidateText(candidate.innerText || candidate.textContent || "");
      const key = text.toLowerCase();

      if (isUsefulReviewText(text) && !seenParts.has(key)) {
        seenParts.add(key);
        parts.push(text);
      }
    }

    const combinedText = parts.join(" ").trim();

    if (isUsefulReviewText(combinedText)) {
      return combinedText;
    }

    return cleanCandidateText(container.innerText || container.textContent || "");
  }

  function addReviewFromContainer(container, seen, reviews) {
    const text = reviewTextFromContainer(container);

    if (!isUsefulReviewText(text)) {
      return false;
    }

    const key = text.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    reviews.push({
      text,
      ...extractReviewMetadataInPage(container),
    });

    return true;
  }

  const containerSelectors = [
    "ytd-comment-thread-renderer",
    "[data-hook='review']",
    "[data-review-id]",
    "[data-testid*='review' i]",
    "[aria-label*='review' i]",
    "[class*='review' i]",
    "[class*='comment' i]",
    "article",
  ];
  const fallbackTextSelectors = [
    "ytd-comment-thread-renderer #content-text",
    "[data-hook='review-body']",
    "[data-hook='review-collapsed']",
    "[data-testid*='review-body' i]",
    "[data-testid*='comment' i]",
    ".review-text",
    ".review-content",
    ".comment-text",
  ];

  function collectReviewContainers() {
    const containers = [];
    const seenKeys = new Set();

    function addContainer(container) {
      if (!container || container === document.body || container === document.documentElement) {
        return;
      }

      const text = reviewTextFromContainer(container);

      if (!isUsefulReviewText(text)) {
        return;
      }

      const key = (
        container.getAttribute("data-review-id") ||
        container.id ||
        text.toLowerCase()
      );

      if (seenKeys.has(key) || containers.some((existingContainer) => existingContainer.contains(container))) {
        return;
      }

      for (let index = containers.length - 1; index >= 0; index -= 1) {
        if (container.contains(containers[index])) {
          containers.splice(index, 1);
        }
      }

      seenKeys.add(key);
      containers.push(container);
    }

    for (const selector of containerSelectors) {
      Array.from(document.querySelectorAll(selector)).forEach(addContainer);
    }

    return containers;
  }

  const seen = new Set();
  const reviews = [];

  for (const container of collectReviewContainers()) {
    addReviewFromContainer(container, seen, reviews);

    if (reviews.length >= scrapeLimit) {
      return {
        reviews,
        hitLimit: true,
      };
    }
  }

  for (const selector of fallbackTextSelectors) {
    const elements = Array.from(document.querySelectorAll(selector));

    for (const element of elements) {
      if (closestReviewContainer(element) !== element) {
        continue;
      }

      addReviewFromElement(element, seen, reviews);

      if (reviews.length >= scrapeLimit) {
        return {
          reviews,
          hitLimit: true,
        };
      }
    }
  }

  return {
    reviews,
    hitLimit: false,
  };
}
