import {
  MESSAGE_TYPES,
  PORT_NAMES,
} from "./constants/ragConfig.js";
import {
  classifySentiment,
  configureTransformersEnvironment,
  embedTexts,
  getModelStatus,
  initModels,
  markExtensionInstalled,
  cancelGeneration,
  streamGenerationToPort,
} from "./background/modelRuntime.js";

configureTransformersEnvironment();

chrome.runtime.onInstalled.addListener(() => {
  markExtensionInstalled().catch(console.warn);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleRuntimeMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAMES.GENERATION) {
    return;
  }

  port.onMessage.addListener((message) => {
    if (message?.type === MESSAGE_TYPES.CANCEL_GENERATION) {
      const cancelled = cancelGeneration(message.requestId);
      safePostMessage(port, {
        type: "CANCELLED",
        requestId: message.requestId,
        cancelled,
      });
      return;
    }

    if (message?.type === MESSAGE_TYPES.GENERATE) {
      streamGenerationToPort(port, message).catch((error) => {
        safePostMessage(port, {
          type: "ERROR",
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    safePostMessage(port, {
      type: "ERROR",
      requestId: message?.requestId,
      error: `Unknown port message type: ${message?.type || "missing"}`,
    });
  });
});

function safePostMessage(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // The popup may have closed or cancelled the port.
  }
}

async function handleRuntimeMessage(message) {
  switch (message?.type) {
    case MESSAGE_TYPES.INIT_MODELS:
      return initModels(message.roles);

    case MESSAGE_TYPES.MODEL_STATUS:
      return getModelStatus();

    case MESSAGE_TYPES.EMBED_TEXTS:
      return embedTexts(message.texts || []);

    case MESSAGE_TYPES.CLASSIFY_SENTIMENT:
      return classifySentiment(message.texts || []);

    default:
      return {
        ok: false,
        error: `Unknown message type: ${message?.type || "missing"}`,
      };
  }
}
