const BaseProvider = require('./base');

class OllamaProvider extends BaseProvider {
  constructor(apiKey, options = {}) {
    super(apiKey, options);
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.model = options.model || 'llava';
  }

  async analyze(captureData, options = {}) {
    const prompt = this.buildPrompt(captureData, options);

    // Ollama expects images as base64 strings in the images array
    const images = captureData.screenshots.map(s => s.buffer.toString('base64'));

    // Build the full prompt with screenshot descriptions
    let fullPrompt = '';
    for (const screenshot of captureData.screenshots) {
      const { viewport, width, height } = screenshot;
      fullPrompt += `[Screenshot: ${viewport} - ${width}x${height}]\n`;
    }
    fullPrompt += '\n' + prompt;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: fullPrompt,
        images,
        stream: false,
        options: {
          temperature: 0.1,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return this.parseResponse(data.response || '');
  }
}

module.exports = OllamaProvider;
