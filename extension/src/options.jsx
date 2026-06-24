import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function Options() {
  const [provider, setProvider] = useState("local");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    chrome.storage.local.get(
      ["aiProvider", "aiApiKey", "aiBaseUrl", "aiModelName"],
      (result) => {
        if (result.aiProvider) setProvider(result.aiProvider);
        if (result.aiApiKey) setApiKey(result.aiApiKey);
        if (result.aiBaseUrl) setBaseUrl(result.aiBaseUrl);
        if (result.aiModelName) setModelName(result.aiModelName);
      }
    );
  }, []);

  const saveOptions = () => {
    chrome.storage.local.set(
      {
        aiProvider: provider,
        aiApiKey: apiKey,
        aiBaseUrl: baseUrl,
        aiModelName: modelName,
      },
      () => {
        setStatus("Options saved.");
        setTimeout(() => setStatus(""), 3000);
      }
    );
  };

  const handleProviderChange = (e) => {
    const val = e.target.value;
    setProvider(val);
    if (val === "local") {
      setModelName("");
      setBaseUrl("");
    } else if (val === "gemini") {
      setModelName("gemini-1.5-flash");
      setBaseUrl("");
    } else if (val === "openai") {
      setModelName("gpt-4o-mini");
      setBaseUrl("");
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto bg-white rounded-xl shadow-md space-y-4">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      
      <div>
        <label className="block text-sm font-medium text-gray-700">AI Provider</label>
        <select
          value={provider}
          onChange={handleProviderChange}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
        >
          <option value="local">Local (In-Browser Transformers)</option>
          <option value="gemini">Google Gemini API (Recommended)</option>
          <option value="openai">OpenAI API (Recommended)</option>
          <option value="custom">Custom (OpenAI-compatible)</option>
        </select>
        <p className="text-xs text-gray-500 mt-2 p-2 bg-yellow-50 rounded-md border border-yellow-200">
          <strong>Note:</strong> Local AI runs entirely in your browser but is <strong>slow and less reliable</strong> for reasoning tasks. 
          Cloud-based APIs (like Gemini or OpenAI) are <strong>highly recommended</strong> as they are much smarter, faster, and provide vastly superior summaries and insights.
        </p>
      </div>

      {provider !== "local" && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              placeholder="Enter your API key"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Model Name</label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
              placeholder="e.g. gemini-1.5-flash"
            />
          </div>
        </>
      )}

      {provider === "custom" && (
        <div>
          <label className="block text-sm font-medium text-gray-700">Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border"
            placeholder="e.g. https://api.together.xyz/v1"
          />
        </div>
      )}

      <div>
        <button
          onClick={saveOptions}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          Save
        </button>
        {status && <span className="ml-4 text-green-600">{status}</span>}
      </div>
    </div>
  );
}

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<Options />);
