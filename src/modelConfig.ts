export const AVAILABLE_MODELS = [
  { id: 'hybrid-deep-research-flash-lite', label: 'Hybrid (Deep Research + Flash Lite)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'antigravity-preview-05-2026', label: 'Antigravity 05-26' },
  { id: 'gemini-3.1-pro-preview-customtools', label: 'Gemini 3.1 Custom' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3.0 Flash Prev' }
] as const;

const ALL_MODEL_IDS = AVAILABLE_MODELS.map((model) => model.id);

const uniqueAvailable = (ids: string[]) =>
  ids.filter((id, index) => ALL_MODEL_IDS.includes(id as (typeof ALL_MODEL_IDS)[number]) && ids.indexOf(id) === index);

export const getFallbackChain = (selectedModel: string): string[] => {
  if (selectedModel === 'hybrid-deep-research-flash-lite') {
    // Hybrid has a distinct Deep Research pipeline. Never silently replace it
    // with a normal single-model mode.
    return [selectedModel];
  }

  if (selectedModel.startsWith('antigravity')) {
    // Interactions/Antigravity has a different execution model, so keep it isolated.
    return [selectedModel];
  }

  if (selectedModel.includes('pro-preview')) {
    return uniqueAvailable([
      selectedModel,
      'gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview-customtools',
      'gemini-3.8-flash',
      'gemini-3.7-flash'
    ]);
  }

  if (selectedModel.includes('flash-lite')) {
    return uniqueAvailable([
      selectedModel,
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.7-flash'
    ]);
  }

  if (selectedModel.includes('flash')) {
    return uniqueAvailable([
      selectedModel,
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite'
    ]);
  }

  return [selectedModel];
};
