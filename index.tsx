/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {GoogleGenAI} from '@google/genai';

// Fix: Define and use AIStudio interface for window.aistudio to resolve type conflict.
// Define the aistudio property on the window object for TypeScript
declare global {
  interface AIStudio {
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
  }
}

async function openApiKeyDialog() {
  if (window.aistudio?.openSelectKey) {
    await window.aistudio.openSelectKey();
  } else {
    // This provides a fallback for environments where the dialog isn't available
    showStatusError(
      'API key selection is not available. Please configure the API_KEY environment variable.',
    );
  }
}

const statusEl = document.querySelector('#status') as HTMLDivElement;
const promptEl = document.querySelector('#prompt-input') as HTMLTextAreaElement;
const generateButton = document.querySelector(
  '#generate-button',
) as HTMLButtonElement;
const outputImage = document.querySelector('#output-image') as HTMLImageElement;
const imageInput = document.querySelector('#image-upload') as HTMLInputElement;
const previewContainer = document.querySelector(
  '#preview-container',
) as HTMLDivElement;
const previewImage = document.querySelector(
  '#preview-image',
) as HTMLImageElement;
const removeImageBtn = document.querySelector(
  '#remove-image-btn',
) as HTMLButtonElement;
const downloadButton = document.querySelector(
  '#download-button',
) as HTMLButtonElement;

// --- Constants ---
const DEFAULT_EDIT_PROMPT = "Create a clean product shot on a pure white background.\n\nOBJECTIVES:\n1. Identify the floor scrubber (marked by the red box).\n2. CRITICAL: Include the ENTIRE base station/dock at the bottom. Do not cut it off, even if it extends outside the red box.\n3. Remove the background (walls, pegboard, floor texture).\n\nCLEANUP:\n- Remove ALL watermarks, text, and overlay patterns.\n- Remove the power cord/cable near the handle to make it look wireless.";

// --- State Variables ---
let prompt = '';
let uploadedImageBase64: string | null = null;
let uploadedImageMimeType: string = 'image/jpeg';

// --- Event Listeners ---
promptEl.addEventListener('input', () => {
  prompt = promptEl.value;
});

imageInput.addEventListener('change', async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) {
    try {
      const {base64, mimeType} = await readFileAsBase64(file);
      uploadedImageBase64 = base64;
      uploadedImageMimeType = mimeType;
      previewImage.src = `data:${mimeType};base64,${base64}`;
      previewContainer.classList.remove('hidden');
      
      // Auto-suggest a prompt if empty
      if (!promptEl.value.trim()) {
        promptEl.value = DEFAULT_EDIT_PROMPT;
        prompt = promptEl.value;
      }
    } catch (e) {
      showStatusError('Failed to read image file.');
    }
  }
});

removeImageBtn.addEventListener('click', () => {
  uploadedImageBase64 = null;
  imageInput.value = '';
  previewContainer.classList.add('hidden');
  previewImage.src = '';
  if (promptEl.value === DEFAULT_EDIT_PROMPT) {
    promptEl.value = "";
    prompt = "";
  }
});

generateButton.addEventListener('click', () => {
  if (!prompt.trim()) {
    showStatusError('Please enter a prompt.');
    return;
  }
  generate();
});

downloadButton.addEventListener('click', () => {
  if (outputImage.src) {
    const link = document.createElement('a');
    link.href = outputImage.src;
    const date = new Date();
    const timestamp = date.toISOString().replace(/[:.]/g, '-');
    link.download = `generated-image-${timestamp}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
});

// --- Functions ---
function showStatusError(message: string) {
  statusEl.innerHTML = `<span class="text-red-400">${message}</span>`;
}

function setControlsDisabled(disabled: boolean) {
  generateButton.disabled = disabled;
  promptEl.disabled = disabled;
  imageInput.disabled = disabled;
  removeImageBtn.disabled = disabled;
}

function readFileAsBase64(
  file: File,
): Promise<{base64: string; mimeType: string}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve({base64, mimeType: file.type});
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function generateImage(prompt: string, apiKey: string) {
  const ai = new GoogleGenAI({apiKey});

  if (uploadedImageBase64) {
    // --- EDIT MODE (Gemini 2.5 Flash Image) ---
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            inlineData: {
              data: uploadedImageBase64,
              mimeType: uploadedImageMimeType,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    });

    let imageUrl: string | null = null;
    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      const parts = candidates[0].content.parts;
      for (const part of parts) {
        if (part.inlineData) {
          const base64EncodeString = part.inlineData.data;
          imageUrl = `data:image/png;base64,${base64EncodeString}`;
          break;
        }
      }
    }

    if (!imageUrl) {
      throw new Error(
        'The model did not return an image. Try refining your prompt.',
      );
    }

    outputImage.src = imageUrl;
    outputImage.style.display = 'block';
  } else {
    // --- GENERATION MODE (Imagen 3) ---
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt,
      config: {
        numberOfImages: 1,
        // aspectRatio: '1:1',
      },
    });

    const images = response.generatedImages;
    if (images === undefined || images.length === 0) {
      throw new Error(
        'No images were generated. The prompt may have been blocked.',
      );
    }

    const base64ImageBytes = images[0].image.imageBytes;
    const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
    outputImage.src = imageUrl;
    outputImage.style.display = 'block';
  }
}

async function generate() {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    showStatusError('API key is not configured. Please add your API key.');
    await openApiKeyDialog();
    return;
  }

  statusEl.innerText = uploadedImageBase64
    ? 'Editing image...'
    : 'Generating image...';
  outputImage.style.display = 'none';
  downloadButton.classList.add('hidden');
  setControlsDisabled(true);

  try {
    await generateImage(prompt, apiKey);
    statusEl.innerText = 'Success!';
    downloadButton.classList.remove('hidden');
  } catch (e) {
    console.error('Operation failed:', e);
    const errorMessage =
      e instanceof Error ? e.message : 'An unknown error occurred.';

    let userFriendlyMessage = `Error: ${errorMessage}`;
    let shouldOpenDialog = false;

    if (typeof errorMessage === 'string') {
      if (errorMessage.includes('Requested entity was not found.')) {
        userFriendlyMessage =
          'Model not found. Please check your API key or project permissions.';
        shouldOpenDialog = true;
      } else if (
        errorMessage.includes('API_KEY_INVALID') ||
        errorMessage.includes('API key not valid') ||
        errorMessage.toLowerCase().includes('permission denied')
      ) {
        userFriendlyMessage =
          'Your API key is invalid. Please add a valid API key.';
        shouldOpenDialog = true;
      }
    }

    showStatusError(userFriendlyMessage);

    if (shouldOpenDialog) {
      await openApiKeyDialog();
    }
  } finally {
    setControlsDisabled(false);
  }
}