const { GoogleGenerativeAI } = require('@google/generative-ai');
const BaseProvider = require('./base');

class GeminiProvider extends BaseProvider {
  constructor(apiKey, options = {}) {
    super(apiKey, options);
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = options.model || 'gemini-1.5-flash';
  }

  async analyze(captureData, options = {}) {
    const prompt = this.buildPrompt(captureData, options);
    const model = this.genAI.getGenerativeModel({ model: this.model });

    // Build content array with images
    const parts = [];

    // Add screenshots as images
    for (const screenshot of captureData.screenshots) {
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: screenshot.buffer.toString('base64'),
        },
      });
      parts.push({
        text: `[Screenshot: ${screenshot.viewport} - ${screenshot.width}x${screenshot.height}]`,
      });
    }

    // Add the analysis prompt
    parts.push({ text: prompt });

    const result = await model.generateContent(parts);
    const response = await result.response;
    const responseText = response.text();

    return this.parseResponse(responseText);
  }
  async reviewCode(diff, context, options = {}) {
    const prompt = this.buildReviewPrompt(diff, context, options);
    const model = this.genAI.getGenerativeModel({ model: this.model });

    const result = await model.generateContent([{ text: prompt }]);
    const response = await result.response;
    const responseText = response.text();

    return this.parseResponse(responseText);
  }
}

module.exports = GeminiProvider;
